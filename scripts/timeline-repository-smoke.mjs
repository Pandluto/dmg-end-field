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
repository.ensureDocument({ id: 'timeline-legacy-import', label: '旧存档导入', createdAt: 4 });
const remappedId = repository.createOrReuseSnapshot({
  id: 'snapshot-1', timelineId: 'timeline-legacy-import', label: '同名旧存档',
  payload: { ...payload, allBuffList: [{ id: 'legacy-buff' }] }, createdAt: 4,
});
assert.equal(remappedId.reused, false);
assert.notEqual(remappedId.snapshot.id, 'snapshot-1');
assert.equal(repository.listSnapshots('timeline-legacy-import').length, 1);
repository.ensureDocument({ id: 'timeline-archived-import', label: '归档旧存档', createdAt: 4 });
repository.createOrReuseSnapshot({
  id: 'archived-snapshot', timelineId: 'timeline-archived-import', label: '已归档旧存档', payload, createdAt: 4,
});
repository.archiveSnapshot('archived-snapshot');
const restoredArchivedId = repository.createOrReuseSnapshot({
  id: 'archived-snapshot', timelineId: 'timeline-archived-import', label: '恢复归档旧存档', payload, createdAt: 4,
});
assert.equal(restoredArchivedId.reused, true);
assert.equal(restoredArchivedId.snapshot.id, 'archived-snapshot');
assert.equal(repository.listSnapshots('timeline-archived-import').length, 1);
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
const canonicalCommit = repository.importWorkNodeCommit({
  id: 'commit-1', nodeId: 'node-1', timelineId: 'timeline-main', branchId: 'branch-1', label: 'Commit',
  summary: { changedButtonCount: 0 }, basePayload: payload, appliedPayload: payload,
  riskFlags: [], approval: { mode: 'auto', approvedBy: 'ai', rationale: 'smoke' }, checkoutApplied: false, createdAt: 7,
});
assert.equal(canonicalCommit.id, 'commit-1');
assert.equal(repository.getLatestWorkNodeCommit('node-1')?.id, 'commit-1');
assert.equal(repository.listWorkNodeCommits('timeline-main').length, 1);
assert.throws(() => repository.importWorkNodeCommit({
  id: 'commit-orphan', nodeId: 'missing-node', timelineId: 'timeline-main', branchId: 'bad', label: 'Bad',
  basePayload: payload, appliedPayload: payload,
}), { code: 'timeline-work-node-not-found', status: 404 });
assert.throws(() => repository.importWorkNode({
  id: 'node-1', timelineId: 'timeline-main', branchId: 'branch-1', label: 'Invalid transition', status: 'applied',
  basePayload: payload, workingPayload: payload,
}), { code: 'invalid-timeline-work-node-transition' });
repository.importWorkNode({
  id: 'node-1', timelineId: 'timeline-main', branchId: 'branch-1', label: 'Validated', status: 'validated',
  basePayload: payload, workingPayload: payload,
});
assert.throws(() => repository.importWorkNode({
  id: 'node-1', timelineId: 'timeline-legacy-import', branchId: 'branch-1', label: 'Cross-document collision', status: 'validated',
  basePayload: payload, workingPayload: payload,
}), { code: 'timeline-work-node-id-conflict' });
assert.throws(() => repository.importWorkNode({
  id: 'node-invalid-status', timelineId: 'timeline-main', branchId: 'invalid', label: 'Invalid', status: 'not-a-status',
  basePayload: payload, workingPayload: payload,
}), { code: 'invalid-timeline-work-node-status' });
assert.throws(() => repository.importWorkNode({
  id: 'node-orphan', timelineId: 'timeline-main', parentNodeId: 'missing-parent', branchId: 'invalid', label: 'Orphan',
  basePayload: payload, workingPayload: payload,
}), { code: 'timeline-work-node-parent-not-found', status: 404 });
assert.throws(() => repository.importWorkNode({
  id: 'node-cross-parent', timelineId: 'timeline-legacy-import', parentNodeId: 'node-1', branchId: 'invalid', label: 'Cross parent',
  basePayload: payload, workingPayload: payload,
}), { code: 'timeline-work-node-cross-document-parent', status: 409 });
repository.appendWorkNodePatch({
  id: 'patch-1', timelineId: 'timeline-main', nodeId: 'node-1',
  patch: [{ op: 'moveButton', target: { buttonId: 'button-1' }, nodeIndex: 1 }],
  validation: { ok: true, issues: [] }, diffSummary: { changedButtonCount: 1 }, riskFlags: [], createdAt: 7,
});
assert.throws(() => repository.appendWorkNodePatch({
  id: 'patch-1', timelineId: 'timeline-main', nodeId: 'node-1', patch: [],
  validation: { ok: true }, diffSummary: {}, riskFlags: [],
}), { code: 'timeline-work-node-patch-id-conflict', status: 409 });
assert.throws(() => repository.setCheckoutRef({
  timelineId: 'timeline-main', targetType: 'work-node', targetId: 'missing-node', updatedAt: 8,
}), { code: 'timeline-checkout-target-not-found', status: 404 });
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
assert.equal(repository.listDocuments().length, 4);
repository.ensureDocument({ id: 'timeline-imported', label: '主排轴', preserveExistingLabel: true });
assert.equal(repository.getDocument('timeline-imported')?.label, imported.document.label);
const deletedDocument = repository.deleteDocument('timeline-imported');
assert.equal(deletedDocument.deletedNodeIds.length, 1);
assert.equal(deletedDocument.deletedSnapshotCount, 1);
assert.equal(repository.getDocument('timeline-imported'), undefined);
assert.equal(repository.getWorkNode('imported-node-1'), null);
assert.equal(repository.listDocuments().length, 3);
repository.close();
fs.rmSync(directory, { recursive: true, force: true });
console.log('Timeline repository smoke passed.');
