import {
  type BrowserWorkbenchConsumerState,
  type BrowserWorkbenchHeartbeat,
  type BrowserWorkbenchRegistration,
} from '../core/contracts/index.ts';
import type { AgentUiCapabilityClaims } from './token-authority.ts';
import { DefAgentHostError } from './errors.ts';

const DEFAULT_HEARTBEAT_TTL_MS = 15_000;

type ActiveConsumer = BrowserWorkbenchConsumerState & {
  readonly capabilityId: string;
};

export class BrowserConsumerRegistry {
  readonly #clock: () => number;
  readonly #heartbeatTtlMs: number;
  readonly #onConsumerLost: (reason: 'expired' | 'closed' | 'cleared') => void;
  readonly #setTimeout: (handler: () => void, timeout: number) => unknown;
  readonly #clearTimeout: (handle: unknown) => void;
  #active: ActiveConsumer | null = null;
  #expiryHandle: unknown = null;

  constructor(options: {
    readonly clock?: () => number;
    readonly heartbeatTtlMs?: number;
    readonly onConsumerLost?: (reason: 'expired' | 'closed' | 'cleared') => void;
    readonly setTimeout?: (handler: () => void, timeout: number) => unknown;
    readonly clearTimeout?: (handle: unknown) => void;
  } = {}) {
    this.#clock = options.clock ?? Date.now;
    this.#heartbeatTtlMs = options.heartbeatTtlMs ?? DEFAULT_HEARTBEAT_TTL_MS;
    this.#onConsumerLost = options.onConsumerLost ?? (() => {});
    this.#setTimeout = options.setTimeout ?? ((handler, timeout) => {
      const handle = globalThis.setTimeout(handler, timeout);
      const unref = (handle as unknown as { unref?: () => void }).unref;
      if (typeof unref === 'function') unref.call(handle);
      return handle;
    });
    this.#clearTimeout = options.clearTimeout
      ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  register(
    claims: AgentUiCapabilityClaims,
    input: BrowserWorkbenchRegistration,
  ): BrowserWorkbenchConsumerState {
    this.#expireStale();
    if (this.#active && (
      this.#active.capabilityId !== claims.capabilityId
      || this.#active.consumerId !== input.consumerId
      || this.#active.executorLeaseId !== input.executorLeaseId
    )) {
      throw new DefAgentHostError(
        'AGENT_CONSUMER_CONFLICT',
        'Another Browser Workbench consumer is already active',
      );
    }
    const now = this.#clock();
    this.#active = {
      capabilityId: claims.capabilityId,
      consumerId: input.consumerId,
      executorLeaseId: input.executorLeaseId,
      binding: input.binding,
      registeredAt: this.#active?.registeredAt ?? now,
      heartbeatExpiresAt: now + this.#heartbeatTtlMs,
    };
    this.#scheduleExpiry();
    return this.current()!;
  }

  heartbeat(
    claims: AgentUiCapabilityClaims,
    input: BrowserWorkbenchHeartbeat,
  ): BrowserWorkbenchConsumerState {
    const active = this.#requireMatching(claims, input.consumerId, input.executorLeaseId);
    assertStableWorkspaceBinding(active.binding, input.binding);
    this.#active = {
      ...active,
      binding: input.binding,
      heartbeatExpiresAt: this.#clock() + this.#heartbeatTtlMs,
    };
    this.#scheduleExpiry();
    return this.current()!;
  }

  close(
    claims: AgentUiCapabilityClaims,
    input: { readonly consumerId: string; readonly executorLeaseId: string },
  ): void {
    this.#requireMatching(claims, input.consumerId, input.executorLeaseId);
    this.#clearExpiry();
    this.#active = null;
    this.#onConsumerLost('closed');
  }

  requireActive(claims?: AgentUiCapabilityClaims): BrowserWorkbenchConsumerState {
    this.#expireStale();
    if (!this.#active) {
      throw new DefAgentHostError('AGENT_CONSUMER_REQUIRED', 'A visible writer consumer is required', 409);
    }
    if (claims && this.#active.capabilityId !== claims.capabilityId) {
      throw new DefAgentHostError('AGENT_CONSUMER_CONFLICT', 'Agent UI capability does not own the active consumer', 403);
    }
    return this.current()!;
  }

  current(): BrowserWorkbenchConsumerState | null {
    this.#expireStale();
    if (!this.#active) return null;
    const { capabilityId: _capabilityId, ...state } = this.#active;
    return state;
  }

  currentFor(claims: AgentUiCapabilityClaims): BrowserWorkbenchConsumerState | null {
    this.#expireStale();
    if (!this.#active || this.#active.capabilityId !== claims.capabilityId) return null;
    const { capabilityId: _capabilityId, ...state } = this.#active;
    return state;
  }

  clear(): void {
    const hadActiveConsumer = Boolean(this.#active);
    this.#clearExpiry();
    this.#active = null;
    if (hadActiveConsumer) this.#onConsumerLost('cleared');
  }

  #requireMatching(
    claims: AgentUiCapabilityClaims,
    consumerId: string,
    executorLeaseId: string,
  ): ActiveConsumer {
    this.#expireStale();
    const active = this.#active;
    if (!active) {
      throw new DefAgentHostError('AGENT_CONSUMER_STALE', 'Browser Workbench consumer is missing or stale', 409);
    }
    if (
      active.capabilityId !== claims.capabilityId
      || active.consumerId !== consumerId
      || active.executorLeaseId !== executorLeaseId
    ) {
      throw new DefAgentHostError('AGENT_CONSUMER_CONFLICT', 'Browser Workbench consumer identity mismatch', 403);
    }
    return active;
  }

  #expireStale(): void {
    if (this.#active && this.#active.heartbeatExpiresAt <= this.#clock()) {
      this.#clearExpiry();
      this.#active = null;
      this.#onConsumerLost('expired');
    }
  }

  #scheduleExpiry(): void {
    this.#clearExpiry();
    if (!this.#active) return;
    const delay = Math.max(0, this.#active.heartbeatExpiresAt - this.#clock());
    this.#expiryHandle = this.#setTimeout(() => {
      this.#expiryHandle = null;
      this.#expireStale();
      if (this.#active) this.#scheduleExpiry();
    }, delay);
  }

  #clearExpiry(): void {
    if (this.#expiryHandle === null) return;
    this.#clearTimeout(this.#expiryHandle);
    this.#expiryHandle = null;
  }
}

function assertStableWorkspaceBinding(
  current: BrowserWorkbenchConsumerState['binding'],
  next: BrowserWorkbenchConsumerState['binding'],
): void {
  if (
    current.workspaceId !== next.workspaceId
    || current.databaseGeneration !== next.databaseGeneration
    || current.timelineId !== next.timelineId
  ) {
    throw new DefAgentHostError(
      'AGENT_BINDING_CONFLICT',
      'Browser consumer cannot change workspace, generation, or timeline in place',
    );
  }
}
