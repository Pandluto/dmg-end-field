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
