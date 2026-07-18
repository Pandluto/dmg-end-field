import { DEFAULT_TIMELINE_ID } from '../../core/domain/timeline';
import type { TimelineCheckoutRef, TimelineDocument } from '../../core/domain/timeline';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import { createTimelineRepositoryClient } from './localTimelineClient';

const ACTIVE_TIMELINE_DOCUMENT_KEY = 'dmg.active-timeline-document-id';

type TimelineIdentityStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readTimelineIdFromStorages(
  sessionStorage: TimelineIdentityStorage | null,
  localStorage: TimelineIdentityStorage | null,
): string {
  return sessionStorage?.getItem(ACTIVE_TIMELINE_DOCUMENT_KEY)?.trim()
    || localStorage?.getItem(ACTIVE_TIMELINE_DOCUMENT_KEY)?.trim()
    || DEFAULT_TIMELINE_ID;
}

export function persistTimelineIdToStorages(
  timelineId: string,
  sessionStorage: TimelineIdentityStorage | null,
  localStorage: TimelineIdentityStorage | null,
): void {
  // The active SQLite workspace is tab-local runtime identity.  localStorage
  // remains a last-opened fallback for a fresh tab, but must never let another
  // Workbench tab overwrite this tab's active projection after reload.
  sessionStorage?.setItem(ACTIVE_TIMELINE_DOCUMENT_KEY, timelineId);
  localStorage?.setItem(ACTIVE_TIMELINE_DOCUMENT_KEY, timelineId);
}

export type TimelineSessionSnapshot = {
  activeTimelineId: string;
  activeTimelineLabel: string;
  activeTimelineIsTemporary: boolean;
  checkoutRef: TimelineCheckoutRef | null;
  workingPayload: TimelineSnapshotPayload | null;
  workingPayloadSource: 'checkout' | 'runtime' | null;
  revision: number;
};

function readPersistedTimelineId(): string {
  if (typeof window === 'undefined') return DEFAULT_TIMELINE_ID;
  return readTimelineIdFromStorages(window.sessionStorage, window.localStorage);
}

function persistTimelineId(timelineId: string): void {
  if (typeof window === 'undefined') return;
  persistTimelineIdToStorages(timelineId, window.sessionStorage, window.localStorage);
}

let snapshot: TimelineSessionSnapshot = {
  activeTimelineId: readPersistedTimelineId(),
  activeTimelineLabel: '主排轴',
  activeTimelineIsTemporary: false,
  checkoutRef: null,
  workingPayload: null,
  workingPayloadSource: null,
  revision: 0,
};
const listeners = new Set<() => void>();

function publish(next: Omit<TimelineSessionSnapshot, 'revision'>): TimelineSessionSnapshot {
  if (
    next.activeTimelineId === snapshot.activeTimelineId
    && next.activeTimelineLabel === snapshot.activeTimelineLabel
    && next.activeTimelineIsTemporary === snapshot.activeTimelineIsTemporary
    && next.checkoutRef?.timelineId === snapshot.checkoutRef?.timelineId
    && next.checkoutRef?.targetType === snapshot.checkoutRef?.targetType
    && next.checkoutRef?.targetId === snapshot.checkoutRef?.targetId
    && next.checkoutRef?.updatedAt === snapshot.checkoutRef?.updatedAt
    && next.workingPayload === snapshot.workingPayload
    && next.workingPayloadSource === snapshot.workingPayloadSource
  ) return snapshot;
  snapshot = { ...next, revision: snapshot.revision + 1 };
  listeners.forEach((listener) => listener());
  return snapshot;
}

export function activateTimelineSession(input: {
  document: Pick<TimelineDocument, 'id' | 'label'> & Partial<Pick<TimelineDocument, 'isTemporary'>>;
  checkoutRef: TimelineCheckoutRef | null;
  workingPayload: TimelineSnapshotPayload | null;
}): TimelineSessionSnapshot {
  if (input.checkoutRef && input.checkoutRef.timelineId !== input.document.id) {
    throw new Error('Timeline session checkout must belong to the active document.');
  }
  persistTimelineId(input.document.id);
  return publish({
    activeTimelineId: input.document.id,
    activeTimelineLabel: input.document.label,
    activeTimelineIsTemporary: Boolean(input.document.isTemporary),
    checkoutRef: input.checkoutRef,
    workingPayload: input.workingPayload,
    workingPayloadSource: input.workingPayload ? 'checkout' : null,
  });
}

export function getTimelineSessionSnapshot(): TimelineSessionSnapshot {
  return snapshot;
}

export function subscribeTimelineSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setActiveTimelineDocument(document: Pick<TimelineDocument, 'id' | 'label'> & Partial<Pick<TimelineDocument, 'isTemporary'>>): TimelineSessionSnapshot {
  persistTimelineId(document.id);
  return publish({
    activeTimelineId: document.id,
    activeTimelineLabel: document.label,
    activeTimelineIsTemporary: Boolean(document.isTemporary),
    checkoutRef: document.id === snapshot.activeTimelineId ? snapshot.checkoutRef : null,
    workingPayload: document.id === snapshot.activeTimelineId ? snapshot.workingPayload : null,
    workingPayloadSource: document.id === snapshot.activeTimelineId ? snapshot.workingPayloadSource : null,
  });
}

export function setTimelineSessionCheckoutRef(checkoutRef: TimelineCheckoutRef | null): TimelineSessionSnapshot {
  if (checkoutRef && checkoutRef.timelineId !== snapshot.activeTimelineId) return snapshot;
  return publish({
    activeTimelineId: snapshot.activeTimelineId,
    activeTimelineLabel: snapshot.activeTimelineLabel,
    activeTimelineIsTemporary: snapshot.activeTimelineIsTemporary,
    checkoutRef,
    workingPayload: snapshot.workingPayload,
    workingPayloadSource: snapshot.workingPayloadSource,
  });
}

export function setTimelineSessionWorkingPayload(
  workingPayload: TimelineSnapshotPayload | null,
  workingPayloadSource: 'checkout' | 'runtime' | null,
): TimelineSessionSnapshot {
  if (workingPayload === snapshot.workingPayload && workingPayloadSource === snapshot.workingPayloadSource) return snapshot;
  return publish({
    activeTimelineId: snapshot.activeTimelineId,
    activeTimelineLabel: snapshot.activeTimelineLabel,
    activeTimelineIsTemporary: snapshot.activeTimelineIsTemporary,
    checkoutRef: snapshot.checkoutRef,
    workingPayload,
    workingPayloadSource,
  });
}

export function resetActiveTimelineDocument(): TimelineSessionSnapshot {
  persistTimelineId(DEFAULT_TIMELINE_ID);
  return publish({
    activeTimelineId: DEFAULT_TIMELINE_ID,
    activeTimelineLabel: '主排轴',
    activeTimelineIsTemporary: false,
    checkoutRef: null,
    workingPayload: null,
    workingPayloadSource: null,
  });
}

export async function refreshTimelineSessionDocument(): Promise<TimelineSessionSnapshot> {
  const repository = createTimelineRepositoryClient();
  const documents = await repository.listDocuments();
  const current = documents.find((document) => document.id === snapshot.activeTimelineId);
  if (current) {
    const checkoutRef = await repository.getCheckoutRef(current.id);
    persistTimelineId(current.id);
    return publish({
      activeTimelineId: current.id,
      activeTimelineLabel: current.label,
      activeTimelineIsTemporary: current.isTemporary,
      checkoutRef,
      workingPayload: snapshot.activeTimelineId === current.id ? snapshot.workingPayload : null,
      workingPayloadSource: snapshot.activeTimelineId === current.id ? snapshot.workingPayloadSource : null,
    });
  }
  const fallback = documents[0];
  if (fallback) {
    const checkoutRef = await repository.getCheckoutRef(fallback.id);
    persistTimelineId(fallback.id);
    return publish({
      activeTimelineId: fallback.id,
      activeTimelineLabel: fallback.label,
      activeTimelineIsTemporary: fallback.isTemporary,
      checkoutRef,
      workingPayload: null,
      workingPayloadSource: null,
    });
  }
  const created = await repository.ensureDocument({ id: DEFAULT_TIMELINE_ID, label: '主排轴' });
  return setActiveTimelineDocument(created);
}
