export const NOTIFICATION_SEVERITIES = ['info', 'success', 'warning', 'error'] as const;
export type NotificationSeverity = typeof NOTIFICATION_SEVERITIES[number];

export const NOTIFICATION_KINDS = [
  'page-update',
  'data-download',
  'image-download',
  'data-apply',
  'apply-result',
  'install-result',
  'import-result',
  'backup-created',
] as const;
export type NotificationKind = typeof NOTIFICATION_KINDS[number];

export type NotificationHandlerKey =
  | 'page-update'
  | 'data-workspace'
  | 'settings';

export type NotificationAction = {
  label: string;
  route?: string;
  handlerKey?: NotificationHandlerKey;
};

export type AppNotification = {
  id: string;
  dedupeKey: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string;
  action: NotificationAction | null;
  createdAt: number;
  updatedAt: number;
  readAt: number | null;
};

export type NotificationInput = {
  dedupeKey: string;
  kind: NotificationKind;
  severity?: NotificationSeverity;
  title: string;
  body: string;
  action?: NotificationAction | null;
};

export function normalizeNotificationAction(value: unknown): NotificationAction | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<NotificationAction>;
  if (typeof candidate.label !== 'string' || !candidate.label.trim()) return null;
  const action: NotificationAction = { label: candidate.label.trim() };
  if (typeof candidate.route === 'string' && candidate.route.trim()) {
    action.route = candidate.route.trim();
  }
  if (
    candidate.handlerKey === 'page-update'
    || candidate.handlerKey === 'data-workspace'
    || candidate.handlerKey === 'settings'
  ) {
    action.handlerKey = candidate.handlerKey;
  }
  return action;
}
