import assert from 'node:assert/strict';
import { saveSnapshot, setCheckoutRef } from './browserTimelineStore';
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
const snapshots = new Map<string, TestRow>();
let checkout: TestRow | null = null;
let snapshotMatchReads = 0;
let checkoutReads = 0;
let releaseSnapshotReads!: () => void;
let releaseCheckoutReads!: () => void;
const snapshotReadBarrier = new Promise<void>((resolve) => { releaseSnapshotReads = resolve; });
const checkoutReadBarrier = new Promise<void>((resolve) => { releaseCheckoutReads = resolve; });

const payload: TimelineSnapshotPayload = {
  selectedCharacters: [],
  timelineData: { staffLines: [] } as TimelineSnapshotPayload['timelineData'],
  skillButtonTable: {},
  allBuffList: [],
  anomalyStateSnapshots: [],
  characterInputMap: {},
  characterComputedMap: {},
  characterDisplayCacheMap: {},
  operatorConfigPageCache: {},
};

database.query = async (sql, bind = []) => {
  if (sql.includes('FROM timeline_documents')) {
    return [{ id: 'timeline-race', label: 'Race', created_at: 1, updated_at: 1, is_temporary: 0 }];
  }
  if (sql.includes('WHERE timeline_id = ? AND payload_hash = ?')) {
    const captured = [...snapshots.values()].filter((row) => (
      row.timeline_id === bind[0] && row.payload_hash === bind[1]
    ));
    snapshotMatchReads += 1;
    if (snapshotMatchReads === 2) releaseSnapshotReads();
    await snapshotReadBarrier;
    return captured;
  }
  if (sql.includes('FROM timeline_checkout_refs')) {
    const captured = checkout ? [{ ...checkout }] : [];
    checkoutReads += 1;
    if (checkoutReads === 2) releaseCheckoutReads();
    if (checkoutReads <= 2) await checkoutReadBarrier;
    return captured;
  }
  if (sql.includes('SELECT timeline_id FROM timeline_snapshots')) {
    const row = snapshots.get(String(bind[1]));
    return row?.timeline_id === bind[0] ? [{ timeline_id: row.timeline_id }] : [];
  }
  if (sql.includes('FROM timeline_snapshots WHERE timeline_id = ? AND id = ?')) {
    const row = snapshots.get(String(bind[1]));
    return row?.timeline_id === bind[0] ? [{ ...row }] : [];
  }
  if (sql.includes('FROM timeline_snapshots WHERE id = ?')) {
    const row = snapshots.get(String(bind[0]));
    return row ? [{ ...row }] : [];
  }
  return [];
};

database.batch = async (statements) => {
  const first = statements[0]!;
  if (first.sql.includes('INSERT INTO timeline_snapshots')) {
    const bind = first.bind || [];
    const id = String(bind[0]);
    const inserted = !snapshots.has(id);
    if (inserted) {
      snapshots.set(id, {
        id,
        timeline_id: String(bind[1]),
        label: String(bind[2]),
        payload_json: String(bind[3]),
        payload_hash: String(bind[4]),
        created_at: Number(bind[5]),
        archived: 0,
      });
    }
    assert.match(first.sql, /ON CONFLICT\(id\) DO NOTHING/u);
    assert.match(statements[1]!.sql, /WHERE changes\(\) > 0/u);
    const changes = inserted ? 1 : 0;
    return { changes: changes * statements.length, statementChanges: statements.map(() => changes) };
  }
  if (first.sql.includes('INSERT INTO timeline_checkout_refs')) {
    const bind = first.bind || [];
    if (!checkout) {
      checkout = {
        timeline_id: String(bind[0]),
        target_type: String(bind[1]),
        target_id: String(bind[2]),
        updated_at: Number(bind[3]),
      };
      return { changes: statements.length, statementChanges: statements.map(() => 1) };
    }
    throw new Error('WEB_DATABASE_REQUIRED_CHANGE:0');
  }
  return { changes: statements.length, statementChanges: statements.map(() => 1) };
};

try {
  const saved = await Promise.all([
    saveSnapshot({
      id: 'timeline-race-initial',
      timelineId: 'timeline-race',
      label: '初始排轴',
      payload,
      createdAt: 100,
    }),
    saveSnapshot({
      id: 'timeline-race-initial',
      timelineId: 'timeline-race',
      label: '初始排轴',
      payload,
      createdAt: 100,
    }),
  ]);
  assert.equal(snapshots.size, 1, 'concurrent bootstrap must persist one physical snapshot');
  assert.deepEqual(saved.map((entry) => entry.snapshot.id), [
    'timeline-race-initial',
    'timeline-race-initial',
  ]);
  assert.deepEqual(saved.map((entry) => entry.reused).sort(), [false, true]);

  const checkoutInput = {
    timelineId: 'timeline-race',
    targetType: 'snapshot' as const,
    targetId: 'timeline-race-initial',
    updatedAt: 100,
  };
  const checkouts = await Promise.all([
    setCheckoutRef(checkoutInput),
    setCheckoutRef(checkoutInput),
  ]);
  assert.deepEqual(checkouts, [checkoutInput, checkoutInput]);
  assert.deepEqual(checkout, {
    timeline_id: 'timeline-race',
    target_type: 'snapshot',
    target_id: 'timeline-race-initial',
    updated_at: 100,
  });
} finally {
  database.query = originalQuery;
  database.batch = originalBatch;
}

console.log('browser timeline snapshot/bootstrap race contract: PASS');
