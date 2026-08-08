import { createReadStream, lstatSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, relative, resolve, sep } from 'node:path';
import {
  AGENT_UI_CAPABILITY_HEADER,
  DEF_AGENT_PROTOCOL_VERSION,
  asClientTurnId,
  asDefSessionId,
  asDefTurnId,
  asInteractionId,
  parseConversationCursor,
  type AgentLaunchAudience,
  type AgentProductSession,
  type BrowserWorkbenchConsumerState,
  type ClientTurnId,
  type ConversationCursor,
  type ConversationEvent,
  type ConversationSnapshot,
  type DefSessionId,
  type DefSessionV6,
  type DefTurnId,
  type InteractionId,
  type InteractionRequest,
  type InteractionResponse,
  type JsonObject,
  type JsonValue,
  type ProductBinding,
} from '../core/contracts/index.ts';
import {
  assertConversationEvent,
  assertConversationEventTransition,
  assertConversationSnapshot,
} from '../core/contracts/conversation.ts';
import { BrowserConsumerRegistry } from './browser-consumer-registry.ts';
import { DefAgentHostError } from './errors.ts';
import { AgentTokenAuthority, type AgentUiCapabilityClaims } from './token-authority.ts';

/**
 * The browser-facing DEF Conversation API.  This is intentionally a port and
 * not a Host implementation: P7 can connect these methods to DefAgentHost,
 * Runtime and ConversationProjector without moving Session state here.
 */
export interface AgentUiGatewayPort {
  listSessions(binding: ProductBinding): readonly DefSessionV6[] | Promise<readonly DefSessionV6[]>;
  readSession(defSessionId: DefSessionId, binding: ProductBinding): DefSessionV6 | Promise<DefSessionV6>;
  createSession(input: {
    readonly binding: ProductBinding;
    readonly providerProfileRef: string;
  }): Promise<DefSessionV6>;
  startTurn(input: AgentUiGatewayStartTurnInput): Promise<AgentUiGatewayTurnStartResult>;
  stopTurn(input: AgentUiGatewayStopTurnInput): Promise<void>;
  archiveSession(defSessionId: DefSessionId, binding: ProductBinding): DefSessionV6 | Promise<DefSessionV6>;
  deleteSession(defSessionId: DefSessionId, binding: ProductBinding): Promise<void>;
  getSnapshot(defSessionId: DefSessionId): Promise<ConversationSnapshot>;
  subscribe(
    defSessionId: DefSessionId,
    cursor: ConversationCursor,
    signal?: AbortSignal,
  ): AsyncIterable<ConversationEvent>;
  listPendingInteractions(binding: ProductBinding): readonly InteractionRequest[] | Promise<readonly InteractionRequest[]>;
  resolveInteraction(
    interactionId: InteractionId,
    input: AgentUiInteractionInput,
    binding: ProductBinding,
  ): InteractionResponse | Promise<InteractionResponse>;
}

export interface AgentUiGatewayStartTurnInput {
  readonly defSessionId: DefSessionId;
  readonly clientTurnId: ClientTurnId;
  readonly userMessage: string;
  readonly binding: ProductBinding;
}

export interface AgentUiGatewayTurnStartResult {
  readonly defTurnId: DefTurnId;
  readonly clientTurnId: ClientTurnId;
}

export interface AgentUiGatewayStopTurnInput {
  readonly defSessionId: DefSessionId;
  readonly defTurnId: DefTurnId;
  readonly binding: ProductBinding;
}

export interface AgentUiInteractionInput {
  readonly status: Exclude<InteractionResponse['status'], 'pending'>;
  readonly value?: JsonValue;
}

export interface AgentUiGatewayOptions {
  readonly uiRoot: string;
  readonly browserOrigin: string;
  readonly port: AgentUiGatewayPort;
  readonly tokens: Pick<AgentTokenAuthority, 'exchangeLaunchGrant' | 'validateCapability'>;
  readonly consumers: Pick<BrowserConsumerRegistry, 'currentFor' | 'requireActive'>;
  /** Defaults to `/agent-ui`; the path is part of the gateway contract. */
  readonly basePath?: string;
  /**
   * Exact additional files allowed below `uiRoot`.  When omitted, only the
   * entry point and files below the explicit `assets/` prefix are served.
   */
  readonly staticFiles?: readonly string[];
  readonly audience?: AgentLaunchAudience;
  readonly consumerPollIntervalMs?: number;
  readonly diagnostic?: (message: string) => void;
}

export const AGENT_UI_GATEWAY_BASE_PATH = '/agent-ui' as const;
export const AGENT_UI_GATEWAY_CURSOR_VERSION = 'c1' as const;

const BROWSER_ORIGIN_HEADER = 'x-dmg-agent-browser-origin';
const MAX_REQUEST_BYTES = 1 * 1_024 * 1_024;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_MESSAGE_CODE_UNITS = 16_000;
const MAX_CURSOR_TOKEN_LENGTH = 1_024;
const DEFAULT_CONSUMER_POLL_INTERVAL_MS = 100;
const ITERATOR_CLOSE_TIMEOUT_MS = 250;

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

type GatewayErrorCode =
  | 'AGENT_UI_ROUTE_NOT_FOUND'
  | 'AGENT_UI_STATIC_NOT_READY'
  | 'AGENT_UI_STATIC_PATH_INVALID'
  | 'AGENT_UI_STATIC_PATH_NOT_FOUND'
  | 'AGENT_CONVERSATION_CURSOR_INVALID'
  | 'AGENT_CONVERSATION_CURSOR_REQUIRED'
  | 'AGENT_CONVERSATION_EVENT_INVALID'
  | 'AGENT_CONVERSATION_SESSION_MISMATCH'
  | 'AGENT_CONVERSATION_SOURCE_FAILED'
  | 'AGENT_INTERACTION_NOT_FOUND'
  | 'AGENT_REQUEST_INVALID'
  | 'AGENT_UI_INTERNAL_ERROR';

class AgentUiGatewayError extends Error {
  readonly code: GatewayErrorCode;
  readonly statusCode: number;

  constructor(code: GatewayErrorCode, message: string, statusCode: number) {
    super(message);
    this.name = 'AgentUiGatewayError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

type RequestAccess = {
  readonly claims: AgentUiCapabilityClaims;
  readonly consumer: BrowserWorkbenchConsumerState;
};

type ConversationIterator = AsyncIterator<ConversationEvent>;

/**
 * Encode the full P4 cursor as a versioned opaque transport token.  The
 * token is deliberately only an encoding: it is not a second authority or a
 * durable cursor store.
 */
export function encodeConversationCursor(cursor: ConversationCursor): string {
  const parsed = parseConversationCursor(cursor);
  const payload = JSON.stringify({
    cursor: parsed,
    version: AGENT_UI_GATEWAY_CURSOR_VERSION,
  });
  const token = `${AGENT_UI_GATEWAY_CURSOR_VERSION}.${Buffer.from(payload, 'utf8').toString('base64url')}`;
  if (token.length > MAX_CURSOR_TOKEN_LENGTH) {
    throw new AgentUiGatewayError('AGENT_CONVERSATION_CURSOR_INVALID', 'Conversation cursor is too large', 400);
  }
  return token;
}

/** Decode and fully validate a cursor supplied by query or Last-Event-ID. */
export function decodeConversationCursor(token: string): ConversationCursor {
  if (
    typeof token !== 'string'
    || token.length < 4
    || token.length > MAX_CURSOR_TOKEN_LENGTH
    || !token.startsWith(`${AGENT_UI_GATEWAY_CURSOR_VERSION}.`)
    || !/^c1\.[A-Za-z0-9_-]+$/u.test(token)
  ) {
    throw new AgentUiGatewayError('AGENT_CONVERSATION_CURSOR_INVALID', 'Conversation cursor token is invalid', 400);
  }
  let decoded: unknown;
  try {
    const encoded = token.slice(`${AGENT_UI_GATEWAY_CURSOR_VERSION}.`.length);
    decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new AgentUiGatewayError('AGENT_CONVERSATION_CURSOR_INVALID', 'Conversation cursor token is invalid', 400);
  }
  if (!isRecord(decoded) || Object.keys(decoded).sort().join(',') !== 'cursor,version' || decoded.version !== AGENT_UI_GATEWAY_CURSOR_VERSION) {
    throw new AgentUiGatewayError('AGENT_CONVERSATION_CURSOR_INVALID', 'Conversation cursor token is invalid', 400);
  }
  try {
    return parseConversationCursor(decoded.cursor);
  } catch {
    throw new AgentUiGatewayError('AGENT_CONVERSATION_CURSOR_INVALID', 'Conversation cursor token is invalid', 400);
  }
}

/**
 * Thin HTTP/SSE gateway for the independent Session Surface.
 *
 * It owns transport connections and validation only.  It does not cache
 * Sessions, prompts, transcript parts, interactions, or cursors.
 */
export class AgentUiGateway {
  readonly #uiRoot: string;
  readonly #indexPath: string;
  readonly #browserOrigin: string;
  readonly #basePath: string;
  readonly #port: AgentUiGatewayPort;
  readonly #tokens: Pick<AgentTokenAuthority, 'exchangeLaunchGrant' | 'validateCapability'>;
  readonly #consumers: Pick<BrowserConsumerRegistry, 'currentFor' | 'requireActive'>;
  readonly #audience: AgentLaunchAudience;
  readonly #staticFiles: ReadonlySet<string> | null;
  readonly #consumerPollIntervalMs: number;
  readonly #diagnostic: (message: string) => void;
  readonly #server: Server;
  readonly #activeStreams = new Set<AbortController>();
  #origin = '';
  #stopPromise: Promise<void> | null = null;
  #stopped = false;

  constructor(options: AgentUiGatewayOptions) {
    this.#uiRoot = resolve(options.uiRoot);
    this.#indexPath = resolve(this.#uiRoot, 'index.html');
    this.#browserOrigin = normalizeOrigin(options.browserOrigin);
    this.#basePath = normalizeBasePath(options.basePath ?? AGENT_UI_GATEWAY_BASE_PATH);
    this.#port = options.port;
    this.#tokens = options.tokens;
    this.#consumers = options.consumers;
    this.#audience = options.audience ?? 'workbench-ai-mode';
    this.#staticFiles = options.staticFiles
      ? new Set(options.staticFiles.map((file) => normalizeStaticRelativePath(file)))
      : null;
    this.#consumerPollIntervalMs = boundedPositiveInteger(
      options.consumerPollIntervalMs ?? DEFAULT_CONSUMER_POLL_INTERVAL_MS,
      'consumerPollIntervalMs',
      1,
      60_000,
    );
    this.#diagnostic = options.diagnostic ?? (() => undefined);
    this.#server = createServer((request, response) => {
      void this.#handle(request, response).catch((error: unknown) => this.#writeError(response, error));
    });
  }

  get origin(): string {
    if (!this.#origin) throw new Error('Agent UI Gateway is not listening');
    return this.#origin;
  }

  async listen(port = 0): Promise<number> {
    if (this.#stopped) throw new Error('Agent UI Gateway has been stopped');
    if (this.#server.listening) {
      const address = this.#server.address();
      if (!address || typeof address === 'string') throw new Error('Agent UI Gateway has no TCP address');
      return address.port;
    }
    assertUiRoot(this.#uiRoot, this.#indexPath);
    await new Promise<void>((resolveListen, reject) => {
      const onError = (error: Error): void => {
        this.#server.off('error', onError);
        reject(error);
      };
      this.#server.once('error', onError);
      this.#server.listen(port, '127.0.0.1', () => {
        this.#server.off('error', onError);
        resolveListen();
      });
    });
    const address = this.#server.address();
    if (!address || typeof address === 'string') throw new Error('Agent UI Gateway has no TCP address');
    this.#origin = `http://127.0.0.1:${address.port}`;
    return address.port;
  }

  /** Lifecycle alias used by the future Host assembly. */
  start(port = 0): Promise<number> {
    return this.listen(port);
  }

  async stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#stopped = true;
    this.#stopPromise = (async () => {
      for (const controller of this.#activeStreams) controller.abort();
      this.#activeStreams.clear();
      if (!this.#server.listening) return;
      await new Promise<void>((resolveClose, reject) => {
        this.#server.close((error) => error ? reject(error) : resolveClose());
        this.#server.closeAllConnections();
      });
      this.#origin = '';
    })();
    return this.#stopPromise;
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');

    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const requestOrigin = this.#requestOrigin(request);
    this.#setCors(response, this.#responseOrigin(request, requestOrigin));
    const route = this.#relativeRoute(url.pathname);

    if (request.method === 'OPTIONS') {
      this.#writeOptions(response);
      return;
    }
    if (route === null) throw gatewayError('AGENT_UI_ROUTE_NOT_FOUND', 'Agent UI route not found', 404);

    if (request.method === 'GET' || request.method === 'HEAD') {
      if (await this.#serveStatic(request, response, route)) return;
    }

    if (request.method === 'POST' && (route === 'auth/session' || route === 'session')) {
      await this.#exchangeGrant(request, response, requestOrigin);
      return;
    }

    if (!isPotentialApiRoute(route)) {
      throw gatewayError('AGENT_UI_ROUTE_NOT_FOUND', 'Agent UI route not found', 404);
    }

    const access = this.#authenticate(request, requestOrigin);
    await this.#handleApi(request, response, url, route, access);
  }

  async #handleApi(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    route: string,
    access: RequestAccess,
  ): Promise<void> {
    if (route === 'sessions' && request.method === 'GET') {
      const sessions = await this.#visibleSessions(access.consumer.binding);
      this.#writeJson(response, 200, {
        protocolVersion: DEF_AGENT_PROTOCOL_VERSION,
        sessions: sessions.map(toProductSession),
      });
      return;
    }

    if (route === 'sessions' && request.method === 'POST') {
      const body = await readJson(request);
      expectOnlyKeys(body, ['providerProfileRef']);
      const providerProfileRef = body.providerProfileRef === undefined
        ? 'default'
        : expectPortableId(body.providerProfileRef, 'providerProfileRef', 128);
      const session = await this.#port.createSession({
        binding: access.consumer.binding,
        providerProfileRef,
      });
      assertVisibleSession(session, access.consumer.binding);
      this.#writeJson(response, 201, {
        protocolVersion: DEF_AGENT_PROTOCOL_VERSION,
        session: toProductSession(session),
      });
      return;
    }

    if (route === 'interactions' && request.method === 'GET') {
      const interactions = await this.#visibleInteractions(access.consumer.binding);
      this.#writeJson(response, 200, {
        protocolVersion: DEF_AGENT_PROTOCOL_VERSION,
        interactions,
      });
      return;
    }

    const interactionMatch = /^interactions\/([^/]+)\/respond$/u.exec(route);
    if (interactionMatch && request.method === 'POST') {
      const interactionId = asInteractionId(decodeRouteId(interactionMatch[1]!, 'interactionId'));
      const visible = await this.#visibleInteractions(access.consumer.binding);
      if (!visible.some((interaction) => interaction.interactionId === interactionId)) {
        throw new DefAgentHostError('AGENT_INTERACTION_NOT_FOUND', `Interaction ${interactionId} does not exist`, 404);
      }
      const input = parseInteractionInput(await readJson(request));
      const resolved = await this.#port.resolveInteraction(interactionId, input, access.consumer.binding);
      if (resolved.interactionId !== interactionId) {
        throw gatewayError('AGENT_UI_INTERNAL_ERROR', 'Interaction response identity is invalid', 502);
      }
      this.#writeJson(response, 200, {
        protocolVersion: DEF_AGENT_PROTOCOL_VERSION,
        interactionId,
        response: resolved,
      });
      return;
    }

    const sessionMatch = /^sessions\/([^/]+)(?:\/(prompt|turns|stop|archive|conversation\/snapshot|conversation\/events))?$/u.exec(route);
    if (sessionMatch) {
      const defSessionId = asDefSessionId(decodeRouteId(sessionMatch[1]!, 'defSessionId'));
      const action = sessionMatch[2] ?? '';
      const session = await this.#requireVisibleSession(defSessionId, access.consumer.binding);

      if (request.method === 'GET' && action === '') {
        this.#writeJson(response, 200, {
          protocolVersion: DEF_AGENT_PROTOCOL_VERSION,
          session: toProductSession(session),
        });
        return;
      }

      if (request.method === 'POST' && (action === 'prompt' || action === 'turns')) {
        const body = await readJson(request);
        expectOnlyKeys(body, ['clientTurnId', 'userMessage']);
        const clientTurnId = asClientTurnId(expectPortableId(body.clientTurnId, 'clientTurnId', MAX_IDENTIFIER_LENGTH));
        const userMessage = expectBoundedMessage(body.userMessage);
        const turn = await this.#port.startTurn({
          defSessionId,
          clientTurnId,
          userMessage,
          binding: access.consumer.binding,
        });
        if (turn.clientTurnId !== clientTurnId) {
          throw gatewayError('AGENT_UI_INTERNAL_ERROR', 'Turn response identity is invalid', 502);
        }
        this.#writeJson(response, 202, {
          protocolVersion: DEF_AGENT_PROTOCOL_VERSION,
          defSessionId,
          ...turn,
        });
        return;
      }

      if (request.method === 'POST' && action === 'stop') {
        const body = await readJson(request);
        expectOnlyKeys(body, ['defTurnId']);
        const defTurnId = asDefTurnId(expectPortableId(body.defTurnId, 'defTurnId', MAX_IDENTIFIER_LENGTH));
        await this.#port.stopTurn({
          defSessionId,
          defTurnId,
          binding: access.consumer.binding,
        });
        this.#writeJson(response, 200, {
          protocolVersion: DEF_AGENT_PROTOCOL_VERSION,
          defSessionId,
          defTurnId,
          stopped: true,
        });
        return;
      }

      if (request.method === 'POST' && action === 'archive') {
        expectOnlyKeys(await readJson(request), []);
        const archived = await this.#port.archiveSession(defSessionId, access.consumer.binding);
        assertVisibleSession(archived, access.consumer.binding);
        this.#writeJson(response, 200, {
          protocolVersion: DEF_AGENT_PROTOCOL_VERSION,
          session: toProductSession(archived),
        });
        return;
      }

      if (request.method === 'DELETE' && action === '') {
        await this.#port.deleteSession(defSessionId, access.consumer.binding);
        this.#writeJson(response, 200, {
          protocolVersion: DEF_AGENT_PROTOCOL_VERSION,
          defSessionId,
          deleted: true,
        });
        return;
      }

      if (request.method === 'GET' && action === 'conversation/snapshot') {
        const snapshot = await this.#port.getSnapshot(defSessionId);
        try {
          assertConversationSnapshot(snapshot);
        } catch (error) {
          throw gatewayError(
            'AGENT_CONVERSATION_SOURCE_FAILED',
            `Conversation snapshot is invalid: ${error instanceof Error ? error.message : String(error)}`,
            502,
          );
        }
        if (snapshot.defSessionId !== defSessionId) {
          throw gatewayError('AGENT_CONVERSATION_SESSION_MISMATCH', 'Conversation snapshot belongs to another Session', 502);
        }
        this.#writeJson(response, 200, snapshot);
        return;
      }

      if (request.method === 'GET' && action === 'conversation/events') {
        await this.#streamConversation(request, response, url, defSessionId, access, session);
        return;
      }
    }

    throw gatewayError('AGENT_UI_ROUTE_NOT_FOUND', 'Agent UI route not found', 404);
  }

  async #exchangeGrant(
    request: IncomingMessage,
    response: ServerResponse,
    origin: string,
  ): Promise<void> {
    const body = await readJson(request);
    expectOnlyKeys(body, ['audience', 'launchGrant']);
    const audience = expectAudience(body.audience, this.#audience);
    const session = this.#tokens.exchangeLaunchGrant({
      grant: expectToken(body.launchGrant, 'launchGrant'),
      origin,
      audience,
    });
    this.#writeJson(response, 201, session);
  }

  #authenticate(request: IncomingMessage, origin: string): RequestAccess {
    const capability = readCapability(request);
    const claims = this.#tokens.validateCapability({
      capability,
      origin,
      audience: this.#audience,
    });
    const consumer = this.#consumers.requireActive(claims);
    return { claims, consumer };
  }

  async #visibleSessions(binding: ProductBinding): Promise<readonly DefSessionV6[]> {
    const sessions = await this.#port.listSessions(binding);
    return sessions.filter((session) => matchesProductBinding(session, binding));
  }

  async #requireVisibleSession(
    defSessionId: DefSessionId,
    binding: ProductBinding,
  ): Promise<DefSessionV6> {
    const session = await this.#port.readSession(defSessionId, binding);
    assertVisibleSession(session, binding);
    return session;
  }

  async #visibleInteractions(binding: ProductBinding): Promise<readonly InteractionRequest[]> {
    const [sessions, interactions] = await Promise.all([
      this.#visibleSessions(binding),
      this.#port.listPendingInteractions(binding),
    ]);
    const visibleIds = new Set(sessions.map((session) => session.defSessionId));
    return interactions.filter((interaction) => visibleIds.has(interaction.defSessionId));
  }

  async #streamConversation(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    defSessionId: DefSessionId,
    access: RequestAccess,
    _session: DefSessionV6,
  ): Promise<void> {
    const cursor = readRequestedCursor(request, url);
    const controller = new AbortController();
    this.#activeStreams.add(controller);
    let iterator: ConversationIterator | null = null;
    let clientClosed = false;
    let consumerLost = false;
    let monitor: ReturnType<typeof setInterval> | null = null;

    const close = (): void => {
      clientClosed = true;
      controller.abort();
    };
    request.once('aborted', close);
    response.once('close', close);

    try {
      iterator = this.#port.subscribe(defSessionId, cursor, controller.signal)[Symbol.asyncIterator]();
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      response.flushHeaders();
      monitor = setInterval(() => {
        const current = this.#consumers.currentFor(access.claims);
        if (!current || current.consumerId !== access.consumer.consumerId || current.executorLeaseId !== access.consumer.executorLeaseId) {
          consumerLost = true;
          controller.abort();
        }
      }, this.#consumerPollIntervalMs);
      unrefTimer(monitor);

      let previousCursor = cursor;
      for (;;) {
        const next = await nextWithAbort(iterator, controller.signal);
        if (next === null) break;
        if (next.done) break;
        if (clientClosed) break;
        const event = next.value;
        try {
          assertConversationEvent(event);
        } catch (error) {
          throw gatewayError(
            'AGENT_CONVERSATION_EVENT_INVALID',
            `Conversation event is invalid: ${error instanceof Error ? error.message : String(error)}`,
            502,
          );
        }
        if (event.defSessionId !== defSessionId) {
          throw gatewayError('AGENT_CONVERSATION_SESSION_MISMATCH', 'Conversation event belongs to another Session', 502);
        }
        if (event.type === 'conversation.snapshot') {
          previousCursor = event.snapshot.cursor;
        } else if (event.type === 'conversation.reset-required') {
          previousCursor = event.cursor;
        } else {
          try {
            assertConversationEventTransition(previousCursor, event);
          } catch (error) {
            throw gatewayError(
              'AGENT_CONVERSATION_EVENT_INVALID',
              `Conversation event cursor is invalid: ${error instanceof Error ? error.message : String(error)}`,
              502,
            );
          }
          previousCursor = event.cursor;
        }
        response.write(formatSseEvent(event));
        if (event.type === 'conversation.reset-required') break;
      }

      if (consumerLost && !clientClosed && !response.writableEnded) {
        response.write(formatSseError('AGENT_CONSUMER_STALE'));
      }
      if (!response.writableEnded && !response.destroyed) response.end();
    } catch (error) {
      if (!clientClosed && !response.destroyed) {
        if (!response.headersSent) this.#writeError(response, error);
        else {
          response.write(formatSseError(safeErrorCode(error)));
          response.end();
        }
      }
    } finally {
      if (monitor) clearInterval(monitor);
      controller.abort();
      this.#activeStreams.delete(controller);
      request.off('aborted', close);
      response.off('close', close);
      if (iterator) await closeAsyncIterator(iterator);
    }
  }

  async #serveStatic(
    request: IncomingMessage,
    response: ServerResponse,
    route: string,
  ): Promise<boolean> {
    const requested = route === '' ? 'index.html' : route;
    if (!isAllowedStaticPath(requested, this.#staticFiles)) {
      if (route === '' || route === 'index.html' || route.startsWith('assets/')) {
        throw gatewayError('AGENT_UI_STATIC_PATH_NOT_FOUND', 'Agent UI asset was not found', 404);
      }
      return false;
    }
    const candidate = resolve(this.#uiRoot, requested);
    if (!isWithinRoot(this.#uiRoot, candidate)) {
      throw gatewayError('AGENT_UI_STATIC_PATH_INVALID', 'Agent UI path escapes its configured root', 400);
    }
    if (!isRegularNonSymlinkFile(this.#uiRoot, candidate)) {
      throw gatewayError('AGENT_UI_STATIC_PATH_NOT_FOUND', 'Agent UI asset was not found', 404);
    }
    const size = statSync(candidate).size;
    response.setHeader('Content-Type', MIME_TYPES[extname(candidate).toLowerCase()] ?? 'application/octet-stream');
    response.setHeader('Content-Length', size);
    response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self' data:; frame-ancestors ${this.#browserOrigin}`);
    if (request.method === 'HEAD') {
      response.end();
    } else {
      createReadStream(candidate).on('error', (error: Error) => {
        this.#diagnostic(`AGENT_UI_STATIC_READ_FAILED: ${error.message.slice(0, 400)}`);
        if (!response.destroyed) response.destroy(error);
      }).pipe(response);
    }
    return true;
  }

  #relativeRoute(pathname: string): string | null {
    if (pathname === this.#basePath || pathname === `${this.#basePath}/`) return '';
    const prefix = `${this.#basePath}/`;
    if (!pathname.startsWith(prefix)) return null;
    return pathname.slice(prefix.length);
  }

  #requestOrigin(request: IncomingMessage): string {
    const origin = readHeader(request, 'origin');
    const proxyOrigin = readHeader(request, BROWSER_ORIGIN_HEADER);
    const normalizedOrigin = origin ? normalizeOrigin(origin) : null;
    const normalizedProxyOrigin = proxyOrigin ? normalizeOrigin(proxyOrigin) : null;
    if (normalizedOrigin && normalizedProxyOrigin && normalizedOrigin !== normalizedProxyOrigin) {
      // The standalone Session Surface is served from this loopback gateway,
      // while its capability still belongs to the parent Workbench origin.
      // It forwards that parent origin explicitly for capability validation.
      const localUiOrigin = this.#origin ? normalizeOrigin(this.#origin) : null;
      if (normalizedOrigin !== localUiOrigin || normalizedProxyOrigin !== this.#browserOrigin) {
        throw new DefAgentHostError('AGENT_ORIGIN_DENIED', 'Agent browser origins do not match', 403);
      }
    }
    const candidate = normalizedProxyOrigin ?? normalizedOrigin ?? this.#browserOrigin;
    if (candidate !== this.#browserOrigin) {
      const localUiOrigin = this.#origin ? normalizeOrigin(this.#origin) : null;
      if (candidate === localUiOrigin && !normalizedProxyOrigin) return candidate;
      throw new DefAgentHostError('AGENT_ORIGIN_DENIED', 'Agent browser origin is denied', 403);
    }
    return candidate;
  }

  #responseOrigin(request: IncomingMessage, capabilityOrigin: string): string {
    const origin = readHeader(request, 'origin');
    if (!origin) return capabilityOrigin;
    const normalized = normalizeOrigin(origin);
    if (normalized === this.#browserOrigin) return normalized;
    if (this.#origin && normalized === normalizeOrigin(this.#origin)) return normalized;
    return capabilityOrigin;
  }

  #setCors(response: ServerResponse, origin: string): void {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Access-Control-Allow-Headers', `${AGENT_UI_CAPABILITY_HEADER}, authorization, content-type, ${BROWSER_ORIGIN_HEADER}`);
    response.setHeader('Access-Control-Expose-Headers', 'content-type, last-event-id');
    response.setHeader('Vary', 'Origin');
  }

  #writeOptions(response: ServerResponse): void {
    response.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,DELETE,OPTIONS');
    response.statusCode = 204;
    response.end();
  }

  #writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
    if (response.headersSent || response.destroyed) return;
    const payload = JSON.stringify(value);
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Content-Length', Buffer.byteLength(payload));
    response.end(payload);
  }

  #writeError(response: ServerResponse, error: unknown): void {
    if (response.headersSent || response.destroyed) return;
    const known = isCodedError(error);
    if (!known) this.#diagnostic(describeInternalError(error));
    const statusCode = known ? error.statusCode : 500;
    const code = known ? error.code : 'AGENT_UI_INTERNAL_ERROR';
    const message = known && statusCode < 500 ? error.message : 'DEF Agent UI request failed';
    this.#writeJson(response, statusCode, { error: { code, message } });
  }
}

function gatewayError(code: GatewayErrorCode, message: string, statusCode: number): AgentUiGatewayError {
  return new AgentUiGatewayError(code, message, statusCode);
}

function isCodedError(error: unknown): error is { readonly code: string; readonly message: string; readonly statusCode: number } {
  return error instanceof DefAgentHostError
    || error instanceof AgentUiGatewayError
    || (
      error instanceof Error
      && 'code' in error
      && typeof error.code === 'string'
      && 'statusCode' in error
      && typeof error.statusCode === 'number'
    );
}

function describeInternalError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 800);
  return String(error).slice(0, 800);
}

function safeErrorCode(error: unknown): string {
  return isCodedError(error) ? error.code : 'AGENT_UI_INTERNAL_ERROR';
}

function normalizeBasePath(value: string): string {
  if (typeof value !== 'string' || !/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/u.test(value)) {
    throw new TypeError('Agent UI Gateway basePath must be an absolute route path');
  }
  return value;
}

function normalizeOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol)
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash
    ) throw new Error('invalid origin');
    return url.origin;
  } catch {
    throw new DefAgentHostError('AGENT_ORIGIN_DENIED', 'Agent browser origin is invalid', 403);
  }
}

function normalizeStaticRelativePath(value: string): string {
  if (
    typeof value !== 'string'
    || !value
    || value.startsWith('/')
    || value.includes('\\')
  ) throw new TypeError('Agent UI static file path is invalid');
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || !/^[A-Za-z0-9._~-]+$/u.test(segment))) {
    throw new TypeError('Agent UI static file path is invalid');
  }
  return segments.join('/');
}

function isAllowedStaticPath(pathname: string, files: ReadonlySet<string> | null): boolean {
  try {
    const normalized = normalizeStaticRelativePath(pathname);
    if (normalized === 'index.html') return true;
    if (files) return files.has(normalized);
    return normalized.startsWith('assets/');
  } catch {
    throw gatewayError('AGENT_UI_STATIC_PATH_INVALID', 'Agent UI static path is invalid', 400);
  }
}

function isPotentialApiRoute(route: string): boolean {
  return route === 'sessions'
    || route === 'interactions'
    || /^sessions\/[^/]+(?:\/(?:prompt|turns|stop|archive|conversation\/snapshot|conversation\/events))?$/u.test(route)
    || /^interactions\/[^/]+\/respond$/u.test(route);
}

function assertUiRoot(root: string, indexPath: string): void {
  let rootStats;
  let indexStats;
  try {
    rootStats = lstatSync(root);
    indexStats = lstatSync(indexPath);
  } catch {
    throw gatewayError('AGENT_UI_STATIC_NOT_READY', 'Agent UI entry point is missing', 503);
  }
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory() || indexStats.isSymbolicLink() || !indexStats.isFile()) {
    throw gatewayError('AGENT_UI_STATIC_NOT_READY', 'Agent UI entry point is not a regular file', 503);
  }
}

function isRegularNonSymlinkFile(root: string, candidate: string): boolean {
  if (!isWithinRoot(root, candidate)) return false;
  const relativePath = relative(root, candidate);
  let current = root;
  for (const segment of relativePath.split(sep)) {
    current = resolve(current, segment);
    let stats;
    try {
      stats = lstatSync(current);
    } catch {
      return false;
    }
    if (stats.isSymbolicLink()) return false;
    if (current === candidate && !stats.isFile()) return false;
    if (current !== candidate && !stats.isDirectory()) return false;
  }
  return true;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child !== '' && !child.startsWith(`..${sep}`) && !child.startsWith('..') && !isAbsolutePath(child);
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith(sep) || /^[A-Za-z]:[\\/]/u.test(value);
}

function matchesProductBinding(session: DefSessionV6, binding: ProductBinding): boolean {
  return session.workspaceId === binding.workspaceId
    && session.lastDatabaseGeneration === binding.databaseGeneration
    && session.timelineId === binding.timelineId;
}

function assertVisibleSession(session: DefSessionV6, binding: ProductBinding): void {
  if (!matchesProductBinding(session, binding)) {
    throw new DefAgentHostError('AGENT_BINDING_CONFLICT', 'Session does not belong to the current ProductBinding', 409);
  }
}

function toProductSession(session: DefSessionV6): AgentProductSession {
  const { engine, ...product } = structuredClone(session);
  return {
    ...product,
    engine: {
      kind: engine.kind,
      runtimeVersion: engine.runtimeVersion,
    },
  };
}

function readRequestedCursor(request: IncomingMessage, url: URL): ConversationCursor {
  const queryToken = url.searchParams.get('cursor');
  const headerToken = readHeader(request, 'last-event-id');
  if (!queryToken && !headerToken) {
    throw gatewayError('AGENT_CONVERSATION_CURSOR_REQUIRED', 'Conversation cursor is required', 400);
  }
  if (queryToken && headerToken && queryToken !== headerToken) {
    throw gatewayError('AGENT_CONVERSATION_CURSOR_INVALID', 'Conversation cursors do not match', 400);
  }
  return decodeConversationCursor(queryToken ?? headerToken!);
}

function formatSseEvent(event: ConversationEvent): string {
  return `id: ${encodeConversationCursor(event.cursor)}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function formatSseError(code: string): string {
  return `event: gateway.error\ndata: ${JSON.stringify({ error: { code } })}\n\n`;
}

async function nextWithAbort<T>(iterator: AsyncIterator<T>, signal: AbortSignal): Promise<IteratorResult<T> | null> {
  if (signal.aborted) return null;
  let onAbort!: () => void;
  const aborted = new Promise<null>((resolveAbort) => {
    onAbort = () => resolveAbort(null);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([iterator.next(), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

async function closeAsyncIterator(iterator: ConversationIterator): Promise<void> {
  if (!iterator.return) return;
  try {
    await Promise.race([
      Promise.resolve(iterator.return()),
      new Promise<void>((resolveClose) => {
        const timer = setTimeout(resolveClose, ITERATOR_CLOSE_TIMEOUT_MS);
        unrefTimer(timer);
      }),
    ]);
  } catch {
    // The source owns its failure semantics; the browser connection is gone.
  }
}

function readCapability(request: IncomingMessage): string {
  const direct = readHeader(request, AGENT_UI_CAPABILITY_HEADER);
  if (direct) return direct;
  const authorization = readHeader(request, 'authorization');
  if (authorization?.startsWith('Bearer ')) return authorization.slice('Bearer '.length).trim();
  return '';
}

function readHeader(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  if (Array.isArray(value)) {
    if (value.length !== 1) throw gatewayError('AGENT_REQUEST_INVALID', `${name} header is invalid`, 400);
    return value[0] ?? null;
  }
  return value ?? null;
}

async function readJson(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) throw gatewayError('AGENT_REQUEST_INVALID', 'Request body is too large', 413);
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw gatewayError('AGENT_REQUEST_INVALID', 'Request body must be valid JSON', 400);
  }
  return expectRecord(value);
}

function expectRecord(value: unknown): JsonObject {
  if (!isRecord(value)) throw gatewayError('AGENT_REQUEST_INVALID', 'Request body must be a JSON object', 400);
  return value as JsonObject;
}

function expectOnlyKeys(value: JsonObject, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw gatewayError('AGENT_REQUEST_INVALID', 'Request contains unsupported fields', 400);
  }
}

function expectPortableId(value: JsonValue | undefined, field: string, maximum: number): string {
  if (
    typeof value !== 'string'
    || !value.trim()
    || value !== value.trim()
    || value.length > maximum
    || !/^[A-Za-z0-9._:-]+$/u.test(value)
  ) throw gatewayError('AGENT_REQUEST_INVALID', `${field} is not a portable identifier`, 400);
  return value;
}

function decodeRouteId(value: string, field: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw gatewayError('AGENT_REQUEST_INVALID', `${field} route segment is invalid`, 400);
  }
  return expectPortableId(decoded, field, MAX_IDENTIFIER_LENGTH);
}

function expectToken(value: JsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200 || !value.trim()) {
    throw gatewayError('AGENT_REQUEST_INVALID', `${field} is invalid`, 400);
  }
  return value;
}

function expectAudience(value: JsonValue | undefined, expected: AgentLaunchAudience): AgentLaunchAudience {
  if (value !== expected) throw gatewayError('AGENT_REQUEST_INVALID', 'Agent audience is invalid', 400);
  return expected;
}

function expectBoundedMessage(value: JsonValue | undefined): string {
  if (typeof value !== 'string') throw gatewayError('AGENT_REQUEST_INVALID', 'userMessage is required', 400);
  const message = value.trim();
  if (!message || message.length > MAX_MESSAGE_CODE_UNITS || message.includes('\u0000')) {
    throw gatewayError('AGENT_REQUEST_INVALID', `userMessage must contain between 1 and ${MAX_MESSAGE_CODE_UNITS} characters`, 400);
  }
  return message;
}

function parseInteractionInput(body: JsonObject): AgentUiInteractionInput {
  expectOnlyKeys(body, ['status', 'value']);
  const allowed: readonly AgentUiInteractionInput['status'][] = [
    'answered',
    'approved',
    'rejected',
    'expired',
    'cancelled',
    'stale',
  ];
  if (typeof body.status !== 'string' || !allowed.includes(body.status as AgentUiInteractionInput['status'])) {
    throw gatewayError('AGENT_REQUEST_INVALID', 'interaction status is invalid', 400);
  }
  return {
    status: body.status as AgentUiInteractionInput['status'],
    ...(Object.prototype.hasOwnProperty.call(body, 'value') ? { value: body.value } : {}),
  };
}

function boundedPositiveInteger(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unrefTimer(timer: unknown): void {
  const unref = (timer as { unref?: () => void }).unref;
  if (typeof unref === 'function') unref.call(timer);
}
