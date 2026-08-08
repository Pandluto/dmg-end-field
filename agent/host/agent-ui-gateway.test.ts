import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  asDatabaseGeneration,
  asDefSessionId,
  asDefTurnId,
  asEngineSessionId,
  asInteractionId,
  asTimelineId,
  asWorkspaceId,
  type ConversationCursor,
  type ConversationEvent,
  type ConversationSnapshot,
  type ClientTurnId,
  type DefSessionId,
  type DefSessionV6,
  type DefTurnId,
  type InteractionId,
  type InteractionRequest,
  type InteractionResponse,
  type ProductBinding,
} from '../core/contracts/index.ts';
import { BrowserConsumerRegistry } from './browser-consumer-registry.ts';
import {
  AgentUiGateway,
  encodeConversationCursor,
  type AgentUiGatewayPort,
  type AgentUiGatewayStartTurnInput,
  type AgentUiGatewayStopTurnInput,
  type AgentUiInteractionInput,
} from './agent-ui-gateway.ts';
import { DefAgentHostError } from './errors.ts';
import { AgentTokenAuthority } from './token-authority.ts';

const browserOrigin = 'http://127.0.0.1:31457';
const capability = 'capability-agent-ui-0123456789';
const apiGrant = 'api-grant-agent-ui-0123456789';
const routeGrant = 'route-grant-agent-ui-0123456789';

test('Agent UI Gateway covers Session lifecycle, auth, binding, interaction, and safe static paths', async () => {
  const fixture = await createFixture();
  try {
    const staticIndex = await fetch(`${fixture.origin}/agent-ui/`);
    assert.equal(staticIndex.status, 200);
    assert.match(await staticIndex.text(), /session-surface/u);
    assert.equal((await fetch(`${fixture.origin}/agent-ui/assets/app.js`)).status, 200);
    assert.equal((await fetch(`${fixture.origin}/agent-ui/secret.txt`)).status, 404);
    assert.equal((await fetch(`${fixture.origin}/agent-ui/assets/%2e%2e/secret.txt`)).status, 404);

    const grantExchange = await fetch(`${fixture.origin}/agent-ui/auth/session`, {
      method: 'POST',
      headers: { Origin: browserOrigin, 'content-type': 'application/json' },
      body: JSON.stringify({ launchGrant: routeGrant, audience: 'workbench-ai-mode' }),
    });
    assert.equal(grantExchange.status, 201);
    assert.equal((await grantExchange.json() as { capability: string }).capability, capability);

    const unauthorized = await fetch(`${fixture.origin}/agent-ui/sessions`, {
      headers: { Origin: browserOrigin },
    });
    assert.equal(unauthorized.status, 403);
    const wrongOrigin = await fetch(`${fixture.origin}/agent-ui/sessions`, {
      headers: { Origin: 'http://127.0.0.1:31458', 'x-dmg-agent-ui-capability': capability },
    });
    assert.equal(wrongOrigin.status, 403);
    const wrongGrantOrigin = await fetch(`${fixture.origin}/agent-ui/session`, {
      method: 'POST',
      headers: { Origin: 'http://127.0.0.1:31458', 'content-type': 'application/json' },
      body: JSON.stringify({ launchGrant: apiGrant, audience: 'workbench-ai-mode' }),
    });
    assert.equal(wrongGrantOrigin.status, 403);

    const sessionsResponse = await fixture.api('/sessions');
    assert.equal(sessionsResponse.status, 200);
    const sessionsBody = await sessionsResponse.json() as { sessions: Array<Record<string, unknown>> };
    assert.deepEqual(sessionsBody.sessions.map((entry) => entry.defSessionId), [fixture.session.defSessionId]);
    assert.equal((sessionsBody.sessions[0]?.engine as Record<string, unknown>).sessionId, undefined);

    const foreignDetail = await fixture.api(`/sessions/${fixture.foreignSession.defSessionId}`);
    assert.equal(foreignDetail.status, 409);

    const createResponse = await fixture.api('/sessions', {
      method: 'POST',
      body: JSON.stringify({ providerProfileRef: 'default' }),
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json() as { session: DefSessionV6 };
    assert.equal((created.session as unknown as { defSessionId: string }).defSessionId, 'session-created');

    const firstPrompt = await fixture.api(`/sessions/${fixture.session.defSessionId}/prompt`, {
      method: 'POST',
      body: JSON.stringify({ clientTurnId: 'client-turn-1', userMessage: '  检查当前排轴  ' }),
    });
    const retryPrompt = await fixture.api(`/sessions/${fixture.session.defSessionId}/prompt`, {
      method: 'POST',
      body: JSON.stringify({ clientTurnId: 'client-turn-1', userMessage: '检查当前排轴' }),
    });
    assert.equal(firstPrompt.status, 202);
    assert.equal(retryPrompt.status, 202);
    assert.deepEqual(await firstPrompt.json(), await retryPrompt.json());
    assert.equal(fixture.port.acceptedPrompts.length, 1, 'prompt idempotency remains in the injected Host port');

    const stopResponse = await fixture.api(`/sessions/${fixture.session.defSessionId}/stop`, {
      method: 'POST',
      body: JSON.stringify({ defTurnId: 'turn-client-turn-1' }),
    });
    assert.equal(stopResponse.status, 200);
    assert.deepEqual(fixture.port.stoppedTurns, ['turn-client-turn-1']);

    const archiveResponse = await fixture.api(`/sessions/${fixture.session.defSessionId}/archive`, {
      method: 'POST',
      body: '{}',
    });
    assert.equal(archiveResponse.status, 200);
    assert.equal(fixture.port.sessions.get(fixture.session.defSessionId)?.status, 'archived');

    const deleteResponse = await fixture.api(`/sessions/${fixture.session.defSessionId}`, { method: 'DELETE' });
    assert.equal(deleteResponse.status, 200);
    assert.deepEqual(fixture.port.deletedSessions, [fixture.session.defSessionId]);

    const invalidRoute = await fixture.api('/not-a-route');
    assert.equal(invalidRoute.status, 404);
  } finally {
    await fixture.close();
  }
});

test('Agent UI Gateway resumes a composite cursor and forwards gap reset over SSE', async () => {
  const fixture = await createFixture();
  try {
    const snapshotResponse = await fixture.api(`/sessions/${fixture.session.defSessionId}/conversation/snapshot`);
    assert.equal(snapshotResponse.status, 200);
    const snapshot = await snapshotResponse.json() as ConversationSnapshot;
    assert.deepEqual(snapshot.cursor, { epoch: 'fixture-epoch', runtimeSequence: 0, hostSequence: 0 });

    const streamResponse = await fixture.api(
      `/sessions/${fixture.session.defSessionId}/conversation/events?cursor=${encodeURIComponent(encodeConversationCursor(snapshot.cursor))}`,
    );
    assert.equal(streamResponse.status, 200);
    assert.equal(streamResponse.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    const reader = streamResponse.body!.getReader();
    const event: ConversationEvent = {
      schemaVersion: 1,
      source: 'runtime',
      sourceSequence: 1,
      defSessionId: fixture.session.defSessionId,
      occurredAt: '2026-08-08T00:00:01.000Z',
      cursor: { ...snapshot.cursor, runtimeSequence: 1 },
      type: 'session.status',
      status: { status: 'idle' },
    };
    fixture.port.emit(event);
    const frame = await readUntil(reader, (value) => value.includes('session.status'));
    assert.match(frame, /id: c1\./u);
    assert.match(frame, /event: session\.status/u);
    assert.match(frame, /"runtimeSequence":1/u);
    await reader.cancel();

    const resumed = await fixture.api(
      `/sessions/${fixture.session.defSessionId}/conversation/events`,
      { headers: { 'last-event-id': encodeConversationCursor(event.cursor) } },
    );
    assert.equal(resumed.status, 200);
    await resumed.body?.cancel();

    const gap = await fixture.api(
      `/sessions/${fixture.session.defSessionId}/conversation/events?cursor=${encodeURIComponent(encodeConversationCursor({ ...snapshot.cursor, runtimeSequence: 99 }))}`,
    );
    assert.equal(gap.status, 200);
    const gapFrame = await gap.text();
    assert.match(gapFrame, /event: conversation\.reset-required/u);
    assert.match(gapFrame, /"reason":"gap"/u);
  } finally {
    await fixture.close();
  }
});

test('Agent UI Gateway lists/responds to interactions and closes SSE when the consumer is lost', async () => {
  const fixture = await createFixture();
  try {
    fixture.port.pendingInteractions.push({
      interactionId: asInteractionId('interaction-visible'),
      defSessionId: fixture.session.defSessionId,
      defTurnId: asDefTurnId('turn-interaction-visible'),
      kind: 'question',
      prompt: '请选择范围',
      createdAt: '2026-08-08T00:00:00.000Z',
      expiresAt: '2026-08-08T00:15:00.000Z',
    });
    fixture.port.pendingInteractions.push({
      interactionId: asInteractionId('interaction-foreign'),
      defSessionId: fixture.foreignSession.defSessionId,
      defTurnId: asDefTurnId('turn-interaction-foreign'),
      kind: 'question',
      prompt: '不应显示',
      createdAt: '2026-08-08T00:00:00.000Z',
      expiresAt: '2026-08-08T00:15:00.000Z',
    });

    const listResponse = await fixture.api('/interactions');
    assert.equal(listResponse.status, 200);
    const listBody = await listResponse.json() as { interactions: InteractionRequest[] };
    assert.deepEqual(listBody.interactions.map((entry) => entry.interactionId), ['interaction-visible']);

    const response = await fixture.api('/interactions/interaction-visible/respond', {
      method: 'POST',
      body: JSON.stringify({ status: 'answered', value: '当前按钮' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json() as { response: InteractionResponse }).response.status, 'answered');

    const snapshot = await fixture.port.getSnapshot(fixture.session.defSessionId);
    const stream = await fixture.api(
      `/sessions/${fixture.session.defSessionId}/conversation/events?cursor=${encodeURIComponent(encodeConversationCursor(snapshot.cursor))}`,
    );
    assert.equal(stream.status, 200);
    const reader = stream.body!.getReader();
    assert.equal(fixture.port.activeStreamCount, 1);
    fixture.consumers.close(fixture.claims, {
      consumerId: fixture.consumer.consumerId,
      executorLeaseId: fixture.consumer.executorLeaseId,
    });
    const lostFrame = await readUntil(reader, (value) => value.includes('AGENT_CONSUMER_STALE'), 1_000);
    assert.match(lostFrame, /gateway\.error/u);
    await reader.cancel();
    await waitFor(() => fixture.port.activeStreamCount === 0);
  } finally {
    await fixture.close();
  }
});

type Fixture = {
  readonly origin: string;
  readonly api: (path: string, init?: RequestInit) => Promise<Response>;
  readonly close: () => Promise<void>;
  readonly session: DefSessionV6;
  readonly foreignSession: DefSessionV6;
  readonly claims: ReturnType<AgentTokenAuthority['validateCapability']>;
  readonly consumer: ReturnType<BrowserConsumerRegistry['requireActive']>;
  readonly consumers: BrowserConsumerRegistry;
  readonly port: FakeAgentUiPort;
};

async function createFixture(): Promise<Fixture> {
  const uiRoot = await mkdtemp(join(tmpdir(), 'def-agent-ui-gateway-test-'));
  await mkdir(join(uiRoot, 'assets'));
  await writeFile(join(uiRoot, 'index.html'), '<html><body>session-surface</body></html>');
  await writeFile(join(uiRoot, 'assets', 'app.js'), 'export {};');
  await writeFile(join(uiRoot, 'secret.txt'), 'must-not-be-served');

  const binding = makeBinding('current');
  const session = makeSession(binding, 'session-visible', 'engine-visible');
  const foreignSession = makeSession({ ...binding, timelineId: asTimelineId('timeline-foreign') }, 'session-foreign', 'engine-foreign');
  const port = new FakeAgentUiPort(session, foreignSession);
  const tokens = new AgentTokenAuthority({ clock: () => 1_000, randomToken: () => capability });
  tokens.registerLaunchGrant({
    grant: apiGrant,
    origin: browserOrigin,
    audience: 'workbench-ai-mode',
    expiresAt: 61_000,
  });
  const exchanged = tokens.exchangeLaunchGrant({
    grant: apiGrant,
    origin: browserOrigin,
    audience: 'workbench-ai-mode',
  });
  const claims = tokens.validateCapability({
    capability: exchanged.capability,
    origin: browserOrigin,
    audience: 'workbench-ai-mode',
  });
  tokens.registerLaunchGrant({
    grant: routeGrant,
    origin: browserOrigin,
    audience: 'workbench-ai-mode',
    expiresAt: 61_000,
  });
  const consumers = new BrowserConsumerRegistry({ clock: () => 1_000, heartbeatTtlMs: 60_000 });
  const consumer = consumers.register(claims, {
    consumerId: 'consumer-agent-ui',
    executorLeaseId: 'lease-agent-ui',
    writer: true,
    visible: true,
    binding,
  });
  const gateway = new AgentUiGateway({
    uiRoot,
    browserOrigin,
    port,
    tokens,
    consumers,
    consumerPollIntervalMs: 10,
  });
  await gateway.listen(0);
  return {
    origin: gateway.origin,
    api: (path, init = {}) => fetch(`${gateway.origin}/agent-ui${path}`, {
      ...init,
      headers: {
        Origin: browserOrigin,
        'x-dmg-agent-ui-capability': capability,
        ...(init.headers ?? {}),
      },
    }),
    async close() {
      await gateway.stop();
      await rm(uiRoot, { recursive: true, force: true });
    },
    session,
    foreignSession,
    claims,
    consumer,
    consumers,
    port,
  };
}

class FakeAgentUiPort implements AgentUiGatewayPort {
  readonly sessions = new Map<string, DefSessionV6>();
  readonly pendingInteractions: InteractionRequest[] = [];
  readonly acceptedPrompts: string[] = [];
  readonly stoppedTurns: string[] = [];
  readonly deletedSessions: string[] = [];
  readonly #promptResults = new Map<string, { readonly defTurnId: DefTurnId; readonly clientTurnId: ClientTurnId }>();
  readonly #streams = new Set<FakeStream>();
  readonly #snapshot: ConversationSnapshot;

  constructor(session: DefSessionV6, foreignSession: DefSessionV6) {
    this.sessions.set(session.defSessionId, session);
    this.sessions.set(foreignSession.defSessionId, foreignSession);
    this.#snapshot = {
      schemaVersion: 1,
      defSessionId: session.defSessionId,
      cursor: { epoch: 'fixture-epoch', runtimeSequence: 0, hostSequence: 0 },
      status: { status: 'idle' },
      messages: [],
      parts: [],
    };
  }

  get activeStreamCount(): number {
    return this.#streams.size;
  }

  listSessions(): readonly DefSessionV6[] {
    return [...this.sessions.values()];
  }

  readSession(defSessionId: DefSessionId): DefSessionV6 {
    const session = this.sessions.get(defSessionId);
    if (!session) throw new DefAgentHostError('AGENT_SESSION_NOT_FOUND', 'Session not found', 404);
    return structuredClone(session);
  }

  async createSession(input: { readonly binding: ProductBinding; readonly providerProfileRef: string }): Promise<DefSessionV6> {
    assert.equal(input.providerProfileRef, 'default');
    const session = makeSession(input.binding, 'session-created', 'engine-created');
    this.sessions.set(session.defSessionId, session);
    return structuredClone(session);
  }

  async startTurn(input: AgentUiGatewayStartTurnInput): Promise<{ defTurnId: DefTurnId; clientTurnId: ClientTurnId }> {
    const prior = this.#promptResults.get(`${input.defSessionId}:${input.clientTurnId}`);
    if (prior) return { ...prior, clientTurnId: input.clientTurnId };
    this.acceptedPrompts.push(input.userMessage);
    const result = { defTurnId: asDefTurnId(`turn-${input.clientTurnId}`), clientTurnId: input.clientTurnId };
    this.#promptResults.set(`${input.defSessionId}:${input.clientTurnId}`, result);
    return result;
  }

  async stopTurn(input: AgentUiGatewayStopTurnInput): Promise<void> {
    this.stoppedTurns.push(input.defTurnId);
  }

  archiveSession(defSessionId: DefSessionId): DefSessionV6 {
    const session = this.sessions.get(defSessionId);
    if (!session) throw new DefAgentHostError('AGENT_SESSION_NOT_FOUND', 'Session not found', 404);
    const archived = { ...session, status: 'archived' as const };
    this.sessions.set(defSessionId, archived);
    return structuredClone(archived);
  }

  async deleteSession(defSessionId: DefSessionId): Promise<void> {
    this.deletedSessions.push(defSessionId);
    this.sessions.delete(defSessionId);
  }

  async getSnapshot(defSessionId: DefSessionId): Promise<ConversationSnapshot> {
    assert.equal(defSessionId, this.#snapshot.defSessionId);
    return structuredClone(this.#snapshot);
  }

  subscribe(defSessionId: DefSessionId, cursor: ConversationCursor, signal?: AbortSignal): AsyncIterable<ConversationEvent> {
    if (cursor.runtimeSequence === 99) {
      const reset: ConversationEvent = {
        schemaVersion: 1,
        source: 'projector',
        sourceSequence: 0,
        defSessionId,
        occurredAt: '2026-08-08T00:00:02.000Z',
        cursor,
        type: 'conversation.reset-required',
        reason: 'gap',
      };
      return (async function* () { yield reset; })();
    }
    const stream: FakeStream = { defSessionId, queue: [], waiters: [], signal };
    this.#streams.add(stream);
    return this.#stream(stream);
  }

  listPendingInteractions(): readonly InteractionRequest[] {
    return structuredClone(this.pendingInteractions);
  }

  resolveInteraction(interactionId: InteractionId, input: AgentUiInteractionInput): InteractionResponse {
    const index = this.pendingInteractions.findIndex((interaction) => interaction.interactionId === interactionId);
    assert.notEqual(index, -1);
    this.pendingInteractions.splice(index, 1);
    return {
      interactionId,
      status: input.status,
      ...(Object.prototype.hasOwnProperty.call(input, 'value') ? { value: input.value as never } : {}),
      resolvedAt: '2026-08-08T00:00:03.000Z',
    };
  }

  emit(event: ConversationEvent): void {
    for (const stream of this.#streams) {
      const waiter = stream.waiters.shift();
      if (waiter) waiter(event);
      else stream.queue.push(event);
    }
  }

  async *#stream(stream: FakeStream): AsyncIterable<ConversationEvent> {
    try {
      while (!stream.signal?.aborted) {
        const event = await take(stream);
        if (!event) return;
        yield event;
      }
    } finally {
      this.#streams.delete(stream);
      for (const waiter of stream.waiters.splice(0)) waiter(null);
    }
  }
}

type FakeStream = {
  readonly defSessionId: DefSessionId;
  readonly queue: ConversationEvent[];
  readonly waiters: Array<(event: ConversationEvent | null) => void>;
  readonly signal?: AbortSignal;
};

function take(stream: FakeStream): Promise<ConversationEvent | null> {
  const next = stream.queue.shift();
  if (next) return Promise.resolve(next);
  if (stream.signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    stream.waiters.push(resolve);
    stream.signal?.addEventListener('abort', () => {
      const index = stream.waiters.indexOf(resolve);
      if (index >= 0) stream.waiters.splice(index, 1);
      resolve(null);
    }, { once: true });
  });
}

function makeBinding(suffix: string): ProductBinding {
  return {
    workspaceId: asWorkspaceId(`workspace-${suffix}`),
    databaseGeneration: asDatabaseGeneration(`generation-${suffix}`),
    timelineId: asTimelineId(`timeline-${suffix}`),
    checkoutTargetId: null,
    checkoutUpdatedAt: 1,
    contentRevision: 1,
    snapshotDigest: `digest-${suffix}`,
  };
}

function makeSession(binding: ProductBinding, defSessionId: string, engineSessionId: string): DefSessionV6 {
  return {
    schemaVersion: 6,
    eventSchemaVersion: 1,
    defSessionId: asDefSessionId(defSessionId),
    host: 'workbench',
    status: 'ready',
    workspaceId: binding.workspaceId,
    lastDatabaseGeneration: binding.databaseGeneration,
    timelineId: binding.timelineId,
    axisBindingId: null,
    boundNodeId: null,
    engine: {
      kind: 'def-runtime',
      sessionId: asEngineSessionId(engineSessionId),
      runtimeVersion: 'test-runtime',
      storeSchemaVersion: 1,
    },
    harness: { stateVersion: 1, revision: 'gateway-test' },
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
  };
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (value: string) => boolean,
  timeoutMs = 2_000,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => setTimeout(() => resolve({ done: true, value: undefined }), 50)),
    ]);
    if (result.done) {
      if (predicate(text)) return text;
      continue;
    }
    text += decoder.decode(result.value, { stream: true });
    if (predicate(text)) return text;
  }
  throw new Error(`Timed out waiting for SSE frame: ${text}`);
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Timed out waiting for gateway cleanup');
}
