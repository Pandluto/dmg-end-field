import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  AGENT_UI_CAPABILITY_HEADER,
  asDatabaseGeneration,
  asDefSessionId,
  asDefTurnId,
  asTimelineId,
  asWorkspaceId,
  canonicalJson,
  type DefEvent,
  type DefPreparedWorkNodeCandidateRefV1,
  type DefPreparedWorkNodeProposalV1,
  type Phase2ProductCommand,
  type Phase2ProductOperationSchema,
  type ProductBinding,
  type ProductGateway,
  type ProductSnapshotEnvelope,
  type JsonValue,
  type JsonObject,
} from '../../core/contracts/index.ts';
import { DefHarnessManager } from '../../core/harness/manager.ts';
import { PHASE6_INTERACTIVE_HARNESS_CATALOG } from '../../core/harness/catalog.ts';
import { DefProductToolRegistry } from '../../core/tools/interactive-workbench.ts';
import { BrowserConsumerRegistry } from '../../host/browser-consumer-registry.ts';
import { DefAgentHost } from '../../host/def-agent-host.ts';
import {
  AGENT_HOST_INTERNAL_TOKEN_HEADER,
  AGENT_HOST_PROXY_ORIGIN_HEADER,
  DefAgentHostHttpServer,
} from '../../host/http-server.ts';
import { RemoteBrowserProductGateway } from '../../host/remote-browser-product-gateway.ts';
import { AgentTokenAuthority } from '../../host/token-authority.ts';
import { OpenCodeEngineAdapter } from './adapter.ts';
import { InMemoryOpenCodeProviderProfileSource } from './profile.ts';
import { toOpenCodeSafeToolName } from './tool-bindings.ts';

const routeDescription = 'Route this Turn to one allowlisted DEF business operation. An ask route must include its bounded resume target. For an ordered cross-business Turn, submit one bounded plan.';
const attachmentText = 'DEF_NATIVE_ATTACHMENT_OK';
const attachmentFilename = 'def-native-attachment-test.txt';
const attachmentFixture = {
  type: 'file',
  mime: 'text/plain',
  filename: attachmentFilename,
  url: `data:text/plain;base64,${Buffer.from(attachmentText).toString('base64')}`,
} as const;
const blackboxCases = [
  {
    id: 'selection',
    userMessage: '请告诉我当前选择了哪些干员。',
    userAttachments: [attachmentFixture],
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
      input: { action: 'current' },
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
      safeName: 'def_node_crud_current',
      canonicalName: 'def.node.crud.current',
      description: 'Read the current timeline checkout and stable skill-button coordinates.',
      input: {},
    }, {
      safeName: 'def_data_resource_buff',
      canonicalName: 'def.data.resource.buff',
      description: 'Resolve bounded Buff facts present in the current Workbench snapshot.',
      input: { action: 'resolve', query: '灼热', buttonId: 'button-blackbox' },
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
      input: { action: 'current' },
    }],
    answer: '当前总期望伤害为 1234.5。',
  },
  {
    id: 'selection-question',
    userMessage: '如果队伍不明确，请问我选择甲还是乙。',
    route: {
      businessId: 'selection',
      operation: 'ask',
      resume: { steps: [{ businessId: 'selection', operation: 'inspect' }] },
    },
    tools: [{
      safeName: 'def_user_ask',
      canonicalName: 'def.user.ask',
      description: 'Ask the user one explicit question and wait for the answer in the DEF AI panel.',
      input: { prompt: '请选择测试队伍', options: ['甲', '乙'] },
    }, {
      safeName: 'def_node_crud_context',
      canonicalName: 'def.node.crud.context',
      description: 'Read the bound current Workbench context and selected roster.',
      input: {},
    }],
    interaction: { kind: 'question', status: 'answered', value: '乙' },
    answer: '用户选择了乙。',
  },
  {
    id: 'selection-apply',
    userMessage: '请把队伍明确改成洛茜。',
    route: { businessId: 'selection', operation: 'apply' },
    tools: [{
      safeName: 'def_node_crud_context',
      canonicalName: 'def.node.crud.context',
      description: 'Read the bound current Workbench context and selected roster.',
      input: {},
    }, {
      safeName: 'def_team_selection_apply',
      canonicalName: 'def.team.selection.apply',
      description: 'Replace the selected roster with one exact one-to-four operator roster after explicit user approval.',
      input: {
        characterNames: ['洛茜'],
        nodeTitle: '调整阵容：仅保留洛茜',
        nodeDescription: '将当前队伍调整为仅保留洛茜，并记录本次 AI 修改。',
        openCanvas: true,
      },
    }],
    interaction: { kind: 'approval', status: 'approved' },
    preparedMutation: {
      prepareCommand: {
        op: 'prepareReviewedWorkNodeProposal',
        operation: 'selection.apply',
        intent: 'selection',
        scope: ['selection.roster', 'timeline.structure', 'buff.attachments', 'buff.resistance', 'loadout.config'],
        roster: {
          characterNames: ['洛茜'],
          nodeTitle: '调整阵容：仅保留洛茜',
          nodeDescription: '将当前队伍调整为仅保留洛茜，并记录本次 AI 修改。',
          openCanvas: true,
        },
        label: '调整阵容：仅保留洛茜',
        description: '将当前队伍调整为仅保留洛茜，并记录本次 AI 修改。',
      },
    },
    answer: '已按批准把队伍改成洛茜。',
  },
] as const;

const sameSessionCases = [
  {
    id: 'same-session-first',
    userMessage: '同一个对话里的第一轮：读取当前选择。',
    route: { businessId: 'selection', operation: 'inspect' },
    tools: [{
      safeName: 'def_node_crud_context',
      canonicalName: 'def.node.crud.context',
      description: 'Read the bound current Workbench context and selected roster.',
      input: {},
    }],
    answer: '同一会话第一轮完成：当前为测试干员。',
  },
  {
    id: 'same-session-second',
    userMessage: '不要新建对话，继续读取一次当前选择。',
    route: { businessId: 'selection', operation: 'inspect' },
    tools: [{
      safeName: 'def_node_crud_context',
      canonicalName: 'def.node.crud.context',
      description: 'Read the bound current Workbench context and selected roster.',
      input: {},
    }],
    answer: '同一会话第二轮也完成：当前仍为测试干员。',
  },
] as const;

const providerPlan = [...blackboxCases, ...sameSessionCases].flatMap((scenario) => [
  {
    scenarioId: scenario.id,
    safeName: 'def_harness_route',
    description: routeDescription,
    input: scenario.route,
  },
  ...scenario.tools.map((tool) => ({ scenarioId: scenario.id, ...tool })),
  ...('followUpRoute' in scenario ? [{
    scenarioId: scenario.id,
    safeName: 'def_harness_route',
    description: routeDescription,
    input: scenario.followUpRoute,
  }] : []),
  { scenarioId: scenario.id, answer: scenario.answer },
]);

function expectedScenarioTools(scenario: typeof blackboxCases[number] | typeof sameSessionCases[number]) {
  return [
    'def.harness.route',
    ...scenario.tools.map((tool) => tool.canonicalName),
    ...('followUpRoute' in scenario ? ['def.harness.route'] : []),
  ];
}

function expectedScenarioProjections(scenario: typeof blackboxCases[number] | typeof sameSessionCases[number]) {
  return [
    ['def.harness.route'],
    ...scenario.tools.map((tool) => [tool.canonicalName]),
    ...('followUpRoute' in scenario ? [['def.harness.route']] : []),
    [],
  ];
}

async function run(): Promise<void> {
  const tools = new DefProductToolRegistry();
  const harness = new DefHarnessManager({
    catalog: PHASE6_INTERACTIVE_HARNESS_CATALOG,
    resolveToolDescriptor: (name) => tools.resolveDescriptor(name),
  });
  const schemaInspection = harness.beginTurn({
    defSessionId: asDefSessionId('def-session-schema-inspection'),
    defTurnId: asDefTurnId('def-turn-schema-inspection'),
  });
  const projectedTools = new Map<string, { description: string; inputSchema: JsonObject }>();
  for (const descriptor of [
    ...schemaInspection.transaction.projection.tools,
    ...tools.listDescriptors(),
  ]) {
    projectedTools.set(toOpenCodeSafeToolName(descriptor.name), {
      description: descriptor.description,
      inputSchema: descriptor.inputSchema,
    });
  }
  const provider = await startProviderStub(projectedTools);
  // Keep a non-ASCII segment in the real runtime path. Electron places this
  // directory beneath the Chinese product name on both development and
  // packaged installs, and the OpenCode directory header must remain valid.
  const storeRoot = await mkdtemp(join(tmpdir(), '终末地-opencode-real-blackbox-'));
  const binding = fixtureBinding();
  // This blackbox intentionally exercises a cold, non-ASCII runtime path. It
  // has no browser heartbeat loop, so keep its synthetic consumer alive for
  // the bounded 60-second turn assertions instead of conflating cold-start
  // time with the production 5-second heartbeat contract.
  const consumers = new BrowserConsumerRegistry({ heartbeatTtlMs: 120_000 });
  const remoteProduct = new RemoteBrowserProductGateway(consumers);
  let snapshotReads = 0;
  const product: ProductGateway<Phase2ProductOperationSchema> = {
    async getSnapshot(expected) {
      snapshotReads += 1;
      return remoteProduct.getSnapshot(expected);
    },
    dispatch: (command) => remoteProduct.dispatch(command),
    awaitResult: (commandId, options) => remoteProduct.awaitResult(commandId, options),
    reconcile: (commandId) => remoteProduct.reconcile(commandId),
  };
  const engine = new OpenCodeEngineAdapter({
    runtimeRoot: resolve('dist/agent/engine/opencode'),
    storeRoot,
    profileSource: new InMemoryOpenCodeProviderProfileSource([{
      ref: 'blackbox',
      // Exercise the same provider-specific path used by the desktop default.
      // DeepSeek V4 rejects tool_choice while thinking mode is enabled.
      providerId: 'deepseek',
      displayName: 'DEF DeepSeek Protocol Blackbox',
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
    requireConsumer: () => { consumers.requireActive(); },
  });
  const browserOrigin = 'http://127.0.0.1:31457';
  const hostToken = 'opencode_blackbox_host_token_1234567890';
  const launchGrant = 'opencode_blackbox_launch_grant_123456';
  const capability = 'opencode_blackbox_ui_capability_123456';
  const tokens = new AgentTokenAuthority({ randomToken: () => capability });
  const productServer = new DefAgentHostHttpServer({
    hostToken,
    browserOrigin,
    host,
    tokens,
    consumers,
    gateway: remoteProduct,
    engine: { kind: 'opencode', state: 'ready' },
  });
  const productPort = await productServer.listen(0);
  const productBaseUrl = `http://127.0.0.1:${productPort}`;
  const privateHeaders = {
    [AGENT_HOST_INTERNAL_TOKEN_HEADER]: hostToken,
    [AGENT_HOST_PROXY_ORIGIN_HEADER]: browserOrigin,
  };
  const grantResponse = await fetch(`${productBaseUrl}/internal/launch-grants`, {
    method: 'POST',
    headers: { ...privateHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({
      grant: launchGrant,
      origin: browserOrigin,
      audience: 'workbench-ai-mode',
      expiresAt: Date.now() + 60_000,
    }),
  });
  assert.equal(grantResponse.status, 201);
  const exchangeResponse = await fetch(`${productBaseUrl}/agent-host/ui/session`, {
    method: 'POST',
    headers: { ...privateHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ launchGrant, audience: 'workbench-ai-mode' }),
  });
  assert.equal(exchangeResponse.status, 201);
  const productHeaders = {
    ...privateHeaders,
    [AGENT_UI_CAPABILITY_HEADER]: capability,
    'content-type': 'application/json',
  };
  const consumer = {
    consumerId: 'consumer-opencode-blackbox',
    executorLeaseId: 'lease-opencode-blackbox',
    writer: true as const,
    visible: true as const,
    binding,
  };
  const consumerResponse = await fetch(`${productBaseUrl}/agent-host/workbench/register`, {
    method: 'POST',
    headers: productHeaders,
    body: JSON.stringify(consumer),
  });
  assert.equal(consumerResponse.status, 201);
  const snapshotResponse = await fetch(`${productBaseUrl}/agent-host/workbench/snapshot`, {
    method: 'POST',
    headers: productHeaders,
    body: JSON.stringify({
      consumerId: consumer.consumerId,
      executorLeaseId: consumer.executorLeaseId,
      snapshot: fixtureSnapshot(binding),
    }),
  });
  assert.equal(snapshotResponse.status, 200);

  try {
    assert.deepEqual(await engine.probe(), {
      status: 'ready',
      kind: 'opencode',
      runtimeVersion: '1.17.11-def.1',
    });
    const results = [];
    for (const scenario of blackboxCases) {
      let events: readonly DefEvent[];
      let terminal: DefEvent | undefined;
      if (scenario.id === 'calculation') {
        const createResponse = await fetch(`${productBaseUrl}/agent-host/sessions`, {
          method: 'POST',
          headers: productHeaders,
          body: JSON.stringify({ providerProfileRef: 'blackbox' }),
        });
        assert.equal(createResponse.status, 201);
        const created = await createResponse.json() as {
          session: { defSessionId: string; engine: Record<string, unknown> };
        };
        assert.deepEqual(Object.keys(created.session.engine).sort(), ['kind', 'runtimeVersion']);
        const startResponse = await fetch(
          `${productBaseUrl}/agent-host/sessions/${created.session.defSessionId}/turns`,
          {
            method: 'POST',
            headers: productHeaders,
            body: JSON.stringify({
              clientTurnId: 'client-turn-real-opencode-http',
              userMessage: scenario.userMessage,
            }),
          },
        );
        assert.equal(startResponse.status, 202);
        const started = await startResponse.json() as { defTurnId: string };
        events = await withTimeout((async () => {
          for (;;) {
            const eventResponse = await fetch(
              `${productBaseUrl}/agent-host/sessions/${created.session.defSessionId}/events?afterSequence=0&limit=256`,
              { headers: productHeaders },
            );
            assert.equal(eventResponse.status, 200);
            const page = await eventResponse.json() as { events: DefEvent[] };
            if (page.events.some((event) => (
              'defTurnId' in event
              && event.defTurnId === started.defTurnId
              && ['turn.completed', 'turn.failed', 'turn.stopped', 'turn.interrupted'].includes(event.type)
            ))) return page.events;
            await new Promise((resolveWait) => setTimeout(resolveWait, 10));
          }
        })(), 60_000).catch((error: unknown) => {
          console.error(JSON.stringify({
            scenario: scenario.id,
            providerToolSets: provider.toolSets,
            providerFailure: provider.failure?.stack ?? null,
            events: host.readEvents(asDefSessionId(created.session.defSessionId)),
          }, null, 2));
          throw error;
        });
        terminal = [...events].reverse().find((event) => (
          'defTurnId' in event
          && event.defTurnId === started.defTurnId
          && ['turn.completed', 'turn.failed', 'turn.stopped', 'turn.interrupted'].includes(event.type)
        ));
        const accepted = events.find((event) => (
          event.type === 'turn.accepted' && event.defTurnId === started.defTurnId
        ));
        assert.equal(accepted?.type, 'turn.accepted');
        if (accepted?.type === 'turn.accepted') assert.equal(accepted.payload.userMessage, scenario.userMessage);
      } else {
        const session = await host.createSession({ binding, providerProfileRef: 'blackbox' });
        const turn = await host.startHarnessTurn({
          defSessionId: session.defSessionId,
          userMessage: scenario.userMessage,
          ...('userAttachments' in scenario ? { userAttachments: scenario.userAttachments } : {}),
        });
        if ('preparedMutation' in scenario) {
          const prepareDelivery = await waitForWorkbenchCommand(
            productBaseUrl,
            productHeaders,
            consumer,
            0,
          );
          assert.equal(prepareDelivery.command.command.op, 'workbench.execute-command');
          assert.deepEqual(prepareDelivery.command.command.payload.command, {
            ...scenario.preparedMutation.prepareCommand,
            sourceBinding: binding,
          });
          assert.equal(prepareDelivery.command.approvalCapability, undefined);
          const proposal = preparedSelectionProposal(binding);
          await submitWorkbenchCommandResult(
            productBaseUrl,
            productHeaders,
            consumer,
            prepareDelivery.command,
            {
              beforeRevision: binding.contentRevision,
              afterRevision: binding.contentRevision,
              browserResult: proposal as unknown as JsonValue,
            },
          );
          const interaction = await waitForInteraction(
            productBaseUrl,
            productHeaders,
            session.defSessionId,
          );
          assert.equal(interaction.kind, scenario.interaction.kind);
          await respondToInteraction(
            productBaseUrl,
            productHeaders,
            interaction.interactionId,
            scenario.interaction,
          );
          const applyDelivery = await waitForWorkbenchCommand(
            productBaseUrl,
            productHeaders,
            consumer,
            prepareDelivery.cursor,
          );
          assert.equal(applyDelivery.command.command.op, 'workbench.execute-command');
          const candidate = candidateFromProposal(proposal);
          assert.deepEqual(applyDelivery.command.command.payload.command, {
            op: 'applyReviewedWorkNodeProposal',
            operation: 'selection.apply',
            candidate,
          });
          assert.equal(typeof applyDelivery.command.approvalCapability, 'string');
          const postBinding: ProductBinding = {
            ...binding,
            timelineId: asTimelineId(proposal.candidateTimelineId),
            checkoutTargetId: proposal.nodeId,
            checkoutUpdatedAt: binding.checkoutUpdatedAt + 1,
            contentRevision: proposal.nodeRevision,
            snapshotDigest: proposal.workingPayloadDigest,
          };
          await submitWorkbenchCommandResult(
            productBaseUrl,
            productHeaders,
            consumer,
            applyDelivery.command,
            {
              beforeRevision: binding.contentRevision,
              afterRevision: postBinding.contentRevision,
              browserResult: { selectedCharacters: ['洛茜'] },
              visiblePostcondition: {
                pass: true,
                contentRevision: postBinding.contentRevision,
                binding: JSON.parse(JSON.stringify(postBinding)) as JsonValue,
              },
            },
          );
        } else if ('interaction' in scenario) {
          const interaction = await withTimeout((async () => {
            for (;;) {
              const interactionResponse = await fetch(
                `${productBaseUrl}/agent-host/interactions`,
                { headers: productHeaders },
              );
              assert.equal(interactionResponse.status, 200);
              const body = await interactionResponse.json() as {
                interactions: Array<{
                  interactionId: string;
                  defSessionId: string;
                  kind: string;
                }>;
              };
              const pending = body.interactions.find((entry) => entry.defSessionId === session.defSessionId);
              if (pending) return pending;
              await new Promise((resolveWait) => setTimeout(resolveWait, 10));
            }
          })(), 60_000);
          assert.equal(interaction.kind, scenario.interaction.kind);
          const interactionResponse = await fetch(
            `${productBaseUrl}/agent-host/interactions/${interaction.interactionId}/respond`,
            {
              method: 'POST',
              headers: productHeaders,
              body: JSON.stringify({
                status: scenario.interaction.status,
                ...('value' in scenario.interaction ? { value: scenario.interaction.value } : {}),
              }),
            },
          );
          assert.equal(interactionResponse.status, 200);
        }
        terminal = await withTimeout(host.waitForTurnTerminal(turn.defTurnId), 60_000).catch((error: unknown) => {
          console.error(JSON.stringify({
            scenario: scenario.id,
            providerToolSets: provider.toolSets,
            providerFailure: provider.failure?.stack ?? null,
            events: host.readEvents(session.defSessionId),
          }, null, 2));
          throw error;
        });
        events = host.readEvents(session.defSessionId);
      }
      assert.ok(terminal, JSON.stringify(events, null, 2));
      assert.equal(terminal.type, 'turn.completed', JSON.stringify(events, null, 2));
      assert.equal(provider.failure, null, provider.failure?.stack);
      assert.deepEqual(
        events.filter((event) => event.type === 'tool.requested').map((event) => event.payload.name),
        expectedScenarioTools(scenario),
      );
      assert.deepEqual(
        events.filter((event) => event.type === 'harness.tool.projected').map((event) => event.payload.tools),
        expectedScenarioProjections(scenario),
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
    const sameSession = await host.createSession({ binding, providerProfileRef: 'blackbox' });
    for (const scenario of sameSessionCases) {
      const turn = await host.startHarnessTurn({
        defSessionId: sameSession.defSessionId,
        userMessage: scenario.userMessage,
      });
      const terminal = await withTimeout(host.waitForTurnTerminal(turn.defTurnId), 60_000).catch((error: unknown) => {
        console.error(JSON.stringify({
          scenario: scenario.id,
          providerToolSets: provider.toolSets,
          providerFailure: provider.failure?.stack ?? null,
          events: host.readEvents(sameSession.defSessionId),
        }, null, 2));
        throw error;
      });
      const events = host.readEvents(sameSession.defSessionId).filter((event) => (
        'defTurnId' in event && event.defTurnId === turn.defTurnId
      ));
      assert.equal(terminal.type, 'turn.completed', JSON.stringify(events, null, 2));
      assert.deepEqual(
        events.filter((event) => event.type === 'tool.requested').map((event) => event.payload.name),
        expectedScenarioTools(scenario),
      );
      assert.deepEqual(
        events.filter((event) => event.type === 'harness.tool.projected').map((event) => event.payload.tools),
        expectedScenarioProjections(scenario),
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
    // Candidate-first selection reads once for context, once to pin the
    // prepare source, and once more to prove the approved binding stayed exact.
    assert.equal(snapshotReads, 13);
    console.log(JSON.stringify({
      result: 'real OpenCode read/question/approval/mutation/multi-turn blackbox passed',
      runtimeVersion: '1.17.11-def.1',
      providerRequests: provider.requestCount,
      results,
    }, null, 2));
  } finally {
    await productServer.stop().catch(() => undefined);
    await provider.stop();
    await rm(storeRoot, { recursive: true, force: true });
  }
}

async function startProviderStub(expectedTools: ReadonlyMap<string, {
  readonly description: string;
  readonly inputSchema: JsonObject;
}>): Promise<{
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
    if (expected.scenarioId === 'selection') {
      const messages = JSON.stringify(record.messages);
      assert.equal(messages.includes(attachmentText), true, 'text attachment must reach the provider as text');
      assert.equal(messages.includes(attachmentFilename), true, 'text attachment filename must reach the provider');
    }
    const hasTool = 'safeName' in expected && typeof expected.safeName === 'string';
    const expectedNames = hasTool ? [expected.safeName] : [];
    assert.deepEqual(names, expectedNames);
    if (hasTool) {
      assert.deepEqual(
        record.thinking,
        { type: 'disabled' },
        'DeepSeek projected Tool phases must disable thinking before forcing tool_choice',
      );
      assert.equal(
        record.parallel_tool_calls,
        false,
        'DeepSeek projected Tool phases must remain single-call',
      );
      assert.ok(
        record.tool_choice,
        'DeepSeek projected Tool phases must keep the Harness-enforced tool choice',
      );
      const fn = asRecord(asRecord(definitions[0]).function);
      assert.equal(typeof fn.description, 'string');
      const expectedTool = expectedTools.get(expected.safeName);
      assert.ok(expectedTool, `Missing projected Tool fixture for ${expected.safeName}`);
      if (expected.safeName === 'def_harness_route') {
        assert.equal(fn.description, expectedTool.description);
      } else {
        assert.equal(
          (fn.description as string).startsWith(`${expectedTool.description}\nCurrent Harness phase: `),
          true,
        );
      }
      assert.deepEqual(
        fn.parameters,
        expectedTool.inputSchema,
        `${expected.safeName} 必须把 Harness 的动态 schema 原样送到 provider`,
      );
    } else {
      assert.equal(record.thinking, undefined);
      assert.equal(record.parallel_tool_calls, undefined);
      assert.equal(record.tool_choice, undefined);
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
        asRecord(expected.input),
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

async function waitForWorkbenchCommand(
  productBaseUrl: string,
  headers: Record<string, string>,
  consumer: { consumerId: string; executorLeaseId: string },
  afterCursor: number,
): Promise<{ cursor: number; command: Phase2ProductCommand }> {
  return withTimeout((async () => {
    for (;;) {
      const response = await fetch(
        `${productBaseUrl}/agent-host/workbench/commands/next?consumerId=${consumer.consumerId}&executorLeaseId=${consumer.executorLeaseId}&afterCursor=${afterCursor}`,
        { headers },
      );
      assert.equal(response.status, 200);
      const body = await response.json() as {
        delivery: null | { cursor: number; command: Phase2ProductCommand };
      };
      if (body.delivery) return body.delivery;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  })(), 60_000);
}

async function submitWorkbenchCommandResult(
  productBaseUrl: string,
  headers: Record<string, string>,
  consumer: { consumerId: string; executorLeaseId: string },
  command: Phase2ProductCommand,
  result: {
    beforeRevision: number;
    afterRevision: number;
    browserResult: JsonValue;
    visiblePostcondition?: JsonValue;
  },
): Promise<void> {
  const response = await fetch(
    `${productBaseUrl}/agent-host/workbench/commands/${command.commandId}/result`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        consumerId: consumer.consumerId,
        executorLeaseId: consumer.executorLeaseId,
        result: {
          commandId: command.commandId,
          status: 'succeeded',
          ...result,
          executorLeaseId: consumer.executorLeaseId,
          completedAt: new Date().toISOString(),
        },
      }),
    },
  );
  assert.equal(response.status, 200, await response.text());
}

async function waitForInteraction(
  productBaseUrl: string,
  headers: Record<string, string>,
  defSessionId: string,
): Promise<{ interactionId: string; kind: string }> {
  return withTimeout((async () => {
    for (;;) {
      const response = await fetch(`${productBaseUrl}/agent-host/interactions`, { headers });
      assert.equal(response.status, 200);
      const body = await response.json() as {
        interactions: Array<{ interactionId: string; defSessionId: string; kind: string }>;
      };
      const pending = body.interactions.find((entry) => entry.defSessionId === defSessionId);
      if (pending) return pending;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  })(), 60_000);
}

async function respondToInteraction(
  productBaseUrl: string,
  headers: Record<string, string>,
  interactionId: string,
  response: { status: string; value?: string },
): Promise<void> {
  const result = await fetch(
    `${productBaseUrl}/agent-host/interactions/${interactionId}/respond`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        status: response.status,
        ...(response.value === undefined ? {} : { value: response.value }),
      }),
    },
  );
  assert.equal(result.status, 200, await result.text());
}

function candidateFromProposal(
  proposal: DefPreparedWorkNodeProposalV1,
): DefPreparedWorkNodeCandidateRefV1 {
  return {
    contract: 'DefPreparedWorkNodeCandidateRefV1',
    schemaVersion: proposal.schemaVersion,
    proposalId: proposal.proposalId,
    intent: proposal.intent,
    destination: proposal.destination,
    sourceTargetId: proposal.sourceTargetId,
    sourceRevision: proposal.sourceRevision,
    candidateTimelineId: proposal.candidateTimelineId,
    nodeId: proposal.nodeId,
    nodeRevision: proposal.nodeRevision,
    basePayloadDigest: proposal.basePayloadDigest,
    workingPayloadDigest: proposal.workingPayloadDigest,
    diffDigest: proposal.diffDigest,
    proposalDigest: proposal.proposalDigest,
    scope: [...proposal.scope],
  };
}

function preparedSelectionProposal(binding: ProductBinding): DefPreparedWorkNodeProposalV1 {
  const sourceTargetId = binding.checkoutTargetId ?? `snapshot-${binding.timelineId}`;
  const scope = [
    'selection.roster',
    'timeline.structure',
    'buff.attachments',
    'buff.resistance',
    'loadout.config',
  ] as const;
  const changes = [{
    path: '/selectedCharacters',
    kind: 'changed' as const,
    before: [{ id: 'char-blackbox', name: '测试干员' }],
    after: [{ id: 'char-luoxi', name: '洛茜' }],
  }];
  const digest = (value: JsonValue): string => (
    `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
  );
  const candidateWithoutProposalDigest = {
    contract: 'DefPreparedWorkNodeCandidateRefV1' as const,
    schemaVersion: 1 as const,
    proposalId: 'proposal-opencode-selection',
    intent: 'selection' as const,
    destination: 'new-temporary-workspace' as const,
    sourceTargetId,
    sourceRevision: binding.contentRevision,
    candidateTimelineId: 'timeline-opencode-selection-candidate',
    nodeId: 'candidate-opencode-selection',
    nodeRevision: 1,
    basePayloadDigest: `sha256:${'1'.repeat(64)}`,
    workingPayloadDigest: `sha256:${'2'.repeat(64)}`,
    diffDigest: digest(changes as unknown as JsonValue),
    scope,
  };
  const proposalDigest = digest({
    operation: 'selection.apply',
    intent: candidateWithoutProposalDigest.intent,
    candidate: candidateWithoutProposalDigest,
    scope: [...scope],
  } as unknown as JsonValue);
  const candidate = { ...candidateWithoutProposalDigest, proposalDigest };
  return {
    ...candidate,
    contract: 'DefPreparedWorkNodeProposalV1',
    sourceBinding: { ...binding },
    sourceCheckout: {
      timelineId: binding.timelineId,
      targetType: binding.checkoutTargetId === null ? 'snapshot' : 'work-node',
      targetId: sourceTargetId,
      revision: binding.contentRevision,
      payloadDigest: candidate.basePayloadDigest,
    },
    structuralParentNodeId: null,
    review: {
      contract: 'DefPreparedWorkNodeReviewV1',
      schemaVersion: 1,
      manifest: {
        proposalId: candidate.proposalId,
        nodeId: candidate.nodeId,
        nodeRevision: candidate.nodeRevision,
        diffDigest: candidate.diffDigest,
        proposalDigest: candidate.proposalDigest,
        scope: [...scope],
      },
      summary: { addedPathCount: 0, removedPathCount: 0, changedPathCount: 1 },
      changes,
    },
    liveCheckoutTouched: false,
  };
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
          id: 'weapon-blackbox',
          name: '测试武器',
          level: 90,
          potential: 'P0',
          attack: 100,
        },
        equipment: [{
          slotKey: 'armor',
          equipmentId: 'equipment-blackbox-1',
          name: '测试装备甲',
          part: '护甲',
          effects: [],
        }, {
          slotKey: 'glove',
          equipmentId: 'equipment-blackbox-2',
          name: '测试装备手',
          part: '护手',
          effects: [],
        }, {
          slotKey: 'accessory1',
          equipmentId: 'equipment-blackbox-3',
          name: '测试装备包',
          part: '配件',
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
        operatorSkillLevels: { A: 'M3', B: 'L9', E: 'L9', Q: 'M3', Dot: 'L9' },
      }],
      damageReport: {
        generatedAt: 30,
        totalDamage: 1234.5,
        totalExpected: 1234.5,
        totalNonCrit: 1000,
        buttonCount: 1,
        buttons: [{
          id: 'button-blackbox',
          characterId: 'char-blackbox',
          groupLabel: '第1组',
          orderLabel: '01',
          characterName: '测试干员',
          skillName: '测试技能',
          skillType: 'A',
          damage: 1234.5,
          expected: 1234.5,
          nonCrit: 1000,
          share: 1,
          hits: [{
            id: 'button-blackbox-hit-1',
            title: '测试命中',
            sourceKind: 'normal',
            damageSourceLabel: '主伤害',
            skillTypeLabel: 'A',
            elementLabel: '火',
            damage: 1234.5,
            expected: 1234.5,
            nonCrit: 1000,
            resistanceZone: 0.9,
            resistance: {
              baseResistance: 10,
              corrosion: 0,
              resistanceIgnore: 0,
              effectiveResistance: 10,
              resistanceZone: 0.9,
              formulaText: '测试抗性区',
            },
            buffs: [],
            zones: [],
          }],
        }],
        characters: [{
          characterId: 'char-blackbox',
          characterName: '测试干员',
          weaponName: '测试武器',
          weaponPotentialMode: 'P0',
          level: 90,
          skillLevels: ['A M3'],
          attributeLines: ['攻击 100'],
          equipmentLines: ['测试装备'],
          skills: [],
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
