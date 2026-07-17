import type { TimelineAuditEvent, TimelineCheckoutRef, TimelineDocument, TimelineSnapshot } from '../../core/domain/timeline';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import type { AiTimelineApproval, AiTimelineCheckout, AiTimelineRiskFlag, TimelinePayloadDiffSummary } from '../timelineWorktree/types';

const REST_BASE_URL = 'http://127.0.0.1:17321';
const BRIDGE_BASE_URL = 'http://127.0.0.1:31457';

type RepositoryResponse<T> = { ok: true; path?: string } & T;
export class TimelineRepositoryRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly details?: unknown) {
    super(message);
    this.name = 'TimelineRepositoryRequestError';
  }
}

const TIMELINE_ERROR_ACTIONS: Record<string, string> = {
  'timeline-work-node-current-checkout-protected': '请先切换到其他节点或快照，再删除该分支。',
  'timeline-snapshot-current-checkout-protected': '请先恢复其他节点或快照，再删除当前快照。',
  'timeline-work-node-parent-not-found': '请刷新工作树后重新选择父节点。',
  'timeline-work-node-cross-document-parent': '父子节点必须位于同一个排轴文档。',
  'timeline-checkout-target-not-found': '目标可能已被删除，请刷新恢复列表后重试。',
  'timeline-document-not-found': '该排轴可能已被删除，请返回 SQLite 列表重新选择。',
};

export function formatTimelineOperationError(error: unknown): string {
  const candidate = error as { message?: unknown; code?: unknown } | null;
  const message = typeof candidate?.message === 'string' ? candidate.message : String(error);
  const code = typeof candidate?.code === 'string' ? candidate.code : '';
  const action = code ? TIMELINE_ERROR_ACTIONS[code] : '';
  return `${code ? `[${code}] ` : ''}${message}${action ? ` ${action}` : ''}`;
}
export type TimelineRepositoryWorkNode = {
  id: string; parentNodeId?: string; timelineId: string; branchId: string; label: string; description: string; status: string;
  approvalPolicy: string; riskFlags: Array<{ severity: 'info' | 'warning' | 'blocker'; code: string; message: string }>; logs: Array<{ id: string; at: number; level: 'info' | 'warning' | 'error'; message: string }>;
  baseSummary: { characterCount: number; buttonCount: number; buffCount: number };
  workingSummary: { characterCount: number; buttonCount: number; buffCount: number };
  createdAt: number; updatedAt: number; contentRevision: number;
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

export type TimelineRepositoryWorkNodeCommit = {
  id: string;
  nodeId: string;
  timelineId: string;
  branchId: string;
  createdAt: number;
  label: string;
  summary: TimelinePayloadDiffSummary;
  riskFlags: AiTimelineRiskFlag[];
  approval: AiTimelineApproval;
  checkoutApplied: boolean;
  checkout?: AiTimelineCheckout;
  basePayload?: TimelineSnapshotPayload;
  appliedPayload?: TimelineSnapshotPayload;
};

/**
 * Archives are local files. "shared" is the package/import transit library;
 * it is not a remote, read-only reference library.
 */
export type TimelineArchiveSource = 'local' | 'shared';
export type TimelineArchiveLibrary = TimelineArchiveSource;

export type TimelineArchiveSummary = {
  archiveId: string;
  label: string;
  source: TimelineArchiveSource;
  /** Physical archive library. */
  library: TimelineArchiveLibrary;
  archiveVersion: number;
  createdAt: string;
  payloadHash?: string;
  summary: { characterCount: number; buttonCount: number; buffCount: number };
  nodeCount: number;
  hasCurrentNode: boolean;
  releaseId?: string;
  invalid?: { code: string; message: string };
  worktreeDiagnostic?: { code: string; message: string };
};

export type TimelineSqliteWorkspace = {
  document: TimelineDocument;
  checkoutRef: TimelineCheckoutRef | null;
  summary: { characterCount: number; buttonCount: number; buffCount: number };
  nodeCount: number;
  invalid?: { code: string; message: string };
};

type TimelineWorkspaceApplyResult = {
  document: Pick<TimelineDocument, 'id' | 'label'>;
  payload: TimelineSnapshotPayload;
  checkoutRef: TimelineCheckoutRef;
  workspace: { values: Record<string, string | null>; updatedAt: number };
};

async function readResponse<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok || !payload?.ok) {
    throw new TimelineRepositoryRequestError(
      payload?.error?.message || `Timeline repository request failed: ${response.status}`,
      response.status,
      payload?.error?.code || 'timeline-repository-request-failed',
      payload?.error?.details,
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
    async ensureDocument(input: Pick<TimelineDocument, 'id' | 'label'> & Partial<Pick<TimelineDocument, 'createdAt' | 'isTemporary'>> & { preserveExistingLabel?: boolean }) {
      const response = await requestWithFallback<RepositoryResponse<{ document: TimelineDocument }>>('/local-data/timeline-documents', 'POST', input);
      return response.document;
    },
    async deleteDocument(timelineId: string) {
      const response = await requestWithFallback<RepositoryResponse<{ result: {
        document: TimelineDocument;
        deletedNodeIds: string[];
        deletedSnapshotCount: number;
      } }>>(`/local-data/timeline-documents/${encodeURIComponent(timelineId)}/delete`, 'POST', {});
      return response.result;
    },
    async importDocumentBundle(input: {
      document: Pick<TimelineDocument, 'id' | 'label'> & Partial<Pick<TimelineDocument, 'createdAt' | 'isTemporary'>>;
      snapshots: Array<{ id: string; label: string; createdAt?: number; payload: TimelineSnapshotPayload }>;
      workNodes?: Array<{
        id: string; parentNodeId?: string; branchId: string; label: string; description?: string; status: string; approvalPolicy: string;
        riskFlags?: unknown[]; logs?: unknown[]; createdAt?: number; updatedAt?: number; contentRevision?: number;
        basePayload: TimelineSnapshotPayload; workingPayload: TimelineSnapshotPayload;
      }>;
      commits?: Array<TimelineRepositoryWorkNodeCommit & { basePayload: TimelineSnapshotPayload; appliedPayload: TimelineSnapshotPayload }>;
      checkoutRef?: Omit<TimelineCheckoutRef, 'timelineId'>;
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
        commits: Array<TimelineRepositoryWorkNodeCommit & { basePayload: TimelineSnapshotPayload; appliedPayload: TimelineSnapshotPayload }>;
        checkoutRef: TimelineCheckoutRef | null;
      }>>(`/local-data/timeline-bundles/export?timelineId=${encodeURIComponent(timelineId)}`);
      return { document: response.document, snapshots: response.snapshots, workNodes: response.workNodes, commits: response.commits, checkoutRef: response.checkoutRef };
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
    async listWorkNodeCommits(timelineId: string) {
      const response = await requestWithFallback<RepositoryResponse<{ commits: TimelineRepositoryWorkNodeCommit[] }>>(
        `/local-data/timeline-work-node-commits?timelineId=${encodeURIComponent(timelineId)}`,
      );
      return response.commits;
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
    async listTimelineArchives(source: TimelineArchiveLibrary) {
      const response = await requestWithFallback<RepositoryResponse<{ archives: TimelineArchiveSummary[] }>>(
        `/local-data/timeline-archives?source=${encodeURIComponent(source)}`,
      );
      return response.archives;
    },
    async listSqliteWorkspaces() {
      const response = await requestWithFallback<RepositoryResponse<{ workspaces: TimelineSqliteWorkspace[] }>>('/local-data/timeline-workspaces');
      return response.workspaces;
    },
    async convertTimelineArchive(input: { source: TimelineArchiveLibrary; archiveId: string; payloadOnly?: boolean; label?: string; updatedAt?: number }) {
      const response = await requestWithFallback<RepositoryResponse<TimelineWorkspaceApplyResult & {
        rootNodeId: string;
        importedNodeCount: number;
        totalNodeCount: number;
        compatibility: Array<{ code: string; message: string }>;
      }>>('/local-data/timeline-archives/convert', 'POST', input);
      return response;
    },
    async importLegacyTimelineBundle(input: { bundle: unknown; sourceName?: string }) {
      const response = await requestWithFallback<RepositoryResponse<{
        imported: boolean;
        reused: boolean;
        archive: TimelineArchiveSummary;
      }>>('/local-data/timeline-archives/import-legacy-bundle', 'POST', input);
      return response;
    },
    async deleteTimelineArchive(input: { library: TimelineArchiveLibrary; archiveId: string }) {
      const response = await requestWithFallback<RepositoryResponse<{ result: { library: TimelineArchiveLibrary; archiveId: string; deleted: boolean } }>>(
        '/local-data/timeline-archives/delete', 'POST', input,
      );
      return response.result;
    },
    async transferTimelineArchive(input: { from: TimelineArchiveLibrary; to: TimelineArchiveLibrary; archiveId: string }) {
      const response = await requestWithFallback<RepositoryResponse<{ result: { from: TimelineArchiveLibrary; to: TimelineArchiveLibrary; archive: TimelineArchiveSummary; moved: boolean } }>>(
        '/local-data/timeline-archives/transfer', 'POST', input,
      );
      return response.result;
    },
    async applySqliteWorkspace(timelineId: string, updatedAt?: number) {
      const response = await requestWithFallback<RepositoryResponse<TimelineWorkspaceApplyResult>>(
        `/local-data/timeline-workspaces/${encodeURIComponent(timelineId)}/apply`, 'POST', { updatedAt },
      );
      return response;
    },
    async deleteSqliteWorkspace(timelineId: string) {
      const response = await requestWithFallback<RepositoryResponse<{ result: {
        document: TimelineDocument;
        deletedNodeIds: string[];
        deletedSnapshotCount: number;
      } }>>(`/local-data/timeline-workspaces/${encodeURIComponent(timelineId)}/delete`, 'POST', {});
      return response.result;
    },
    async exportSqliteWorkspaceArchive(input: { timelineId: string; kind: TimelineArchiveSource; label?: string }) {
      const response = await requestWithFallback<RepositoryResponse<{
        kind: TimelineArchiveSource;
        outbox: boolean;
        filePath: string;
        archive: TimelineArchiveSummary;
      }>>(`/local-data/timeline-workspaces/${encodeURIComponent(input.timelineId)}/export-archive`, 'POST', {
        kind: input.kind,
        label: input.label,
      });
      return response;
    },
  };
}
