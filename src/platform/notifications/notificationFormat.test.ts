import assert from 'node:assert/strict';
import {
  formatNotificationVersionLabel,
  formatRelativeNotificationTime,
} from './notificationFormat';
import { normalizeNotificationAction } from './notificationTypes';

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const now = new Date('2026-08-15T12:00:00Z').getTime();

assert.equal(formatRelativeNotificationTime(now, now), '刚刚');
assert.equal(formatRelativeNotificationTime(now - 5 * minute, now), '5 分钟前');
assert.equal(formatRelativeNotificationTime(now - 3 * hour, now), '3 小时前');
assert.equal(formatRelativeNotificationTime(now - 2 * day, now), '2 天前');

assert.equal(
  formatNotificationVersionLabel('20260814.215100.e63783f486d6'),
  '20260814.215100',
);
assert.equal(formatNotificationVersionLabel('v1.8.5'), 'v1.8.5');

assert.deepEqual(
  normalizeNotificationAction({ label: '去数据页', handlerKey: 'data-workspace' }),
  { label: '去数据页', handlerKey: 'data-workspace' },
);
assert.equal(
  normalizeNotificationAction({ label: ' ' }),
  null,
);
assert.deepEqual(
  normalizeNotificationAction({ label: '打开设置', route: '/settings' }),
  { label: '打开设置', route: '/settings' },
);

console.log('Notification format and action contract: PASS');
