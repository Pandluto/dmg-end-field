import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
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
import type {
  RuntimeAssistantMessage,
  RuntimeToolResultMessage,
  RuntimeUserMessage,
} from '../messages.ts';
import {
  asRuntimeContentId,
  asRuntimeEntryId,
  asRuntimeMessageId,
  asRuntimeRunId,
  asRuntimeSessionId,
  asRuntimeTurnId,
} from '../ids.ts';
import type {
  RuntimeRunMarkerEntry,
  RuntimeRunMarkerTerminal,
  RuntimeSessionEntry,
  RuntimeSessionHeader,
} from './entries.ts';
import {
  compactSession,
  shouldCompact,
} from './compaction.ts';
import { buildCompactionPrompt } from './compaction-prompt.ts';
import { projectSessionContext } from './context-builder.ts';
import { createSessionLog, reopenSessionLog } from './session-log.ts';
import type { SessionLog } from './session-log.ts';

const TIME = '2026-08-08T00:00:00.000Z';

function header(): RuntimeSessionHeader {
  return {
    type: 'session',
    schemaVersion: 1,
    runtimeSessionId: asRuntimeSessionId('runtime-session-compaction'),
    defSessionId: asDefSessionId('def-session-compaction'),
    runtimeVersion: 'runtime-fixture',
    providerProfileRef: 'profile-fixture',
    systemPromptVersion: 'prompt-fixture-v1',
    createdAt: TIME,
  };
}

function marker(
  id: string,
  parentId: string | null,
  phase: 'start' | 'end',
  turnId: string,
  terminal?: RuntimeRunMarkerTerminal,
): RuntimeRunMarkerEntry {
  if (phase === 'start') {
    return {
      schemaVersion: 1,
      id: asRuntimeEntryId(id),
      parentId: parentId === null ? null : asRuntimeEntryId(parentId),
      createdAt: TIME,
      type: 'run-marker',
      phase: 'start',
      defTurnId: asDefTurnId('def-turn-compaction'),
      runId: asRuntimeRunId('run-compaction'),
      turnId: asRuntimeTurnId(turnId),
    };
  }
  return {
    schemaVersion: 1,
    id: asRuntimeEntryId(id),
    parentId: parentId === null ? null : asRuntimeEntryId(parentId),
    createdAt: TIME,
    type: 'run-marker',
    phase: 'end',
    defTurnId: asDefTurnId('def-turn-compaction'),
    runId: asRuntimeRunId('run-compaction'),
    turnId: asRuntimeTurnId(turnId),
    terminal: terminal ?? { status: 'completed' },
  };
}

function userEntry(id: string, parentId: string, turnId: string, text: string): RuntimeSessionEntry {
  const message: RuntimeUserMessage = {
    schemaVersion: 1,
    id: asRuntimeMessageId(`${id}-message`),
    createdAt: TIME,
    defTurnId: asDefTurnId('def-turn-compaction'),
    turnId: asRuntimeTurnId(turnId),
    role: 'user',
    clientTurnId: asClientTurnId(`${id}-client`),
    content: [{ type: 'text', id: asRuntimeContentId(`${id}-content`), text }],
  };
  return {
    schemaVersion: 1,
    id: asRuntimeEntryId(id),
    parentId: asRuntimeEntryId(parentId),
    createdAt: TIME,
    type: 'message',
    message,
  };
}

function assistantEntry(id: string, parentId: string, turnId: string, text: string): RuntimeSessionEntry {
  const message: RuntimeAssistantMessage = {
    schemaVersion: 1,
    id: asRuntimeMessageId(`${id}-message`),
    createdAt: TIME,
    defTurnId: asDefTurnId('def-turn-compaction'),
    turnId: asRuntimeTurnId(turnId),
    role: 'assistant',
    content: [{ type: 'text', id: asRuntimeContentId(`${id}-content`), text }],
    providerId: 'fixture-provider',
    modelId: 'fixture-model',
    usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
    stopReason: 'stop',
    completedAt: TIME,
  };
  return {
    schemaVersion: 1,
    id: asRuntimeEntryId(id),
    parentId: asRuntimeEntryId(parentId),
    createdAt: TIME,
    type: 'message',
    message,
  };
}

function makeConversation(): { readonly root: string; readonly filePath: string; readonly log: SessionLog } {
  const root = mkdtempSync(join(tmpdir(), 'def-context-compaction-'));
  const filePath = join(root, 'runtime.jsonl');
  const log = createSessionLog(filePath, header(), { rootDir: root });
  log.append(marker('run-start', null, 'start', 'turn-1'));
  let parent = 'run-start';
  for (let index = 1; index <= 6; index += 1) {
    const turn = `turn-${index}`;
    const userId = `user-${index}`;
    const assistantId = `assistant-${index}`;
    log.append(userEntry(userId, parent, turn, `User goal fact ${index}.`));
    log.append(assistantEntry(assistantId, userId, turn, `Completed response ${index}.`));
    parent = assistantId;
  }
  log.append(marker('run-end', parent, 'end', 'turn-6'));
  return { root, filePath, log };
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

test('manual compaction is append-only and restart rebuilds the same latest context', async () => {
  const { root, filePath, log } = makeConversation();
  try {
    const outcome = await compactSession({
      session: log,
      reason: 'manual',
      firstKeptEntryId: asRuntimeEntryId('user-4'),
      summary: 'User goal: continue the work. Completed: facts 1-3. Remaining: facts 4-6.',
      currentInputTokens: 120,
      now: () => TIME,
      summaryEntryId: asRuntimeEntryId('compaction-manual'),
    });
    assert.equal(outcome.status, 'compacted');
    assert.equal(outcome.firstKeptEntryId, asRuntimeEntryId('user-4'));
    assert.equal(log.entries.length, 15);

    const beforeRestart = projectSessionContext(log);
    const reopened = reopenSessionLog(filePath, { rootDir: root });
    const afterRestart = projectSessionContext(reopened);
    assert.deepEqual(afterRestart.messages, beforeRestart.messages);
    assert.equal(afterRestart.latestCompaction?.summary, 'User goal: continue the work. Completed: facts 1-3. Remaining: facts 4-6.');
    assert.equal(JSON.stringify(afterRestart.messages).includes('User goal fact 1.'), false);
    assert.equal(JSON.stringify(afterRestart.messages).includes('User goal fact 4.'), true);
  } finally {
    cleanup(root);
  }
});

test('summary failure leaves the original Session bytes and entries unchanged', async () => {
  const { root, filePath, log } = makeConversation();
  try {
    const beforeBytes = readFileSync(filePath, 'utf8');
    const beforeEntries = log.entries;
    const outcome = await compactSession({
      session: log,
      reason: 'manual',
      firstKeptEntryId: asRuntimeEntryId('user-4'),
      summarize: async () => { throw new Error('summary provider failed'); },
      now: () => TIME,
    });
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.code, 'COMPACTION_SUMMARY_FAILED');
    assert.equal(readFileSync(filePath, 'utf8'), beforeBytes);
    assert.deepEqual(log.entries, beforeEntries);
  } finally {
    cleanup(root);
  }
});

test('threshold uses current usage, not the usage stored on an older compaction', async () => {
  const { root, log } = makeConversation();
  try {
    const first = await compactSession({
      session: log,
      reason: 'manual',
      firstKeptEntryId: asRuntimeEntryId('user-4'),
      summary: 'Previous summary.',
      currentUsage: { inputTokens: 9_000, outputTokens: 4, totalTokens: 9_004 },
      now: () => TIME,
      summaryEntryId: asRuntimeEntryId('compaction-old'),
    });
    assert.equal(first.status, 'compacted');
    assert.equal(log.entries.at(-1)?.type, 'compaction');

    assert.equal(shouldCompact({ currentInputTokens: 20, contextLimit: 100, thresholdTokens: 80 }), false);
    const count = log.entries.length;
    const second = await compactSession({
      session: log,
      reason: 'threshold',
      currentInputTokens: 20,
      contextLimit: 100,
      thresholdTokens: 80,
      summary: 'Must not be written.',
      now: () => TIME,
    });
    assert.equal(second.status, 'not-needed');
    assert.equal(log.entries.length, count);
  } finally {
    cleanup(root);
  }
});

test('overflow compaction supports atomic Tool pair boundaries and bounded prompt facts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'def-context-overflow-'));
  const filePath = join(root, 'runtime.jsonl');
  const log = createSessionLog(filePath, header(), { rootDir: root });
  try {
    log.append(marker('run-start', null, 'start', 'turn-1'));
    log.append(userEntry('user-tool', 'run-start', 'turn-1', 'Apply the approved change.'));
    const toolCall: RuntimeAssistantMessage = {
      schemaVersion: 1,
      id: asRuntimeMessageId('assistant-tool-message'),
      createdAt: TIME,
      defTurnId: asDefTurnId('def-turn-compaction'),
      turnId: asRuntimeTurnId('turn-1'),
      role: 'assistant',
      content: [{
        type: 'tool-call',
        id: asRuntimeContentId('tool-call-content'),
        toolCallId: asToolCallId('tool-call-1'),
        name: 'workbench.mutate',
        arguments: { operation: 'apply' },
      }],
      providerId: 'fixture-provider',
      modelId: 'fixture-model',
      usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
      stopReason: 'tool-use',
      completedAt: TIME,
    };
    log.append({
      schemaVersion: 1,
      id: asRuntimeEntryId('assistant-tool'),
      parentId: asRuntimeEntryId('user-tool'),
      createdAt: TIME,
      type: 'message',
      message: toolCall,
    });
    const toolResult: RuntimeToolResultMessage = {
      schemaVersion: 1,
      id: asRuntimeMessageId('tool-result-message'),
      createdAt: TIME,
      defTurnId: asDefTurnId('def-turn-compaction'),
      turnId: asRuntimeTurnId('turn-1'),
      role: 'tool-result',
      toolCallId: asToolCallId('tool-call-1'),
      toolName: 'workbench.mutate',
      result: { status: 'succeeded', output: { commandId: 'receipt-1', status: 'committed' } },
      completedAt: TIME,
    };
    log.append({
      schemaVersion: 1,
      id: asRuntimeEntryId('tool-result'),
      parentId: asRuntimeEntryId('assistant-tool'),
      createdAt: TIME,
      type: 'message',
      message: toolResult,
    });
    log.append(assistantEntry('assistant-after-tool', 'tool-result', 'turn-2', 'Continue from the receipt.'));
    log.append(marker('run-end', 'assistant-after-tool', 'end', 'turn-2'));

    const prompt = buildCompactionPrompt({ entries: log.entries });
    assert.match(prompt, /User goal/u);
    assert.match(prompt, /mutation receipts/u);
    assert.match(prompt, /receipt-1/u);
    assert.doesNotMatch(prompt, /current-product-snapshot-payload/u);
    assert.doesNotMatch(prompt, /sk-provider-secret/u);

    const outcome = await compactSession({
      session: log,
      reason: 'overflow',
      firstKeptEntryId: asRuntimeEntryId('tool-result'),
      summary: 'Completed: the approved mutation committed. Key Tool result: receipt-1.',
      now: () => TIME,
      summaryEntryId: asRuntimeEntryId('compaction-overflow'),
    });
    assert.equal(outcome.status, 'compacted');
    if (outcome.status === 'compacted') {
      assert.equal(outcome.firstKeptEntryId, asRuntimeEntryId('assistant-tool'));
    }
    const context = projectSessionContext(log);
    assert.deepEqual(context.messages.map((message) => message.role), [
      'compaction', 'assistant', 'tool-result', 'assistant',
    ]);
    assert.equal(JSON.stringify(context.messages).includes('receipt-1'), true);
  } finally {
    cleanup(root);
  }
});
