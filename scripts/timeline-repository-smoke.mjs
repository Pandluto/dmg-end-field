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
repository.importWorkNode({
  id: 'node-1', timelineId: 'timeline-main', branchId: 'branch-1', label: 'Draft',
  basePayload: payload, workingPayload: payload, createdAt: 6, updatedAt: 6,
});
repository.appendWorkNodePatch({
  id: 'patch-1', timelineId: 'timeline-main', nodeId: 'node-1',
  patch: [{ op: 'moveButton', target: { buttonId: 'button-1' }, nodeIndex: 1 }],
  validation: { ok: true, issues: [] }, diffSummary: { changedButtonCount: 1 }, riskFlags: [], createdAt: 7,
});
assert.equal(repository.listWorkNodePatches('node-1').length, 1);
assert.equal(repository.listAuditEvents('timeline-main').some((event) => event.eventType === 'work-node.patched'), true);
repository.close();
fs.rmSync(directory, { recursive: true, force: true });
console.log('Timeline repository smoke passed.');
