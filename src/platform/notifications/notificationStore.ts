import { webDatabase, type SqlPrimitive } from '../database/webDatabase';
import {
  normalizeNotificationAction,
  NOTIFICATION_KINDS,
  NOTIFICATION_SEVERITIES,
  type AppNotification,
  type NotificationInput,
  type NotificationSeverity,
} from './notificationTypes';

const MAX_NOTIFICATION_ROWS = 100;

type NotificationRow = Record<string, SqlPrimitive> & {
  id: string;
  dedupe_key: string;
  kind: string;
  severity: string;
  title: string;
  body: string;
  action_json: string | null;
  created_at: number;
  updated_at: number;
  read_at: number | null;
};

function normalizeSeverity(value: string | null | undefined): NotificationSeverity {
  return NOTIFICATION_SEVERITIES.includes(value as NotificationSeverity)
    ? value as NotificationSeverity
    : 'info';
}

function normalizeKind(value: string | null | undefined): AppNotification['kind'] {
  return NOTIFICATION_KINDS.includes(value as AppNotification['kind'])
    ? value as AppNotification['kind']
    : 'page-update';
}

function rowToNotification(row: NotificationRow | undefined): AppNotification | null {
  if (!row) return null;
  return {
    id: String(row.id),
    dedupeKey: String(row.dedupe_key),
    kind: normalizeKind(row.kind),
    severity: normalizeSeverity(row.severity),
    title: String(row.title),
    body: String(row.body),
    action: row.action_json ? normalizeNotificationAction(JSON.parse(String(row.action_json))) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    readAt: row.read_at === null ? null : Number(row.read_at),
  };
}

function newNotificationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `notification-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function listNotifications(): Promise<AppNotification[]> {
  const rows = await webDatabase.query<NotificationRow>(
    `
      SELECT id, dedupe_key, kind, severity, title, body, action_json,
             created_at, updated_at, read_at
      FROM notifications
      ORDER BY created_at DESC
      LIMIT ?
    `,
    [MAX_NOTIFICATION_ROWS],
  );
  return rows.map(rowToNotification).filter((item): item is AppNotification => Boolean(item));
}

export async function readNotification(id: string): Promise<AppNotification | null> {
  const rows = await webDatabase.query<NotificationRow>(
    `
      SELECT id, dedupe_key, kind, severity, title, body, action_json,
             created_at, updated_at, read_at
      FROM notifications WHERE id = ?
    `,
    [id],
  );
  return rowToNotification(rows[0]);
}

export async function notifyNotification(input: NotificationInput): Promise<AppNotification> {
  if (!input.dedupeKey.trim()) throw new Error('通知去重键不能为空。');
  if (!input.title.trim()) throw new Error('通知标题不能为空。');
  const id = newNotificationId();
  const now = Date.now();
  const severity = normalizeSeverity(input.severity);
  const actionJson = input.action ? JSON.stringify(input.action) : null;
  await webDatabase.execute(
    `
      INSERT INTO notifications(
        id, dedupe_key, kind, severity, title, body, action_json,
        created_at, updated_at, read_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(dedupe_key) DO UPDATE SET
        updated_at = CASE
          WHEN notifications.read_at IS NULL THEN excluded.updated_at
          ELSE notifications.updated_at
        END
    `,
    [
      id,
      input.dedupeKey,
      input.kind,
      severity,
      input.title.trim(),
      input.body.trim(),
      actionJson,
      now,
      now,
    ],
  );
  const notification = await readNotificationByDedupeKey(input.dedupeKey);
  if (!notification) {
    throw new Error('通知写入后无法读取。');
  }
  return notification;
}

async function readNotificationByDedupeKey(dedupeKey: string): Promise<AppNotification | null> {
  const rows = await webDatabase.query<NotificationRow>(
    `
      SELECT id, dedupe_key, kind, severity, title, body, action_json,
             created_at, updated_at, read_at
      FROM notifications WHERE dedupe_key = ?
    `,
    [dedupeKey],
  );
  return rowToNotification(rows[0]);
}

export async function markNotificationRead(id: string): Promise<void> {
  await webDatabase.execute(
    `
      UPDATE notifications SET read_at = ?
      WHERE id = ? AND read_at IS NULL
    `,
    [Date.now(), id],
  );
}

export async function markAllNotificationsRead(): Promise<void> {
  await webDatabase.execute(
    'UPDATE notifications SET read_at = ? WHERE read_at IS NULL',
    [Date.now()],
  );
}

export async function markKindRead(kind: AppNotification['kind']): Promise<void> {
  await webDatabase.execute(
    'UPDATE notifications SET read_at = ? WHERE kind = ? AND read_at IS NULL',
    [Date.now(), kind],
  );
}

export async function countUnreadNotifications(): Promise<number> {
  const rows = await webDatabase.query<{ count: number }>(
    'SELECT COUNT(*) AS count FROM notifications WHERE read_at IS NULL',
  );
  return Number(rows[0]?.count || 0);
}
