import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTimelineRepository } = require('../electron/timeline-repository.cjs');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'def-timeline-repository-'));
const repository = createTimelineRepository({ databasePath: path.join(directory, 'timeline.sqlite3') });
const payload = { selectedCharacters: [], timelineData: { staffLines: [] }, skillButtonTable: {}, allBuffList: [] };

repository.ensureDocument({ id: 'timeline-main', label: '主排轴', createdAt: 1 });
const first = repository.createOrReuseSnapshot({
  id: 'snapshot-1', timelineId: 'timeline-main', label: '保存一', payload, createdAt: 2,
});
const duplicate = repository.createOrReuseSnapshot({
  id: 'snapshot-duplicate', timelineId: 'timeline-main', label: '重复保存', payload, createdAt: 3,
});
assert.equal(first.reused, false);
assert.equal(duplicate.reused, true);
assert.equal(repository.listSnapshots('timeline-main').length, 1);
const checkout = repository.setCheckoutRef({ timelineId: 'timeline-main', targetType: 'snapshot', targetId: 'snapshot-1', updatedAt: 4 });
assert.equal(checkout.targetId, 'snapshot-1');
repository.appendAuditEvent({
  id: 'event-1', timelineId: 'timeline-main', eventType: 'snapshot.saved', subjectType: 'snapshot', subjectId: 'snapshot-1', details: {}, createdAt: 5,
});
assert.deepEqual(repository.getSnapshot('snapshot-1')?.payload, payload);
repository.close();
fs.rmSync(directory, { recursive: true, force: true });
console.log('Timeline repository smoke passed.');
