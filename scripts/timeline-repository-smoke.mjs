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
assert.throws(() => repository.importWorkNode({
  id: 'node-invalid-status', timelineId: 'timeline-main', branchId: 'invalid', label: 'Invalid', status: 'not-a-status',
  basePayload: payload, workingPayload: payload,
}), { code: 'invalid-timeline-work-node-status' });
repository.appendWorkNodePatch({
  id: 'patch-1', timelineId: 'timeline-main', nodeId: 'node-1',
  patch: [{ op: 'moveButton', target: { buttonId: 'button-1' }, nodeIndex: 1 }],
  validation: { ok: true, issues: [] }, diffSummary: { changedButtonCount: 1 }, riskFlags: [], createdAt: 7,
});
assert.equal(repository.listWorkNodePatches('node-1').length, 1);
assert.equal(repository.listAuditEvents('timeline-main').some((event) => event.eventType === 'work-node.patched'), true);

// A portable bundle is reconstructed from atomic rows, then imported as a
// distinct document with remapped ids.  This verifies sharing never copies a
// database file or overwrites the source document.
const exported = repository.exportDocumentBundle('timeline-main');
assert.equal(exported.snapshots.length, 1);
assert.equal(exported.workNodes.length, 1);
const imported = repository.importDocumentBundle({
  document: { id: 'timeline-imported', label: '导入排轴', createdAt: 8 },
  snapshots: exported.snapshots.map((snapshot) => ({
    id: `imported-${snapshot.id}`,
    label: snapshot.label,
    payload: snapshot.payload,
    createdAt: snapshot.createdAt,
  })),
  workNodes: exported.workNodes.map((node) => ({
    ...node,
    id: `imported-${node.id}`,
    parentNodeId: node.parentNodeId ? `imported-${node.parentNodeId}` : undefined,
  })),
});
assert.equal(imported.document.id, 'timeline-imported');
assert.equal(repository.listSnapshots('timeline-imported').length, 1);
assert.equal(repository.listWorkNodes('timeline-imported').length, 1);
assert.equal(repository.getWorkNode('imported-node-1')?.timelineId, 'timeline-imported');
assert.equal(repository.listDocuments().length, 2);
repository.close();
fs.rmSync(directory, { recursive: true, force: true });
console.log('Timeline repository smoke passed.');
