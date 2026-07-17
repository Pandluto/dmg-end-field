import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { createAiTimelineWorkNodeStore } = require('../electron/ai-timeline-work-node-store.cjs');

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'def-work-node-sqlite-'));
const databasePath = path.join(tempDirectory, 'work-nodes.sqlite3');
const legacyJsonPath = path.join(tempDirectory, 'ai-timeline-worknodes.json');

const payloadA = {
  selectedCharacters: [],
  timelineData: { staffLines: [] },
  skillButtonTable: {},
  allBuffList: [],
};
const payloadB = { ...payloadA, marker: 'changed' };

function node(id, createdAt, options = {}) {
  return {
    id,
    ...(options.parentNodeId ? { parentNodeId: options.parentNodeId } : {}),
    saveId: options.saveId || 'save-1',
    branchId: options.branchId || id,
    createdAt,
    updatedAt: createdAt,
    label: options.label || id,
    status: 'open',
    basePayload: options.basePayload || payloadA,
    workingPayload: options.workingPayload || payloadA,
    baseSummary: { characterCount: 0, buttonCount: 0, buffCount: 0 },
    workingSummary: { characterCount: 0, buttonCount: 0, buffCount: 0 },
    approvalPolicy: 'auto-low-risk',
    riskFlags: [],
    logs: [],
  };
}

const legacyRoot = node('root', 1);
const legacyChild = node('child', 2);
const legacyBranch = node('branch', 3, { branchId: 'branch-3', label: '[branch] branch' });
const legacyCommit = {
  id: 'commit-branch',
  nodeId: 'branch',
  saveId: 'save-1',
  branchId: 'branch-3',
  createdAt: 4,
  label: 'branch commit',
  summary: {},
  basePayload: payloadA,
  appliedPayload: payloadB,
  riskFlags: [],
  approval: { mode: 'manual', approvedAt: 4, approvedBy: 'user', rationale: 'smoke' },
  checkoutApplied: true,
};

fs.writeFileSync(legacyJsonPath, JSON.stringify({
  type: 'def.ai-timeline.worknodes.v1',
  schemaVersion: 1,
  nodes: [legacyBranch, legacyChild, legacyRoot],
  commits: [legacyCommit],
}));

let store = createAiTimelineWorkNodeStore({ databasePath, legacyJsonPath });

const migrated = store.list();
assert.equal(migrated.nodes.length, 3);
assert.equal(migrated.commits.length, 1);
assert.equal(migrated.headNodeId, 'branch');
assert.equal(migrated.nodes.find((item) => item.id === 'child')?.parentNodeId, 'root');
assert.equal(migrated.nodes.find((item) => item.id === 'branch')?.parentNodeId, 'root');
assert.equal('basePayload' in migrated.nodes[0], false);
assert.equal('workingPayload' in migrated.nodes[0], false);
assert.equal('appliedPayload' in migrated.commits[0], false);
assert.deepEqual(store.getNode('branch').workingPayload, payloadA);

assert.throws(
  () => store.deleteSubtree('root'),
  (error) => error?.code === 'ai-worknode-current-checkout-protected' && error?.status === 409,
);

const staleProjectionHead = node('stale-projection-head', 5, { parentNodeId: 'root' });
store.saveNode(staleProjectionHead);
store.setHead('save-1', staleProjectionHead.id);
const purgedProjection = store.deleteSubtreeProjection(staleProjectionHead.id);
assert.deepEqual(purgedProjection.deletedNodeIds, [staleProjectionHead.id]);
assert.equal(store.getNode(staleProjectionHead.id), null);
assert.equal(store.getHead('save-1'), null);

store.setHead('save-1', 'child');
const grayParent = node('gray-parent', 5, { parentNodeId: 'root', workingPayload: payloadB });
const grayChild = node('gray-child', 6, { parentNodeId: 'gray-parent', workingPayload: payloadB });
store.saveNode(grayParent);
store.saveNode(grayChild);
const deleted = store.deleteSubtree('gray-parent');
assert.deepEqual(new Set(deleted.deletedNodeIds), new Set(['gray-parent', 'gray-child']));
assert.equal(store.getNode('gray-parent'), null);
assert.equal(store.getNode('gray-child'), null);

const db = new DatabaseSync(databasePath);
const snapshotCount = db.prepare('SELECT COUNT(*) AS count FROM work_node_snapshots').get().count;
assert.equal(snapshotCount, 2);
db.close();

store.close();
fs.writeFileSync(legacyJsonPath, '{broken legacy json');
store = createAiTimelineWorkNodeStore({ databasePath, legacyJsonPath });
assert.equal(store.list().nodes.length, 3);
// Old persisted projections predate the cross-save parent guard. Recreate
// that shape at the SQL layer to verify deletion removes the whole subtree and
// every head that would otherwise restrict the parent delete.
store.close();
const crossSaveDb = new DatabaseSync(databasePath);
crossSaveDb.prepare("UPDATE work_nodes SET save_id = 'cross-timeline-child-save' WHERE id = 'child'").run();
crossSaveDb.prepare(`
  INSERT INTO work_node_heads (save_id, current_node_id, revision, updated_at)
  VALUES ('cross-timeline-child-save', 'child', 1, 1)
`).run();
crossSaveDb.close();
store = createAiTimelineWorkNodeStore({ databasePath, legacyJsonPath });
const deletedTimeline = store.deleteTimeline('save-1');
assert.equal(deletedTimeline.deletedNodeIds.length, 3);
assert.equal(store.list().nodes.length, 0);
assert.equal(store.getHead('cross-timeline-child-save'), null);
store.close();

fs.rmSync(tempDirectory, { recursive: true, force: true });
console.log('AI timeline Work Node SQLite smoke passed.');
