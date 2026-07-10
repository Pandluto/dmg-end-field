import type { MainWorkbenchCommand } from '../../utils/mainWorkbenchControl';

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
  return {
    op: 'createAiTimelineWorkNodeFromCurrent',
    branchId: `manual-checkpoint-${timestamp}`,
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
  return {
    op: 'createAiTimelineWorkNodeFromCurrent',
    branchId: `ai-turn-${input.messageId}`,
    label: `[ai-turn] ${compactText(input.prompt) || input.messageId} ${formatTimestamp(timestamp)}`,
    approvalPolicy: 'auto-low-risk',
  };
}
