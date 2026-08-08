import type {
  ConversationCompactionPart,
  ConversationMessage,
  ConversationPart,
  ConversationSnapshot,
  ConversationToolPart,
  ConversationToolState,
} from '../../../agent/core/contracts/conversation.ts';

/**
 * OpenCode provenance: the turn/part ordering follows
 * @opencode-ai/session-ui 1.17.11, upstream commit
 * 67aec2212010d67775c35e696d8b8b54902eb338, locally available at commit
 * 7f06b1d3 under agent/vendor/opencode/packages/session-ui.  The source
 * package is MIT licensed.  This file contains only the DEF read-model
 * adapter; it does not import an OpenCode client, SDK, or global store.
 */

export interface ConversationTurnView {
  readonly turnId: ConversationMessage['defTurnId'];
  readonly messages: readonly ConversationMessage[];
  readonly userMessage: ConversationMessage | undefined;
  readonly assistantMessages: readonly ConversationMessage[];
  readonly compactionParts: readonly ConversationCompactionPart[];
  readonly partsByMessage: ReadonlyMap<string, readonly ConversationPart[]>;
}

export function selectConversationTurns(
  snapshot: ConversationSnapshot | null,
  requestedTurnId?: ConversationMessage['defTurnId'],
): readonly ConversationTurnView[] {
  if (!snapshot || snapshot.messages.length === 0) return [];
  if (requestedTurnId) {
    const selected = selectConversationTurn(snapshot, requestedTurnId);
    return selected ? [selected] : [];
  }
  const seen = new Set<ConversationMessage['defTurnId']>();
  const turns: ConversationTurnView[] = [];
  for (const message of snapshot.messages) {
    if (seen.has(message.defTurnId)) continue;
    seen.add(message.defTurnId);
    const turn = selectConversationTurn(snapshot, message.defTurnId);
    if (turn) turns.push(turn);
  }
  return turns;
}

export function selectConversationTurn(
  snapshot: ConversationSnapshot | null,
  requestedTurnId?: ConversationMessage['defTurnId'],
): ConversationTurnView | null {
  if (!snapshot || snapshot.messages.length === 0) return null;
  const lastMessage = snapshot.messages[snapshot.messages.length - 1];
  const turnId = requestedTurnId ?? lastMessage?.defTurnId;
  if (!turnId) return null;

  // Runtime and Host deltas can cross in flight. createdAt is durable and
  // preserves the transcript while the merged message index converges.
  const messages = snapshot.messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.defTurnId === turnId)
    .sort((left, right) => left.message.createdAt.localeCompare(right.message.createdAt) || left.index - right.index)
    .map(({ message }) => message);
  if (messages.length === 0) return null;
  const partById = new Map(snapshot.parts.map((part) => [part.id, part] as const));
  const partsByMessage = new Map<string, readonly ConversationPart[]>();

  for (const message of messages) {
    const ordered = message.partIds
      .map((partId) => partById.get(partId))
      .filter((part): part is ConversationPart => part?.messageId === message.id);
    const unlisted = snapshot.parts.filter(
      (part) => part.messageId === message.id && !message.partIds.includes(part.id),
    );
    partsByMessage.set(message.id, [...ordered, ...unlisted]);
  }

  const compactionParts = messages
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => partsByMessage.get(message.id) ?? [])
    .filter((part): part is ConversationCompactionPart => part.type === 'compaction');

  return {
    turnId,
    messages,
    userMessage: messages.find((message) => message.role === 'user'),
    assistantMessages: messages.filter((message) => message.role === 'assistant'),
    compactionParts,
    partsByMessage,
  };
}

export function orderedPartsForMessage(
  turn: ConversationTurnView,
  message: ConversationMessage,
): readonly ConversationPart[] {
  return turn.partsByMessage.get(message.id) ?? [];
}

export function assistantPartsForMessage(
  turn: ConversationTurnView,
  message: ConversationMessage,
): readonly ConversationPart[] {
  return orderedPartsForMessage(turn, message).filter((part) => part.type !== 'compaction' && part.type !== 'file');
}

export function textPartsForMessage(
  turn: ConversationTurnView,
  message: ConversationMessage,
): readonly Extract<ConversationPart, { type: 'text' }>[] {
  return orderedPartsForMessage(turn, message).filter(
    (part): part is Extract<ConversationPart, { type: 'text' }> => part.type === 'text',
  );
}

export function lastAssistantTextPartId(turn: ConversationTurnView): string | null {
  for (let messageIndex = turn.assistantMessages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = turn.assistantMessages[messageIndex];
    if (!message) continue;
    const parts = assistantPartsForMessage(turn, message);
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex];
      if (part?.type === 'text' && part.text.trim()) return part.id;
    }
  }
  return null;
}

export function isActiveSessionStatus(snapshot: ConversationSnapshot | null): boolean {
  if (!snapshot) return false;
  return snapshot.status.status === 'running'
    || snapshot.status.status === 'waiting-tool'
    || snapshot.status.status === 'waiting-interaction'
    || snapshot.status.status === 'compacting';
}

export function isActiveToolState(state: ConversationToolState): boolean {
  return state.status === 'pending' || state.status === 'running';
}

export function toolCanExpand(state: ConversationToolState): boolean {
  return state.status === 'completed' || state.status === 'error';
}

export function toolDisplayTitle(part: ConversationToolPart): string {
  return `Called ${part.name}`;
}

export function toolDisplaySubtitle(part: ConversationToolPart): string | undefined {
  if (part.state.status === 'completed') return undefined;
  if (part.state.status === 'error') return part.state.message;
  if (part.state.status === 'running') return part.state.title;
  return undefined;
}

export function toolInputLabel(part: ConversationToolPart): string | undefined {
  const input = part.state.input;
  const preferred = ['description', 'query', 'url', 'filePath', 'path', 'pattern', 'name'];
  for (const key of preferred) {
    const value = input[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

export function toolArgumentLabels(part: ConversationToolPart): readonly string[] {
  const skip = new Set(['description', 'query', 'url', 'filePath', 'path', 'pattern', 'name']);
  return Object.entries(part.state.input)
    .filter(([key]) => !skip.has(key))
    .flatMap(([key, value]) => {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return [`${key}=${String(value)}`];
      }
      return [];
    })
    .slice(0, 3);
}

export function jsonInline(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

export function isPinnedToBottom(element: Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'>, threshold = 48): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

export function scrollElementToBottom(element: Pick<HTMLElement, 'scrollHeight'> & { scrollTop: number }): void {
  element.scrollTop = element.scrollHeight;
}
