import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  asDatabaseGeneration,
  asDefSessionId,
  asDefTurnId,
  asTimelineId,
  asWorkspaceId,
  type CommandId,
  type Phase2ProductOperationSchema,
  type ProductBinding,
  type ProductCommandEnvelope,
  type ProductCommandReceipt,
  type ProductCommandResult,
  type ProductGateway,
  type ProductSnapshotEnvelope,
  type JsonObject,
} from '../../core/contracts/index.ts';
import { DefHarnessManager } from '../../core/harness/manager.ts';
import { DefReadToolRegistry } from '../../core/tools/read-only-workbench.ts';
import { DefAgentHost } from '../../host/def-agent-host.ts';
import { OpenCodeEngineAdapter } from './adapter.ts';
import { InMemoryOpenCodeProviderProfileSource } from './profile.ts';
import { toOpenCodeSafeToolName } from './tool-bindings.ts';

const routeDescription = 'Route this Turn to one allowlisted DEF business operation.';
const blackboxCases = [
  {
    id: 'selection',
    userMessage: '请告诉我当前选择了哪些干员。',
    route: { businessId: 'selection', operation: 'inspect' },
    tools: [{
      safeName: 'def_node_crud_context',
      canonicalName: 'def.node.crud.context',
      description: 'Read the bound current Workbench context and selected roster.',
      input: {},
    }],
    answer: '当前选择了 1 名干员：测试干员。',
  },
  {
    id: 'loadout',
    userMessage: '请读取当前干员的武器、装备和套装。',
    route: { businessId: 'loadout', operation: 'inspect' },
    tools: [{
      safeName: 'def_data_resource_team_loadouts',
      canonicalName: 'def.data.resource.team_loadouts',
      description: 'Read exact current loadouts for all selected operators.',
      input: {},
    }],
    answer: '测试干员已配置测试武器、3 件测试装备与测试套装。',
  },
  {
    id: 'timeline',
    userMessage: '请读取当前排轴和结算位置。',
    route: { businessId: 'timeline', operation: 'current' },
    tools: [{
      safeName: 'def_node_crud_current',
      canonicalName: 'def.node.crud.current',
      description: 'Read the current timeline checkout and stable skill-button coordinates.',
      input: {},
    }],
    answer: '当前排轴包含 1 个技能按钮，结算目标为 node-opencode-blackbox。',
  },
  {
    id: 'buff',
    userMessage: '请查找当前按钮上的灼热增伤 Buff。',
    route: { businessId: 'buff', operation: 'resolve' },
    tools: [{
      safeName: 'def_data_resource_buff',
      canonicalName: 'def.data.resource.buff',
      description: 'Resolve bounded Buff facts present in the current Workbench snapshot.',
      input: { query: '灼热', buttonId: 'button-blackbox' },
    }],
    answer: '按钮 button-blackbox 当前包含灼热增伤。',
  },
  {
    id: 'calculation',
    userMessage: '请读取当前工作台，并告诉我当前总期望伤害。',
    route: { businessId: 'calculation', operation: 'calculate' },
    tools: [{
      safeName: 'def_node_crud_context',
      canonicalName: 'def.node.crud.context',
      description: 'Read the bound current Workbench context and selected roster.',
      input: {},
    }, {
      safeName: 'def_data_resource_damage',
      canonicalName: 'def.data.resource.damage',
      description: 'Read the product-generated typed damage report without recomputing formulas.',
      input: {},
    }],
    answer: '当前总期望伤害为 1234.5。',
  },
] as const;

const providerPlan = blackboxCases.flatMap((scenario) => [
  {
    scenarioId: scenario.id,
    safeName: 'def_harness_route',
    description: routeDescription,
    input: scenario.route,
  },
  ...scenario.tools.map((tool) => ({ scenarioId: scenario.id, ...tool })),
  { scenarioId: scenario.id, answer: scenario.answer },
]);

async function run(): Promise<void> {
  const tools = new DefReadToolRegistry();
  const harness = new DefHarnessManager({ resolveToolDescriptor: (name) => tools.resolveDescriptor(name) });
  const schemaInspection = harness.beginTurn({
    defSessionId: asDefSessionId('def-session-schema-inspection'),
    defTurnId: asDefTurnId('def-turn-schema-inspection'),
  });
  const schemas = new Map<string, JsonObject>();
  for (const descriptor of [
    ...schemaInspection.transaction.projection.tools,
    ...tools.listDescriptors(),
  ]) {
    schemas.set(toOpenCodeSafeToolName(descriptor.name), descriptor.inputSchema);
  }
  const provider = await startProviderStub(schemas);
  const storeRoot = await mkdtemp(join(tmpdir(), 'def-opencode-real-blackbox-'));
  const binding = fixtureBinding();
  const product = new FixtureProductGateway(fixtureSnapshot(binding));
  const engine = new OpenCodeEngineAdapter({
    runtimeRoot: resolve('dist/agent/engine/opencode'),
    storeRoot,
    profileSource: new InMemoryOpenCodeProviderProfileSource([{
      ref: 'blackbox',
      providerId: 'blackbox',
      displayName: 'DEF Deterministic Blackbox',
      baseUrl: `${provider.origin}/v1`,
      modelId: 'def-deterministic-model',
      apiKey: 'blackbox-local-key',
      contextLimit: 32_000,
      outputLimit: 2_048,
    }]),
    probeProfileRef: 'blackbox',
  });
  const host = new DefAgentHost({
    engine,
    productGateway: product,
    harnessManager: harness,
    toolRegistry: tools,
    requireConsumer: () => {},
  });

  try {
    assert.deepEqual(await engine.probe(), {
      status: 'ready',
      kind: 'opencode',
      runtimeVersion: '1.17.11-def.1',
    });
    const results = [];
    for (const scenario of blackboxCases) {
      const session = await host.createSession({ binding, providerProfileRef: 'blackbox' });
      const turn = await host.startHarnessTurn({
        defSessionId: session.defSessionId,
        userMessage: scenario.userMessage,
      });
      const terminal = await withTimeout(host.waitForTurnTerminal(turn.defTurnId), 60_000).catch((error: unknown) => {
        console.error(JSON.stringify({
          scenario: scenario.id,
          providerToolSets: provider.toolSets,
          providerFailure: provider.failure?.stack ?? null,
          events: host.readEvents(session.defSessionId),
        }, null, 2));
        throw error;
      });
      const events = host.readEvents(session.defSessionId);
      assert.equal(terminal.type, 'turn.completed', JSON.stringify(events, null, 2));
      assert.equal(provider.failure, null, provider.failure?.stack);
      assert.deepEqual(
        events.filter((event) => event.type === 'tool.requested').map((event) => event.payload.name),
        ['def.harness.route', ...scenario.tools.map((tool) => tool.canonicalName)],
      );
      assert.deepEqual(
        events.filter((event) => event.type === 'harness.tool.projected').map((event) => event.payload.tools),
        [
          ['def.harness.route'],
          ...scenario.tools.map((tool) => [tool.canonicalName]),
          [],
        ],
      );
      const answer = events
        .filter((event) => event.type === 'response.delta')
        .map((event) => event.payload.delta)
        .join('');
      assert.equal(answer, scenario.answer);
      results.push({
        scenario: scenario.id,
        engineTools: events
          .filter((event) => event.type === 'tool.requested')
          .map((event) => event.payload.name),
        answer,
      });
    }
    assert.equal(provider.failure, null, provider.failure?.stack);
    assert.equal(provider.requestCount, providerPlan.length);
    assert.equal(product.snapshotReads, 6);
    console.log(JSON.stringify({
      result: 'real OpenCode five-route blackbox passed',
      runtimeVersion: '1.17.11-def.1',
      providerRequests: provider.requestCount,
      results,
    }, null, 2));
  } finally {
    await host.shutdown().catch(() => undefined);
    await provider.stop();
    await rm(storeRoot, { recursive: true, force: true });
  }
}

class FixtureProductGateway implements ProductGateway<Phase2ProductOperationSchema> {
  readonly #snapshot: ProductSnapshotEnvelope;
  snapshotReads = 0;

  constructor(snapshot: ProductSnapshotEnvelope) {
    this.#snapshot = snapshot;
  }

  async getSnapshot(_binding: ProductBinding): Promise<ProductSnapshotEnvelope> {
    this.snapshotReads += 1;
    return this.#snapshot;
  }

  async dispatch(_command: ProductCommandEnvelope<Phase2ProductOperationSchema>): Promise<ProductCommandReceipt> {
    throw new Error('Real read-only blackbox must not dispatch product mutations');
  }

  async awaitResult(_commandId: CommandId): Promise<ProductCommandResult> {
    throw new Error('Real read-only blackbox must not wait for product mutations');
  }

  async reconcile(_commandId: CommandId): Promise<ProductCommandResult | null> {
    throw new Error('Real read-only blackbox must not reconcile product mutations');
  }
}

async function startProviderStub(expectedSchemas: ReadonlyMap<string, JsonObject>): Promise<{
  readonly origin: string;
  readonly toolSets: string[][];
  readonly requestCount: number;
  readonly failure: Error | null;
  stop(): Promise<void>;
}> {
  const toolSets: string[][] = [];
  let failure: Error | null = null;
  let requestIndex = 0;
  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      failure = error instanceof Error ? error : new Error(String(error));
      response.statusCode = 500;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ error: { message: 'deterministic provider assertion failed' } }));
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    assert.equal(request.method, 'POST');
    assert.equal(url.pathname, '/v1/chat/completions');
    const body = await readJson(request);
    const record = asRecord(body);
    assert.equal(record.model, 'def-deterministic-model');
    assert.equal(record.stream, true);
    const definitions = Array.isArray(record.tools) ? record.tools : [];
    const names = definitions.map((definition) => {
      const item = asRecord(definition);
      const fn = asRecord(item.function);
      assert.equal(item.type, 'function');
      assert.equal(typeof fn.name, 'string');
      return fn.name as string;
    }).sort();
    toolSets.push(names);
    const expected = providerPlan[requestIndex];
    assert.ok(expected, `Unexpected provider request ${requestIndex + 1}`);
    const hasTool = 'safeName' in expected && typeof expected.safeName === 'string';
    const expectedNames = hasTool ? [expected.safeName] : [];
    assert.deepEqual(names, expectedNames);
    if (hasTool) {
      const fn = asRecord(asRecord(definitions[0]).function);
      assert.equal(typeof fn.description, 'string');
      assert.equal(
        (fn.description as string).startsWith(`${expected.description}\nCurrent Harness phase: `),
        true,
      );
      assert.deepEqual(
        fn.parameters,
        expectedSchemas.get(expected.safeName),
        `${expected.safeName} 必须把 Harness 的动态 schema 原样送到 provider`,
      );
    }
    response.statusCode = 200;
    response.setHeader('content-type', 'text/event-stream; charset=utf-8');
    response.setHeader('cache-control', 'no-cache');
    response.setHeader('connection', 'keep-alive');
    if (hasTool) {
      writeToolCall(
        response,
        requestIndex,
        `call-${expected.scenarioId}-${expected.safeName}`,
        expected.safeName!,
        expected.input,
      );
    } else {
      writeText(response, requestIndex, expected.answer);
    }
    requestIndex += 1;
  }

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Provider stub has no address');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    toolSets,
    get requestCount() { return requestIndex; },
    get failure() { return failure; },
    stop: () => new Promise<void>((resolveStop, reject) => {
      server.close((error) => error ? reject(error) : resolveStop());
      server.closeAllConnections();
    }),
  };
}

function writeToolCall(
  response: ServerResponse,
  index: number,
  callId: string,
  name: string,
  input: Record<string, unknown>,
): void {
  writeChunk(response, index, {
    role: 'assistant',
    tool_calls: [{
      index: 0,
      id: callId,
      type: 'function',
      function: { name, arguments: JSON.stringify(input) },
    }],
  }, null);
  writeChunk(response, index, {}, 'tool_calls');
  response.end('data: [DONE]\n\n');
}

function writeText(response: ServerResponse, index: number, text: string): void {
  writeChunk(response, index, { role: 'assistant', content: text }, null);
  writeChunk(response, index, {}, 'stop');
  response.end('data: [DONE]\n\n');
}

function writeChunk(
  response: ServerResponse,
  index: number,
  delta: Record<string, unknown>,
  finishReason: string | null,
): void {
  response.write(`data: ${JSON.stringify({
    id: `chatcmpl-def-${index}`,
    object: 'chat.completion.chunk',
    created: 1_786_000_000,
    model: 'def-deterministic-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    assert.ok(bytes <= 2 * 1024 * 1024, 'Provider request exceeded test limit');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function fixtureBinding(): ProductBinding {
  return {
    workspaceId: asWorkspaceId('workspace-opencode-blackbox'),
    databaseGeneration: asDatabaseGeneration('generation-opencode-blackbox'),
    timelineId: asTimelineId('timeline-opencode-blackbox'),
    checkoutTargetId: 'node-opencode-blackbox',
    checkoutUpdatedAt: 30,
    contentRevision: 30,
    snapshotDigest: 'sha256:opencode-blackbox',
  };
}

function fixtureSnapshot(binding: ProductBinding): ProductSnapshotEnvelope {
  return {
    protocolVersion: 1,
    binding,
    capturedAt: '2026-08-07T12:00:00.000Z',
    payload: {
      schemaVersion: 1,
      updatedAt: 30,
      source: 'app',
      timelineId: binding.timelineId,
      activeTimelineId: binding.timelineId,
      currentView: 'canvas',
      damageReportStatus: 'ready',
      checkout: { targetType: 'work-node', targetId: binding.checkoutTargetId, updatedAt: 30 },
      selectedCharacters: [{
        id: 'char-blackbox',
        name: '测试干员',
        element: '火',
        profession: '近卫',
        librarySource: 'fixture',
      }],
      skillButtons: [{
        id: 'button-blackbox',
        characterId: 'char-blackbox',
        characterName: '测试干员',
        skillType: 'A',
        runtimeSkillId: 'skill-blackbox-a',
        skillDisplayName: '测试技能',
        staffIndex: 0,
        lineIndex: 0,
        persistenceStaffIndex: 0,
        persistenceNodeIndex: 0,
        selectedBuffIds: ['buff-burning'],
        selectedBuffs: [{
          id: 'buff-burning',
          displayName: '灼热增伤',
          type: 'damage-increase',
          value: 0.25,
          sourceName: '测试技能',
        }],
      }],
      operatorConfigs: [{
        characterId: 'char-blackbox',
        weapon: {
          weaponId: 'weapon-blackbox',
          name: '测试武器',
          level: 90,
        },
        equipment: [{
          slotKey: 'armor',
          equipmentId: 'equipment-blackbox-1',
          name: '测试装备甲',
          effects: [],
        }, {
          slotKey: 'gloves',
          equipmentId: 'equipment-blackbox-2',
          name: '测试装备手',
          effects: [],
        }, {
          slotKey: 'kit',
          equipmentId: 'equipment-blackbox-3',
          name: '测试装备包',
          effects: [],
        }],
        setBuffs: [{
          gearSetId: 'set-blackbox',
          gearSetName: '测试套装',
          effectId: 'set-effect-blackbox',
          label: '测试套装效果',
          typeKey: 'attack-percent',
          value: 0.15,
        }],
        operatorSkillLevels: { basic: 12, battle: 12, ultimate: 12, talent: 12 },
      }],
      damageReport: {
        generatedAt: 30,
        totalExpected: 1234.5,
        totalNonCrit: 1000,
        buttonCount: 1,
        buttons: [{
          id: 'button-blackbox',
          characterId: 'char-blackbox',
          expected: 1234.5,
          nonCrit: 1000,
        }],
      },
    },
  };
}

async function withTimeout<Value>(promise: Promise<Value>, milliseconds: number): Promise<Value> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<Value>((_resolve, reject) => {
        handle = setTimeout(() => reject(new Error(`Real OpenCode blackbox timed out after ${milliseconds}ms`)), milliseconds);
      }),
    ]);
  } finally {
    if (handle) clearTimeout(handle);
  }
}

await run();
