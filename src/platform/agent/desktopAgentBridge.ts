import type {
  AgentInteractionEnvelope,
  AgentInteractionList,
  AgentInteractionRespondInput,
  AgentNativeUiLaunch,
  AgentEventPage,
  AgentHostHealth,
  AgentProductSession,
  AgentSessionCreateInput,
  AgentTurnAbortResult,
  AgentTurnAccepted,
  AgentTurnStartInput,
  AgentUiState,
  ApprovalCapabilityVerificationKey,
  BrowserCommandDelivery,
  BrowserCommandResultSubmission,
  BrowserSnapshotPublish,
  BrowserWorkbenchConsumerState,
  BrowserWorkbenchHeartbeat,
  BrowserWorkbenchRegistration,
} from '../../../agent/core/contracts/browser-protocol.ts';
import type {
  DefSessionId,
  DefTurnId,
  InteractionId,
} from '../../../agent/core/contracts/ids.ts';
import {
  AGENT_LAUNCH_GRANT_FRAGMENT_KEY,
  AGENT_APPROVAL_KEY_STORAGE_KEY,
  DEF_AGENT_PROTOCOL_VERSION,
  AGENT_UI_CAPABILITY_HEADER,
  AGENT_UI_CAPABILITY_STORAGE_KEY,
} from '../../../agent/core/contracts/browser-protocol.ts';
import type {
  InteractionRequest,
  InteractionResponse,
  InteractionStateBinding,
} from '../../../agent/core/contracts/interaction.ts';
import type { JsonObject, JsonValue } from '../../../agent/core/contracts/json.ts';
import type { ProductBinding } from '../../../agent/core/contracts/product.ts';
import type { WorkspaceLeaseRole } from '../runtime/workspaceLease';
import { DesktopAgentBridgeError } from './desktopAgentBridgeError';

export { DesktopAgentBridgeError };

export const DESKTOP_AGENT_BRIDGE_ORIGIN = 'http://127.0.0.1:31457';
export const DESKTOP_AGENT_MODE_PATH = '/timeline/ai';
export const DESKTOP_AGENT_LAUNCH_PATH = '/agent-host/ui/launch';
export const DESKTOP_AGENT_HEARTBEAT_INTERVAL_MS = 5_000;
export const DESKTOP_AGENT_COMMAND_LONG_POLL_WAIT_MS = 25_000;

const CAPABILITY_PATTERN = /^[a-zA-Z0-9_-]{20,200}$/;
const AUTHORIZATION_FAILURE_CODES = new Set([
  'AGENT_UI_CAPABILITY_INVALID',
  'AGENT_ORIGIN_DENIED',
  'AGENT_UNAUTHORIZED',
]);
const loadProtocolValidation = () => import('./desktopAgentEventValidation');

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
  /** Increments only after a fresh Host capability is exchanged. */
  readonly capabilityRevision: number;
  readonly host: DesktopAgentHostState;
  readonly engine: AgentHostHealth['engine'] | null;
  readonly error: string | null;
}

export interface AgentBridgeRequestOptions {
  readonly method?: 'GET' | 'POST' | 'DELETE';
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

export interface DesktopAgentLaunch {
  readonly grant: string;
  readonly audience: 'workbench-ai-mode';
  readonly expiresAt: number;
}

export interface DesktopAgentLaunchDependencies {
  readonly fetch?: AgentBridgeFetch;
  readonly bridgeOrigin?: string;
  readonly now?: () => number;
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

function isApprovalVerificationKey(value: unknown): value is ApprovalCapabilityVerificationKey {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  return keys.length === 3
    && keys[0] === 'algorithm'
    && keys[1] === 'keyEpoch'
    && keys[2] === 'publicKeySpki'
    && candidate.algorithm === 'Ed25519'
    && typeof candidate.keyEpoch === 'string'
    && /^[A-Za-z0-9_-]{16,128}$/u.test(candidate.keyEpoch)
    && typeof candidate.publicKeySpki === 'string'
    && /^[A-Za-z0-9_-]{32,1000}$/u.test(candidate.publicKeySpki);
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

const INTERACTION_RESPONSE_STATUSES = new Set<InteractionResponse['status']>([
  'answered',
  'approved',
  'rejected',
  'expired',
  'cancelled',
  'stale',
]);

const INTERACTION_REQUEST_BASE_KEYS = new Set([
  'interactionId',
  'defSessionId',
  'defTurnId',
  'toolCallId',
  'prompt',
  'createdAt',
  'expiresAt',
]);
const INTERACTION_BINDING_KEYS = new Set([
  'workspaceId',
  'databaseGeneration',
  'timelineId',
  'checkoutTargetId',
  'checkoutUpdatedAt',
  'contentRevision',
  'snapshotDigest',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (depth > 32 || !value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry, depth + 1));
  return Object.values(value).every((entry) => isJsonValue(entry, depth + 1));
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && isJsonValue(value);
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(record).every((key) => allowed.has(key));
}

function hasRequiredKeys(record: Record<string, unknown>, required: ReadonlySet<string>): boolean {
  return [...required].every((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function asInteractionBinding(value: unknown): InteractionStateBinding {
  if (!isRecord(value)
    || !hasOnlyKeys(value, INTERACTION_BINDING_KEYS)
    || !hasRequiredKeys(value, INTERACTION_BINDING_KEYS)
    || !isNonEmptyString(value.workspaceId)
    || !isNonEmptyString(value.databaseGeneration)
    || !isNonEmptyString(value.timelineId)
    || (value.checkoutTargetId !== null && !isNonEmptyString(value.checkoutTargetId))
    || typeof value.checkoutUpdatedAt !== 'number'
    || !Number.isFinite(value.checkoutUpdatedAt)
    || !Number.isSafeInteger(value.checkoutUpdatedAt)
    || value.checkoutUpdatedAt < 0
    || typeof value.contentRevision !== 'number'
    || !Number.isSafeInteger(value.contentRevision)
    || value.contentRevision < 0
    || !isNonEmptyString(value.snapshotDigest)) {
    throw new DesktopAgentBridgeError('Agent Host 返回了无效的 interaction 工作区绑定。', 'INVALID_HOST_RESPONSE');
  }
  return value as unknown as InteractionStateBinding;
}

function asInteractionRequest(value: unknown): InteractionRequest {
  if (!isRecord(value)
    || !hasOnlyKeys(value, new Set([...INTERACTION_REQUEST_BASE_KEYS, 'kind', 'details', 'proposalHash', 'binding', 'scope', 'proposal']))
    || !hasRequiredKeys(value, new Set(['interactionId', 'defSessionId', 'defTurnId', 'kind', 'prompt', 'createdAt', 'expiresAt']))
    || !isNonEmptyString(value.interactionId)
    || !isNonEmptyString(value.defSessionId)
    || !isNonEmptyString(value.defTurnId)
    || (value.toolCallId !== undefined && !isNonEmptyString(value.toolCallId))
    || !isNonEmptyString(value.prompt)
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.expiresAt)) {
    throw new DesktopAgentBridgeError('Agent Host 返回了无效的 interaction。', 'INVALID_HOST_RESPONSE');
  }

  if (value.kind === 'question') {
    const allowed = new Set([...INTERACTION_REQUEST_BASE_KEYS, 'kind', 'details']);
    if (!hasOnlyKeys(value, allowed)
      || (value.details !== undefined && !isJsonObject(value.details))) {
      throw new DesktopAgentBridgeError('Agent Host 返回了无效的 question interaction。', 'INVALID_HOST_RESPONSE');
    }
    return value as unknown as InteractionRequest;
  }

  if (value.kind === 'approval') {
    const allowed = new Set([...INTERACTION_REQUEST_BASE_KEYS, 'kind', 'proposalHash', 'binding', 'scope', 'proposal']);
    if (!hasOnlyKeys(value, allowed)
      || !isNonEmptyString(value.proposalHash)
      || !asInteractionBindingOrFalse(value.binding)
      || !Array.isArray(value.scope)
      || value.scope.length === 0
      || !value.scope.every(isNonEmptyString)
      || !isJsonValue(value.proposal)) {
      throw new DesktopAgentBridgeError('Agent Host 返回了无效的 approval interaction。', 'INVALID_HOST_RESPONSE');
    }
    return value as unknown as InteractionRequest;
  }

  throw new DesktopAgentBridgeError('Agent Host 返回了未知的 interaction 类型。', 'INVALID_HOST_RESPONSE');
}

function asInteractionBindingOrFalse(value: unknown): value is InteractionStateBinding {
  try {
    asInteractionBinding(value);
    return true;
  } catch {
    return false;
  }
}

function asInteractionList(data: Record<string, unknown>): AgentInteractionList {
  if (!hasOnlyKeys(data, new Set(['protocolVersion', 'interactions']))
    || !hasRequiredKeys(data, new Set(['protocolVersion', 'interactions']))
    || data.protocolVersion !== 2
    || !Array.isArray(data.interactions)) {
    throw new DesktopAgentBridgeError('Agent Host 返回了无效的 interaction 列表。', 'INVALID_HOST_RESPONSE');
  }
  return {
    protocolVersion: 2,
    interactions: data.interactions.map(asInteractionRequest),
  };
}

function asInteractionRespondInput(value: unknown): AgentInteractionRespondInput {
  if (!isRecord(value)
    || !hasOnlyKeys(value, new Set(['status', 'value']))
    || !hasRequiredKeys(value, new Set(['status']))
    || typeof value.status !== 'string'
    || !INTERACTION_RESPONSE_STATUSES.has(value.status as InteractionResponse['status'])
    || (value.value !== undefined && !isJsonValue(value.value))) {
    throw new DesktopAgentBridgeError('interaction 响应格式无效。', 'INVALID_INTERACTION_RESPONSE', 400);
  }
  return value as AgentInteractionRespondInput;
}

function asInteractionEnvelope(
  data: Record<string, unknown>,
  expectedInteractionId: InteractionId,
): AgentInteractionEnvelope {
  if (!hasOnlyKeys(data, new Set(['protocolVersion', 'interactionId', 'response']))
    || !hasRequiredKeys(data, new Set(['protocolVersion', 'interactionId', 'response']))
    || data.protocolVersion !== 2
    || data.interactionId !== expectedInteractionId
    || !isRecord(data.response)) {
    throw new DesktopAgentBridgeError('Agent Host 返回了无效的 interaction 响应。', 'INVALID_HOST_RESPONSE');
  }
  const response = data.response;
  if (!hasOnlyKeys(response, new Set(['interactionId', 'status', 'value', 'resolvedAt']))
    || !hasRequiredKeys(response, new Set(['interactionId', 'status', 'resolvedAt']))
    || response.interactionId !== expectedInteractionId
    || typeof response.status !== 'string'
    || !INTERACTION_RESPONSE_STATUSES.has(response.status as InteractionResponse['status'])
    || !isTimestamp(response.resolvedAt)
    || (response.value !== undefined && !isJsonValue(response.value))) {
    throw new DesktopAgentBridgeError('Agent Host 返回了无效的 interaction 响应。', 'INVALID_HOST_RESPONSE');
  }
  return data as unknown as AgentInteractionEnvelope;
}

/**
 * Ask the Electron-owned loopback bridge for a single-use launch grant.
 * Normal web deployments have no such bridge; the Canvas hides this desktop-only
 * entry and this request still fails closed if called from an unsupported host.
 */
export async function requestDesktopAgentModeLaunch(
  dependencies: DesktopAgentLaunchDependencies = {},
): Promise<DesktopAgentLaunch> {
  const fetchImpl = dependencies.fetch || defaultFetch;
  const bridgeOrigin = dependencies.bridgeOrigin || DESKTOP_AGENT_BRIDGE_ORIGIN;
  const now = dependencies.now || Date.now;
  let response: AgentBridgeFetchResponse;
  try {
    response = await fetchImpl(`${bridgeOrigin}${DESKTOP_AGENT_LAUNCH_PATH}`, {
      method: 'POST',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    throw new DesktopAgentBridgeError(
      error instanceof Error ? error.message : '桌面 Agent 服务不可访问。',
      'AGENT_LAUNCH_UNREACHABLE',
    );
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new DesktopAgentBridgeError(
      readErrorMessage(payload, `无法启动 AI 模式（${response.status}）。`),
      readErrorCode(payload, 'AGENT_LAUNCH_FAILED'),
      response.status,
    );
  }
  const root = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  const launch = root?.launch && typeof root.launch === 'object' && !Array.isArray(root.launch)
    ? root.launch as Record<string, unknown>
    : null;
  if (
    root?.ok !== true
    || !isSecureCapability(typeof launch?.grant === 'string' ? launch.grant : null)
    || launch?.audience !== 'workbench-ai-mode'
    || typeof launch.expiresAt !== 'number'
    || !Number.isFinite(launch.expiresAt)
    || launch.expiresAt <= now()
  ) {
    throw new DesktopAgentBridgeError(
      '桌面 Agent 返回了无效的启动授权。',
      'INVALID_AGENT_LAUNCH',
      502,
    );
  }
  return {
    grant: launch.grant as string,
    audience: 'workbench-ai-mode',
    expiresAt: launch.expiresAt,
  };
}

function asHealth(data: Record<string, unknown>): AgentHostHealth {
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

function asUiState(data: Record<string, unknown>): AgentUiState {
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

function asConsumerState(data: Record<string, unknown>): BrowserWorkbenchConsumerState {
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

function hasExactKeys(record: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(record);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function asProductSession(data: Record<string, unknown>): AgentProductSession {
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

function asSessionList(data: Record<string, unknown>): readonly AgentProductSession[] {
  if (
    !hasExactKeys(data, new Set(['protocolVersion', 'sessions']))
    || data.protocolVersion !== 2
    || !Array.isArray(data.sessions)
  ) {
    throw new DesktopAgentBridgeError('Agent Host 返回了无效的会话列表。', 'INVALID_HOST_RESPONSE');
  }
  return data.sessions.map((session) => asProductSession({ session }));
}

function asNativeUiLaunch(data: Record<string, unknown>, expectedSessionId: DefSessionId): AgentNativeUiLaunch {
  if (!hasOnlyKeys(data, new Set(['protocolVersion', 'launch']))
    || data.protocolVersion !== DEF_AGENT_PROTOCOL_VERSION
    || !isRecord(data.launch)
    || !hasOnlyKeys(data.launch, new Set(['src', 'defSessionId']))
    || data.launch.defSessionId !== expectedSessionId
    || !isNonEmptyString(data.launch.src)) {
    throw new DesktopAgentBridgeError('Agent Host 返回了无效的原生 OpenCode UI 地址。', 'INVALID_HOST_RESPONSE');
  }
  let url: URL;
  try {
    url = new URL(data.launch.src);
  } catch {
    throw new DesktopAgentBridgeError('Agent Host 返回了无效的原生 OpenCode UI 地址。', 'INVALID_HOST_RESPONSE');
  }
  if (
    url.protocol !== 'http:'
    || url.hostname !== '127.0.0.1'
    || !url.port
    || url.username
    || url.password
    || !url.pathname.includes('/session/')
  ) {
    throw new DesktopAgentBridgeError('原生 OpenCode UI 地址不在受信任的本机网关。', 'INVALID_HOST_RESPONSE');
  }
  return {
    src: url.toString(),
    defSessionId: expectedSessionId,
  };
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
  #reauthorizationAttempted = false;
  #reauthorizationPromise: Promise<string> | null = null;
  #initializePromise: Promise<DesktopAgentBridgeState> | null = null;
  #state: DesktopAgentBridgeState = {
    route: false,
    authorization: 'pending',
    capabilityRevision: 0,
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

  getApprovalVerificationKey(): ApprovalCapabilityVerificationKey | null {
    if (!this.#storage) return null;
    try {
      const encoded = this.#storage.getItem(AGENT_APPROVAL_KEY_STORAGE_KEY);
      if (encoded === null) return null;
      const value = JSON.parse(encoded) as unknown;
      if (isApprovalVerificationKey(value)) return value;
      this.#storage.removeItem(AGENT_APPROVAL_KEY_STORAGE_KEY);
    } catch {
      try {
        this.#storage.removeItem(AGENT_APPROVAL_KEY_STORAGE_KEY);
      } catch {
        // Storage remains fail-closed.
      }
    }
    return null;
  }

  clearSessionCapability(): void {
    try {
      this.#storage?.removeItem(AGENT_UI_CAPABILITY_STORAGE_KEY);
      this.#storage?.removeItem(AGENT_APPROVAL_KEY_STORAGE_KEY);
    } catch {
      // A storage failure is already fail-closed; there is nothing safe to retain.
    }
    this.#setState({ authorization: 'missing', error: null });
  }

  /**
   * Re-authorize this already-open AI page after the Host epoch changed.
   * Exactly one automatic attempt is allowed per bridge instance; callers may
   * explicitly use retryAuthorization after presenting the failure to a user.
   */
  reauthorize(): Promise<string> {
    if (!this.isAgentModeRoute()) {
      return Promise.reject(new DesktopAgentBridgeError('当前页面不是 AI 模式。', 'AGENT_ROUTE_REQUIRED', 403));
    }
    if (this.#reauthorizationPromise) return this.#reauthorizationPromise;
    if (this.#reauthorizationAttempted) {
      return Promise.reject(new DesktopAgentBridgeError(
        'AI 模式重授权失败，请点击“重试”再次尝试。',
        'AGENT_REAUTH_EXHAUSTED',
        403,
      ));
    }
    this.#reauthorizationAttempted = true;
    const promise = (async () => {
      this.clearSessionCapability();
      this.#setState({ authorization: 'pending', error: null });
      try {
        const launch = await requestDesktopAgentModeLaunch({
          fetch: this.#fetch,
          bridgeOrigin: this.#origin,
          now: this.#now,
        });
        return await this.#exchangeLaunchGrant(launch.grant, true);
      } catch (error) {
        this.clearSessionCapability();
        const cause = error instanceof Error ? error.message : 'AI 模式重授权失败。';
        this.#setState({ authorization: 'failed', error: cause });
        throw error;
      }
    })().finally(() => {
      if (this.#reauthorizationPromise === promise) this.#reauthorizationPromise = null;
    });
    this.#reauthorizationPromise = promise;
    return promise;
  }

  retryAuthorization(): Promise<string> {
    this.#reauthorizationAttempted = false;
    return this.reauthorize();
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
    let launchGrant: string | null = null;
    try {
      // Scrub the launch secret before the first network await so it never
      // lingers in the address bar, history, or an error screenshot. Capture
      // it even when sessionStorage already contains a capability: after a
      // Host restart that stored capability belongs to the dead Host, while a
      // fresh launch grant is the authoritative replacement credential.
      launchGrant = this.captureLaunchGrant();
    } catch (error) {
      this.#setState({
        authorization: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      return this.#state;
    }
    let currentCapability = this.getSessionCapability();
    if (launchGrant) {
      this.clearSessionCapability();
      this.#setState({ authorization: 'pending', error: null });
      currentCapability = null;
    } else if (currentCapability && !this.getApprovalVerificationKey()) {
      this.clearSessionCapability();
      currentCapability = null;
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
    return this.#exchangeLaunchGrant(launchGrant, false);
  }

  async #exchangeLaunchGrant(launchGrant: string | undefined, allowReauthorization: boolean): Promise<string> {
    if (!this.isAgentModeRoute()) {
      throw new DesktopAgentBridgeError('当前页面不是 AI 模式。', 'AGENT_ROUTE_REQUIRED', 403);
    }
    const grant = launchGrant || this.#pendingLaunchGrant;
    this.#pendingLaunchGrant = null;
    if (!isSecureCapability(grant)) {
      throw new DesktopAgentBridgeError('AI 模式授权缺失或格式无效。', 'AGENT_LAUNCH_GRANT_INVALID', 403);
    }
    if (this.#launchGrantExchangeAttempted && !allowReauthorization) {
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
      approvalVerificationKey: unknown;
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
      || !isApprovalVerificationKey(record.approvalVerificationKey)
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
      this.#storage.setItem(
        AGENT_APPROVAL_KEY_STORAGE_KEY,
        JSON.stringify(record.approvalVerificationKey),
      );
    } catch (error) {
      this.clearSessionCapability();
      throw new DesktopAgentBridgeError(
        '当前标签页无法保存 AI 模式授权。',
        'SESSION_STORAGE_UNAVAILABLE',
        500,
      );
    }
    this.#setState({
      authorization: 'authorized',
      capabilityRevision: this.#state.capabilityRevision + 1,
      error: null,
    });
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
    const data = await this.#requestWithReauthorization('/agent-host/ui/state');
    const state = asUiState(data);
    this.#setState({
      authorization: 'authorized',
      engine: state.engine,
      error: null,
    });
    return state;
  }

  async registerConsumer(input: BrowserWorkbenchRegistration): Promise<BrowserWorkbenchConsumerState> {
    const data = await this.#requestWithReauthorization('/agent-host/workbench/register', {
      method: 'POST',
      body: input,
    });
    return asConsumerState(data);
  }

  async heartbeatConsumer(input: BrowserWorkbenchHeartbeat): Promise<BrowserWorkbenchConsumerState> {
    const data = await this.#requestWithReauthorization('/agent-host/workbench/heartbeat', {
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
    readonly waitMs?: number;
  }): Promise<BrowserCommandDelivery | null> {
    const query = new URLSearchParams({
      consumerId: input.consumerId,
      executorLeaseId: input.executorLeaseId,
      afterCursor: String(input.afterCursor),
    });
    if (input.waitMs && Number.isSafeInteger(input.waitMs) && input.waitMs > 0) {
      query.set('waitMs', String(input.waitMs));
    }
    const data = await this.#requestWithReauthorization(`/agent-host/workbench/commands/next?${query}`);
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
    return asSessionList(await this.#requestWithReauthorization('/agent-host/sessions'));
  }

  async listInteractions(): Promise<readonly InteractionRequest[]> {
    const data = await this.#requestWithReauthorization('/agent-host/interactions');
    return asInteractionList(data).interactions;
  }

  async listPendingInteractions(): Promise<readonly InteractionRequest[]> {
    return this.listInteractions();
  }

  async respondInteraction(
    interactionId: InteractionId,
    input: AgentInteractionRespondInput,
  ): Promise<InteractionResponse> {
    if (!isNonEmptyString(interactionId)) {
      throw new DesktopAgentBridgeError('interactionId 无效。', 'INVALID_INTERACTION_ID', 400);
    }
    const responseInput = asInteractionRespondInput(input);
    const data = await this.#request(
      `/agent-host/interactions/${encodeURIComponent(interactionId)}/respond`,
      { method: 'POST', body: responseInput },
    );
    return asInteractionEnvelope(data, interactionId).response;
  }

  async answerQuestion(interactionId: InteractionId, value: JsonValue): Promise<InteractionResponse> {
    if (!isJsonValue(value)) {
      throw new DesktopAgentBridgeError('question 回答必须是合法 JSON 值。', 'INVALID_INTERACTION_RESPONSE', 400);
    }
    return this.respondInteraction(interactionId, { status: 'answered', value });
  }

  async approveInteraction(interactionId: InteractionId): Promise<InteractionResponse> {
    return this.respondInteraction(interactionId, { status: 'approved' });
  }

  async rejectInteraction(interactionId: InteractionId, value?: JsonValue): Promise<InteractionResponse> {
    if (value !== undefined && !isJsonValue(value)) {
      throw new DesktopAgentBridgeError('approval 拒绝原因必须是合法 JSON 值。', 'INVALID_INTERACTION_RESPONSE', 400);
    }
    return this.respondInteraction(interactionId, {
      status: 'rejected',
      ...(value === undefined ? {} : { value }),
    });
  }

  async cancelInteraction(interactionId: InteractionId): Promise<InteractionResponse> {
    return this.respondInteraction(interactionId, { status: 'cancelled' });
  }

  async createSession(input: AgentSessionCreateInput = {}): Promise<AgentProductSession> {
    const data = await this.#request('/agent-host/sessions', {
      method: 'POST',
      body: input,
    });
    return asProductSession(data);
  }

  async launchNativeUi(defSessionId: DefSessionId): Promise<AgentNativeUiLaunch> {
    const data = await this.#requestWithReauthorization('/agent-host/native-ui/launch', {
      method: 'POST',
      body: { defSessionId },
    });
    return asNativeUiLaunch(data, defSessionId);
  }

  async getSession(defSessionId: DefSessionId): Promise<AgentProductSession> {
    const data = await this.#requestWithReauthorization(`/agent-host/sessions/${encodeURIComponent(defSessionId)}`);
    return asProductSession(data);
  }

  async archiveSession(defSessionId: DefSessionId): Promise<AgentProductSession> {
    const data = await this.#request(
      `/agent-host/sessions/${encodeURIComponent(defSessionId)}/archive`,
      { method: 'POST', body: {} },
    );
    return asProductSession(data);
  }

  async restoreSession(defSessionId: DefSessionId): Promise<AgentProductSession> {
    const data = await this.#request(
      `/agent-host/sessions/${encodeURIComponent(defSessionId)}/restore`,
      { method: 'POST', body: {} },
    );
    return asProductSession(data);
  }

  async deleteSession(defSessionId: DefSessionId): Promise<void> {
    await this.#request(`/agent-host/sessions/${encodeURIComponent(defSessionId)}`, {
      method: 'DELETE',
    });
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
    const data = await this.#requestWithReauthorization(
      `/agent-host/sessions/${encodeURIComponent(defSessionId)}/events?${query}`,
    );
    const { parseProductEventPage } = await loadProtocolValidation();
    return parseProductEventPage(data, defSessionId, afterSequence, limit);
  }

  async startTurn(
    defSessionId: DefSessionId,
    input: AgentTurnStartInput,
  ): Promise<AgentTurnAccepted> {
    const data = await this.#request(
      `/agent-host/sessions/${encodeURIComponent(defSessionId)}/turns`,
      { method: 'POST', body: input },
    );
    const { parseTurnAccepted } = await loadProtocolValidation();
    return parseTurnAccepted(data, defSessionId, input.clientTurnId);
  }

  async abortTurn(defTurnId: DefTurnId): Promise<AgentTurnAbortResult> {
    const data = await this.#request(
      `/agent-host/turns/${encodeURIComponent(defTurnId)}/abort`,
      { method: 'POST', body: {} },
    );
    const { parseTurnAbortResult } = await loadProtocolValidation();
    return parseTurnAbortResult(data, defTurnId);
  }

  async refreshHostState(): Promise<AgentHostHealth> {
    return this.getHealth();
  }

  async refreshUiState(): Promise<AgentUiState> {
    return this.getUiState();
  }

  async #requestWithReauthorization(
    path: string,
    options: AgentBridgeRequestOptions = {},
  ): Promise<Record<string, unknown>> {
    try {
      return await this.#request(path, options);
    } catch (error) {
      if (!(error instanceof DesktopAgentBridgeError)
        || error.code !== 'AGENT_UNAUTHORIZED'
        || options.authorized === false) {
        throw error;
      }
      await this.reauthorize();
      // The retry is deliberately outside another recovery wrapper. A bad
      // grant or a second 403 becomes a visible terminal error instead of a
      // request/reauthorization loop.
      return this.#request(path, options);
    }
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
      const responseCode = readErrorCode(payload, 'HOST_REQUEST_FAILED');
      const authorizationFailure = response.status === 401
        || (response.status === 403 && (
          responseCode === 'HOST_REQUEST_FAILED'
          || AUTHORIZATION_FAILURE_CODES.has(responseCode)
        ));
      if (authorized && authorizationFailure) this.clearSessionCapability();
      throw new DesktopAgentBridgeError(
        readErrorMessage(payload, `Agent Host 请求失败（${response.status}）。`),
        authorizationFailure
          ? 'AGENT_UNAUTHORIZED'
          : responseCode,
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
  readonly #onBridgeState = (state: DesktopAgentBridgeState) => {
    if (
      this.#running
      && this.#consumer
      && state.capabilityRevision !== this.#consumerCapabilityRevision
    ) {
      void this.#synchronize();
    }
  };
  #leaseUnsubscribe: (() => void) | null = null;
  #bridgeUnsubscribe: (() => void) | null = null;
  #heartbeatHandle: unknown = null;
  #consumer: BrowserWorkbenchConsumerState | null = null;
  #consumerCapabilityRevision = -1;
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
    this.#bridgeUnsubscribe = this.#bridge.subscribe(this.#onBridgeState);
    this.#leaseUnsubscribe = this.#workspaceLease.subscribe?.(() => { void this.#synchronize(); }) || null;
    return this.#synchronize();
  }

  refreshEligibility(): Promise<void> {
    return this.#synchronize();
  }

  async stop(keepalive = false): Promise<void> {
    if (!this.#running && !this.#consumer) {
      this.#bridgeUnsubscribe?.();
      this.#bridgeUnsubscribe = null;
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
    this.#bridgeUnsubscribe?.();
    this.#bridgeUnsubscribe = null;
    this.#clearHeartbeat();
    const consumer = this.#consumer;
    this.#consumer = null;
    this.#consumerCapabilityRevision = -1;
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
    const capabilityRevision = this.#bridge.getState().capabilityRevision;
    if (this.#consumer && this.#consumerCapabilityRevision !== capabilityRevision) {
      await this.#closeCurrentConsumer();
    }
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
          if (this.#consumer === current) {
            this.#consumer = null;
            this.#consumerCapabilityRevision = -1;
          }
          return;
        }
        if (this.#consumer === current) {
          this.#consumer = next;
          this.#consumerCapabilityRevision = this.#bridge.getState().capabilityRevision;
          this.#setState({ state: 'registered', visible: true, role: 'writer', consumer: next, error: null });
        }
      } catch (error) {
        if (this.#running && version === this.#syncVersion && this.#consumer === current) {
          this.#consumer = null;
          this.#consumerCapabilityRevision = -1;
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
      this.#consumerCapabilityRevision = this.#bridge.getState().capabilityRevision;
      this.#startHeartbeat();
      this.#setState({ state: 'registered', visible: true, role: 'writer', consumer, error: null });
    } catch (error) {
      if (this.#running && version === this.#syncVersion) {
        this.#setState({ state: 'error', error: error instanceof Error ? error.message : String(error) });
        // A previous visible tab or a renderer that is still unloading may
        // legitimately own the Host lease for a few more seconds. Keep the
        // bounded heartbeat clock alive so this eligible writer retries after
        // that lease closes or expires instead of remaining stuck forever.
        this.#startHeartbeat();
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
    if (this.#consumerCapabilityRevision !== this.#bridge.getState().capabilityRevision) {
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
        if (this.#consumer === current) {
          this.#consumer = null;
          this.#consumerCapabilityRevision = -1;
        }
        return;
      }
      if (this.#consumer === current) {
        this.#consumer = next;
        this.#consumerCapabilityRevision = this.#bridge.getState().capabilityRevision;
        this.#setState({ state: 'registered', visible: true, role: 'writer', consumer: next, error: null });
      }
    } catch (error) {
      if (this.#consumer !== current || !this.#running) return;
      this.#consumer = null;
      this.#consumerCapabilityRevision = -1;
      this.#setState({ state: 'error', consumer: null, error: error instanceof Error ? error.message : String(error) });
      await this.#synchronize();
    }
  }

  async #closeCurrentConsumer(): Promise<void> {
    this.#clearHeartbeat();
    const consumer = this.#consumer;
    this.#consumer = null;
    this.#consumerCapabilityRevision = -1;
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
