import assert from 'node:assert/strict';
import {
  appendFileSync,
  chmodSync,
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
    stopReason: withToolCall ? 'tool-use' : 'stop',
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
    log.close();
    const reopened = reopenSessionLog(filePath, { rootDir: root });
    reopened.append(userEntry('entry-start'));
    assert.match(readFileSync(filePath, 'utf8'), /\n\{"schemaVersion":1/u);
  } finally {
    cleanup(root);
  }
});
