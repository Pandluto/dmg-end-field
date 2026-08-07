import type {
  AgentEventPage,
  AgentHostHealth,
  AgentProductSession,
  AgentSessionCreateInput,
  AgentTurnAbortResult,
  AgentTurnAccepted,
  AgentTurnStartInput,
  AgentUiState,
  BrowserCommandDelivery,
  BrowserCommandResultSubmission,
  BrowserSnapshotPublish,
  BrowserWorkbenchConsumerState,
  BrowserWorkbenchHeartbeat,
  BrowserWorkbenchRegistration,
  DEF_AGENT_PROTOCOL_VERSION,
} from '../../../agent/core/contracts/browser-protocol.ts';
import type { DefEvent } from '../../../agent/core/contracts/events.ts';
import type {
  DefSessionId,
  DefTurnId,
} from '../../../agent/core/contracts/ids.ts';
import {
  AGENT_LAUNCH_GRANT_FRAGMENT_KEY,
  AGENT_UI_CAPABILITY_HEADER,
  AGENT_UI_CAPABILITY_STORAGE_KEY,
} from '../../../agent/core/contracts/browser-protocol.ts';
import type { ProductBinding } from '../../../agent/core/contracts/product.ts';
import type { WorkspaceLeaseRole } from '../runtime/workspaceLease';

export const DESKTOP_AGENT_BRIDGE_ORIGIN = 'http://127.0.0.1:31457';
export const DESKTOP_AGENT_MODE_PATH = '/timeline/ai';
export const DESKTOP_AGENT_HEARTBEAT_INTERVAL_MS = 5_000;

const CAPABILITY_PATTERN = /^[a-zA-Z0-9_-]{20,200}$/;

type AgentModeLocation = Pick<Location, 'href' | 'pathname' | 'search' | 'hash'>;

export interface AgentBridgeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AgentBridgeHistory {
  readonly state: unknown;
  replaceState(state: unknown, unused: string, url?: string | URL | null): void;
}

export interface AgentBridgeFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type AgentBridgeFetch = (
  input: string,
  init?: RequestInit,
) => Promise<AgentBridgeFetchResponse>;

export interface DesktopAgentBridgeDependencies {
  readonly location?: AgentModeLocation;
  readonly history?: AgentBridgeHistory;
  readonly sessionStorage?: AgentBridgeStorage;
  readonly fetch?: AgentBridgeFetch;
  readonly now?: () => number;
  readonly bridgeOrigin?: string;
}

export type DesktopAgentAuthorizationState =
  | 'pending'
  | 'authorized'
  | 'missing'
  | 'failed';

export type DesktopAgentHostState =
  | 'pending'
  | 'ready'
  | 'unavailable'
  | 'error';

export interface DesktopAgentBridgeState {
  readonly route: boolean;
  readonly authorization: DesktopAgentAuthorizationState;
  readonly host: DesktopAgentHostState;
  readonly engine: AgentHostHealth['engine'] | null;
  readonly error: string | null;
}

export interface AgentBridgeRequestOptions {
  readonly method?: 'GET' | 'POST';
  readonly body?: unknown;
  readonly authorized?: boolean;
  readonly keepalive?: boolean;
}

export interface AgentConsumerControllerDocument {
  readonly visibilityState: 'visible' | 'hidden';
  addEventListener(type: 'visibilitychange' | 'pagehide' | 'beforeunload', listener: () => void): void;
  removeEventListener(type: 'visibilitychange' | 'pagehide' | 'beforeunload', listener: () => void): void;
}

export interface AgentWorkspaceLease {
  getRole(): WorkspaceLeaseRole;
  subscribe?(listener: (role: WorkspaceLeaseRole) => void): () => void;
}

export interface AgentConsumerControllerOptions {
  readonly bridge: DesktopAgentBridge;
  readonly workspaceLease: AgentWorkspaceLease;
  readonly document?: AgentConsumerControllerDocument;
  readonly getBinding: () => ProductBinding | null;
  readonly consumerId?: string;
  readonly executorLeaseId?: string;
  readonly heartbeatIntervalMs?: number;
  readonly setInterval?: (handler: () => void, timeout: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
}

export type DesktopAgentConsumerState =
  | 'idle'
  | 'blocked'
  | 'registering'
  | 'registered'
  | 'error'
  | 'closed';

export interface DesktopAgentConsumerSnapshot {
  readonly state: DesktopAgentConsumerState;
  readonly visible: boolean;
  readonly role: WorkspaceLeaseRole;
  readonly consumer: BrowserWorkbenchConsumerState | null;
  readonly error: string | null;
}

export type DesktopAgentBridgeListener = (state: DesktopAgentBridgeState) => void;
export type DesktopAgentConsumerListener = (state: DesktopAgentConsumerSnapshot) => void;

export class DesktopAgentBridgeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'DesktopAgentBridgeError';
  }
}

function defaultLocation(): AgentModeLocation | undefined {
  return typeof window === 'undefined' ? undefined : window.location;
}

function defaultHistory(): AgentBridgeHistory | undefined {
  return typeof window === 'undefined' ? undefined : window.history;
}

function defaultSessionStorage(): AgentBridgeStorage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function defaultFetch(input: string, init?: RequestInit): Promise<AgentBridgeFetchResponse> {
  if (typeof globalThis.fetch !== 'function') {
    return Promise.reject(new DesktopAgentBridgeError('当前环境没有可用的网络请求能力。', 'FETCH_UNAVAILABLE'));
  }
  return globalThis.fetch(input, init);
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return '/';
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (withSlash.length > 1 && withSlash.endsWith('/')) return withSlash.slice(0, -1);
  return withSlash;
}

function hashRoute(hash: string): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const queryOffset = raw.indexOf('?');
  return normalizePath(queryOffset < 0 ? raw : raw.slice(0, queryOffset));
}

function hashQuery(hash: string): URLSearchParams {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const queryOffset = raw.indexOf('?');
  return queryOffset < 0 ? new URLSearchParams() : new URLSearchParams(raw.slice(queryOffset + 1));
}

function isSecureCapability(value: string | null | undefined): value is string {
  return Boolean(value && CAPABILITY_PATTERN.test(value));
}

function urlFromLocation(location: AgentModeLocation): URL {
  try {
    return new URL(location.href);
  } catch {
    const origin = typeof window === 'undefined' ? DESKTOP_AGENT_BRIDGE_ORIGIN : window.location.origin;
    return new URL(`${origin}${location.pathname}${location.search}${location.hash}`);
  }
}

function relativeUrl(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

function isAgentModeUrl(url: URL): boolean {
  if (url.hash) return hashRoute(url.hash) === DESKTOP_AGENT_MODE_PATH;
  return normalizePath(url.pathname) === DESKTOP_AGENT_MODE_PATH;
}

function readErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  if (typeof record.message === 'string' && record.message.trim()) return record.message;
  return fallback;
}

function readErrorCode(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const error = (payload as Record<string, unknown>).error;
  if (!error || typeof error !== 'object') return fallback;
  const code = (error as Record<string, unknown>).code;
  return typeof code === 'string' && /^[A-Z0-9_]{3,100}$/.test(code) ? code : fallback;
}

function responseData(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const record = payload as Record<string, unknown>;
  if (record.ok === false) {
    throw new DesktopAgentBridgeError(readErrorMessage(payload, 'Agent Host 请求失败。'), 'HOST_REQUEST_FAILED');
  }
  if (record.data && typeof record.data === 'object') return record.data as Record<string, unknown>;
  return record;
}

function asHealth(payload: unknown): AgentHostHealth {
  const data = responseData(payload);
  const candidate = data.health && typeof data.health === 'object' ? data.health : data;
  if (!candidate || typeof candidate !== 'object') {
    throw new DesktopAgentBridgeError('Agent Host 返回了无效的健康状态。', 'INVALID_HOST_RESPONSE');
  }
  const health = candidate as Partial<AgentHostHealth>;
  if (
    health.service !== 'def-agent-host'
    || health.protocolVersion !== 2
    || health.runtimeSchemaVersion !== 1
    || !health.engine
    || !['starting', 'ready', 'stopping', 'error'].includes(health.state || '')
    || !['ready', 'pending', 'unavailable'].includes(health.engine.state)
    || typeof health.engine.kind !== 'string'
  ) {
    throw new DesktopAgentBridgeError('Agent Host 返回了不兼容的健康状态。', 'INVALID_HOST_RESPONSE');
  }
  return health as AgentHostHealth;
}

function asUiState(payload: unknown): AgentUiState {
  const data = responseData(payload);
  const candidate = data.state && typeof data.state === 'object' ? data.state : data;
  if (
    !candidate
    || typeof candidate !== 'object'
    || (candidate as Partial<AgentUiState>).protocolVersion !== 2
    || !('engine' in candidate)
  ) {
    throw new DesktopAgentBridgeError('Agent Host 返回了无效的页面状态。', 'INVALID_HOST_RESPONSE');
  }
  return candidate as AgentUiState;
}

function asConsumerState(payload: unknown): BrowserWorkbenchConsumerState {
  const data = responseData(payload);
  const candidate = data.consumer && typeof data.consumer === 'object' ? data.consumer : data;
  if (
    !candidate
    || typeof candidate !== 'object'
    || typeof (candidate as Partial<BrowserWorkbenchConsumerState>).consumerId !== 'string'
    || typeof (candidate as Partial<BrowserWorkbenchConsumerState>).executorLeaseId !== 'string'
    || typeof (candidate as Partial<BrowserWorkbenchConsumerState>).heartbeatExpiresAt !== 'number'
  ) {
    throw new DesktopAgentBridgeError('Agent Host 返回了无效的 consumer 状态。', 'INVALID_HOST_RESPONSE');
  }
  return candidate as BrowserWorkbenchConsumerState;
}

const SESSION_STATUSES = new Set([
  'binding-pending', 'creating', 'create-failed', 'ready', 'engine-unavailable',
  'archived', 'binding-missing', 'orphaned', 'deleting', 'delete-failed',
]);

const PRODUCT_SESSION_KEYS = new Set([
  'schemaVersion', 'eventSchemaVersion', 'defSessionId', 'host', 'status',
  'workspaceId', 'lastDatabaseGeneration', 'timelineId', 'axisBindingId',
  'boundNodeId', 'engine', 'harness', 'createdAt', 'updatedAt',
]);
const PRODUCT_ENGINE_KEYS = new Set(['kind', 'runtimeVersion']);
const PRODUCT_HARNESS_KEYS = new Set(['stateVersion', 'revision']);

const EVENT_TYPES = new Set([
  'session.ready', 'session.recovered', 'session.archived', 'session.orphaned',
  'turn.accepted', 'response.first-token', 'response.delta', 'tool.requested',
  'tool.started', 'tool.result', 'tool.error', 'harness.routed',
  'harness.phase.entered', 'harness.tool.projected', 'harness.terminal',
  'interaction.requested', 'interaction.resolved', 'command.queued',
  'command.dispatched', 'command.claimed', 'command.committed', 'command.result',
  'command.reconciled', 'command.orphaned', 'turn.completed', 'turn.stopped',
  'turn.interrupted', 'turn.failed',
]);

const SESSION_EVENT_TYPES = new Set([
  'session.ready', 'session.recovered', 'session.archived', 'session.orphaned',
]);
const TOOL_EVENT_TYPES = new Set([
  'tool.requested', 'tool.started', 'tool.result', 'tool.error',
  'command.queued', 'command.dispatched', 'command.claimed', 'command.committed',
  'command.result', 'command.reconciled', 'command.orphaned',
]);
const INTERACTION_EVENT_TYPES = new Set(['interaction.requested', 'interaction.resolved']);
const COMMAND_EVENT_TYPES = new Set([
  'command.queued', 'command.dispatched', 'command.claimed', 'command.committed',
  'command.result', 'command.reconciled', 'command.orphaned',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry, depth + 1));
  if (!isRecord(value)) return false;
  return Object.values(value).every((entry) => isJsonValue(entry, depth + 1));
}

function hasString(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === 'string';
}

function hasExactKeys(record: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(record);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function isSafeProductEventShape(event: Record<string, unknown>): boolean {
  const type = event.type as string;
  const payload = event.payload as Record<string, unknown>;
  if ('diagnostics' in event) return false;
  if (!SESSION_EVENT_TYPES.has(type) && typeof event.defTurnId !== 'string') return false;
  if (TOOL_EVENT_TYPES.has(type) && typeof event.toolCallId !== 'string') return false;
  if (INTERACTION_EVENT_TYPES.has(type) && typeof event.interactionId !== 'string') return false;
  if (COMMAND_EVENT_TYPES.has(type) && typeof event.commandId !== 'string') return false;
  switch (type) {
    case 'session.ready':
    case 'session.recovered':
      return hasString(payload, 'engineKind') && hasString(payload, 'engineRuntimeVersion');
    case 'session.archived':
      return hasString(payload, 'reason');
    case 'session.orphaned':
      return hasString(payload, 'code') && hasString(payload, 'message');
    case 'turn.accepted':
      return hasString(payload, 'clientTurnId') && hasString(payload, 'userMessage');
    case 'response.first-token':
      return Object.keys(payload).length === 0;
    case 'response.delta':
      return hasString(payload, 'delta');
    case 'tool.requested':
      return hasString(payload, 'name')
        && ['read', 'propose', 'mutate'].includes(String(payload.risk))
        && isJsonValue(payload.input);
    case 'tool.started':
      return hasString(payload, 'name');
    case 'tool.result':
      return Object.prototype.hasOwnProperty.call(payload, 'result') && isJsonValue(payload.result);
    case 'tool.error':
      return hasString(payload, 'code')
        && hasString(payload, 'message')
        && (payload.details === undefined || isJsonValue(payload.details));
    case 'turn.completed':
      return payload.output === undefined || isJsonValue(payload.output);
    case 'turn.stopped':
      return hasString(payload, 'code') && (payload.message === undefined || typeof payload.message === 'string');
    case 'turn.failed':
      return hasString(payload, 'code') && hasString(payload, 'message');
    case 'turn.interrupted':
      return hasString(payload, 'code')
        && hasString(payload, 'message')
        && Array.isArray(payload.reconcileRequiredCommandIds)
        && payload.reconcileRequiredCommandIds.every((id) => typeof id === 'string');
    default:
      return isJsonValue(payload);
  }
}

function asProductSession(payload: unknown): AgentProductSession {
  const data = responseData(payload);
  const candidate = data.session && typeof data.session === 'object' ? data.session : data;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new DesktopAgentBridgeError('Agent Host 返回了无效的会话。', 'INVALID_HOST_RESPONSE');
  }
  const session = candidate as Record<string, unknown>;
  const engine = session.engine;
  const harness = session.harness;
  if (
    !hasExactKeys(session, PRODUCT_SESSION_KEYS)
    || session.schemaVersion !== 6
    || session.eventSchemaVersion !== 1
    || typeof session.defSessionId !== 'string'
    || session.host !== 'workbench'
    || typeof session.status !== 'string'
    || !SESSION_STATUSES.has(session.status)
    || typeof session.workspaceId !== 'string'
    || typeof session.lastDatabaseGeneration !== 'string'
    || typeof session.timelineId !== 'string'
    || (session.axisBindingId !== null && typeof session.axisBindingId !== 'string')
    || (session.boundNodeId !== null && typeof session.boundNodeId !== 'string')
    || typeof session.createdAt !== 'string'
    || typeof session.updatedAt !== 'string'
    || !engine
    || typeof engine !== 'object'
    || Array.isArray(engine)
    || !hasExactKeys(engine as Record<string, unknown>, PRODUCT_ENGINE_KEYS)
    || typeof (engine as Record<string, unknown>).kind !== 'string'
    || typeof (engine as Record<string, unknown>).runtimeVersion !== 'string'
    || 'sessionId' in engine
    || 'storeSchemaVersion' in engine
    || !harness
    || typeof harness !== 'object'
    || Array.isArray(harness)
    || !hasExactKeys(harness as Record<string, unknown>, PRODUCT_HARNESS_KEYS)
    || typeof (harness as Record<string, unknown>).stateVersion !== 'number'
    || typeof (harness as Record<string, unknown>).revision !== 'string'
  ) {
    throw new DesktopAgentBridgeError('Agent Host 返回了不兼容的会话。', 'INVALID_HOST_RESPONSE');
  }
  return session as unknown as AgentProductSession;
}

function asSessionList(payload: unknown): readonly AgentProductSession[] {
  const data = responseData(payload);
  if (
    !hasExactKeys(data, new Set(['protocolVersion', 'sessions']))
    || data.protocolVersion !== 2
    || !Array.isArray(data.sessions)
  ) {
    throw new DesktopAgentBridgeError('Agent Host 返回了无效的会话列表。', 'INVALID_HOST_RESPONSE');
  }
  return data.sessions.map((session) => asProductSession({ session }));
}

function asDefEvent(value: unknown, defSessionId: string, afterSequence: number): DefEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DesktopAgentBridgeError('Agent Host 返回了无效的事件。', 'INVALID_HOST_RESPONSE');
  }
  const event = value as Record<string, unknown>;
  if (
    event.schemaVersion !== 1
    || !Number.isSafeInteger(event.sequence)
    || Number(event.sequence) <= afterSequence
    || event.defSessionId !== defSessionId
    || typeof event.occurredAt !== 'string'
    || typeof event.type !== 'string'
    || !EVENT_TYPES.has(event.type)
    || !event.payload
    || typeof event.payload !== 'object'
    || Array.isArray(event.payload)
    || !isSafeProductEventShape(event)
  ) {
    throw new DesktopAgentBridgeError('Agent Host 返回了不兼容的事件。', 'INVALID_HOST_RESPONSE');
  }
  return event as unknown as DefEvent;
}

function asEventPage(
  payload: unknown,
  expectedSessionId: DefSessionId,
  expectedAfterSequence: number,
  limit: number,
): AgentEventPage {
  const data = responseData(payload);
  if (
    !hasExactKeys(data, new Set([
      'protocolVersion', 'defSessionId', 'afterSequence', 'nextSequence', 'hasMore', 'events',
    ]))
    ||
    data.protocolVersion !== 2
    || data.defSessionId !== expectedSessionId
    || data.afterSequence !== expectedAfterSequence
    || !Number.isSafeInteger(data.nextSequence)
    || Number(data.nextSequence) < expectedAfterSequence
    || typeof data.hasMore !== 'boolean'
    || !Array.isArray(data.events)
    || data.events.length > limit
  ) {
    throw new DesktopAgentBridgeError('Agent Host 返回了无效的事件页。', 'INVALID_HOST_RESPONSE');
  }
  let cursor = expectedAfterSequence;
  const events = data.events.map((event) => {
    const parsed = asDefEvent(event, expectedSessionId, cursor);
    cursor = parsed.sequence;
    return parsed;
  });
  if (data.nextSequence !== cursor) {
    throw new DesktopAgentBridgeError('Agent Host 事件游标不连续。', 'INVALID_HOST_RESPONSE');
  }
  return { ...data, events } as unknown as AgentEventPage;
}

function asTurnAccepted(payload: unknown, expectedSessionId: DefSessionId): AgentTurnAccepted {
  const data = responseData(payload);
  if (
    !hasExactKeys(data, new Set(['protocolVersion', 'defSessionId', 'defTurnId', 'clientTurnId']))
    ||
    data.protocolVersion !== 2
    || data.defSessionId !== expectedSessionId
    || typeof data.defTurnId !== 'string'
    || typeof data.clientTurnId !== 'string'
  ) {
    throw new DesktopAgentBridgeError('Agent Host 返回了无效的 Turn。', 'INVALID_HOST_RESPONSE');
  }
  return data as unknown as AgentTurnAccepted;
}

function asTurnAbortResult(payload: unknown, expectedTurnId: DefTurnId): AgentTurnAbortResult {
  const data = responseData(payload);
  if (
    !hasExactKeys(data, new Set(['protocolVersion', 'defTurnId', 'stopped']))
    || data.protocolVersion !== 2
    || data.defTurnId !== expectedTurnId
    || data.stopped !== true
  ) {
    throw new DesktopAgentBridgeError('Agent Host 返回了无效的停止结果。', 'INVALID_HOST_RESPONSE');
  }
  return data as unknown as AgentTurnAbortResult;
}

function makeOpaqueId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function isDesktopAgentModeRoute(location: AgentModeLocation = defaultLocation() || {
  href: '',
  pathname: '',
  search: '',
  hash: '',
}): boolean {
  return isAgentModeUrl(urlFromLocation(location));
}

/**
 * Captures a launch grant from the AI route and removes it from the address bar.
 * The grant is intentionally returned to the caller only; it is never persisted.
 */
export function captureDesktopAgentLaunchGrant(
  dependencies: Pick<DesktopAgentBridgeDependencies, 'location' | 'history'> = {},
): string | null {
  const location = dependencies.location || defaultLocation();
  if (!location) return null;
  const url = urlFromLocation(location);
  if (!isAgentModeUrl(url)) return null;

  const hashParams = hashQuery(url.hash);
  const hashGrant = hashParams.get(AGENT_LAUNCH_GRANT_FRAGMENT_KEY);
  const grant = isSecureCapability(hashGrant) ? hashGrant : null;
  const hadGrant = url.searchParams.has(AGENT_LAUNCH_GRANT_FRAGMENT_KEY)
    || hashParams.has(AGENT_LAUNCH_GRANT_FRAGMENT_KEY);

  if (url.searchParams.has(AGENT_LAUNCH_GRANT_FRAGMENT_KEY)) {
    url.searchParams.delete(AGENT_LAUNCH_GRANT_FRAGMENT_KEY);
  }
  if (hashParams.has(AGENT_LAUNCH_GRANT_FRAGMENT_KEY)) {
    hashParams.delete(AGENT_LAUNCH_GRANT_FRAGMENT_KEY);
    const route = hashRoute(url.hash);
    url.hash = `#${route}${hashParams.size ? `?${hashParams.toString()}` : ''}`;
  }

  if (hadGrant) {
    const history = dependencies.history || defaultHistory();
    if (!history) {
      throw new DesktopAgentBridgeError('无法清理 AI 模式授权地址。', 'AGENT_URL_CLEANUP_FAILED');
    }
    try {
      history.replaceState(history.state, '', relativeUrl(url));
    } catch (error) {
      throw new DesktopAgentBridgeError(
        '无法清理 AI 模式授权地址。',
        'AGENT_URL_CLEANUP_FAILED',
      );
    }
  }

  return grant;
}

export class DesktopAgentBridge {
  readonly #location: AgentModeLocation | undefined;
  readonly #history: AgentBridgeHistory | undefined;
  readonly #storage: AgentBridgeStorage | undefined;
  readonly #fetch: AgentBridgeFetch;
  readonly #now: () => number;
  readonly #origin: string;
  readonly #listeners = new Set<DesktopAgentBridgeListener>();
  #pendingLaunchGrant: string | null = null;
  #captureAttempted = false;
  #launchGrantExchangeAttempted = false;
  #initializePromise: Promise<DesktopAgentBridgeState> | null = null;
  #state: DesktopAgentBridgeState = {
    route: false,
    authorization: 'pending',
    host: 'pending',
    engine: null,
    error: null,
  };

  constructor(dependencies: DesktopAgentBridgeDependencies = {}) {
    this.#location = dependencies.location || defaultLocation();
    this.#history = dependencies.history || defaultHistory();
    this.#storage = dependencies.sessionStorage || defaultSessionStorage();
    this.#fetch = dependencies.fetch || defaultFetch;
    this.#now = dependencies.now || Date.now;
    this.#origin = dependencies.bridgeOrigin || DESKTOP_AGENT_BRIDGE_ORIGIN;
    this.#state = { ...this.#state, route: this.isAgentModeRoute() };
  }

  getState(): DesktopAgentBridgeState {
    return this.#state;
  }

  subscribe(listener: DesktopAgentBridgeListener): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  isAgentModeRoute(): boolean {
    return Boolean(this.#location && isDesktopAgentModeRoute(this.#location));
  }

  getSessionCapability(): string | null {
    if (!this.#storage) return null;
    try {
      const capability = this.#storage.getItem(AGENT_UI_CAPABILITY_STORAGE_KEY);
      if (isSecureCapability(capability)) return capability;
      if (capability !== null) this.#storage.removeItem(AGENT_UI_CAPABILITY_STORAGE_KEY);
    } catch {
      return null;
    }
    return null;
  }

  clearSessionCapability(): void {
    try {
      this.#storage?.removeItem(AGENT_UI_CAPABILITY_STORAGE_KEY);
    } catch {
      // A storage failure is already fail-closed; there is nothing safe to retain.
    }
    this.#setState({ authorization: 'missing', error: null });
  }

  captureLaunchGrant(): string | null {
    if (this.#captureAttempted) return null;
    this.#captureAttempted = true;
    try {
      this.#pendingLaunchGrant = captureDesktopAgentLaunchGrant({
        location: this.#location,
        history: this.#history,
      });
      return this.#pendingLaunchGrant;
    } catch (error) {
      this.#pendingLaunchGrant = null;
      throw error;
    }
  }

  initialize(): Promise<DesktopAgentBridgeState> {
    if (this.#initializePromise) return this.#initializePromise;
    const promise = this.#initializeOnce().finally(() => {
      if (this.#initializePromise === promise) this.#initializePromise = null;
    });
    this.#initializePromise = promise;
    return promise;
  }

  async #initializeOnce(): Promise<DesktopAgentBridgeState> {
    if (!this.isAgentModeRoute()) {
      this.#setState({
        route: false,
        authorization: 'missing',
        host: 'unavailable',
        engine: null,
        error: 'Agent 模式只允许从隐藏的 /timeline/ai 路由进入。',
      });
      return this.#state;
    }

    this.#setState({ route: true, authorization: 'pending', error: null });
    const currentCapability = this.getSessionCapability();
    let launchGrant: string | null = null;
    if (!currentCapability) {
      try {
        // Scrub the launch secret before the first network await so it never
        // lingers in the address bar, history, or an error screenshot.
        launchGrant = this.captureLaunchGrant();
      } catch (error) {
        this.#setState({
          authorization: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
        return this.#state;
      }
    }
    await this.refreshHostState().catch((error: unknown) => {
      this.#setState({
        host: 'unavailable',
        error: error instanceof Error ? error.message : String(error),
      });
    });

    if (currentCapability) {
      this.#setState({ authorization: 'authorized', error: null });
      await this.refreshUiState().catch((error: unknown) => {
        this.#setState({ error: error instanceof Error ? error.message : String(error) });
      });
      return this.#state;
    }

    if (!launchGrant) {
      this.#setState({
        authorization: 'missing',
        error: '请从桌面 Shell 打开 AI 模式。',
      });
      return this.#state;
    }
    try {
      await this.exchangeLaunchGrant(launchGrant);
      await this.refreshUiState().catch((error: unknown) => {
        this.#setState({ error: error instanceof Error ? error.message : String(error) });
      });
    } catch (error) {
      this.clearSessionCapability();
      this.#setState({
        authorization: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return this.#state;
  }

  async exchangeLaunchGrant(launchGrant?: string): Promise<string> {
    if (!this.isAgentModeRoute()) {
      throw new DesktopAgentBridgeError('当前页面不是 AI 模式。', 'AGENT_ROUTE_REQUIRED', 403);
    }
    const grant = launchGrant || this.#pendingLaunchGrant;
    this.#pendingLaunchGrant = null;
    if (!isSecureCapability(grant)) {
      throw new DesktopAgentBridgeError('AI 模式授权缺失或格式无效。', 'AGENT_LAUNCH_GRANT_INVALID', 403);
    }
    if (this.#launchGrantExchangeAttempted) {
      throw new DesktopAgentBridgeError('AI 模式授权已经被本页面消费。', 'AGENT_LAUNCH_GRANT_CONSUMED', 403);
    }
    this.#launchGrantExchangeAttempted = true;

    this.#setState({ authorization: 'pending', error: null });
    let data: Record<string, unknown>;
    try {
      data = await this.#request('/agent-host/ui/session', {
        method: 'POST',
        body: {
          launchGrant: grant,
          audience: 'workbench-ai-mode',
        },
        authorized: false,
      });
    } catch (error) {
      this.clearSessionCapability();
      throw error;
    }
    const candidate = data.session && typeof data.session === 'object' ? data.session : data;
    const record = candidate as Partial<{
      protocolVersion: typeof DEF_AGENT_PROTOCOL_VERSION;
      capability: unknown;
      sessionCapability: unknown;
      audience: unknown;
      expiresAt: unknown;
    }>;
    const capability = typeof record.capability === 'string'
      ? record.capability
      : typeof record.sessionCapability === 'string'
        ? record.sessionCapability
        : null;
    if (
      record.protocolVersion !== 2
      || record.audience !== 'workbench-ai-mode'
      || !isSecureCapability(capability)
      || typeof record.expiresAt !== 'number'
      || !Number.isFinite(record.expiresAt)
      || record.expiresAt <= this.#now()
    ) {
      this.clearSessionCapability();
      throw new DesktopAgentBridgeError('Agent Host 返回了无效的页面授权。', 'INVALID_UI_SESSION', 502);
    }
    if (!this.#storage) {
      this.clearSessionCapability();
      throw new DesktopAgentBridgeError('当前标签页没有可用的 sessionStorage。', 'SESSION_STORAGE_UNAVAILABLE', 500);
    }
    try {
      this.#storage.setItem(AGENT_UI_CAPABILITY_STORAGE_KEY, capability);
    } catch (error) {
      this.clearSessionCapability();
      throw new DesktopAgentBridgeError(
        '当前标签页无法保存 AI 模式授权。',
        'SESSION_STORAGE_UNAVAILABLE',
        500,
      );
    }
    this.#setState({ authorization: 'authorized', error: null });
    return capability;
  }

  async getHealth(): Promise<AgentHostHealth> {
    const data = await this.#request('/agent-host/health', { authorized: false });
    const health = asHealth(data);
    this.#setState({
      host: health.state === 'ready' ? 'ready' : health.state === 'error' ? 'error' : 'pending',
      engine: health.engine,
      error: null,
    });
    return health;
  }

  async getUiState(): Promise<AgentUiState> {
    const data = await this.#request('/agent-host/ui/state');
    const state = asUiState(data);
    this.#setState({
      authorization: 'authorized',
      engine: state.engine,
      error: null,
    });
    return state;
  }

  async registerConsumer(input: BrowserWorkbenchRegistration): Promise<BrowserWorkbenchConsumerState> {
    const data = await this.#request('/agent-host/workbench/register', {
      method: 'POST',
      body: input,
    });
    return asConsumerState(data);
  }

  async heartbeatConsumer(input: BrowserWorkbenchHeartbeat): Promise<BrowserWorkbenchConsumerState> {
    const data = await this.#request('/agent-host/workbench/heartbeat', {
      method: 'POST',
      body: input,
    });
    return asConsumerState(data);
  }

  async closeConsumer(input: Pick<BrowserWorkbenchHeartbeat, 'consumerId' | 'executorLeaseId'>, keepalive = false): Promise<void> {
    await this.#request('/agent-host/workbench/close', {
      method: 'POST',
      body: input,
      keepalive,
    });
  }

  async publishSnapshot(input: BrowserSnapshotPublish): Promise<void> {
    await this.#request('/agent-host/workbench/snapshot', {
      method: 'POST',
      body: input,
    });
  }

  async nextCommand(input: {
    readonly consumerId: string;
    readonly executorLeaseId: string;
    readonly afterCursor: number;
  }): Promise<BrowserCommandDelivery | null> {
    const query = new URLSearchParams({
      consumerId: input.consumerId,
      executorLeaseId: input.executorLeaseId,
      afterCursor: String(input.afterCursor),
    });
    const data = await this.#request(`/agent-host/workbench/commands/next?${query}`);
    if (data.delivery === null) return null;
    const candidate = (
      data.delivery && typeof data.delivery === 'object' ? data.delivery : data
    ) as Record<string, unknown>;
    if (
      typeof candidate.cursor !== 'number'
      || !Number.isSafeInteger(candidate.cursor)
      || candidate.cursor < 1
      || !candidate.command
      || typeof candidate.command !== 'object'
    ) {
      throw new DesktopAgentBridgeError('Agent Host 返回了无效的指令。', 'INVALID_HOST_RESPONSE');
    }
    return candidate as unknown as BrowserCommandDelivery;
  }

  async submitCommandResult(input: BrowserCommandResultSubmission): Promise<void> {
    await this.#request(`/agent-host/workbench/commands/${encodeURIComponent(input.result.commandId)}/result`, {
      method: 'POST',
      body: input,
    });
  }

  async listSessions(): Promise<readonly AgentProductSession[]> {
    return asSessionList(await this.#request('/agent-host/sessions'));
  }

  async createSession(input: AgentSessionCreateInput = {}): Promise<AgentProductSession> {
    const data = await this.#request('/agent-host/sessions', {
      method: 'POST',
      body: input,
    });
    return asProductSession(data);
  }

  async getSession(defSessionId: DefSessionId): Promise<AgentProductSession> {
    const data = await this.#request(`/agent-host/sessions/${encodeURIComponent(defSessionId)}`);
    return asProductSession(data);
  }

  async readSessionEvents(
    defSessionId: DefSessionId,
    afterSequence = 0,
    limit = 256,
  ): Promise<AgentEventPage> {
    const query = new URLSearchParams({
      afterSequence: String(afterSequence),
      limit: String(limit),
    });
    const data = await this.#request(
      `/agent-host/sessions/${encodeURIComponent(defSessionId)}/events?${query}`,
    );
    return asEventPage(data, defSessionId, afterSequence, limit);
  }

  async startTurn(
    defSessionId: DefSessionId,
    input: AgentTurnStartInput,
  ): Promise<AgentTurnAccepted> {
    const data = await this.#request(
      `/agent-host/sessions/${encodeURIComponent(defSessionId)}/turns`,
      { method: 'POST', body: input },
    );
    return asTurnAccepted(data, defSessionId);
  }

  async abortTurn(defTurnId: DefTurnId): Promise<AgentTurnAbortResult> {
    const data = await this.#request(
      `/agent-host/turns/${encodeURIComponent(defTurnId)}/abort`,
      { method: 'POST', body: {} },
    );
    return asTurnAbortResult(data, defTurnId);
  }

  async refreshHostState(): Promise<AgentHostHealth> {
    return this.getHealth();
  }

  async refreshUiState(): Promise<AgentUiState> {
    return this.getUiState();
  }

  async #request(path: string, options: AgentBridgeRequestOptions = {}): Promise<Record<string, unknown>> {
    const authorized = options.authorized !== false;
    let capability: string | null = null;
    if (authorized) {
      capability = this.getSessionCapability();
      if (!capability) {
        this.#setState({ authorization: 'missing' });
        throw new DesktopAgentBridgeError('AI 模式页面尚未获得有效授权。', 'AGENT_UNAUTHORIZED', 403);
      }
    }
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (capability) headers[AGENT_UI_CAPABILITY_HEADER] = capability;
    let response: AgentBridgeFetchResponse;
    try {
      response = await this.#fetch(`${this.#origin}${path}`, {
        method: options.method || 'GET',
        cache: 'no-store',
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        ...(options.keepalive ? { keepalive: true } : {}),
      });
    } catch (error) {
      throw new DesktopAgentBridgeError(
        error instanceof Error ? error.message : '无法连接 Agent Host。',
        'AGENT_HOST_UNREACHABLE',
      );
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (authorized && (response.status === 401 || response.status === 403)) this.clearSessionCapability();
      throw new DesktopAgentBridgeError(
        readErrorMessage(payload, `Agent Host 请求失败（${response.status}）。`),
        response.status === 401 || response.status === 403
          ? 'AGENT_UNAUTHORIZED'
          : readErrorCode(payload, 'HOST_REQUEST_FAILED'),
        response.status,
      );
    }
    return responseData(payload);
  }

  #setState(patch: Partial<DesktopAgentBridgeState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener(this.#state);
  }
}

export function createDesktopAgentBridge(
  dependencies: DesktopAgentBridgeDependencies = {},
): DesktopAgentBridge {
  return new DesktopAgentBridge(dependencies);
}

export class DesktopAgentConsumerController {
  readonly #bridge: DesktopAgentBridge;
  readonly #workspaceLease: AgentWorkspaceLease;
  readonly #document: AgentConsumerControllerDocument;
  readonly #getBinding: () => ProductBinding | null;
  readonly #consumerId: string;
  readonly #executorLeaseId: string;
  readonly #heartbeatIntervalMs: number;
  readonly #setInterval: (handler: () => void, timeout: number) => unknown;
  readonly #clearInterval: (handle: unknown) => void;
  readonly #listeners = new Set<DesktopAgentConsumerListener>();
  readonly #onVisibilityChange = () => { void this.#synchronize(); };
  readonly #onPageExit = () => { void this.stop(true); };
  #leaseUnsubscribe: (() => void) | null = null;
  #heartbeatHandle: unknown = null;
  #consumer: BrowserWorkbenchConsumerState | null = null;
  #running = false;
  #syncVersion = 0;
  #synchronizeRequested = false;
  #synchronizePromise: Promise<void> | null = null;
  #state: DesktopAgentConsumerSnapshot;

  constructor(options: AgentConsumerControllerOptions) {
    this.#bridge = options.bridge;
    this.#workspaceLease = options.workspaceLease;
    this.#document = options.document || defaultAgentDocument();
    this.#getBinding = options.getBinding;
    this.#consumerId = options.consumerId || makeOpaqueId('consumer');
    this.#executorLeaseId = options.executorLeaseId || makeOpaqueId('executor');
    this.#heartbeatIntervalMs = options.heartbeatIntervalMs || DESKTOP_AGENT_HEARTBEAT_INTERVAL_MS;
    this.#setInterval = options.setInterval || ((handler, timeout) => globalThis.setInterval(handler, timeout));
    this.#clearInterval = options.clearInterval || ((handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>));
    this.#state = {
      state: 'idle',
      visible: this.isVisible(),
      role: this.#workspaceLease.getRole(),
      consumer: null,
      error: null,
    };
  }

  getState(): DesktopAgentConsumerSnapshot {
    return this.#state;
  }

  subscribe(listener: DesktopAgentConsumerListener): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  isVisible(): boolean {
    return this.#document.visibilityState === 'visible';
  }

  start(): Promise<void> {
    if (this.#running) return this.#synchronize();
    this.#running = true;
    this.#document.addEventListener('visibilitychange', this.#onVisibilityChange);
    this.#document.addEventListener('pagehide', this.#onPageExit);
    this.#document.addEventListener('beforeunload', this.#onPageExit);
    this.#leaseUnsubscribe = this.#workspaceLease.subscribe?.(() => { void this.#synchronize(); }) || null;
    return this.#synchronize();
  }

  refreshEligibility(): Promise<void> {
    return this.#synchronize();
  }

  async stop(keepalive = false): Promise<void> {
    if (!this.#running && !this.#consumer) {
      this.#setState({ state: 'closed', visible: this.isVisible(), role: this.#workspaceLease.getRole() });
      return;
    }
    this.#running = false;
    this.#synchronizeRequested = false;
    this.#syncVersion += 1;
    this.#document.removeEventListener('visibilitychange', this.#onVisibilityChange);
    this.#document.removeEventListener('pagehide', this.#onPageExit);
    this.#document.removeEventListener('beforeunload', this.#onPageExit);
    this.#leaseUnsubscribe?.();
    this.#leaseUnsubscribe = null;
    this.#clearHeartbeat();
    const consumer = this.#consumer;
    this.#consumer = null;
    if (consumer) {
      try {
        await this.#bridge.closeConsumer({
          consumerId: consumer.consumerId,
          executorLeaseId: consumer.executorLeaseId,
        }, keepalive);
      } catch {
        // Stop is fail-closed: local registration is removed even if the host is gone.
      }
    }
    this.#setState({ state: 'closed', visible: this.isVisible(), role: this.#workspaceLease.getRole(), consumer: null });
  }

  async #synchronize(): Promise<void> {
    this.#synchronizeRequested = true;
    if (this.#synchronizePromise) return this.#synchronizePromise;
    this.#synchronizePromise = (async () => {
      do {
        this.#synchronizeRequested = false;
        await this.#synchronizeOnce();
      } while (this.#running && this.#synchronizeRequested);
    })().finally(() => {
      this.#synchronizePromise = null;
    });
    return this.#synchronizePromise;
  }

  async #synchronizeOnce(): Promise<void> {
    if (!this.#running) return;
    const version = ++this.#syncVersion;
    const visible = this.isVisible();
    const role = this.#workspaceLease.getRole();
    this.#setState({ visible, role });
    if (!this.#bridge.isAgentModeRoute()) {
      const closePromise = this.#closeCurrentConsumer();
      if (this.#running && version === this.#syncVersion) {
        this.#setState({
          state: 'blocked',
          consumer: null,
          error: '当前页面已经离开 AI 模式。',
        });
      }
      await closePromise;
      return;
    }
    if (!visible || role !== 'writer') {
      const closePromise = this.#closeCurrentConsumer();
      if (this.#running && version === this.#syncVersion) {
        this.#setState({
          state: 'blocked',
          consumer: null,
          error: visible ? '当前标签页不是 writer。' : '页面不可见时不持有 Agent consumer。',
        });
      }
      await closePromise;
      return;
    }
    if (!this.#bridge.getSessionCapability()) {
      await this.#closeCurrentConsumer();
      if (this.#running && version === this.#syncVersion) {
        this.#setState({ state: 'blocked', error: '页面尚未获得 Agent Host 授权。' });
      }
      return;
    }
    let binding: ProductBinding | null;
    try {
      binding = this.#getBinding();
    } catch (error) {
      binding = null;
      this.#setState({ error: error instanceof Error ? error.message : String(error) });
    }
    if (!binding) {
      await this.#closeCurrentConsumer();
      if (this.#running && version === this.#syncVersion) {
        this.#setState({ state: 'blocked', error: '工作区快照尚未准备好。' });
      }
      return;
    }
    if (this.#consumer && !sameConsumerScope(this.#consumer.binding, binding)) {
      await this.#closeCurrentConsumer();
    }
    if (this.#consumer) {
      if (sameProductBinding(this.#consumer.binding, binding)) return;
      const current = this.#consumer;
      try {
        const next = await this.#bridge.heartbeatConsumer({
          consumerId: current.consumerId,
          executorLeaseId: current.executorLeaseId,
          writer: true,
          visible: true,
          binding,
        });
        const stillEligible = this.#running
          && version === this.#syncVersion
          && this.isVisible()
          && this.#workspaceLease.getRole() === 'writer';
        if (!stillEligible) {
          await this.#bridge.closeConsumer({
            consumerId: next.consumerId,
            executorLeaseId: next.executorLeaseId,
          }, false).catch(() => undefined);
          if (this.#consumer === current) this.#consumer = null;
          return;
        }
        if (this.#consumer === current) {
          this.#consumer = next;
          this.#setState({ state: 'registered', visible: true, role: 'writer', consumer: next, error: null });
        }
      } catch (error) {
        if (this.#running && version === this.#syncVersion && this.#consumer === current) {
          this.#consumer = null;
          this.#setState({ state: 'error', consumer: null, error: error instanceof Error ? error.message : String(error) });
          this.#synchronizeRequested = true;
        }
      }
      return;
    }

    this.#setState({ state: 'registering', error: null });
    try {
      const consumer = await this.#bridge.registerConsumer({
        consumerId: this.#consumerId,
        executorLeaseId: this.#executorLeaseId,
        writer: true,
        visible: true,
        binding,
      });
      const stillEligible = this.#running
        && version === this.#syncVersion
        && this.isVisible()
        && this.#workspaceLease.getRole() === 'writer';
      if (!stillEligible) {
        await this.#bridge.closeConsumer({
          consumerId: consumer.consumerId,
          executorLeaseId: consumer.executorLeaseId,
        }, false).catch(() => undefined);
        return;
      }
      this.#consumer = consumer;
      this.#startHeartbeat();
      this.#setState({ state: 'registered', visible: true, role: 'writer', consumer, error: null });
    } catch (error) {
      if (this.#running && version === this.#syncVersion) {
        this.#setState({ state: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  #startHeartbeat(): void {
    this.#clearHeartbeat();
    this.#heartbeatHandle = this.#setInterval(() => { void this.#heartbeat(); }, this.#heartbeatIntervalMs);
  }

  #clearHeartbeat(): void {
    if (this.#heartbeatHandle === null) return;
    this.#clearInterval(this.#heartbeatHandle);
    this.#heartbeatHandle = null;
  }

  async #heartbeat(): Promise<void> {
    const current = this.#consumer;
    if (!this.#running) return;
    if (!current) {
      await this.#synchronize();
      return;
    }
    if (
      !this.#bridge.isAgentModeRoute()
      || !this.isVisible()
      || this.#workspaceLease.getRole() !== 'writer'
    ) {
      await this.#synchronize();
      return;
    }
    const binding = this.#getBinding();
    if (!binding) {
      await this.#synchronize();
      return;
    }
    try {
      const next = await this.#bridge.heartbeatConsumer({
        consumerId: current.consumerId,
        executorLeaseId: current.executorLeaseId,
        writer: true,
        visible: true,
        binding,
      });
      const stillEligible = this.#running
        && this.isVisible()
        && this.#workspaceLease.getRole() === 'writer';
      if (!stillEligible) {
        await this.#bridge.closeConsumer({
          consumerId: next.consumerId,
          executorLeaseId: next.executorLeaseId,
        }).catch(() => undefined);
        if (this.#consumer === current) this.#consumer = null;
        return;
      }
      if (this.#consumer === current) {
        this.#consumer = next;
        this.#setState({ state: 'registered', visible: true, role: 'writer', consumer: next, error: null });
      }
    } catch (error) {
      if (this.#consumer !== current || !this.#running) return;
      this.#consumer = null;
      this.#setState({ state: 'error', consumer: null, error: error instanceof Error ? error.message : String(error) });
      await this.#synchronize();
    }
  }

  async #closeCurrentConsumer(): Promise<void> {
    this.#clearHeartbeat();
    const consumer = this.#consumer;
    this.#consumer = null;
    if (!consumer) return;
    await this.#bridge.closeConsumer({
      consumerId: consumer.consumerId,
      executorLeaseId: consumer.executorLeaseId,
    }).catch(() => undefined);
    if (this.#state.consumer !== null) this.#setState({ consumer: null });
  }

  #setState(patch: Partial<DesktopAgentConsumerSnapshot>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener(this.#state);
  }
}

function defaultAgentDocument(): AgentConsumerControllerDocument {
  if (typeof document === 'undefined') {
    return {
      visibilityState: 'hidden',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  }
  return document as unknown as AgentConsumerControllerDocument;
}

function sameConsumerScope(left: ProductBinding, right: ProductBinding): boolean {
  return left.workspaceId === right.workspaceId
    && left.databaseGeneration === right.databaseGeneration
    && left.timelineId === right.timelineId;
}

function sameProductBinding(left: ProductBinding, right: ProductBinding): boolean {
  return sameConsumerScope(left, right)
    && left.checkoutTargetId === right.checkoutTargetId
    && left.checkoutUpdatedAt === right.checkoutUpdatedAt
    && left.contentRevision === right.contentRevision
    && left.snapshotDigest === right.snapshotDigest;
}

export function createDesktopAgentConsumerController(
  options: AgentConsumerControllerOptions,
): DesktopAgentConsumerController {
  return new DesktopAgentConsumerController(options);
}
