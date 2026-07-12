export type PersistedWorkbenchAiMessage = {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  status?: unknown;
  prompt?: string;
};

export function mergeWorkbenchAiHistory<T extends PersistedWorkbenchAiMessage>(
  existing: T[],
  incoming: T[],
  limit = 200,
  alignRecalledTranscript = false,
): T[] {
  const clean = (messages: T[]) => messages.filter((message) => (
    Boolean(message?.id && message.text?.trim()) && message.id !== 'system-ready'
  ));
  const left = clean(existing);
  const right = clean(incoming);
  const key = (message: T) => `${message.role}\u0000${message.text.trim().replace(/\s+/g, ' ')}`;

  if (!alignRecalledTranscript) {
    const merged = [...left];
    const indexById = new Map(merged.map((message, index) => [message.id, index]));
    for (const message of right) {
      const existingIndex = indexById.get(message.id);
      if (existingIndex === undefined) {
        indexById.set(message.id, merged.length);
        merged.push(message);
      } else {
        merged[existingIndex] = { ...merged[existingIndex], ...message };
      }
    }
    return merged.slice(-Math.max(1, limit));
  }

  // Local optimistic messages and the persisted OpenCode transcript use
  // different ids for the same turns. Align both ordered sequences with LCS
  // so repeated wording in separate turns remains distinct while the same
  // recalled transcript is not rendered twice.
  const lengths = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      lengths[leftIndex][rightIndex] = key(left[leftIndex]) === key(right[rightIndex])
        ? lengths[leftIndex + 1][rightIndex + 1] + 1
        : Math.max(lengths[leftIndex + 1][rightIndex], lengths[leftIndex][rightIndex + 1]);
    }
  }

  const matchedRight = new Set<number>();
  const merged = [...left];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex].id === right[rightIndex].id || key(left[leftIndex]) === key(right[rightIndex])) {
      merged[leftIndex] = { ...left[leftIndex], ...right[rightIndex], id: left[leftIndex].id };
      matchedRight.add(rightIndex);
      leftIndex += 1;
      rightIndex += 1;
    } else if (lengths[leftIndex + 1][rightIndex] >= lengths[leftIndex][rightIndex + 1]) {
      leftIndex += 1;
    } else {
      rightIndex += 1;
    }
  }
  right.forEach((message, index) => {
    if (!matchedRight.has(index) && !merged.some((entry) => entry.id === message.id)) merged.push(message);
  });
  return merged.slice(-Math.max(1, limit));
}

export function resolveRecalledWorkbenchAiHistory<T extends PersistedWorkbenchAiMessage>(
  cached: T[],
  transcript: T[],
): T[] {
  const recalled = transcript.filter((message) => message?.id && message.text?.trim() && message.id !== 'system-ready');
  return recalled.length > 0 ? recalled : cached;
}
