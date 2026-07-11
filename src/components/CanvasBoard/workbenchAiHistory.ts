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
): T[] {
  const merged: T[] = [];
  const indexById = new Map<string, number>();
  for (const message of [...existing, ...incoming]) {
    if (!message?.id || !message.text?.trim() || message.id === 'system-ready') continue;
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
