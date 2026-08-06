import assert from 'node:assert/strict';
import {
  AGENT_UI_CAPABILITY_HEADER,
  asCommandId,
  asDatabaseGeneration,
  asDefSessionId,
  asDefTurnId,
  asInteractionId,
  asTimelineId,
  asToolCallId,
  asWorkspaceId,
  type Phase2ProductCommand,
  type ProductBinding,
  type ProductCommandResult,
  type ProductSnapshotEnvelope,
} from '../core/contracts/index.ts';
import { DeterministicFakeAgentEngine } from '../core/testing/fake-engine.ts';
import { BrowserConsumerRegistry } from './browser-consumer-registry.ts';
import { DefAgentHost } from './def-agent-host.ts';
import { DefAgentHostError } from './errors.ts';
import {
  AGENT_HOST_INTERNAL_TOKEN_HEADER,
  AGENT_HOST_PROXY_ORIGIN_HEADER,
  DefAgentHostHttpServer,
} from './http-server.ts';
import { RemoteBrowserProductGateway } from './remote-browser-product-gateway.ts';
import { AgentTokenAuthority, type AgentUiCapabilityClaims } from './token-authority.ts';

const browserOrigin = 'http://127.0.0.1:31457';
const launchGrant = 'launch_grant_abcdefghijklmnopqrstuvwxyz';
const capability = 'ui_capability_abcdefghijklmnopqrstuvwxyz';

async function expectHostError(
  action: () => unknown | Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(
    async () => action(),
    (error: unknown) => error instanceof DefAgentHostError && error.code === code,
  );
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(message);
}

function binding(overrides: Partial<ProductBinding> = {}): ProductBinding {
  return {
    workspaceId: asWorkspaceId('workspace-phase2'),
    databaseGeneration: asDatabaseGeneration('generation-1'),
    timelineId: asTimelineId('timeline-phase2'),
    checkoutTargetId: 'node-a',
    checkoutUpdatedAt: 10,
    contentRevision: 4,
    snapshotDigest: 'sha256:snapshot-4',
    ...overrides,
  };
}

function claims(id: string): AgentUiCapabilityClaims {
  return {
    capabilityId: id,
    origin: browserOrigin,
    audience: 'workbench-ai-mode',
    issuedAt: 1_000,
    expiresAt: 20_000,
  };
}

function command(commandId: string, expected = binding(), toolCallId = 'tool-command'): Phase2ProductCommand {
  return {
    protocolVersion: 1,
    commandId: asCommandId(commandId),
    defSessionId: asDefSessionId('session-command'),
    defTurnId: asDefTurnId('turn-command'),
    toolCallId: asToolCallId(toolCallId),
    expected,
    command: { op: 'workbench.refresh-snapshot', payload: { reason: 'agent-read' } },
  };
}

function snapshot(expected = binding()): ProductSnapshotEnvelope {
  return {
    protocolVersion: 1,
    binding: expected,
    capturedAt: '2026-08-07T00:00:00.000Z',
    payload: { timelineId: expected.timelineId, revision: expected.contentRevision },
  };
}

// Launch grants are one-use, time-bound, and origin/audience bound.
{
  let now = 1_000;
  const authority = new AgentTokenAuthority({
    clock: () => now,
    randomToken: () => capability,
    uiCapabilityTtlMs: 5_000,
  });
  authority.registerLaunchGrant({
    grant: launchGrant,
    origin: browserOrigin,
    audience: 'workbench-ai-mode',
    expiresAt: now + 500,
  });
  await expectHostError(() => authority.exchangeLaunchGrant({
    grant: launchGrant,
    origin: 'http://127.0.0.1:3030',
    audience: 'workbench-ai-mode',
  }), 'AGENT_ORIGIN_DENIED');
  await expectHostError(() => authority.exchangeLaunchGrant({
    grant: launchGrant,
    origin: browserOrigin,
    audience: 'workbench-ai-mode',
  }), 'AGENT_LAUNCH_GRANT_INVALID');

  authority.registerLaunchGrant({
    grant: launchGrant,
    origin: browserOrigin,
    audience: 'workbench-ai-mode',
    expiresAt: now + 500,
  });
  const session = authority.exchangeLaunchGrant({
    grant: launchGrant,
    origin: browserOrigin,
    audience: 'workbench-ai-mode',
  });
  assert.equal(session.capability, capability);
  assert.equal(authority.validateCapability({
    capability,
    origin: browserOrigin,
    audience: 'workbench-ai-mode',
  }).capabilityId.length, 64);
  now = session.expiresAt;
  await expectHostError(() => authority.validateCapability({
    capability,
    origin: browserOrigin,
    audience: 'workbench-ai-mode',
  }), 'AGENT_UI_CAPABILITY_INVALID');
  await expectHostError(() => authority.registerLaunchGrant({
    grant: launchGrant,
    origin: `${browserOrigin}/not-an-origin`,
    audience: 'workbench-ai-mode',
    expiresAt: now + 500,
  }), 'AGENT_ORIGIN_DENIED');
}

// Only one visible writer consumer can be active; expiry and close are observable.
{
  let now = 1_000;
  const lost: string[] = [];
  const scheduledExpiries: Array<() => void> = [];
  const registry = new BrowserConsumerRegistry({
    clock: () => now,
    heartbeatTtlMs: 100,
    onConsumerLost: (reason) => lost.push(reason),
    setTimeout: (handler) => {
      scheduledExpiries.push(handler);
      return handler;
    },
    clearTimeout: (handle) => {
      const index = scheduledExpiries.indexOf(handle as () => void);
      if (index >= 0) scheduledExpiries.splice(index, 1);
    },
  });
  const registration = {
    consumerId: 'consumer-a',
    executorLeaseId: 'lease-a',
    writer: true as const,
    visible: true as const,
    binding: binding(),
  };
  registry.register(claims('cap-a'), registration);
  await expectHostError(() => registry.register(claims('cap-b'), {
    ...registration,
    consumerId: 'consumer-b',
  }), 'AGENT_CONSUMER_CONFLICT');
  now = 1_100;
  const expireActiveConsumer = scheduledExpiries.at(-1);
  assert.ok(expireActiveConsumer, 'registry must schedule proactive heartbeat expiry');
  expireActiveConsumer();
  assert.deepEqual(lost, ['expired'], 'expiry must be observable without another registry request');
  assert.equal(registry.current(), null);
  registry.register(claims('cap-a'), registration);
  registry.heartbeat(claims('cap-a'), {
    ...registration,
    binding: binding({ contentRevision: 5, snapshotDigest: 'sha256:snapshot-5' }),
  });
  registry.close(claims('cap-a'), registration);
  assert.deepEqual(lost, ['expired', 'closed']);
}

// Product commands are replay-safe, conflict-aware, and reconcilable across generation rotation.
{
  let now = Date.parse('2026-08-07T00:00:00.000Z');
  const registry = new BrowserConsumerRegistry({ clock: () => now });
  const owner = claims('cap-gateway');
  const registration = {
    consumerId: 'consumer-gateway',
    executorLeaseId: 'lease-gateway',
    writer: true as const,
    visible: true as const,
    binding: binding(),
  };
  registry.register(owner, registration);
  const gateway = new RemoteBrowserProductGateway(registry, { clock: () => now });
  gateway.publishSnapshot(owner, {
    consumerId: registration.consumerId,
    executorLeaseId: registration.executorLeaseId,
    snapshot: snapshot(),
  });
  const first = command('command-gateway');
  assert.equal((await gateway.dispatch(first)).status, 'queued');
  assert.equal((await gateway.dispatch(first)).status, 'queued');
  await expectHostError(() => gateway.dispatch({
    ...first,
    defTurnId: asDefTurnId('another-turn'),
  }), 'AGENT_COMMAND_CONFLICT');
  const delivery = gateway.nextCommand(owner, {
    consumerId: registration.consumerId,
    executorLeaseId: registration.executorLeaseId,
    afterCursor: 0,
  });
  assert.equal(delivery?.command.commandId, first.commandId);
  assert.equal(gateway.nextCommand(owner, {
    consumerId: registration.consumerId,
    executorLeaseId: registration.executorLeaseId,
    afterCursor: 0,
  })?.command.commandId, first.commandId, 'lost delivery must be replayed with the same commandId');
  assert.equal(gateway.nextCommand(owner, {
    consumerId: registration.consumerId,
    executorLeaseId: registration.executorLeaseId,
    afterCursor: delivery!.cursor,
  }), null);
  const result: ProductCommandResult = {
    commandId: first.commandId,
    status: 'succeeded',
    beforeRevision: 4,
    afterRevision: 4,
    browserResult: { refreshed: true },
    executorLeaseId: registration.executorLeaseId,
    completedAt: '2026-08-07T00:00:01.000Z',
  };
  const awaited = gateway.awaitResult(first.commandId, { timeoutMs: 1_000 });
  assert.deepEqual(gateway.submitResult(owner, {
    consumerId: registration.consumerId,
    executorLeaseId: registration.executorLeaseId,
    result,
  }), result);
  assert.deepEqual(await awaited, result);
  assert.deepEqual(await gateway.reconcile(first.commandId), result);
  assert.deepEqual(gateway.submitResult(owner, {
    consumerId: registration.consumerId,
    executorLeaseId: registration.executorLeaseId,
    result,
  }), result);
  await expectHostError(() => gateway.submitResult(owner, {
    consumerId: registration.consumerId,
    executorLeaseId: registration.executorLeaseId,
    result: { ...result, status: 'error' },
  }), 'AGENT_COMMAND_CONFLICT');

  now += 10;
  const orphanCandidate = command('command-orphan');
  await gateway.dispatch(orphanCandidate);
  registry.close(owner, registration);
  const nextRegistration = {
    ...registration,
    executorLeaseId: 'lease-generation-2',
    binding: binding({
      databaseGeneration: asDatabaseGeneration('generation-2'),
      contentRevision: 0,
      snapshotDigest: 'sha256:generation-2',
    }),
  };
  registry.register(owner, nextRegistration);
  assert.equal(gateway.submitResult(owner, {
    consumerId: nextRegistration.consumerId,
    executorLeaseId: nextRegistration.executorLeaseId,
    result: {
      commandId: orphanCandidate.commandId,
      status: 'orphaned',
      code: 'DATABASE_GENERATION_CHANGED',
      beforeRevision: null,
      afterRevision: null,
      completedAt: '2026-08-07T00:00:02.000Z',
    },
  }).status, 'orphaned');
  gateway.clear();
}

// Fake Engine proves Host text, read Tool, Product command/result, terminal, and consumer-loss abort.
{
  let host!: DefAgentHost;
  const owner = claims('cap-host');
  const registry = new BrowserConsumerRegistry({
    onConsumerLost: () => {
      const active = host.getActiveIds().defTurnId;
      if (active) void host.abortTurn(active, 'BROWSER_CONSUMER_LOST');
    },
  });
  const registration = {
    consumerId: 'consumer-host',
    executorLeaseId: 'lease-host',
    writer: true as const,
    visible: true as const,
    binding: binding(),
  };
  registry.register(owner, registration);
  const gateway = new RemoteBrowserProductGateway(registry);
  gateway.publishSnapshot(owner, {
    consumerId: registration.consumerId,
    executorLeaseId: registration.executorLeaseId,
    snapshot: snapshot(),
  });
  const engine = new DeterministicFakeAgentEngine();
  host = new DefAgentHost({
    engine,
    productGateway: gateway,
    requireConsumer: () => { registry.requireActive(); },
  });
  const session = await host.createSession({
    binding: binding(),
    providerProfileRef: 'fake-profile',
  });
  const projection = {
    revision: 1,
    tools: [
      {
        name: 'product.snapshot.read',
        description: 'Read browser snapshot',
        inputSchema: { type: 'object' },
        risk: 'read' as const,
      },
      {
        name: 'product.command.refresh-snapshot',
        description: 'Ask browser to refresh its snapshot',
        inputSchema: { type: 'object' },
        risk: 'read' as const,
      },
    ],
  };

  engine.enqueueScript([
    { type: 'text', delta: '正在读取' },
    { type: 'tool', toolCallId: asToolCallId('tool-read'), name: 'product.snapshot.read', input: {} },
    { type: 'text', delta: '读取完成' },
    { type: 'complete', output: { ok: true } },
  ]);
  const readTurn = await host.startTurn({
    defSessionId: session.defSessionId,
    userMessage: '读取工作台',
    systemContext: 'phase2 contract',
    toolProjection: projection,
  });
  assert.equal((await host.waitForTurnTerminal(readTurn.defTurnId)).type, 'turn.completed');
  const readEvents = host.readEvents(session.defSessionId);
  assert.equal(readEvents.filter((event) => event.type === 'response.first-token').length, 1);
  assert.ok(readEvents.some((event) => event.type === 'tool.result'));

  const refreshTool = asToolCallId('tool-refresh');
  engine.enqueueScript([
    { type: 'tool', toolCallId: refreshTool, name: 'product.command.refresh-snapshot', input: {} },
    { type: 'complete' },
  ]);
  const refreshTurn = await host.startTurn({
    defSessionId: session.defSessionId,
    userMessage: '刷新快照',
    systemContext: 'phase2 contract',
    toolProjection: projection,
  });
  const refreshCommandId = asCommandId(`command-${refreshTool}`);
  await waitFor(() => Boolean(gateway.getCommand(refreshCommandId)), 'Host did not dispatch the browser command');
  const refreshDelivery = gateway.nextCommand(owner, {
    consumerId: registration.consumerId,
    executorLeaseId: registration.executorLeaseId,
    afterCursor: 0,
  });
  assert.equal(refreshDelivery?.command.commandId, refreshCommandId);
  gateway.submitResult(owner, {
    consumerId: registration.consumerId,
    executorLeaseId: registration.executorLeaseId,
    result: {
      commandId: refreshCommandId,
      status: 'succeeded',
      beforeRevision: 4,
      afterRevision: 4,
      browserResult: { refreshed: true },
      completedAt: '2026-08-07T00:00:03.000Z',
    },
  });
  assert.equal((await host.waitForTurnTerminal(refreshTurn.defTurnId)).type, 'turn.completed');

  const pendingTool = asToolCallId('tool-command-abort');
  engine.enqueueScript([
    { type: 'tool', toolCallId: pendingTool, name: 'product.command.refresh-snapshot', input: {} },
    { type: 'complete' },
  ]);
  const pendingTurn = await host.startTurn({
    defSessionId: session.defSessionId,
    userMessage: '派发后立即停止',
    systemContext: 'phase2 contract',
    toolProjection: projection,
  });
  await waitFor(
    () => Boolean(gateway.getCommand(asCommandId(`command-${pendingTool}`))),
    'Host did not dispatch the command used by the abort fixture',
  );
  await host.abortTurn(pendingTurn.defTurnId);
  const commandStopped = await host.waitForTurnTerminal(pendingTurn.defTurnId);
  assert.equal(commandStopped.type, 'turn.stopped');
  if (commandStopped.type === 'turn.stopped') assert.equal(commandStopped.payload.code, 'USER_STOPPED');

  const interactionId = asInteractionId('interaction-consumer-loss');
  engine.enqueueScript([
    {
      type: 'interaction',
      interactionId,
      interactionKind: 'question',
      prompt: 'wait for browser',
    },
  ]);
  const abortTurn = await host.startTurn({
    defSessionId: session.defSessionId,
    userMessage: '等待后停止',
    systemContext: 'phase2 contract',
    toolProjection: projection,
  });
  await waitFor(
    () => host.readEvents(session.defSessionId).some((event) => (
      event.type === 'interaction.requested' && event.interactionId === interactionId
    )),
    'Host did not surface the pending interaction',
  );
  registry.close(owner, registration);
  const stopped = await host.waitForTurnTerminal(abortTurn.defTurnId);
  assert.equal(stopped.type, 'turn.stopped');
  if (stopped.type === 'turn.stopped') assert.equal(stopped.payload.code, 'BROWSER_CONSUMER_LOST');
  await host.shutdown();
}

// The private HTTP service rejects direct access and exposes only the scoped browser bridge.
{
  const hostToken = 'host_token_abcdefghijklmnopqrstuvwxyz';
  const ownerEngine = new DeterministicFakeAgentEngine();
  const consumers = new BrowserConsumerRegistry();
  const gateway = new RemoteBrowserProductGateway(consumers);
  const host = new DefAgentHost({
    engine: ownerEngine,
    productGateway: gateway,
    requireConsumer: () => { consumers.requireActive(); },
  });
  const tokens = new AgentTokenAuthority({ randomToken: () => capability });
  const server = new DefAgentHostHttpServer({
    hostToken,
    browserOrigin,
    host,
    tokens,
    consumers,
    gateway,
    engine: { kind: 'pending', state: 'pending', reason: 'contract fixture' },
  });
  const port = await server.listen(0);
  const baseUrl = `http://127.0.0.1:${port}`;
  const privateHeaders = {
    [AGENT_HOST_INTERNAL_TOKEN_HEADER]: hostToken,
    [AGENT_HOST_PROXY_ORIGIN_HEADER]: browserOrigin,
  };
  const unauthorized = await fetch(`${baseUrl}/agent-host/health`);
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get('cache-control'), 'no-store');
  const wrongOrigin = await fetch(`${baseUrl}/agent-host/health`, {
    headers: { ...privateHeaders, [AGENT_HOST_PROXY_ORIGIN_HEADER]: 'http://127.0.0.1:3030' },
  });
  assert.equal(wrongOrigin.status, 403);
  const health = await fetch(`${baseUrl}/agent-host/health`, { headers: privateHeaders });
  assert.equal(health.status, 200);
  assert.equal((await health.json() as { service: string }).service, 'def-agent-host');

  const registration = await fetch(`${baseUrl}/internal/launch-grants`, {
    method: 'POST',
    headers: { ...privateHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({
      grant: launchGrant,
      origin: browserOrigin,
      audience: 'workbench-ai-mode',
      expiresAt: Date.now() + 30_000,
    }),
  });
  assert.equal(registration.status, 201);
  const exchange = await fetch(`${baseUrl}/agent-host/ui/session`, {
    method: 'POST',
    headers: { ...privateHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ launchGrant, audience: 'workbench-ai-mode' }),
  });
  assert.equal(exchange.status, 201);
  const uiSession = await exchange.json() as { capability: string };
  assert.equal(uiSession.capability, capability);
  const secondExchange = await fetch(`${baseUrl}/agent-host/ui/session`, {
    method: 'POST',
    headers: { ...privateHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ launchGrant, audience: 'workbench-ai-mode' }),
  });
  assert.equal(secondExchange.status, 403);
  const uiState = await fetch(`${baseUrl}/agent-host/ui/state`, {
    headers: { ...privateHeaders, [AGENT_UI_CAPABILITY_HEADER]: capability },
  });
  assert.equal(uiState.status, 200);
  assert.equal((await uiState.json() as { consumer: unknown }).consumer, null);
  const unknown = await fetch(`${baseUrl}/agent-host/not-real`, {
    headers: { ...privateHeaders, [AGENT_UI_CAPABILITY_HEADER]: capability },
  });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.headers.get('cache-control'), 'no-store');
  await server.stop();
}

console.log('DEF_AGENT_HOST_PHASE2_CONTRACT_OK');
