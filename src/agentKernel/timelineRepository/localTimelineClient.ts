import type { TimelineCheckoutRef, TimelineDocument } from '../../core/domain/timeline';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import type { AiTimelineWorkNodeCommit } from '../timelineWorktree/types';
import {
  BrowserTimelineStoreError,
  applySqliteWorkspace,
  archiveSnapshot,
  convertTimelineArchive,
  deleteDocument,
  deleteTimelineArchive,
  deleteWorkNode,
  ensureDocument,
  exportDocumentBundle,
  exportSqliteWorkspaceArchive,
  forkTimelineWorkspaceFromWorkNode,
  getCheckoutRef,
  importDocumentBundle,
  importPortableTimelineBundle,
  listAuditEvents,
  listDocuments,
  listSnapshots,
  listSqliteWorkspaces,
  listTimelineArchives,
  listWorkNodeCommits,
  listWorkNodePatches,
  listWorkNodes,
  omitWorkNodePath,
  saveSnapshot,
  setCheckoutRef,
  transferTimelineArchive,
  type BrowserTimelineArchiveSummary,
  type BrowserTimelineSqliteWorkspace,
  type BrowserTimelineWorkNode,
  type BrowserTimelineWorkNodePatch,
  type TimelineArchiveLibrary,
  type TimelineArchiveSource,
} from '../../platform/timeline/browserTimelineStore';

export { BrowserTimelineStoreError as TimelineRepositoryRequestError };

export type TimelineRepositoryWorkNode = BrowserTimelineWorkNode;
export type TimelineRepositoryBundleWorkNode = BrowserTimelineWorkNode;
export type TimelineRepositoryWorkNodePatch = BrowserTimelineWorkNodePatch;
export type TimelineRepositoryWorkNodeCommit = AiTimelineWorkNodeCommit;
export type { TimelineArchiveLibrary, TimelineArchiveSource };
export type TimelineArchiveSummary = BrowserTimelineArchiveSummary;
export type TimelineSqliteWorkspace = BrowserTimelineSqliteWorkspace;

const TIMELINE_ERROR_ACTIONS: Record<string, string> = {
  'timeline-work-node-current-checkout-protected': '请先切换到其他节点或快照，再删除该分支。',
  'timeline-snapshot-current-checkout-protected': '请先恢复其他节点或快照，再删除当前快照。',
  'timeline-work-node-parent-not-found': '请刷新工作树后重新选择父节点。',
  'timeline-work-node-cross-document-parent': '父子节点必须位于同一个排轴文档。',
  'timeline-checkout-target-not-found': '目标可能已被删除，请刷新恢复列表后重试。',
  'timeline-document-not-found': '该排轴可能已被删除，请返回工作区列表重新选择。',
};

export function formatTimelineOperationError(error: unknown): string {
  const candidate = error as { message?: unknown; code?: unknown } | null;
  const message = typeof candidate?.message === 'string' ? candidate.message : String(error);
  const code = typeof candidate?.code === 'string' ? candidate.code : '';
  const action = code ? TIMELINE_ERROR_ACTIONS[code] : '';
  return `${code ? `[${code}] ` : ''}${message}${action ? ` ${action}` : ''}`;
}

/**
 * Browser LTS repository facade.
 *
 * The public shape intentionally stays stable for the Workbench while all
 * operations execute against the browser-owned SQLite database. There is no
 * native bridge, server-side process, or legacy database migration fallback.
 */
export function createTimelineRepositoryClient() {
  return {
    listDocuments,
    ensureDocument,
    deleteDocument,
    importDocumentBundle,
    exportDocumentBundle,
    listSnapshots,
    listWorkNodes,
    listWorkNodePatches,
    listWorkNodeCommits,
    listAuditEvents,
    deleteWorkNode,
    omitWorkNodePath,
    forkTimelineWorkspaceFromWorkNode,
    saveSnapshot,
    setCheckoutRef,
    getCheckoutRef,
    archiveSnapshot,
    listTimelineArchives,
    listSqliteWorkspaces,
    convertTimelineArchive,
    importLegacyTimelineBundle: importPortableTimelineBundle,
    deleteTimelineArchive,
    transferTimelineArchive,
    applySqliteWorkspace,
    deleteSqliteWorkspace: deleteDocument,
    exportSqliteWorkspaceArchive,
  } satisfies {
    listDocuments: () => Promise<TimelineDocument[]>;
    ensureDocument: typeof ensureDocument;
    deleteDocument: typeof deleteDocument;
    importDocumentBundle: typeof importDocumentBundle;
    exportDocumentBundle: typeof exportDocumentBundle;
    listSnapshots: typeof listSnapshots;
    listWorkNodes: typeof listWorkNodes;
    listWorkNodePatches: typeof listWorkNodePatches;
    listWorkNodeCommits: typeof listWorkNodeCommits;
    listAuditEvents: typeof listAuditEvents;
    deleteWorkNode: typeof deleteWorkNode;
    omitWorkNodePath: typeof omitWorkNodePath;
    forkTimelineWorkspaceFromWorkNode: typeof forkTimelineWorkspaceFromWorkNode;
    saveSnapshot: (input: {
      id: string;
      timelineId: string;
      label: string;
      payload: TimelineSnapshotPayload;
      createdAt?: number;
    }) => ReturnType<typeof saveSnapshot>;
    setCheckoutRef: (input: TimelineCheckoutRef) => ReturnType<typeof setCheckoutRef>;
    getCheckoutRef: typeof getCheckoutRef;
    archiveSnapshot: typeof archiveSnapshot;
    listTimelineArchives: typeof listTimelineArchives;
    listSqliteWorkspaces: typeof listSqliteWorkspaces;
    convertTimelineArchive: typeof convertTimelineArchive;
    importLegacyTimelineBundle: typeof importPortableTimelineBundle;
    deleteTimelineArchive: typeof deleteTimelineArchive;
    transferTimelineArchive: typeof transferTimelineArchive;
    applySqliteWorkspace: typeof applySqliteWorkspace;
    deleteSqliteWorkspace: typeof deleteDocument;
    exportSqliteWorkspaceArchive: typeof exportSqliteWorkspaceArchive;
  };
}
