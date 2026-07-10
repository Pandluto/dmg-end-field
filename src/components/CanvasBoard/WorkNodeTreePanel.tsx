import { useEffect, useMemo, useRef, useState } from 'react';
import { createAiTimelineWorkNodeClient } from '../../agentKernel/timelineWorktree/localNodeClient';
import type { AiTimelineWorkNodeListResponse } from '../../agentKernel/timelineWorktree/localNodeClient';
import type { AiTimelineWorkNodeCommitListItem, AiTimelineWorkNodeListItem } from '../../agentKernel/timelineWorktree/types';
import {
  enqueueMainWorkbenchCommand,
  readMainWorkbenchCommandQueue,
} from '../../utils/mainWorkbenchControl';
import { buildWorkNodeTreeViewModel } from './workNodeTreeModel';
import { WorkNodeTreeNode } from './WorkNodeTreeNode';
import type { WorkNodeTreeViewModel } from './workNodeTreeTypes';
import './WorkNodeTreePanel.css';

type WorkNodeTreePanelProps = {
  refreshKey: number;
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

export function WorkNodeTreePanel({ refreshKey, onSummaryChange }: WorkNodeTreePanelProps) {
  const [nodes, setNodes] = useState<AiTimelineWorkNodeListItem[]>([]);
  const [commits, setCommits] = useState<AiTimelineWorkNodeCommitListItem[]>([]);
  const [headNodeId, setHeadNodeId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const revisionRef = useRef(0);

  const applyListResponse = (response: AiTimelineWorkNodeListResponse) => {
    if (response.revision < revisionRef.current) return false;
    revisionRef.current = response.revision;
    setNodes(response.nodes || []);
    setCommits(response.commits || []);
    setHeadNodeId(response.headNodeId || '');
    return true;
  };

  const viewModel = useMemo(() => buildWorkNodeTreeViewModel(nodes, commits), [nodes, commits]);
  const activePathNodeIds = useMemo(() => {
    const pathIds = new Set<string>();
    const byId = new Map(viewModel.flatNodes.map((node) => [node.nodeId, node]));
    let current = headNodeId ? byId.get(headNodeId) : undefined;

    while (current) {
      pathIds.add(current.nodeId);
      current = current.parentNodeId ? byId.get(current.parentNodeId) : undefined;
    }

    return pathIds;
  }, [headNodeId, viewModel.flatNodes]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await createAiTimelineWorkNodeClient().list();
        if (cancelled) return;
        applyListResponse(response);
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
    applyListResponse(response);
    return response;
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
      const response = await createAiTimelineWorkNodeClient().delete(node.nodeId);
      applyListResponse(response);
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
          activeNodeId={headNodeId}
          activePathNodeIds={activePathNodeIds}
          isRoot
          onSelect={(target) => void checkoutNode(target.nodeId)}
          onDelete={handleDelete}
          onAddChild={(target) => void createNodeFromCurrent(target.nodeId, 'child')}
          onAddSibling={(target) => void createNodeFromCurrent(target.parentNodeId || null, 'branch')}
        />
      ))}
    </div>
  );
}
