import { DEFAULT_TIMELINE_ID } from '../../core/domain/timeline';
import type { TimelineCheckoutRef, TimelineDocument } from '../../core/domain/timeline';
import { createTimelineRepositoryClient } from './localTimelineClient';

const ACTIVE_TIMELINE_DOCUMENT_KEY = 'dmg.active-timeline-document-id';

export type TimelineSessionSnapshot = {
  activeTimelineId: string;
  activeTimelineLabel: string;
  checkoutRef: TimelineCheckoutRef | null;
  revision: number;
};

function readPersistedTimelineId(): string {
  if (typeof window === 'undefined') return DEFAULT_TIMELINE_ID;
  return window.localStorage.getItem(ACTIVE_TIMELINE_DOCUMENT_KEY)?.trim() || DEFAULT_TIMELINE_ID;
}

let snapshot: TimelineSessionSnapshot = {
  activeTimelineId: readPersistedTimelineId(),
  activeTimelineLabel: '主排轴',
  checkoutRef: null,
  revision: 0,
};
const listeners = new Set<() => void>();

function publish(next: Omit<TimelineSessionSnapshot, 'revision'>): TimelineSessionSnapshot {
  if (
    next.activeTimelineId === snapshot.activeTimelineId
    && next.activeTimelineLabel === snapshot.activeTimelineLabel
  ) return snapshot;
  snapshot = { ...next, revision: snapshot.revision + 1 };
  listeners.forEach((listener) => listener());
  return snapshot;
}

export function getTimelineSessionSnapshot(): TimelineSessionSnapshot {
  return snapshot;
}

export function subscribeTimelineSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setActiveTimelineDocument(document: Pick<TimelineDocument, 'id' | 'label'>): TimelineSessionSnapshot {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(ACTIVE_TIMELINE_DOCUMENT_KEY, document.id);
  }
  return publish({
    activeTimelineId: document.id,
    activeTimelineLabel: document.label,
    checkoutRef: document.id === snapshot.activeTimelineId ? snapshot.checkoutRef : null,
  });
}

export function setTimelineSessionCheckoutRef(checkoutRef: TimelineCheckoutRef | null): TimelineSessionSnapshot {
  if (checkoutRef && checkoutRef.timelineId !== snapshot.activeTimelineId) return snapshot;
  return publish({
    activeTimelineId: snapshot.activeTimelineId,
    activeTimelineLabel: snapshot.activeTimelineLabel,
    checkoutRef,
  });
}

export function resetActiveTimelineDocument(): TimelineSessionSnapshot {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(ACTIVE_TIMELINE_DOCUMENT_KEY, DEFAULT_TIMELINE_ID);
  }
  return publish({ activeTimelineId: DEFAULT_TIMELINE_ID, activeTimelineLabel: '主排轴', checkoutRef: null });
}

export async function refreshTimelineSessionDocument(): Promise<TimelineSessionSnapshot> {
  const repository = createTimelineRepositoryClient();
  const documents = await repository.listDocuments();
  const current = documents.find((document) => document.id === snapshot.activeTimelineId);
  if (current) {
    const checkoutRef = await repository.getCheckoutRef(current.id);
    if (typeof window !== 'undefined') window.localStorage.setItem(ACTIVE_TIMELINE_DOCUMENT_KEY, current.id);
    return publish({ activeTimelineId: current.id, activeTimelineLabel: current.label, checkoutRef });
  }
  const fallback = documents[0];
  if (fallback) {
    const checkoutRef = await repository.getCheckoutRef(fallback.id);
    if (typeof window !== 'undefined') window.localStorage.setItem(ACTIVE_TIMELINE_DOCUMENT_KEY, fallback.id);
    return publish({ activeTimelineId: fallback.id, activeTimelineLabel: fallback.label, checkoutRef });
  }
  const created = await repository.ensureDocument({ id: DEFAULT_TIMELINE_ID, label: '主排轴' });
  return setActiveTimelineDocument(created);
}
