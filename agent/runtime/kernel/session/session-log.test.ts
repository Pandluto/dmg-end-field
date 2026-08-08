import assert from 'node:assert/strict';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  asClientTurnId,
  asDefSessionId,
  asDefTurnId,
  asToolCallId,
} from '../../../core/contracts/ids.ts';
import type { JsonObject } from '../../../core/contracts/json.ts';
import {
  asRuntimeContentId,
  asRuntimeEntryId,
  asRuntimeMessageId,
  asRuntimeRunId,
  asRuntimeSessionId,
  asRuntimeTurnId,
} from '../ids.ts';
import type {
  RuntimeAssistantMessage,
  RuntimeToolResultMessage,
  RuntimeUserMessage,
} from '../messages.ts';
import type {
  RuntimeRunMarkerEntry,
  RuntimeSessionEntry,
  RuntimeSessionHeader,
} from './entries.ts';
import {
  createSessionLog,
  reopenSessionLog,
  type SessionLog,
} from './session-log.ts';
import { readSessionFile } from './session-reader.ts';
import {
  SessionLogError,
  validateSessionRecords,
} from './session-validator.ts';

const TIME_1 = '2026-08-08T00:00:00.000Z';
const TIME_2 = '2026-08-08T00:00:01.000Z';
const TIME_3 = '2026-08-08T00:00:02.000Z';
const TIME_4 = '2026-08-08T00:00:03.000Z';
const TIME_5 = '2026-08-08T00:00:04.000Z';
const TIME_6 = '2026-08-08T00:00:05.000Z';
const TIME_7 = '2026-08-08T00:00:06.000Z';

function header(): RuntimeSessionHeader {
  return {
    type: 'session',
    schemaVersion: 1,
    runtimeSessionId: asRuntimeSessionId('runtime-session-test'),
    defSessionId: asDefSessionId('def-session-test'),
    runtimeVersion: 'runtime-test',
    providerProfileRef: 'profile-test',
    systemPromptVersion: 'prompt-test-v1',
    createdAt: TIME_1,
  };
}

function startEntry(
  entryId = 'entry-start',
  runId = 'run-1',
  defTurnId = 'def-turn-1',
  turnId = 'runtime-turn-1',
  createdAt = TIME_2,
): RuntimeRunMarkerEntry {
  return {
    schemaVersion: 1,
    id: asRuntimeEntryId(entryId),
    parentId: null,
    createdAt,
    type: 'run-marker',
    phase: 'start',
    defTurnId: asDefTurnId(defTurnId),
    runId: asRuntimeRunId(runId),
    turnId: asRuntimeTurnId(turnId),
  };
}

function endEntry(
  parentId: string,
  entryId = 'entry-end',
  runId = 'run-1',
  defTurnId = 'def-turn-1',
  turnId = 'runtime-turn-1',
  createdAt = TIME_7,
  status: 'completed' | 'interrupted' = 'completed',
): RuntimeRunMarkerEntry {
  return {
    schemaVersion: 1,
    id: asRuntimeEntryId(entryId),
    parentId: asRuntimeEntryId(parentId),
    createdAt,
    type: 'run-marker',
    phase: 'end',
    defTurnId: asDefTurnId(defTurnId),
    runId: asRuntimeRunId(runId),
    turnId: asRuntimeTurnId(turnId),
    terminal: status === 'completed'
      ? { status: 'completed' }
      : { status: 'interrupted', code: 'process-restarted', message: 'The run stopped during restart.' },
  };
}

function userEntry(parentId: string, entryId = 'entry-user', createdAt = TIME_3): RuntimeSessionEntry {
  const message: RuntimeUserMessage = {
    schemaVersion: 1,
    id: asRuntimeMessageId(`${entryId}-message`),
    createdAt,
    defTurnId: asDefTurnId('def-turn-1'),
    turnId: asRuntimeTurnId('runtime-turn-1'),
    role: 'user',
    clientTurnId: asClientTurnId('client-turn-1'),
    content: [{
      type: 'text',
      id: asRuntimeContentId(`${entryId}-content`),
      text: 'Read the current session.',
    }],
  };
  return {
    schemaVersion: 1,
    id: asRuntimeEntryId(entryId),
    parentId: asRuntimeEntryId(parentId),
    createdAt,
    type: 'message',
    message,
  };
}

function assistantEntry(
  parentId: string,
  entryId = 'entry-assistant',
  withToolCall = false,
  createdAt = TIME_4,
  argumentsValue: JsonObject = { timelineId: 'fixture' },
): RuntimeSessionEntry {
  const message: RuntimeAssistantMessage = {
    schemaVersion: 1,
    id: asRuntimeMessageId(`${entryId}-message`),
    createdAt,
    defTurnId: asDefTurnId('def-turn-1'),
    turnId: asRuntimeTurnId('runtime-turn-1'),
    role: 'assistant',
    content: withToolCall
      ? [{
          type: 'tool-call',
          id: asRuntimeContentId(`${entryId}-content`),
          toolCallId: asToolCallId('tool-call-1'),
          name: 'read_timeline',
          arguments: argumentsValue,
        }]
      : [{
          type: 'text',
          id: asRuntimeContentId(`${entryId}-content`),
          text: 'Done.',
        }],
    providerId: 'fixture-provider',
    modelId: 'fixture-model',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    stopReason: withToolCall ? 'tool-use' : 'stop',
    completedAt: createdAt,
  };
  return {
    schemaVersion: 1,
    id: asRuntimeEntryId(entryId),
    parentId: asRuntimeEntryId(parentId),
    createdAt,
    type: 'message',
    message,
  };
}

function toolResultEntry(parentId: string, entryId = 'entry-tool-result', createdAt = TIME_5): RuntimeSessionEntry {
  const message: RuntimeToolResultMessage = {
    schemaVersion: 1,
    id: asRuntimeMessageId(`${entryId}-message`),
    createdAt,
    defTurnId: asDefTurnId('def-turn-1'),
    turnId: asRuntimeTurnId('runtime-turn-1'),
    role: 'tool-result',
    toolCallId: asToolCallId('tool-call-1'),
    toolName: 'read_timeline',
    result: { status: 'succeeded', output: { ok: true } },
    completedAt: createdAt,
  };
  return {
    schemaVersion: 1,
    id: asRuntimeEntryId(entryId),
    parentId: asRuntimeEntryId(parentId),
    createdAt,
    type: 'message',
    message,
  };
}

function makeRootedLog(): { root: string; filePath: string; log: SessionLog } {
  const root = mkdtempSync(join(tmpdir(), 'def-runtime-session-'));
  const filePath = join(root, 'nested', 'runtime.jsonl');
  const log = createSessionLog(filePath, header(), { rootDir: root });
  return { root, filePath, log };
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

function assertIncompatible(action: () => unknown): SessionLogError {
  assert.throws(action, (error: unknown) => error instanceof SessionLogError && error.code === 'SESSION_INCOMPATIBLE');
  try {
    action();
  } catch (error) {
    return error as SessionLogError;
  }
  throw new Error('expected incompatible error');
}

test('SessionLog creates, appends, reopens, derives leaf/updated, and keeps the header immutable', () => {
  const { root, filePath, log } = makeRootedLog();
  try {
    const originalHeaderLine = readFileSync(filePath, 'utf8').split('\n')[0];
    log.append(startEntry());
    log.append(userEntry('entry-start'));
    log.append(assistantEntry('entry-user', 'entry-assistant-tool', true));
    log.append(toolResultEntry('entry-assistant-tool'));
    log.append(assistantEntry('entry-tool-result', 'entry-assistant-final'));
    log.append(endEntry('entry-assistant-final'));

    const reopened = reopenSessionLog(filePath, { rootDir: root });
    assert.equal(reopened.entries.length, 6);
    assert.equal(reopened.leafId, asRuntimeEntryId('entry-end'));
    assert.equal(reopened.updatedAt, TIME_7);
    assert.equal(readFileSync(filePath, 'utf8').split('\n')[0], originalHeaderLine);
    assert.equal(statSync(filePath).mode & 0o777, 0o600);
    assert.equal(reopened.interruptedRuns.length, 0);

    const beforeIdempotent = readFileSync(filePath, 'utf8');
    const idempotent = reopened.appendEntry(endEntry('entry-assistant-final'));
    assert.equal(idempotent.appended, false);
    assert.equal(idempotent.idempotent, true);
    assert.equal(readFileSync(filePath, 'utf8'), beforeIdempotent);

    const conflicting = endEntry('entry-assistant-final', 'entry-end', 'run-1', 'def-turn-1', 'runtime-turn-1', TIME_7, 'interrupted');
    assert.throws(() => reopened.append(conflicting), /different payload/u);
    assert.equal(readFileSync(filePath, 'utf8'), beforeIdempotent);
  } finally {
    cleanup(root);
  }
});

test('reopen truncates only an incomplete final line and rejects middle corruption', () => {
  const { root, filePath, log } = makeRootedLog();
  try {
    log.append(startEntry());
    const valid = readFileSync(filePath, 'utf8');
    appendFileSync(filePath, '{"type":"message"');
    const repaired = reopenSessionLog(filePath, { rootDir: root });
    assert.equal(repaired.entries.length, 1);
    assert.equal(repaired.state.repairedTail, true);
    assert.equal(readFileSync(filePath, 'utf8'), valid);

    const damagedPath = join(root, 'damaged.jsonl');
    writeFileSync(damagedPath, `${valid}not-json\n`, { mode: 0o600 });
    assertIncompatible(() => reopenSessionLog(damagedPath, { rootDir: root }));
  } finally {
    cleanup(root);
  }
});

test('validator rejects unknown parents, duplicate IDs, cycles, bad Tool pairing, and correlation drift', () => {
  const root = header();
  const start = startEntry();
  const validRecords = [root, start, userEntry('entry-start')];

  const unknownParent = { ...userEntry('does-not-exist'), id: asRuntimeEntryId('entry-unknown-parent') };
  assertIncompatible(() => validateSessionRecords([...validRecords, unknownParent]));

  const duplicate = { ...userEntry('entry-start'), id: asRuntimeEntryId('entry-start') };
  assertIncompatible(() => validateSessionRecords([...validRecords, duplicate]));

  const cycleA = { ...startEntry('cycle-a'), parentId: asRuntimeEntryId('cycle-b') };
  const cycleB = { ...userEntry('cycle-a', 'cycle-b'), parentId: asRuntimeEntryId('cycle-a') };
  assert.throws(() => validateSessionRecords([root, cycleA, cycleB]), /parent cycle/u);

  const toolCall = assistantEntry('entry-user', 'entry-assistant-tool', true);
  const missingResultEnd = endEntry('entry-assistant-tool');
  assertIncompatible(() => validateSessionRecords([...validRecords, toolCall, missingResultEnd]));

  const wrongTurn = userEntry('entry-start', 'entry-wrong-turn');
  const wrongTurnMessage = (wrongTurn as Extract<RuntimeSessionEntry, { type: 'message' }>).message as RuntimeUserMessage;
  const wrongTurnEntry: Extract<RuntimeSessionEntry, { type: 'message' }> = {
    ...(wrongTurn as Extract<RuntimeSessionEntry, { type: 'message' }>),
    message: { ...wrongTurnMessage, defTurnId: asDefTurnId('def-turn-other') },
  };
  assertIncompatible(() => validateSessionRecords([root, start, wrongTurnEntry]));
});

test('an unclosed run is recovered as interrupted without appending a product mutation', () => {
  const { root, filePath, log } = makeRootedLog();
  try {
    log.append(startEntry());
    log.append(userEntry('entry-start'));
    log.append(assistantEntry('entry-user', 'entry-assistant-tool', true));
    const bytesBeforeReopen = readFileSync(filePath, 'utf8');
    const reopened = reopenSessionLog(filePath, { rootDir: root });
    assert.equal(reopened.interruptedRuns.length, 1);
    assert.equal(reopened.interruptedRuns[0]?.endEntryId, null);
    assert.equal(readFileSync(filePath, 'utf8'), bytesBeforeReopen);
    const interruptedEntryId = reopened.markInterrupted({
      entryId: asRuntimeEntryId('entry-recovered-interrupted'),
      createdAt: TIME_6,
    });
    assert.equal(interruptedEntryId, asRuntimeEntryId('entry-recovered-interrupted'));
    const settled = reopenSessionLog(filePath, { rootDir: root });
    assert.equal(settled.interruptedRuns.length, 1);
    assert.equal(settled.interruptedRuns[0]?.endEntryId, asRuntimeEntryId('entry-recovered-interrupted'));
    assert.equal(settled.leafId, asRuntimeEntryId('entry-recovered-interrupted'));
  } finally {
    cleanup(root);
  }
});

test('secret-shaped content is rejected before bytes are appended', () => {
  const { root, filePath, log } = makeRootedLog();
  try {
    log.append(startEntry());
    log.append(userEntry('entry-start'));
    const before = readFileSync(filePath, 'utf8');
    const secretCall = assistantEntry(
      'entry-user',
      'entry-secret-assistant',
      true,
      TIME_4,
      { apiKey: 'sk-fixture-secret-value-123456' },
    );
    assertIncompatible(() => log.append(secretCall));
    assert.equal(readFileSync(filePath, 'utf8'), before);
    assert.equal(readFileSync(filePath, 'utf8').includes('sk-fixture-secret-value-123456'), false);
  } finally {
    cleanup(root);
  }
});

test('path boundaries reject escape, symlink, and non-regular targets', () => {
  const root = mkdtempSync(join(tmpdir(), 'def-runtime-session-path-'));
  try {
    assert.throws(() => createSessionLog(join(root, '..', 'escape.jsonl'), header(), { rootDir: root }), /escapes/u);

    const outside = join(root, '..', 'outside-session-target.jsonl');
    writeFileSync(outside, '', { mode: 0o600 });
    const linked = join(root, 'linked.jsonl');
    symlinkSync(outside, linked);
    assert.throws(() => reopenSessionLog(linked, { rootDir: root }), /symbolic links/u);

    const directoryPath = join(root, 'directory.jsonl');
    mkdirSync(directoryPath);
    assert.throws(() => reopenSessionLog(directoryPath, { rootDir: root }), /regular file/u);

    assert.equal(readlinkSync(linked), outside);
    rmSync(outside, { force: true });
  } finally {
    cleanup(root);
  }
});

test('a valid final record without a newline is accepted, while a truncated tail is repairable', () => {
  const { root, filePath, log } = makeRootedLog();
  try {
    log.append(startEntry());
    const noNewline = readFileSync(filePath, 'utf8').replace(/\n$/u, '');
    writeFileSync(filePath, noNewline, { mode: 0o600 });
    const read = readSessionFile(filePath, { rootDir: root });
    assert.equal(read.tail, 'complete-no-newline');
    assert.equal(read.entries.length, 1);
    log.close();
    const reopened = reopenSessionLog(filePath, { rootDir: root });
    reopened.append(userEntry('entry-start'));
    assert.match(readFileSync(filePath, 'utf8'), /\n\{"schemaVersion":1/u);
  } finally {
    cleanup(root);
  }
});
