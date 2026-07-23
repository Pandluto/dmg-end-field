import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { createTimelineRepository } = require('../electron/timeline-repository.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-timeline-document-authority-'));
const databasePath = path.join(root, 'timeline.sqlite3');
const payload = { selectedCharacters: [], timelineData: { staffLines: [] }, skillButtonTable: {}, allBuffList: [] };
let repository;

function bundle(id, label = id) {
  return {
    document: { id, label, createdAt: 10 },
    snapshots: [{ id: `${id}-snapshot`, label: 'baseline', payload, createdAt: 10 }],
    workNodes: [{
      id: `${id}-node`, branchId: `${id}-branch`, label: 'fixture node', status: 'open', approvalPolicy: 'manual',
      basePayload: payload, workingPayload: payload, createdAt: 10, updatedAt: 10, contentRevision: 10,
    }],
    commits: [{
      id: `${id}-commit`, nodeId: `${id}-node`, branchId: `${id}-branch`, label: 'fixture commit', summary: {},
      basePayload: payload, appliedPayload: payload, riskFlags: [], approval: {}, checkoutApplied: false, createdAt: 10,
    }],
    checkoutRef: { targetType: 'work-node', targetId: `${id}-node`, updatedAt: 10 },
  };
}

try {
  // Create a pre-authority archive directly so migration is exercised without
  // depending on a production database or on a newer repository helper.
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE timeline_documents (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      is_temporary INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived_at INTEGER
    );
  `);
  legacy.prepare(`INSERT INTO timeline_documents (id, label, is_temporary, created_at, updated_at, archived_at)
    VALUES (?, ?, ?, ?, ?, NULL)`).run('legacy-formal', 'Legacy formal', 0, 1, 1);
  legacy.prepare(`INSERT INTO timeline_documents (id, label, is_temporary, created_at, updated_at, archived_at)
    VALUES (?, ?, ?, ?, ?, NULL)`).run('legacy-temporary', 'Legacy temporary', 1, 1, 1);
  legacy.close();

  repository = createTimelineRepository({ databasePath });
  assert.equal(repository.getMeta('schema_version'), '5', 'the document authority migration advances the schema version');
  assert.equal(repository.getDocument('legacy-formal')?.persistenceKind, 'formal', 'pre-authority rows migrate to formal authority');
  assert.equal(repository.getDocument('legacy-temporary')?.persistenceKind, 'formal', 'pre-authority rows default to formal authority');
  assert.equal(repository.getDocument('legacy-temporary')?.isTemporary, true, 'the legacy temporary boundary survives migration');
  assert.throws(() => repository.upsertSessionAxisBinding({
    id: 'legacy-temporary-binding', timelineId: 'legacy-temporary', host: 'workbench', opencodeSessionId: 'legacy-temp-session',
  }), { code: 'blocked-temporary-workspace' });

  const formal = repository.importDocumentBundle({ ...bundle('formal-source'), document: { id: 'formal-source', label: 'Formal source', persistenceKind: 'formal', createdAt: 10 } });
  assert.equal(formal.document.persistenceKind, 'formal');
  const exported = repository.exportDocumentBundle('formal-source');
  const roundTrip = repository.importDocumentBundle({
    ...exported,
    document: { ...exported.document, id: 'formal-roundtrip', label: 'Formal roundtrip' },
    snapshots: exported.snapshots.map((snapshot) => ({ ...snapshot, id: `roundtrip-${snapshot.id}` })),
    workNodes: exported.workNodes.map((node) => ({ ...node, id: `roundtrip-${node.id}` })),
    commits: exported.commits.map((commit) => ({ ...commit, id: `roundtrip-${commit.id}`, nodeId: `roundtrip-${commit.nodeId}` })),
    checkoutRef: { ...exported.checkoutRef, targetId: `roundtrip-${exported.checkoutRef.targetId}` },
  });
  assert.equal(roundTrip.document.persistenceKind, 'formal', 'ordinary bundle round trips retain formal authority');

  repository.ensureDocument({ id: 'temporary-current', label: 'Temporary current', isTemporary: true });
  assert.equal(repository.getDocument('temporary-current')?.persistenceKind, 'temporary');
  assert.equal(repository.getDocument('temporary-current')?.isTemporary, true);
  assert.throws(() => repository.upsertSessionAxisBinding({
    id: 'temporary-binding', timelineId: 'temporary-current', host: 'workbench', opencodeSessionId: 'temporary-session',
  }), { code: 'blocked-temporary-workspace' });

  assert.throws(() => repository.importDocumentBundle({
    ...bundle('forged-harness-import'),
    document: { id: 'forged-harness-import', label: 'Forged harness fixture', persistenceKind: 'harness-fixture', createdAt: 10 },
  }), { code: 'reserved-harness-fixture-authority', status: 403 }, 'bundle input cannot forge harness authority');
  assert.throws(() => repository.ensureDocument({
    id: 'forged-harness-document', label: 'Forged harness fixture', kind: 'harness-fixture',
  }), { code: 'reserved-harness-fixture-authority', status: 403 }, 'ordinary document creation cannot forge harness authority');

  const harnessFixture = repository.createHarnessFixtureDocumentBundle({
    ...bundle('harness-fixture-document'),
    document: { id: 'harness-fixture-document', label: 'Trusted Harness fixture', persistenceKind: 'formal', createdAt: 10 },
  });
  assert.equal(harnessFixture.document.persistenceKind, 'harness-fixture', 'the trusted API, not bundle data, grants fixture authority');
  assert.equal(repository.getDocument('harness-fixture-document'), undefined, 'ordinary direct reads cannot bypass fixture visibility');
  assert.equal(repository.getHarnessFixtureDocument('harness-fixture-document')?.persistenceKind, 'harness-fixture');
  assert.equal(repository.listDocuments().some((document) => document.id === 'harness-fixture-document'), false, 'fixture documents are hidden from ordinary listing');
  assert.equal(repository.getSnapshot('harness-fixture-document-snapshot'), null, 'ordinary snapshot reads cannot bypass fixture visibility');
  assert.deepEqual(repository.listSnapshots('harness-fixture-document'), [], 'ordinary snapshot listing cannot bypass fixture visibility');
  assert.equal(repository.getCheckoutRef('harness-fixture-document'), undefined, 'ordinary checkout reads cannot bypass fixture visibility');
  assert.equal(repository.getWorkNode('harness-fixture-document-node'), null, 'ordinary node reads cannot bypass fixture visibility');
  assert.deepEqual(repository.listWorkNodes('harness-fixture-document'), [], 'ordinary node listing cannot bypass fixture visibility');
  assert.equal(repository.getWorkNodeCommit('harness-fixture-document-commit'), null, 'ordinary commit reads cannot bypass fixture visibility');
  assert.equal(repository.getLatestWorkNodeCommit('harness-fixture-document-node'), null, 'ordinary latest-commit reads cannot bypass fixture visibility');
  assert.deepEqual(repository.listWorkNodeCommits('harness-fixture-document'), [], 'ordinary commit listing cannot bypass fixture visibility');
  assert.deepEqual(repository.listAuditEvents('harness-fixture-document'), [], 'ordinary audit listing cannot bypass fixture visibility');
  assert.deepEqual(repository.listWorkNodePatches('harness-fixture-document-node'), [], 'ordinary patch listing cannot bypass fixture visibility');
  assert.equal(repository.getHarnessFixtureWorkNode('harness-fixture-document-node')?.timelineId, 'harness-fixture-document');
  assert.throws(() => repository.exportDocumentBundle('harness-fixture-document'), { code: 'timeline-document-not-found', status: 404 });
  assert.equal(repository.exportHarnessFixtureDocumentBundle('harness-fixture-document').checkoutRef?.targetId, 'harness-fixture-document-node');
  assert.throws(() => repository.ensureDocument({ id: 'harness-fixture-document', label: 'Forged update' }), { code: 'harness-fixture-document-not-found', status: 404 });
  assert.throws(() => repository.createOrReuseSnapshot({
    id: 'forged-harness-snapshot', timelineId: 'harness-fixture-document', label: 'Forged snapshot', payload,
  }), { code: 'timeline-document-not-found', status: 404 });
  assert.throws(() => repository.setCheckoutRef({
    timelineId: 'harness-fixture-document', targetType: 'work-node', targetId: 'harness-fixture-document-node',
  }), { code: 'timeline-document-not-found', status: 404 });
  assert.throws(() => repository.appendAuditEvent({
    id: 'forged-harness-audit', timelineId: 'harness-fixture-document', eventType: 'forged', subjectType: 'document', subjectId: 'harness-fixture-document',
  }), { code: 'timeline-document-not-found', status: 404 });
  assert.throws(() => repository.importWorkNode({
    id: 'forged-harness-node', timelineId: 'harness-fixture-document', branchId: 'forged', label: 'Forged node', status: 'open', approvalPolicy: 'manual', basePayload: payload, workingPayload: payload,
  }), { code: 'timeline-document-not-found', status: 404 });
  assert.throws(() => repository.appendWorkNodePatch({
    id: 'forged-harness-patch', timelineId: 'harness-fixture-document', nodeId: 'harness-fixture-document-node', patch: [],
  }), { code: 'timeline-work-node-not-found', status: 404 });
  assert.throws(() => repository.importWorkNodeCommit({
    id: 'forged-harness-commit', timelineId: 'harness-fixture-document', nodeId: 'harness-fixture-document-node', basePayload: payload, appliedPayload: payload,
  }), { code: 'timeline-work-node-not-found', status: 404 });
  assert.throws(() => repository.deleteWorkNodeSubtree('harness-fixture-document-node'), { code: 'timeline-work-node-not-found', status: 404 });
  assert.throws(() => repository.importLegacyArchive({
    timelineId: 'harness-fixture-document', documentLabel: 'Forged archive overwrite', snapshots: [{ id: 'forged-legacy', payload }],
  }), { code: 'harness-fixture-document-not-found', status: 404 });
  assert.throws(() => repository.upsertSessionAxisBinding({
    id: 'ordinary-harness-binding', timelineId: 'harness-fixture-document', host: 'workbench', opencodeSessionId: 'ordinary-session',
  }), { code: 'blocked-harness-fixture-workspace', status: 409 }, 'ordinary binding rejects hidden fixtures');

  const harnessBinding = repository.upsertHarnessFixtureSessionAxisBinding({
    id: 'trusted-harness-binding', timelineId: 'harness-fixture-document', host: 'workbench', opencodeSessionId: 'trusted-session', boundNodeId: 'harness-fixture-document-node',
  });
  assert.equal(repository.getSessionAxisContext(harnessBinding.id), null, 'ordinary session context does not expose fixture bindings');
  assert.equal(repository.getSessionAxisBinding(harnessBinding.id), undefined, 'ordinary binding lookup cannot bypass fixture visibility');
  assert.equal(repository.getSessionAxisBindingBySession('workbench', 'trusted-session'), undefined, 'ordinary session lookup cannot bypass fixture visibility');
  assert.equal(repository.deleteSessionAxisBinding(harnessBinding.id).deleted, false, 'ordinary binding deletion cannot mutate fixture bindings');
  assert.equal(repository.getHarnessFixtureSessionAxisBinding(harnessBinding.id)?.id, harnessBinding.id);
  assert.equal(repository.getHarnessFixtureSessionAxisBindingBySession('workbench', 'trusted-session')?.id, harnessBinding.id);
  const cleanupBinding = repository.upsertHarnessFixtureSessionAxisBinding({
    id: 'trusted-harness-cleanup-binding', timelineId: 'harness-fixture-document', host: 'workbench', opencodeSessionId: 'trusted-cleanup-session', boundNodeId: 'harness-fixture-document-node',
  });
  assert.equal(repository.deleteHarnessFixtureSessionAxisBinding(cleanupBinding.id).deleted, true, 'trusted cleanup can explicitly unbind a fixture session');
  assert.equal(repository.getHarnessFixtureSessionAxisBinding(cleanupBinding.id), undefined);
  assert.equal(repository.getHarnessFixtureSessionAxisContext(harnessBinding.id)?.document?.persistenceKind, 'harness-fixture');
  assert.throws(() => repository.deleteDocument('harness-fixture-document'), { code: 'timeline-document-not-found', status: 404 });

  const deleted = repository.deleteHarnessFixtureDocument('harness-fixture-document');
  assert.equal(deleted.deletedNodeIds.includes('harness-fixture-document-node'), true, 'trusted fixture deletion deletes the fixture graph');
  assert.equal(repository.getHarnessFixtureDocument('harness-fixture-document'), undefined);
  assert.equal(repository.getWorkNode('harness-fixture-document-node'), null);
  assert.equal(repository.getSessionAxisBinding('trusted-harness-binding'), undefined, 'fixture deletion cascades its trusted binding');
  assert.equal(repository.getHarnessFixtureSessionAxisBinding('trusted-harness-binding'), undefined, 'fixture deletion leaves no trusted binding orphan');

  console.log('Timeline document authority contract: PASS');
} finally {
  repository?.close();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
