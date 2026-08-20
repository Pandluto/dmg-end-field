import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createAiTimelineWorkNodeClient } from '../../agentKernel/timelineWorktree/localNodeClient';
import { createTimelineRepositoryClient, formatTimelineOperationError, type TimelineRepositoryWorkNodePatch } from '../../agentKernel/timelineRepository/localTimelineClient';
import type { TimelineAuditEvent } from '../../core/domain/timeline';
import type { AiTimelineWorkNodeCommitListItem, AiTimelineWorkNodeListItem } from '../../agentKernel/timelineWorktree/types';
import {
  enqueueMainWorkbenchCommand,
  readMainWorkbenchCommandQueue,
} from '../../utils/mainWorkbenchControl';
import { buildWorkNodeTreeViewModel } from './workNodeTreeModel';
import { buildWorkNodeTreeLayout } from './workNodeTreeLayout';
import { WorkNodeTreeNode } from './WorkNodeTreeNode';
import type { WorkNodeTreeViewModel } from './workNodeTreeTypes';
import { resolveCheckoutTargetBeforeWorkNodeDeletion } from '../../agentKernel/timelineWorktree/checkoutLifecycle';
import {
  planWorkNodePathOmission,
  planWorkNodePathOmissionFromSelection,
} from '../../platform/timeline/workNodeTopology';
import './WorkNodeTreePanel.css';

export type WorkbenchSelectedNodeContext = {
  nodeId: string;
  name: string;
  description: string;
};

type WorkNodeTreePanelProps = {
  timelineId: string;
  refreshKey: number;
  cameraResetKey?: number;
  omissionMode?: boolean;
  onSelectedNodeChange?: (node: WorkbenchSelectedNodeContext | null) => void;
  onSummaryChange?: (summary: WorkNodeTreeViewModel) => void;
  onOmissionSelectionChange?: (state: WorkNodeOmissionSelectionState) => void;
  onOmissionComplete?: (omittedCount: number) => void;
  onForkAsSqlite?: (node: WorkbenchSelectedNodeContext) => void;
};

export type WorkNodeOmissionSelectionState = {
  selectedCount: number;
  canConfirm: boolean;
  busy: boolean;
  message: string;
};

export type WorkNodeTreePanelHandle = {
  confirmOmission: () => Promise<void>;
  resetOmission: () => void;
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
  return formatTimelineOperationError(error);
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

type OmissionMarquee = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type OmissionMarqueeDrag = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
};

export const WorkNodeTreePanel = forwardRef<WorkNodeTreePanelHandle, WorkNodeTreePanelProps>(function WorkNodeTreePanel({
  timelineId,
  refreshKey,
  cameraResetKey = 0,
  omissionMode = false,
  onSelectedNodeChange,
  onSummaryChange,
  onOmissionSelectionChange,
  onOmissionComplete,
  onForkAsSqlite,
}, ref) {
  const [nodes, setNodes] = useState<AiTimelineWorkNodeListItem[]>([]);
  const [commits, setCommits] = useState<AiTimelineWorkNodeCommitListItem[]>([]);
  const [headNodeId, setHeadNodeId] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [selectedNodePatches, setSelectedNodePatches] = useState<TimelineRepositoryWorkNodePatch[]>([]);
  const [selectedNodeAuditEvents, setSelectedNodeAuditEvents] = useState<TimelineAuditEvent[]>([]);
  const selectionInitializedRef = useRef(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const [omissionAnchorNodeId, setOmissionAnchorNodeId] = useState('');
  const [omissionEndNodeId, setOmissionEndNodeId] = useState('');
  const [omissionError, setOmissionError] = useState('');
  const [omissionBusy, setOmissionBusy] = useState(false);
  const [omissionMarquee, setOmissionMarquee] = useState<OmissionMarquee | null>(null);
  const cameraRef = useRef(camera);
  const treeCanvasRef = useRef<HTMLDivElement | null>(null);
  const cameraFrameRef = useRef<number | null>(null);
  const cameraCommitTimerRef = useRef<number | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; cameraX: number; cameraY: number } | null>(null);
  const omissionMarqueeDragRef = useRef<OmissionMarqueeDrag | null>(null);
  const revisionRef = useRef(0);

  const applyListResponse = (response: { revision: number; nodes: AiTimelineWorkNodeListItem[]; commits: AiTimelineWorkNodeCommitListItem[]; headNodeId: string }) => {
    if (response.revision < revisionRef.current) return false;
    revisionRef.current = response.revision;
    setNodes(response.nodes || []);
    setCommits(response.commits || []);
    setHeadNodeId(response.headNodeId || '');
    if (!selectionInitializedRef.current) {
      selectionInitializedRef.current = true;
      setSelectedNodeId(response.headNodeId || '');
    } else {
      setSelectedNodeId((current) => (
        response.nodes.some((node) => node.id === current)
          ? current
          : response.headNodeId || response.nodes[0]?.id || ''
      ));
    }
    return true;
  };

  const viewModel = useMemo(() => buildWorkNodeTreeViewModel(nodes, commits), [nodes, commits]);
  const treeLayout = useMemo(() => buildWorkNodeTreeLayout(viewModel.nodes), [viewModel.nodes]);
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) || null,
    [nodes, selectedNodeId],
  );
  const topologyNodes = useMemo(
    () => viewModel.flatNodes.map((node) => ({ id: node.nodeId, parentNodeId: node.parentNodeId })),
    [viewModel.flatNodes],
  );
  const omissionPlan = useMemo(() => {
    if (!omissionAnchorNodeId || !omissionEndNodeId) return null;
    try {
      return planWorkNodePathOmission(topologyNodes, omissionAnchorNodeId, omissionEndNodeId);
    } catch {
      return null;
    }
  }, [omissionAnchorNodeId, omissionEndNodeId, topologyNodes]);
  const omissionSelectedNodeIds = useMemo(() => new Set(
    omissionPlan?.omittedNodeIds || (omissionAnchorNodeId ? [omissionAnchorNodeId] : []),
  ), [omissionAnchorNodeId, omissionPlan]);
  const omissionAvailability = useMemo(() => {
    const availability = new Map<string, { canOmit: boolean; reason?: string }>();
    topologyNodes.forEach((node) => {
      try {
        planWorkNodePathOmission(topologyNodes, node.id);
        availability.set(node.id, { canOmit: true });
      } catch (error) {
        availability.set(node.id, {
          canOmit: false,
          reason: error instanceof Error ? error.message : '当前节点不能省略',
        });
      }
    });
    return availability;
  }, [topologyNodes]);
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
    revisionRef.current = 0;
    selectionInitializedRef.current = false;
    setSelectedNodeId('');
    setSelectedNodePatches([]);
    setSelectedNodeAuditEvents([]);
    cameraRef.current = { x: 0, y: 0, zoom: 1 };
    setCamera({ x: 0, y: 0, zoom: 1 });
  }, [timelineId]);

  const resetOmission = () => {
    setOmissionAnchorNodeId('');
    setOmissionEndNodeId('');
    setOmissionError('');
    setOmissionBusy(false);
    setOmissionMarquee(null);
    omissionMarqueeDragRef.current = null;
  };

  useEffect(() => {
    if (omissionMode) {
      onSelectedNodeChange?.(null);
      return;
    }
    resetOmission();
  }, [omissionMode, timelineId]);

  useEffect(() => {
    const selectedCount = omissionPlan?.omittedNodeIds.length || (omissionAnchorNodeId ? 1 : 0);
    const message = omissionBusy
      ? '正在合并 SQLite 节点路径…'
      : omissionError
        ? omissionError
        : omissionPlan
          ? `将省略 ${omissionPlan.omittedNodeIds.length} 个节点，并保留 ${omissionPlan.boundaryChildNodeIds.length} 条后续路径。`
          : omissionAnchorNodeId
            ? '再选择同一父子路径上的结束节点。'
            : '点击两个端点，或在空白处拖拽框选；所选区间会标红。';
    onOmissionSelectionChange?.({
      selectedCount,
      canConfirm: Boolean(omissionPlan) && !omissionBusy,
      busy: omissionBusy,
      message,
    });
  }, [omissionAnchorNodeId, omissionBusy, omissionError, omissionPlan, onOmissionSelectionChange]);

  useEffect(() => () => {
    if (cameraFrameRef.current !== null) window.cancelAnimationFrame(cameraFrameRef.current);
    if (cameraCommitTimerRef.current !== null) window.clearTimeout(cameraCommitTimerRef.current);
  }, []);

  useEffect(() => {
    if (cameraFrameRef.current !== null) {
      window.cancelAnimationFrame(cameraFrameRef.current);
      cameraFrameRef.current = null;
    }
    if (cameraCommitTimerRef.current !== null) {
      window.clearTimeout(cameraCommitTimerRef.current);
      cameraCommitTimerRef.current = null;
    }
    dragRef.current = null;
    const reset = { x: 0, y: 0, zoom: 1 };
    cameraRef.current = reset;
    if (treeCanvasRef.current) {
      treeCanvasRef.current.style.transform = 'translate3d(0px, 0px, 0) scale(1)';
    }
    setCamera(reset);
  }, [cameraResetKey]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const repository = createTimelineRepositoryClient();
        const [repositoryNodes, repositoryCommits, checkoutRef] = await Promise.all([
          repository.listWorkNodes(timelineId),
          repository.listWorkNodeCommits(timelineId),
          repository.getCheckoutRef(timelineId),
        ]);
        if (cancelled) return;
        applyListResponse({
          revision: revisionRef.current + 1,
          headNodeId: checkoutRef?.targetType === 'work-node' ? checkoutRef.targetId : '',
          commits: repositoryCommits as AiTimelineWorkNodeCommitListItem[],
          nodes: repositoryNodes.map((node) => ({
          ...node,
          riskFlags: node.riskFlags.map((risk, index) => ({ ...risk, id: `${risk.code || 'risk'}-${index}` })),
          status: node.status as AiTimelineWorkNodeListItem['status'],
          approvalPolicy: node.approvalPolicy as AiTimelineWorkNodeListItem['approvalPolicy'],
          baseSummary: node.baseSummary,
          workingSummary: node.workingSummary,
          })),
        });
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
  }, [refreshKey, timelineId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedNodeId) {
      setSelectedNodePatches([]);
      setSelectedNodeAuditEvents([]);
      return () => { cancelled = true; };
    }
    const repository = createTimelineRepositoryClient();
    void Promise.all([
      repository.listWorkNodePatches(selectedNodeId),
      repository.listAuditEvents(timelineId),
    ]).then(([patches, events]) => {
      if (cancelled) return;
      setSelectedNodePatches(patches);
      setSelectedNodeAuditEvents(events.filter((event) => event.subjectType === 'work-node' && event.subjectId === selectedNodeId));
    }).catch(() => {
      if (cancelled) return;
      setSelectedNodePatches([]);
      setSelectedNodeAuditEvents([]);
    });
    return () => { cancelled = true; };
  }, [selectedNodeId, refreshKey, timelineId]);

  useEffect(() => {
    onSummaryChange?.(viewModel);
  }, [onSummaryChange, viewModel]);

  const reloadNodes = async () => {
    const repository = createTimelineRepositoryClient();
    const [repositoryNodes, repositoryCommits, checkoutRef] = await Promise.all([
      repository.listWorkNodes(timelineId),
      repository.listWorkNodeCommits(timelineId),
      repository.getCheckoutRef(timelineId),
    ]);
    const next = {
      revision: revisionRef.current + 1,
      headNodeId: checkoutRef?.targetType === 'work-node' ? checkoutRef.targetId : '',
      commits: repositoryCommits as AiTimelineWorkNodeCommitListItem[],
      nodes: repositoryNodes.map((node) => ({
      ...node, riskFlags: node.riskFlags.map((risk, index) => ({ ...risk, id: `${risk.code || 'risk'}-${index}` })),
      status: node.status as AiTimelineWorkNodeListItem['status'],
      approvalPolicy: node.approvalPolicy as AiTimelineWorkNodeListItem['approvalPolicy'],
      baseSummary: node.baseSummary,
      workingSummary: node.workingSummary,
      })),
    };
    applyListResponse(next);
    return next;
  };

  const checkoutNode = async (nodeId: string) => {
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
        timelineId,
        targetType: 'work-node',
        targetId: nodeId,
        updatedAt: Date.now(),
      });
      await reloadNodes();
  };

  const createNodeFromCurrent = async (parentNodeId: string | null, labelPrefix: string) => {
    try {
      setError('');
      const createdAt = Date.now();
      const entry = enqueueMainWorkbenchCommand({
        op: 'createAiTimelineWorkNodeFromCurrent',
        timelineId,
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

  const handleDeleteSubtree = async (node: WorkNodeTreeViewModel['flatNodes'][number]) => {
    const subtreeNodeIds = collectSubtreeNodeIds(node);
    const confirmed = window.confirm(`删除节点 "${node.title}" 及其 ${subtreeNodeIds.length - 1} 个子节点？`);
    if (!confirmed) return;
    try {
      setError('');
      const repository = createTimelineRepositoryClient();
      const checkoutRef = await repository.getCheckoutRef(timelineId);
      const checkoutTargetId = resolveCheckoutTargetBeforeWorkNodeDeletion({
        deletedNodeIds: subtreeNodeIds,
        persistedCheckoutNodeId: checkoutRef?.targetType === 'work-node' ? checkoutRef.targetId : '',
        selectedNodeId,
        parentNodeId: node.parentNodeId || '',
      });
      if (checkoutTargetId === null) {
        throw new Error('待删除子树包含当前 Checkout，且没有可承接 Checkout 的父节点或其他分支。');
      }
      if (checkoutTargetId) {
        await checkoutNode(checkoutTargetId);
      }
      await repository.deleteWorkNode(node.nodeId);
      await reloadNodes();
      onSelectedNodeChange?.(null);
    } catch (deleteError) {
      setError(`删除节点失败：${errorMessage(deleteError)}。`);
    }
  };

  const moveCheckoutBeforeOmission = async (omittedNodeIds: string[], predecessorNodeId: string) => {
    const checkoutRef = await createTimelineRepositoryClient().getCheckoutRef(timelineId);
    if (checkoutRef?.targetType === 'work-node' && omittedNodeIds.includes(checkoutRef.targetId)) {
      await checkoutNode(predecessorNodeId);
    }
  };

  const handleOmitNode = async (node: WorkNodeTreeViewModel['flatNodes'][number]) => {
    let plan;
    try {
      plan = planWorkNodePathOmission(topologyNodes, node.nodeId);
    } catch (planError) {
      setError(errorMessage(planError));
      return;
    }
    const confirmed = window.confirm(
      `省略节点 "${node.title}"？其 ${plan.boundaryChildNodeIds.length} 条后续路径会直接接到父节点，节点内容及其提交记录将被删除。`,
    );
    if (!confirmed) return;
    try {
      setError('');
      await moveCheckoutBeforeOmission(plan.omittedNodeIds, plan.predecessorNodeId);
      const result = await createTimelineRepositoryClient().omitWorkNodePath({
        timelineId,
        firstNodeId: node.nodeId,
      });
      await reloadNodes();
      onSelectedNodeChange?.(null);
      onOmissionComplete?.(result.omittedNodeIds.length);
    } catch (omitError) {
      setError(`省略节点失败：${errorMessage(omitError)}。`);
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

  const selectOmissionEndpoint = (nodeId: string) => {
    if (omissionBusy) return;
    if (!omissionAnchorNodeId || omissionEndNodeId) {
      setOmissionAnchorNodeId(nodeId);
      setOmissionEndNodeId('');
      setOmissionError('');
      return;
    }
    if (nodeId === omissionAnchorNodeId) {
      setOmissionAnchorNodeId('');
      setOmissionEndNodeId('');
      setOmissionError('');
      return;
    }
    try {
      planWorkNodePathOmission(topologyNodes, omissionAnchorNodeId, nodeId);
      setOmissionEndNodeId(nodeId);
      setOmissionError('');
    } catch (planError) {
      setOmissionError(planError instanceof Error ? planError.message : '所选节点不能组成可省略路径。');
    }
  };

  const applyOmissionMarqueeSelection = (selectedNodeIds: string[]) => {
    try {
      const plan = planWorkNodePathOmissionFromSelection(topologyNodes, selectedNodeIds);
      setOmissionAnchorNodeId(plan.omittedNodeIds[0]);
      setOmissionEndNodeId(plan.omittedNodeIds[plan.omittedNodeIds.length - 1]);
      setOmissionError('');
    } catch (selectionError) {
      setOmissionAnchorNodeId('');
      setOmissionEndNodeId('');
      setOmissionError(
        selectionError instanceof Error
          ? selectionError.message
          : '框选节点不能组成可省略路径。',
      );
    }
  };

  const selectNode = (nodeId: string) => {
    if (omissionMode) {
      selectOmissionEndpoint(nodeId);
      return;
    }
    setSelectedNodeId(nodeId);
    const node = viewModel.flatNodes.find((item) => item.nodeId === nodeId);
    if (node) {
      onSelectedNodeChange?.({
        nodeId: node.nodeId,
        name: node.title,
        description: node.description,
      });
    }
  };

  const confirmOmission = async () => {
    if (!omissionPlan || omissionBusy) return;
    const startNode = viewModel.flatNodes.find((node) => node.nodeId === omissionPlan.omittedNodeIds[0]);
    const lastOmittedNodeId = omissionPlan.omittedNodeIds[omissionPlan.omittedNodeIds.length - 1];
    const endNode = viewModel.flatNodes.find((node) => node.nodeId === lastOmittedNodeId);
    const confirmed = window.confirm(
      `省略 ${omissionPlan.omittedNodeIds.length} 个节点（${startNode?.title || '起点'} → ${endNode?.title || '终点'}）？后续路径会直接接到父节点，此操作不能撤销。`,
    );
    if (!confirmed) return;
    setOmissionBusy(true);
    setOmissionError('');
    try {
      await moveCheckoutBeforeOmission(omissionPlan.omittedNodeIds, omissionPlan.predecessorNodeId);
      const result = await createTimelineRepositoryClient().omitWorkNodePath({
        timelineId,
        firstNodeId: omissionPlan.omittedNodeIds[0],
        secondNodeId: lastOmittedNodeId,
      });
      await reloadNodes();
      resetOmission();
      onSelectedNodeChange?.(null);
      onOmissionComplete?.(result.omittedNodeIds.length);
    } catch (omitError) {
      setOmissionError(`省略路径失败：${errorMessage(omitError)}。`);
      setOmissionBusy(false);
    }
  };

  useImperativeHandle(ref, () => ({
    confirmOmission,
    resetOmission,
  }), [confirmOmission]);

  // Ordinary selection is deferred until close. Deletion is ordered explicitly:
  // move a checkout out of the target subtree, wait for persistence, then delete.

  const handleCanvasPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (event.button !== 0 || target.closest('.work-node-tree-node-shell, .work-node-tree-count, .work-node-tree-empty')) return;
    if (omissionMode && !event.altKey) {
      omissionMarqueeDragRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        currentClientX: event.clientX,
        currentClientY: event.clientY,
      };
      const bounds = event.currentTarget.getBoundingClientRect();
      setOmissionMarquee({
        left: event.clientX - bounds.left + event.currentTarget.scrollLeft,
        top: event.clientY - bounds.top + event.currentTarget.scrollTop,
        width: 0,
        height: 0,
      });
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cameraX: cameraRef.current.x,
      cameraY: cameraRef.current.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleCanvasPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const marqueeDrag = omissionMarqueeDragRef.current;
    if (marqueeDrag?.pointerId === event.pointerId) {
      marqueeDrag.currentClientX = event.clientX;
      marqueeDrag.currentClientY = event.clientY;
      const bounds = event.currentTarget.getBoundingClientRect();
      const left = Math.min(marqueeDrag.startClientX, event.clientX) - bounds.left
        + event.currentTarget.scrollLeft;
      const top = Math.min(marqueeDrag.startClientY, event.clientY) - bounds.top
        + event.currentTarget.scrollTop;
      setOmissionMarquee({
        left,
        top,
        width: Math.abs(event.clientX - marqueeDrag.startClientX),
        height: Math.abs(event.clientY - marqueeDrag.startClientY),
      });
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    cameraRef.current = {
      x: drag.cameraX + event.clientX - drag.startX,
      y: drag.cameraY + event.clientY - drag.startY,
      zoom: cameraRef.current.zoom,
    };
    if (cameraFrameRef.current !== null) return;
    cameraFrameRef.current = window.requestAnimationFrame(() => {
      cameraFrameRef.current = null;
      const canvas = treeCanvasRef.current;
      if (!canvas) return;
      const next = cameraRef.current;
      canvas.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.zoom})`;
    });
  };

  const stopCanvasDrag = (event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const marqueeDrag = omissionMarqueeDragRef.current;
    if (marqueeDrag?.pointerId === event.pointerId) {
      omissionMarqueeDragRef.current = null;
      setOmissionMarquee(null);
      if (!cancelled) {
        const left = Math.min(marqueeDrag.startClientX, marqueeDrag.currentClientX);
        const right = Math.max(marqueeDrag.startClientX, marqueeDrag.currentClientX);
        const top = Math.min(marqueeDrag.startClientY, marqueeDrag.currentClientY);
        const bottom = Math.max(marqueeDrag.startClientY, marqueeDrag.currentClientY);
        if (right - left >= 5 || bottom - top >= 5) {
          const selectedNodeIds = [...event.currentTarget.querySelectorAll<HTMLElement>(
            '.work-node-tree-node-shell[data-work-node-id]',
          )].flatMap((element) => {
            const bounds = element.getBoundingClientRect();
            const centerX = bounds.left + bounds.width / 2;
            const centerY = bounds.top + bounds.height / 2;
            const nodeId = element.dataset.workNodeId;
            return nodeId && centerX >= left && centerX <= right && centerY >= top && centerY <= bottom
              ? [nodeId]
              : [];
          });
          applyOmissionMarqueeSelection(selectedNodeIds);
        }
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (cameraFrameRef.current !== null) {
      window.cancelAnimationFrame(cameraFrameRef.current);
      cameraFrameRef.current = null;
    }
    const next = cameraRef.current;
    if (treeCanvasRef.current) {
      treeCanvasRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.zoom})`;
    }
    setCamera(next);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleCanvasWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    const current = cameraRef.current;
    const zoomFactor = Math.exp(-event.deltaY * 0.0015);
    const zoom = Math.min(2, Math.max(0.4, current.zoom * zoomFactor));
    if (Math.abs(zoom - current.zoom) < 0.0001) return;
    const worldX = (pointerX - current.x) / current.zoom;
    const worldY = (pointerY - current.y) / current.zoom;
    cameraRef.current = {
      x: pointerX - worldX * zoom,
      y: pointerY - worldY * zoom,
      zoom,
    };
    if (cameraFrameRef.current !== null) return;
    cameraFrameRef.current = window.requestAnimationFrame(() => {
      cameraFrameRef.current = null;
      const canvas = treeCanvasRef.current;
      if (!canvas) return;
      const next = cameraRef.current;
      canvas.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.zoom})`;
    });
    if (cameraCommitTimerRef.current !== null) window.clearTimeout(cameraCommitTimerRef.current);
    cameraCommitTimerRef.current = window.setTimeout(() => {
      cameraCommitTimerRef.current = null;
      setCamera(cameraRef.current);
    }, 120);
  };

  return (
    <div
      className={`work-node-tree-panel${omissionMode ? ' is-omission-mode' : ''}`}
      aria-label={`Work node 节点树，${viewModel.nodeCount} 节点，${viewModel.riskCount} 风险`}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handleCanvasPointerMove}
      onPointerUp={(event) => stopCanvasDrag(event)}
      onPointerCancel={(event) => stopCanvasDrag(event, true)}
      onWheel={handleCanvasWheel}
    >
      {omissionMarquee ? (
        <div
          className="work-node-tree-omission-marquee"
          style={omissionMarquee}
          aria-hidden="true"
        />
      ) : null}
      <div className="work-node-tree-count">{viewModel.nodeCount} 节点 / {viewModel.riskCount} 风险 · {Math.round(camera.zoom * 100)}%</div>
      {selectedNode ? (
        <aside className="work-node-tree-detail" aria-label="Selected Work Node details">
          <strong>{selectedNode.label}</strong>
          {selectedNode.description ? <span>说明：{selectedNode.description}</span> : null}
          <span>基线：{selectedNode.baseSummary?.characterCount ?? 0} 干员 / {selectedNode.baseSummary?.buttonCount ?? 0} 按钮 / {selectedNode.baseSummary?.buffCount ?? 0} Buff</span>
          <span>草稿：{selectedNode.workingSummary?.characterCount ?? 0} 干员 / {selectedNode.workingSummary?.buttonCount ?? 0} 按钮 / {selectedNode.workingSummary?.buffCount ?? 0} Buff</span>
          <span>状态：{selectedNode.status} · 策略：{selectedNode.approvalPolicy}</span>
          {selectedNode.riskFlags.length ? <span>风险：{selectedNode.riskFlags.map((risk) => risk.message || risk.code).join('；')}</span> : <span>风险：无</span>}
          {selectedNodePatches[0] ? (
            <span>最近 Patch：{selectedNodePatches[0].patch.length} 项操作 · 校验 {selectedNodePatches[0].validation.ok === false ? '失败' : '通过'} · {Object.entries(selectedNodePatches[0].diffSummary).filter(([, value]) => Number(value) > 0).map(([key, value]) => `${key}:${value}`).join(' / ') || '无结构变化'}</span>
          ) : <span>最近 Patch：暂无</span>}
          {selectedNodeAuditEvents[0]
            ? <span>最近审计：{selectedNodeAuditEvents[0].eventType} · {new Date(selectedNodeAuditEvents[0].createdAt).toLocaleString()}</span>
            : selectedNode.logs[0] ? <span>最近日志：{selectedNode.logs[0].message}</span> : <span>最近审计：暂无</span>}
        </aside>
      ) : null}
      {error ? <div className="work-node-tree-empty">{error}</div> : null}
      {!error && loading && viewModel.nodeCount === 0 ? <div className="work-node-tree-empty">正在读取节点</div> : null}
      {!error && !loading && viewModel.nodeCount === 0 ? <div className="work-node-tree-empty">暂无可见节点</div> : null}
      <div
        ref={treeCanvasRef}
        className="work-node-tree-canvas"
        style={{
          width: treeLayout.width,
          height: treeLayout.height,
          transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.zoom})`,
          transformOrigin: '0 0',
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
            const omissionChildIndex = connector.childNodeIds.findIndex((nodeId) => omissionSelectedNodeIds.has(nodeId));
            const isOmissionSegment = omissionSelectedNodeIds.has(connector.parentNodeId) && omissionChildIndex >= 0;
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
                  {isOmissionSegment ? (
                    <line
                      className="is-omission-path"
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
                {isOmissionSegment ? (
                  <>
                    <line className="is-omission-path" x1={connector.parentX} y1={connector.parentBottom} x2={connector.parentX} y2={branchY} />
                    <line className="is-omission-path" x1={connector.parentX} y1={branchY} x2={connector.childXs[omissionChildIndex]} y2={branchY} />
                    <line className="is-omission-path" x1={connector.childXs[omissionChildIndex]} y1={branchY} x2={connector.childXs[omissionChildIndex]} y2={connector.childTop} />
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
            isOmissionMode={omissionMode}
            isOmissionSelected={omissionSelectedNodeIds.has(node.nodeId)}
            canOmit={omissionAvailability.get(node.nodeId)?.canOmit === true}
            omitDisabledReason={omissionAvailability.get(node.nodeId)?.reason}
            x={x}
            y={y}
            onSelect={(target) => selectNode(target.nodeId)}
            onDeleteSubtree={handleDeleteSubtree}
            onOmit={handleOmitNode}
            onAddChild={(target) => void createNodeFromCurrent(target.nodeId, 'child')}
            onAddSibling={(target) => void createNodeFromCurrent(target.parentNodeId || null, 'branch')}
            onForkAsSqlite={(target) => onForkAsSqlite?.({
              nodeId: target.nodeId,
              name: target.title,
              description: target.description,
            })}
            onRename={handleRename}
          />
        ))}
      </div>
    </div>
  );
});
