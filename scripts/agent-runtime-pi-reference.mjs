#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const PINNED_COMMIT = 'e47b8e37a6211ebd0b2942fa87059d64f81eec02';
const PINNED_VERSION = '0.84.1';
const PI_REPOSITORY = 'https://github.com/earendil-works/pi-mono';
const RUNNER_VERSION = 3;
const SYSTEM_PROMPT = 'Pi Golden Oracle deterministic system prompt';
// Loaded directly from PI_REFERENCE_ROOT at Pi commit
// e47b8e37a6211ebd0b2942fa87059d64f81eec02; none are copied into the product.
const PI_REFERENCE_SOURCE_PATHS = Object.freeze([
  'packages/agent/src/agent.ts',
  'packages/ai/src/utils/event-stream.ts',
  'packages/ai/src/utils/validation.ts',
  'packages/ai/src/utils/uuid.ts',
  'packages/coding-agent/src/core/messages.ts',
  'packages/coding-agent/src/core/session-manager.ts',
]);
const MODEL = Object.freeze({
  api: 'faux',
  provider: 'pi-golden-oracle',
  id: 'pi-golden-oracle-model',
  name: 'Pi Golden Oracle Model',
  baseUrl: 'http://127.0.0.1:0',
  reasoning: true,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8_192,
  maxTokens: 1_024,
});

const SCENARIOS = ['text', 'reasoning', 'tool', 'error', 'abort', 'compaction'];
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const FIXTURE_DIRECTORY = path.resolve(path.dirname(SCRIPT_PATH), '../agent/runtime/kernel/testing/fixtures');

async function main() {
  if (!process.execArgv.includes('--experimental-strip-types')) {
    const child = spawnSync(
      process.execPath,
      ['--experimental-strip-types', SCRIPT_PATH, ...process.argv.slice(2)],
      { env: process.env, stdio: 'inherit' },
    );
    if (child.error) throw child.error;
    process.exitCode = child.status ?? 1;
    return;
  }

  const options = parseArguments(process.argv.slice(2));
  const referenceRoot = resolveReferenceRoot();
  const normalizer = await import(
    pathToFileURL(path.resolve(path.dirname(SCRIPT_PATH), '../agent/runtime/kernel/testing/trace-normalizer.ts')).href,
  );
  const pi = await loadPiSource(referenceRoot);
  const scenarioNames = options.scenario === 'all' ? SCENARIOS : [options.scenario];
  const traces = new Map();

  for (const scenario of scenarioNames) {
    traces.set(scenario, await generateScenario(scenario, pi, normalizer));
  }

  if (options.writeFixtures) {
    const manifest = writeFixtures(traces, normalizer);
    process.stdout.write(`${stableJsonStringify(manifest)}\n`);
    return;
  }

  if (scenarioNames.length === 1) {
    process.stdout.write(normalizer.serializeNormalizedTrace(traces.get(scenarioNames[0])));
    return;
  }

  process.stdout.write(`${stableJsonStringify(Object.fromEntries(traces))}\n`);
}

function parseArguments(args) {
  let scenario = 'all';
  let writeFixtures = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--write-fixtures') {
      writeFixtures = true;
      continue;
    }
    if (argument === '--scenario') {
      scenario = args[index + 1];
      index += 1;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      process.stdout.write(
        'Usage: PI_REFERENCE_ROOT=/path/to/pi-mono node scripts/agent-runtime-pi-reference.mjs [--scenario <name>|all] [--write-fixtures]\n',
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (scenario !== 'all' && !SCENARIOS.includes(scenario)) {
    throw new Error(`Unknown Pi reference scenario: ${scenario}`);
  }
  if (writeFixtures && scenario !== 'all') {
    throw new Error('--write-fixtures requires --scenario all');
  }
  return { scenario, writeFixtures };
}

function resolveReferenceRoot() {
  const configuredRoot = process.env.PI_REFERENCE_ROOT;
  if (!configuredRoot || !configuredRoot.trim()) {
    throw new Error('PI_REFERENCE_ROOT is required; the Pi reference must be an explicit temporary clone');
  }
  const root = path.resolve(configuredRoot);
  if (!existsSync(path.join(root, 'packages/agent/src/agent.ts')) || !existsSync(path.join(root, 'package.json'))) {
    throw new Error('PI_REFERENCE_ROOT is not a Pi source root with packages/agent/src/agent.ts');
  }
  let commit;
  try {
    commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error('PI_REFERENCE_ROOT must be a clean readable Git clone');
  }
  if (commit !== PINNED_COMMIT) {
    throw new Error(`PI_REFERENCE_ROOT must be pinned to Pi commit ${PINNED_COMMIT}`);
  }
  const diff = spawnSync('git', ['-C', root, 'diff', '--quiet', 'HEAD', '--'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let trackedStatus;
  try {
    trackedStatus = execFileSync(
      'git',
      ['-C', root, 'status', '--porcelain=v1', '--untracked-files=no', '--ignored=no'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  } catch {
    throw new Error('PI_REFERENCE_ROOT must be a clean readable Git clone');
  }
  if (diff.error || (diff.status !== 0 && diff.status !== 1)) {
    throw new Error('PI_REFERENCE_ROOT must be a clean readable Git clone');
  }
  if (diff.status === 1 || trackedStatus) {
    throw new Error('PI_REFERENCE_ROOT has tracked modifications; restore the pinned source and lockfiles');
  }
  let packageVersion;
  try {
    packageVersion = JSON.parse(readFileSync(path.join(root, 'packages/agent/package.json'), 'utf8')).version;
  } catch {
    throw new Error('PI_REFERENCE_ROOT is missing the Pi agent package metadata');
  }
  if (packageVersion !== PINNED_VERSION) {
    throw new Error(`PI_REFERENCE_ROOT must provide Pi version ${PINNED_VERSION}`);
  }
  return root;
}

async function loadPiSource(referenceRoot) {
  const aiSource = (relativePath) => pathToFileURL(path.join(referenceRoot, 'packages/ai/src', relativePath)).href;
  const rootSource = (relativePath) => pathToFileURL(path.join(referenceRoot, relativePath)).href;
  const packageParent = pathToFileURL(path.join(referenceRoot, 'package.json')).href;
  const aiShim = `data:text/javascript,${encodeURIComponent(
    `export { EventStream } from ${JSON.stringify(aiSource('utils/event-stream.ts'))};\n` +
      `export { validateToolArguments } from ${JSON.stringify(aiSource('utils/validation.ts'))};\n` +
      `export { uuidv7 } from ${JSON.stringify(aiSource('utils/uuid.ts'))};\n`,
  )}`;
  const sourceLoader = `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier === '@earendil-works/pi-ai') {
        return { url: ${JSON.stringify(aiShim)}, shortCircuit: true };
      }
      if (specifier === 'typebox' || specifier.startsWith('typebox/')) {
        return nextResolve(specifier, { ...context, parentURL: ${JSON.stringify(packageParent)} });
      }
      return nextResolve(specifier, context);
    }
  `)}`;
  register(sourceLoader, import.meta.url);

  const [agentModule, streamModule, codingMessagesModule, sessionManagerModule] = await Promise.all([
    import(rootSource('packages/agent/src/agent.ts')),
    import(rootSource('packages/ai/src/utils/event-stream.ts')),
    import(rootSource('packages/coding-agent/src/core/messages.ts')),
    import(rootSource('packages/coding-agent/src/core/session-manager.ts')),
  ]);
  return {
    Agent: agentModule.Agent,
    createAssistantMessageEventStream: streamModule.createAssistantMessageEventStream,
    convertToLlm: codingMessagesModule.convertToLlm,
    buildContextEntries: sessionManagerModule.buildContextEntries,
    buildSessionContext: sessionManagerModule.buildSessionContext,
  };
}

async function generateScenario(scenario, pi, normalizer) {
  const collector = new TraceCollector(scenario);
  const responses = scriptedResponses(scenario);
  let responseIndex = 0;
  const tools = scenario === 'tool' ? [createAddTool()] : [];
  const compactionProjection = scenario === 'compaction'
    ? createCompactionSessionProjection(pi)
    : undefined;
  if (compactionProjection) {
    collector.compaction(
      compactionProjection.compactionEntry,
      compactionProjection.compactionMessage,
      compactionProjection.firstKeptItemIndex,
    );
  }
  const streamFn = (model, context, options) => {
    const response = responses[responseIndex];
    responseIndex += 1;
    if (!response) throw new Error(`Pi scripted response exhausted for ${scenario}`);
    return createScriptedStream({
      model,
      response,
      options,
      collector,
      streamFactory: pi.createAssistantMessageEventStream,
    });
  };

  const agentOptions = {
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model: MODEL,
      thinkingLevel: scenario === 'reasoning' ? 'low' : 'off',
      tools,
      messages: compactionProjection?.sessionContext.messages ?? [],
    },
    streamFn,
    toolExecution: 'sequential',
    convertToLlm: (messages) => {
      const context = { systemPrompt: SYSTEM_PROMPT, tools, messages };
      collector.contextSnapshot(context, contextSnapshotItems(context, collector));
      return scenario === 'compaction'
        ? pi.convertToLlm(messages)
        : messages.filter(
            (message) => message.role === 'user'
              || message.role === 'assistant'
              || message.role === 'toolResult',
          );
    },
  };
  const agent = new pi.Agent(agentOptions);
  agent.subscribe((event) => {
    collector.agentEvent(event);
    if (
      scenario === 'abort'
      && event.type === 'message_update'
      && event.assistantMessageEvent.type === 'text_delta'
      && !agent.signal?.aborted
    ) {
      agent.abort();
    }
  });

  if (scenario === 'compaction') {
    await agent.prompt('New prompt after compacted session.');
  } else {
    await agent.prompt(promptForScenario(scenario));
  }

  const endStatus = scenario === 'error'
    ? { status: 'failed', code: 'PI_REFERENCE_ERROR', message: 'deterministic provider error' }
    : scenario === 'abort'
      ? { status: 'aborted', code: 'PI_REFERENCE_ABORTED', message: 'deterministic abort' }
      : { status: 'completed' };
  collector.runEnd(endStatus);
  return normalizer.normalizePiTrace(collector.rawTrace());
}

function scriptedResponses(scenario) {
  switch (scenario) {
    case 'text':
      return [responseSpec([{ type: 'text', text: 'Deterministic text response.' }], 'stop', usage(4, 4, 8))];
    case 'reasoning':
      return [responseSpec([
        { type: 'thinking', thinking: 'Inspect the deterministic input.' },
        { type: 'text', text: 'Deterministic reasoned response.' },
      ], 'stop', usage(6, 7, 13, 3))];
    case 'tool':
      return [
        responseSpec([
          { type: 'toolCall', id: randomIdentifier('tool-call'), name: 'oracle.add', arguments: { left: 2, right: 40 } },
        ], 'toolUse', usage(8, 5, 13)),
        responseSpec([{ type: 'text', text: 'The deterministic tool returned 42.' }], 'stop', usage(16, 7, 23)),
      ];
    case 'error':
      return [responseSpec([], 'error', usage(3, 0, 3), 'deterministic provider error')];
    case 'abort':
      return [responseSpec(
        [{ type: 'text', text: 'Abort after the first streamed delta.' }],
        'stop',
        usage(3, 6, 9),
      )];
    case 'compaction':
      return [responseSpec(
        [{ type: 'text', text: 'Response after deterministic compaction.' }],
        'stop',
        usage(31, 5, 36),
      )];
    default:
      throw new Error(`Unknown Pi reference scenario: ${scenario}`);
  }
}

function responseSpec(content, stopReason, responseUsage, errorMessage) {
  return { content, stopReason, responseUsage, errorMessage };
}

function usage(input, output, total, reasoning) {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: total,
    ...(reasoning === undefined ? {} : { reasoning }),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function createCompactionSessionProjection(pi) {
  const timestamps = [
    '2025-01-01T00:00:00.000Z',
    '2025-01-01T00:01:00.000Z',
    '2025-01-01T00:02:00.000Z',
    '2025-01-01T00:03:00.000Z',
    '2025-01-01T00:04:00.000Z',
    '2025-01-01T00:05:00.000Z',
    '2025-01-01T00:06:00.000Z',
    '2025-01-01T00:07:00.000Z',
  ];
  const userMessage = (text, timestamp) => ({
    role: 'user',
    content: text,
    timestamp: Date.parse(timestamp),
  });
  const seededAssistantMessage = (text, timestamp) => assistantMessage(
    MODEL,
    [{ type: 'text', text }],
    'stop',
    usage(1, 1, 2),
    undefined,
    Date.parse(timestamp),
  );
  const messageEntry = (id, parentId, message, timestamp) => ({
    type: 'message',
    id,
    parentId,
    timestamp,
    message,
  });

  const entries = [
    messageEntry(
      'session-old-user',
      null,
      userMessage('Summarized-away old user message.', timestamps[0]),
      timestamps[0],
    ),
    messageEntry(
      'session-old-assistant',
      'session-old-user',
      seededAssistantMessage('Summarized-away old assistant response.', timestamps[1]),
      timestamps[1],
    ),
    {
      type: 'compaction',
      id: 'session-older-compaction',
      parentId: 'session-old-assistant',
      timestamp: timestamps[2],
      summary: 'Superseded earlier compaction summary.',
      firstKeptEntryId: 'session-old-user',
      tokensBefore: 32,
    },
    messageEntry(
      'session-retained-user',
      'session-older-compaction',
      userMessage('Retained tail user message.', timestamps[3]),
      timestamps[3],
    ),
    messageEntry(
      'session-retained-assistant',
      'session-retained-user',
      seededAssistantMessage('Retained tail assistant response.', timestamps[4]),
      timestamps[4],
    ),
    {
      type: 'compaction',
      id: 'session-compaction',
      parentId: 'session-retained-assistant',
      timestamp: timestamps[5],
      summary: 'The obsolete opening exchange was summarized deterministically.',
      firstKeptEntryId: 'session-retained-user',
      tokensBefore: 64,
    },
    messageEntry(
      'session-post-user',
      'session-compaction',
      userMessage('Post-compaction session user entry.', timestamps[6]),
      timestamps[6],
    ),
    messageEntry(
      'session-post-assistant',
      'session-post-user',
      seededAssistantMessage('Post-compaction session assistant entry.', timestamps[7]),
      timestamps[7],
    ),
  ];
  const compactionEntry = entries[5];

  // These guards verify the pinned Pi result; selection and projection remain
  // exclusively implemented by Pi's real coding-agent Session functions.
  const contextEntries = pi.buildContextEntries(entries);
  const expectedEntryIds = [
    'session-compaction',
    'session-retained-user',
    'session-retained-assistant',
    'session-post-user',
    'session-post-assistant',
  ];
  if (JSON.stringify(contextEntries.map((entry) => entry.id)) !== JSON.stringify(expectedEntryIds)) {
    throw new Error('Pinned Pi buildContextEntries returned an unexpected compaction projection');
  }
  const sessionContext = pi.buildSessionContext(entries);
  const expectedRoles = ['compactionSummary', 'user', 'assistant', 'user', 'assistant'];
  if (JSON.stringify(sessionContext.messages.map((message) => message.role)) !== JSON.stringify(expectedRoles)) {
    throw new Error('Pinned Pi buildSessionContext did not project a real compactionSummary message');
  }

  return {
    compactionEntry,
    compactionMessage: sessionContext.messages[0],
    firstKeptItemIndex: entries.findIndex((entry) => entry.id === compactionEntry.firstKeptEntryId),
    sessionContext,
  };
}

function createScriptedStream({ model, response, options, collector, streamFactory }) {
  const stream = streamFactory();
  let partialContent = [];
  let abortEmitted = false;

  const pushAbort = () => {
    if (abortEmitted) return;
    abortEmitted = true;
    const failure = assistantMessage(
      model,
      partialContent,
      'aborted',
      response.responseUsage,
      'deterministic abort',
    );
    stream.push({ type: 'error', reason: 'aborted', error: failure });
  };

  // A macrotask boundary lets Pi consume the pushed event and finish its
  // awaited Agent.subscribe listeners before the next provider chunk is sent.
  const boundary = () => new Promise((resolve) => setImmediate(resolve));
  const pushEvent = async (event) => {
    if (options?.signal?.aborted) {
      pushAbort();
      return false;
    }
    stream.push(event);
    await boundary();
    if (options?.signal?.aborted) {
      pushAbort();
      return false;
    }
    return true;
  };

  void (async () => {
    if (options?.signal?.aborted) {
      pushAbort();
      return;
    }
    if (response.stopReason === 'error') {
      await boundary();
      if (options?.signal?.aborted) {
        pushAbort();
        return;
      }
      const failure = assistantMessage(model, [], 'error', response.responseUsage, response.errorMessage);
      stream.push({ type: 'error', reason: 'error', error: failure });
      return;
    }

    const partial = assistantMessage(model, [], 'pending', response.responseUsage);
    if (!await pushEvent({ type: 'start', partial })) return;
    for (const [contentIndex, block] of response.content.entries()) {
      if (block.type === 'text') {
        partialContent = [...partialContent, { type: 'text', text: '' }];
        if (!await pushEvent({
          type: 'text_start',
          contentIndex,
          partial: assistantMessage(model, partialContent, 'pending', response.responseUsage),
        })) return;
        let text = '';
        for (const delta of streamChunks(block.text)) {
          text += delta;
          partialContent = [...partialContent.slice(0, -1), { type: 'text', text }];
          if (!await pushEvent({
            type: 'text_delta',
            contentIndex,
            delta,
            partial: assistantMessage(model, partialContent, 'pending', response.responseUsage),
          })) return;
        }
        if (!await pushEvent({
          type: 'text_end',
          contentIndex,
          content: block.text,
          partial: assistantMessage(model, partialContent, 'pending', response.responseUsage),
        })) return;
      } else if (block.type === 'thinking') {
        partialContent = [...partialContent, { type: 'thinking', thinking: '' }];
        if (!await pushEvent({
          type: 'thinking_start',
          contentIndex,
          partial: assistantMessage(model, partialContent, 'pending', response.responseUsage),
        })) return;
        let thinking = '';
        for (const delta of streamChunks(block.thinking)) {
          thinking += delta;
          partialContent = [...partialContent.slice(0, -1), { type: 'thinking', thinking }];
          if (!await pushEvent({
            type: 'thinking_delta',
            contentIndex,
            delta,
            partial: assistantMessage(model, partialContent, 'pending', response.responseUsage),
          })) return;
        }
        if (!await pushEvent({
          type: 'thinking_end',
          contentIndex,
          content: block.thinking,
          partial: assistantMessage(model, partialContent, 'pending', response.responseUsage),
        })) return;
      } else if (block.type === 'toolCall') {
        partialContent = [...partialContent, { type: 'toolCall', id: block.id, name: block.name, arguments: {} }];
        if (!await pushEvent({
          type: 'toolcall_start',
          contentIndex,
          partial: assistantMessage(model, partialContent, 'pending', response.responseUsage),
        })) return;
        let argumentText = '';
        for (const delta of streamChunks(JSON.stringify(block.arguments))) {
          argumentText += delta;
          partialContent = [
            ...partialContent.slice(0, -1),
            { type: 'toolCall', id: block.id, name: block.name, arguments: parsePartialJsonObject(argumentText) },
          ];
          if (!await pushEvent({
            type: 'toolcall_delta',
            contentIndex,
            delta,
            partial: assistantMessage(model, partialContent, 'pending', response.responseUsage),
          })) return;
        }
        partialContent = [...partialContent.slice(0, -1), block];
        if (!await pushEvent({
          type: 'toolcall_end',
          contentIndex,
          toolCall: block,
          partial: assistantMessage(model, partialContent, 'pending', response.responseUsage),
        })) return;
      }
    }
    const finalMessage = assistantMessage(model, response.content, response.stopReason, response.responseUsage);
    await pushEvent({
      type: 'done',
      reason: response.stopReason,
      message: finalMessage,
    });
  })().catch((error) => {
    if (options?.signal?.aborted) {
      pushAbort();
      return;
    }
    const failure = assistantMessage(
      model,
      partialContent,
      'error',
      response.responseUsage,
      error instanceof Error ? error.message : String(error),
    );
    stream.push({ type: 'error', reason: 'error', error: failure });
  });
  return stream;
}

function streamChunks(text) {
  if (text.length < 3) return [text];
  const firstEnd = Math.max(1, Math.ceil(text.length / 3));
  const secondEnd = Math.max(firstEnd + 1, Math.ceil((text.length * 2) / 3));
  return [text.slice(0, firstEnd), text.slice(firstEnd, secondEnd), text.slice(secondEnd)]
    .filter((chunk) => chunk.length > 0);
}

function parsePartialJsonObject(text) {
  try {
    const value = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {
    // Pi keeps the partial tool-call arguments as an object while JSON is incomplete.
  }
  return {};
}

function assistantMessage(model, content, stopReason, responseUsage, errorMessage, timestamp = Date.now()) {
  return {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: responseUsage,
    stopReason,
    ...(errorMessage === undefined ? {} : { errorMessage }),
    timestamp,
  };
}

function createAddTool() {
  return {
    label: 'Oracle Add',
    name: 'oracle.add',
    description: 'Add two deterministic integers.',
    parameters: {
      type: 'object',
      properties: {
        left: { type: 'integer' },
        right: { type: 'integer' },
      },
      required: ['left', 'right'],
      additionalProperties: false,
    },
    execute: async (_toolCallId, args) => ({
      content: [{ type: 'text', text: `${args.left + args.right}` }],
      details: { sum: args.left + args.right },
    }),
  };
}

class TraceCollector {
  constructor(scenario) {
    this.scenario = scenario;
    this.runId = randomIdentifier('run');
    this.events = [];
    this.turnId = undefined;
    this.turnStartEvent = undefined;
    this.assistantMessageId = undefined;
    this.streamingDeltas = new Map();
    this.messageIds = new WeakMap();
    this.emit('run.start', { turnId: undefined, data: {} });
  }

  agentEvent(event) {
    if (event.type === 'turn_start') {
      this.turnId = randomIdentifier('turn');
      this.turnStartEvent = this.emit('turn.start', { data: { contextItemCount: 0 } });
      this.assistantMessageId = undefined;
      this.streamingDeltas = new Map();
      return;
    }
    if (event.type === 'message_start' && event.message?.role === 'user') {
      const messageId = this.idForMessage(event.message, 'message');
      this.emit('message.user', {
        turnId: this.turnId,
        messageId,
        data: {
          text: messageText(event.message),
          attachmentCount: messageAttachments(event.message),
        },
      });
      return;
    }
    if (event.type === 'message_start' && event.message?.role === 'assistant') {
      // Pi emits message_start for a provider `start` only when the partial
      // message is pending. Error/abort responses without a provider start
      // arrive as a final message_start and must not become response.start.
      if (event.message.stopReason === 'pending') {
        this.assistantMessageId = this.idForMessage(event.message, 'message');
        this.emit('response.start', {
          messageId: this.assistantMessageId,
          data: { providerId: event.message.provider, modelId: event.message.model },
        });
      }
      return;
    }
    if (event.type === 'message_update') {
      this.recordStreamingDelta(event.assistantMessageEvent);
      return;
    }
    if (event.type === 'message_end' && event.message?.role === 'assistant') {
      this.assistantEnd(event.message);
      return;
    }
    if (event.type === 'message_end' && event.message?.role === 'toolResult') {
      this.toolResult(event.message);
      return;
    }
    if (event.type === 'turn_end') {
      this.turnEnd(event.message);
    }
  }

  contextSnapshot(context, items) {
    if (this.turnStartEvent) {
      this.turnStartEvent.data.contextItemCount = items.length;
      this.turnStartEvent = undefined;
    }
    this.emit('context.snapshot', {
      data: {
        systemPrompt: context.systemPrompt ?? '',
        toolNames: (context.tools ?? []).map((tool) => tool.name),
        items,
      },
    });
  }

  compaction(entry, message, firstKeptItemIndex) {
    this.emit('compaction', {
      messageId: this.idForMessage(message, 'message'),
      data: {
        status: 'completed',
        reason: 'manual',
        summary: entry.summary,
        firstKeptItemIndex,
        tokensBefore: entry.tokensBefore,
      },
      turnId: undefined,
    });
  }

  assistantEnd(message) {
    if (!this.assistantMessageId) this.assistantMessageId = this.idForMessage(message, 'message');
    this.messageIds.set(message, this.assistantMessageId);
    const contentOrder = [];
    for (const [contentIndex, block] of message.content.entries()) {
      if (block.type === 'text') {
        contentOrder.push('text');
        const stream = this.streamingDeltas.get(contentIndex);
        this.emit('content.text', {
          messageId: this.assistantMessageId,
          data: {
            contentIndex,
            text: block.text,
            deltas: stream?.kind === 'text' ? stream.deltas : [],
          },
        });
      } else if (block.type === 'thinking') {
        contentOrder.push('reasoning');
        const stream = this.streamingDeltas.get(contentIndex);
        this.emit('content.reasoning', {
          messageId: this.assistantMessageId,
          data: {
            contentIndex,
            text: block.thinking,
            deltas: stream?.kind === 'reasoning' ? stream.deltas : [],
            redacted: block.redacted === true,
          },
        });
      } else if (block.type === 'toolCall') {
        contentOrder.push('tool-call');
        const stream = this.streamingDeltas.get(contentIndex);
        this.emit('tool.call', {
          messageId: this.assistantMessageId,
          toolCallId: block.id,
          data: {
            contentIndex,
            name: block.name,
            arguments: block.arguments,
            argumentDeltas: stream?.kind === 'tool-arguments' ? stream.deltas : [],
          },
        });
      }
    }
    this.emit('message.assistant', {
      messageId: this.assistantMessageId,
      data: {
        stopReason: normalizeStopReason(message.stopReason),
        usage: normalizeUsage(message.usage),
        contentOrder,
      },
    });
  }

  recordStreamingDelta(event) {
    if (!this.assistantMessageId) return;
    if (event.type !== 'text_delta' && event.type !== 'thinking_delta' && event.type !== 'toolcall_delta') return;
    const kind = event.type === 'text_delta'
      ? 'text'
      : event.type === 'thinking_delta'
        ? 'reasoning'
        : 'tool-arguments';
    const existing = this.streamingDeltas.get(event.contentIndex);
    if (existing && existing.kind !== kind) {
      throw new Error(`Pi content index ${event.contentIndex} changed streaming delta kind`);
    }
    if (typeof event.delta !== 'string') throw new TypeError('Pi streaming delta must be a string');
    this.streamingDeltas.set(event.contentIndex, {
      kind,
      deltas: [...(existing?.deltas ?? []), event.delta],
    });
  }

  toolResult(message) {
    const output = toolOutput(message);
    const eventData = message.isError
      ? {
          status: 'failed',
          name: message.toolName,
          code: 'PI_TOOL_ERROR',
          message: toolOutputMessage(message),
          details: output,
        }
      : { status: 'succeeded', name: message.toolName, output };
    this.emit('tool.result', {
      messageId: this.idForMessage(message, 'message'),
      toolCallId: message.toolCallId,
      data: eventData,
    });
  }

  turnEnd(message) {
    this.emit('turn.end', {
      data: {
        stopReason: normalizeStopReason(message.stopReason),
        toolResultCount: this.events.filter(
          (event) => event.type === 'tool.result' && event.turnId === this.turnId,
        ).length,
      },
    });
    this.turnId = undefined;
    this.turnStartEvent = undefined;
    this.assistantMessageId = undefined;
  }

  runEnd(data) {
    this.emit('run.end', { data, turnId: undefined });
  }

  rawTrace() {
    return {
      schemaVersion: 2,
      scenario: this.scenario,
      source: {
        kind: 'pi-reference',
        repository: PI_REPOSITORY,
        commit: PINNED_COMMIT,
        version: PINNED_VERSION,
        generatedBy: 'scripts/agent-runtime-pi-reference.mjs',
      },
      events: this.events,
    };
  }

  idForMessage(message, prefix) {
    if (!message || typeof message !== 'object') throw new TypeError('Pi message must be an object');
    const existing = this.messageIds.get(message);
    if (existing) return existing;
    const id = randomIdentifier(prefix);
    this.messageIds.set(message, id);
    return id;
  }

  emit(type, { turnId = this.turnId, messageId, toolCallId, data }) {
    const event = {
      type,
      runId: this.runId,
      ...(turnId === undefined ? {} : { turnId }),
      ...(messageId === undefined ? {} : { messageId }),
      ...(toolCallId === undefined ? {} : { toolCallId }),
      data,
      timestamp: Date.now(),
    };
    this.events.push(event);
    return event;
  }
}

function contextSnapshotItems(context, collector) {
  const items = [];
  for (const message of context.messages ?? []) {
    const messageId = message.messageId ?? collector.idForMessage(message, 'message');
    if (message.role === 'user') {
      items.push({ kind: 'user-text', messageId, text: messageText(message) });
      continue;
    }
    if (message.role === 'assistant') {
      for (const block of message.content ?? []) {
        if (block.type === 'text') items.push({ kind: 'assistant-text', messageId, text: block.text });
        else if (block.type === 'thinking') {
          items.push({ kind: 'assistant-reasoning', messageId, text: block.thinking });
        } else if (block.type === 'toolCall') {
          items.push({
            kind: 'assistant-tool-call',
            messageId,
            toolCallId: block.id,
            name: block.name,
            arguments: block.arguments,
          });
        }
      }
      continue;
    }
    if (message.role === 'toolResult') {
      items.push({
        kind: 'tool-result',
        messageId,
        toolCallId: message.toolCallId,
        name: message.toolName,
        status: message.isError ? 'failed' : 'succeeded',
        output: toolOutput(message),
      });
      continue;
    }
    if (message.role === 'compactionSummary') {
      items.push({ kind: 'compaction', messageId, summary: message.summary });
    }
  }
  return items;
}

function messageText(message) {
  if (typeof message.content === 'string') return message.content;
  return (message.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function messageAttachments(message) {
  if (typeof message.content === 'string') return 0;
  return (message.content ?? []).filter((block) => block.type === 'image').length;
}

function toolOutput(message) {
  if (message.details !== undefined) return jsonSafe(message.details);
  const text = toolOutputMessage(message);
  return text;
}

function toolOutputMessage(message) {
  return (message.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function jsonSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return '[unserializable tool output]';
  }
}

function normalizeStopReason(value) {
  switch (value) {
    case 'toolUse': return 'tool-use';
    case 'stop': return 'stop';
    case 'length': return 'length';
    case 'error': return 'error';
    case 'aborted': return 'aborted';
    default: throw new Error(`Unsupported Pi stop reason: ${value}`);
  }
}

function normalizeUsage(value) {
  return {
    inputTokens: value.input,
    outputTokens: value.output,
    totalTokens: value.totalTokens,
    ...(value.reasoning === undefined ? {} : { reasoningTokens: value.reasoning }),
    ...(value.cacheRead === undefined ? {} : { cacheReadTokens: value.cacheRead }),
    ...(value.cacheWrite === undefined ? {} : { cacheWriteTokens: value.cacheWrite }),
  };
}

function promptForScenario(scenario) {
  switch (scenario) {
    case 'text': return 'produce deterministic text';
    case 'reasoning': return 'reason deterministically';
    case 'tool': return 'add the deterministic operands';
    case 'error': return 'produce deterministic error';
    case 'abort': return 'produce deterministic abort';
    default: throw new Error(`No prompt for scenario ${scenario}`);
  }
}

function randomIdentifier(prefix) {
  return `${prefix}-${cryptoRandomHex(16)}`;
}

function cryptoRandomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function writeFixtures(traces, normalizer) {
  mkdirSync(FIXTURE_DIRECTORY, { recursive: true });
  const fixtures = [];
  for (const scenario of SCENARIOS) {
    const trace = traces.get(scenario);
    const file = `${scenario}.json`;
    const bytes = normalizer.serializeNormalizedTrace(trace);
    const absolutePath = path.join(FIXTURE_DIRECTORY, file);
    writeFileSync(absolutePath, bytes, 'utf8');
    fixtures.push({
      scenario,
      file,
      sha256: createHash('sha256').update(bytes, 'utf8').digest('hex'),
      byteLength: Buffer.byteLength(bytes, 'utf8'),
    });
  }
  const manifest = {
    manifestVersion: 1,
    upstream: {
      repository: PI_REPOSITORY,
      commit: PINNED_COMMIT,
      version: PINNED_VERSION,
    },
    generation: {
      runner: 'scripts/agent-runtime-pi-reference.mjs',
      runnerVersion: RUNNER_VERSION,
      seed: 'pi-golden-oracle-v3-streaming-deltas',
      systemPrompt: SYSTEM_PROMPT,
      model: MODEL.id,
      transport: 'scripted AssistantMessageEventStream with async multi-chunk deltas',
      toolExecution: 'sequential',
      compactionProjection: 'Pi coding-agent buildContextEntries + buildSessionContext',
      referenceSourcePaths: PI_REFERENCE_SOURCE_PATHS,
      idNormalization: 'first-seen ordinal per namespace',
      timestampNormalization: 'discard raw Pi event timestamps',
      streamingDeltaCapture: 'Pi Agent message_update assistantMessageEvent deltas',
    },
    fixtures,
  };
  writeFileSync(path.join(FIXTURE_DIRECTORY, 'manifest.json'), `${stableJsonStringify(manifest)}\n`, 'utf8');
  return manifest;
}

function stableJsonStringify(value) {
  return JSON.stringify(sortJsonValue(value), null, 2);
}

function sortJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortJsonValue(value[key])]),
  );
}

function isMainModule() {
  return process.argv[1] !== undefined && path.resolve(process.argv[1]) === SCRIPT_PATH;
}

if (isMainModule()) {
  await main();
}
