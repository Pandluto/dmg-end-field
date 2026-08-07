import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  asDatabaseGeneration,
  canonicalJson,
  asDefTurnId,
  asTimelineId,
  asToolCallId,
  asWorkspaceId,
  type DefPreparedWorkNodeProposalV1,
  type JsonValue,
  type ProductBinding,
  type ProductSnapshotEnvelope,
} from '../core/contracts/index.ts';
import { PHASE6_INTERACTIVE_HARNESS_CATALOG } from '../core/harness/catalog.ts';
import { DefHarnessManager } from '../core/harness/manager.ts';
import { DeterministicFakeAgentEngine } from '../core/testing/fake-engine.ts';
import { DefProductToolRegistry } from '../core/tools/interactive-workbench.ts';
import { BrowserConsumerRegistry } from './browser-consumer-registry.ts';
import { DefAgentHost } from './def-agent-host.ts';
import { DefAgentInteropRoute } from './def-agent-interop.ts';
import {
  AGENT_HOST_INTERNAL_TOKEN_HEADER,
  AGENT_HOST_PROXY_ORIGIN_HEADER,
  DefAgentHostHttpServer,
} from './http-server.ts';
import { RemoteBrowserProductGateway } from './remote-browser-product-gateway.ts';
import { AgentTokenAuthority, type AgentUiCapabilityClaims } from './token-authority.ts';

const browserOrigin = 'http://127.0.0.1:31457';
const hostToken = 'interop_host_token_abcdefghijklmnopqrstuvwxyz';
const interopToken = 'interop_teacher_token_abcdefghijklmnopqrstuvwxyz';

const productBinding: ProductBinding = {
  workspaceId: asWorkspaceId('workspace-interop'),
  databaseGeneration: asDatabaseGeneration('generation-interop'),
  timelineId: asTimelineId('timeline-interop'),
  checkoutTargetId: 'node-interop',
  checkoutUpdatedAt: 10,
  contentRevision: 4,
  snapshotDigest: 'sha256:interop-4',
};

function claims(capabilityId: string): AgentUiCapabilityClaims {
  return {
    capabilityId,
    origin: browserOrigin,
    audience: 'workbench-ai-mode',
    issuedAt: 1,
    expiresAt: Number.MAX_SAFE_INTEGER,
  };
}

function snapshot(): ProductSnapshotEnvelope {
  return {
    protocolVersion: 1,
    binding: productBinding,
    capturedAt: '2026-08-08T00:00:00.000Z',
    payload: {
      schemaVersion: 1,
      currentView: 'canvas',
      checkout: {
        targetType: 'work-node',
        targetId: productBinding.checkoutTargetId,
        updatedAt: productBinding.checkoutUpdatedAt,
      },
      selectedCharacters: [
        { id: 'operator-a', name: '测试甲', element: '火', profession: '近卫', librarySource: 'local' },
      ],
      skillButtons: [],
      operatorConfigs: [],
    },
  };
}

function preparedSelectionProposal(): DefPreparedWorkNodeProposalV1 {
  const sourceTargetId = productBinding.checkoutTargetId ?? 'node-interop';
  const changes = [{
    path: '/selectedCharacters/0/name',
    kind: 'changed' as const,
    before: '测试甲' as JsonValue,
    after: '测试乙' as JsonValue,
  }];
  const digest = (value: JsonValue): string => (
    'sha256:' + createHash('sha256').update(canonicalJson(value)).digest('hex')
  );
  const candidateWithoutDigest = {
    contract: 'DefPreparedWorkNodeCandidateRefV1' as const,
    schemaVersion: 1 as const,
    proposalId: 'proposal-interop-selection',
    intent: 'selection' as const,
    destination: 'new-temporary-workspace' as const,
    sourceTargetId,
    sourceRevision: productBinding.contentRevision,
    candidateTimelineId: 'timeline-interop-selection-candidate',
    nodeId: 'candidate-interop-selection',
    nodeRevision: 1,
    basePayloadDigest: 'sha256:' + '1'.repeat(64),
    workingPayloadDigest: 'sha256:' + '2'.repeat(64),
    diffDigest: digest(changes as unknown as JsonValue),
    scope: [
      'selection.roster',
      'timeline.structure',
      'buff.attachments',
      'buff.resistance',
      'loadout.config',
    ] as const,
  };
  const proposalDigest = digest({
    operation: 'selection.apply',
    intent: candidateWithoutDigest.intent,
    candidate: candidateWithoutDigest,
    scope: [...candidateWithoutDigest.scope],
  } as unknown as JsonValue);
  const candidate = { ...candidateWithoutDigest, proposalDigest };
  return {
    ...candidate,
    contract: 'DefPreparedWorkNodeProposalV1',
    sourceBinding: { ...productBinding },
    sourceCheckout: {
      timelineId: productBinding.timelineId,
      targetType: 'work-node',
      targetId: sourceTargetId,
      revision: productBinding.contentRevision,
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
        scope: [...candidate.scope],
      },
      summary: { addedPathCount: 0, removedPathCount: 0, changedPathCount: 1 },
      changes,
    },
    liveCheckoutTouched: false,
  };
}

async function waitFor<Value>(read: () => Value | undefined, message: string): Promise<Value> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(message);
}

type JsonResponse = {
  readonly status: number;
  readonly body: unknown;
  readonly text: string;
};

async function request(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  init: RequestInit = {},
): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: response.status, body, text };
}

function jsonHeaders(authorization?: string): Record<string, string> {
  return {
    [AGENT_HOST_INTERNAL_TOKEN_HEADER]: hostToken,
    [AGENT_HOST_PROXY_ORIGIN_HEADER]: browserOrigin,
    ...(authorization ? { authorization: `Bearer ${authorization}` } : {}),
  };
}

function jsonBody(value: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  };
}

const consumers = new BrowserConsumerRegistry({ heartbeatTtlMs: 120_000 });
const owner = claims('interop-owner');
const registration = {
  consumerId: 'consumer-interop',
  executorLeaseId: 'lease-interop',
  writer: true as const,
  visible: true as const,
  binding: productBinding,
};
consumers.register(owner, registration);
const gateway = new RemoteBrowserProductGateway(consumers);
gateway.publishSnapshot(owner, {
  consumerId: registration.consumerId,
  executorLeaseId: registration.executorLeaseId,
  snapshot: snapshot(),
});
const engine = new DeterministicFakeAgentEngine();
const tools = new DefProductToolRegistry();
const harness = new DefHarnessManager({
  catalog: PHASE6_INTERACTIVE_HARNESS_CATALOG,
  resolveToolDescriptor: (name) => tools.resolveDescriptor(name),
});
const host = new DefAgentHost({
  engine,
  productGateway: gateway,
  harnessManager: harness,
  toolRegistry: tools,
  requireConsumer: () => { consumers.requireActive(); },
});
const session = await host.createSession({
  binding: productBinding,
  providerProfileRef: 'interop-test',
});
const interop = new DefAgentInteropRoute({
  host,
  consumers,
  gateway,
  engine: { kind: 'fake', state: 'ready' },
  profile: 'test',
  randomToken: () => interopToken,
  tokenTtlMs: 60_000,
  streamTtlMs: 2_000,
});
const server = new DefAgentHostHttpServer({
  hostToken,
  browserOrigin,
  host,
  tokens: new AgentTokenAuthority(),
  consumers,
  gateway,
  interop,
  engine: { kind: 'fake', state: 'ready' },
});

const port = await server.listen(0);
const baseUrl = `http://127.0.0.1:${port}`;
const sessionPath = encodeURIComponent(session.defSessionId);

try {
  const status = await request(baseUrl, '/agent-host/interop/v1/status', jsonHeaders());
  assert.equal(status.status, 200);
  const statusBody = status.body as {
    protocol: string;
    protocolVersion: number;
    nativeUi: { available: boolean };
    sidecar: { retired: boolean; required: boolean };
    workbench: { snapshotAvailable: boolean; uiConnected: boolean };
    eventSource: string;
  };
  assert.equal(statusBody.protocol, 'def-codex-interop');
  assert.equal(statusBody.protocolVersion, 1);
  assert.equal(statusBody.nativeUi.available, true);
  assert.deepEqual(statusBody.sidecar, { retired: true, required: false });
  assert.equal(statusBody.workbench.snapshotAvailable, true);
  assert.equal(statusBody.workbench.uiConnected, true);
  assert.equal(statusBody.eventSource, 'DefAgentHost.eventJournal');

  const unauthorized = await request(baseUrl, '/agent-host/interop/v1/state', jsonHeaders());
  assert.equal(unauthorized.status, 401);
  assert.equal((unauthorized.body as { error: { code: string } }).error.code, 'teacher-authorization-required');

  const authorization = await request(
    baseUrl,
    '/agent-host/interop/v1/authorize',
    jsonHeaders(),
    { method: 'POST' },
  );
  assert.equal(authorization.status, 201);
  assert.equal((authorization.body as { token: string }).token, interopToken);
  const authHeaders = jsonHeaders(interopToken);

  const uiEvents = await request(baseUrl, '/agent-host/interop/v1/ui-events?cursor=0', authHeaders);
  assert.equal(uiEvents.status, 200);
  assert.equal(
    (uiEvents.body as { events: Array<{ type: string }> }).events[0]?.type,
    'ui-session-opened',
  );

  engine.enqueueScript([
    {
      type: 'tool',
      toolCallId: asToolCallId('route-read'),
      name: 'def.harness.route',
      input: { businessId: 'selection', operation: 'inspect' },
    },
    {
      type: 'tool',
      toolCallId: asToolCallId('context-read'),
      name: 'def.node.crud.context',
      input: {},
    },
    { type: 'text', delta: '已读取当前状态。' },
    { type: 'complete', output: { ok: true } },
  ]);
  const firstStart = await request(
    baseUrl,
    '/agent-host/interop/v1/turns',
    authHeaders,
    jsonBody({
      clientTurnId: 'interop-read-turn',
      rawUserText: '读取当前工作区状态',
      providerVisibleUserText: '读取当前工作区状态',
    }),
  );
  assert.equal(firstStart.status, 202);
  const firstTurnId = (firstStart.body as { turn: { defTurnId: string } }).turn.defTurnId;
  const firstTerminal = await host.waitForTurnTerminal(asDefTurnId(firstTurnId));
  assert.equal(firstTerminal.type, 'turn.completed');

  const duplicateStart = await request(
    baseUrl,
    '/agent-host/interop/v1/turns',
    authHeaders,
    jsonBody({ clientTurnId: 'interop-read-turn', rawUserText: '读取当前工作区状态' }),
  );
  assert.equal(duplicateStart.status, 202);
  assert.equal(
    (duplicateStart.body as { turn: { defTurnId: string } }).turn.defTurnId,
    firstTurnId,
  );

  const events = await request(
    baseUrl,
    `/agent-host/interop/v1/sessions/${sessionPath}/events?cursor=0&limit=256`,
    authHeaders,
  );
  assert.equal(events.status, 200);
  const eventTypes = (events.body as { events: Array<{ type: string }> }).events.map((event) => event.type);
  for (const type of ['turn.accepted', 'tool.requested', 'tool.result', 'turn.completed']) {
    assert.ok(eventTypes.includes(type), `Interop journal must expose ${type}`);
  }
  const transcript = await request(
    baseUrl,
    `/agent-host/interop/v1/sessions/${sessionPath}/transcript`,
    authHeaders,
  );
  assert.equal(transcript.status, 200);
  const transcriptBody = transcript.body as { transcript: Array<{ info: { role: string }; parts: unknown[] }> };
  assert.deepEqual(transcriptBody.transcript.map((message) => message.info.role), ['user', 'assistant']);
  assert.ok(transcriptBody.transcript[1]?.parts.length);

  const state = await request(baseUrl, '/agent-host/interop/v1/state', authHeaders);
  assert.equal(state.status, 200);
  const stateBody = state.body as {
    source: string;
    snapshotAvailable: boolean;
    state: { activeDefSessionId: string; selectedOperators: Array<{ name: string }> };
  };
  assert.equal(stateBody.source, 'DefAgentHost.eventJournal');
  assert.equal(stateBody.snapshotAvailable, true);
  assert.equal(stateBody.state.activeDefSessionId, session.defSessionId);
  assert.equal(stateBody.state.selectedOperators[0]?.name, '测试甲');

  const stream = await request(
    baseUrl,
    `/agent-host/interop/v1/sessions/${sessionPath}/events?cursor=0&limit=256&stream=1`,
    { ...authHeaders, accept: 'text/event-stream' },
  );
  assert.equal(stream.status, 200);
  assert.match(stream.text, /event: ready/u);
  assert.match(stream.text, /event: turn\.completed/u);

  engine.enqueueScript([
    {
      type: 'tool',
      toolCallId: asToolCallId('route-question'),
      name: 'def.harness.route',
      input: {
        businessId: 'selection',
        operation: 'ask',
        resume: { steps: [{ businessId: 'selection', operation: 'inspect' }] },
      },
    },
    {
      type: 'tool',
      toolCallId: asToolCallId('ask-question'),
      name: 'def.user.ask',
      input: { prompt: '请选择测试队伍', options: ['甲', '乙'] },
    },
    {
      type: 'tool',
      toolCallId: asToolCallId('inspect-after-question'),
      name: 'def.node.crud.context',
      input: {},
    },
    { type: 'complete', output: { ok: true } },
  ]);
  const questionStart = await request(
    baseUrl,
    `/agent-host/interop/v1/sessions/${sessionPath}/turns`,
    authHeaders,
    jsonBody({ clientTurnId: 'interop-question-turn', rawUserText: '请问我一个选择' }),
  );
  assert.equal(questionStart.status, 202);
  const questionTurnId = (questionStart.body as { turn: { defTurnId: string } }).turn.defTurnId;
  const pendingQuestion = await waitFor(
    () => host.listPendingInteractions(productBinding)[0],
    'question interaction was not published',
  );
  assert.equal(pendingQuestion.kind, 'question');
  const questionView = await request(
    baseUrl,
    `/agent-host/interop/v1/sessions/${sessionPath}/questions`,
    authHeaders,
  );
  assert.equal(questionView.status, 200);
  const openQuestion = (questionView.body as { questions: Array<{ kind: string; status: string; questions: Array<{ options: Array<{ label: string }> }> }> }).questions[0];
  assert.equal(openQuestion?.kind, 'question');
  assert.equal(openQuestion?.status, 'open');
  assert.deepEqual(openQuestion?.questions[0]?.options.map((option) => option.label), ['甲', '乙']);
  host.resolveInteraction(pendingQuestion.interactionId, { status: 'answered', value: '乙' }, productBinding);
  assert.equal((await host.waitForTurnTerminal(asDefTurnId(questionTurnId))).type, 'turn.completed');
  const answeredQuestion = await request(
    baseUrl,
    `/agent-host/interop/v1/sessions/${sessionPath}/questions`,
    authHeaders,
  );
  const answered = (answeredQuestion.body as { questions: Array<{ status: string; answers: unknown[][] }> }).questions[0];
  assert.equal(answered?.status, 'answered');
  assert.deepEqual(answered?.answers, [['乙']]);

  engine.enqueueScript([
    {
      type: 'tool',
      toolCallId: asToolCallId('route-approval'),
      name: 'def.harness.route',
      input: { businessId: 'selection', operation: 'apply' },
    },
    {
      type: 'tool',
      toolCallId: asToolCallId('context-approval'),
      name: 'def.node.crud.context',
      input: {},
    },
    {
      type: 'tool',
      toolCallId: asToolCallId('apply-selection'),
      name: 'def.team.selection.apply',
      input: {
        characterNames: ['测试乙'],
        nodeTitle: '调整测试队伍',
        nodeDescription: '将当前队伍调整为测试乙。',
        openCanvas: false,
      },
    },
  ]);
  const approvalStart = await request(
    baseUrl,
    `/agent-host/interop/v1/sessions/${sessionPath}/turns`,
    authHeaders,
    jsonBody({ clientTurnId: 'interop-approval-turn', rawUserText: '把队伍改成测试乙' }),
  );
  assert.equal(approvalStart.status, 202);
  const approvalTurnId = (approvalStart.body as { turn: { defTurnId: string } }).turn.defTurnId;
  const prepareDelivery = await waitFor(
    () => gateway.nextCommand(owner, {
      consumerId: registration.consumerId,
      executorLeaseId: registration.executorLeaseId,
      afterCursor: 0,
    }) ?? undefined,
    'selection prepare command was not delivered',
  );
  assert.equal(prepareDelivery?.command.command.op, 'workbench.execute-command');
  if (!prepareDelivery) throw new Error('expected selection prepare delivery');
  gateway.submitResult(owner, {
    consumerId: registration.consumerId,
    executorLeaseId: registration.executorLeaseId,
    result: {
      commandId: prepareDelivery.command.commandId,
      status: 'succeeded',
      beforeRevision: productBinding.contentRevision,
      afterRevision: productBinding.contentRevision,
      browserResult: preparedSelectionProposal() as unknown as JsonValue,
      completedAt: '2026-08-08T00:00:01.000Z',
    },
  });
  const pendingApproval = await waitFor(
    () => host.listPendingInteractions(productBinding)[0],
    'approval interaction was not published',
  );
  assert.equal(pendingApproval.kind, 'approval');
  const approvalView = await request(
    baseUrl,
    `/agent-host/interop/v1/sessions/${sessionPath}/questions`,
    authHeaders,
  );
  const openApproval = (approvalView.body as { questions: Array<{ kind: string; status: string; approval?: { proposalHash: string; scope: string[] } }> }).questions.find((question) => question.kind === 'approval');
  assert.equal(openApproval?.kind, 'approval');
  assert.equal(openApproval?.status, 'open');
  assert.ok(openApproval?.approval?.proposalHash);
  assert.deepEqual(openApproval?.approval?.scope, [
    'selection.roster',
    'timeline.structure',
    'buff.attachments',
    'buff.resistance',
    'loadout.config',
  ]);
  const stop = await request(
    baseUrl,
    `/agent-host/interop/v1/sessions/${sessionPath}/turns/${encodeURIComponent(approvalTurnId)}/stop`,
    authHeaders,
    jsonBody({}),
  );
  assert.equal(stop.status, 200);
  assert.equal((await host.waitForTurnTerminal(asDefTurnId(approvalTurnId))).type, 'turn.stopped');

  engine.enqueueScript([{ type: 'fail', code: 'PROVIDER_TEST_FAILURE', message: 'simulated provider failure' }]);
  const failureStart = await request(
    baseUrl,
    `/agent-host/interop/v1/sessions/${sessionPath}/turns`,
    authHeaders,
    jsonBody({ clientTurnId: 'interop-failure-turn', rawUserText: '触发一次失败' }),
  );
  assert.equal(failureStart.status, 202);
  const failureTurnId = (failureStart.body as { turn: { defTurnId: string } }).turn.defTurnId;
  assert.equal((await host.waitForTurnTerminal(asDefTurnId(failureTurnId))).type, 'turn.failed');
  const failureEvents = await request(
    baseUrl,
    `/agent-host/interop/v1/sessions/${sessionPath}/events?cursor=0&limit=256`,
    authHeaders,
  );
  const failureEvent = (failureEvents.body as { events: Array<{ type: string; defTurnId?: string; payload: { code?: string } }> }).events.find((event) => (
    event.type === 'turn.failed' && event.defTurnId === failureTurnId
  ));
  assert.equal(failureEvent?.payload.code, 'PROVIDER_TEST_FAILURE');

  const mismatch = await request(
    baseUrl,
    '/agent-host/interop/v1/turns',
    authHeaders,
    jsonBody({
      clientTurnId: 'interop-invalid-text',
      rawUserText: '原始文本',
      providerVisibleUserText: '被改写文本',
    }),
  );
  assert.equal(mismatch.status, 400);
  assert.equal((mismatch.body as { error: { code: string } }).error.code, 'provider-visible-text-mismatch');

  const retiredSelector = await request(
    baseUrl,
    '/agent-host/workbench-test/prompt',
    authHeaders,
    jsonBody({ clientTurnId: 'interop-legacy-selector', rawUserText: '旧入口合同', harnessSelector: 'legacy' }),
  );
  assert.equal(retiredSelector.status, 410);
  assert.equal(
    (retiredSelector.body as { error: { code: string } }).error.code,
    'legacy-harness-selector-retired',
  );
} finally {
  await server.stop();
}
