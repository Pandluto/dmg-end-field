import assert from 'node:assert/strict';
import {
  AGENT_UI_CAPABILITY_HEADER,
  DEF_AGENT_IN_MEMORY_LIMITS,
  asClientTurnId,
  asCommandId,
  asDatabaseGeneration,
  asDefSessionId,
  asDefTurnId,
  asInteractionId,
  asTimelineId,
  asToolCallId,
  asWorkspaceId,
  type AgentEngine,
  type Phase2ProductCommand,
  type ProductBinding,
  type ProductCommandResult,
  type ProductSnapshotEnvelope,
} from '../core/contracts/index.ts';
import { DeterministicFakeAgentEngine } from '../core/testing/fake-engine.ts';
import { DefHarnessManager } from '../core/harness/manager.ts';
import { DefReadToolRegistry } from '../core/tools/read-only-workbench.ts';
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
  assert.equal(registry.currentFor(claims('cap-b')), null);
  assert.equal(registry.currentFor(claims('cap-a'))?.consumerId, registration.consumerId);
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
  const advancedBinding = binding({
    checkoutTargetId: 'node-b',
    checkoutUpdatedAt: 11,
    contentRevision: 5,
    snapshotDigest: 'sha256:snapshot-5',
  });
  const advancedSnapshot = snapshot(advancedBinding);
  gateway.publishSnapshot(owner, {
    consumerId: registration.consumerId,
    executorLeaseId: registration.executorLeaseId,
    snapshot: advancedSnapshot,
  });
  assert.deepEqual(registry.current()?.binding, advancedBinding);
  assert.deepEqual(await gateway.getSnapshot(advancedBinding), advancedSnapshot);
  const bindingBeforeRejectedPublish = registry.current()?.binding;
  await expectHostError(() => gateway.publishSnapshot(owner, {
    consumerId: registration.consumerId,
    executorLeaseId: registration.executorLeaseId,
    snapshot: snapshot(binding({
      timelineId: asTimelineId('another-timeline'),
      contentRevision: 6,
      snapshotDigest: 'sha256:rejected-snapshot',
    })),
  }), 'AGENT_BINDING_CONFLICT');
  assert.deepEqual(
    registry.current()?.binding,
    bindingBeforeRejectedPublish,
    'a rejected snapshot must not advance the consumer binding',
  );
  assert.deepEqual(await gateway.getSnapshot(advancedBinding), advancedSnapshot);
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

// Product command retention is bounded while existing command retries keep their identity.
{
  const owner = claims('cap-command-retention');
  const registry = new BrowserConsumerRegistry();
  const registration = {
    consumerId: 'consumer-command-retention',
    executorLeaseId: 'lease-command-retention',
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
  const first = command('command-retention-0');
  await gateway.dispatch(first);
  for (let index = 1; index < DEF_AGENT_IN_MEMORY_LIMITS.maxProductCommandsPerHost; index += 1) {
    await gateway.dispatch(command(`command-retention-${index}`));
  }
  assert.equal((await gateway.dispatch(first)).commandId, first.commandId);
  await expectHostError(
    () => gateway.dispatch(command('command-retention-overflow')),
    'AGENT_COMMAND_CAPACITY_REACHED',
  );
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

// Product HTTP API owns Session/Turn/Event identity, retries, cursors, and binding safety.
{
  const hostToken = 'host_token_product_api_abcdefghijklmnop';
  const productCapability = 'ui_capability_product_abcdefghijklmnop';
  const productLaunchGrant = 'launch_grant_product_abcdefghijklmnop';
  const observerCapability = 'ui_capability_observer_abcdefghijklmnop';
  const observerLaunchGrant = 'launch_grant_observer_abcdefghijklmnop';
  const engine = new DeterministicFakeAgentEngine();
  const consumers = new BrowserConsumerRegistry();
  const gateway = new RemoteBrowserProductGateway(consumers);
  const tools = new DefReadToolRegistry();
  const harness = new DefHarnessManager({
    resolveToolDescriptor: (name) => tools.resolveDescriptor(name),
  });
  const host = new DefAgentHost({
    engine,
    productGateway: gateway,
    harnessManager: harness,
    toolRegistry: tools,
    requireConsumer: () => { consumers.requireActive(); },
  });
  const capabilityQueue = [productCapability, observerCapability];
  const tokens = new AgentTokenAuthority({
    randomToken: () => capabilityQueue.shift() ?? 'ui_capability_exhausted_abcdefghijklmnop',
  });
  const server = new DefAgentHostHttpServer({
    hostToken,
    browserOrigin,
    host,
    tokens,
    consumers,
    gateway,
    engine: { kind: 'fake-product-engine', state: 'ready' },
  });
  const port = await server.listen(0);
  const baseUrl = `http://127.0.0.1:${port}`;
  const privateHeaders = {
    [AGENT_HOST_INTERNAL_TOKEN_HEADER]: hostToken,
    [AGENT_HOST_PROXY_ORIGIN_HEADER]: browserOrigin,
  };

  await fetch(`${baseUrl}/internal/launch-grants`, {
    method: 'POST',
    headers: { ...privateHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({
      grant: productLaunchGrant,
      origin: browserOrigin,
      audience: 'workbench-ai-mode',
      expiresAt: Date.now() + 30_000,
    }),
  });
  const exchange = await fetch(`${baseUrl}/agent-host/ui/session`, {
    method: 'POST',
    headers: { ...privateHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ launchGrant: productLaunchGrant, audience: 'workbench-ai-mode' }),
  });
  assert.equal(exchange.status, 201);
  await fetch(`${baseUrl}/internal/launch-grants`, {
    method: 'POST',
    headers: { ...privateHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({
      grant: observerLaunchGrant,
      origin: browserOrigin,
      audience: 'workbench-ai-mode',
      expiresAt: Date.now() + 30_000,
    }),
  });
  const observerExchange = await fetch(`${baseUrl}/agent-host/ui/session`, {
    method: 'POST',
    headers: { ...privateHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ launchGrant: observerLaunchGrant, audience: 'workbench-ai-mode' }),
  });
  assert.equal(observerExchange.status, 201);
  const productHeaders = {
    ...privateHeaders,
    [AGENT_UI_CAPABILITY_HEADER]: productCapability,
    'content-type': 'application/json',
  };

  const missingConsumer = await fetch(`${baseUrl}/agent-host/sessions`, { headers: productHeaders });
  assert.equal(missingConsumer.status, 409, 'Product API requires the current visible writer consumer');

  const productBinding = binding({
    workspaceId: asWorkspaceId('workspace-product-api'),
    databaseGeneration: asDatabaseGeneration('generation-product-api'),
    timelineId: asTimelineId('timeline-product-api'),
    checkoutTargetId: 'node-product-api',
    checkoutUpdatedAt: 7,
    contentRevision: 7,
    snapshotDigest: 'sha256:product-api',
  });
  const registration = {
    consumerId: 'consumer-product-api',
    executorLeaseId: 'lease-product-api',
    writer: true as const,
    visible: true as const,
    binding: productBinding,
  };
  const registerResponse = await fetch(`${baseUrl}/agent-host/workbench/register`, {
    method: 'POST',
    headers: productHeaders,
    body: JSON.stringify(registration),
  });
  assert.equal(registerResponse.status, 201);
  const productSnapshot: ProductSnapshotEnvelope = {
    protocolVersion: 1,
    binding: productBinding,
    capturedAt: '2026-08-07T00:00:00.000Z',
    payload: {
      schemaVersion: 1,
      updatedAt: 7,
      source: 'app',
      timelineId: productBinding.timelineId,
      activeTimelineId: productBinding.timelineId,
      currentView: 'canvas',
      damageReportStatus: 'pending',
      checkout: { targetType: 'work-node', targetId: 'node-product-api', updatedAt: 7 },
      selectedCharacters: [],
      skillButtons: [],
      operatorConfigs: [],
    },
  };
  const snapshotResponse = await fetch(`${baseUrl}/agent-host/workbench/snapshot`, {
    method: 'POST',
    headers: productHeaders,
    body: JSON.stringify({
      consumerId: registration.consumerId,
      executorLeaseId: registration.executorLeaseId,
      snapshot: productSnapshot,
    }),
  });
  assert.equal(snapshotResponse.status, 200);

  const forgedSessionBinding = await fetch(`${baseUrl}/agent-host/sessions`, {
    method: 'POST',
    headers: productHeaders,
    body: JSON.stringify({ binding: productBinding }),
  });
  assert.equal(forgedSessionBinding.status, 400, 'the browser cannot submit its own Session binding');

  const createResponse = await fetch(`${baseUrl}/agent-host/sessions`, {
    method: 'POST',
    headers: productHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json() as {
    protocolVersion: number;
    session: { defSessionId: string; engine: Record<string, unknown> };
  };
  assert.equal(created.protocolVersion, 2);
  assert.deepEqual(Object.keys(created.session.engine).sort(), ['kind', 'runtimeVersion']);
  assert.equal(JSON.stringify(created).includes('fake-engine-session'), false);
  assert.equal(JSON.stringify(created).includes('providerProfileRef'), false);

  const ownerUiStateResponse = await fetch(`${baseUrl}/agent-host/ui/state`, {
    headers: productHeaders,
  });
  assert.equal(ownerUiStateResponse.status, 200);
  const ownerUiState = await ownerUiStateResponse.json() as {
    consumer: { consumerId: string } | null;
    activeDefSessionId: string | null;
  };
  assert.equal(ownerUiState.consumer?.consumerId, registration.consumerId);
  assert.equal(ownerUiState.activeDefSessionId, created.session.defSessionId);
  const observerUiStateResponse = await fetch(`${baseUrl}/agent-host/ui/state`, {
    headers: {
      ...privateHeaders,
      [AGENT_UI_CAPABILITY_HEADER]: observerCapability,
    },
  });
  assert.equal(observerUiStateResponse.status, 200);
  const observerUiState = await observerUiStateResponse.json() as {
    consumer: unknown;
    activeDefSessionId: unknown;
    activeDefTurnId: unknown;
  };
  assert.equal(observerUiState.consumer, null);
  assert.equal(observerUiState.activeDefSessionId, null);
  assert.equal(observerUiState.activeDefTurnId, null);

  const listResponse = await fetch(`${baseUrl}/agent-host/sessions`, { headers: productHeaders });
  const listed = await listResponse.json() as { sessions: Array<{ defSessionId: string }> };
  assert.deepEqual(listed.sessions.map((session) => session.defSessionId), [created.session.defSessionId]);
  const readResponse = await fetch(`${baseUrl}/agent-host/sessions/${created.session.defSessionId}`, {
    headers: productHeaders,
  });
  assert.equal(readResponse.status, 200);

  engine.enqueueScript([
    {
      type: 'tool',
      toolCallId: asToolCallId('product-route'),
      name: 'def.harness.route',
      input: { businessId: 'selection', operation: 'inspect' },
    },
    { type: 'projection', revision: 2 },
    {
      type: 'tool',
      toolCallId: asToolCallId('product-context'),
      name: 'def.node.crud.context',
      input: {},
    },
    { type: 'projection', revision: 3 },
    { type: 'text', delta: '产品 API 已读取当前工作区。' },
    { type: 'complete', output: { ok: true } },
  ]);
  const turnBody = {
    clientTurnId: 'client-turn-product-api',
    userMessage: '读取当前工作区',
  };
  const emptyMessageResponse = await fetch(
    `${baseUrl}/agent-host/sessions/${created.session.defSessionId}/turns`,
    {
      method: 'POST',
      headers: productHeaders,
      body: JSON.stringify({ clientTurnId: 'client-turn-empty-api', userMessage: '   ' }),
    },
  );
  assert.equal(emptyMessageResponse.status, 400);
  const forgedTurnBinding = await fetch(
    `${baseUrl}/agent-host/sessions/${created.session.defSessionId}/turns`,
    {
      method: 'POST',
      headers: productHeaders,
      body: JSON.stringify({ ...turnBody, binding: productBinding }),
    },
  );
  assert.equal(forgedTurnBinding.status, 400);
  const startResponse = await fetch(
    `${baseUrl}/agent-host/sessions/${created.session.defSessionId}/turns`,
    { method: 'POST', headers: productHeaders, body: JSON.stringify(turnBody) },
  );
  assert.equal(startResponse.status, 202);
  const started = await startResponse.json() as { defTurnId: string; clientTurnId: string };
  assert.equal(started.clientTurnId, turnBody.clientTurnId);

  const retryResponse = await fetch(
    `${baseUrl}/agent-host/sessions/${created.session.defSessionId}/turns`,
    { method: 'POST', headers: productHeaders, body: JSON.stringify(turnBody) },
  );
  assert.equal(retryResponse.status, 202);
  assert.equal((await retryResponse.json() as { defTurnId: string }).defTurnId, started.defTurnId);
  const conflictResponse = await fetch(
    `${baseUrl}/agent-host/sessions/${created.session.defSessionId}/turns`,
    {
      method: 'POST',
      headers: productHeaders,
      body: JSON.stringify({ ...turnBody, userMessage: '同一个 ID 的另一条消息' }),
    },
  );
  assert.equal(conflictResponse.status, 409);
  assert.equal(
    (await conflictResponse.json() as { error: { code: string } }).error.code,
    'AGENT_CLIENT_TURN_CONFLICT',
  );

  type ProductJournal = {
    afterSequence: number;
    nextSequence: number;
    hasMore: boolean;
    events: Array<{
      type: string;
      defTurnId?: string;
      payload: Record<string, unknown>;
    }>;
  };
  let journal: ProductJournal | null = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(
      `${baseUrl}/agent-host/sessions/${created.session.defSessionId}/events?afterSequence=0&limit=256`,
      { headers: productHeaders },
    );
    assert.equal(response.status, 200);
    journal = await response.json() as ProductJournal;
    if (journal?.events.some((event) => event.type === 'turn.completed')) break;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.ok(journal?.events.some((event) => (
    event.type === 'turn.accepted'
    && event.defTurnId === started.defTurnId
    && event.payload.userMessage === turnBody.userMessage
  )));
  assert.equal(
    journal?.events.filter((event) => event.type === 'response.delta')
      .map((event) => event.payload.delta).join(''),
    '产品 API 已读取当前工作区。',
  );
  assert.ok(journal?.events.some((event) => event.type === 'turn.completed'));

  const boundedPageResponse = await fetch(
    `${baseUrl}/agent-host/sessions/${created.session.defSessionId}/events?afterSequence=0&limit=2`,
    { headers: productHeaders },
  );
  const boundedPage = await boundedPageResponse.json() as { events: unknown[]; hasMore: boolean; nextSequence: number };
  assert.equal(boundedPage.events.length, 2);
  assert.equal(boundedPage.hasMore, true);
  const futureCursor = await fetch(
    `${baseUrl}/agent-host/sessions/${created.session.defSessionId}/events?afterSequence=${(journal?.nextSequence || 0) + 1}`,
    { headers: productHeaders },
  );
  assert.equal(futureCursor.status, 400);
  assert.equal(
    (await futureCursor.json() as { error: { code: string } }).error.code,
    'AGENT_EVENT_CURSOR_INVALID',
  );
  const invalidLimit = await fetch(
    `${baseUrl}/agent-host/sessions/${created.session.defSessionId}/events?afterSequence=0&limit=257`,
    { headers: productHeaders },
  );
  assert.equal(invalidLimit.status, 400);

  engine.enqueueScript([{
    type: 'interaction',
    interactionId: asInteractionId('product-abort-interaction'),
    interactionKind: 'question',
    prompt: '等待用户停止',
  }]);
  const abortStart = await fetch(
    `${baseUrl}/agent-host/sessions/${created.session.defSessionId}/turns`,
    {
      method: 'POST',
      headers: productHeaders,
      body: JSON.stringify({ clientTurnId: 'client-turn-abort-api', userMessage: '等待并停止' }),
    },
  );
  assert.equal(abortStart.status, 202);
  const abortTurn = await abortStart.json() as { defTurnId: string };
  const abortUrl = `${baseUrl}/agent-host/turns/${abortTurn.defTurnId}/abort`;
  const firstAbort = await fetch(abortUrl, {
    method: 'POST', headers: productHeaders, body: JSON.stringify({}),
  });
  assert.equal(firstAbort.status, 200);
  const secondAbort = await fetch(abortUrl, {
    method: 'POST', headers: productHeaders, body: JSON.stringify({}),
  });
  assert.equal(secondAbort.status, 200, 'abort must be idempotent for a known settled Turn');
  const terminalRetryResponse = await fetch(
    `${baseUrl}/agent-host/sessions/${created.session.defSessionId}/turns`,
    { method: 'POST', headers: productHeaders, body: JSON.stringify(turnBody) },
  );
  assert.equal(terminalRetryResponse.status, 202);
  assert.equal(
    (await terminalRetryResponse.json() as { defTurnId: string }).defTurnId,
    started.defTurnId,
    'a compact accepted clientTurn record must preserve retry identity after terminal settlement',
  );

  const changedRegistration = {
    ...registration,
    binding: {
      ...productBinding,
      timelineId: asTimelineId('another-product-timeline'),
    },
  };
  const closeResponse = await fetch(`${baseUrl}/agent-host/workbench/close`, {
    method: 'POST',
    headers: productHeaders,
    body: JSON.stringify({
      consumerId: registration.consumerId,
      executorLeaseId: registration.executorLeaseId,
    }),
  });
  assert.equal(closeResponse.status, 200);
  const changedRegisterResponse = await fetch(`${baseUrl}/agent-host/workbench/register`, {
    method: 'POST', headers: productHeaders, body: JSON.stringify(changedRegistration),
  });
  assert.equal(changedRegisterResponse.status, 201);
  const wrongBindingRead = await fetch(
    `${baseUrl}/agent-host/sessions/${created.session.defSessionId}`,
    { headers: productHeaders },
  );
  assert.equal(wrongBindingRead.status, 409);
  assert.equal(
    (await wrongBindingRead.json() as { error: { code: string } }).error.code,
    'AGENT_BINDING_CONFLICT',
  );
  const wrongBindingAbort = await fetch(abortUrl, {
    method: 'POST', headers: productHeaders, body: JSON.stringify({}),
  });
  assert.equal(wrongBindingAbort.status, 409, 'a consumer from another Timeline cannot address the old Turn');
  await server.stop();
}

// In-memory retention is finite without truncating journals or weakening retry identity.
{
  const owner = claims('cap-retention');
  const registry = new BrowserConsumerRegistry();
  const registration = {
    consumerId: 'consumer-retention',
    executorLeaseId: 'lease-retention',
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
  const baseEngine = new DeterministicFakeAgentEngine();
  const capacityAbortCodes: string[] = [];
  const engine: AgentEngine = {
    kind: baseEngine.kind,
    probe: () => baseEngine.probe(),
    createSession: (input) => baseEngine.createSession(input),
    recoverSession: (ref) => baseEngine.recoverSession(ref),
    startTurn: async (input) => {
      const handle = await baseEngine.startTurn(input);
      const trackCapacityAbort = input.userMessage.startsWith('填满事件日志');
      return {
        ref: handle.ref,
        events: handle.events,
        submitToolResult: (result) => handle.submitToolResult(result),
        submitToolResultAndUpdateProjection: (result, projection) => (
          handle.submitToolResultAndUpdateProjection(result, projection)
        ),
        submitInteractionResult: (result) => handle.submitInteractionResult(result),
        updateToolProjection: (projection) => handle.updateToolProjection(projection),
        abort: async (reason) => {
          if (trackCapacityAbort) capacityAbortCodes.push(reason.code);
          return handle.abort(reason);
        },
      };
    },
    compact: (ref) => baseEngine.compact(ref),
    disposeSession: (ref) => baseEngine.disposeSession(ref),
    shutdown: () => baseEngine.shutdown(),
  };
  const tools = new DefReadToolRegistry();
  const harness = new DefHarnessManager({
    resolveToolDescriptor: (name) => tools.resolveDescriptor(name),
  });
  const host = new DefAgentHost({
    engine,
    productGateway: gateway,
    harnessManager: harness,
    toolRegistry: tools,
    requireConsumer: () => { registry.requireActive(); },
  });
  const sessions = [];
  for (let index = 0; index < DEF_AGENT_IN_MEMORY_LIMITS.maxSessionsPerHost; index += 1) {
    sessions.push(await host.createSession({
      binding: binding(),
      providerProfileRef: `retention-profile-${index}`,
    }));
  }
  await expectHostError(() => host.createSession({
    binding: binding(),
    providerProfileRef: 'retention-profile-overflow',
  }), 'AGENT_SESSION_LIMIT_REACHED');

  const retainedSession = sessions[0]!;
  let firstRetainedTurnId: ReturnType<typeof asDefTurnId> | null = null;
  for (let index = 0; index < DEF_AGENT_IN_MEMORY_LIMITS.maxTurnsPerSession; index += 1) {
    baseEngine.enqueueScript([{ type: 'complete' }]);
    const turn = await host.startHarnessTurn({
      defSessionId: retainedSession.defSessionId,
      userMessage: `retained-turn-${index}`,
      clientTurnId: asClientTurnId(`retained-client-turn-${index}`),
    });
    if (index === 0) firstRetainedTurnId = turn.defTurnId;
    const terminal = await host.waitForTurnTerminal(turn.defTurnId);
    assert.equal(terminal.type, 'turn.failed');
    await host.abortTurn(turn.defTurnId, 'IDEMPOTENT_AFTER_SETTLEMENT');
    assert.equal(await host.waitForTurnTerminal(turn.defTurnId), terminal);
  }
  assert.ok(firstRetainedTurnId);
  const retriedRetainedTurn = await host.startHarnessTurn({
    defSessionId: retainedSession.defSessionId,
    userMessage: 'retained-turn-0',
    clientTurnId: asClientTurnId('retained-client-turn-0'),
  });
  assert.equal(
    retriedRetainedTurn.defTurnId,
    firstRetainedTurnId,
    'an old retry must win over a full Session capacity check',
  );
  await expectHostError(() => host.startHarnessTurn({
    defSessionId: retainedSession.defSessionId,
    userMessage: 'retained-turn-0-conflict',
    clientTurnId: asClientTurnId('retained-client-turn-0'),
  }), 'AGENT_CLIENT_TURN_CONFLICT');
  await expectHostError(() => host.startHarnessTurn({
    defSessionId: retainedSession.defSessionId,
    userMessage: 'retained-turn-overflow',
    clientTurnId: asClientTurnId('retained-client-turn-overflow'),
  }), 'AGENT_SESSION_TURN_LIMIT_REACHED');

  const journalSession = sessions[1]!;
  for (let index = 0; index < 4; index += 1) {
    baseEngine.enqueueScript([
      ...Array.from(
        { length: DEF_AGENT_IN_MEMORY_LIMITS.maxEventsPerTurn + 64 },
        () => ({ type: 'text' as const, delta: 'bounded-delta' }),
      ),
      { type: 'complete' as const },
    ]);
    const journalTurn = await host.startTurn({
      defSessionId: journalSession.defSessionId,
      userMessage: `填满事件日志-${index}`,
      systemContext: 'retention contract',
      toolProjection: { revision: 1, tools: [] },
    });
    const journalTerminal = await host.waitForTurnTerminal(journalTurn.defTurnId);
    assert.equal(journalTerminal.type, 'turn.failed');
    if (journalTerminal.type === 'turn.failed') {
      assert.equal(
        journalTerminal.payload.code,
        index < 3 ? 'AGENT_TURN_OUTPUT_LIMIT' : 'AGENT_EVENT_CAPACITY_REACHED',
      );
    }
    assert.equal(
      capacityAbortCodes.length,
      index + 1,
      'each over-capacity Turn must abort its Engine handle exactly once',
    );
  }
  assert.deepEqual(capacityAbortCodes, [
    'AGENT_TURN_OUTPUT_LIMIT',
    'AGENT_TURN_OUTPUT_LIMIT',
    'AGENT_TURN_OUTPUT_LIMIT',
    'AGENT_EVENT_CAPACITY_REACHED',
  ]);
  const retainedEvents = [];
  let retainedCursor = 0;
  while (true) {
    const page = host.readEvents(journalSession.defSessionId, retainedCursor, 256);
    retainedEvents.push(...page);
    if (page.length < 256) break;
    retainedCursor = page.at(-1)!.sequence;
  }
  assert.ok(retainedEvents.length <= DEF_AGENT_IN_MEMORY_LIMITS.maxEventsPerSession);
  assert.ok(
    retainedEvents.reduce((total, event) => total + JSON.stringify(event).length, 0)
      <= DEF_AGENT_IN_MEMORY_LIMITS.maxEventCodeUnitsPerSession,
  );
  assert.equal(retainedEvents.at(-1)?.type, 'turn.failed');
  assert.equal(
    retainedEvents.filter((event) => event.type === 'turn.failed').length,
    4,
    'each accepted over-capacity Turn must have one terminal Event',
  );
  retainedEvents.forEach((event, index) => assert.equal(event.sequence, index + 1));
  await expectHostError(() => host.startTurn({
    defSessionId: journalSession.defSessionId,
    userMessage: '日志已满后不得静默截断',
    systemContext: 'retention contract',
    toolProjection: { revision: 1, tools: [] },
  }), 'AGENT_EVENT_CAPACITY_REACHED');
  await host.shutdown();
}

console.log('DEF_AGENT_HOST_PHASE2_CONTRACT_OK');
