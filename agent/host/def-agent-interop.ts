import { randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  asClientTurnId,
  asDefSessionId,
  asDefTurnId,
  type AgentHostHealth,
  type DefEvent,
  type DefSessionV6,
  type InteractionRequest,
  type JsonValue,
  type ProductBinding,
  type ProductSnapshotEnvelope,
} from '../core/contracts/index.ts';
import { BrowserConsumerRegistry } from './browser-consumer-registry.ts';
import { DefAgentHost } from './def-agent-host.ts';
import { DefAgentHostError } from './errors.ts';
import { RemoteBrowserProductGateway } from './remote-browser-product-gateway.ts';

/**
 * Development-only observation protocol for the native DEF Workbench.
 *
 * This is intentionally a projection over DefAgentHost's event journal.  It
 * does not read OpenCode's private store, poll the native transcript API, or
 * create a second Product/Harness path.  The Electron browser bridge exposes
 * this route under /agent-host/**, so the route works from the same desktop
 * Workbench bridge origin as the native UI.
 */
export const DEF_CODEX_INTEROP_PROTOCOL = 'def-codex-interop' as const;
export const DEF_CODEX_INTEROP_PROTOCOL_VERSION = 1 as const;
export const DEF_CODEX_INTEROP_PATH = '/agent-host/interop/v1' as const;
export const DEF_CODEX_INTEROP_COMPATIBILITY_PATH = '/agent-host/workbench-test/prompt' as const;
export const DEF_CODEX_INTEROP_CAPABILITIES = Object.freeze([
  'turn.start',
  'turn.continue',
  'turn.stop',
  'events.subscribe',
  'transcript.read',
  'state.read',
  'questions.read',
  'ui-events.subscribe',
]);

const CLIENT_TURN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const PORTABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const MAX_REQUEST_BYTES = 1_048_576;
const MAX_EVENT_PAGE = 256;
const MAX_EVENT_PAGES = 16;
const DEFAULT_TOKEN_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_STREAM_TTL_MS = 60 * 1_000;
const SSE_POLL_MS = 250;

type InteropEngineState = AgentHostHealth['engine'];

export interface DefAgentInteropRouteOptions {
  readonly host: DefAgentHost;
  readonly consumers: BrowserConsumerRegistry;
  readonly gateway: RemoteBrowserProductGateway;
  readonly engine: InteropEngineState | (() => InteropEngineState);
  readonly profile?: string;
  readonly enabled?: boolean;
  readonly clock?: () => number;
  readonly randomToken?: () => string;
  readonly tokenTtlMs?: number;
  readonly streamTtlMs?: number;
  readonly diagnostic?: (message: string) => void;
}

type InteropErrorBody = {
  readonly code: string;
  readonly message: string;
  readonly component: string;
  readonly retryable: boolean;
  readonly ids?: Readonly<Record<string, string>>;
  readonly nextAction?: string;
};

class InteropRouteError extends Error {
  readonly statusCode: number;
  readonly body: InteropErrorBody;

  constructor(statusCode: number, body: InteropErrorBody) {
    super(body.message);
    this.name = 'InteropRouteError';
    this.statusCode = statusCode;
    this.body = body;
  }
}

type TurnMetadata = {
  readonly clientTurnId: string;
  readonly rawUserText: string;
  readonly ingressMode: 'pure-blackbox' | 'diagnostic';
  readonly diagnostic?: Readonly<Record<string, unknown>>;
};

type RunState = {
  readonly testRunId: string;
  readonly defSessionId: string;
  readonly createdAt: string;
  readonly turns: Map<string, TurnMetadata>;
};

type ToolProjection = {
  readonly toolCallId: string;
  name: string;
  input: JsonValue | null;
  status: 'requested' | 'running' | 'completed' | 'error';
  result?: JsonValue;
  error?: JsonValue;
  sequence: number;
};

type TurnProjection = {
  readonly defTurnId: string;
  readonly firstSequence: number;
  readonly events: DefEvent[];
  clientTurnId: string;
  rawUserText: string;
  firstTokenAt: string | null;
  terminal: DefEvent | null;
  tools: Map<string, ToolProjection>;
  failures: JsonValue[];
};

type UiInteropEvent = {
  readonly protocol: typeof DEF_CODEX_INTEROP_PROTOCOL;
  readonly protocolVersion: typeof DEF_CODEX_INTEROP_PROTOCOL_VERSION;
  readonly cursor: string;
  readonly sequence: number;
  readonly at: string;
  readonly type: 'ui-session-opened' | 'ui-session-closed' | 'ui-session-binding-changed';
  readonly sessionId: string | null;
  readonly payload: JsonValue;
};

type InteropEventEnvelope = Record<string, unknown> & {
  readonly type: string;
  readonly sequence: number;
};

type ConsumerState = ReturnType<BrowserConsumerRegistry['current']>;

export class DefAgentInteropRoute {
  readonly #host: DefAgentHost;
  readonly #consumers: BrowserConsumerRegistry;
  readonly #gateway: RemoteBrowserProductGateway;
  readonly #engine: () => InteropEngineState;
  readonly #enabled: boolean;
  readonly #clock: () => number;
  readonly #randomToken: () => string;
  readonly #tokenTtlMs: number;
  readonly #streamTtlMs: number;
  readonly #diagnostic: (message: string) => void;
  readonly #tokens = new Map<string, number>();
  readonly #runs = new Map<string, RunState>();
  readonly #uiEvents: UiInteropEvent[] = [];
  #uiSequence = 0;
  #lastConsumer: ConsumerState = null;

  constructor(options: DefAgentInteropRouteOptions) {
    this.#host = options.host;
    this.#consumers = options.consumers;
    this.#gateway = options.gateway;
    if (typeof options.engine === 'function') {
      this.#engine = options.engine;
    } else {
      const engine = options.engine;
      this.#engine = () => engine;
    }
    this.#enabled = options.enabled ?? isDevelopmentProfile(options.profile);
    this.#clock = options.clock ?? Date.now;
    this.#randomToken = options.randomToken ?? (() => randomBytes(24).toString('base64url'));
    this.#tokenTtlMs = positiveInteger(options.tokenTtlMs, DEFAULT_TOKEN_TTL_MS);
    this.#streamTtlMs = positiveInteger(options.streamTtlMs, DEFAULT_STREAM_TTL_MS);
    this.#diagnostic = options.diagnostic ?? (() => undefined);
  }

  /** Return true when this request belongs to the Interop route. */
  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const route = normalizeRoute(url.pathname);
    if (!route) return false;

    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('X-Content-Type-Options', 'nosniff');

    try {
      await this.#dispatch(request, response, url, route);
    } catch (error) {
      this.#diagnostic(`interop request failed: ${describeError(error)}`);
      this.#writeError(response, error);
    }
    return true;
  }

  async #dispatch(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    route: string,
  ): Promise<void> {
    const method = String(request.method || 'GET').toUpperCase();
    if (method === 'OPTIONS') {
      response.writeHead(204, { Allow: 'GET,POST,OPTIONS' });
      response.end();
      return;
    }

    if (route === 'status' && method === 'GET') {
      await this.#status(response);
      return;
    }
    if (!this.#enabled) {
      throw this.#error(403, 'teacher-ingress-disabled', 'Teacher Interop is disabled outside development/test profiles.', 'bridge');
    }
    if (route === 'authorize' && method === 'POST') {
      this.#authorize(request, response);
      return;
    }
    this.#requireAuthorization(request);

    if (route === 'turns' && method === 'POST') {
      await this.#startTurn(request, response, null, false);
      return;
    }
    if (route === 'state' && method === 'GET') {
      await this.#state(response);
      return;
    }
    if (route === 'ui-events' && method === 'GET') {
      await this.#eventSubscription(request, response, url, null, true);
      return;
    }
    if (route === 'sessions' && method === 'GET') {
      await this.#sessions(response);
      return;
    }

    const sessionRoute = /^sessions\/([^/]+)(?:\/(events|transcript|questions|state))?$/u.exec(route);
    if (sessionRoute) {
      const session = this.#resolveSession(decodeRouteId(sessionRoute[1]!, 'sessionId'));
      const action = sessionRoute[2] ?? '';
      if (method === 'GET' && action === 'events') {
        await this.#eventSubscription(request, response, url, session, false);
        return;
      }
      if (method === 'GET' && action === 'transcript') {
        await this.#transcript(response, session);
        return;
      }
      if (method === 'GET' && action === 'questions') {
        await this.#questions(response, session);
        return;
      }
      if (method === 'GET' && action === 'state') {
        await this.#state(response, session);
        return;
      }
      if (method === 'GET' && action === '') {
        this.#writeJson(response, 200, this.#sessionEnvelope(session));
        return;
      }
      if (method === 'POST' && action === 'events') {
        throw this.#error(405, 'method-not-allowed', 'Event observation is read-only.', 'protocol');
      }
    }

    const continueRoute = /^sessions\/([^/]+)\/turns$/u.exec(route);
    if (continueRoute && method === 'POST') {
      await this.#startTurn(request, response, this.#resolveSession(decodeRouteId(continueRoute[1]!, 'sessionId')), true);
      return;
    }

    const stopRoute = /^sessions\/([^/]+)\/turns\/([^/]+)\/stop$/u.exec(route);
    if (stopRoute && method === 'POST') {
      await this.#stopTurn(
        response,
        this.#resolveSession(decodeRouteId(stopRoute[1]!, 'sessionId')),
        decodeRouteId(stopRoute[2]!, 'turnId'),
      );
      return;
    }

    if (route === 'workbench-test/prompt' && method === 'POST') {
      const body = await this.#readBody(request);
      await this.#startTurn(request, response, null, Boolean(body.sessionId), body);
      return;
    }

    throw this.#error(404, 'interop-route-not-found', 'Interop route was not found.', 'protocol');
  }

  #authorize(request: IncomingMessage, response: ServerResponse): void {
    this.#requireLoopback(request);
    this.#tokensSweep();
    const token = this.#randomToken();
    if (!isSecureToken(token)) {
      throw this.#error(500, 'authorization-token-invalid', 'Interop token generation returned an unsafe token.', 'bridge');
    }
    const expiresAt = this.#clock() + this.#tokenTtlMs;
    this.#tokens.set(token, expiresAt);
    this.#writeJson(response, 201, {
      ok: true,
      protocol: DEF_CODEX_INTEROP_PROTOCOL,
      protocolVersion: DEF_CODEX_INTEROP_PROTOCOL_VERSION,
      token,
      expiresAt,
    });
  }

  #requireAuthorization(request: IncomingMessage): void {
    this.#requireLoopback(request);
    this.#tokensSweep();
    const authorization = String(request.headers.authorization || '');
    const token = authorization.replace(/^Bearer\s+/iu, '').trim();
    const expiresAt = this.#tokens.get(token);
    if (!token || !expiresAt || expiresAt <= this.#clock()) {
      throw this.#error(
        401,
        'teacher-authorization-required',
        'A current local teacher authorization is required.',
        'bridge',
        true,
        undefined,
        'POST /agent-host/interop/v1/authorize from loopback, then retry with Authorization: Bearer <token>.',
      );
    }
  }

  #requireLoopback(request: IncomingMessage): void {
    const host = String(request.headers.host || '').split(':')[0].replace(/^\[|\]$/gu, '').toLowerCase();
    const origin = String(request.headers.origin || '').trim();
    if (!isLoopbackHost(host) || (origin && !isLoopbackOrigin(origin))) {
      throw this.#error(403, 'teacher-local-origin-required', 'Teacher Interop accepts loopback Host and Origin only.', 'bridge');
    }
  }

  async #status(response: ServerResponse): Promise<void> {
    this.#observeConsumer();
    const consumer = this.#consumers.current();
    const snapshot = await this.#readSnapshot(consumer);
    const engine = this.#engine();
    const active = this.#host.getActiveIds();
    this.#writeJson(response, 200, {
      ok: true,
      protocol: DEF_CODEX_INTEROP_PROTOCOL,
      protocolVersion: DEF_CODEX_INTEROP_PROTOCOL_VERSION,
      developmentOnly: true,
      enabled: this.#enabled,
      bridge: { ready: true, version: 'def-agent-host-protocol-2' },
      agent: {
        ready: engine.state === 'ready',
        state: engine.state,
        kind: engine.kind,
        ...(engine.reason ? { reason: engine.reason } : {}),
      },
      nativeUi: { available: true, source: 'OpenCodeNativeUiGateway' },
      sidecar: { retired: true, required: false },
      workbench: {
        snapshotAvailable: snapshot !== null,
        uiConnected: consumer !== null,
        uiConsumerCount: consumer ? 1 : 0,
        activeDefSessionId: active.defSessionId,
        activeDefTurnId: active.defTurnId,
      },
      eventSource: 'DefAgentHost.eventJournal',
      capabilities: this.#enabled ? DEF_CODEX_INTEROP_CAPABILITIES : [],
      authorization: {
        required: true,
        authorizeUrl: `${DEF_CODEX_INTEROP_PATH}/authorize`,
        expiresInSeconds: Math.floor(this.#tokenTtlMs / 1_000),
      },
    });
  }

  async #sessions(response: ServerResponse): Promise<void> {
    this.#observeConsumer();
    const consumer = this.#consumers.current();
    const sessions = consumer
      ? this.#host.listSessions(consumer.binding).map((session) => this.#sessionEnvelope(session).session)
      : [];
    this.#writeJson(response, 200, {
      ok: true,
      protocol: DEF_CODEX_INTEROP_PROTOCOL,
      protocolVersion: DEF_CODEX_INTEROP_PROTOCOL_VERSION,
      sessions,
      activeDefSessionId: this.#host.getActiveIds().defSessionId,
    });
  }

  async #startTurn(
    request: IncomingMessage,
    response: ServerResponse,
    routeSession: DefSessionV6 | null,
    continuation: boolean,
    suppliedBody?: Record<string, unknown>,
  ): Promise<void> {
    const body = suppliedBody ?? await this.#readBody(request);
    const normalizedBody = routeSession && body.sessionId === undefined
      ? { ...body, sessionId: routeSession.defSessionId }
      : body;
    const normalized = normalizeTurnRequest(normalizedBody, continuation);
    const requestedSessionId = routeSession?.defSessionId ?? normalized.sessionId;
    if (routeSession && normalized.sessionId && normalized.sessionId !== routeSession.defSessionId) {
      throw this.#error(409, 'session-id-conflict', 'The route sessionId and body sessionId do not match.', 'protocol');
    }
    const session = this.#resolveSession(requestedSessionId ?? null);
    const beforeEvents = this.#readAllEvents(session);
    const beforeSequence = beforeEvents.at(-1)?.sequence ?? 0;
    const run = this.#runFor(session);
    const turn = await this.#host.startHarnessTurn({
      defSessionId: asDefSessionId(session.defSessionId),
      userMessage: normalized.rawUserText,
      clientTurnId: asClientTurnId(normalized.clientTurnId),
    });
    run.turns.set(turn.defTurnId, {
      clientTurnId: normalized.clientTurnId,
      rawUserText: normalized.rawUserText,
      ingressMode: normalized.ingressMode,
      ...(normalized.diagnostic ? { diagnostic: normalized.diagnostic } : {}),
    });

    const afterEvents = this.#readAllEvents(session);
    const accepted = afterEvents.find((event) => (
      event.type === 'turn.accepted'
      && event.defTurnId === turn.defTurnId
      && event.payload.clientTurnId === normalized.clientTurnId
    ));
    const snapshot = await this.#readSnapshot(this.#consumers.current());
    const cursor = accepted ? Math.max(0, accepted.sequence - 1) : beforeSequence;
    const responseTurn = {
      accepted: true,
      testRunId: run.testRunId,
      sessionId: session.defSessionId,
      defSessionId: session.defSessionId,
      engineSessionId: session.engine.sessionId,
      turnId: turn.defTurnId,
      defTurnId: turn.defTurnId,
      clientTurnId: normalized.clientTurnId,
      ingressMode: normalized.ingressMode,
      rawUserText: normalized.rawUserText,
      providerVisibleUserText: normalized.rawUserText,
      ...(normalized.ingressMode === 'diagnostic' ? { diagnostic: normalized.diagnostic ?? null } : {}),
      snapshotAvailable: snapshot !== null,
      eventCursor: String(cursor),
      acceptedAt: accepted?.occurredAt ?? new Date(this.#clock()).toISOString(),
      links: this.#links(session.defSessionId),
    };
    this.#writeJson(response, 202, {
      ok: true,
      protocol: DEF_CODEX_INTEROP_PROTOCOL,
      protocolVersion: DEF_CODEX_INTEROP_PROTOCOL_VERSION,
      turn: responseTurn,
    });
  }

  async #stopTurn(
    response: ServerResponse,
    session: DefSessionV6,
    turnId: string,
  ): Promise<void> {
    const events = this.#readAllEvents(session);
    const typedTurnId = asDefTurnId(turnId);
    const turnEvents = events.filter((event) => (
      (event as DefEvent & { readonly defTurnId?: string }).defTurnId === typedTurnId
    ));
    if (!turnEvents.some((event) => event.type === 'turn.accepted')) {
      throw this.#error(404, 'turn-not-found', 'The requested Turn does not belong to this Session.', 'session', false, {
        sessionId: session.defSessionId,
        turnId,
      });
    }
    const terminal = [...turnEvents].reverse().find((event) => isTerminalEvent(event));
    if (!terminal) {
      const consumer = this.#consumers.current();
      if (!consumer) throw this.#error(409, 'ui-consumer-unavailable', 'The Workbench consumer is no longer active.', 'ui-consumer', true);
      await this.#host.abortTurn(typedTurnId, 'USER_STOPPED', consumer.binding);
    }
    this.#writeJson(response, 200, {
      ok: true,
      protocol: DEF_CODEX_INTEROP_PROTOCOL,
      protocolVersion: DEF_CODEX_INTEROP_PROTOCOL_VERSION,
      status: terminal ? `already-${terminalStatus(terminal)}` : 'stopped',
      sessionId: session.defSessionId,
      turnId,
    });
  }

  async #state(response: ServerResponse, requestedSession: DefSessionV6 | null = null): Promise<void> {
    this.#observeConsumer();
    const consumer = this.#consumers.current();
    const snapshot = await this.#readSnapshot(consumer);
    const session = requestedSession ?? this.#activeSession(consumer);
    const pending = consumer && session
      ? this.#host.listPendingInteractions(consumer.binding).filter((item) => item.defSessionId === session.defSessionId)
      : [];
    const active = this.#host.getActiveIds();
    const payload = snapshot?.payload ?? null;
    this.#writeJson(response, 200, {
      ok: true,
      protocol: DEF_CODEX_INTEROP_PROTOCOL,
      protocolVersion: DEF_CODEX_INTEROP_PROTOCOL_VERSION,
      source: 'DefAgentHost.eventJournal',
      schemaVersion: 2,
      updatedAt: new Date(this.#clock()).toISOString(),
      snapshotAvailable: snapshot !== null,
      uiConsumerCount: consumer ? 1 : 0,
      state: {
        consumer: safeInteropValue(consumer),
        binding: safeInteropValue(snapshot?.binding ?? consumer?.binding ?? null),
        session: session ? this.#sessionEnvelope(session).session : null,
        activeDefSessionId: active.defSessionId,
        activeDefTurnId: active.defTurnId,
        checkout: safeInteropValue(objectValue(payload, 'checkout')),
        revision: snapshot?.binding.contentRevision ?? null,
        selectedOperators: projectSelectedOperators(payload),
        pending: {
          interactions: pending.length,
          questions: pending.filter((item) => item.kind === 'question').length,
          approvals: pending.filter((item) => item.kind === 'approval').length,
        },
      },
    });
  }

  async #transcript(response: ServerResponse, session: DefSessionV6): Promise<void> {
    const events = this.#readAllEvents(session);
    const run = this.#runFor(session);
    const turns = this.#projectTurns(events, run);
    const transcript = turns.flatMap((turn) => this.#projectTranscriptMessages(turn));
    this.#writeJson(response, 200, {
      ok: true,
      protocol: DEF_CODEX_INTEROP_PROTOCOL,
      protocolVersion: DEF_CODEX_INTEROP_PROTOCOL_VERSION,
      source: 'DefAgentHost.eventJournal',
      testRunId: run.testRunId,
      sessionId: session.defSessionId,
      defSessionId: session.defSessionId,
      engineSessionId: session.engine.sessionId,
      turns: turns.map((turn) => this.#turnSummary(turn, run)),
      transcript,
    });
  }

  async #questions(response: ServerResponse, session: DefSessionV6): Promise<void> {
    const events = this.#readAllEvents(session);
    const consumer = this.#consumers.current();
    const pending = consumer
      ? this.#host.listPendingInteractions(consumer.binding).filter((item) => item.defSessionId === session.defSessionId)
      : [];
    const questions = this.#projectQuestions(events, pending);
    const run = this.#runFor(session);
    this.#writeJson(response, 200, {
      ok: true,
      protocol: DEF_CODEX_INTEROP_PROTOCOL,
      protocolVersion: DEF_CODEX_INTEROP_PROTOCOL_VERSION,
      source: 'DefAgentHost.eventJournal',
      testRunId: run.testRunId,
      sessionId: session.defSessionId,
      questions,
    });
  }

  async #eventSubscription(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    session: DefSessionV6 | null,
    uiOnly: boolean,
  ): Promise<void> {
    this.#observeConsumer();
    const after = parseCursor(url.searchParams.get('cursor') ?? url.searchParams.get('from') ?? '0', 'cursor');
    const limit = parseLimit(url.searchParams.get('limit') ?? '256');
    const stream = String(request.headers.accept || '').includes('text/event-stream')
      || url.searchParams.get('stream') === '1';
    if (stream) {
      await this.#streamEvents(request, response, session, uiOnly, after, limit);
      return;
    }
    const page = uiOnly
      ? this.#readUiEventPage(after, limit)
      : this.#readSessionEventPage(session!, after, limit);
    const run = session ? this.#runFor(session) : null;
    this.#writeJson(response, 200, {
      ok: true,
      protocol: DEF_CODEX_INTEROP_PROTOCOL,
      protocolVersion: DEF_CODEX_INTEROP_PROTOCOL_VERSION,
      ...(session ? {
        testRunId: run!.testRunId,
        sessionId: session.defSessionId,
        defSessionId: session.defSessionId,
      } : {}),
      afterSequence: after,
      nextSequence: page.nextSequence,
      hasMore: page.hasMore,
      gap: page.gap,
      events: page.events,
    });
  }

  async #streamEvents(
    request: IncomingMessage,
    response: ServerResponse,
    session: DefSessionV6 | null,
    uiOnly: boolean,
    initialCursor: number,
    limit: number,
  ): Promise<void> {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let cursor = initialCursor;
    let closed = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let resolveClosed!: () => void;
    const closedPromise = new Promise<void>((resolve) => { resolveClosed = resolve; });
    const close = (): void => {
      if (closed) return;
      closed = true;
      if (interval) clearInterval(interval);
      if (timeout) clearTimeout(timeout);
      resolveClosed();
    };
    request.once('aborted', close);
    response.once('close', close);
    const write = (eventName: string, payload: unknown): void => {
      if (closed || response.destroyed) return;
      response.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
    };
    const page = uiOnly
      ? this.#readUiEventPage(cursor, limit)
      : this.#readSessionEventPage(session!, cursor, limit);
    const earliest = uiOnly ? this.#uiEvents[0]?.sequence ?? this.#uiSequence : this.#readAllEvents(session!).at(0)?.sequence ?? 0;
    write('ready', {
      protocol: DEF_CODEX_INTEROP_PROTOCOL,
      protocolVersion: DEF_CODEX_INTEROP_PROTOCOL_VERSION,
      headCursor: String(uiOnly ? this.#uiSequence : this.#readAllEvents(session!).at(-1)?.sequence ?? 0),
      earliestCursor: String(earliest),
      gap: page.gap,
    });
    for (const event of page.events) {
      write(event.type, event);
      cursor = event.sequence;
    }
    if (page.events.some((event) => isInteropTerminalEvent(event))) {
      response.end();
      close();
      return;
    }
    const poll = (): void => {
      if (closed) return;
      try {
        const nextPage = uiOnly
          ? this.#readUiEventPage(cursor, limit)
          : this.#readSessionEventPage(session!, cursor, limit);
        for (const event of nextPage.events) {
          write(event.type, event);
          cursor = event.sequence;
        }
        if (nextPage.events.some((event) => isInteropTerminalEvent(event))) {
          response.end();
          close();
        }
      } catch (error) {
        write('error', this.#errorPayload(error));
        response.end();
        close();
      }
    };
    interval = setInterval(poll, SSE_POLL_MS);
    timeout = setTimeout(() => {
      if (!closed) response.end();
      close();
    }, this.#streamTtlMs);
    timeout.unref?.();
    await closedPromise;
    request.off('aborted', close);
    response.off('close', close);
  }

  #readSessionEventPage(
    session: DefSessionV6,
    after: number,
    limit: number,
  ): { readonly events: readonly InteropEventEnvelope[]; readonly nextSequence: number; readonly hasMore: boolean; readonly gap: boolean } {
    const raw = this.#host.readEvents(asDefSessionId(session.defSessionId), after, limit);
    const first = this.#host.readEvents(asDefSessionId(session.defSessionId), 0, 1)[0]?.sequence ?? 0;
    const clientTurnIds = new Map<string, string>();
    for (const event of this.#readAllEvents(session)) {
      if (event.type === 'turn.accepted') clientTurnIds.set(event.defTurnId, event.payload.clientTurnId);
    }
    const events = raw.map((event) => {
      const correlation = event as DefEvent & { readonly defTurnId?: string };
      return toInteropEvent(event, clientTurnIds.get(correlation.defTurnId ?? '') ?? '');
    });
    const nextSequence = events.at(-1)?.sequence ?? after;
    const hasMore = this.#host.readEvents(asDefSessionId(session.defSessionId), nextSequence, 1).length > 0;
    return { events, nextSequence, hasMore, gap: after > 0 && first > 0 && after < first - 1 };
  }

  #readUiEventPage(
    after: number,
    limit: number,
  ): { readonly events: readonly UiInteropEvent[]; readonly nextSequence: number; readonly hasMore: boolean; readonly gap: boolean } {
    this.#observeConsumer();
    const first = this.#uiEvents[0]?.sequence ?? 0;
    const events = this.#uiEvents.filter((event) => event.sequence > after).slice(0, limit);
    const nextSequence = events.at(-1)?.sequence ?? after;
    const hasMore = this.#uiEvents.some((event) => event.sequence > nextSequence);
    return { events, nextSequence, hasMore, gap: after > 0 && first > 0 && after < first - 1 };
  }

  #readAllEvents(session: DefSessionV6): DefEvent[] {
    const events: DefEvent[] = [];
    let cursor = 0;
    for (let pageIndex = 0; pageIndex < MAX_EVENT_PAGES; pageIndex += 1) {
      const page = this.#host.readEvents(asDefSessionId(session.defSessionId), cursor, MAX_EVENT_PAGE);
      events.push(...page);
      if (page.length < MAX_EVENT_PAGE) break;
      const next = page.at(-1)?.sequence ?? cursor;
      if (next <= cursor) break;
      cursor = next;
    }
    return events;
  }

  #resolveSession(sessionId: string | null): DefSessionV6 {
    this.#observeConsumer();
    const consumer = this.#consumers.current();
    if (!consumer) {
      throw this.#error(
        409,
        'ui-consumer-unavailable',
        'No current visible DEF OpenCode Workbench consumer is registered.',
        'ui-consumer',
        true,
        sessionId ? { sessionId } : undefined,
        'Open Workbench AI mode and wait for DEF OpenCode ready before using Interop.',
      );
    }
    const sessions = this.#host.listSessions(consumer.binding);
    if (sessionId) {
      const match = sessions.find((session) => (
        session.defSessionId === sessionId || session.engine.sessionId === sessionId
      ));
      if (match) return match;
      throw this.#error(404, 'interop-session-not-found', 'No DEF Session is bound to the current Workbench consumer.', 'session', false, { sessionId });
    }
    const activeId = this.#host.getActiveIds().defSessionId;
    const active = sessions.find((session) => session.defSessionId === activeId);
    if (active) return active;
    const latest = sessions[0];
    if (latest) return latest;
    throw this.#error(
      409,
      'ui-session-unavailable',
      'The current Workbench consumer has no DEF Session yet.',
      'ui-consumer',
      true,
      undefined,
      'Open the native DEF OpenCode UI and wait for its Session to be created.',
    );
  }

  #activeSession(consumer: ConsumerState): DefSessionV6 | null {
    if (!consumer) return null;
    const activeId = this.#host.getActiveIds().defSessionId;
    return this.#host.listSessions(consumer.binding).find((session) => session.defSessionId === activeId)
      ?? this.#host.listSessions(consumer.binding)[0]
      ?? null;
  }

  #runFor(session: DefSessionV6): RunState {
    const existing = this.#runs.get(session.defSessionId);
    if (existing) return existing;
    const run: RunState = {
      testRunId: `interop-run-${randomUUID()}`,
      defSessionId: session.defSessionId,
      createdAt: new Date(this.#clock()).toISOString(),
      turns: new Map(),
    };
    this.#runs.set(session.defSessionId, run);
    return run;
  }

  #projectTurns(events: readonly DefEvent[], run: RunState): TurnProjection[] {
    const turns = new Map<string, TurnProjection>();
    for (const event of events) {
      const correlation = event as DefEvent & { readonly defTurnId?: string };
      if (!correlation.defTurnId) continue;
      let turn = turns.get(correlation.defTurnId);
      if (!turn) {
        const metadata = run.turns.get(correlation.defTurnId);
        turn = {
          defTurnId: correlation.defTurnId,
          firstSequence: event.sequence,
          events: [],
          clientTurnId: metadata?.clientTurnId ?? '',
          rawUserText: metadata?.rawUserText ?? '',
          firstTokenAt: null,
          terminal: null,
          tools: new Map(),
          failures: [],
        };
        turns.set(correlation.defTurnId, turn);
      }
      turn.events.push(event);
      if (event.type === 'turn.accepted') {
        turn.clientTurnId = event.payload.clientTurnId;
        turn.rawUserText = event.payload.userMessage;
      } else if (event.type === 'response.first-token') {
        turn.firstTokenAt = event.occurredAt;
      } else if (event.type === 'tool.requested') {
        turn.tools.set(event.toolCallId, {
          toolCallId: event.toolCallId,
          name: event.payload.name,
          input: safeInteropValue(event.payload.input),
          status: 'requested',
          sequence: event.sequence,
        });
      } else if (event.type === 'tool.started') {
        const current = turn.tools.get(event.toolCallId) ?? {
          toolCallId: event.toolCallId,
          name: event.payload.name,
          input: null,
          status: 'requested' as const,
          sequence: event.sequence,
        };
        current.name = event.payload.name;
        current.status = 'running';
        turn.tools.set(event.toolCallId, current);
      } else if (event.type === 'tool.result') {
        const current = turn.tools.get(event.toolCallId) ?? {
          toolCallId: event.toolCallId,
          name: 'native-tool',
          input: null,
          status: 'requested' as const,
          sequence: event.sequence,
        };
        current.status = 'completed';
        current.result = safeInteropValue(event.payload.result);
        turn.tools.set(event.toolCallId, current);
      } else if (event.type === 'tool.error') {
        const current = turn.tools.get(event.toolCallId) ?? {
          toolCallId: event.toolCallId,
          name: 'native-tool',
          input: null,
          status: 'requested' as const,
          sequence: event.sequence,
        };
        current.status = 'error';
        current.error = safeInteropValue({
          code: event.payload.code,
          message: event.payload.message,
          ...(event.payload.details === undefined ? {} : { details: event.payload.details }),
        });
        turn.tools.set(event.toolCallId, current);
        turn.failures.push(current.error);
      } else if (event.type === 'turn.failed' || event.type === 'turn.stopped' || event.type === 'turn.interrupted') {
        turn.terminal = event;
        turn.failures.push(safeInteropValue(event.payload));
      } else if (event.type === 'turn.completed') {
        turn.terminal = event;
      }
    }
    return [...turns.values()].sort((left, right) => left.firstSequence - right.firstSequence);
  }

  #turnSummary(turn: TurnProjection, run: RunState): JsonValue {
    const terminal = turn.terminal;
    const status = terminal ? terminalStatus(terminal) : 'accepted';
    const metadata = run.turns.get(turn.defTurnId);
    return safeInteropValue({
      testRunId: run.testRunId,
      turnId: turn.defTurnId,
      defTurnId: turn.defTurnId,
      clientTurnId: turn.clientTurnId,
      ingressMode: metadata?.ingressMode ?? 'pure-blackbox',
      rawUserText: turn.rawUserText,
      providerVisibleUserText: turn.rawUserText,
      status,
      state: terminal ? 'terminal' : 'running',
      acceptedAt: turn.events.find((event) => event.type === 'turn.accepted')?.occurredAt ?? null,
      firstTokenAt: turn.firstTokenAt,
      completedAt: terminal?.occurredAt ?? null,
      tools: [...turn.tools.values()].map((tool) => safeInteropValue(tool)),
      failures: turn.failures,
      ...(metadata?.diagnostic ? { diagnostic: safeInteropValue(metadata.diagnostic) } : {}),
    });
  }

  #projectTranscriptMessages(turn: TurnProjection): readonly JsonValue[] {
    const accepted = turn.events.find((event) => event.type === 'turn.accepted');
    if (!accepted || accepted.type !== 'turn.accepted') return [];
    const userId = `msg_def_user_${turn.defTurnId}`;
    const assistantId = `msg_def_assistant_${turn.defTurnId}`;
    const createdAt = Date.parse(accepted.occurredAt);
    const text = turn.events
      .filter((event): event is Extract<DefEvent, { type: 'response.delta' }> => event.type === 'response.delta')
      .map((event) => event.payload.delta)
      .join('');
    const parts: JsonValue[] = text ? [{ type: 'text', text: safeInteropValue(text) }] : [];
    for (const tool of turn.tools.values()) {
      parts.push(safeInteropValue({
        type: 'tool',
        callID: tool.toolCallId,
        tool: tool.name,
        state: {
          status: tool.status === 'completed' ? 'completed' : tool.status === 'error' ? 'error' : tool.status,
          input: tool.input,
          ...(tool.result === undefined ? {} : { output: tool.result }),
          ...(tool.error === undefined ? {} : { error: tool.error }),
        },
      }));
    }
    const terminal = turn.terminal;
    const assistantInfo: Record<string, unknown> = {
      id: assistantId,
      role: 'assistant',
      parentID: userId,
      time: {
        created: Number.isFinite(createdAt) ? createdAt : this.#clock(),
        ...(terminal ? { completed: Date.parse(terminal.occurredAt) } : {}),
      },
    };
    if (terminal?.type === 'turn.failed' || terminal?.type === 'turn.stopped' || terminal?.type === 'turn.interrupted') {
      assistantInfo.error = safeInteropValue(terminal.payload);
    }
    return [
      safeInteropValue({
        info: {
          id: userId,
          role: 'user',
          time: { created: Number.isFinite(createdAt) ? createdAt : this.#clock() },
        },
        defTurnId: turn.defTurnId,
        parts: [{ type: 'text', text: safeInteropValue(turn.rawUserText) }],
      }),
      safeInteropValue({
        info: assistantInfo,
        defTurnId: turn.defTurnId,
        parts,
      }),
    ];
  }

  #projectQuestions(
    events: readonly DefEvent[],
    pending: readonly InteractionRequest[],
  ): readonly JsonValue[] {
    const records = new Map<string, {
      interactionId: string;
      defTurnId: string;
      kind: 'question' | 'approval';
      prompt: string;
      status: string;
      createdAt: string;
      updatedAt: string;
      value?: JsonValue;
      request?: InteractionRequest;
    }>();
    for (const event of events) {
      if (event.type === 'interaction.requested') {
        records.set(event.interactionId, {
          interactionId: event.interactionId,
          defTurnId: event.defTurnId,
          kind: event.payload.kind,
          prompt: event.payload.prompt,
          status: 'pending',
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt,
        });
      } else if (event.type === 'interaction.resolved') {
        const current = records.get(event.interactionId) ?? {
          interactionId: event.interactionId,
          defTurnId: event.defTurnId,
          kind: 'question' as const,
          prompt: '',
          status: 'pending',
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt,
        };
        current.status = event.payload.status;
        current.updatedAt = event.occurredAt;
        if (event.payload.value !== undefined) current.value = safeInteropValue(event.payload.value);
        records.set(event.interactionId, current);
      }
    }
    for (const request of pending) {
      const current = records.get(request.interactionId) ?? {
        interactionId: request.interactionId,
        defTurnId: request.defTurnId,
        kind: request.kind,
        prompt: request.prompt,
        status: 'pending',
        createdAt: request.createdAt,
        updatedAt: request.createdAt,
      };
      current.kind = request.kind;
      current.prompt = request.prompt;
      current.request = request;
      current.status = 'pending';
      current.updatedAt = new Date(this.#clock()).toISOString();
      records.set(request.interactionId, current);
    }
    return [...records.values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((record) => {
        const request = record.request;
        const isPending = record.status === 'pending';
        const details = request?.kind === 'question' ? request.details : undefined;
        const options = objectValue(details, 'options');
        const optionValues = Array.isArray(options)
          ? options.filter((option): option is string => typeof option === 'string').slice(0, 8)
          : [];
        return safeInteropValue({
          requestId: record.interactionId,
          interactionId: record.interactionId,
          defTurnId: record.defTurnId,
          turnId: record.defTurnId,
          kind: record.kind,
          status: isPending ? 'open' : record.status,
          interactionStatus: record.status,
          runtimeStatus: isPending ? 'pending' : 'resolved',
          prompt: record.prompt,
          questions: record.kind === 'question' ? [{
            header: '需要回答',
            question: record.prompt,
            options: optionValues.map((label) => ({ label, description: '' })),
            multiple: false,
            custom: true,
          }] : [],
          answers: record.status === 'answered' && record.value !== undefined ? [[record.value]] : [],
          ...(record.kind === 'approval' && request?.kind === 'approval' ? {
            approval: {
              proposal: safeInteropValue(request.proposal),
              proposalHash: request.proposalHash,
              scope: safeInteropValue(request.scope),
              binding: safeInteropValue(request.binding),
            },
          } : {}),
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          expiresAt: request?.expiresAt ?? null,
        });
      });
  }

  #observeConsumer(): void {
    const current = this.#consumers.current();
    const previous = this.#lastConsumer;
    const sameIdentity = previous && current
      && previous.consumerId === current.consumerId
      && previous.executorLeaseId === current.executorLeaseId;
    if (!previous && current) {
      this.#appendUiEvent('ui-session-opened', current);
    } else if (previous && !current) {
      this.#appendUiEvent('ui-session-closed', previous);
    } else if (sameIdentity && previous && current && !sameBinding(previous.binding, current.binding)) {
      this.#appendUiEvent('ui-session-binding-changed', current);
    }
    this.#lastConsumer = current ? structuredClone(current) : null;
  }

  #appendUiEvent(type: UiInteropEvent['type'], consumer: NonNullable<ConsumerState>): void {
    const active = this.#host.getActiveIds();
    const event: UiInteropEvent = {
      protocol: DEF_CODEX_INTEROP_PROTOCOL,
      protocolVersion: DEF_CODEX_INTEROP_PROTOCOL_VERSION,
      cursor: String(++this.#uiSequence),
      sequence: this.#uiSequence,
      at: new Date(this.#clock()).toISOString(),
      type,
      sessionId: active.defSessionId,
      payload: safeInteropValue({
        uiConsumerId: consumer.consumerId,
        executorLeaseId: consumer.executorLeaseId,
        binding: consumer.binding,
      }),
    } as UiInteropEvent;
    this.#uiEvents.push(event);
    if (this.#uiEvents.length > 256) this.#uiEvents.splice(0, this.#uiEvents.length - 256);
  }

  async #readSnapshot(consumer: ConsumerState): Promise<ProductSnapshotEnvelope | null> {
    if (!consumer) return null;
    try {
      return await this.#gateway.getSnapshot(consumer.binding);
    } catch {
      return null;
    }
  }

  #sessionEnvelope(session: DefSessionV6): { readonly session: JsonValue } {
    const { engine, ...product } = session;
    return {
      session: safeInteropValue({
        ...product,
        sessionId: session.defSessionId,
        defSessionId: session.defSessionId,
        engineSessionId: engine.sessionId,
        engine: { kind: engine.kind, runtimeVersion: engine.runtimeVersion },
      }),
    };
  }

  #links(defSessionId: string): Readonly<Record<string, string>> {
    const encoded = encodeURIComponent(defSessionId);
    return {
      events: `${DEF_CODEX_INTEROP_PATH}/sessions/${encoded}/events`,
      transcript: `${DEF_CODEX_INTEROP_PATH}/sessions/${encoded}/transcript`,
      questions: `${DEF_CODEX_INTEROP_PATH}/sessions/${encoded}/questions`,
      state: `${DEF_CODEX_INTEROP_PATH}/state`,
      uiEvents: `${DEF_CODEX_INTEROP_PATH}/ui-events`,
    };
  }

  #tokensSweep(): void {
    const now = this.#clock();
    for (const [token, expiresAt] of this.#tokens) {
      if (expiresAt <= now) this.#tokens.delete(token);
    }
  }

  async #readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_REQUEST_BYTES) {
        throw this.#error(413, 'request-too-large', 'Interop request body is too large.', 'protocol');
      }
      chunks.push(buffer);
    }
    if (!chunks.length) return {};
    let value: unknown;
    try {
      value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw this.#error(400, 'invalid-json', 'Interop request body must be valid JSON.', 'protocol');
    }
    if (!isRecord(value)) throw this.#error(400, 'invalid-request', 'Interop request body must be an object.', 'protocol');
    return value;
  }

  #error(
    statusCode: number,
    code: string,
    message: string,
    component: string,
    retryable = false,
    ids?: Readonly<Record<string, string>>,
    nextAction?: string,
  ): InteropRouteError {
    return new InteropRouteError(statusCode, {
      code,
      message,
      component,
      retryable,
      ...(ids ? { ids } : {}),
      ...(nextAction ? { nextAction } : {}),
    });
  }

  #errorPayload(error: unknown): InteropErrorBody {
    if (error instanceof InteropRouteError) return error.body;
    if (error instanceof DefAgentHostError) {
      return {
        code: error.code,
        message: error.message,
        component: 'agent-host',
        retryable: error.statusCode >= 500 || error.statusCode === 409,
      };
    }
    return {
      code: 'interop-internal-error',
      message: 'DEF Interop request failed.',
      component: 'interop',
      retryable: true,
    };
  }

  #writeError(response: ServerResponse, error: unknown): void {
    if (response.headersSent || response.destroyed) return;
    const known = this.#errorPayload(error);
    const statusCode = error instanceof InteropRouteError
      ? error.statusCode
      : error instanceof DefAgentHostError
        ? error.statusCode
        : 500;
    this.#writeJson(response, statusCode, {
      ok: false,
      protocol: DEF_CODEX_INTEROP_PROTOCOL,
      protocolVersion: DEF_CODEX_INTEROP_PROTOCOL_VERSION,
      error: known,
    });
  }

  #writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
    if (response.headersSent || response.destroyed) return;
    const encoded = Buffer.from(JSON.stringify(value));
    response.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': encoded.length,
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(encoded);
  }
}

function normalizeRoute(pathname: string): string | null {
  if (pathname === DEF_CODEX_INTEROP_PATH) return '';
  if (pathname.startsWith(`${DEF_CODEX_INTEROP_PATH}/`)) {
    return pathname.slice(`${DEF_CODEX_INTEROP_PATH}/`.length);
  }
  if (pathname === DEF_CODEX_INTEROP_COMPATIBILITY_PATH) return 'workbench-test/prompt';
  return null;
}

function normalizeTurnRequest(
  body: Record<string, unknown>,
  continuation: boolean,
): {
  readonly rawUserText: string;
  readonly clientTurnId: string;
  readonly sessionId: string | null;
  readonly ingressMode: 'pure-blackbox' | 'diagnostic';
  readonly diagnostic?: Readonly<Record<string, unknown>>;
} {
  if (body.harnessSelector !== undefined) {
    throw new InteropRouteError(410, {
      code: 'legacy-harness-selector-retired',
      message: 'Global Harness selection is retired; the current Manager pins an active Revision per business Turn.',
      component: 'protocol',
      retryable: false,
    });
  }
  const rawUserText = typeof body.rawUserText === 'string'
    ? body.rawUserText.trim()
    : typeof body.message === 'string'
      ? body.message.trim()
      : typeof body.prompt === 'string'
        ? body.prompt.trim()
        : '';
  if (!rawUserText) {
    throw new InteropRouteError(400, {
      code: 'missing-user-text',
      message: 'rawUserText must be a non-empty string.',
      component: 'protocol',
      retryable: false,
    });
  }
  if (rawUserText.length > 16_000) {
    throw new InteropRouteError(400, {
      code: 'user-text-too-large',
      message: 'rawUserText must contain at most 16000 characters.',
      component: 'protocol',
      retryable: false,
    });
  }
  const providerVisibleUserText = body.providerVisibleUserText;
  if (providerVisibleUserText !== undefined && providerVisibleUserText !== rawUserText) {
    throw new InteropRouteError(400, {
      code: 'provider-visible-text-mismatch',
      message: 'rawUserText and providerVisibleUserText must be identical for Pure Blackbox turns.',
      component: 'protocol',
      retryable: false,
    });
  }
  const clientTurnId = typeof body.clientTurnId === 'string' ? body.clientTurnId.trim() : '';
  if (!CLIENT_TURN_ID.test(clientTurnId)) {
    throw new InteropRouteError(400, {
      code: 'invalid-client-turn-id',
      message: 'clientTurnId must be 1-128 URL-safe identifier characters.',
      component: 'protocol',
      retryable: false,
    });
  }
  const sessionValue = body.sessionId;
  if (sessionValue !== undefined && typeof sessionValue !== 'string') {
    throw new InteropRouteError(400, {
      code: 'invalid-session-id',
      message: 'sessionId must be a string when present.',
      component: 'protocol',
      retryable: false,
    });
  }
  const sessionId = typeof sessionValue === 'string' && sessionValue.trim() ? sessionValue.trim() : null;
  if (continuation && !sessionId) {
    throw new InteropRouteError(400, {
      code: 'missing-session-id',
      message: 'A continuation Turn must identify its Session in the route.',
      component: 'protocol',
      retryable: false,
    });
  }
  const ingressMode = body.ingressMode === undefined ? 'pure-blackbox' : body.ingressMode;
  if (ingressMode !== 'pure-blackbox' && ingressMode !== 'diagnostic') {
    throw new InteropRouteError(400, {
      code: 'invalid-ingress-mode',
      message: 'ingressMode must be pure-blackbox or diagnostic.',
      component: 'protocol',
      retryable: false,
    });
  }
  let diagnostic: Readonly<Record<string, unknown>> | undefined;
  if (ingressMode === 'diagnostic') {
    if (!isRecord(body.diagnostic) || typeof body.diagnostic.purpose !== 'string' || !body.diagnostic.purpose.trim()) {
      throw new InteropRouteError(400, {
        code: 'invalid-diagnostic-request',
        message: 'Diagnostic turns require diagnostic.purpose.',
        component: 'protocol',
        retryable: false,
      });
    }
    diagnostic = {
      purpose: body.diagnostic.purpose.trim().slice(0, 240),
      ...(typeof body.diagnostic.scope === 'string' ? { scope: body.diagnostic.scope.trim().slice(0, 240) } : {}),
      ...(body.diagnostic.mutationAllowed === true ? { mutationAllowed: true } : {}),
    };
  }
  return {
    rawUserText,
    clientTurnId,
    sessionId,
    ingressMode,
    ...(diagnostic ? { diagnostic } : {}),
  };
}

function toInteropEvent(event: DefEvent, clientTurnId: string): InteropEventEnvelope {
  const correlation = event as DefEvent & {
    readonly defTurnId?: string;
    readonly toolCallId?: string;
    readonly interactionId?: string;
    readonly commandId?: string;
  };
  return toEventEnvelope({
    protocol: DEF_CODEX_INTEROP_PROTOCOL,
    protocolVersion: DEF_CODEX_INTEROP_PROTOCOL_VERSION,
    cursor: String(event.sequence),
    sequence: event.sequence,
    at: event.occurredAt,
    type: event.type,
    legacyType: legacyEventType(event.type),
    sessionId: event.defSessionId,
    defSessionId: event.defSessionId,
    ...(correlation.defTurnId ? { turnId: correlation.defTurnId, defTurnId: correlation.defTurnId } : {}),
    ...(clientTurnId ? { clientTurnId } : {}),
    ...(correlation.toolCallId ? { toolCallId: correlation.toolCallId } : {}),
    ...(correlation.interactionId ? { interactionId: correlation.interactionId } : {}),
    ...(correlation.commandId ? { commandId: correlation.commandId } : {}),
    payload: safeInteropValue(event.payload),
  });
}

function toEventEnvelope(value: Record<string, unknown>): InteropEventEnvelope {
  return value as InteropEventEnvelope;
}

function legacyEventType(type: DefEvent['type']): string {
  const aliases: Partial<Record<DefEvent['type'], string>> = {
    'turn.accepted': 'accepted',
    'response.first-token': 'response-first-token',
    'response.delta': 'response-delta',
    'tool.requested': 'tool-requested',
    'tool.started': 'tool-start',
    'tool.result': 'tool-result',
    'tool.error': 'tool-error',
    'interaction.requested': 'permission',
    'interaction.resolved': 'permission-resolved',
    'turn.completed': 'completed',
    'turn.stopped': 'stopped',
    'turn.interrupted': 'interrupted',
    'turn.failed': 'provider-error',
  };
  return aliases[type] ?? type;
}

function isTerminalEvent(event: DefEvent): boolean {
  return event.type === 'turn.completed'
    || event.type === 'turn.stopped'
    || event.type === 'turn.interrupted'
    || event.type === 'turn.failed';
}

function isInteropTerminalEvent(event: Record<string, unknown>): boolean {
  return ['completed', 'stopped', 'interrupted', 'provider-error'].includes(String(event.legacyType));
}

function terminalStatus(event: DefEvent): string {
  if (event.type === 'turn.completed') return 'completed';
  if (event.type === 'turn.stopped') return 'stopped';
  if (event.type === 'turn.interrupted') return 'interrupted';
  return 'failed';
}

function projectSelectedOperators(payload: JsonObjectLike | null): readonly JsonValue[] {
  const value = objectValue(payload, 'selectedCharacters') ?? objectValue(payload, 'operators');
  if (!Array.isArray(value)) return [];
  return value.slice(0, 32).map((operator) => safeInteropValue({
    id: objectValue(operator, 'id') ?? '',
    name: objectValue(operator, 'name') ?? '',
  }));
}

type JsonObjectLike = Record<string, unknown>;

function objectValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function safeInteropValue(value: unknown, depth = 0): JsonValue {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return compactText(value);
  if (value === undefined) return null;
  if (depth >= 8) return compactText(value);
  if (Array.isArray(value)) return value.slice(0, 32).map((entry) => safeInteropValue(entry, depth + 1));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).slice(0, 64).map(([key, entry]) => [
      key,
      /(?:api[-_ ]?key|token|authorization|password|secret)/iu.test(key)
        ? '[redacted]'
        : safeInteropValue(entry, depth + 1),
    ]));
  }
  return compactText(value);
}

function compactText(value: unknown, limit = 8_000): string {
  const text = typeof value === 'string' ? value : (() => {
    try { return JSON.stringify(value ?? null); } catch { return String(value); }
  })();
  const redacted = String(text)
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/giu, 'Bearer [redacted]')
    .replace(/((?:api[-_ ]?key|token|authorization|password|secret)["'\s:=]+)[A-Za-z0-9._~+\/-]+/giu, '$1[redacted]');
  return redacted.length > limit ? `${redacted.slice(0, limit)}…` : redacted;
}

function sameBinding(left: ProductBinding, right: ProductBinding): boolean {
  return left.workspaceId === right.workspaceId
    && left.databaseGeneration === right.databaseGeneration
    && left.timelineId === right.timelineId
    && left.checkoutTargetId === right.checkoutTargetId
    && left.checkoutUpdatedAt === right.checkoutUpdatedAt
    && left.contentRevision === right.contentRevision
    && left.snapshotDigest === right.snapshotDigest;
}

function parseCursor(value: string, field: string): number {
  const result = Number(value || '0');
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new InteropRouteError(400, {
      code: 'invalid-cursor',
      message: `${field} must be a non-negative integer.`,
      component: 'protocol',
      retryable: false,
    });
  }
  return result;
}

function parseLimit(value: string): number {
  const result = Number(value || '256');
  if (!Number.isSafeInteger(result) || result < 1 || result > MAX_EVENT_PAGE) {
    throw new InteropRouteError(400, {
      code: 'invalid-limit',
      message: `limit must be an integer between 1 and ${MAX_EVENT_PAGE}.`,
      component: 'protocol',
      retryable: false,
    });
  }
  return result;
}

function decodeRouteId(value: string, field: string): string {
  let decoded = '';
  try { decoded = decodeURIComponent(value).trim(); } catch { /* handled below */ }
  if (!PORTABLE_ID.test(decoded)) {
    throw new InteropRouteError(400, {
      code: 'invalid-route-id',
      message: `${field} is not a portable identifier.`,
      component: 'protocol',
      retryable: false,
    });
  }
  return decoded;
}

function isDevelopmentProfile(value: string | undefined): boolean {
  return !['production', 'release'].includes(String(value || '').toLowerCase());
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function isSecureToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{20,200}$/u.test(value);
}

function isLoopbackHost(value: string): boolean {
  return value === '127.0.0.1' || value === 'localhost' || value === '::1';
}

function isLoopbackOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && isLoopbackHost(url.hostname.toLowerCase().replace(/^\[|\]$/gu, ''));
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
