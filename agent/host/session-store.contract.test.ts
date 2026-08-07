import assert from 'node:assert/strict';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  asDefSessionId,
  asDefTurnId,
  asEngineSessionId,
  asClientTurnId,
  asDatabaseGeneration,
  asTimelineId,
  asWorkspaceId,
  type DefEvent,
  type DefSessionV6,
  type ProductBinding,
} from '../core/contracts/index.ts';
import {
  createFileDefAgentSessionStore,
  createMemoryDefAgentSessionStore,
  createNoopDefAgentSessionStore,
  DefAgentSessionStoreError,
  type DefAgentSessionRecord,
} from './session-store.ts';

function expectStoreError(action: () => void, code: DefAgentSessionStoreError['code']): void {
  assert.throws(action, (error: unknown) => (
    error instanceof DefAgentSessionStoreError && error.code === code
  ));
}

function fixtureRecord(id = 'def-session-contract'): DefAgentSessionRecord {
  const defSessionId = asDefSessionId(id);
  const workspaceId = asWorkspaceId('workspace-contract');
  const databaseGeneration = asDatabaseGeneration('generation-contract');
  const timelineId = asTimelineId('timeline-contract');
  const binding: ProductBinding = {
    workspaceId,
    databaseGeneration,
    timelineId,
    checkoutTargetId: 'node-contract',
    checkoutUpdatedAt: 1_700_000_000_000,
    contentRevision: 7,
    snapshotDigest: 'digest-contract',
  };
  const now = '2026-08-07T00:00:00.000Z';
  const session: DefSessionV6 = {
    schemaVersion: 6,
    eventSchemaVersion: 1,
    defSessionId,
    host: 'workbench',
    status: 'ready',
    workspaceId,
    lastDatabaseGeneration: databaseGeneration,
    timelineId,
    axisBindingId: 'axis-contract',
    boundNodeId: 'node-contract',
    engine: {
      kind: 'opencode',
      sessionId: asEngineSessionId(`engine-${id}`),
      runtimeVersion: 'test-runtime',
      storeSchemaVersion: 1,
    },
    harness: {
      stateVersion: 1,
      revision: 'contract-catalog-v1',
    },
    createdAt: now,
    updatedAt: now,
  };
  return {
    session,
    binding,
    providerProfileRef: 'profile-contract',
    acceptedClientTurns: [],
  };
}

function readyEvent(defSessionId: DefSessionV6['defSessionId'], sequence: number): DefEvent {
  return {
    schemaVersion: 1,
    sequence,
    occurredAt: '2026-08-07T00:00:01.000Z',
    defSessionId,
    type: 'session.ready',
    payload: {
      engineKind: 'opencode',
      engineRuntimeVersion: 'test-runtime',
    },
  };
}

function acceptedTurn(clientTurnId = 'client-contract', defTurnId = 'turn-contract') {
  return {
    clientTurnId: asClientTurnId(clientTurnId),
    userMessage: '请检查这个排轴',
    result: {
      defTurnId: asDefTurnId(defTurnId),
      clientTurnId: asClientTurnId(clientTurnId),
    },
    acceptedAt: '2026-08-07T00:00:02.000Z',
  } as const;
}

function makeRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'def-session-store-contract-'));
}

function testNormalRestartRecovery(): void {
  const root = makeRoot();
  const record = fixtureRecord();
  const store = createFileDefAgentSessionStore({ root });
  store.create(record);
  store.append(record.session.defSessionId, readyEvent(record.session.defSessionId, 1));
  store.acceptClientTurn(record.session.defSessionId, acceptedTurn());
  store.setActive(record.session.defSessionId);

  const restarted = createFileDefAgentSessionStore({ root });
  const snapshot = restarted.load();
  assert.equal(snapshot.activeSessionId, record.session.defSessionId);
  assert.deepEqual(snapshot.sessions, [{
    ...record,
    acceptedClientTurns: [acceptedTurn()],
  }]);
  assert.deepEqual(snapshot.events.get(record.session.defSessionId), [
    readyEvent(record.session.defSessionId, 1),
  ]);
  assert.deepEqual(
    restarted.loadAcceptedClientTurn(record.session.defSessionId, asClientTurnId('client-contract')),
    acceptedTurn(),
  );
  assert.equal(readFileSync(path.join(root, 'sessions', record.session.defSessionId, 'metadata.json'), 'utf8').includes('provider-secret'), false);
  rmSync(root, { recursive: true, force: true });
}

function testAtomicTemporaryResidueIsIgnored(): void {
  const root = makeRoot();
  const record = fixtureRecord();
  const store = createFileDefAgentSessionStore({ root });
  store.create(record);
  writeFileSync(path.join(root, 'registry.json.tmp-crash-residue'), '{not committed registry');
  writeFileSync(path.join(root, 'sessions', record.session.defSessionId, 'metadata.json.tmp-crash-residue'), '{not committed metadata');

  const restarted = createFileDefAgentSessionStore({ root });
  assert.equal(restarted.load().sessions.length, 1);
  assert.equal(existsSync(path.join(root, 'registry.json.tmp-crash-residue')), true);
  rmSync(root, { recursive: true, force: true });
}

function testTruncatedTailIsIgnoredAndRepairedBeforeAppend(): void {
  const root = makeRoot();
  const record = fixtureRecord();
  const store = createFileDefAgentSessionStore({ root });
  store.create(record);
  store.append(record.session.defSessionId, readyEvent(record.session.defSessionId, 1));
  const journalPath = path.join(root, 'sessions', record.session.defSessionId, 'events.ndjson');
  appendFileSync(journalPath, '{"schemaVersion":1,"sequence":2');

  const restarted = createFileDefAgentSessionStore({ root });
  assert.deepEqual(restarted.loadEvents(record.session.defSessionId), [
    readyEvent(record.session.defSessionId, 1),
  ]);
  restarted.append(record.session.defSessionId, readyEvent(record.session.defSessionId, 2));
  assert.deepEqual(restarted.loadEvents(record.session.defSessionId), [
    readyEvent(record.session.defSessionId, 1),
    readyEvent(record.session.defSessionId, 2),
  ]);
  rmSync(root, { recursive: true, force: true });
}

function testFrontCorruptionFailsClosed(): void {
  const root = makeRoot();
  const record = fixtureRecord();
  const store = createFileDefAgentSessionStore({ root });
  store.create(record);
  const journalPath = path.join(root, 'sessions', record.session.defSessionId, 'events.ndjson');
  writeFileSync(journalPath, `{\"front\":\"corrupt\"}\n${JSON.stringify(readyEvent(record.session.defSessionId, 1))}\n`);
  expectStoreError(() => store.load(), 'CORRUPT_EVENT_JOURNAL');
  rmSync(root, { recursive: true, force: true });
}

function testDeleteIsExactAndClearsActivePointer(): void {
  const root = makeRoot();
  const first = fixtureRecord('def-session-delete-a');
  const second = fixtureRecord('def-session-delete-b');
  const store = createFileDefAgentSessionStore({ root });
  store.create(first);
  store.create(second);
  store.setActive(first.session.defSessionId);
  const outside = path.join(root, 'outside-user-file.txt');
  writeFileSync(outside, 'keep me');

  store.delete(first.session.defSessionId);
  const snapshot = store.load();
  assert.equal(snapshot.activeSessionId, null);
  assert.deepEqual(snapshot.sessions.map((entry) => entry.session.defSessionId), [second.session.defSessionId]);
  assert.equal(existsSync(path.join(root, 'sessions', first.session.defSessionId)), false);
  assert.equal(existsSync(path.join(root, 'sessions', second.session.defSessionId)), true);
  assert.equal(readFileSync(outside, 'utf8'), 'keep me');
  rmSync(root, { recursive: true, force: true });
}

function testIdAndSymlinkEscapeAreRejected(): void {
  const root = makeRoot();
  const store = createFileDefAgentSessionStore({ root });
  const invalid = fixtureRecord('def-session-valid');
  const invalidPathRecord = {
    ...invalid,
    session: { ...invalid.session, defSessionId: asDefSessionId('../outside-session') },
  };
  expectStoreError(() => store.create(invalidPathRecord), 'INVALID_SESSION_ID');

  if (process.platform !== 'win32') {
    const linked = fixtureRecord('def-session-linked');
    store.create(linked);
    const linkedDirectory = path.join(root, 'sessions', linked.session.defSessionId);
    const outside = makeRoot();
    rmSync(linkedDirectory, { recursive: true, force: true });
    symlinkSync(outside, linkedDirectory, 'dir');
    expectStoreError(() => store.load(), 'SYMLINK_ESCAPE');
    rmSync(outside, { recursive: true, force: true });
  }
  rmSync(root, { recursive: true, force: true });
}

function testPermissions(): void {
  if (process.platform === 'win32') return;
  const root = makeRoot();
  const record = fixtureRecord();
  const store = createFileDefAgentSessionStore({ root });
  store.create(record);
  store.setActive(record.session.defSessionId);
  store.append(record.session.defSessionId, readyEvent(record.session.defSessionId, 1));
  const files = [
    path.join(root, 'registry.json'),
    path.join(root, 'sessions', record.session.defSessionId, 'metadata.json'),
    path.join(root, 'sessions', record.session.defSessionId, 'events.ndjson'),
  ];
  for (const file of files) assert.equal(statSync(file).mode & 0o777, 0o600, file);
  rmSync(root, { recursive: true, force: true });
}

function testMemoryAndNoopImplementations(): void {
  const record = fixtureRecord('def-session-memory');
  const memory = createMemoryDefAgentSessionStore();
  memory.create(record);
  memory.append(record.session.defSessionId, readyEvent(record.session.defSessionId, 1));
  memory.acceptClientTurn(record.session.defSessionId, acceptedTurn('client-memory', 'turn-memory'));
  memory.setActive(record.session.defSessionId);
  assert.equal(memory.load().activeSessionId, record.session.defSessionId);
  assert.equal(memory.loadEvents(record.session.defSessionId).length, 1);
  assert.equal(memory.loadAcceptedClientTurn(record.session.defSessionId, asClientTurnId('client-memory'))?.result.defTurnId, 'turn-memory');

  const noop = createNoopDefAgentSessionStore();
  noop.create(record);
  noop.append(record.session.defSessionId, readyEvent(record.session.defSessionId, 1));
  noop.setActive(record.session.defSessionId);
  assert.equal(noop.load().sessions.length, 0);
  assert.equal(noop.load().activeSessionId, null);
}

function testMissingSessionLookupIsNullable(): void {
  const root = makeRoot();
  const file = createFileDefAgentSessionStore({ root });
  assert.equal(file.loadSession(asDefSessionId('def-session-missing')), null);
  assert.equal(
    file.loadAcceptedClientTurn(
      asDefSessionId('def-session-missing'),
      asClientTurnId('client-turn-missing'),
    ),
    null,
  );
  rmSync(root, { recursive: true, force: true });
}

testNormalRestartRecovery();
testAtomicTemporaryResidueIsIgnored();
testTruncatedTailIsIgnoredAndRepairedBeforeAppend();
testFrontCorruptionFailsClosed();
testDeleteIsExactAndClearsActivePointer();
testIdAndSymlinkEscapeAreRejected();
testPermissions();
testMemoryAndNoopImplementations();
testMissingSessionLookupIsNullable();
console.log('DEF Agent session store contract passed');
