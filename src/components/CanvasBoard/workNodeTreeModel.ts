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
  return `${summary.characterCount} 干员 / ${summary.buttonCount} 按钮 / ${summary.buffCount} Buff`;
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
  return parts.length ? parts.join(' / ') : 'base 与 working 一致';
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function payloadSignature(value: unknown): string {
  return hashText(stableStringify(value));
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

type WorkNodeAssembly = {
  node: WorkNodeTreeNode;
  raw: AiTimelineWorkNode;
  baseSignature: string;
  workingSignature: string;
};

function findParentNode(current: WorkNodeAssembly, previousNodes: WorkNodeAssembly[]): WorkNodeAssembly | undefined {
  const previousNode = previousNodes[previousNodes.length - 1];
  if (!previousNode) {
    return undefined;
  }

  if (previousNode.workingSignature === current.baseSignature) {
    return previousNode;
  }

  const explicitOlderBaseParent = [...previousNodes]
    .reverse()
    .find((candidate) =>
      candidate.workingSignature === current.baseSignature
    );
  if (explicitOlderBaseParent) {
    return explicitOlderBaseParent;
  }

  return previousNode;
}

export function buildWorkNodeTreeViewModel(
  nodes: AiTimelineWorkNode[],
  commits: AiTimelineWorkNodeCommit[],
): WorkNodeTreeViewModel {
  const checkoutNodeIds = new Set(commits.filter((commit) => commit.checkoutApplied).map((commit) => commit.nodeId));
  const assemblies = [...nodes]
    .sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0))
    .map((node): WorkNodeAssembly => {
      const hasCheckout = checkoutNodeIds.has(node.id);
      const source = inferSource(node, hasCheckout);
      const status = inferStatus(node, source, hasCheckout);
      const diff = diffTimelinePayloads(node.basePayload, node.workingPayload);
      return {
        raw: node,
        baseSignature: payloadSignature(node.basePayload),
        workingSignature: payloadSignature(node.workingPayload),
        node: {
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
        },
      };
    });

  const roots: WorkNodeTreeNode[] = [];
  const previousNodes: WorkNodeAssembly[] = [];

  assemblies.forEach((assembly) => {
    const parent = findParentNode(assembly, previousNodes);
    if (parent) {
      assembly.node.parentNodeId = parent.node.nodeId;
      parent.node.children.push(assembly.node);
    } else {
      roots.push(assembly.node);
    }
    previousNodes.push(assembly);
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
