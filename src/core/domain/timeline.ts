import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';

export const DEFAULT_TIMELINE_ID = 'current-main-workbench';

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

export interface TimelineWorkNode {
  id: string;
  timelineId: string;
  parentNodeId: string | null;
  basePayloadHash: string;
  workingPayloadHash: string;
  status: 'draft' | 'validated' | 'blocked' | 'applied' | 'archived';
  createdAt: number;
  updatedAt: number;
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
