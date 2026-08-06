import assert from 'node:assert/strict';
import {
  asCommandId,
  asDatabaseGeneration,
  asDefSessionId,
  asDefTurnId,
  asTimelineId,
  asToolCallId,
  asWorkspaceId,
  type DatabaseGeneration,
} from '../../../agent/core/contracts/ids.ts';
import type { JsonObject } from '../../../agent/core/contracts/json.ts';
import type { ProductCommandEnvelope } from '../../../agent/core/contracts/product.ts';
import type { SqlPrimitive, SqlStatement } from '../database/webDatabase.ts';
import {
  AGENT_RUNTIME_SCHEMA_VERSION,
  COMMAND_JOURNAL_SCHEMA_VERSION,
  createBrowserProductStore,
  type BrowserProductDatabaseAdapter,
} from './browserProductStore.ts';

type MemoryRow = Record<string, SqlPrimitive>;

function cloneRow(row: MemoryRow): MemoryRow {
  return { ...row };
}

class MemoryBrowserProductAdapter implements BrowserProductDatabaseAdapter {
  runtime: MemoryRow | null = null;
  snapshot: MemoryRow | null = null;
  readonly journal = new Map<string, MemoryRow>();
  readonly batches: SqlStatement[][] = [];
  fixture: { value: string; revision: number } | null = null;
  failFixtureReceipt = false;

  async initialize(): Promise<{ name: string }> {
    return { name: 'memory-browser-product-adapter' };
  }

  async query<T extends MemoryRow>(sql: string, bind: SqlPrimitive[] = []): Promise<T[]> {
    if (sql.includes('FROM agent_runtime_meta')) {
      return (this.runtime ? [cloneRow(this.runtime)] : []) as T[];
    }
    if (sql.includes('FROM agent_runtime_snapshot')) {
      return (this.snapshot ? [cloneRow(this.snapshot)] : []) as T[];
    }
    if (sql.includes('FROM agent_command_journal')) {
      const rows = bind.length
        ? [this.journal.get(String(bind[0]))].filter((row): row is MemoryRow => Boolean(row))
        : [...this.journal.values()];
      if (sql.includes("status IN ('queued', 'dispatched', 'claimed', 'reconciling')")) {
        return rows.filter((row) => (
          row.status === 'queued'
          || row.status === 'dispatched'
          || row.status === 'claimed'
          || row.status === 'reconciling'
        )) as T[];
      }
      return rows.map(cloneRow) as T[];
    }
    if (sql.includes('FROM test_only_agent_mutation_fixture')) {
      return (this.fixture ? [{ value: this.fixture.value, revision: this.fixture.revision }] : []) as unknown as T[];
    }
    throw new Error(`Memory adapter does not implement query: ${sql}`);
  }

  async execute(): Promise<{ changes: number }> {
    throw new Error('The browser product contract intentionally uses batch for its writes.');
  }

  async batch(statements: SqlStatement[]): Promise<{ changes: number }> {
    const previousRuntime = this.runtime ? cloneRow(this.runtime) : null;
    const previousSnapshot = this.snapshot ? cloneRow(this.snapshot) : null;
    const previousJournal = new Map([...this.journal].map(([key, row]) => [key, cloneRow(row)]));
    const previousFixture = this.fixture ? { ...this.fixture } : null;
    this.batches.push(statements);
    try {
      for (const statement of statements) this.apply(statement);
      return { changes: statements.length };
    } catch (error) {
      this.runtime = previousRuntime;
      this.snapshot = previousSnapshot;
      this.journal.clear();
      for (const [key, row] of previousJournal) this.journal.set(key, row);
      this.fixture = previousFixture;
      throw error;
    }
  }

  private apply(statement: SqlStatement): void {
    const sql = statement.sql.replace(/\s+/g, ' ').trim();
    const bind = statement.bind || [];
    if (sql.startsWith('CREATE TABLE') || sql.startsWith('CREATE INDEX')) return;

    if (sql.startsWith('INSERT OR IGNORE INTO agent_runtime_meta')) {
      if (!this.runtime) {
        this.runtime = {
          id: 1,
          workspace_id: bind[0],
          database_generation: bind[1],
          agent_runtime_schema_version: bind[2],
          command_journal_schema_version: bind[3],
          updated_at: bind[4],
        };
      }
      return;
    }

    if (sql.startsWith('UPDATE agent_runtime_meta SET database_generation')) {
      if (!this.runtime) throw new Error('runtime metadata is missing');
      this.runtime.database_generation = bind[0];
      this.runtime.updated_at = bind[1];
      return;
    }

    if (sql.startsWith('DELETE FROM agent_runtime_snapshot')) {
      this.snapshot = null;
      return;
    }

    if (sql.startsWith('INSERT OR REPLACE INTO agent_runtime_snapshot')) {
      const values = [
        'id', 'workspace_id', 'database_generation', 'timeline_id', 'checkout_target_id',
        'checkout_updated_at', 'content_revision', 'snapshot_digest', 'captured_at',
        'payload_json', 'updated_at',
      ];
      this.snapshot = Object.fromEntries([[values[0], 1], ...values.slice(1).map((key, index) => [key, bind[index]])]);
      return;
    }

    if (sql.startsWith('INSERT OR IGNORE INTO agent_command_journal')) {
      const commandId = String(bind[0]);
      if (this.journal.has(commandId)) return;
      const values = [
        'command_id', 'command_journal_schema_version', 'operation', 'command_payload_json',
        'workspace_id', 'database_generation', 'timeline_id', 'checkout_target_id',
        'checkout_updated_at', 'expected_revision', 'expected_digest',
        'def_session_id', 'def_turn_id', 'tool_call_id', 'status', 'executor_lease_id',
        'before_revision', 'after_revision', 'browser_result_json', 'visible_postcondition_json',
        'receipt_digest', 'error_code', 'error_message', 'accepted_at', 'claimed_at',
        'completed_at', 'command_digest', 'updated_at',
      ];
      this.journal.set(commandId, Object.fromEntries(values.map((key, index) => [key, bind[index]])));
      return;
    }

    if (sql.startsWith('UPDATE agent_command_journal SET status = \'claimed\'')) {
      const row = this.journal.get(String(bind[3]));
      if (!row || row.status !== 'queued') return;
      row.status = 'claimed';
      row.executor_lease_id = bind[0];
      row.claimed_at = bind[1];
      row.updated_at = bind[2];
      return;
    }

    if (sql.startsWith('UPDATE agent_command_journal SET status = \'orphaned\'')) {
      const row = this.journal.get(String(bind[7]));
      if (!row) return;
      row.status = 'orphaned';
      row.error_code = bind[0];
      row.error_message = bind[1];
      row.before_revision = bind[2];
      row.after_revision = bind[3];
      row.receipt_digest = bind[4];
      row.completed_at = bind[5];
      row.updated_at = bind[6];
      return;
    }

    if (sql.startsWith('UPDATE agent_command_journal SET status = ?')) {
      const row = this.journal.get(String(bind[11]));
      if (!row) return;
      if (!['queued', 'dispatched', 'claimed', 'reconciling'].includes(String(row.status))) return;
      row.status = bind[0];
      row.executor_lease_id = bind[1];
      row.before_revision = bind[2];
      row.after_revision = bind[3];
      row.browser_result_json = bind[4];
      row.visible_postcondition_json = bind[5];
      row.receipt_digest = bind[6];
      row.error_code = bind[7];
      row.error_message = bind[8];
      row.completed_at = bind[9];
      row.updated_at = bind[10];
      return;
    }

    if (sql.startsWith('CREATE TABLE IF NOT EXISTS test_only_agent_mutation_fixture')) {
      return;
    }
    if (sql.startsWith('INSERT OR REPLACE INTO test_only_agent_mutation_fixture')) {
      this.fixture = { value: String(bind[0]), revision: Number(bind[1]) };
      return;
    }
    if (sql.startsWith('UPDATE test_only_agent_mutation_fixture SET value')) {
      if (!this.fixture) throw new Error('test fixture is missing');
      this.fixture.value = String(bind[0]);
      return;
    }
    if (sql.startsWith('UPDATE test_only_agent_mutation_fixture SET revision')) {
      if (!this.fixture) throw new Error('test fixture is missing');
      this.fixture.revision = Number(bind[0]);
      return;
    }
    if (sql.startsWith('UPDATE agent_command_journal SET status = \'committed\'')) {
      if (this.failFixtureReceipt) throw new Error('fixture receipt write failed');
      const row = this.journal.get(String(bind[7]));
      if (!row) throw new Error('fixture command is missing');
      row.status = 'committed';
      row.before_revision = bind[0];
      row.after_revision = bind[1];
      row.browser_result_json = bind[2];
      row.visible_postcondition_json = bind[3];
      row.receipt_digest = bind[4];
      row.completed_at = bind[5];
      row.updated_at = bind[6];
      return;
    }
    throw new Error(`Memory adapter does not implement batch statement: ${statement.sql}`);
  }
}

type TestOperationSchema = {
  refreshSnapshot: { readonly reason: string };
  testMutation: { readonly value: string };
};

function command(
  commandId: string,
  databaseGeneration: DatabaseGeneration,
  binding: {
    workspaceId: string;
    timelineId: string;
    checkoutTargetId: string | null;
    checkoutUpdatedAt: number;
    contentRevision: number;
    snapshotDigest: string;
  },
  operation: keyof TestOperationSchema,
  payload: JsonObject,
): ProductCommandEnvelope<TestOperationSchema> {
  return {
    protocolVersion: 1,
    commandId: asCommandId(commandId),
    defSessionId: asDefSessionId('session-test'),
    defTurnId: asDefTurnId(`turn-${commandId}`),
    toolCallId: asToolCallId(`tool-${commandId}`),
    expected: {
      workspaceId: asWorkspaceId(binding.workspaceId),
      databaseGeneration,
      timelineId: asTimelineId(binding.timelineId),
      checkoutTargetId: binding.checkoutTargetId,
      checkoutUpdatedAt: binding.checkoutUpdatedAt,
      contentRevision: binding.contentRevision,
      snapshotDigest: binding.snapshotDigest,
    },
    command: { op: operation, payload } as unknown as ProductCommandEnvelope<TestOperationSchema>['command'],
  } as ProductCommandEnvelope<TestOperationSchema>;
}

async function applyTestOnlyAtomicMutationFixture(
  adapter: BrowserProductDatabaseAdapter,
  commandId: string,
  nextValue: string,
  beforeRevision: number,
  afterRevision: number,
): Promise<void> {
  await adapter.batch([
    {
      sql: 'UPDATE test_only_agent_mutation_fixture SET value = ? WHERE fixture_id = 1',
      bind: [nextValue],
    },
    {
      sql: 'UPDATE test_only_agent_mutation_fixture SET revision = ? WHERE fixture_id = 1',
      bind: [afterRevision],
    },
    {
      sql: `
        UPDATE agent_command_journal SET status = 'committed',
          before_revision = ?, after_revision = ?, browser_result_json = ?,
          visible_postcondition_json = ?, receipt_digest = ?, completed_at = ?, updated_at = ?
        WHERE command_id = ? AND status = 'claimed'
      `,
      bind: [
        beforeRevision,
        afterRevision,
        '{"value":"after"}',
        '{"revision":8}',
        'sha256:test-fixture-receipt',
        '2026-08-07T00:00:02.000Z',
        '2026-08-07T00:00:02.000Z',
        commandId,
      ],
    },
  ]);
}

const fixedTime = new Date('2026-08-07T00:00:00.000Z');
const adapter = new MemoryBrowserProductAdapter();
let generationSequence = 0;
const store = createBrowserProductStore(adapter, {
  now: () => fixedTime,
  createId: (kind) => kind === 'workspace' ? 'workspace-test' : `generation-${++generationSequence}`,
});

const identity = await store.initialize();
assert.equal(identity.workspaceId, 'workspace-test');
assert.equal(identity.databaseGeneration, 'generation-1');
assert.equal(identity.agentRuntimeSchemaVersion, AGENT_RUNTIME_SCHEMA_VERSION);
assert.equal(identity.commandJournalSchemaVersion, COMMAND_JOURNAL_SCHEMA_VERSION);
assert.deepEqual(await store.readIdentity(), identity);
const observerStore = createBrowserProductStore(adapter, {
  now: () => fixedTime,
  createId: () => { throw new Error('observer must not create a second identity'); },
});
assert.deepEqual(await observerStore.readIdentity(), identity);

const timelineId = asTimelineId('timeline-test');
const snapshot = await store.createRuntimeSnapshot({
  timelineId,
  checkoutTargetId: 'checkout-a',
  checkoutUpdatedAt: 10,
  contentRevision: 7,
  payload: { z: 1, nested: { b: true, a: 'stable' }, a: ['x', 2] },
  capturedAt: '2026-08-07T00:00:01.000Z',
});
const reorderedSnapshot = await store.createRuntimeSnapshot({
  timelineId,
  checkoutTargetId: 'checkout-a',
  checkoutUpdatedAt: 10,
  contentRevision: 7,
  payload: { a: ['x', 2], nested: { a: 'stable', b: true }, z: 1 },
  capturedAt: '2026-08-07T00:00:03.000Z',
});
assert.equal(snapshot.binding.snapshotDigest, reorderedSnapshot.binding.snapshotDigest);
assert.notEqual(snapshot.capturedAt, reorderedSnapshot.capturedAt);
const changedSnapshot = await store.createRuntimeSnapshot({
  ...snapshot.binding,
  payload: { ...snapshot.payload, z: 2 },
});
assert.notEqual(snapshot.binding.snapshotDigest, changedSnapshot.binding.snapshotDigest);
const activeSnapshot = await store.createRuntimeSnapshot({
  timelineId,
  checkoutTargetId: 'checkout-a',
  checkoutUpdatedAt: 10,
  contentRevision: 7,
  payload: snapshot.payload,
  capturedAt: '2026-08-07T00:00:04.000Z',
});
assert.deepEqual((await store.readRuntimeSnapshot())?.binding, activeSnapshot.binding);

const staleSnapshotCommand = command(
  'command-stale-snapshot',
  identity.databaseGeneration,
  changedSnapshot.binding,
  'refreshSnapshot',
  { reason: 'stale-snapshot' },
);
const staleSnapshotClaim = await store.claimCommand(staleSnapshotCommand, 'lease-stale-snapshot');
assert.equal(staleSnapshotClaim.kind, 'rejected');
if (staleSnapshotClaim.kind !== 'rejected') throw new Error('stale snapshot was not rejected');
assert.equal(staleSnapshotClaim.result.status, 'conflict');
assert.equal(staleSnapshotClaim.result.code, 'SNAPSHOT_BINDING_MISMATCH');

const refreshCommand = command(
  'command-refresh',
  identity.databaseGeneration,
  activeSnapshot.binding,
  'refreshSnapshot',
  { reason: 'contract-test' },
);
const firstClaim = await store.claimCommand(refreshCommand, 'lease-a');
if (firstClaim.kind !== 'claimed') throw new Error('refresh command was unexpectedly rejected');
assert.equal(firstClaim.kind, 'claimed');
assert.equal(firstClaim.journal.status, 'claimed');
const duplicateClaim = await store.claimCommand(refreshCommand, 'lease-b');
assert.equal(duplicateClaim.kind, 'already-claimed');
const succeeded = await store.recordCommandResult(asCommandId('command-refresh'), {
  status: 'succeeded',
  beforeRevision: 7,
  afterRevision: 7,
  browserResult: { refreshed: true },
  visiblePostcondition: { revision: 7 },
  executorLeaseId: 'lease-a',
  completedAt: '2026-08-07T00:00:01.500Z',
});
assert.equal(succeeded.status, 'succeeded');
assert.deepEqual(await store.reconcileCommand(asCommandId('command-refresh')), succeeded);
assert.equal((await store.claimCommand(refreshCommand, 'lease-c')) .kind, 'already-terminal');

const reusedCommand = command(
  'command-refresh',
  identity.databaseGeneration,
  activeSnapshot.binding,
  'testMutation',
  { value: 'different command' },
);
const reused = await store.claimCommand(reusedCommand, 'lease-c');
assert.equal(reused.kind, 'rejected');
if (reused.kind !== 'rejected') throw new Error('command ID reuse was not rejected');
assert.equal(reused.result.status, 'conflict');
assert.equal(reused.result.code, 'COMMAND_ID_REUSE');

const staleCommand = command(
  'command-stale',
  asDatabaseGeneration('generation-old'),
  activeSnapshot.binding,
  'refreshSnapshot',
  { reason: 'stale' },
);
const staleClaim = await store.claimCommand(staleCommand, 'lease-stale');
assert.equal(staleClaim.kind, 'rejected');
if (staleClaim.kind !== 'rejected') throw new Error('stale command was not rejected');
assert.equal(staleClaim.result.status, 'orphaned');
assert.equal((await store.getCommand(asCommandId('command-stale')))?.status, 'orphaned');

const pendingCommand = command(
  'command-pending',
  identity.databaseGeneration,
  activeSnapshot.binding,
  'refreshSnapshot',
  { reason: 'rotate' },
);
const pendingClaim = await store.claimCommand(pendingCommand, 'lease-pending');
assert.equal(pendingClaim.kind, 'claimed');
const rotated = await store.rotateDatabaseGeneration('test restore');
assert.notEqual(rotated.databaseGeneration, identity.databaseGeneration);
assert.equal(await store.readRuntimeSnapshot(), null);
const orphaned = await store.reconcileCommand(asCommandId('command-pending'));
assert.equal(orphaned?.status, 'orphaned');
assert.equal(orphaned?.code, 'DATABASE_GENERATION_ROTATED');

const currentSnapshot = await store.createRuntimeSnapshot({
  timelineId,
  checkoutTargetId: 'checkout-a',
  checkoutUpdatedAt: 11,
  contentRevision: 7,
  payload: snapshot.payload,
});
const mutationCommand = command(
  'command-fixture',
  rotated.databaseGeneration,
  currentSnapshot.binding,
  'testMutation',
  { value: 'after' },
);
const mutationClaim = await store.claimCommand(mutationCommand, 'lease-fixture');
assert.equal(mutationClaim.kind, 'claimed');
await adapter.batch([{
  sql: 'CREATE TABLE IF NOT EXISTS test_only_agent_mutation_fixture (fixture_id INTEGER PRIMARY KEY, value TEXT NOT NULL, revision INTEGER NOT NULL) STRICT',
}, {
  sql: 'INSERT OR REPLACE INTO test_only_agent_mutation_fixture (fixture_id, value, revision) VALUES (1, ?, ?)',
  bind: ['before', 7],
}]);
const beforeFixtureBatchCount = adapter.batches.length;
await applyTestOnlyAtomicMutationFixture(adapter, 'command-fixture', 'after', 7, 8);
assert.equal(adapter.batches.length, beforeFixtureBatchCount + 1);
assert.equal(adapter.batches.at(-1)?.length, 3);
assert.deepEqual(adapter.fixture, { value: 'after', revision: 8 });
const committed = await store.reconcileCommand(asCommandId('command-fixture'));
assert.equal(committed?.status, 'committed');
assert.equal(committed?.beforeRevision, 7);
assert.equal(committed?.afterRevision, 8);
assert.deepEqual(committed?.browserResult, { value: 'after' });

const rollbackCommand = command(
  'command-fixture-rollback',
  rotated.databaseGeneration,
  currentSnapshot.binding,
  'testMutation',
  { value: 'rollback' },
);
assert.equal((await store.claimCommand(rollbackCommand, 'lease-rollback')).kind, 'claimed');
adapter.failFixtureReceipt = true;
await assert.rejects(
  applyTestOnlyAtomicMutationFixture(adapter, 'command-fixture-rollback', 'must-not-commit', 8, 9),
  /fixture receipt write failed/,
);
adapter.failFixtureReceipt = false;
assert.deepEqual(adapter.fixture, { value: 'after', revision: 8 });
assert.equal((await store.getCommand(asCommandId('command-fixture-rollback')))?.status, 'claimed');

console.log('browserProductStore contract tests passed');
