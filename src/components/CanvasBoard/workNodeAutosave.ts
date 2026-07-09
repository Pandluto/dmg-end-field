import type { MainWorkbenchCommand } from '../../utils/mainWorkbenchControl';
import { readActiveWorkNodeId } from './workNodeSelection';

type CreateWorkNodeCommand = Extract<MainWorkbenchCommand, { op: 'createAiTimelineWorkNodeFromCurrent' }>;

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

function compactText(text: string, maxLength = 28) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}...`;
}

export function buildManualCheckpointCommand(timestamp = Date.now()): CreateWorkNodeCommand {
  const parentNodeId = readActiveWorkNodeId();
  return {
    op: 'createAiTimelineWorkNodeFromCurrent',
    branchId: `manual-checkpoint-${timestamp}`,
    parentNodeId: parentNodeId || undefined,
    label: `[manual-checkpoint] 进入 AI 模式前 ${formatTimestamp(timestamp)}`,
    approvalPolicy: 'auto-low-risk',
  };
}

export function buildAiTurnCheckpointCommand(input: {
  messageId: string;
  prompt: string;
  timestamp?: number;
}): CreateWorkNodeCommand {
  const timestamp = input.timestamp || Date.now();
  const parentNodeId = readActiveWorkNodeId();
  return {
    op: 'createAiTimelineWorkNodeFromCurrent',
    branchId: `ai-turn-${input.messageId}`,
    parentNodeId: parentNodeId || undefined,
    label: `[ai-turn] ${compactText(input.prompt) || input.messageId} ${formatTimestamp(timestamp)}`,
    approvalPolicy: 'auto-low-risk',
  };
}
