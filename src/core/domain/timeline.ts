import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';

export type TimelineCheckoutTarget =
  | { targetType: 'snapshot'; targetId: string }
  | { targetType: 'work-node'; targetId: string };

export interface TimelineDocument {
  id: string;
  label: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export interface TimelineSnapshot {
  id: string;
  timelineId: string;
  payloadHash: string;
  label: string;
  createdAt: number;
  archivedAt: number | null;
  payload?: TimelineSnapshotPayload;
}

export type TimelineCheckoutRef = TimelineCheckoutTarget & {
  timelineId: string;
  updatedAt: number;
};

export interface TimelineAuditEvent {
  id: string;
  timelineId: string;
  eventType: string;
  subjectType: 'snapshot' | 'work-node' | 'checkout';
  subjectId: string;
  details: Record<string, unknown>;
  createdAt: number;
}
