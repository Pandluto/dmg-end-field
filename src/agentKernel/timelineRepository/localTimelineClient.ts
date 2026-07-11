import type { TimelineAuditEvent, TimelineCheckoutRef, TimelineDocument, TimelineSnapshot } from '../../core/domain/timeline';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';

const REST_BASE_URL = 'http://127.0.0.1:17321';
const BRIDGE_BASE_URL = 'http://127.0.0.1:31457';

type RepositoryResponse<T> = { ok: true; path?: string } & T;
class TimelineRepositoryRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'TimelineRepositoryRequestError';
  }
}
export type TimelineRepositoryWorkNode = {
  id: string; parentNodeId?: string; timelineId: string; branchId: string; label: string; status: string;
  approvalPolicy: string; riskFlags: Array<{ severity: 'info' | 'warning' | 'blocker'; code: string; message: string }>; logs: Array<{ id: string; at: number; level: 'info' | 'warning' | 'error'; message: string }>;
  baseSummary: { characterCount: number; buttonCount: number; buffCount: number };
  workingSummary: { characterCount: number; buttonCount: number; buffCount: number };
  createdAt: number; updatedAt: number;
};

export type TimelineRepositoryBundleWorkNode = TimelineRepositoryWorkNode & {
  basePayload: TimelineSnapshotPayload;
  workingPayload: TimelineSnapshotPayload;
};

export type TimelineRepositoryWorkNodePatch = {
  id: string;
  timelineId: string;
  nodeId: string;
  patch: Array<{ op?: string }>;
  validation: { ok?: boolean; issues?: unknown[] };
  diffSummary: Record<string, unknown>;
  riskFlags: unknown[];
  createdAt: number;
};

async function readResponse<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok || !payload?.ok) {
    throw new TimelineRepositoryRequestError(
      payload?.error?.message || `Timeline repository request failed: ${response.status}`,
      response.status,
    );
  }
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
    // The development shell owns port 31457 but intentionally does not expose
    // the Electron local-data bridge.  Its 404 must fall through to the REST
    // repository just like an unavailable bridge does.
    const bridgeRouteMissing = error instanceof TimelineRepositoryRequestError && error.status === 404;
    if (!bridgeRouteMissing && !(error instanceof TypeError) && !/failed to fetch|network|load failed/i.test(String(error))) throw error;
    return request<T>(REST_BASE_URL, pathname.replace('/local-data/', '/api/'), method, body);
  }
}

export function createTimelineRepositoryClient() {
  return {
    async listDocuments() {
      const response = await requestWithFallback<RepositoryResponse<{ documents: TimelineDocument[] }>>('/local-data/timeline-documents');
      return response.documents;
    },
    async ensureDocument(input: Pick<TimelineDocument, 'id' | 'label'> & Partial<Pick<TimelineDocument, 'createdAt'>>) {
      const response = await requestWithFallback<RepositoryResponse<{ document: TimelineDocument }>>('/local-data/timeline-documents', 'POST', input);
      return response.document;
    },
    async importDocumentBundle(input: {
      document: Pick<TimelineDocument, 'id' | 'label'> & Partial<Pick<TimelineDocument, 'createdAt'>>;
      snapshots: Array<{ id: string; label: string; createdAt?: number; payload: TimelineSnapshotPayload }>;
      workNodes?: Array<{
        id: string; parentNodeId?: string; branchId: string; label: string; status: string; approvalPolicy: string;
        riskFlags?: unknown[]; logs?: unknown[]; createdAt?: number; updatedAt?: number;
        basePayload: TimelineSnapshotPayload; workingPayload: TimelineSnapshotPayload;
      }>;
    }) {
      const response = await requestWithFallback<RepositoryResponse<{ document: TimelineDocument; snapshots: TimelineSnapshot[] }>>(
        '/local-data/timeline-bundles/import', 'POST', input,
      );
      return { document: response.document, snapshots: response.snapshots };
    },
    async exportDocumentBundle(timelineId: string) {
      const response = await requestWithFallback<RepositoryResponse<{
        document: TimelineDocument;
        snapshots: TimelineSnapshot[];
        workNodes: TimelineRepositoryBundleWorkNode[];
      }>>(`/local-data/timeline-bundles/export?timelineId=${encodeURIComponent(timelineId)}`);
      return { document: response.document, snapshots: response.snapshots, workNodes: response.workNodes };
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
    async listWorkNodePatches(nodeId: string) {
      const response = await requestWithFallback<RepositoryResponse<{ patches: TimelineRepositoryWorkNodePatch[] }>>(
        `/local-data/timeline-work-nodes/${encodeURIComponent(nodeId)}/patches`,
      );
      return response.patches;
    },
    async listAuditEvents(timelineId: string, limit = 100) {
      const response = await requestWithFallback<RepositoryResponse<{ events: TimelineAuditEvent[] }>>(
        `/local-data/timeline-audit-events?timelineId=${encodeURIComponent(timelineId)}&limit=${encodeURIComponent(limit)}`,
      );
      return response.events;
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
    async getCheckoutRef(timelineId: string) {
      const response = await requestWithFallback<RepositoryResponse<{ checkoutRef: TimelineCheckoutRef | null }>>(
        `/local-data/timeline-checkout-ref?timelineId=${encodeURIComponent(timelineId)}`,
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
