export const WORK_NODE_ACTIVE_ID_KEY = 'def.work-node.active-id.v1';

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
