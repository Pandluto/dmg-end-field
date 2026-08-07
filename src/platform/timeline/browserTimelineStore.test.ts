import assert from 'node:assert/strict';
import {
  BrowserTimelineStoreError,
  deleteWorkNode,
  getWorkNode,
  listWorkNodeHeads,
  listWorkNodePatches,
  setCheckoutRef,
  updateWorkNode,
} from './browserTimelineStore';
import { webDatabase, type SqlPrimitive, type SqlStatement } from '../database/webDatabase';
import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';

type TestRow = Record<string, SqlPrimitive>;
type TestDatabase = {
  query: (sql: string, bind?: SqlPrimitive[]) => Promise<TestRow[]>;
  batch: (statements: SqlStatement[]) => Promise<{ changes: number; statementChanges: number[] }>;
};

const database = webDatabase as unknown as TestDatabase;
const originalQuery = database.query;
const originalBatch = database.batch;

const emptyPayload = (): TimelineSnapshotPayload => ({
  selectedCharacters: [],
  timelineData: { staffLines: [] } as TimelineSnapshotPayload['timelineData'],
  skillButtonTable: {},
  allBuffList: [],
  anomalyStateSnapshots: [],
  characterInputMap: {},
  characterComputedMap: {},
  characterDisplayCacheMap: {},
  operatorConfigPageCache: {},
});

const nodeState = {
  timelineId: 'timeline-a',
  id: 'node-a',
  contentRevision: 0,
  updatedAt: 100,
  workingPayload: emptyPayload(),
};

function nodeRow(): TestRow {
  return {
    id: nodeState.id,
    timeline_id: nodeState.timelineId,
    parent_node_id: null,
    branch_id: 'branch-a',
    label: 'Node A',
    description: '',
    status: 'open',
    approval_policy: 'auto-low-risk',
    risk_flags_json: '[]',
    logs_json: '[]',
    base_payload_json: JSON.stringify(emptyPayload()),
    working_payload_json: JSON.stringify(nodeState.workingPayload),
    content_revision: nodeState.contentRevision,
    created_at: 1,
    updated_at: nodeState.updatedAt,
  };
}

function errorCode(error: unknown): string {
  return error instanceof BrowserTimelineStoreError ? error.code : '';
}

async function run(): Promise<void> {
  const queries: Array<{ sql: string; bind: SqlPrimitive[] }> = [];
  const batches: SqlStatement[][] = [];
  let checkout: { timelineId: string; targetType: 'snapshot' | 'work-node'; targetId: string; updatedAt: number } | null = null;
  let headRows: TestRow[] | null = null;

  database.query = async (sql, bind = []) => {
    queries.push({ sql, bind });
    if (headRows && sql.includes('FROM timeline_documents document')) return headRows;
    if (sql.includes('FROM timeline_documents')) {
      return [{ id: 'timeline-a', label: 'A', created_at: 1, updated_at: 1, is_temporary: 0 }];
    }
    if (sql.includes('FROM timeline_checkout_refs')) {
      return checkout ? [{
        timeline_id: checkout.timelineId,
        target_type: checkout.targetType,
        target_id: checkout.targetId,
        updated_at: checkout.updatedAt,
      }] : [];
    }
    if (sql.includes('FROM timeline_snapshots') || sql.includes('FROM timeline_work_nodes')) {
      const timelineId = String(bind[0] ?? '');
      const targetId = String(bind[1] ?? '');
      if (sql.includes('timeline_snapshots')) {
        return timelineId === 'timeline-a' ? [{ timeline_id: 'timeline-a', id: targetId }] : [];
      }
      if (sql.includes('timeline_id = ? AND id = ?') && timelineId === 'timeline-b' && targetId === nodeState.id) {
        return [{ ...nodeRow(), timeline_id: 'timeline-b', branch_id: 'branch-b' }];
      }
      if (sql.includes('timeline_work_nodes') && targetId === nodeState.id && timelineId === nodeState.timelineId) {
        return [nodeRow()];
      }
      if (sql.includes('timeline_work_nodes') && !sql.includes('timeline_id = ? AND id = ?')) {
        return [nodeRow()];
      }
      return [];
    }
    if (sql.includes('timeline_work_node_patches')) {
      return [{
        id: 'patch-a', timeline_id: 'timeline-a', node_id: 'node-a',
        patch_json: '[]', validation_json: '{}', diff_summary_json: '{}',
        risk_flags_json: '[]', created_at: 1,
      }];
    }
    return [];
  };

  database.batch = async (statements) => {
    batches.push(statements);
    const first = statements[0];
    if (first.sql.includes('UPDATE timeline_work_nodes SET')) {
      const bind = first.bind || [];
      const expectedRevision = Number(bind[bind.length - 2]);
      const expectedUpdatedAt = Number(bind[bind.length - 1]);
      if (expectedRevision !== nodeState.contentRevision || expectedUpdatedAt !== nodeState.updatedAt) {
        return { changes: 0, statementChanges: statements.map(() => 0) };
      }
      nodeState.contentRevision = Number(bind[7]);
      nodeState.updatedAt = Number(bind[8]);
      nodeState.workingPayload = JSON.parse(String(bind[6])) as TimelineSnapshotPayload;
      return { changes: statements.length, statementChanges: statements.map(() => 1) };
    }
    if (first.sql.includes('INSERT INTO timeline_checkout_refs')) {
      const bind = first.bind || [];
      const next = {
        timelineId: String(bind[0]),
        targetType: String(bind[1]) as 'snapshot' | 'work-node',
        targetId: String(bind[2]),
        updatedAt: Number(bind[3]),
      };
      if (checkout) return { changes: 0, statementChanges: statements.map(() => 0) };
      checkout = next;
      return { changes: statements.length, statementChanges: statements.map(() => 1) };
    }
    return { changes: statements.length, statementChanges: statements.map(() => 1) };
  };

  try {
    const revisionZero = await getWorkNode('node-a', 'timeline-a');
    assert.equal(revisionZero.contentRevision, 0, 'contentRevision=0 must survive row conversion');
    const scopedRead = queries.at(-1)!;
    assert.match(scopedRead.sql, /timeline_id = \? AND id = \?/);
    assert.deepEqual(scopedRead.bind, ['timeline-a', 'node-a']);

    const sameNodeIdInOtherTimeline = await getWorkNode('node-a', 'timeline-b');
    assert.equal(sameNodeIdInOtherTimeline.timelineId, 'timeline-b', 'same nodeId must stay scoped to the requested timeline');
    await assert.rejects(
      () => setCheckoutRef({ timelineId: 'timeline-b', targetType: 'snapshot', targetId: 'snapshot-a', updatedAt: 1 }),
      (error: unknown) => errorCode(error) === 'timeline-checkout-target-not-found',
      'a snapshot target from another timeline must not pass checkout validation',
    );

    const patchStart = queries.length;
    await listWorkNodePatches('timeline-a', 'node-a');
    const patchQuery = queries.slice(patchStart).find((entry) => entry.sql.includes('timeline_work_node_patches'))!;
    assert.match(patchQuery.sql, /timeline_id = \? AND node_id = \?/);
    assert.deepEqual(patchQuery.bind.slice(0, 2), ['timeline-a', 'node-a']);

    const firstPayload = emptyPayload();
    const secondPayload = emptyPayload();
    const updates = await Promise.allSettled([
      updateWorkNode('node-a', { workingPayload: firstPayload, expectedContentRevision: 0 }),
      updateWorkNode('node-a', { workingPayload: secondPayload, expectedContentRevision: 0 }),
    ]);
    assert.equal(updates.filter((entry) => entry.status === 'fulfilled').length, 1);
    assert.equal(updates.filter((entry) => entry.status === 'rejected').length, 1);
    const rejectedUpdate = updates.find((entry) => entry.status === 'rejected');
    assert.equal(errorCode(rejectedUpdate && rejectedUpdate.status === 'rejected' ? rejectedUpdate.reason : null), 'ai-worknode-content-revision-conflict');
    assert.equal(nodeState.contentRevision, 0, 'metadata-only update must retain content revision zero');
    assert.equal(batches.filter((statements) => statements[0].sql.includes('UPDATE timeline_work_nodes SET')).length, 2);
    assert.match(batches[0][0].sql, /timeline_id = \? AND id = \?/);
    assert.match(batches[0][0].sql, /content_revision = \? AND updated_at = \?/);
    assert.equal(batches[0][0].requireChanges, true, 'CAS writes must abort the SQLite transaction on a zero-row update');

    const checkoutAttempts = await Promise.allSettled([
      setCheckoutRef({ timelineId: 'timeline-a', targetType: 'snapshot', targetId: 'snapshot-a', updatedAt: 10 }),
      setCheckoutRef({ timelineId: 'timeline-a', targetType: 'snapshot', targetId: 'snapshot-b', updatedAt: 11 }),
    ]);
    assert.equal(checkoutAttempts.filter((entry) => entry.status === 'fulfilled').length, 1);
    assert.equal(checkoutAttempts.filter((entry) => entry.status === 'rejected').length, 1);
    const rejectedCheckout = checkoutAttempts.find((entry) => entry.status === 'rejected');
    assert.equal(errorCode(rejectedCheckout && rejectedCheckout.status === 'rejected' ? rejectedCheckout.reason : null), 'timeline-checkout-conflict');
    assert.equal(checkout?.targetType, 'snapshot');
    assert.equal(checkout?.targetId, 'snapshot-a');
    const checkoutWrite = batches.find((statements) => statements[0].sql.includes('INSERT INTO timeline_checkout_refs'))!;
    assert.match(checkoutWrite[0].sql, /WHERE NOT EXISTS/);
    assert.equal(checkoutWrite[0].requireChanges, true, 'checkout CAS must abort the SQLite transaction on a stale write');

    headRows = [
      { timeline_id: 'timeline-b', target_type: 'work-node', target_id: 'node-b', head_node_id: 'node-b', checkout_updated_at: 10, node_content_revision: 9 },
      { timeline_id: 'timeline-a', target_type: 'work-node', target_id: 'node-a', head_node_id: 'node-a', checkout_updated_at: 20, node_content_revision: 0 },
      { timeline_id: 'timeline-c', target_type: 'snapshot', target_id: 'snapshot-c', checkout_updated_at: 30, node_content_revision: null },
    ];
    const heads = await listWorkNodeHeads();
    assert.deepEqual(heads.heads['timeline-a'], { nodeId: 'node-a', revision: 0 });
    assert.equal(heads.headNodeId, 'node-a', 'head selection must follow checkout recency, not nodes[0] or revision sort');
    assert.equal(heads.revision, 0);

    const reviewedDeleteExpectation = {
      nodes: [{
        id: nodeState.id,
        contentRevision: nodeState.contentRevision,
        updatedAt: nodeState.updatedAt,
      }],
    };
    await deleteWorkNode(nodeState.id, nodeState.timelineId, reviewedDeleteExpectation);
    const deleteBatch = batches.find((statements) => (
      statements[0].sql.includes('WITH RECURSIVE descendants')
        && statements[0].sql.includes('DELETE FROM timeline_work_nodes')
    ))!;
    assert.ok(deleteBatch, 'reviewed subtree delete must use one guarded SQLite transaction');
    assert.match(deleteBatch[0].sql, /SELECT COUNT\(\*\) FROM descendants/u);
    assert.match(deleteBatch[0].sql, /content_revision = \? AND current\.updated_at = \?/u);
    assert.equal(deleteBatch[0].requireChanges, true);

    const normalBatch = database.batch;
    database.batch = async (statements) => (
      statements[0].sql.includes('DELETE FROM timeline_work_nodes')
        ? { changes: 0, statementChanges: statements.map(() => 0) }
        : normalBatch(statements)
    );
    await assert.rejects(
      () => deleteWorkNode(nodeState.id, nodeState.timelineId, reviewedDeleteExpectation),
      (error: unknown) => errorCode(error) === 'timeline-work-node-delete-review-stale',
      'a concurrent subtree/revision change must make the atomic delete fail closed',
    );
    database.batch = normalBatch;
  } finally {
    database.query = originalQuery;
    database.batch = originalBatch;
  }
}

await run();
console.log('browser timeline store scoped CAS contract: PASS');
