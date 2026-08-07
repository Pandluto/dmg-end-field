import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  AGENT_UI_CAPABILITY_HEADER,
  DEF_AGENT_PROTOCOL_VERSION,
  asClientTurnId,
  asCommandId,
  asDatabaseGeneration,
  asDefSessionId,
  asDefTurnId,
  asInteractionId,
  asTimelineId,
  asWorkspaceId,
  type AgentHostHealth,
  type AgentLaunchAudience,
  type AgentLaunchGrantRegistration,
  type AgentNativeUiLaunch,
  type AgentUiState,
  type BrowserCommandResultSubmission,
  type BrowserSnapshotPublish,
  type BrowserWorkbenchHeartbeat,
  type BrowserWorkbenchRegistration,
  type DefSessionId,
  type JsonObject,
  type JsonValue,
  type InteractionResponse,
  type ProductBinding,
  type ProductCommandResult,
} from '../core/contracts/index.ts';
import { BrowserConsumerRegistry } from './browser-consumer-registry.ts';
import { DefAgentHost } from './def-agent-host.ts';
import { DefAgentHostError } from './errors.ts';
import { DefAgentInteropRoute } from './def-agent-interop.ts';
import { RemoteBrowserProductGateway } from './remote-browser-product-gateway.ts';
import { AgentTokenAuthority, type AgentUiCapabilityClaims } from './token-authority.ts';

export const AGENT_HOST_INTERNAL_TOKEN_HEADER = 'x-dmg-agent-host-token';
export const AGENT_HOST_PROXY_ORIGIN_HEADER = 'x-dmg-agent-browser-origin';

const MAX_REQUEST_BYTES = 1_048_576;
const MAX_PRODUCT_EVENT_PAGE_BYTES = 8_388_608;
const MAX_PRODUCT_COMMAND_WAIT_MS = 25_000;
const UI_AUDIENCE: AgentLaunchAudience = 'workbench-ai-mode';

type RuntimeState = 'starting' | 'ready' | 'stopping' | 'error';

type NativeAgentUiGateway = {
  launch(defSessionId: DefSessionId, claims: AgentUiCapabilityClaims): Promise<AgentNativeUiLaunch>;
  stop(): Promise<void>;
};

export interface DefAgentHostHttpServerOptions {
  readonly hostToken: string;
  readonly browserOrigin: string;
  readonly host: DefAgentHost;
  readonly tokens: AgentTokenAuthority;
  readonly consumers: BrowserConsumerRegistry;
  readonly gateway: RemoteBrowserProductGateway;
  /** Development-only blackbox observation route over the current Host journal. */
  readonly interop?: DefAgentInteropRoute;
  readonly nativeUi?: NativeAgentUiGateway;
  readonly engine: AgentHostHealth['engine'] | (() => AgentHostHealth['engine']);
  readonly diagnostic?: (message: string) => void;
  readonly onShutdownRequested?: () => void;
}

export class DefAgentHostHttpServer {
  readonly #hostToken: string;
  readonly #browserOrigin: string;
  readonly #host: DefAgentHost;
  readonly #tokens: AgentTokenAuthority;
  readonly #consumers: BrowserConsumerRegistry;
  readonly #gateway: RemoteBrowserProductGateway;
  readonly #interop: DefAgentInteropRoute | null;
  readonly #nativeUi: NativeAgentUiGateway | null;
  readonly #engine: () => AgentHostHealth['engine'];
  readonly #diagnostic: (message: string) => void;
  readonly #onShutdownRequested: () => void;
  readonly #server: Server;
  #state: RuntimeState = 'starting';
  #stopPromise: Promise<void> | null = null;

  constructor(options: DefAgentHostHttpServerOptions) {
    if (!isSecureToken(options.hostToken)) throw new Error('DEF Agent Host token is invalid');
    this.#hostToken = options.hostToken;
    this.#browserOrigin = normalizeOrigin(options.browserOrigin);
    this.#host = options.host;
    this.#tokens = options.tokens;
    this.#consumers = options.consumers;
    this.#gateway = options.gateway;
    this.#interop = options.interop ?? null;
    this.#nativeUi = options.nativeUi ?? null;
    const engine = options.engine;
    this.#engine = typeof engine === 'function' ? engine : () => engine;
    this.#diagnostic = options.diagnostic ?? (() => {});
    this.#onShutdownRequested = options.onShutdownRequested ?? (() => {});
    this.#server = createServer((request, response) => {
      void this.#handle(request, response).catch((error: unknown) => {
        this.#writeError(response, error);
      });
    });
  }

  async listen(port = 0): Promise<number> {
    if (this.#state !== 'starting') throw new Error(`Cannot listen while Host is ${this.#state}`);
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      this.#server.once('error', onError);
      this.#server.listen(port, '127.0.0.1', () => {
        this.#server.off('error', onError);
        resolve();
      });
    });
    const address = this.#server.address();
    if (!address || typeof address === 'string') throw new Error('DEF Agent Host has no TCP address');
    this.#state = 'ready';
    return address.port;
  }

  health(): AgentHostHealth {
    return {
      service: 'def-agent-host',
      protocolVersion: DEF_AGENT_PROTOCOL_VERSION,
      runtimeSchemaVersion: 1,
      state: this.#state,
      engine: this.#engine(),
    };
  }

  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#stopPromise = this.#stop();
    return this.#stopPromise;
  }

  async #stop(): Promise<void> {
    if (this.#state === 'stopping') return;
    this.#state = 'stopping';
    this.#tokens.clear();
    this.#consumers.clear();
    this.#gateway.clear('DEF Agent Host stopped');
    await this.#nativeUi?.stop();
    await this.#host.shutdown();
    if (this.#server.listening) {
      await new Promise<void>((resolve, reject) => {
        this.#server.close((error) => error ? reject(error) : resolve());
        this.#server.closeAllConnections();
      });
    }
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    this.#assertHostToken(request);

    if (url.pathname.startsWith('/internal/')) {
      await this.#handleInternal(request, response, url);
      return;
    }
    if (!url.pathname.startsWith('/agent-host/')) throw httpError('AGENT_ROUTE_NOT_FOUND', 'Route not found', 404);
    this.#assertBrowserOrigin(request);
    if (this.#interop && await this.#interop.handle(request, response, url)) return;
    await this.#handleBrowser(request, response, url);
  }

  async #handleInternal(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    if (request.method === 'GET' && url.pathname === '/internal/health') {
      this.#writeJson(response, 200, this.health());
      return;
    }
    if (request.method === 'POST' && url.pathname === '/internal/launch-grants') {
      const body = expectRecord(await readJson(request));
      const registration: AgentLaunchGrantRegistration = {
        grant: expectString(body.grant, 'grant'),
        origin: expectString(body.origin, 'origin'),
        audience: expectAudience(body.audience),
        expiresAt: expectNumber(body.expiresAt, 'expiresAt'),
      };
      if (normalizeOrigin(registration.origin) !== this.#browserOrigin) {
        throw new DefAgentHostError('AGENT_ORIGIN_DENIED', 'Launch grant origin is not the configured browser origin', 403);
      }
      this.#tokens.registerLaunchGrant(registration);
      this.#writeJson(response, 201, { registered: true, expiresAt: registration.expiresAt });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/internal/shutdown') {
      this.#writeJson(response, 202, { stopping: true });
      setImmediate(() => {
        this.#onShutdownRequested();
        void this.stop();
      });
      return;
    }
    throw httpError('AGENT_ROUTE_NOT_FOUND', 'Internal Host route not found', 404);
  }

  async #handleBrowser(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    if (request.method === 'GET' && url.pathname === '/agent-host/health') {
      this.#writeJson(response, 200, this.health());
      return;
    }
    if (request.method === 'POST' && url.pathname === '/agent-host/ui/session') {
      const body = expectRecord(await readJson(request));
      const session = this.#tokens.exchangeLaunchGrant({
        grant: expectString(body.launchGrant, 'launchGrant'),
        origin: this.#browserOrigin,
        audience: expectAudience(body.audience),
      });
      this.#writeJson(response, 201, {
        ...session,
        approvalVerificationKey: this.#host.getApprovalVerificationKey(),
      });
      return;
    }

    const claims = this.#requireUiCapability(request);
    if (request.method === 'POST' && url.pathname === '/agent-host/native-ui/launch') {
      if (!this.#nativeUi) {
        throw new DefAgentHostError('AGENT_NATIVE_UI_ROUTE_NOT_FOUND', 'OpenCode native UI is unavailable', 503);
      }
      const body = expectRecord(await readJson(request));
      expectExactKeys(body, ['defSessionId']);
      const defSessionId = asDefSessionId(expectPortableId(body.defSessionId, 'defSessionId', 200));
      this.#writeJson(response, 201, {
        protocolVersion: DEF_AGENT_PROTOCOL_VERSION,
        launch: await this.#nativeUi.launch(defSessionId, claims),
      });
      return;
    }
    if (url.pathname === '/agent-host/sessions') {
      const consumer = this.#consumers.requireActive(claims);
      if (request.method === 'GET') {
        this.#writeJson(response, 200, {
          protocolVersion: DEF_AGENT_PROTOCOL_VERSION,
          sessions: this.#host.listSessions(consumer.binding).map(toProductSession),
        });
        return;
      }
      if (request.method === 'POST') {
        const body = expectRecord(await readJson(request));
        expectExactKeys(body, ['providerProfileRef']);
        const providerProfileRef = body.providerProfileRef === undefined
          ? 'default'
          : expectPortableId(body.providerProfileRef, 'providerProfileRef', 128);
        const session = await this.#host.createSession({
          binding: consumer.binding,
          providerProfileRef,
        });
        this.#writeJson(response, 201, {
          protocolVersion: DEF_AGENT_PROTOCOL_VERSION,
          session: toProductSession(session),
        });
        return;
      }
    }

    const sessionMatch = /^\/agent-host\/sessions\/([^/]+)(?:\/(events|turns|archive|restore))?$/.exec(url.pathname);
    if (sessionMatch) {
      const consumer = this.#consumers.requireActive(claims);
      const defSessionId = asDefSessionId(decodeRouteId(sessionMatch[1]!, 'defSessionId'));
      const action = sessionMatch[2] ?? '';
      if (request.method === 'GET' && action === '') {
        this.#writeJson(response, 200, {
          protocolVersion: DEF_AGENT_PROTOCOL_VERSION,
          session: toProductSession(this.#host.readSession(defSessionId, consumer.binding)),
        });
        return;
      }
      if (request.method === 'POST' && action === 'archive') {
        expectExactKeys(expectRecord(await readJson(request)), []);
        const session = this.#host.archiveSession(defSessionId, consumer.binding);
        this.#writeJson(response, 200, {
          protocolVersion: DEF_AGENT_PROTOCOL_VERSION,
          session: toProductSession(session),
        });
        return;
      }
      if (request.method === 'POST' && action === 'restore') {
        expectExactKeys(expectRecord(await readJson(request)), []);
        const session = await this.#host.restoreSession(defSessionId, consumer.binding);
        this.#writeJson(response, 200, {
          protocolVersion: DEF_AGENT_PROTOCOL_VERSION,
          session: toProductSession(session),
        });
        return;
      }
      if (request.method === 'DELETE' && action === '') {
        await this.#host.deleteSession(defSessionId, consumer.binding);
        this.#writeJson(response, 200, {
          protocolVersion: DEF_AGENT_PROTOCOL_VERSION,
          defSessionId,
          deleted: true,
        });
        return;
      }
      if (request.method === 'GET' && action === 'events') {
        const afterSequence = parseNonNegativeInteger(
          url.searchParams.get('afterSequence') ?? '0',
          'afterSequence',
        );
        const limit = parsePositiveInteger(url.searchParams.get('limit') ?? '256', 'limit', 256);
        const events = boundedProductEvents(this.#host
          .readEvents(defSessionId, afterSequence, limit, consumer.binding)
          .map(toProductEvent));
        const nextSequence = events.at(-1)?.sequence ?? afterSequence;
        const hasMore = this.#host.readEvents(defSessionId, nextSequence, 1, consumer.binding).length > 0;
        this.#writeJson(response, 200, {
          protocolVersion: DEF_AGENT_PROTOCOL_VERSION,
          defSessionId,
          afterSequence,
          nextSequence,
          hasMore,
          events,
        });
        return;
      }
      if (request.method === 'POST' && action === 'turns') {
        const body = expectRecord(await readJson(request));
        expectExactKeys(body, ['clientTurnId', 'userMessage']);
        const userMessage = expectBoundedMessage(body.userMessage);
        const clientTurnId = asClientTurnId(expectPortableId(body.clientTurnId, 'clientTurnId', 200));
        const turn = await this.#host.startHarnessTurn({
          defSessionId,
          userMessage,
          clientTurnId,
          binding: consumer.binding,
        });
        this.#writeJson(response, 202, {
          protocolVersion: DEF_AGENT_PROTOCOL_VERSION,
          defSessionId,
          ...turn,
        });
        return;
      }
    }

    const turnAbortMatch = /^\/agent-host\/turns\/([^/]+)\/abort$/.exec(url.pathname);
    if (turnAbortMatch && request.method === 'POST') {
      const consumer = this.#consumers.requireActive(claims);
      const defTurnId = asDefTurnId(decodeRouteId(turnAbortMatch[1]!, 'defTurnId'));
      await this.#host.abortTurn(defTurnId, 'USER_STOPPED', consumer.binding);
      this.#writeJson(response, 200, {
        protocolVersion: DEF_AGENT_PROTOCOL_VERSION,
        defTurnId,
        stopped: true,
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/agent-host/interactions') {
      const consumer = this.#consumers.requireActive(claims);
      this.#writeJson(response, 200, {
        protocolVersion: DEF_AGENT_PROTOCOL_VERSION,
        interactions: this.#host.listPendingInteractions(consumer.binding),
      });
      return;
    }
    const interactionMatch = /^\/agent-host\/interactions\/([^/]+)\/respond$/.exec(url.pathname);
    if (interactionMatch && request.method === 'POST') {
      const consumer = this.#consumers.requireActive(claims);
      const interactionId = asInteractionId(decodeRouteId(interactionMatch[1]!, 'interactionId'));
      const input = parseInteractionResponse(await readJson(request));
      const interactionResponse = this.#host.resolveInteraction(
        interactionId,
        input,
        consumer.binding,
      );
      this.#writeJson(response, 200, {
        protocolVersion: DEF_AGENT_PROTOCOL_VERSION,
        interactionId,
        response: interactionResponse,
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/agent-host/ui/state') {
      const consumer = this.#consumers.currentFor(claims);
      const ids = consumer
        ? this.#host.getActiveIds()
        : { defSessionId: null, defTurnId: null };
      const state: AgentUiState = {
        protocolVersion: DEF_AGENT_PROTOCOL_VERSION,
        engine: this.#engine(),
        consumer,
        activeDefSessionId: ids.defSessionId,
        activeDefTurnId: ids.defTurnId,
      };
      this.#writeJson(response, 200, state);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/agent-host/workbench/register') {
      const registration = parseWorkbenchRegistration(await readJson(request));
      this.#writeJson(response, 201, this.#consumers.register(claims, registration));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/agent-host/workbench/heartbeat') {
      const heartbeat = parseWorkbenchHeartbeat(await readJson(request));
      this.#writeJson(response, 200, this.#consumers.heartbeat(claims, heartbeat));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/agent-host/workbench/close') {
      const body = expectRecord(await readJson(request));
      this.#consumers.close(claims, {
        consumerId: expectString(body.consumerId, 'consumerId'),
        executorLeaseId: expectString(body.executorLeaseId, 'executorLeaseId'),
      });
      this.#writeJson(response, 200, { closed: true });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/agent-host/workbench/snapshot') {
      const publish = parseSnapshotPublish(await readJson(request));
      this.#writeJson(response, 200, this.#gateway.publishSnapshot(claims, publish));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/agent-host/workbench/commands/next') {
      const waitMs = parseNonNegativeInteger(
        url.searchParams.get('waitMs') ?? '0',
        'waitMs',
      );
      if (waitMs > MAX_PRODUCT_COMMAND_WAIT_MS) {
        throw httpError(
          'AGENT_REQUEST_INVALID',
          `waitMs must be between 0 and ${MAX_PRODUCT_COMMAND_WAIT_MS}`,
          400,
        );
      }
      const delivery = await this.#gateway.waitForNextCommand(claims, {
        consumerId: expectQuery(url, 'consumerId'),
        executorLeaseId: expectQuery(url, 'executorLeaseId'),
        afterCursor: parseNonNegativeInteger(expectQuery(url, 'afterCursor'), 'afterCursor'),
      }, waitMs);
      this.#writeJson(response, 200, { delivery });
      return;
    }

    const commandMatch = /^\/agent-host\/workbench\/commands\/([^/]+)(?:\/result)?$/.exec(url.pathname);
    if (commandMatch) {
      const commandId = asCommandId(decodeURIComponent(commandMatch[1]!));
      if (request.method === 'POST' && url.pathname.endsWith('/result')) {
        const submission = parseCommandResultSubmission(await readJson(request));
        if (submission.result.commandId !== commandId) {
          throw httpError('AGENT_REQUEST_INVALID', 'Result commandId does not match route', 400);
        }
        this.#writeJson(response, 200, this.#gateway.submitResult(claims, submission));
        return;
      }
      if (request.method === 'GET' && !url.pathname.endsWith('/result')) {
        const command = this.#gateway.getCommand(commandId);
        if (!command) {
          throw new DefAgentHostError('AGENT_COMMAND_NOT_FOUND', `Product command ${commandId} does not exist`, 404);
        }
        this.#writeJson(response, 200, command);
        return;
      }
    }
    throw httpError('AGENT_ROUTE_NOT_FOUND', 'Browser Host route not found', 404);
  }

  #assertHostToken(request: IncomingMessage): void {
    const candidate = headerValue(request, AGENT_HOST_INTERNAL_TOKEN_HEADER);
    if (!candidate || !constantTimeEqual(candidate, this.#hostToken)) {
      throw httpError('AGENT_INTERNAL_UNAUTHORIZED', 'Private Agent Host authentication failed', 401);
    }
  }

  #assertBrowserOrigin(request: IncomingMessage): void {
    const origin = headerValue(request, AGENT_HOST_PROXY_ORIGIN_HEADER);
    if (!origin || normalizeOrigin(origin) !== this.#browserOrigin) {
      throw new DefAgentHostError('AGENT_ORIGIN_DENIED', 'Agent browser origin is denied', 403);
    }
  }

  #requireUiCapability(request: IncomingMessage): AgentUiCapabilityClaims {
    return this.#tokens.validateCapability({
      capability: headerValue(request, AGENT_UI_CAPABILITY_HEADER) ?? '',
      origin: this.#browserOrigin,
      audience: UI_AUDIENCE,
    });
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
    const known = error instanceof DefAgentHostError || isHttpError(error);
    if (!known) this.#diagnostic(describeInternalError(error));
    const statusCode = known ? error.statusCode : 500;
    const code = known ? error.code : 'AGENT_HOST_INTERNAL_ERROR';
    const message = known && statusCode < 500
      ? error.message
      : 'DEF Agent Host request failed';
    this.#writeJson(response, statusCode, { error: { code, message } });
  }
}

function describeInternalError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof Error) {
      const code = 'code' in current && typeof current.code === 'string'
        ? ` ${current.code}`
        : '';
      parts.push(`${current.name}${code}: ${current.message}`.slice(0, 800));
      current = current.cause;
      continue;
    }
    parts.push(String(current).slice(0, 800));
    break;
  }
  return `internal request failed: ${parts.join(' <- ') || 'unknown error'}`;
}

type HttpError = Error & { readonly code: string; readonly statusCode: number };

function httpError(code: string, message: string, statusCode: number): HttpError {
  return Object.assign(new Error(message), { code, statusCode });
}

function isHttpError(error: unknown): error is HttpError {
  return error instanceof Error
    && 'code' in error
    && typeof error.code === 'string'
    && 'statusCode' in error
    && typeof error.statusCode === 'number';
}

async function readJson(request: IncomingMessage): Promise<JsonValue> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) throw httpError('AGENT_REQUEST_TOO_LARGE', 'Request body is too large', 413);
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as JsonValue;
  } catch {
    throw httpError('AGENT_REQUEST_INVALID', 'Request body must be valid JSON', 400);
  }
}

function parseWorkbenchRegistration(value: JsonValue): BrowserWorkbenchRegistration {
  const body = expectRecord(value);
  if (body.writer !== true || body.visible !== true) {
    throw httpError('AGENT_REQUEST_INVALID', 'Consumer must be a visible writer', 400);
  }
  return {
    consumerId: expectString(body.consumerId, 'consumerId'),
    executorLeaseId: expectString(body.executorLeaseId, 'executorLeaseId'),
    writer: true,
    visible: true,
    binding: parseBinding(body.binding),
  };
}

function parseWorkbenchHeartbeat(value: JsonValue): BrowserWorkbenchHeartbeat {
  return parseWorkbenchRegistration(value);
}

function parseSnapshotPublish(value: JsonValue): BrowserSnapshotPublish {
  const body = expectRecord(value);
  const snapshot = expectRecord(body.snapshot);
  return {
    consumerId: expectString(body.consumerId, 'consumerId'),
    executorLeaseId: expectString(body.executorLeaseId, 'executorLeaseId'),
    snapshot: {
      protocolVersion: expectLiteralOne(snapshot.protocolVersion, 'snapshot.protocolVersion'),
      binding: parseBinding(snapshot.binding),
      capturedAt: expectString(snapshot.capturedAt, 'snapshot.capturedAt'),
      payload: expectRecord(snapshot.payload),
    },
  };
}

function parseCommandResultSubmission(value: JsonValue): BrowserCommandResultSubmission {
  const body = expectRecord(value);
  const raw = expectRecord(body.result);
  const allowed = ['succeeded', 'committed', 'not-executed', 'rejected', 'conflict', 'error', 'orphaned'];
  const status = expectString(raw.status, 'result.status');
  if (!allowed.includes(status)) throw httpError('AGENT_REQUEST_INVALID', 'result.status is invalid', 400);
  const result: ProductCommandResult = {
    commandId: asCommandId(expectString(raw.commandId, 'result.commandId')),
    status: status as ProductCommandResult['status'],
    ...optionalString(raw.code, 'result.code'),
    ...optionalString(raw.message, 'result.message'),
    beforeRevision: nullableNumber(raw.beforeRevision, 'result.beforeRevision'),
    afterRevision: nullableNumber(raw.afterRevision, 'result.afterRevision'),
    ...optionalJson(raw.browserResult, 'browserResult'),
    ...optionalJson(raw.visiblePostcondition, 'visiblePostcondition'),
    ...optionalString(raw.executorLeaseId, 'result.executorLeaseId'),
    completedAt: expectString(raw.completedAt, 'result.completedAt'),
  };
  return {
    consumerId: expectString(body.consumerId, 'consumerId'),
    executorLeaseId: expectString(body.executorLeaseId, 'executorLeaseId'),
    result,
  };
}

function parseInteractionResponse(value: JsonValue): {
  readonly status: InteractionResponse['status'];
  readonly value?: JsonValue;
} {
  const body = expectRecord(value);
  expectExactKeys(body, ['status', 'value']);
  const status = expectString(body.status, 'status');
  const allowed: readonly InteractionResponse['status'][] = [
    'answered',
    'approved',
    'rejected',
    'expired',
    'cancelled',
    'stale',
  ];
  if (!allowed.includes(status as InteractionResponse['status'])) {
    throw httpError('AGENT_REQUEST_INVALID', 'interaction status is invalid', 400);
  }
  return {
    status: status as InteractionResponse['status'],
    ...(Object.prototype.hasOwnProperty.call(body, 'value') ? { value: body.value! } : {}),
  };
}

function parseBinding(value: JsonValue | undefined): ProductBinding {
  const binding = expectRecord(value);
  return {
    workspaceId: asWorkspaceId(expectString(binding.workspaceId, 'binding.workspaceId')),
    databaseGeneration: asDatabaseGeneration(expectString(binding.databaseGeneration, 'binding.databaseGeneration')),
    timelineId: asTimelineId(expectString(binding.timelineId, 'binding.timelineId')),
    checkoutTargetId: nullableString(binding.checkoutTargetId, 'binding.checkoutTargetId'),
    checkoutUpdatedAt: expectNumber(binding.checkoutUpdatedAt, 'binding.checkoutUpdatedAt'),
    contentRevision: expectNumber(binding.contentRevision, 'binding.contentRevision'),
    snapshotDigest: expectString(binding.snapshotDigest, 'binding.snapshotDigest'),
  };
}

function expectRecord(value: JsonValue | undefined): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw httpError('AGENT_REQUEST_INVALID', 'Expected a JSON object', 400);
  }
  return value;
}

function expectString(value: JsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw httpError('AGENT_REQUEST_INVALID', `${field} must be a non-empty string`, 400);
  }
  return value;
}

function optionalString(value: JsonValue | undefined, field: string): Record<string, string> {
  return value === undefined ? {} : { [field.split('.').at(-1)!]: expectString(value, field) };
}

function nullableString(value: JsonValue | undefined, field: string): string | null {
  return value === null ? null : expectString(value, field);
}

function expectNumber(value: JsonValue | undefined, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw httpError('AGENT_REQUEST_INVALID', `${field} must be a finite number`, 400);
  }
  return value;
}

function nullableNumber(value: JsonValue | undefined, field: string): number | null {
  return value === null ? null : expectNumber(value, field);
}

function optionalJson(value: JsonValue | undefined, field: string): Record<string, JsonValue> {
  return value === undefined ? {} : { [field]: value };
}

function expectLiteralOne(value: JsonValue | undefined, field: string): 1 {
  if (value !== 1) throw httpError('AGENT_REQUEST_INVALID', `${field} must be 1`, 400);
  return 1;
}

function expectAudience(value: JsonValue | undefined): AgentLaunchAudience {
  if (value !== UI_AUDIENCE) throw httpError('AGENT_REQUEST_INVALID', 'Agent audience is invalid', 400);
  return value;
}

function expectQuery(url: URL, key: string): string {
  const value = url.searchParams.get(key);
  if (!value) throw httpError('AGENT_REQUEST_INVALID', `${key} query parameter is required`, 400);
  return value;
}

function parseNonNegativeInteger(value: string, field: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw httpError('AGENT_REQUEST_INVALID', `${field} must be a non-negative integer`, 400);
  }
  return result;
}

function parsePositiveInteger(value: string, field: string, maximum: number): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) {
    throw httpError('AGENT_REQUEST_INVALID', `${field} must be an integer between 1 and ${maximum}`, 400);
  }
  return result;
}

function expectPortableId(value: JsonValue | undefined, field: string, maximum: number): string {
  const result = expectString(value, field).trim();
  if (result.length > maximum || !/^[A-Za-z0-9._:-]+$/u.test(result)) {
    throw httpError('AGENT_REQUEST_INVALID', `${field} is not a portable identifier`, 400);
  }
  return result;
}

function expectBoundedMessage(value: JsonValue | undefined): string {
  const result = expectString(value, 'userMessage').trim();
  if (!result || result.length > 16_000) {
    throw httpError('AGENT_REQUEST_INVALID', 'userMessage must contain between 1 and 16000 characters', 400);
  }
  return result;
}

function expectExactKeys(record: Record<string, JsonValue>, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw httpError('AGENT_REQUEST_INVALID', 'Request contains unsupported fields', 400);
  }
}

function decodeRouteId(value: string, field: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw httpError('AGENT_REQUEST_INVALID', `${field} route segment is invalid`, 400);
  }
  return expectPortableId(decoded, field, 200);
}

function toProductSession(session: import('../core/contracts/index.ts').DefSessionV6) {
  const { engine, ...product } = session;
  return {
    ...product,
    engine: {
      kind: engine.kind,
      runtimeVersion: engine.runtimeVersion,
    },
  };
}

function toProductEvent(event: import('../core/contracts/index.ts').DefEvent) {
  const { diagnostics: _diagnostics, ...product } = event;
  return product;
}

function boundedProductEvents<
  Event extends ReturnType<typeof toProductEvent>,
>(events: readonly Event[]): readonly Event[] {
  const page: Event[] = [];
  let bytes = 2;
  for (const event of events) {
    const eventBytes = Buffer.byteLength(JSON.stringify(event)) + (page.length ? 1 : 0);
    if (page.length && bytes + eventBytes > MAX_PRODUCT_EVENT_PAGE_BYTES) break;
    if (!page.length && bytes + eventBytes > MAX_PRODUCT_EVENT_PAGE_BYTES) {
      throw new DefAgentHostError('AGENT_EVENT_LIMIT_INVALID', 'A single Event exceeds the Product page boundary', 413);
    }
    page.push(event);
    bytes += eventBytes;
  }
  return page;
}

function headerValue(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  if (Array.isArray(value)) return value.length === 1 ? value[0] ?? null : null;
  return value ?? null;
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

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function isSecureToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{20,200}$/.test(value);
}
