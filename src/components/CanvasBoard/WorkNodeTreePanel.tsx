import { useEffect, useMemo, useRef, useState } from 'react';
import { createAiTimelineWorkNodeClient } from '../../agentKernel/timelineWorktree/localNodeClient';
import { createTimelineRepositoryClient } from '../../agentKernel/timelineRepository/localTimelineClient';
import { DEFAULT_TIMELINE_ID } from '../../core/domain/timeline';
import type { AiTimelineWorkNodeListResponse } from '../../agentKernel/timelineWorktree/localNodeClient';
import type { AiTimelineWorkNodeCommitListItem, AiTimelineWorkNodeListItem } from '../../agentKernel/timelineWorktree/types';
import {
  enqueueMainWorkbenchCommand,
  readMainWorkbenchCommandQueue,
} from '../../utils/mainWorkbenchControl';
import { buildWorkNodeTreeViewModel } from './workNodeTreeModel';
import { buildWorkNodeTreeLayout } from './workNodeTreeLayout';
import { WorkNodeTreeNode } from './WorkNodeTreeNode';
import type { WorkNodeTreeViewModel } from './workNodeTreeTypes';
import './WorkNodeTreePanel.css';

type WorkNodeTreePanelProps = {
  refreshKey: number;
  onSelectedNodeChange?: (nodeId: string) => void;
  onSummaryChange?: (summary: WorkNodeTreeViewModel) => void;
};

function waitForWorkbenchCommand(commandId: string, timeoutMs = 8000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const entry = readMainWorkbenchCommandQueue().find((item) => item.id === commandId);
      if (entry?.status === 'done') {
        window.clearInterval(timer);
        resolve(entry.result);
        return;
      }
      if (entry?.status === 'error') {
        window.clearInterval(timer);
        reject(new Error(entry.error || 'Work node create failed.'));
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        window.clearInterval(timer);
        reject(new Error('Work node operation timed out.'));
      }
    }, 250);
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function collectSubtreeNodeIds(node: WorkNodeTreeViewModel['flatNodes'][number]) {
  const ids: string[] = [];
  const visit = (current: WorkNodeTreeViewModel['flatNodes'][number]) => {
    ids.push(current.nodeId);
    current.children.forEach(visit);
  };
  visit(node);
  return ids;
}

export function WorkNodeTreePanel({ refreshKey, onSelectedNodeChange, onSummaryChange }: WorkNodeTreePanelProps) {
  const [nodes, setNodes] = useState<AiTimelineWorkNodeListItem[]>([]);
  const [commits, setCommits] = useState<AiTimelineWorkNodeCommitListItem[]>([]);
  const [headNodeId, setHeadNodeId] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const selectionInitializedRef = useRef(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [camera, setCamera] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; cameraX: number; cameraY: number } | null>(null);
  const revisionRef = useRef(0);

  const applyListResponse = (response: AiTimelineWorkNodeListResponse) => {
    if (response.revision < revisionRef.current) return false;
    revisionRef.current = response.revision;
    setNodes(response.nodes || []);
    setCommits(response.commits || []);
    setHeadNodeId(response.headNodeId || '');
    if (!selectionInitializedRef.current) {
      selectionInitializedRef.current = true;
      setSelectedNodeId(response.headNodeId || '');
    }
    return true;
  };

  const viewModel = useMemo(() => buildWorkNodeTreeViewModel(nodes, commits), [nodes, commits]);
  const treeLayout = useMemo(() => buildWorkNodeTreeLayout(viewModel.nodes), [viewModel.nodes]);
  const activePathNodeIds = useMemo(() => {
    const pathIds = new Set<string>();
    const byId = new Map(viewModel.flatNodes.map((node) => [node.nodeId, node]));
    let current = selectedNodeId ? byId.get(selectedNodeId) : undefined;

    while (current) {
      pathIds.add(current.nodeId);
      current = current.parentNodeId ? byId.get(current.parentNodeId) : undefined;
    }

    return pathIds;
  }, [selectedNodeId, viewModel.flatNodes]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await createAiTimelineWorkNodeClient().list();
        const repositoryNodes = await createTimelineRepositoryClient().listWorkNodes(DEFAULT_TIMELINE_ID);
        if (cancelled) return;
        applyListResponse({ ...response, nodes: repositoryNodes.map((node) => ({
          ...node,
          riskFlags: node.riskFlags.map((risk, index) => ({ ...risk, id: `${risk.code || 'risk'}-${index}` })),
          saveId: node.timelineId,
          status: node.status as AiTimelineWorkNodeListItem['status'],
          approvalPolicy: node.approvalPolicy as AiTimelineWorkNodeListItem['approvalPolicy'],
          baseSummary: { characterCount: 0, buttonCount: 0, buffCount: 0 },
          workingSummary: { characterCount: 0, buttonCount: 0, buffCount: 0 },
        })) });
        setError('');
      } catch (loadError) {
        if (cancelled) return;
        setError(errorMessage(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    setLoading(true);
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  useEffect(() => {
    onSummaryChange?.(viewModel);
  }, [onSummaryChange, viewModel]);

  const reloadNodes = async () => {
    const response = await createAiTimelineWorkNodeClient().list();
    const repositoryNodes = await createTimelineRepositoryClient().listWorkNodes(DEFAULT_TIMELINE_ID);
    const next = { ...response, nodes: repositoryNodes.map((node) => ({
      ...node, riskFlags: node.riskFlags.map((risk, index) => ({ ...risk, id: `${risk.code || 'risk'}-${index}` })), saveId: node.timelineId,
      status: node.status as AiTimelineWorkNodeListItem['status'],
      approvalPolicy: node.approvalPolicy as AiTimelineWorkNodeListItem['approvalPolicy'],
      baseSummary: { characterCount: 0, buttonCount: 0, buffCount: 0 },
      workingSummary: { characterCount: 0, buttonCount: 0, buffCount: 0 },
    })) };
    applyListResponse(next);
    return next;
  };

  const checkoutNode = async (nodeId: string) => {
    try {
      setError('');
      const entry = enqueueMainWorkbenchCommand({
        op: 'checkoutAiTimelineWorkNode',
        nodeId,
        reload: false,
        approval: {
          mode: 'manual',
          approvedBy: 'user',
          rationale: 'Selected from Work Node tree.',
        },
      }, 'work-node-tree');
      const result = await waitForWorkbenchCommand(entry.id);
      if (result && typeof result === 'object' && 'checkoutApplied' in result
        && (result as { checkoutApplied?: unknown }).checkoutApplied !== true) {
        const markError = 'checkoutMarkError' in result
          ? String((result as { checkoutMarkError?: unknown }).checkoutMarkError || '')
          : '';
        throw new Error(markError || 'Work Node 已应用，但 HEAD 确认失败。');
      }
      await createTimelineRepositoryClient().setCheckoutRef({
        timelineId: DEFAULT_TIMELINE_ID,
        targetType: 'work-node',
        targetId: nodeId,
        updatedAt: Date.now(),
      });
      await reloadNodes();
    } catch (checkoutError) {
      setError(`应用节点失败：${errorMessage(checkoutError)}`);
    }
  };

  const createNodeFromCurrent = async (parentNodeId: string | null, labelPrefix: string) => {
    try {
      setError('');
      const createdAt = Date.now();
      const entry = enqueueMainWorkbenchCommand({
        op: 'createAiTimelineWorkNodeFromCurrent',
        parentNodeId,
        branchId: `${labelPrefix}-${createdAt}`,
        label: `[${labelPrefix}] ${new Date(createdAt).toLocaleString('zh-CN', { hour12: false })}`,
        approvalPolicy: 'auto-low-risk',
      }, 'work-node-tree');
      const result = await waitForWorkbenchCommand(entry.id);
      const nodeId = result && typeof result === 'object' && 'nodeId' in result
        ? (result as { nodeId?: unknown }).nodeId
        : undefined;
      if (typeof nodeId !== 'string') throw new Error('Work node create result is missing nodeId.');
      await reloadNodes();
    } catch (createError) {
      setError(`创建节点失败：${errorMessage(createError)}`);
    }
  };

  const handleDelete = async (node: WorkNodeTreeViewModel['flatNodes'][number]) => {
    if (activePathNodeIds.has(node.nodeId)) {
      setError('当前路径上的节点不能删除；只能删除灰色分支。');
      return;
    }
    const subtreeNodeIds = collectSubtreeNodeIds(node);
    const confirmed = window.confirm(`删除节点 "${node.title}" 及其 ${subtreeNodeIds.length - 1} 个子节点？`);
    if (!confirmed) return;
    try {
      setError('');
      await createTimelineRepositoryClient().deleteWorkNode(node.nodeId);
      await reloadNodes();
    } catch (deleteError) {
      setError(`删除节点失败：${errorMessage(deleteError)}。`);
    }
  };

  const handleRename = async (node: WorkNodeTreeViewModel['flatNodes'][number], title: string) => {
    try {
      setError('');
      await createAiTimelineWorkNodeClient().update(node.nodeId, { label: title });
      await reloadNodes();
    } catch (renameError) {
      setError(`重命名节点失败：${errorMessage(renameError)}`);
      throw renameError;
    }
  };

  const selectNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    onSelectedNodeChange?.(nodeId);
  };

  // Checkout is deliberately deferred to the modal close handler in CanvasBoard.
  void checkoutNode;

  const handleCanvasPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (event.button !== 0 || target.closest('.work-node-tree-node-shell, .work-node-tree-count, .work-node-tree-empty')) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cameraX: camera.x,
      cameraY: camera.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleCanvasPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setCamera({
      x: drag.cameraX + event.clientX - drag.startX,
      y: drag.cameraY + event.clientY - drag.startY,
    });
  };

  const stopCanvasDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  return (
    <div
      className="work-node-tree-panel"
      aria-label={`Work node 节点树，${viewModel.nodeCount} 节点，${viewModel.riskCount} 风险`}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handleCanvasPointerMove}
      onPointerUp={stopCanvasDrag}
      onPointerCancel={stopCanvasDrag}
    >
      <div className="work-node-tree-count">{viewModel.nodeCount} 节点 / {viewModel.riskCount} 风险</div>
      {error ? <div className="work-node-tree-empty">{error}</div> : null}
      {!error && loading && viewModel.nodeCount === 0 ? <div className="work-node-tree-empty">正在读取节点</div> : null}
      {!error && !loading && viewModel.nodeCount === 0 ? <div className="work-node-tree-empty">暂无可见节点</div> : null}
      <div
        className="work-node-tree-canvas"
        style={{
          width: treeLayout.width,
          height: treeLayout.height,
          transform: `translate(${camera.x}px, ${camera.y}px)`,
        }}
      >
        <svg
          className="work-node-tree-connectors"
          width={treeLayout.width}
          height={treeLayout.height}
          aria-hidden="true"
        >
          {treeLayout.connectors.map((connector, index) => {
            const branchY = connector.parentBottom + 14;
            const activeChildIndex = connector.childNodeIds.findIndex((nodeId) => activePathNodeIds.has(nodeId));
            const isPathSegment = activePathNodeIds.has(connector.parentNodeId) && activeChildIndex >= 0;
            if (connector.childXs.length === 1) {
              return (
                <g key={`linear-${index}`}>
                  <line
                    x1={connector.parentX}
                    y1={connector.parentBottom}
                    x2={connector.childXs[0]}
                    y2={connector.childTop}
                  />
                  {isPathSegment ? (
                    <line
                      className="is-path"
                      x1={connector.parentX}
                      y1={connector.parentBottom}
                      x2={connector.childXs[0]}
                      y2={connector.childTop}
                    />
                  ) : null}
                </g>
              );
            }
            return (
              <g key={`fork-${index}`}>
                <line x1={connector.parentX} y1={connector.parentBottom} x2={connector.parentX} y2={branchY} />
                <line x1={connector.childXs[0]} y1={branchY} x2={connector.childXs[connector.childXs.length - 1]} y2={branchY} />
                {connector.childXs.map((childX, childIndex) => (
                  <line key={childIndex} x1={childX} y1={branchY} x2={childX} y2={connector.childTop} />
                ))}
                {isPathSegment ? (
                  <>
                    <line className="is-path" x1={connector.parentX} y1={connector.parentBottom} x2={connector.parentX} y2={branchY} />
                    <line className="is-path" x1={connector.parentX} y1={branchY} x2={connector.childXs[activeChildIndex]} y2={branchY} />
                    <line className="is-path" x1={connector.childXs[activeChildIndex]} y1={branchY} x2={connector.childXs[activeChildIndex]} y2={connector.childTop} />
                  </>
                ) : null}
              </g>
            );
          })}
        </svg>
        {treeLayout.nodes.map(({ node, x, y }) => (
          <WorkNodeTreeNode
            key={node.nodeId}
            node={node}
            activeNodeId={selectedNodeId || headNodeId}
            activePathNodeIds={activePathNodeIds}
            x={x}
            y={y}
            onSelect={(target) => selectNode(target.nodeId)}
            onDelete={handleDelete}
            onAddChild={(target) => void createNodeFromCurrent(target.nodeId, 'child')}
            onAddSibling={(target) => void createNodeFromCurrent(target.parentNodeId || null, 'branch')}
            onRename={handleRename}
          />
        ))}
      </div>
    </div>
  );
}
