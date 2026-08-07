import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import {
  asClientTurnId,
  asEngineMessageId,
  type DefSessionId,
  type EngineUserAttachment,
  type InteractionRequest,
  type InteractionResponse,
  type JsonValue,
  type ProductBinding,
} from '../core/contracts/index.ts';
import { BrowserConsumerRegistry } from './browser-consumer-registry.ts';
import { DefAgentHost } from './def-agent-host.ts';
import { DefAgentHostError } from './errors.ts';
import type { AgentUiCapabilityClaims } from './token-authority.ts';

const MAX_REQUEST_BYTES = 12 * 1_048_576;
const MAX_USER_ATTACHMENTS = 4;
const MAX_USER_ATTACHMENT_BYTES = 8 * 1_048_576;
const INTERACTION_POLL_MS = 250;
const RESOLUTION_MEMORY_MS = 60_000;
const TOKEN_TTL_MS = 8 * 60 * 60 * 1_000;
const TOKEN_COOKIE = 'def_native_ui';
const MESSAGE_ID_PATTERN = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/u;

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.aac': 'audio/aac',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

type NativeUiTokenRecord = {
  readonly claims: AgentUiCapabilityClaims;
  readonly expiresAt: number;
};

type NativeQuestionRequest = {
  readonly id: string;
  readonly sessionID: string;
  readonly questions: readonly [{
    readonly header: string;
    readonly question: string;
    readonly options: readonly { readonly label: string; readonly description: string }[];
    readonly multiple: false;
    readonly custom: true;
  }];
};

type NativePermissionRequest = {
  readonly id: string;
  readonly sessionID: string;
  readonly permission: 'def_mutation';
  readonly patterns: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly always: readonly [];
};

type NativeInteractionProjection =
  | {
      readonly kind: 'question';
      readonly interaction: Extract<InteractionRequest, { readonly kind: 'question' }>;
      readonly sessionID: string;
      readonly payload: NativeQuestionRequest;
      readonly fingerprint: string;
    }
  | {
      readonly kind: 'approval';
      readonly interaction: Extract<InteractionRequest, { readonly kind: 'approval' }>;
      readonly sessionID: string;
      readonly payload: NativePermissionRequest;
      readonly fingerprint: string;
    };

type RememberedResolution = {
  readonly response: InteractionResponse;
  readonly expiresAt: number;
};

export type OpenCodeNativeUiLaunch = {
  readonly src: string;
  readonly defSessionId: DefSessionId;
};

export interface OpenCodeNativeUiEngine {
  requestNativeUi(pathname: string, init?: RequestInit): Promise<Response>;
  nativeUiDirectory(): Promise<string>;
}

export interface OpenCodeNativeUiGatewayOptions {
  readonly uiRoot: string;
  readonly browserOrigin: string;
  readonly host: DefAgentHost;
  readonly engine: OpenCodeNativeUiEngine;
  readonly consumers: BrowserConsumerRegistry;
  readonly providerProfileRef?: string;
  readonly clock?: () => number;
  readonly randomToken?: () => string;
  readonly diagnostic?: (message: string) => void;
}

/**
 * Hosts the version-locked upstream OpenCode UI on its own loopback origin.
 *
 * The browser never receives OpenCode's private origin or server password.
 * Read requests are proxied through OpenCodeRuntimeSupervisor; prompt/session
 * mutations are translated to DefAgentHost operations so the native UI cannot
 * bypass the Harness, Product binding, or approval boundary.
 */
export class OpenCodeNativeUiGateway {
  readonly #uiRoot: string;
  readonly #indexPath: string;
  readonly #browserOrigin: string;
  readonly #host: DefAgentHost;
  readonly #engine: OpenCodeNativeUiEngine;
  readonly #consumers: BrowserConsumerRegistry;
  readonly #providerProfileRef: string;
  readonly #clock: () => number;
  readonly #randomToken: () => string;
  readonly #diagnostic: (message: string) => void;
  readonly #tokens = new Map<string, NativeUiTokenRecord>();
  readonly #resolutions = new Map<string, RememberedResolution>();
  readonly #server: Server;
  #origin = '';
  #stopPromise: Promise<void> | null = null;

  constructor(options: OpenCodeNativeUiGatewayOptions) {
    this.#uiRoot = resolve(options.uiRoot);
    this.#indexPath = resolve(this.#uiRoot, 'index.html');
    this.#browserOrigin = normalizeOrigin(options.browserOrigin);
    this.#host = options.host;
    this.#engine = options.engine;
    this.#consumers = options.consumers;
    this.#providerProfileRef = options.providerProfileRef ?? 'default';
    this.#clock = options.clock ?? Date.now;
    this.#randomToken = options.randomToken ?? (() => randomBytes(32).toString('base64url'));
    this.#diagnostic = options.diagnostic ?? (() => undefined);
    this.#server = createServer((request, response) => {
      void this.#handle(request, response).catch((error: unknown) => this.#writeError(response, error));
    });
  }

  get origin(): string {
    if (!this.#origin) throw new Error('OpenCode native UI gateway is not listening');
    return this.#origin;
  }

  async listen(port = 0): Promise<number> {
    if (!existsSync(this.#indexPath) || !statSync(this.#indexPath).isFile()) {
      throw new Error(`Locked OpenCode UI is missing: ${this.#indexPath}`);
    }
    await new Promise<void>((resolveListen, reject) => {
      const onError = (error: Error): void => reject(error);
      this.#server.once('error', onError);
      this.#server.listen(port, '127.0.0.1', () => {
        this.#server.off('error', onError);
        resolveListen();
      });
    });
    const address = this.#server.address();
    if (!address || typeof address === 'string') throw new Error('OpenCode native UI gateway has no TCP address');
    this.#origin = `http://127.0.0.1:${address.port}`;
    return address.port;
  }

  async stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#stopPromise = (async () => {
      this.#tokens.clear();
      this.#resolutions.clear();
      if (!this.#server.listening) return;
      await new Promise<void>((resolveClose, reject) => {
        this.#server.close((error) => error ? reject(error) : resolveClose());
        this.#server.closeAllConnections();
      });
    })();
    return this.#stopPromise;
  }

  async launch(defSessionId: DefSessionId, claims: AgentUiCapabilityClaims): Promise<OpenCodeNativeUiLaunch> {
    const consumer = this.#consumers.requireActive(claims);
    const session = this.#host.readSession(defSessionId, consumer.binding);
    if (session.status !== 'ready') {
      throw new DefAgentHostError(
        'AGENT_SESSION_NOT_READY',
        `DEF Session ${defSessionId} cannot open its native UI from ${session.status}`,
        409,
      );
    }
    const directory = await this.#engine.nativeUiDirectory();
    const token = this.#issueToken(claims);
    return {
      defSessionId,
      src: this.#sessionUrl(directory, session.engine.sessionId, token),
    };
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const url = new URL(request.url ?? '/', this.#origin || 'http://127.0.0.1');
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': this.#browserOrigin,
        'Access-Control-Allow-Methods': 'GET,HEAD,POST,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'authorization,content-type',
        Vary: 'Origin',
      });
      response.end();
      return;
    }

    if (url.pathname.startsWith('/api/native/')) {
      const access = this.#requireAccess(request, url);
      await this.#handleNativeApi(request, response, url, access);
      return;
    }

    if (isOpenCodeApiPath(url.pathname)) {
      const access = this.#requireAccess(request, url);
      await this.#handleOpenCodeApi(request, response, url, access);
      return;
    }

    await this.#serveUi(request, response, url);
  }

  async #serveUi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      throw new DefAgentHostError('AGENT_NATIVE_UI_ROUTE_DENIED', 'Native UI route is read-only', 405);
    }
    let requestedPath: string;
    try {
      requestedPath = decodeURIComponent(url.pathname);
    } catch {
      throw new DefAgentHostError('AGENT_NATIVE_UI_ROUTE_INVALID', 'Native UI path is invalid', 400);
    }
    const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.replace(/^\/+/, '');
    const candidate = resolve(this.#uiRoot, relativePath);
    const insideRoot = candidate === this.#uiRoot || candidate.startsWith(`${this.#uiRoot}${sep}`);
    const isAsset = insideRoot && existsSync(candidate) && statSync(candidate).isFile();
    const acceptsHtml = String(request.headers.accept ?? '').includes('text/html');
    if (isAsset && candidate !== this.#indexPath) {
      const size = statSync(candidate).size;
      response.writeHead(200, {
        'Content-Type': MIME_TYPES[extname(candidate).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': size,
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(candidate).pipe(response);
      return;
    }
    if (!isAsset && !acceptsHtml) {
      throw new DefAgentHostError('AGENT_NATIVE_UI_ROUTE_NOT_FOUND', 'Native UI asset was not found', 404);
    }

    const access = this.#requireAccess(request, url);
    const route = this.#readSessionRoute(url.pathname);
    if (!route) {
      throw new DefAgentHostError('AGENT_NATIVE_UI_SESSION_REQUIRED', 'Native UI requires a DEF Session route', 404);
    }
    const session = this.#sessionForEngine(route.engineSessionId, access.binding);
    const directory = await this.#engine.nativeUiDirectory();
    const body = this.#renderIndex({
      directory,
      engineSessionId: session.engine.sessionId,
    });
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "media-src 'self' data:",
        "connect-src 'self'",
        `frame-ancestors ${this.#browserOrigin}`,
      ].join('; '),
      'Set-Cookie': `${TOKEN_COOKIE}=${access.token}; HttpOnly; SameSite=Strict; Path=/`,
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  }

  async #handleNativeApi(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    access: NativeUiAccess,
  ): Promise<void> {
    if (request.method === 'POST' && url.pathname === '/api/native/session') {
      await readJson(request);
      const created = await this.#host.createSession({
        binding: access.binding,
        providerProfileRef: this.#providerProfileRef,
      });
      const directory = await this.#engine.nativeUiDirectory();
      this.#writeJson(response, 201, {
        ok: true,
        session: {
          id: created.engine.sessionId,
          host: 'workbench',
          directory,
          uiPath: this.#sessionPath(directory, created.engine.sessionId, access.token),
        },
      });
      return;
    }

    const recover = /^\/api\/native\/session\/([^/]+)\/recover$/u.exec(url.pathname);
    if (request.method === 'POST' && recover) {
      await readJson(request);
      const session = this.#sessionForEngine(decodeURIComponent(recover[1]!), access.binding);
      const directory = await this.#engine.nativeUiDirectory();
      this.#writeJson(response, 200, {
        ok: true,
        session: {
          recovered: false,
          id: session.engine.sessionId,
          host: 'workbench',
          directory,
        },
      });
      return;
    }

    const remove = /^\/api\/native\/session\/([^/]+)$/u.exec(url.pathname);
    if (request.method === 'DELETE' && remove) {
      const session = this.#sessionForEngine(decodeURIComponent(remove[1]!), access.binding);
      await this.#host.deleteSession(session.defSessionId, access.binding);
      this.#writeJson(response, 200, { ok: true, deleted: true });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/native/bootstrap') {
      const engineSessionId = url.searchParams.get('sessionID') ?? '';
      const session = this.#sessionForEngine(engineSessionId, access.binding);
      this.#writeJson(response, 200, {
        ok: true,
        binding: {
          host: 'workbench',
          defSessionId: session.defSessionId,
          sessionID: session.engine.sessionId,
        },
        profile: embeddedProfile(),
      });
      return;
    }

    const questionDecision = /^\/api\/native\/question\/([^/]+)\/(reply|ignore|stop)$/u.exec(url.pathname);
    if (request.method === 'POST' && questionDecision) {
      const body = expectRecord(await readJson(request));
      const projection = this.#requireInteraction(
        decodePathSegment(questionDecision[1]!),
        'question',
        access.binding,
      );
      if (body.sessionID !== projection.sessionID) {
        throw new DefAgentHostError(
          'AGENT_INTERACTION_CONFLICT',
          'Question does not belong to the visible OpenCode Session',
          409,
        );
      }
      const action = questionDecision[2]!;
      if (action === 'stop') {
        await this.#host.abortTurn(projection.interaction.defTurnId, 'USER_STOPPED', access.binding);
      } else {
        const resolution = action === 'reply'
          ? this.#host.resolveInteraction(
              projection.interaction.interactionId,
              { status: 'answered', value: readQuestionAnswer(body.answers) },
              access.binding,
            )
          : this.#host.resolveInteraction(
              projection.interaction.interactionId,
              { status: 'cancelled' },
              access.binding,
            );
        this.#rememberResolution(resolution);
      }
      this.#writeJson(response, 200, { ok: true });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/native/node-review') {
      this.#writeJson(response, 200, { ok: true, bound: false, diffs: [], report: null });
      return;
    }

    throw new DefAgentHostError('AGENT_NATIVE_UI_ROUTE_NOT_FOUND', 'Native UI adapter route was not found', 404);
  }

  async #handleOpenCodeApi(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    access: NativeUiAccess,
  ): Promise<void> {
    const method = request.method ?? 'GET';
    if (method === 'GET' && url.pathname === '/global/event') {
      await this.#streamGlobalEvents(request, response, url, access);
      return;
    }
    if (method === 'GET' && (url.pathname === '/question' || url.pathname === '/permission')) {
      const kind = url.pathname === '/question' ? 'question' : 'approval';
      const pending = this.#projectInteractions(access.binding)
        .filter((projection) => projection.kind === kind)
        .map((projection) => projection.payload);
      this.#writeJson(response, 200, pending);
      return;
    }

    const sessionRoute = /^\/session\/([^/]+)(?:\/(.*))?$/u.exec(url.pathname);
    const routeSession = sessionRoute && sessionRoute[1] !== 'status'
      ? this.#sessionForEngine(decodeURIComponent(sessionRoute[1]!), access.binding)
      : null;

    const permissionDecision = /^\/session\/([^/]+)\/permissions\/([^/]+)$/u.exec(url.pathname);
    if (method === 'POST' && permissionDecision) {
      const session = this.#sessionForEngine(decodePathSegment(permissionDecision[1]!), access.binding);
      const projection = this.#requireInteraction(
        decodePathSegment(permissionDecision[2]!),
        'approval',
        access.binding,
      );
      if (projection.sessionID !== session.engine.sessionId) {
        throw new DefAgentHostError(
          'AGENT_INTERACTION_CONFLICT',
          'Approval does not belong to the visible OpenCode Session',
          409,
        );
      }
      const body = expectRecord(await readJson(request));
      if (body.response === 'always') {
        throw new DefAgentHostError(
          'AGENT_NATIVE_UI_MUTATION_DENIED',
          'DEF approvals are intentionally single-use',
          400,
        );
      }
      if (body.response !== 'once' && body.response !== 'reject') {
        throw new DefAgentHostError('AGENT_REQUEST_INVALID', 'Permission response is invalid', 400);
      }
      const resolution = this.#host.resolveInteraction(
        projection.interaction.interactionId,
        { status: body.response === 'once' ? 'approved' : 'rejected' },
        access.binding,
      );
      this.#rememberResolution(resolution);
      this.#writeJson(response, 200, true);
      return;
    }

    if (method === 'POST' && sessionRoute && ['prompt_async', 'message'].includes(sessionRoute[2] ?? '')) {
      if (!routeSession) throw new DefAgentHostError('AGENT_SESSION_NOT_FOUND', 'Native session was not found', 404);
      const body = expectRecord(await readJson(request));
      const messageId = expectNativeMessageId(body.messageID);
      const prompt = readPromptParts(body.parts);
      const clientTurnId = asClientTurnId(`native-${messageId}`);
      await this.#host.startHarnessTurn({
        defSessionId: routeSession.defSessionId,
        userMessage: prompt.userMessage,
        ...(prompt.userAttachments.length > 0 ? { userAttachments: prompt.userAttachments } : {}),
        clientTurnId,
        engineUserMessageId: asEngineMessageId(messageId),
        binding: access.binding,
      });
      response.writeHead(204, { 'Cache-Control': 'no-store' });
      response.end();
      return;
    }

    if (method === 'POST' && sessionRoute?.[2] === 'abort') {
      if (!routeSession) throw new DefAgentHostError('AGENT_SESSION_NOT_FOUND', 'Native session was not found', 404);
      const active = this.#host.getActiveIds();
      if (active.defSessionId === routeSession.defSessionId && active.defTurnId) {
        await this.#host.abortTurn(active.defTurnId, 'USER_STOPPED', access.binding);
      }
      this.#writeJson(response, 200, true);
      return;
    }

    if (method === 'POST' && url.pathname === '/session') {
      await readJson(request);
      const created = await this.#host.createSession({
        binding: access.binding,
        providerProfileRef: this.#providerProfileRef,
      });
      await this.#proxyEngineResponse(
        response,
        await this.#engine.requestNativeUi(`/session/${encodeURIComponent(created.engine.sessionId)}`),
      );
      return;
    }

    if (method === 'DELETE' && sessionRoute && !sessionRoute[2]) {
      if (!routeSession) throw new DefAgentHostError('AGENT_SESSION_NOT_FOUND', 'Native session was not found', 404);
      await this.#host.deleteSession(routeSession.defSessionId, access.binding);
      this.#writeJson(response, 200, true);
      return;
    }

    if (method === 'PATCH' && sessionRoute && !sessionRoute[2]) {
      if (!routeSession) throw new DefAgentHostError('AGENT_SESSION_NOT_FOUND', 'Native session was not found', 404);
      const body = expectRecord(await readJson(request));
      if (!Object.keys(body).every((key) => key === 'title')) {
        throw new DefAgentHostError('AGENT_NATIVE_UI_MUTATION_DENIED', 'Only native session titles may be updated directly', 403);
      }
      await this.#proxyEngineResponse(response, await this.#engine.requestNativeUi(
        `${url.pathname}${url.search}`,
        { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } },
      ));
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      throw new DefAgentHostError(
        'AGENT_NATIVE_UI_MUTATION_DENIED',
        `OpenCode native UI mutation ${method} ${url.pathname} is disabled by DEF Host`,
        403,
      );
    }
    if (/^\/pty(?:\/|$)/u.test(url.pathname)) {
      throw new DefAgentHostError('AGENT_NATIVE_UI_ROUTE_DENIED', 'OpenCode terminal routes are disabled', 403);
    }

    if (method === 'GET' && url.pathname === '/session') {
      const upstream = await this.#engine.requestNativeUi(`${url.pathname}${url.search}`);
      const body = await upstream.json() as unknown;
      const allowed = this.#allowedEngineSessionIds(access.binding);
      const sessions = Array.isArray(body)
        ? body.filter((value) => isRecord(value) && typeof value.id === 'string' && allowed.has(value.id))
        : [];
      this.#writeJson(response, upstream.status, sessions);
      return;
    }

    if (method === 'GET' && url.pathname === '/session/status') {
      const upstream = await this.#engine.requestNativeUi(`${url.pathname}${url.search}`);
      const body = await upstream.json() as unknown;
      const allowed = this.#allowedEngineSessionIds(access.binding);
      const filtered = isRecord(body)
        ? Object.fromEntries(Object.entries(body).filter(([id]) => allowed.has(id)))
        : {};
      this.#writeJson(response, upstream.status, filtered);
      return;
    }

    await this.#proxyEngineResponse(
      response,
      await this.#engine.requestNativeUi(`${url.pathname}${url.search}`, {
        method,
        headers: { accept: String(request.headers.accept ?? 'application/json') },
      }),
    );
  }

  #projectInteractions(binding: ProductBinding): readonly NativeInteractionProjection[] {
    const sessions = new Map(this.#host.listSessions(binding).map((session) => [
      session.defSessionId,
      session.engine.sessionId,
    ]));
    const projections: NativeInteractionProjection[] = [];
    for (const interaction of this.#host.listPendingInteractions(binding)) {
      const sessionID = sessions.get(interaction.defSessionId);
      if (!sessionID) continue;
      if (interaction.kind === 'question') {
        const options = readQuestionOptions(interaction.details?.options);
        const payload: NativeQuestionRequest = {
          id: interaction.interactionId,
          sessionID,
          questions: [{
            header: readQuestionHeader(interaction.details?.header),
            question: interaction.prompt,
            options: options.map((label) => ({ label, description: '' })),
            multiple: false,
            custom: true,
          }],
        };
        projections.push({
          kind: 'question' as const,
          interaction,
          sessionID,
          payload,
          fingerprint: JSON.stringify(payload),
        });
        continue;
      }
      const payload: NativePermissionRequest = {
        id: interaction.interactionId,
        sessionID,
        permission: 'def_mutation',
        patterns: approvalPatterns(interaction),
        metadata: {
          proposalHash: interaction.proposalHash,
          scope: [...interaction.scope],
          proposal: structuredClone(interaction.proposal),
          binding: structuredClone(interaction.binding),
          expiresAt: interaction.expiresAt,
        },
        always: [],
      };
      projections.push({
        kind: 'approval' as const,
        interaction,
        sessionID,
        payload,
        fingerprint: JSON.stringify(payload),
      });
    }
    return projections;
  }

  #requireInteraction(
    interactionId: string,
    kind: 'question',
    binding: ProductBinding,
  ): Extract<NativeInteractionProjection, { readonly kind: 'question' }>;
  #requireInteraction(
    interactionId: string,
    kind: 'approval',
    binding: ProductBinding,
  ): Extract<NativeInteractionProjection, { readonly kind: 'approval' }>;
  #requireInteraction(
    interactionId: string,
    kind: NativeInteractionProjection['kind'],
    binding: ProductBinding,
  ): NativeInteractionProjection {
    const projection = this.#projectInteractions(binding)
      .find((candidate) => candidate.interaction.interactionId === interactionId);
    if (!projection) {
      throw new DefAgentHostError('AGENT_INTERACTION_NOT_FOUND', 'Native interaction is no longer pending', 404);
    }
    if (projection.kind !== kind) {
      throw new DefAgentHostError(
        'AGENT_INTERACTION_CONFLICT',
        'Native interaction kind does not match the requested action',
        409,
      );
    }
    return projection;
  }

  #rememberResolution(response: InteractionResponse): void {
    this.#resolutions.set(response.interactionId, {
      response: structuredClone(response),
      expiresAt: this.#clock() + RESOLUTION_MEMORY_MS,
    });
  }

  #sweepResolutions(): void {
    const now = this.#clock();
    for (const [interactionId, resolution] of this.#resolutions) {
      if (resolution.expiresAt <= now) this.#resolutions.delete(interactionId);
    }
  }

  async #streamGlobalEvents(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    access: NativeUiAccess,
  ): Promise<void> {
    const abortController = new AbortController();
    const upstream = await this.#engine.requestNativeUi(`${url.pathname}${url.search}`, {
      method: 'GET',
      headers: { accept: 'text/event-stream' },
      signal: abortController.signal,
    });
    if (!upstream.ok || !upstream.body) {
      await this.#proxyEngineResponse(response, upstream);
      return;
    }

    const directory = await this.#engine.nativeUiDirectory();
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });

    let closed = false;
    let previous = new Map<string, NativeInteractionProjection>();
    const close = (): void => {
      if (closed) return;
      closed = true;
      abortController.abort();
    };
    request.once('aborted', close);
    response.once('close', close);

    const synchronize = (): void => {
      if (closed) return;
      this.#sweepResolutions();
      const current = new Map<string, NativeInteractionProjection>(this.#projectInteractions(access.binding).map((projection) => [
        projection.interaction.interactionId,
        projection,
      ]));
      for (const [interactionId, projection] of current) {
        if (previous.get(interactionId)?.fingerprint === projection.fingerprint) continue;
        response.write(nativeEventFrame(directory, nativeAskedEvent(projection)));
      }
      for (const [interactionId, projection] of previous) {
        if (current.has(interactionId)) continue;
        response.write(nativeEventFrame(
          directory,
          nativeResolvedEvent(projection, this.#resolutions.get(interactionId)?.response),
        ));
      }
      previous = current;
    };

    synchronize();
    const interval = setInterval(() => {
      try {
        synchronize();
      } catch (error) {
        this.#diagnostic(`AGENT_NATIVE_UI_EVENT_SYNC_FAILED: ${error instanceof Error ? error.message : String(error)}`);
        response.destroy(error instanceof Error ? error : new Error(String(error)));
        close();
      }
    }, INTERACTION_POLL_MS);

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const parsed = takeSseFrames(buffer);
        buffer = parsed.rest;
        for (const frame of parsed.frames) {
          if (!closed) response.write(frame);
        }
        if (Buffer.byteLength(buffer) > 4_194_304) {
          throw new Error('OpenCode global event frame is too large');
        }
      }
      buffer += decoder.decode();
      const parsed = takeSseFrames(buffer);
      for (const frame of parsed.frames) {
        if (!closed) response.write(frame);
      }
      if (!closed) response.end();
    } catch (error) {
      if (!closed) response.destroy(error instanceof Error ? error : new Error(String(error)));
    } finally {
      clearInterval(interval);
      close();
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
      request.off('aborted', close);
      response.off('close', close);
    }
  }

  async #proxyEngineResponse(response: ServerResponse, upstream: Response): Promise<void> {
    const headers: Record<string, string> = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    // The native UI intentionally fetches only the newest two messages first
    // and follows OpenCode's cursor until the visible transcript is filled.
    // Dropping this header makes a tool-heavy turn look like an empty session
    // when its last two records are assistant-only loop steps.
    for (const name of ['content-type', 'etag', 'x-next-cursor']) {
      const value = upstream.headers.get(name);
      if (value) headers[name] = value;
    }
    response.writeHead(upstream.status, headers);
    if (!upstream.body) {
      response.end();
      return;
    }
    const reader = upstream.body.getReader();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        response.write(Buffer.from(chunk.value));
      }
      response.end();
    } catch (error) {
      response.destroy(error instanceof Error ? error : new Error(String(error)));
    } finally {
      reader.releaseLock();
    }
  }

  #requireAccess(request: IncomingMessage, url: URL): NativeUiAccess {
    this.#sweepTokens();
    const queryToken = readAuthToken(url.searchParams.get('auth_token'));
    const basicToken = readBasicToken(request.headers.authorization);
    const cookieToken = readCookie(request.headers.cookie, TOKEN_COOKIE);
    const token = queryToken || basicToken || cookieToken;
    if (!token) throw new DefAgentHostError('AGENT_NATIVE_UI_UNAUTHORIZED', 'Native UI authorization is required', 401);
    const record = this.#tokens.get(tokenDigest(token));
    if (!record || record.expiresAt <= this.#clock()) {
      throw new DefAgentHostError('AGENT_NATIVE_UI_UNAUTHORIZED', 'Native UI authorization is invalid or expired', 401);
    }
    const consumer = this.#consumers.currentFor(record.claims);
    if (!consumer) {
      throw new DefAgentHostError('AGENT_CONSUMER_REQUIRED', 'A visible writer consumer is required', 409);
    }
    return { token, binding: consumer.binding };
  }

  #issueToken(claims: AgentUiCapabilityClaims): string {
    this.#sweepTokens();
    const token = this.#randomToken();
    if (!isSecureToken(token)) throw new Error('Native UI token generator returned an unsafe token');
    this.#tokens.set(tokenDigest(token), {
      claims,
      expiresAt: Math.min(claims.expiresAt, this.#clock() + TOKEN_TTL_MS),
    });
    return token;
  }

  #sweepTokens(): void {
    const now = this.#clock();
    for (const [digest, record] of this.#tokens) {
      if (record.expiresAt <= now || !this.#consumers.currentFor(record.claims)) this.#tokens.delete(digest);
    }
  }

  #sessionForEngine(engineSessionId: string, binding: ProductBinding) {
    const session = this.#host.listSessions(binding).find((candidate) => (
      candidate.engine.kind === 'opencode' && candidate.engine.sessionId === engineSessionId
    ));
    if (!session) {
      throw new DefAgentHostError('AGENT_SESSION_NOT_FOUND', 'OpenCode session is not bound to this Workbench', 404);
    }
    return session;
  }

  #allowedEngineSessionIds(binding: ProductBinding): Set<string> {
    return new Set(this.#host.listSessions(binding).map((session) => session.engine.sessionId));
  }

  #readSessionRoute(pathname: string): { readonly engineSessionId: string } | null {
    const parts = pathname.split('/').filter(Boolean);
    const offset = parts.lastIndexOf('session');
    if (offset < 1 || !parts[offset + 1]) return null;
    try {
      return { engineSessionId: decodeURIComponent(parts[offset + 1]!) };
    } catch {
      return null;
    }
  }

  #sessionUrl(directory: string, engineSessionId: string, token: string): string {
    return new URL(this.#sessionPath(directory, engineSessionId, token), this.origin).toString();
  }

  #sessionPath(directory: string, engineSessionId: string, token: string): string {
    const directorySlug = Buffer.from(directory, 'utf8').toString('base64url');
    const authToken = Buffer.from(`def-ui:${token}`, 'utf8').toString('base64');
    const query = new URLSearchParams({ auth_token: authToken, def_host: 'workbench' });
    return `/${directorySlug}/session/${encodeURIComponent(engineSessionId)}?${query}`;
  }

  #renderIndex(session: { readonly directory: string; readonly engineSessionId: string }): string {
    const source = readFileSync(this.#indexPath, 'utf8');
    const profile = safeJson(embeddedProfile());
    const nativeSession = safeJson({ sessionID: session.engineSessionId, directory: session.directory });
    const bootstrap = `<script>window.__DEF_EMBEDDED_PROFILE__=${profile};window.__DEF_NATIVE_SESSION__=${nativeSession};document.documentElement.dataset.defHost="workbench";try{localStorage.setItem("opencode.settings.dat:defaultServerUrl",location.origin)}catch{};document.title="DEF · 排轴助手";</script><style id="def-native-host-style">html[data-def-host="workbench"] [data-slot="permission-footer-actions"]>button:nth-child(2){display:none!important}</style>`;
    return source
      .replace('<title>OpenCode</title>', '<title>DEF · 排轴助手</title>')
      .replace('</head>', `${bootstrap}</head>`);
  }

  #writeJson(response: ServerResponse, status: number, body: unknown): void {
    const encoded = Buffer.from(JSON.stringify(body));
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': encoded.length,
      'Cache-Control': 'no-store',
    });
    response.end(encoded);
  }

  #writeError(response: ServerResponse, error: unknown): void {
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const status = error instanceof DefAgentHostError ? error.statusCode : 500;
    const code = error instanceof DefAgentHostError ? error.code : 'AGENT_NATIVE_UI_FAILED';
    const message = error instanceof DefAgentHostError ? error.message : 'OpenCode native UI request failed';
    this.#diagnostic(`${code}: ${error instanceof Error ? error.message : String(error)}`);
    this.#writeJson(response, status, { ok: false, error: { code, message } });
  }
}

type NativeUiAccess = {
  readonly token: string;
  readonly binding: ProductBinding;
};

function embeddedProfile() {
  return {
    schemaVersion: 1,
    host: 'workbench',
    agent: 'def-engine',
    skillId: 'workbench',
    theme: 'def-line-blue',
    lockedAgent: true,
    lockedModel: true,
    features: {
      sessionCreate: true,
      sessionList: true,
      sessionArchive: false,
      nodeReview: false,
      nodeFiles: false,
      nodeApproval: false,
      modelSelect: false,
      providerManage: false,
      serverManage: false,
      projectManage: false,
      terminalOpen: false,
      gitManage: false,
      shareSession: false,
      settingsAppearance: false,
      settingsShortcuts: false,
    },
  } as const;
}

function isOpenCodeApiPath(pathname: string): boolean {
  if (pathname === '/global/health' || pathname === '/global/event' || pathname === '/global/config') return true;
  return [
    '/agent', '/command', '/config', '/event', '/file', '/find', '/formatter',
    '/lsp', '/mcp', '/path', '/permission', '/project', '/provider', '/question',
    '/session', '/skill', '/vcs', '/worktree', '/experimental', '/log',
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

const USER_ATTACHMENT_MIMES = new Set([
  'application/pdf',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
]);

function readPromptParts(parts: unknown): {
  readonly userMessage: string;
  readonly userAttachments: readonly EngineUserAttachment[];
} {
  if (!Array.isArray(parts)) {
    throw new DefAgentHostError('AGENT_REQUEST_INVALID', 'Native prompt parts must be an array', 400);
  }
  const textParts: string[] = [];
  const userAttachments: EngineUserAttachment[] = [];
  let attachmentBytes = 0;
  for (const part of parts) {
    if (!isRecord(part)) {
      throw new DefAgentHostError('AGENT_REQUEST_INVALID', 'Native prompt part is invalid', 400);
    }
    if (part.type === 'text' && typeof part.text === 'string') {
      textParts.push(part.text);
      continue;
    }
    if (part.type !== 'file') {
      throw new DefAgentHostError(
        'AGENT_REQUEST_INVALID',
        'Only text and uploaded file parts are supported by the DEF Host',
        400,
      );
    }
    if (userAttachments.length >= MAX_USER_ATTACHMENTS) {
      throw new DefAgentHostError('AGENT_REQUEST_TOO_LARGE', 'Too many native prompt attachments', 413);
    }
    const attachment = readUserAttachment(part, userAttachments.length);
    attachmentBytes += attachment.bytes;
    if (attachmentBytes > MAX_USER_ATTACHMENT_BYTES) {
      throw new DefAgentHostError('AGENT_REQUEST_TOO_LARGE', 'Native prompt attachments are too large', 413);
    }
    userAttachments.push(attachment.value);
  }
  const userMessage = textParts.join('\n').trim();
  if (!userMessage) throw new DefAgentHostError('AGENT_REQUEST_INVALID', 'Native prompt text is required', 400);
  return { userMessage, userAttachments };
}

function readUserAttachment(
  part: Record<string, unknown>,
  index: number,
): { readonly value: EngineUserAttachment; readonly bytes: number } {
  if (typeof part.mime !== 'string' || typeof part.url !== 'string') {
    throw new DefAgentHostError('AGENT_REQUEST_INVALID', 'Native attachment metadata is invalid', 400);
  }
  const mime = part.mime.trim().toLowerCase();
  if (!USER_ATTACHMENT_MIMES.has(mime)) {
    throw new DefAgentHostError('AGENT_REQUEST_INVALID', `Native attachment MIME is not supported: ${mime}`, 400);
  }
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/u.exec(part.url);
  if (!match || match[1]?.toLowerCase() !== mime || match[2]!.length % 4 !== 0) {
    throw new DefAgentHostError(
      'AGENT_REQUEST_INVALID',
      'Native attachments must be matching base64 data URLs; paths and remote URLs are disabled',
      400,
    );
  }
  const bytes = Buffer.from(match[2]!, 'base64');
  if (bytes.toString('base64') !== match[2]) {
    throw new DefAgentHostError('AGENT_REQUEST_INVALID', 'Native attachment base64 is invalid', 400);
  }
  return {
    value: {
      type: 'file',
      mime,
      filename: normalizeAttachmentFilename(part.filename, mime, index),
      url: part.url,
    },
    bytes: bytes.length,
  };
}

function normalizeAttachmentFilename(value: unknown, mime: string, index: number): string {
  const fallbackExtension = mime === 'application/pdf'
    ? 'pdf'
    : mime === 'text/plain'
      ? 'txt'
      : mime.split('/')[1]?.replace('jpeg', 'jpg') ?? 'bin';
  if (typeof value !== 'string') return `attachment-${index + 1}.${fallbackExtension}`;
  const basename = value.split(/[\\/]/u).at(-1)?.replace(/[\u0000-\u001f\u007f]/gu, '').trim() ?? '';
  return basename ? basename.slice(0, 240) : `attachment-${index + 1}.${fallbackExtension}`;
}

function readQuestionAnswer(value: unknown): JsonValue {
  if (!Array.isArray(value) || value.length !== 1 || !Array.isArray(value[0])) {
    throw new DefAgentHostError('AGENT_REQUEST_INVALID', 'Native question answer is invalid', 400);
  }
  const answers = value[0];
  if (
    answers.length !== 1
    || typeof answers[0] !== 'string'
    || !answers[0].trim()
    || answers[0].length > 8_000
  ) {
    throw new DefAgentHostError('AGENT_REQUEST_INVALID', 'Native question requires one bounded answer', 400);
  }
  return answers[0].trim();
}

function readQuestionOptions(value: JsonValue | undefined): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((option) => (
    typeof option === 'string' && option.trim() ? [option.trim().slice(0, 200)] : []
  )).slice(0, 8);
}

function readQuestionHeader(value: JsonValue | undefined): string {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 80)
    : '需要回答';
}

function approvalPatterns(
  interaction: Extract<InteractionRequest, { readonly kind: 'approval' }>,
): readonly string[] {
  const patterns = [interaction.prompt];
  if (interaction.scope.length > 0) patterns.push(`作用范围：${interaction.scope.join('、')}`);
  const proposal = JSON.stringify(interaction.proposal, null, 2);
  patterns.push(`变更提案：\n${proposal.length > 6_000 ? `${proposal.slice(0, 6_000)}…` : proposal}`);
  return patterns;
}

function nativeAskedEvent(projection: NativeInteractionProjection) {
  return {
    id: `evt_def_${randomBytes(12).toString('hex')}`,
    type: projection.kind === 'question' ? 'question.asked' : 'permission.asked',
    properties: projection.payload,
  };
}

function nativeResolvedEvent(
  projection: NativeInteractionProjection,
  resolution: InteractionResponse | undefined,
) {
  if (projection.kind === 'question') {
    if (resolution?.status === 'answered') {
      return {
        id: `evt_def_${randomBytes(12).toString('hex')}`,
        type: 'question.replied',
        properties: {
          sessionID: projection.sessionID,
          requestID: projection.interaction.interactionId,
          answers: [[questionAnswerText(resolution.value)]],
        },
      };
    }
    return {
      id: `evt_def_${randomBytes(12).toString('hex')}`,
      type: 'question.rejected',
      properties: {
        sessionID: projection.sessionID,
        requestID: projection.interaction.interactionId,
      },
    };
  }
  return {
    id: `evt_def_${randomBytes(12).toString('hex')}`,
    type: 'permission.replied',
    properties: {
      sessionID: projection.sessionID,
      requestID: projection.interaction.interactionId,
      reply: resolution?.status === 'approved' ? 'once' : 'reject',
    },
  };
}

function questionAnswerText(value: JsonValue | undefined): string {
  if (typeof value === 'string') return value;
  return value === undefined ? '' : JSON.stringify(value);
}

function nativeEventFrame(directory: string, payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify({ directory, payload })}\n\n`;
}

function takeSseFrames(value: string): { readonly frames: readonly string[]; readonly rest: string } {
  const frames: string[] = [];
  let rest = value;
  for (;;) {
    const separator = /\r?\n\r?\n/u.exec(rest);
    if (!separator || separator.index === undefined) break;
    const end = separator.index + separator[0].length;
    frames.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  return { frames, rest };
}

function decodePathSegment(value: string): string {
  try {
    const decoded = decodeURIComponent(value).trim();
    if (!decoded || decoded.includes('/') || decoded.includes('\u0000')) throw new Error('invalid segment');
    return decoded;
  } catch {
    throw new DefAgentHostError('AGENT_NATIVE_UI_ROUTE_INVALID', 'Native UI path segment is invalid', 400);
  }
}

function expectNativeMessageId(value: unknown): string {
  if (typeof value !== 'string' || !MESSAGE_ID_PATTERN.test(value)) {
    throw new DefAgentHostError('AGENT_REQUEST_INVALID', 'Native OpenCode messageID is invalid', 400);
  }
  return value;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_REQUEST_BYTES) {
      throw new DefAgentHostError('AGENT_REQUEST_TOO_LARGE', 'Native UI request is too large', 413);
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new DefAgentHostError('AGENT_REQUEST_INVALID', 'Native UI request is not valid JSON', 400);
  }
}

function expectRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new DefAgentHostError('AGENT_REQUEST_INVALID', 'Native UI request must be an object', 400);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readAuthToken(value: string | null): string {
  if (!value) return '';
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    return separator >= 0 ? decoded.slice(separator + 1) : '';
  } catch {
    return '';
  }
}

function readBasicToken(value: string | undefined): string {
  if (!value?.startsWith('Basic ')) return '';
  return readAuthToken(value.slice(6).trim());
}

function readCookie(value: string | undefined, name: string): string {
  if (!value) return '';
  for (const item of value.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function tokenDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isSecureToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{20,200}$/u.test(value);
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Browser origin is invalid');
  }
  return url.origin;
}
