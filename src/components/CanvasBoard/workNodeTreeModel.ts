import type {
  AiTimelineWorkNodeCommitListItem,
  AiTimelineWorkNodeListItem,
  TimelinePayloadDiffSummary,
  TimelinePayloadSummary,
} from '../../agentKernel/timelineWorktree/types';
import type { WorkNodeTreeNode, WorkNodeTreeSource, WorkNodeTreeStatus, WorkNodeTreeViewModel } from './workNodeTreeTypes';

function formatPayloadSummary(summary?: TimelinePayloadSummary) {
  if (!summary) return '无 payload 摘要';
  return `${summary.characterCount} 干员 / ${summary.buttonCount} 按钮 / ${summary.buffCount} Buff`;
}

function formatDiffSummary(summary?: TimelinePayloadDiffSummary) {
  if (!summary) return '未计算差异';
  const parts = [
    summary.addedButtonCount ? `+${summary.addedButtonCount} 按钮` : '',
    summary.removedButtonCount ? `-${summary.removedButtonCount} 按钮` : '',
    summary.changedButtonCount ? `${summary.changedButtonCount} 按钮变更` : '',
    summary.addedBuffCount ? `+${summary.addedBuffCount} Buff` : '',
    summary.removedBuffCount ? `-${summary.removedBuffCount} Buff` : '',
    summary.changedCharacterInputCount ? `${summary.changedCharacterInputCount} 干员配装变更` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' / ') : 'base 与 working 一致';
}

function hasLog(node: AiTimelineWorkNodeListItem, pattern: RegExp) {
  return (node.logs || []).some((log) => pattern.test(log.message || ''));
}

function inferSource(node: AiTimelineWorkNodeListItem, hasCheckout: boolean): WorkNodeTreeSource {
  const label = node.label || '';
  if (/manual-checkpoint|进入 AI 模式前|人工基线/i.test(label)) return 'manual-checkpoint';
  if (node.status === 'abandoned') return 'discard';
  if (hasLog(node, /Rolled back|restore_base|basePayload|回退|恢复/i)) return 'restore';
  if (hasCheckout || node.status === 'applied' || hasLog(node, /Applied AI timeline work node checkout|checkout/i)) return 'checkout';
  return 'ai-turn';
}

function inferStatus(node: AiTimelineWorkNodeListItem, source: WorkNodeTreeSource, hasCheckout: boolean): WorkNodeTreeStatus {
  if (source === 'restore') return 'restored';
  if (source === 'discard' || node.status === 'abandoned') return 'discarded';
  if (source === 'checkout' || hasCheckout || node.status === 'applied') return 'checked-out';
  if ((node.riskFlags || []).some((risk) => risk.severity === 'blocker')) return 'blocked';
  if (node.status === 'ready' || node.status === 'committed') return 'validated';
  return 'draft';
}

function extractMessageId(node: AiTimelineWorkNodeListItem) {
  const haystack = `${node.id} ${node.branchId} ${node.label}`;
  const match = /\b(workbench-ai-\d+|workbench-test-\d+|msg[-_a-zA-Z0-9]+)\b/.exec(haystack);
  return match?.[1];
}

function extractConversationId(node: AiTimelineWorkNodeListItem) {
  const haystack = `${node.branchId} ${node.label}`;
  const match = /\b(ses[-_a-zA-Z0-9]+|session[-_a-zA-Z0-9]+)\b/.exec(haystack);
  return match?.[1];
}

function buildNodeTitle(node: AiTimelineWorkNodeListItem, source: WorkNodeTreeSource) {
  const cleaned = (node.label || node.id)
    .replace(/^\[(manual-checkpoint|ai-turn|checkout|restore|discard)\]\s*/i, '')
    .trim();
  if (cleaned) return cleaned;
  if (source === 'manual-checkpoint') return '进入 AI 模式前';
  if (source === 'checkout') return '已应用节点';
  if (source === 'restore') return '已恢复节点基线';
  return 'AI 对话节点';
}

function makePayloadRef(kind: 'base' | 'working', node: AiTimelineWorkNodeListItem) {
  return `${node.id}:${kind}:${node.updatedAt || node.createdAt || 0}`;
}

export function buildWorkNodeTreeViewModel(
  nodes: AiTimelineWorkNodeListItem[],
  commits: AiTimelineWorkNodeCommitListItem[],
): WorkNodeTreeViewModel {
  const checkoutNodeIds = new Set(commits.filter((commit) => commit.checkoutApplied).map((commit) => commit.nodeId));
  const sortedNodes = [...nodes].sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));
  const roots: WorkNodeTreeNode[] = [];
  const byId = new Map<string, WorkNodeTreeNode>();

  sortedNodes.forEach((rawNode) => {
    const hasCheckout = checkoutNodeIds.has(rawNode.id);
    const source = inferSource(rawNode, hasCheckout);
    const status = inferStatus(rawNode, source, hasCheckout);
    const node: WorkNodeTreeNode = {
      nodeId: rawNode.id,
      parentNodeId: rawNode.parentNodeId || undefined,
      source,
      title: buildNodeTitle(rawNode, source),
      description: rawNode.description || '',
      createdAt: rawNode.createdAt,
      updatedAt: rawNode.updatedAt,
      status,
      summary: `${formatPayloadSummary(rawNode.baseSummary)} -> ${formatPayloadSummary(rawNode.workingSummary)}`,
      diffSummary: formatDiffSummary(undefined),
      riskFlags: (rawNode.riskFlags || []).map((risk) => `${risk.severity}: ${risk.message || risk.code}`),
      conversationId: extractConversationId(rawNode),
      messageId: extractMessageId(rawNode),
      checkoutTouched: status === 'checked-out' || status === 'restored',
      buttonCount: rawNode.workingSummary?.buttonCount ?? rawNode.baseSummary?.buttonCount ?? 0,
      buffCount: rawNode.workingSummary?.buffCount ?? rawNode.baseSummary?.buffCount ?? 0,
      basePayloadRef: makePayloadRef('base', rawNode),
      workingPayloadRef: makePayloadRef('working', rawNode),
      children: [],
    };

    byId.set(node.nodeId, node);
  });

  sortedNodes.forEach((rawNode) => {
    const node = byId.get(rawNode.id);
    if (!node) return;
    const parent = node.parentNodeId ? byId.get(node.parentNodeId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      node.parentNodeId = undefined;
      roots.push(node);
    }
  });

  const sortTree = (treeNodes: WorkNodeTreeNode[]) => {
    treeNodes.sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));
    treeNodes.forEach((node) => sortTree(node.children));
  };
  sortTree(roots);

  const flatNodes: WorkNodeTreeNode[] = [];
  const flatten = (treeNodes: WorkNodeTreeNode[]) => {
    treeNodes.forEach((node) => {
      flatNodes.push(node);
      flatten(node.children);
    });
  };
  flatten(roots);

  return {
    nodes: roots,
    flatNodes,
    latestNode: flatNodes.reduce<WorkNodeTreeNode | undefined>((latest, node) => {
      if (!latest) return node;
      return (node.updatedAt || node.createdAt || 0) > (latest.updatedAt || latest.createdAt || 0) ? node : latest;
    }, undefined),
    nodeCount: flatNodes.length,
    riskCount: flatNodes.reduce((total, node) => total + node.riskFlags.length, 0),
  };
}
