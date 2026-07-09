export const WORK_NODE_ACTIVE_ID_KEY = 'def.work-node.active-id.v1';
export const WORK_NODE_PARENT_OVERRIDES_KEY = 'def.work-node.parent-overrides.v1';
export const WORK_NODE_DELETED_IDS_KEY = 'def.work-node.deleted-ids.v1';

export function readActiveWorkNodeId(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(WORK_NODE_ACTIVE_ID_KEY) || '';
  } catch {
    return '';
  }
}

export function writeActiveWorkNodeId(nodeId: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (nodeId) {
      window.localStorage.setItem(WORK_NODE_ACTIVE_ID_KEY, nodeId);
    } else {
      window.localStorage.removeItem(WORK_NODE_ACTIVE_ID_KEY);
    }
  } catch {
    // Best effort only.
  }
}

export function readWorkNodeParentOverrides(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(WORK_NODE_PARENT_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([nodeId, parentNodeId]) => nodeId && typeof parentNodeId === 'string')
        .map(([nodeId, parentNodeId]) => [nodeId, String(parentNodeId).trim()]),
    );
  } catch {
    return {};
  }
}

export function writeWorkNodeParentOverride(nodeId: string, parentNodeId: string): Record<string, string> {
  if (typeof window === 'undefined' || !nodeId) return {};
  const next = {
    ...readWorkNodeParentOverrides(),
    [nodeId]: parentNodeId,
  };
  try {
    window.localStorage.setItem(WORK_NODE_PARENT_OVERRIDES_KEY, JSON.stringify(next));
  } catch {
    // Best effort only.
  }
  return next;
}

export function clearWorkNodeParentOverrides(nodeIds: string[]): Record<string, string> {
  if (typeof window === 'undefined' || nodeIds.length === 0) return readWorkNodeParentOverrides();
  const deleted = new Set(nodeIds);
  const next = Object.fromEntries(
    Object.entries(readWorkNodeParentOverrides()).filter(([nodeId]) => !deleted.has(nodeId)),
  );
  try {
    window.localStorage.setItem(WORK_NODE_PARENT_OVERRIDES_KEY, JSON.stringify(next));
  } catch {
    // Best effort only.
  }
  return next;
}

export function readWorkNodeDeletedIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(WORK_NODE_DELETED_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((nodeId): nodeId is string => typeof nodeId === 'string' && nodeId.trim().length > 0);
  } catch {
    return [];
  }
}

export function addWorkNodeDeletedIds(nodeIds: string[]): string[] {
  if (typeof window === 'undefined' || nodeIds.length === 0) return readWorkNodeDeletedIds();
  const next = [...new Set([...readWorkNodeDeletedIds(), ...nodeIds.filter(Boolean)])];
  try {
    window.localStorage.setItem(WORK_NODE_DELETED_IDS_KEY, JSON.stringify(next));
  } catch {
    // Best effort only.
  }
  return next;
}
