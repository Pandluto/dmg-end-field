import assert from 'node:assert/strict';
import {
  appendFileSync,
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { inspect } from 'node:util';
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
  RuntimeToolResultPayload,
  RuntimeToolResultMessage,
  RuntimeUserMessage,
} from '../messages.ts';
import type {
  RuntimeRunMarkerEntry,
  RuntimeSessionEntry,
  RuntimeSessionHeader,
} from './entries.ts';
import {
  createOrReopenSessionLog,
  createSessionLog,
  reopenSessionLog,
  SessionLog,
} from './session-log.ts';
import {
  readSessionFile,
  scanSessionFile,
  SessionReader,
  truncateSessionFile,
} from './session-reader.ts';
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

const mutableNodeFs = createRequire(import.meta.url)('node:fs') as Record<string, unknown>;

function withOpenInjection<T>(target: string, inject: () => void, action: () => T): T {
  const original = mutableNodeFs.openSync as (...args: unknown[]) => unknown;
  let injected = false;
  mutableNodeFs.openSync = (...args: unknown[]): unknown => {
    if (!injected && String(args[0]) === target) {
      injected = true;
      inject();
    }
    return Reflect.apply(original, mutableNodeFs, args);
  };
  syncBuiltinESMExports();
  try {
    return action();
  } finally {
    mutableNodeFs.openSync = original;
    syncBuiltinESMExports();
    assert.equal(injected, true, 'the open injection must run');
  }
}

function withReadInjection<T>(inject: () => void, action: () => T): T {
  const original = mutableNodeFs.readSync as (...args: unknown[]) => unknown;
  let injected = false;
  mutableNodeFs.readSync = (...args: unknown[]): unknown => {
    if (!injected) {
      injected = true;
      inject();
    }
    return Reflect.apply(original, mutableNodeFs, args);
  };
  syncBuiltinESMExports();
  try {
    return action();
  } finally {
    mutableNodeFs.readSync = original;
    syncBuiltinESMExports();
    assert.equal(injected, true, 'the read injection must run');
  }
}

function replaceParentWithHardLink(filePath: string, displacedName: string): string {
  const parent = dirname(filePath);
  const displacedParent = join(dirname(parent), displacedName);
  renameSync(parent, displacedParent);
  mkdirSync(parent, { mode: 0o700 });
  const displacedFile = join(displacedParent, basename(filePath));
  linkSync(displacedFile, filePath);
  return displacedFile;
}

function replaceEmptyParent(filePath: string, displacedName: string): string {
  const parent = dirname(filePath);
  const displacedParent = join(dirname(parent), displacedName);
  renameSync(parent, displacedParent);
  mkdirSync(parent, { mode: 0o700 });
  return displacedParent;
}

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
  parentId: string | null = null,
): RuntimeRunMarkerEntry {
  return {
    schemaVersion: 1,
    id: asRuntimeEntryId(entryId),
    parentId: parentId === null ? null : asRuntimeEntryId(parentId),
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

interface TurnFixtureOptions {
  readonly defTurnId?: string;
  readonly turnId?: string;
}

interface UserFixtureOptions extends TurnFixtureOptions {
  readonly text?: string;
}

function userEntry(
  parentId: string,
  entryId = 'entry-user',
  createdAt = TIME_3,
  options: UserFixtureOptions = {},
): RuntimeSessionEntry {
  const message: RuntimeUserMessage = {
    schemaVersion: 1,
    id: asRuntimeMessageId(`${entryId}-message`),
    createdAt,
    defTurnId: asDefTurnId(options.defTurnId ?? 'def-turn-1'),
    turnId: asRuntimeTurnId(options.turnId ?? 'runtime-turn-1'),
    role: 'user',
    clientTurnId: asClientTurnId('client-turn-1'),
    content: [{
      type: 'text',
      id: asRuntimeContentId(`${entryId}-content`),
      text: options.text ?? 'Read the current session.',
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

interface AssistantFixtureOptions extends TurnFixtureOptions {
  readonly text?: string;
  readonly thinkingText?: string;
  readonly diagnosticMessage?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly stopReason?: RuntimeAssistantMessage['stopReason'];
}

function assistantEntry(
  parentId: string,
  entryId = 'entry-assistant',
  withToolCall = false,
  createdAt = TIME_4,
  argumentsValue: JsonObject = { timelineId: 'fixture' },
  options: AssistantFixtureOptions = {},
): RuntimeSessionEntry {
  const content: RuntimeAssistantMessage['content'][number][] = [];
  if (options.thinkingText !== undefined) {
    content.push({
      type: 'thinking',
      id: asRuntimeContentId(`${entryId}-thinking`),
      text: options.thinkingText,
    });
  }
  if (!withToolCall || options.text !== undefined) {
    content.push({
      type: 'text',
      id: asRuntimeContentId(`${entryId}-text`),
      text: options.text ?? 'Done.',
    });
  }
  if (withToolCall) {
    content.push({
      type: 'tool-call',
      id: asRuntimeContentId(`${entryId}-tool`),
      toolCallId: asToolCallId(options.toolCallId ?? 'tool-call-1'),
      name: options.toolName ?? 'read_timeline',
      arguments: argumentsValue,
    });
  }
  const message: RuntimeAssistantMessage = {
    schemaVersion: 1,
    id: asRuntimeMessageId(`${entryId}-message`),
    createdAt,
    defTurnId: asDefTurnId(options.defTurnId ?? 'def-turn-1'),
    turnId: asRuntimeTurnId(options.turnId ?? 'runtime-turn-1'),
    role: 'assistant',
    content,
    providerId: 'fixture-provider',
    modelId: 'fixture-model',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    stopReason: options.stopReason ?? (withToolCall ? 'tool-use' : 'stop'),
    ...(options.diagnosticMessage === undefined
      ? {}
      : {
          diagnostic: {
            code: 'fixture-diagnostic',
            message: options.diagnosticMessage,
            retryable: false,
          },
        }),
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

interface ToolResultFixtureOptions extends TurnFixtureOptions {
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly result?: RuntimeToolResultPayload;
}

function toolResultEntry(
  parentId: string,
  entryId = 'entry-tool-result',
  createdAt = TIME_5,
  options: ToolResultFixtureOptions = {},
): RuntimeSessionEntry {
  const message: RuntimeToolResultMessage = {
    schemaVersion: 1,
    id: asRuntimeMessageId(`${entryId}-message`),
    createdAt,
    defTurnId: asDefTurnId(options.defTurnId ?? 'def-turn-1'),
    turnId: asRuntimeTurnId(options.turnId ?? 'runtime-turn-1'),
    role: 'tool-result',
    toolCallId: asToolCallId(options.toolCallId ?? 'tool-call-1'),
    toolName: options.toolName ?? 'read_timeline',
    result: options.result ?? { status: 'succeeded', output: { ok: true } },
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

function thinkingChangeEntry(
  parentId: string | null,
  entryId: string,
  createdAt = TIME_2,
): RuntimeSessionEntry {
  return {
    schemaVersion: 1,
    id: asRuntimeEntryId(entryId),
    parentId: parentId === null ? null : asRuntimeEntryId(parentId),
    createdAt,
    type: 'thinking-change',
    level: 'low',
  };
}

function compactionEntry(
  parentId: string,
  firstKeptEntryId: string,
  entryId = 'entry-compaction',
  summary = 'Compacted history.',
): RuntimeSessionEntry {
  return {
    schemaVersion: 1,
    id: asRuntimeEntryId(entryId),
    parentId: asRuntimeEntryId(parentId),
    createdAt: TIME_7,
    type: 'compaction',
    summary,
    firstKeptEntryId: asRuntimeEntryId(firstKeptEntryId),
    tokensBefore: 42,
    reason: 'manual',
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

function captureSessionError(
  action: () => unknown,
  code: SessionLogError['code'],
): SessionLogError {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof SessionLogError);
    assert.equal(error.code, code);
    return error;
  }
  throw new Error(`expected ${code}`);
}

function assertIncompatible(action: () => unknown): SessionLogError {
  return captureSessionError(action, 'SESSION_INCOMPATIBLE');
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

test('content text round-trips exact leading and trailing whitespace', () => {
  const { root, filePath, log } = makeRootedLog();
  const userText = '  user body\n\t';
  const assistantText = '\t assistant preface  ';
  const thinkingText = '  private reasoning \n';
  const argumentText = '  tool argument  ';
  const resultText = '\n tool result value \t';
  const toolDiagnostic = '  tool diagnostic  ';
  const providerDiagnostic = '\t provider diagnostic \n';
  const finalText = '  assistant final  ';
  const terminalMessage = '  terminal diagnostic  ';
  const summary = '\n  compacted summary  \t';
  try {
    log.append(startEntry());
    log.append(userEntry('entry-start', 'entry-whitespace-user', TIME_3, { text: userText }));
    log.append(assistantEntry(
      'entry-whitespace-user',
      'entry-whitespace-tool-call',
      true,
      TIME_4,
      { query: argumentText },
      {
        text: assistantText,
        thinkingText,
        diagnosticMessage: providerDiagnostic,
      },
    ));
    log.append(toolResultEntry(
      'entry-whitespace-tool-call',
      'entry-whitespace-tool-result',
      TIME_5,
      {
        result: {
          status: 'failed',
          code: 'fixture-tool-failure',
          message: toolDiagnostic,
          details: { value: resultText },
        },
      },
    ));
    log.append(assistantEntry(
      'entry-whitespace-tool-result',
      'entry-whitespace-final',
      false,
      TIME_6,
      {},
      { turnId: 'runtime-turn-2', text: finalText },
    ));
    const failedEnd = {
      ...endEntry('entry-whitespace-final', 'entry-whitespace-end', 'run-1', 'def-turn-1', 'runtime-turn-2'),
      terminal: { status: 'failed', code: 'fixture-run-failure', message: terminalMessage },
    } as Extract<RuntimeRunMarkerEntry, { phase: 'end' }>;
    log.append(failedEnd);
    log.append(compactionEntry('entry-whitespace-end', 'entry-whitespace-user', 'entry-whitespace-compaction', summary));

    const reopened = reopenSessionLog(filePath, { rootDir: root });
    const durableUser = reopened.entries[1];
    if (durableUser?.type !== 'message' || durableUser.message.role !== 'user') assert.fail('expected user entry');
    const durableUserText = durableUser.message.content[0];
    if (durableUserText?.type !== 'text') assert.fail('expected user text');
    assert.equal(durableUserText.text, userText);

    const durableToolCall = reopened.entries[2];
    if (durableToolCall?.type !== 'message' || durableToolCall.message.role !== 'assistant') {
      assert.fail('expected assistant tool-call entry');
    }
    const durableThinking = durableToolCall.message.content.find((block) => block.type === 'thinking');
    const durablePreface = durableToolCall.message.content.find((block) => block.type === 'text');
    const durableCall = durableToolCall.message.content.find((block) => block.type === 'tool-call');
    assert.equal(durableThinking?.text, thinkingText);
    assert.equal(durablePreface?.text, assistantText);
    assert.equal(durableCall?.arguments.query, argumentText);
    assert.equal(durableToolCall.message.diagnostic?.message, providerDiagnostic);

    const durableToolResult = reopened.entries[3];
    if (durableToolResult?.type !== 'message' || durableToolResult.message.role !== 'tool-result') {
      assert.fail('expected tool result entry');
    }
    if (durableToolResult.message.result.status !== 'failed') assert.fail('expected failed tool result');
    assert.equal(durableToolResult.message.result.message, toolDiagnostic);
    assert.deepEqual(durableToolResult.message.result.details, { value: resultText });

    const durableFinal = reopened.entries[4];
    if (durableFinal?.type !== 'message' || durableFinal.message.role !== 'assistant') {
      assert.fail('expected final assistant entry');
    }
    const durableFinalText = durableFinal.message.content.find((block) => block.type === 'text');
    assert.equal(durableFinalText?.text, finalText);

    const durableEnd = reopened.entries[5];
    if (durableEnd?.type !== 'run-marker' || durableEnd.phase !== 'end') assert.fail('expected run end');
    if (durableEnd.terminal.status !== 'failed') assert.fail('expected failed run');
    assert.equal(durableEnd.terminal.message, terminalMessage);

    const durableCompaction = reopened.entries[6];
    if (durableCompaction?.type !== 'compaction') assert.fail('expected compaction');
    assert.equal(durableCompaction.summary, summary);
  } finally {
    cleanup(root);
  }
});

test('createOrReopen validates and exactly binds the supplied durable header', () => {
  const { root, filePath } = makeRootedLog();
  try {
    const durableBytes = readFileSync(filePath, 'utf8');
    const mismatches: RuntimeSessionHeader[] = [
      { ...header(), runtimeSessionId: asRuntimeSessionId('runtime-session-other') },
      { ...header(), defSessionId: asDefSessionId('def-session-other') },
      { ...header(), runtimeVersion: 'runtime-other' },
      { ...header(), providerProfileRef: 'profile-other' },
      { ...header(), systemPromptVersion: 'prompt-test-v2' },
      { ...header(), createdAt: TIME_2 },
    ];
    for (const supplied of mismatches) {
      assert.throws(
        () => createOrReopenSessionLog(filePath, supplied, { rootDir: root }),
        (error: unknown) => error instanceof SessionLogError && error.code === 'SESSION_APPEND_CONFLICT',
      );
      assert.equal(readFileSync(filePath, 'utf8'), durableBytes);
    }

    const reopened = createOrReopenSessionLog(filePath, header(), { rootDir: root });
    assert.deepEqual(reopened.header, header());
  } finally {
    cleanup(root);
  }
});

test('existing files with mode 0644 are rejected without chmod or tail repair', () => {
  const { root, filePath, log } = makeRootedLog();
  try {
    appendFileSync(filePath, '{"type":"message"');
    chmodSync(filePath, 0o644);
    const exposedBytes = readFileSync(filePath, 'utf8');
    const assertRejectedWithoutMutation = (action: () => unknown): void => {
      assert.throws(action, /mode 0600/u);
      assert.equal(statSync(filePath).mode & 0o777, 0o644);
      assert.equal(readFileSync(filePath, 'utf8'), exposedBytes);
    };

    assertRejectedWithoutMutation(() => readSessionFile(filePath, { rootDir: root, repairIncompleteTail: true }));
    assertRejectedWithoutMutation(() => reopenSessionLog(filePath, { rootDir: root }));
    assertRejectedWithoutMutation(() => createOrReopenSessionLog(filePath, header(), { rootDir: root }));
    assertRejectedWithoutMutation(() => log.append(startEntry()));
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

test('one DefTurn run advances across RuntimeTurns and reports the last observed turn', () => {
  const records = [
    header(),
    startEntry(),
    userEntry('entry-start'),
    assistantEntry('entry-user', 'entry-assistant-tool', true),
    toolResultEntry('entry-assistant-tool'),
    assistantEntry(
      'entry-tool-result',
      'entry-assistant-turn-2',
      false,
      TIME_6,
      {},
      { turnId: 'runtime-turn-2' },
    ),
  ] as const;
  const completed = validateSessionRecords([
    ...records,
    endEntry('entry-assistant-turn-2', 'entry-end-turn-2', 'run-1', 'def-turn-1', 'runtime-turn-2'),
  ]);
  assert.equal(completed.runs[0]?.turnId, asRuntimeTurnId('runtime-turn-2'));
  assert.equal(completed.runs[0]?.status, 'completed');

  const interrupted = validateSessionRecords(records);
  assert.equal(interrupted.interruptedRuns[0]?.turnId, asRuntimeTurnId('runtime-turn-2'));

  const callOnSecondTurn = validateSessionRecords([
    header(),
    startEntry(),
    userEntry('entry-start'),
    assistantEntry(
      'entry-user',
      'entry-second-turn-tool',
      true,
      TIME_4,
      { query: 'fixture' },
      { turnId: 'runtime-turn-2' },
    ),
    toolResultEntry(
      'entry-second-turn-tool',
      'entry-second-turn-result',
      TIME_5,
      { turnId: 'runtime-turn-2' },
    ),
    endEntry('entry-second-turn-result', 'entry-second-turn-end', 'run-1', 'def-turn-1', 'runtime-turn-2'),
  ]);
  assert.equal(callOnSecondTurn.runs[0]?.turnId, asRuntimeTurnId('runtime-turn-2'));
});

test('RuntimeTurn reuse across DefTurns and a stale run-end turn are incompatible', () => {
  const firstEnd = endEntry('entry-start', 'entry-first-end', 'run-1', 'def-turn-1', 'runtime-turn-1', TIME_3);
  const conflictingStart = startEntry(
    'entry-second-start',
    'run-2',
    'def-turn-2',
    'runtime-turn-1',
    TIME_4,
    'entry-first-end',
  );
  assertIncompatible(() => validateSessionRecords([header(), startEntry(), firstEnd, conflictingStart]));

  const secondTurnMessage = assistantEntry(
    'entry-start',
    'entry-message-turn-2',
    false,
    TIME_4,
    {},
    { turnId: 'runtime-turn-2' },
  );
  const staleEnd = endEntry(
    'entry-message-turn-2',
    'entry-stale-end',
    'run-1',
    'def-turn-1',
    'runtime-turn-1',
  );
  assertIncompatible(() => validateSessionRecords([header(), startEntry(), secondTurnMessage, staleEnd]));

  const secondTurnCall = assistantEntry(
    'entry-start',
    'entry-call-turn-2',
    true,
    TIME_4,
    { query: 'fixture' },
    { turnId: 'runtime-turn-2' },
  );
  const wrongTurnResult = toolResultEntry('entry-call-turn-2', 'entry-result-turn-1', TIME_5);
  assertIncompatible(() => validateSessionRecords([
    header(),
    startEntry(),
    secondTurnCall,
    wrongTurnResult,
  ]));
});

test('compaction anchors must precede the entry on its selected ancestor chain', () => {
  const rootEntry = thinkingChangeEntry(null, 'entry-tree-root', TIME_2);
  const selected = thinkingChangeEntry('entry-tree-root', 'entry-selected-parent', TIME_3);
  const branch = thinkingChangeEntry('entry-tree-root', 'entry-other-branch', TIME_4);
  const validCompaction = compactionEntry(
    'entry-selected-parent',
    'entry-tree-root',
    'entry-valid-compaction',
  );
  const valid = validateSessionRecords([header(), rootEntry, selected, branch, validCompaction]);
  assert.equal(valid.leafId, asRuntimeEntryId('entry-valid-compaction'));

  const branchAnchor = compactionEntry(
    'entry-selected-parent',
    'entry-other-branch',
    'entry-branch-compaction',
  );
  assertIncompatible(() => validateSessionRecords([header(), rootEntry, selected, branch, branchAnchor]));

  const selfAnchor = compactionEntry(
    'entry-selected-parent',
    'entry-self-compaction',
    'entry-self-compaction',
  );
  assertIncompatible(() => validateSessionRecords([header(), rootEntry, selected, selfAnchor]));

  const futureAnchor = compactionEntry(
    'entry-selected-parent',
    'entry-future-child',
    'entry-future-compaction',
  );
  const futureChild = thinkingChangeEntry('entry-future-compaction', 'entry-future-child', TIME_7);
  assertIncompatible(() => validateSessionRecords([header(), rootEntry, selected, futureAnchor, futureChild]));
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
    assert.equal(read.validByteLength, read.fileByteLength);
    assert.equal(read.fileSnapshot.byteLength, read.fileByteLength);
    assert.equal(read.endsWithNewline, false);
    log.close();
    const reopened = reopenSessionLog(filePath, { rootDir: root });
    reopened.append(userEntry('entry-start'));
    const appended = readFileSync(filePath, 'utf8');
    assert.match(appended, /\n\{"schemaVersion":1/u);
    assert.equal(appended.includes('\n\n'), false);
  } finally {
    cleanup(root);
  }
});

test('all public file entry points require rootDir and return a path-safe error', () => {
  const root = mkdtempSync(join(tmpdir(), 'def-runtime-session-root-required-'));
  const filePath = join(root, 'existing.jsonl');
  const createPath = join(root, 'new.jsonl');
  writeFileSync(filePath, `${JSON.stringify(header())}\n`, { mode: 0o600 });
  try {
    const actions: Array<() => unknown> = [
      () => Reflect.apply(createSessionLog, undefined, [createPath, header()]),
      () => Reflect.apply(reopenSessionLog, undefined, [filePath]),
      () => Reflect.apply(createOrReopenSessionLog, undefined, [filePath, header()]),
      () => Reflect.apply(readSessionFile, undefined, [filePath]),
      () => Reflect.apply(scanSessionFile, undefined, [filePath]),
      () => Reflect.apply(truncateSessionFile, undefined, [filePath, 0]),
      () => Reflect.apply(SessionLog.create, SessionLog, [createPath, header()]),
      () => Reflect.apply(SessionLog.reopen, SessionLog, [filePath]),
      () => Reflect.apply(SessionLog.open, SessionLog, [filePath]),
      () => Reflect.apply(SessionLog.createOrReopen, SessionLog, [filePath, header()]),
      () => Reflect.construct(SessionReader, [filePath]),
    ];
    for (const action of actions) {
      const error = captureSessionError(action, 'SESSION_PATH_INVALID');
      assert.equal(error.message.includes(root), false);
      assert.equal(error.message.includes(filePath), false);
    }
  } finally {
    cleanup(root);
  }
});

test('macOS system path aliases are canonicalized below the trusted root', { skip: process.platform !== 'darwin' }, (context) => {
  const root = mkdtempSync(join(tmpdir(), 'def-runtime-session-macos-root-'));
  try {
    const canonicalRoot = realpathSync(root);
    const aliasRoot = canonicalRoot.startsWith('/private/var/')
      ? canonicalRoot.replace(/^\/private\/var\//u, '/var/')
      : canonicalRoot.startsWith('/private/tmp/')
        ? canonicalRoot.replace(/^\/private\/tmp\//u, '/tmp/')
        : root;
    if (aliasRoot === canonicalRoot) {
      context.skip('this macOS temporary root has no system alias');
      return;
    }
    assert.equal(realpathSync(aliasRoot), canonicalRoot);
    const log = createSessionLog(join(aliasRoot, 'session.jsonl'), header(), { rootDir: aliasRoot });
    log.append(startEntry());
    assert.equal(log.filePath, join(canonicalRoot, 'session.jsonl'));
    assert.equal(reopenSessionLog(log.filePath, { rootDir: aliasRoot }).entries.length, 1);
  } finally {
    cleanup(root);
  }
});

test('a symlinked parent beneath rootDir cannot escape the trusted tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'def-runtime-session-parent-link-'));
  const outside = mkdtempSync(join(tmpdir(), 'def-runtime-session-parent-outside-'));
  const linkedParent = join(root, 'linked-parent');
  const outsideFile = join(outside, 'escaped.jsonl');
  try {
    symlinkSync(outside, linkedParent);
    captureSessionError(
      () => createSessionLog(join(linkedParent, 'escaped.jsonl'), header(), { rootDir: root }),
      'SESSION_PATH_INVALID',
    );
    assert.throws(() => statSync(outsideFile), (error: unknown) => (
      error instanceof Error
      && 'code' in error
      && (error as NodeJS.ErrnoException).code === 'ENOENT'
    ));
  } finally {
    cleanup(root);
    cleanup(outside);
  }
});

test('group- or world-writable trusted directories are rejected', () => {
  const unsafeRoot = mkdtempSync(join(tmpdir(), 'def-runtime-session-unsafe-root-'));
  const safeRoot = mkdtempSync(join(tmpdir(), 'def-runtime-session-unsafe-parent-'));
  const unsafeParent = join(safeRoot, 'unsafe-parent');
  try {
    chmodSync(unsafeRoot, 0o777);
    captureSessionError(
      () => createSessionLog(join(unsafeRoot, 'session.jsonl'), header(), { rootDir: unsafeRoot }),
      'SESSION_PATH_INVALID',
    );

    mkdirSync(unsafeParent, { mode: 0o700 });
    chmodSync(unsafeParent, 0o775);
    captureSessionError(
      () => createSessionLog(join(unsafeParent, 'session.jsonl'), header(), { rootDir: safeRoot }),
      'SESSION_PATH_INVALID',
    );

    chmodSync(unsafeParent, 0o755);
    const accepted = createSessionLog(
      join(unsafeParent, 'accepted.jsonl'),
      header(),
      { rootDir: safeRoot },
    );
    assert.equal(accepted.entries.length, 0);
  } finally {
    cleanup(unsafeRoot);
    cleanup(safeRoot);
  }
});

test('create detects a parent replacement injected after its pre-open check', () => {
  const root = mkdtempSync(join(tmpdir(), 'def-runtime-session-create-parent-race-'));
  const parent = join(root, 'active-parent');
  mkdirSync(parent, { mode: 0o700 });
  const target = join(realpathSync(parent), 'session.jsonl');
  let displacedParent = '';
  try {
    captureSessionError(
      () => withOpenInjection(
        target,
        () => {
          displacedParent = replaceEmptyParent(target, 'displaced-parent');
        },
        () => createSessionLog(target, header(), { rootDir: root }),
      ),
      'SESSION_STALE',
    );
    assert.equal(statSync(target).size, 0);
    assert.throws(() => statSync(join(displacedParent, 'session.jsonl')));
  } finally {
    cleanup(root);
  }
});

test('read detects a parent replacement even when the final path is the same inode', () => {
  const { root, log } = makeRootedLog();
  const target = log.filePath;
  log.append(startEntry());
  const durable = readFileSync(target);
  let displacedFile = '';
  try {
    captureSessionError(
      () => withReadInjection(
        () => {
          displacedFile = replaceParentWithHardLink(target, 'displaced-read-parent');
        },
        () => readSessionFile(target, { rootDir: root }),
      ),
      'SESSION_STALE',
    );
    assert.equal(statSync(target).ino, statSync(displacedFile).ino);
    assert.deepEqual(readFileSync(target), durable);
    assert.deepEqual(readFileSync(displacedFile), durable);
  } finally {
    cleanup(root);
  }
});

test('append detects a parent replacement before writing through a same-inode hard link', () => {
  const { root, log } = makeRootedLog();
  const target = log.filePath;
  const durable = readFileSync(target);
  let displacedFile = '';
  try {
    captureSessionError(
      () => withOpenInjection(
        target,
        () => {
          displacedFile = replaceParentWithHardLink(target, 'displaced-append-parent');
        },
        () => log.append(startEntry()),
      ),
      'SESSION_STALE',
    );
    assert.equal(statSync(target).ino, statSync(displacedFile).ino);
    assert.deepEqual(readFileSync(target), durable);
    assert.deepEqual(readFileSync(displacedFile), durable);
  } finally {
    cleanup(root);
  }
});

test('tail truncation detects a parent replacement before touching a same-inode hard link', () => {
  const { root, filePath, log } = makeRootedLog();
  log.append(startEntry());
  appendFileSync(filePath, '{"partial":');
  const scan = scanSessionFile(filePath, { rootDir: root });
  const damaged = readFileSync(filePath);
  let displacedFile = '';
  try {
    assert.equal(scan.tail, 'incomplete');
    captureSessionError(
      () => withOpenInjection(
        scan.filePath,
        () => {
          displacedFile = replaceParentWithHardLink(scan.filePath, 'displaced-truncate-parent');
        },
        () => truncateSessionFile(
          scan.filePath,
          scan.validByteLength,
          { rootDir: root },
          scan.fileSnapshot,
        ),
      ),
      'SESSION_STALE',
    );
    assert.deepEqual(readFileSync(scan.filePath), damaged);
    assert.deepEqual(readFileSync(displacedFile), damaged);
  } finally {
    cleanup(root);
  }
});

test('append rejects a final-inode replacement without modifying either file', () => {
  const { root, log } = makeRootedLog();
  const target = log.filePath;
  const displaced = join(realpathSync(root), 'displaced-session.jsonl');
  const durable = readFileSync(target);
  try {
    renameSync(target, displaced);
    writeFileSync(target, durable, { mode: 0o600 });
    chmodSync(target, 0o600);
    captureSessionError(() => log.append(startEntry()), 'SESSION_STALE');
    assert.deepEqual(readFileSync(target), durable);
    assert.deepEqual(readFileSync(displaced), durable);
  } finally {
    cleanup(root);
  }
});

test('bigint revision checks reject a same-size same-inode rewrite', () => {
  const { root, log } = makeRootedLog();
  const target = log.filePath;
  try {
    const beforeSnapshot = log.state.fileSnapshot;
    const beforeStats = statSync(target, { bigint: true });
    const changed = Buffer.from(readFileSync(target));
    const markerOffset = changed.indexOf(Buffer.from('runtime-test', 'utf8'));
    assert.notEqual(markerOffset, -1);
    changed[markerOffset] = 0x73;
    writeFileSync(target, changed);
    utimesSync(
      target,
      Number(beforeStats.atimeNs) / 1_000_000_000,
      Number(beforeStats.mtimeNs) / 1_000_000_000,
    );
    const afterStats = statSync(target, { bigint: true });
    assert.equal(Number(afterStats.size), beforeSnapshot.byteLength);
    assert.notEqual(String(afterStats.ctimeNs), beforeSnapshot.changedAtNs);
    captureSessionError(() => log.append(startEntry()), 'SESSION_STALE');
    assert.deepEqual(readFileSync(target), changed);
  } finally {
    cleanup(root);
  }
});

test('append rejects an externally changed size before writing', () => {
  const { root, log } = makeRootedLog();
  const target = log.filePath;
  try {
    appendFileSync(target, ' ');
    const externallyChanged = readFileSync(target);
    captureSessionError(() => log.append(startEntry()), 'SESSION_STALE');
    assert.deepEqual(readFileSync(target), externallyChanged);
  } finally {
    cleanup(root);
  }
});

test('append idempotency is snapshot-local and requires reopen after another writer', () => {
  const { root, filePath, log: first } = makeRootedLog();
  try {
    const stalePeer = reopenSessionLog(filePath, { rootDir: root });
    first.append(startEntry());
    captureSessionError(() => stalePeer.appendEntry(startEntry()), 'SESSION_STALE');

    const currentPeer = reopenSessionLog(filePath, { rootDir: root });
    const durable = readFileSync(filePath);
    const idempotent = currentPeer.appendEntry(startEntry());
    assert.equal(idempotent.appended, false);
    assert.equal(idempotent.idempotent, true);
    assert.deepEqual(readFileSync(filePath), durable);
  } finally {
    cleanup(root);
  }
});

test('a cross-chunk tail ending inside UTF-8 repairs to a coherent snapshot and appends cleanly', () => {
  const { root, filePath, log } = makeRootedLog();
  try {
    log.append(startEntry());
    const valid = readFileSync(filePath);
    const crossChunkTail = Buffer.concat([
      Buffer.from('{"payload":"', 'utf8'),
      Buffer.alloc(70 * 1_024, 0x61),
      Buffer.from([0xe4, 0xb8]),
    ]);
    appendFileSync(filePath, crossChunkTail);

    const beforeRepair = readSessionFile(filePath, { rootDir: root });
    assert.equal(beforeRepair.tail, 'incomplete');
    assert.equal(beforeRepair.validByteLength, valid.length);
    assert.equal(beforeRepair.fileByteLength, valid.length + crossChunkTail.length);

    const repaired = reopenSessionLog(filePath, { rootDir: root });
    assert.equal(repaired.state.repairedTail, true);
    assert.equal(repaired.state.tail, 'none');
    assert.equal(repaired.state.endsWithNewline, true);
    assert.equal(repaired.state.fileByteLength, valid.length);
    assert.equal(repaired.state.validByteLength, valid.length);
    assert.equal(repaired.state.fileSnapshot.byteLength, valid.length);
    assert.deepEqual(readFileSync(filePath), valid);

    repaired.append(userEntry('entry-start', 'entry-user-after-tail-repair'));
    const durableText = readFileSync(filePath, 'utf8');
    assert.equal(durableText.includes('\n\n'), false);
    const reopened = reopenSessionLog(filePath, { rootDir: root });
    assert.equal(reopened.entries.length, 2);
    assert.equal(reopened.state.tail, 'none');
    assert.equal(reopened.state.fileSnapshot.byteLength, reopened.state.fileByteLength);
  } finally {
    cleanup(root);
  }
});

test('newline-terminated invalid UTF-8 is incompatible rather than tail-repairable', () => {
  const { root, filePath, log } = makeRootedLog();
  try {
    log.append(startEntry());
    appendFileSync(filePath, Buffer.from([0xff, 0x0a]));
    const damaged = readFileSync(filePath);
    assertIncompatible(() => reopenSessionLog(filePath, { rootDir: root }));
    assert.deepEqual(readFileSync(filePath), damaged);
  } finally {
    cleanup(root);
  }
});

test('tail truncation rejects a replaced final inode at the scanned size boundary', () => {
  const { root, filePath, log } = makeRootedLog();
  log.append(startEntry());
  appendFileSync(filePath, '{"partial":');
  const scan = scanSessionFile(filePath, { rootDir: root });
  const damaged = readFileSync(filePath);
  const displaced = join(realpathSync(root), 'displaced-tail.jsonl');
  try {
    renameSync(scan.filePath, displaced);
    writeFileSync(scan.filePath, damaged, { mode: 0o600 });
    chmodSync(scan.filePath, 0o600);
    captureSessionError(
      () => truncateSessionFile(
        scan.filePath,
        scan.validByteLength,
        { rootDir: root },
        scan.fileSnapshot,
      ),
      'SESSION_STALE',
    );
    assert.deepEqual(readFileSync(scan.filePath), damaged);
    assert.deepEqual(readFileSync(displaced), damaged);
  } finally {
    cleanup(root);
  }
});

test('reader rejects a sparse file above the 512 MiB operational ceiling before reading', () => {
  const root = mkdtempSync(join(tmpdir(), 'def-runtime-session-file-limit-'));
  const filePath = join(root, 'oversized.jsonl');
  try {
    writeFileSync(filePath, `${JSON.stringify(header())}\n`, { mode: 0o600 });
    truncateSync(filePath, (512 * 1_024 * 1_024) + 1);
    assert.equal(statSync(filePath).size, (512 * 1_024 * 1_024) + 1);
    assertIncompatible(() => readSessionFile(filePath, { rootDir: root }));
  } finally {
    cleanup(root);
  }
});

test('a RuntimeRun may stay on its latest turn but cannot resume an earlier turn', () => {
  const turn2First = assistantEntry(
    'entry-start',
    'entry-turn-2-first',
    false,
    TIME_3,
    {},
    { turnId: 'runtime-turn-2' },
  );
  const turn2Second = assistantEntry(
    'entry-turn-2-first',
    'entry-turn-2-second',
    false,
    TIME_4,
    {},
    { turnId: 'runtime-turn-2' },
  );
  const valid = validateSessionRecords([
    header(),
    startEntry(),
    turn2First,
    turn2Second,
    endEntry('entry-turn-2-second', 'entry-turn-2-end', 'run-1', 'def-turn-1', 'runtime-turn-2'),
  ]);
  assert.equal(valid.runs[0]?.turnId, asRuntimeTurnId('runtime-turn-2'));

  const resumedTurn1 = userEntry(
    'entry-turn-2-second',
    'entry-resumed-turn-1',
    TIME_5,
    { turnId: 'runtime-turn-1' },
  );
  assertIncompatible(() => validateSessionRecords([
    header(),
    startEntry(),
    turn2First,
    turn2Second,
    resumedTurn1,
  ]));
});

test('run terminal markers must name the last newly observed RuntimeTurn', () => {
  const turn2 = assistantEntry(
    'entry-start',
    'entry-terminal-turn-2',
    false,
    TIME_3,
    {},
    { turnId: 'runtime-turn-2' },
  );
  const turn3 = assistantEntry(
    'entry-terminal-turn-2',
    'entry-terminal-turn-3',
    false,
    TIME_4,
    {},
    { turnId: 'runtime-turn-3' },
  );
  const staleTerminal = endEntry(
    'entry-terminal-turn-3',
    'entry-terminal-stale-end',
    'run-1',
    'def-turn-1',
    'runtime-turn-2',
  );
  assertIncompatible(() => validateSessionRecords([
    header(),
    startEntry(),
    turn2,
    turn3,
    staleTerminal,
  ]));
});

test('a RuntimeTurn cannot be remapped to another DefTurn by a later message', () => {
  const firstEnd = endEntry('entry-start', 'entry-def-first-end', 'run-1', 'def-turn-1', 'runtime-turn-1', TIME_3);
  const secondStart = startEntry(
    'entry-def-second-start',
    'run-2',
    'def-turn-2',
    'runtime-turn-2',
    TIME_4,
    'entry-def-first-end',
  );
  const conflict = assistantEntry(
    'entry-def-second-start',
    'entry-def-conflict',
    false,
    TIME_5,
    {},
    { defTurnId: 'def-turn-2', turnId: 'runtime-turn-1' },
  );
  assertIncompatible(() => validateSessionRecords([
    header(),
    startEntry(),
    firstEnd,
    secondStart,
    conflict,
  ]));
});

test('compaction is forbidden while a Tool call is open', () => {
  const call = assistantEntry('entry-start', 'entry-open-call', true);
  const compaction = compactionEntry('entry-open-call', 'entry-start', 'entry-open-call-compaction');
  assertIncompatible(() => validateSessionRecords([
    header(),
    startEntry(),
    call,
    compaction,
  ]));
});

test('compaction remains forbidden after an interrupted terminal leaves a Tool call unresolved', () => {
  const call = assistantEntry('entry-start', 'entry-interrupted-call', true);
  const interrupted = endEntry(
    'entry-interrupted-call',
    'entry-interrupted-end',
    'run-1',
    'def-turn-1',
    'runtime-turn-1',
    TIME_6,
    'interrupted',
  );
  const compaction = compactionEntry(
    'entry-interrupted-end',
    'entry-start',
    'entry-interrupted-compaction',
  );
  assertIncompatible(() => validateSessionRecords([
    header(),
    startEntry(),
    call,
    interrupted,
    compaction,
  ]));
});

test('compaction firstKept boundaries cannot split a completed Tool call/result pair', () => {
  const call = assistantEntry('entry-user', 'entry-pair-call', true);
  const result = toolResultEntry('entry-pair-call', 'entry-pair-result');
  const end = endEntry('entry-pair-result', 'entry-pair-end');
  const base = [header(), startEntry(), userEntry('entry-start'), call, result, end] as const;

  const keepingPair = validateSessionRecords([
    ...base,
    compactionEntry('entry-pair-end', 'entry-pair-call', 'entry-keep-complete-pair'),
  ]);
  assert.equal(keepingPair.leafId, asRuntimeEntryId('entry-keep-complete-pair'));

  const droppingPair = validateSessionRecords([
    ...base,
    compactionEntry('entry-pair-end', 'entry-pair-end', 'entry-drop-complete-pair'),
  ]);
  assert.equal(droppingPair.leafId, asRuntimeEntryId('entry-drop-complete-pair'));

  assertIncompatible(() => validateSessionRecords([
    ...base,
    compactionEntry('entry-pair-end', 'entry-pair-result', 'entry-cut-complete-pair'),
  ]));
});

test('validator parent traversal is instrumented linear across at least 8k entries', () => {
  const entryCount = 8_192;
  const records: unknown[] = [header()];
  let parentReads = 0;
  for (let index = 0; index < entryCount; index += 1) {
    const parentId = index === 0 ? null : `entry-scale-${index - 1}`;
    const base = thinkingChangeEntry(parentId, `entry-scale-${index}`);
    const entry = new Proxy(base, {
      get: (target, property, receiver) => {
        if (property === 'parentId') parentReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    records.push(entry);
  }
  parentReads = 0;
  const validated = validateSessionRecords(records);
  assert.equal(validated.entries.length, entryCount);
  assert.equal(validated.leafId, asRuntimeEntryId(`entry-scale-${entryCount - 1}`));
  assert.ok(
    parentReads < entryCount * 8,
    `parent access count ${parentReads} indicates repeated chain traversal`,
  );
});

test('reader reopens an 8k-entry deep session through its streaming linear path', () => {
  const root = mkdtempSync(join(tmpdir(), 'def-runtime-session-scale-read-'));
  const filePath = join(root, 'scale.jsonl');
  const entryCount = 8_192;
  const records: Array<RuntimeSessionHeader | RuntimeSessionEntry> = [header()];
  for (let index = 0; index < entryCount; index += 1) {
    records.push(thinkingChangeEntry(
      index === 0 ? null : `entry-reader-scale-${index - 1}`,
      `entry-reader-scale-${index}`,
    ));
  }
  try {
    writeFileSync(
      filePath,
      `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
      { mode: 0o600 },
    );
    const reopened = reopenSessionLog(filePath, { rootDir: root });
    assert.equal(reopened.entries.length, entryCount);
    assert.equal(reopened.leafId, asRuntimeEntryId(`entry-reader-scale-${entryCount - 1}`));
  } finally {
    cleanup(root);
  }
});

test('secret-shaped Tool argument keys never leak through errors or durable bytes', () => {
  const { root, filePath, log } = makeRootedLog();
  const secretKey = 'sk-fixture-key-material-123456';
  try {
    log.append(startEntry());
    log.append(userEntry('entry-start'));
    const durable = readFileSync(filePath);
    const secretKeyCall = assistantEntry(
      'entry-user',
      'entry-secret-key-call',
      true,
      TIME_4,
      { [secretKey]: 'benign-value' },
    );
    const error = assertIncompatible(() => log.append(secretKeyCall));
    const rendered = [
      error.message,
      String(error),
      error.stack ?? '',
      JSON.stringify(error),
      inspect(error, { depth: 5 }),
    ].join('\n');
    assert.equal(rendered.includes(secretKey), false);
    assert.deepEqual(readFileSync(filePath), durable);
    assert.equal(readFileSync(filePath, 'utf8').includes(secretKey), false);
  } finally {
    cleanup(root);
  }
});

test('oversized untrusted JSON field names are rejected without echoing the field', () => {
  const { root, filePath, log } = makeRootedLog();
  const oversizedKey = 'x'.repeat(257);
  try {
    log.append(startEntry());
    const durable = readFileSync(filePath);
    const oversizedKeyCall = assistantEntry(
      'entry-start',
      'entry-oversized-key-call',
      true,
      TIME_4,
      { [oversizedKey]: 'benign-value' },
    );
    const error = assertIncompatible(() => log.append(oversizedKeyCall));
    const rendered = `${error.message}\n${JSON.stringify(error)}\n${inspect(error)}`;
    assert.equal(rendered.includes(oversizedKey), false);
    assert.deepEqual(readFileSync(filePath), durable);
  } finally {
    cleanup(root);
  }
});

test('assistant tool-use stopReason requires at least one executable Tool call', () => {
  const message = assistantEntry(
    'entry-start',
    'entry-tool-use-without-call',
    false,
    TIME_4,
    {},
    { stopReason: 'tool-use' },
  );
  assertIncompatible(() => validateSessionRecords([header(), startEntry(), message]));
});

test('assistant non-tool stop reasons reject executable Tool calls', () => {
  const nonToolReasons = ['stop', 'length', 'error', 'aborted'] as const;
  for (const reason of nonToolReasons) {
    const message = assistantEntry(
      'entry-start',
      `entry-call-with-${reason}`,
      true,
      TIME_4,
      {},
      { stopReason: reason },
    );
    assertIncompatible(() => validateSessionRecords([header(), startEntry(), message]));
  }
});

test('Tool argument accessors are rejected without invoking their getter', () => {
  const { root, filePath, log } = makeRootedLog();
  let getterReads = 0;
  const argumentsWithGetter: Record<string, unknown> = {};
  Object.defineProperty(argumentsWithGetter, 'payload', {
    enumerable: true,
    get: () => {
      getterReads += 1;
      return 'should-never-be-read';
    },
  });
  try {
    log.append(startEntry());
    const durable = readFileSync(filePath);
    const call = assistantEntry(
      'entry-start',
      'entry-getter-call',
      true,
      TIME_4,
      argumentsWithGetter as JsonObject,
    );
    assertIncompatible(() => log.append(call));
    assert.equal(getterReads, 0);
    assert.deepEqual(readFileSync(filePath), durable);
  } finally {
    cleanup(root);
  }
});

test('shared JSON DAG references fail closed before repeated traversal or stringify', () => {
  const { root, filePath, log } = makeRootedLog();
  const shared = { value: 'fixture' };
  const references = Array.from({ length: 4_096 }, () => shared);
  try {
    log.append(startEntry());
    const durable = readFileSync(filePath);
    const call = assistantEntry(
      'entry-start',
      'entry-shared-dag-call',
      true,
      TIME_4,
      { references } as unknown as JsonObject,
    );
    assertIncompatible(() => log.append(call));
    assert.deepEqual(readFileSync(filePath), durable);
  } finally {
    cleanup(root);
  }
});

test('global JSON node budget stops before a late accessor branch is reached', () => {
  const { root, filePath, log } = makeRootedLog();
  let lateGetterReads = 0;
  const branches: unknown[] = Array.from({ length: 4_095 }, () => [0, 1, 2, 3]);
  const lateBranch: unknown[] = [];
  Object.defineProperty(lateBranch, '0', {
    enumerable: true,
    get: () => {
      lateGetterReads += 1;
      return 0;
    },
  });
  branches.push(lateBranch);
  try {
    log.append(startEntry());
    const durable = readFileSync(filePath);
    const call = assistantEntry(
      'entry-start',
      'entry-json-budget-call',
      true,
      TIME_4,
      { branches } as unknown as JsonObject,
    );
    const error = assertIncompatible(() => log.append(call));
    assert.match(error.message, /node budget/u);
    assert.equal(lateGetterReads, 0);
    assert.deepEqual(readFileSync(filePath), durable);
  } finally {
    cleanup(root);
  }
});

test('global JSON string budget rejects aggregate strings before message serialization', () => {
  const { root, filePath, log } = makeRootedLog();
  const parts = Array.from({ length: 1_025 }, () => 'x'.repeat(1_024));
  try {
    log.append(startEntry());
    const durable = readFileSync(filePath);
    const call = assistantEntry(
      'entry-start',
      'entry-json-string-budget-call',
      true,
      TIME_4,
      { parts } as unknown as JsonObject,
    );
    const error = assertIncompatible(() => log.append(call));
    assert.match(error.message, /string budget/u);
    assert.deepEqual(readFileSync(filePath), durable);
  } finally {
    cleanup(root);
  }
});

test('global JSON field budget spans every nested container in one record', () => {
  const { root, filePath, log } = makeRootedLog();
  const objects = Array.from({ length: 33 }, (_, objectIndex) => Object.fromEntries(
    Array.from({ length: 256 }, (__, fieldIndex) => [
      `field_${objectIndex}_${fieldIndex}`,
      fieldIndex,
    ]),
  ));
  try {
    log.append(startEntry());
    const durable = readFileSync(filePath);
    const call = assistantEntry(
      'entry-start',
      'entry-json-field-budget-call',
      true,
      TIME_4,
      { objects } as unknown as JsonObject,
    );
    const error = assertIncompatible(() => log.append(call));
    assert.match(error.message, /field budget/u);
    assert.deepEqual(readFileSync(filePath), durable);
  } finally {
    cleanup(root);
  }
});
