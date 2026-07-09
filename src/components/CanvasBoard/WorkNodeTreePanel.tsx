import { useEffect, useMemo, useState } from 'react';
import { createAiTimelineWorkNodeClient, probeAiTimelineWorkNodeRuntime } from '../../agentKernel/timelineWorktree/localNodeClient';
import type { AiTimelineWorkNode, AiTimelineWorkNodeCommit } from '../../agentKernel/timelineWorktree/types';
import { getLocalAgentHealth } from '../../utils/localAgent';
import {
  enqueueMainWorkbenchCommand,
  readMainWorkbenchCommandQueue,
} from '../../utils/mainWorkbenchControl';
import { buildWorkNodeTreeViewModel } from './workNodeTreeModel';
import { WorkNodeTreeNode } from './WorkNodeTreeNode';
import type { WorkNodeTreeViewModel } from './workNodeTreeTypes';
import {
  addWorkNodeDeletedIds,
  clearWorkNodeParentOverrides,
  readActiveWorkNodeId,
  readWorkNodeDeletedIds,
  readWorkNodeParentOverrides,
  writeActiveWorkNodeId,
  writeWorkNodeParentOverride,
} from './workNodeSelection';
import './WorkNodeTreePanel.css';

type WorkNodeTreePanelProps = {
  refreshKey: number;
  onSummaryChange?: (summary: WorkNodeTreeViewModel) => void;
};

async function ensureWorkNodeReadRuntime() {
  if (typeof window !== 'undefined' && window.desktopRuntime?.listAiTimelineWorkNodes) return;
  await getLocalAgentHealth();
}

function waitForCreatedWorkNode(commandId: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const entry = readMainWorkbenchCommandQueue().find((item) => item.id === commandId);
      const result = entry?.result && typeof entry.result === 'object' ? entry.result as { nodeId?: unknown } : null;
      if (entry?.status === 'done' && typeof result?.nodeId === 'string') {
        window.clearInterval(timer);
        resolve(result.nodeId);
        return;
      }
      if (entry?.status === 'error') {
        window.clearInterval(timer);
        reject(new Error(entry.error || 'Work node create failed.'));
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        window.clearInterval(timer);
        reject(new Error('Work node create timed out.'));
      }
    }, 250);
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function applyParentOverrides(nodes: AiTimelineWorkNode[], overrides: Record<string, string>) {
  if (Object.keys(overrides).length === 0) return nodes;
  return nodes.map((node) => {
    if (!Object.prototype.hasOwnProperty.call(overrides, node.id)) return node;
    const parentNodeId = overrides[node.id];
    return {
      ...node,
      parentNodeId: parentNodeId || undefined,
    };
  });
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

export function WorkNodeTreePanel({ refreshKey, onSummaryChange }: WorkNodeTreePanelProps) {
  const [nodes, setNodes] = useState<AiTimelineWorkNode[]>([]);
  const [commits, setCommits] = useState<AiTimelineWorkNodeCommit[]>([]);
  const [parentOverrides, setParentOverrides] = useState(() => readWorkNodeParentOverrides());
  const [deletedNodeIds, setDeletedNodeIds] = useState(() => readWorkNodeDeletedIds());
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeNodeId, setActiveNodeId] = useState(() => readActiveWorkNodeId());

  const visibleNodes = useMemo(() => {
    const deleted = new Set(deletedNodeIds);
    return applyParentOverrides(nodes.filter((node) => !deleted.has(node.id)), parentOverrides);
  }, [deletedNodeIds, nodes, parentOverrides]);
  const viewModel = useMemo(() => buildWorkNodeTreeViewModel(visibleNodes, commits), [visibleNodes, commits]);
  const effectiveActiveNodeId = activeNodeId || viewModel.latestNode?.nodeId || '';
  const activePathNodeIds = useMemo(() => {
    const pathIds = new Set<string>();
    const byId = new Map(viewModel.flatNodes.map((node) => [node.nodeId, node]));
    let current = effectiveActiveNodeId ? byId.get(effectiveActiveNodeId) : undefined;

    while (current) {
      pathIds.add(current.nodeId);
      current = current.parentNodeId ? byId.get(current.parentNodeId) : undefined;
    }

    return pathIds;
  }, [effectiveActiveNodeId, viewModel.flatNodes]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        await ensureWorkNodeReadRuntime();
        await probeAiTimelineWorkNodeRuntime();
        const response = await createAiTimelineWorkNodeClient().list();
        if (cancelled) return;
        setNodes(response.nodes || []);
        setCommits(response.commits || []);
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
    const timer = window.setInterval(() => void load(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshKey]);

  useEffect(() => {
    onSummaryChange?.(viewModel);
  }, [onSummaryChange, viewModel]);

  const reloadNodes = async () => {
    const response = await createAiTimelineWorkNodeClient().list();
    setNodes(response.nodes || []);
    setCommits(response.commits || []);
    return response;
  };

  const setActiveNode = (nodeId: string) => {
    writeActiveWorkNodeId(nodeId);
    setActiveNodeId(nodeId);
  };

  const checkoutNode = (nodeId: string) => {
    setActiveNode(nodeId);
    enqueueMainWorkbenchCommand({
      op: 'checkoutAiTimelineWorkNode',
      nodeId,
      reload: false,
      approval: {
        mode: 'manual',
        approvedBy: 'user',
        rationale: 'Selected from Work Node tree.',
      },
    }, 'work-node-tree');
  };

  const persistCreatedParent = async (nodeId: string, parentNodeId: string | undefined) => {
    try {
      await createAiTimelineWorkNodeClient().update(nodeId, { parentNodeId });
    } catch {
      // The local override already makes the current panel correct. Persistence will work after Electron main reloads.
    }
  };

  const createNodeFromCurrent = async (parentNodeId: string | undefined, labelPrefix: string) => {
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
      const nodeId = await waitForCreatedWorkNode(entry.id);
      setParentOverrides(writeWorkNodeParentOverride(nodeId, parentNodeId || ''));
      setActiveNode(nodeId);
      await reloadNodes();
      void persistCreatedParent(nodeId, parentNodeId);
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
      const response = await createAiTimelineWorkNodeClient().delete(node.nodeId);
      const deleted = new Set(subtreeNodeIds);
      setDeletedNodeIds(addWorkNodeDeletedIds(subtreeNodeIds));
      setNodes((response.nodes || []).filter((item) => !deleted.has(item.id)));
      setCommits((response.commits || []).filter((item) => !deleted.has(item.nodeId)));
      setParentOverrides(clearWorkNodeParentOverrides(subtreeNodeIds));
    } catch (deleteError) {
      setError(`删除节点失败：${errorMessage(deleteError)}。`);
    }
  };

  return (
    <div
      className="work-node-tree-panel"
      aria-label={`Work node 节点树，${viewModel.nodeCount} 节点，${viewModel.riskCount} 风险`}
    >
      <div className="work-node-tree-count">{viewModel.nodeCount} 节点 / {viewModel.riskCount} 风险</div>
      {error ? <div className="work-node-tree-empty">{error}</div> : null}
      {!error && loading && viewModel.nodeCount === 0 ? <div className="work-node-tree-empty">正在读取节点</div> : null}
      {!error && !loading && viewModel.nodeCount === 0 ? <div className="work-node-tree-empty">暂无可见节点</div> : null}
      {viewModel.nodes.map((node) => (
        <WorkNodeTreeNode
          key={node.nodeId}
          node={node}
          activeNodeId={effectiveActiveNodeId}
          activePathNodeIds={activePathNodeIds}
          isRoot
          onSelect={(target) => checkoutNode(target.nodeId)}
          onDelete={handleDelete}
          onAddChild={(target) => void createNodeFromCurrent(target.nodeId, 'child')}
          onAddSibling={(target) => void createNodeFromCurrent(target.parentNodeId, 'branch')}
        />
      ))}
    </div>
  );
}
