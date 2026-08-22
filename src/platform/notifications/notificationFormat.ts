export function formatRelativeNotificationTime(timestamp: number, now = Date.now()): string {
  if (!Number.isFinite(timestamp)) return '';
  const elapsed = Math.max(0, now - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsed < minute) return '刚刚';
  if (elapsed < hour) return `${Math.floor(elapsed / minute)} 分钟前`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)} 小时前`;
  if (elapsed < 7 * day) return `${Math.floor(elapsed / day)} 天前`;
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatNotificationVersionLabel(version: string): string {
  const match = /^(\d{8}\.\d{6})/.exec(version.trim());
  return match ? match[1] : version.trim();
}
