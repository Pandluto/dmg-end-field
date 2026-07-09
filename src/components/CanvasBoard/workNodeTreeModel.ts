import type {
  AiTimelineWorkNode,
  AiTimelineWorkNodeCommit,
  TimelinePayloadDiffSummary,
  TimelinePayloadSummary,
} from '../../agentKernel/timelineWorktree/types';
import { diffTimelinePayloads } from '../../agentKernel/timelineWorktree/diff';
import type { WorkNodeTreeNode, WorkNodeTreeSource, WorkNodeTreeStatus, WorkNodeTreeViewModel } from './workNodeTreeTypes';

function formatPayloadSummary(summary?: TimelinePayloadSummary) {
  if (!summary) return '无 payload 摘要';
  return `${summary.characterCount} 干员 · ${summary.buttonCount} 按钮 · ${summary.buffCount} Buff`;
}

function formatDiffSummary(summary?: TimelinePayloadDiffSummary) {
  if (!summary) return '未生成差异';
  const parts = [
    summary.addedButtonCount ? `+${summary.addedButtonCount} 按钮` : '',
    summary.removedButtonCount ? `-${summary.removedButtonCount} 按钮` : '',
    summary.changedButtonCount ? `${summary.changedButtonCount} 按钮变更` : '',
    summary.addedBuffCount ? `+${summary.addedBuffCount} Buff` : '',
    summary.removedBuffCount ? `-${summary.removedBuffCount} Buff` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'base 与 working 一致';
}

function hasLog(node: AiTimelineWorkNode, pattern: RegExp) {
  return (node.logs || []).some((log) => pattern.test(log.message || ''));
}

function inferSource(node: AiTimelineWorkNode, hasCheckout: boolean): WorkNodeTreeSource {
  const label = node.label || '';
  if (/manual-checkpoint|进入 AI 模式前|人工基线/i.test(label)) return 'manual-checkpoint';
  if (node.status === 'abandoned') return 'discard';
  if (hasLog(node, /Rolled back|restore_base|basePayload|回退|恢复/i)) return 'restore';
  if (hasCheckout || node.status === 'applied' || hasLog(node, /Applied AI timeline work node checkout|checkout/i)) return 'checkout';
  return 'ai-turn';
}

function inferStatus(node: AiTimelineWorkNode, source: WorkNodeTreeSource, hasCheckout: boolean): WorkNodeTreeStatus {
  if (source === 'restore') return 'restored';
  if (source === 'discard' || node.status === 'abandoned') return 'discarded';
  if (source === 'checkout' || hasCheckout || node.status === 'applied') return 'checked-out';
  if ((node.riskFlags || []).some((risk) => risk.severity === 'blocker')) return 'blocked';
  if (node.status === 'ready' || node.status === 'committed') return 'validated';
  return 'draft';
}

function extractMessageId(node: AiTimelineWorkNode) {
  const haystack = `${node.id} ${node.branchId} ${node.label}`;
  const match = /\b(workbench-ai-\d+|workbench-test-\d+|msg[-_a-zA-Z0-9]+)\b/.exec(haystack);
  return match?.[1];
}

function extractConversationId(node: AiTimelineWorkNode) {
  const haystack = `${node.branchId} ${node.label}`;
  const match = /\b(ses[-_a-zA-Z0-9]+|session[-_a-zA-Z0-9]+)\b/.exec(haystack);
  return match?.[1];
}

function buildNodeTitle(node: AiTimelineWorkNode, source: WorkNodeTreeSource) {
  const cleaned = (node.label || node.id)
    .replace(/^\[(manual-checkpoint|ai-turn|checkout|restore|discard)\]\s*/i, '')
    .trim();
  if (cleaned) return cleaned;
  if (source === 'manual-checkpoint') return '进入 AI 模式前';
  if (source === 'checkout') return '已应用节点';
  if (source === 'restore') return '已恢复节点基线';
  return 'AI 对话节点';
}

function makePayloadRef(kind: 'base' | 'working', node: AiTimelineWorkNode) {
  return `${node.id}:${kind}:${node.updatedAt || node.createdAt || 0}`;
}

export function buildWorkNodeTreeViewModel(
  nodes: AiTimelineWorkNode[],
  commits: AiTimelineWorkNodeCommit[],
): WorkNodeTreeViewModel {
  const checkoutNodeIds = new Set(commits.filter((commit) => commit.checkoutApplied).map((commit) => commit.nodeId));
  const flatNodes = nodes
    .map((node): WorkNodeTreeNode => {
      const hasCheckout = checkoutNodeIds.has(node.id);
      const source = inferSource(node, hasCheckout);
      const status = inferStatus(node, source, hasCheckout);
      const diff = diffTimelinePayloads(node.basePayload, node.workingPayload);
      return {
        nodeId: node.id,
        source,
        title: buildNodeTitle(node, source),
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
        status,
        summary: `${formatPayloadSummary(node.baseSummary)} -> ${formatPayloadSummary(node.workingSummary)}`,
        diffSummary: formatDiffSummary(diff.summary),
        riskFlags: (node.riskFlags || []).map((risk) => `${risk.severity}: ${risk.message || risk.code}`),
        conversationId: extractConversationId(node),
        messageId: extractMessageId(node),
        checkoutTouched: status === 'checked-out' || status === 'restored',
        basePayloadRef: makePayloadRef('base', node),
        workingPayloadRef: makePayloadRef('working', node),
        children: [],
      };
    })
    .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));

  return {
    nodes: flatNodes,
    flatNodes,
    latestNode: flatNodes[0],
    nodeCount: flatNodes.length,
    riskCount: flatNodes.reduce((total, node) => total + node.riskFlags.length, 0),
  };
}
