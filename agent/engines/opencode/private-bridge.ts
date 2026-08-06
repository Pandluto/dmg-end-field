import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { JsonObject, JsonValue } from '../../core/contracts/index.ts';
import { OPENCODE_TOOL_BINDINGS, type OpenCodeSafeToolName } from './tool-bindings.ts';
import { OpenCodeEngineError } from './errors.ts';

export const OPENCODE_BRIDGE_TOKEN_HEADER = 'x-def-opencode-bridge-token';
export const OPENCODE_PLUGIN_PROTOCOL_VERSION = 1 as const;
export const OPENCODE_PLUGIN_BUILD_ID = 'def-opencode-engine-phase4-v1' as const;
const MAX_REQUEST_BYTES = 1_048_576;
const safeToolNames = new Set<string>(OPENCODE_TOOL_BINDINGS.map(([, safeName]) => safeName));

export interface OpenCodeBridgeTurnState {
  readonly engineTurnId: string;
  readonly turnLease: string;
  readonly userMessageId: string;
  readonly systemContext: string;
  readonly projectionRevision: number;
  readonly safeTools: readonly OpenCodeSafeToolName[];
  readonly projectedTools: readonly {
    readonly safeName: OpenCodeSafeToolName;
    readonly description: string;
    readonly inputSchema: JsonObject;
    readonly risk: 'read';
  }[];
}

export interface OpenCodeBridgeToolRequest {
  readonly sessionId: string;
  readonly messageId: string;
  readonly callId: string;
  readonly engineTurnId: string;
  readonly turnLease: string;
  readonly userMessageId: string;
  readonly safeToolName: OpenCodeSafeToolName;
  readonly input: JsonValue;
  readonly projectionRevision: number;
}

export type OpenCodeBridgeToolResponse =
  | { readonly status: 'succeeded'; readonly result: JsonValue }
  | {
      readonly status: 'failed';
      readonly code: string;
      readonly message: string;
      readonly details?: JsonValue;
    };

export interface OpenCodeBridgeTurnController {
  state(): OpenCodeBridgeTurnState;
  requestTool(input: OpenCodeBridgeToolRequest): Promise<OpenCodeBridgeToolResponse>;
}

export interface OpenCodePluginReadyExpectation {
  readonly protocolVersion: typeof OPENCODE_PLUGIN_PROTOCOL_VERSION;
  readonly buildId: typeof OPENCODE_PLUGIN_BUILD_ID;
  readonly processNonce: string;
  readonly runtimeVersion: string;
  readonly directory: string;
}

type PluginExpectationRecord = {
  readonly expected: OpenCodePluginReadyExpectation;
  readonly promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
};

export class OpenCodePrivateBridge {
  readonly #token: string;
  readonly #server: Server;
  readonly #turns = new Map<string, OpenCodeBridgeTurnController>();
  #origin = '';
  #startPromise: Promise<string> | null = null;
  #stopPromise: Promise<void> | null = null;
  #pluginExpectation: PluginExpectationRecord | null = null;

  constructor(options: { readonly token?: string } = {}) {
    this.#token = options.token ?? randomBytes(32).toString('base64url');
    if (this.#token.length < 32) throw new TypeError('OpenCode private bridge token is too short');
    this.#server = createServer((request, response) => {
      void this.#handle(request, response).catch((error: unknown) => {
        this.#writeJson(response, 500, {
          error: { code: 'OPENCODE_BRIDGE_INTERNAL', message: safeBridgeMessage(error) },
        });
      });
    });
  }

  get token(): string {
    return this.#token;
  }

  get origin(): string {
    if (!this.#origin) throw new Error('OpenCode private bridge is not listening');
    return this.#origin;
  }

  start(): Promise<string> {
    if (this.#origin) return Promise.resolve(this.#origin);
    if (this.#startPromise) return this.#startPromise;
    this.#startPromise = new Promise<string>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      this.#server.once('error', onError);
      this.#server.listen(0, '127.0.0.1', () => {
        this.#server.off('error', onError);
        const address = this.#server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('OpenCode private bridge has no TCP address'));
          return;
        }
        this.#origin = `http://127.0.0.1:${address.port}`;
        resolve(this.#origin);
      });
    }).finally(() => {
      this.#startPromise = null;
    });
    return this.#startPromise;
  }

  register(sessionId: string, controller: OpenCodeBridgeTurnController): void {
    if (!sessionId.trim()) throw new TypeError('OpenCode bridge sessionId is required');
    if (this.#turns.has(sessionId)) {
      throw new OpenCodeEngineError(
        'OPENCODE_BRIDGE_CORRELATION_FAILED',
        `OpenCode session ${sessionId} already has an active Turn`,
      );
    }
    this.#turns.set(sessionId, controller);
  }

  unregister(sessionId: string, controller: OpenCodeBridgeTurnController): void {
    if (this.#turns.get(sessionId) === controller) this.#turns.delete(sessionId);
  }

  expectPluginReady(expected: OpenCodePluginReadyExpectation, signal?: AbortSignal): Promise<void> {
    if (this.#pluginExpectation) {
      throw new OpenCodeEngineError('OPENCODE_BRIDGE_CORRELATION_FAILED', 'A plugin handshake is already pending');
    }
    let resolveReady!: () => void;
    let rejectReady!: (error: unknown) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolveReady = resolvePromise;
      rejectReady = rejectPromise;
    });
    const record: PluginExpectationRecord = {
      expected,
      promise,
      resolve: resolveReady,
      reject: rejectReady,
    };
    this.#pluginExpectation = record;
    const onAbort = (): void => record.reject(signal?.reason ?? new Error('OpenCode plugin handshake cancelled'));
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    return promise.finally(() => {
      signal?.removeEventListener('abort', onAbort);
      if (this.#pluginExpectation === record) this.#pluginExpectation = null;
    });
  }

  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#turns.clear();
    this.#pluginExpectation?.reject(new Error('OpenCode private bridge stopped'));
    this.#pluginExpectation = null;
    this.#stopPromise = new Promise<void>((resolve, reject) => {
      if (!this.#server.listening) {
        resolve();
        return;
      }
      this.#server.close((error) => error ? reject(error) : resolve());
      this.#server.closeAllConnections();
    }).finally(() => {
      this.#origin = '';
      this.#stopPromise = null;
    });
    return this.#stopPromise;
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!constantTimeEqual(headerValue(request, OPENCODE_BRIDGE_TOKEN_HEADER), this.#token)) {
      this.#writeJson(response, 401, {
        error: { code: 'OPENCODE_BRIDGE_UNAUTHORIZED', message: 'Private bridge authentication failed' },
      });
      return;
    }

    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'POST' && url.pathname === '/v1/plugin-ready') {
      const handshake = parsePluginHandshake(await readJson(request));
      const expectation = this.#pluginExpectation;
      if (!expectation || !samePluginHandshake(expectation.expected, handshake)) {
        this.#writeJson(response, 409, {
          error: { code: 'OPENCODE_BRIDGE_CORRELATION_FAILED', message: 'Plugin handshake does not match this process' },
        });
        return;
      }
      expectation.resolve();
      this.#writeJson(response, 200, { ready: true });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/turn-state') {
      const sessionId = boundedString(url.searchParams.get('sessionId'), 'sessionId');
      const controller = this.#turns.get(sessionId);
      if (!controller) {
        this.#writeJson(response, 409, {
          error: { code: 'OPENCODE_BRIDGE_CORRELATION_FAILED', message: 'No active DEF Turn for this session' },
        });
        return;
      }
      this.#writeJson(response, 200, controller.state());
      return;
    }

    if (request.method === 'POST' && url.pathname === '/v1/tool-call') {
      const input = parseToolRequest(await readJson(request));
      const controller = this.#turns.get(input.sessionId);
      if (!controller) {
        this.#writeJson(response, 409, {
          error: { code: 'OPENCODE_BRIDGE_CORRELATION_FAILED', message: 'No active DEF Turn for this session' },
        });
        return;
      }
      try {
        const result = await controller.requestTool(input);
        this.#writeJson(response, 200, result);
      } catch (error) {
        const code = error instanceof OpenCodeEngineError
          ? error.code
          : 'OPENCODE_BRIDGE_CORRELATION_FAILED';
        this.#writeJson(response, 409, {
          error: { code, message: safeBridgeMessage(error) },
        });
      }
      return;
    }

    this.#writeJson(response, 404, {
      error: { code: 'OPENCODE_BRIDGE_ROUTE_NOT_FOUND', message: 'Private bridge route not found' },
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
}

function parseToolRequest(value: unknown): OpenCodeBridgeToolRequest {
  const input = expectRecord(value, 'tool call');
  const keys = Object.keys(input).sort();
  const expected = [
    'callId', 'engineTurnId', 'input', 'messageId', 'projectionRevision', 'safeToolName',
    'sessionId', 'turnLease', 'userMessageId',
  ];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new OpenCodeEngineError('OPENCODE_BRIDGE_INVALID', 'OpenCode Tool call fields are invalid');
  }
  const safeToolName = boundedString(input.safeToolName, 'safeToolName');
  if (!safeToolNames.has(safeToolName)) {
    throw new OpenCodeEngineError('OPENCODE_BRIDGE_INVALID', 'OpenCode Tool name is outside the DEF namespace');
  }
  if (!Number.isSafeInteger(input.projectionRevision) || Number(input.projectionRevision) < 1) {
    throw new OpenCodeEngineError('OPENCODE_BRIDGE_INVALID', 'OpenCode projectionRevision is invalid');
  }
  if (!isJsonValue(input.input)) {
    throw new OpenCodeEngineError('OPENCODE_BRIDGE_INVALID', 'OpenCode Tool input is not JSON-compatible');
  }
  return {
    sessionId: boundedString(input.sessionId, 'sessionId'),
    messageId: boundedString(input.messageId, 'messageId'),
    callId: boundedString(input.callId, 'callId'),
    engineTurnId: boundedString(input.engineTurnId, 'engineTurnId'),
    turnLease: boundedString(input.turnLease, 'turnLease'),
    userMessageId: boundedString(input.userMessageId, 'userMessageId'),
    safeToolName: safeToolName as OpenCodeSafeToolName,
    input: input.input,
    projectionRevision: Number(input.projectionRevision),
  };
}

function parsePluginHandshake(value: unknown): OpenCodePluginReadyExpectation {
  const input = expectRecord(value, 'plugin handshake');
  const keys = Object.keys(input).sort();
  const expectedKeys = ['buildId', 'directory', 'processNonce', 'protocolVersion', 'runtimeVersion'];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new OpenCodeEngineError('OPENCODE_BRIDGE_INVALID', 'OpenCode plugin handshake fields are invalid');
  }
  if (input.protocolVersion !== OPENCODE_PLUGIN_PROTOCOL_VERSION || input.buildId !== OPENCODE_PLUGIN_BUILD_ID) {
    throw new OpenCodeEngineError('OPENCODE_BRIDGE_INVALID', 'OpenCode plugin protocol is incompatible');
  }
  return {
    protocolVersion: OPENCODE_PLUGIN_PROTOCOL_VERSION,
    buildId: OPENCODE_PLUGIN_BUILD_ID,
    processNonce: boundedString(input.processNonce, 'processNonce'),
    runtimeVersion: boundedString(input.runtimeVersion, 'runtimeVersion'),
    directory: boundedString(input.directory, 'directory'),
  };
}

function samePluginHandshake(
  expected: OpenCodePluginReadyExpectation,
  actual: OpenCodePluginReadyExpectation,
): boolean {
  return expected.protocolVersion === actual.protocolVersion
    && expected.buildId === actual.buildId
    && expected.processNonce === actual.processNonce
    && expected.runtimeVersion === actual.runtimeVersion
    && expected.directory === actual.directory;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_REQUEST_BYTES) {
      throw new OpenCodeEngineError('OPENCODE_BRIDGE_INVALID', 'OpenCode private bridge request is too large');
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new OpenCodeEngineError('OPENCODE_BRIDGE_INVALID', 'OpenCode private bridge request is not JSON');
  }
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OpenCodeEngineError('OPENCODE_BRIDGE_INVALID', `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) {
    throw new OpenCodeEngineError('OPENCODE_BRIDGE_INVALID', `${label} is invalid`);
  }
  return value;
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 64) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

function headerValue(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function safeBridgeMessage(error: unknown): string {
  if (error instanceof OpenCodeEngineError) return error.message;
  return 'OpenCode private bridge request failed';
}
