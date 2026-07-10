import type { TimelineCheckoutRef, TimelineDocument, TimelineSnapshot } from '../../core/domain/timeline';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';

const REST_BASE_URL = 'http://127.0.0.1:17321';
const BRIDGE_BASE_URL = 'http://127.0.0.1:31457';

type RepositoryResponse<T> = { ok: true; path?: string } & T;
export type TimelineRepositoryWorkNode = {
  id: string; parentNodeId?: string; timelineId: string; branchId: string; label: string; status: string;
  approvalPolicy: string; riskFlags: Array<{ severity: 'info' | 'warning' | 'blocker'; code: string; message: string }>; logs: Array<{ id: string; at: number; level: 'info' | 'warning' | 'error'; message: string }>;
  createdAt: number; updatedAt: number;
};

async function readResponse<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok || !payload?.ok) throw new Error(payload?.error?.message || `Timeline repository request failed: ${response.status}`);
  return payload as T;
}

async function request<T>(baseUrl: string, pathname: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return readResponse<T>(response);
}

async function requestWithFallback<T>(pathname: string, method = 'GET', body?: unknown): Promise<T> {
  try {
    return await request<T>(BRIDGE_BASE_URL, pathname, method, body);
  } catch (error) {
    if (!(error instanceof TypeError) && !/failed to fetch|network|load failed/i.test(String(error))) throw error;
    return request<T>(REST_BASE_URL, pathname.replace('/local-data/', '/api/'), method, body);
  }
}

export function createTimelineRepositoryClient() {
  return {
    async ensureDocument(input: Pick<TimelineDocument, 'id' | 'label'> & Partial<Pick<TimelineDocument, 'createdAt'>>) {
      const response = await requestWithFallback<RepositoryResponse<{ document: TimelineDocument }>>('/local-data/timeline-documents', 'POST', input);
      return response.document;
    },
    async listSnapshots(timelineId: string) {
      const response = await requestWithFallback<RepositoryResponse<{ snapshots: TimelineSnapshot[] }>>(
        `/local-data/timeline-snapshots?timelineId=${encodeURIComponent(timelineId)}`,
      );
      return response.snapshots;
    },
    async listWorkNodes(timelineId: string) {
      const response = await requestWithFallback<RepositoryResponse<{ nodes: TimelineRepositoryWorkNode[] }>>(
        `/local-data/timeline-work-nodes?timelineId=${encodeURIComponent(timelineId)}`,
      );
      return response.nodes;
    },
    async deleteWorkNode(nodeId: string) {
      const response = await requestWithFallback<RepositoryResponse<{ result: { deletedNodeIds: string[] } }>>(
        `/local-data/timeline-work-nodes/${encodeURIComponent(nodeId)}/delete`, 'POST', {},
      );
      return response.result;
    },
    async saveSnapshot(input: { id: string; timelineId: string; label: string; payload: TimelineSnapshotPayload; createdAt?: number }) {
      const response = await requestWithFallback<RepositoryResponse<{ snapshot: TimelineSnapshot; reused: boolean }>>(
        '/local-data/timeline-snapshots', 'POST', input,
      );
      return { snapshot: response.snapshot, reused: response.reused };
    },
    async setCheckoutRef(input: TimelineCheckoutRef) {
      const response = await requestWithFallback<RepositoryResponse<{ checkoutRef: TimelineCheckoutRef }>>(
        '/local-data/timeline-checkout-ref', 'POST', input,
      );
      return response.checkoutRef;
    },
    async archiveSnapshot(snapshotId: string) {
      const response = await requestWithFallback<RepositoryResponse<{ result: { id: string; archived: boolean } }>>(
        `/local-data/timeline-snapshots/${encodeURIComponent(snapshotId)}/archive`, 'POST', {},
      );
      return response.result;
    },
  };
}
