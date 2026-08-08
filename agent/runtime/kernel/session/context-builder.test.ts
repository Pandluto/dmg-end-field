import assert from 'node:assert/strict';
import test from 'node:test';
import {
  asDatabaseGeneration,
  asDefTurnId,
  asClientTurnId,
  asToolCallId,
  asTimelineId,
  asWorkspaceId,
} from '../../../core/contracts/ids.ts';
import type { ProductBinding, ProductSnapshotEnvelope } from '../../../core/contracts/product.ts';
import {
  asRuntimeContentId,
  asRuntimeEntryId,
  asRuntimeMessageId,
  asRuntimeTurnId,
} from '../ids.ts';
import type {
  RuntimeAssistantMessage,
  RuntimeToolResultMessage,
  RuntimeUserMessage,
} from '../messages.ts';
import type {
  RuntimeCompactionEntry,
  RuntimeMessageEntry,
  RuntimeSessionEntry,
} from './entries.ts';
import {
  buildContext,
  ContextBuilderError,
  projectSessionContext,
} from './context-builder.ts';

const CREATED_AT = '2026-08-08T00:00:00.000Z';

function binding(revision: number): ProductBinding {
  return {
    workspaceId: asWorkspaceId('workspace-fixture'),
    databaseGeneration: asDatabaseGeneration('database-fixture'),
    timelineId: asTimelineId('timeline-fixture'),
    checkoutTargetId: 'checkout-fixture',
    checkoutUpdatedAt: revision,
    contentRevision: revision,
    snapshotDigest: `digest-${revision}`,
  };
}

function snapshot(revision: number): ProductSnapshotEnvelope {
  return {
    protocolVersion: 1,
    binding: binding(revision),
    capturedAt: CREATED_AT,
    payload: {
      revision,
      visibleFact: `fact-${revision}`,
      nested: { value: revision },
    },
  };
}

function userMessage(id: string, text: string, turn = id): RuntimeUserMessage {
  return {
    schemaVersion: 1,
    id: asRuntimeMessageId(`${id}-message`),
    createdAt: CREATED_AT,
    defTurnId: asDefTurnId('def-turn-fixture'),
    turnId: asRuntimeTurnId(turn),
    role: 'user',
    clientTurnId: asClientTurnId(`${id}-client`),
    content: [{ type: 'text', id: asRuntimeContentId(`${id}-content`), text }],
  };
}

function assistantMessage(id: string, text: string, turn = id): RuntimeAssistantMessage {
  return {
    schemaVersion: 1,
    id: asRuntimeMessageId(`${id}-message`),
    createdAt: CREATED_AT,
    defTurnId: asDefTurnId('def-turn-fixture'),
    turnId: asRuntimeTurnId(turn),
    role: 'assistant',
    content: [{ type: 'text', id: asRuntimeContentId(`${id}-content`), text }],
    providerId: 'fixture-provider',
    modelId: 'fixture-model',
    usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
    stopReason: 'stop',
    completedAt: CREATED_AT,
  };
}

function entry(
  id: string,
  parentId: string | null,
  message: RuntimeUserMessage | RuntimeAssistantMessage | RuntimeToolResultMessage,
): RuntimeMessageEntry {
  return {
    schemaVersion: 1,
    id: asRuntimeEntryId(id),
    parentId: parentId === null ? null : asRuntimeEntryId(parentId),
    createdAt: CREATED_AT,
    type: 'message',
    message,
  };
}

function compaction(
  id: string,
  parentId: string,
  firstKeptEntryId: string,
  summary: string,
): RuntimeCompactionEntry {
  return {
    schemaVersion: 1,
    id: asRuntimeEntryId(id),
    parentId: asRuntimeEntryId(parentId),
    createdAt: CREATED_AT,
    type: 'compaction',
    summary,
    firstKeptEntryId: asRuntimeEntryId(firstKeptEntryId),
    tokensBefore: 80,
    reason: 'manual',
  };
}

test('product context is rebuilt each request and never enters durable messages', () => {
  const durable = [entry('user-1', null, userMessage('user-1', 'Keep the durable goal.'))];
  const first = buildContext({
    entries: durable,
    stableSystemPrompt: 'Stable DEF system.',
    defInstructions: 'DEF instruction A.',
    harnessInstructions: 'Harness phase A.',
    product: { binding: binding(1), snapshot: snapshot(1) },
  });
  const second = buildContext({
    entries: durable,
    stableSystemPrompt: 'Stable DEF system.',
    defInstructions: 'DEF instruction B.',
    harnessInstructions: 'Harness phase B.',
    product: { binding: binding(2), snapshot: snapshot(2) },
  });

  assert.match(first.systemPrompt, /fact-1/u);
  assert.doesNotMatch(first.systemPrompt, /fact-2/u);
  assert.match(second.systemPrompt, /fact-2/u);
  assert.doesNotMatch(second.systemPrompt, /fact-1/u);
  assert.deepEqual(second.messages, first.messages);
  assert.doesNotMatch(JSON.stringify(second.messages), /fact-[12]/u);
  assert.match(second.systemPrompt, /Current ProductBinding/u);
  assert.match(second.systemPrompt, /Current bounded Product snapshot/u);
});

test('only the latest compaction summary and its ancestor tail become ModelDriver messages', () => {
  const entries: RuntimeSessionEntry[] = [
    entry('old-user', null, userMessage('old-user', 'Old goal.')),
    entry('old-assistant', 'old-user', assistantMessage('old-assistant', 'Old answer.')),
    compaction('compaction-old', 'old-assistant', 'old-user', 'Superseded summary.'),
    entry('retained-user', 'compaction-old', userMessage('retained-user', 'Retained fact.')),
    compaction('compaction-latest', 'retained-user', 'retained-user', 'Latest durable summary.'),
    entry('post-user', 'compaction-latest', userMessage('post-user', 'Post-compaction request.')),
    entry('post-assistant', 'post-user', assistantMessage('post-assistant', 'Post-compaction answer.')),
  ];

  const context = projectSessionContext(entries);
  assert.equal(context.latestCompaction?.id, asRuntimeEntryId('compaction-latest'));
  assert.equal(context.firstKeptEntryId, asRuntimeEntryId('retained-user'));
  assert.deepEqual(
    context.messages.map((message) => message.role),
    ['compaction', 'user', 'user', 'assistant'],
  );
  assert.equal(context.messages[0]?.role === 'compaction' ? context.messages[0].summary : '', 'Latest durable summary.');
  assert.equal(JSON.stringify(context.messages).includes('Superseded summary.'), false);
  assert.equal(JSON.stringify(context.messages).includes('Old goal.'), false);
});

test('a valid compaction anchor keeps a Tool call, its result, and mutation receipt together', () => {
  const call: RuntimeAssistantMessage = {
    ...assistantMessage('tool-call', 'Applying the requested change.', 'turn-tool'),
    content: [{
      type: 'tool-call',
      id: asRuntimeContentId('tool-call-content'),
      toolCallId: asToolCallId('tool-call-fixture'),
      name: 'workbench.mutate',
      arguments: { operation: 'apply' },
    }],
    stopReason: 'tool-use',
  };
  const result: RuntimeToolResultMessage = {
    schemaVersion: 1,
    id: asRuntimeMessageId('tool-result-message'),
    createdAt: CREATED_AT,
    defTurnId: asDefTurnId('def-turn-fixture'),
    turnId: asRuntimeTurnId('turn-tool'),
    role: 'tool-result',
    toolCallId: asToolCallId('tool-call-fixture'),
    toolName: 'workbench.mutate',
    result: {
      status: 'succeeded',
      output: { receipt: { commandId: 'command-unique-1', status: 'committed' } },
    },
    completedAt: CREATED_AT,
  };
  const entries: RuntimeSessionEntry[] = [
    entry('before', null, userMessage('before', 'Earlier context.')),
    entry('call', 'before', call),
    entry('result', 'call', result),
    compaction('compaction', 'result', 'call', 'Mutation was committed with its receipt.'),
    entry('after', 'compaction', userMessage('after', 'Continue from the receipt.')),
  ];

  const context = projectSessionContext(entries);
  assert.deepEqual(
    context.messages.map((message) => message.role),
    ['compaction', 'assistant', 'tool-result', 'user'],
  );
  assert.equal(JSON.stringify(context.messages).includes('command-unique-1'), true);
});

test('a compaction whose anchor is not on the active ancestor chain is rejected', () => {
  const invalid = [
    entry('user', null, userMessage('user', 'Goal.')),
    compaction('compaction', 'user', 'missing', 'Invalid anchor.'),
  ];
  assert.throws(
    () => projectSessionContext(invalid),
    (error: unknown) => error instanceof ContextBuilderError && error.code === 'CONTEXT_COMPACTION_INVALID',
  );
});
