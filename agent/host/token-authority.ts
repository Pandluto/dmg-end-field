import { createHash, randomBytes } from 'node:crypto';
import {
  DEF_AGENT_PROTOCOL_VERSION,
  type AgentLaunchAudience,
  type AgentLaunchGrantRegistration,
  type AgentUiSession,
} from '../core/contracts/index.ts';
import { DefAgentHostError } from './errors.ts';

const DEFAULT_UI_CAPABILITY_TTL_MS = 8 * 60 * 60 * 1_000;

export interface AgentUiCapabilityClaims {
  readonly capabilityId: string;
  readonly origin: string;
  readonly audience: AgentLaunchAudience;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

type LaunchGrantRecord = Omit<AgentLaunchGrantRegistration, 'grant'>;

export class AgentTokenAuthority {
  readonly #clock: () => number;
  readonly #randomToken: () => string;
  readonly #uiCapabilityTtlMs: number;
  readonly #launchGrants = new Map<string, LaunchGrantRecord>();
  readonly #capabilities = new Map<string, AgentUiCapabilityClaims>();

  constructor(options: {
    readonly clock?: () => number;
    readonly randomToken?: () => string;
    readonly uiCapabilityTtlMs?: number;
  } = {}) {
    this.#clock = options.clock ?? Date.now;
    this.#randomToken = options.randomToken ?? (() => randomBytes(32).toString('base64url'));
    this.#uiCapabilityTtlMs = options.uiCapabilityTtlMs ?? DEFAULT_UI_CAPABILITY_TTL_MS;
  }

  registerLaunchGrant(input: AgentLaunchGrantRegistration): void {
    if (!isSecureToken(input.grant) || input.expiresAt <= this.#clock()) {
      throw new DefAgentHostError(
        'AGENT_LAUNCH_GRANT_INVALID',
        'Agent launch grant is invalid or already expired',
        403,
      );
    }
    const origin = normalizeOrigin(input.origin);
    this.#sweep();
    this.#launchGrants.set(tokenDigest(input.grant), {
      origin,
      audience: input.audience,
      expiresAt: input.expiresAt,
    });
  }

  exchangeLaunchGrant(input: {
    readonly grant: string;
    readonly origin: string;
    readonly audience: AgentLaunchAudience;
  }): AgentUiSession {
    const digest = tokenDigest(input.grant);
    const record = this.#launchGrants.get(digest);
    this.#launchGrants.delete(digest);
    const now = this.#clock();
    if (!record || record.expiresAt <= now || !isSecureToken(input.grant)) {
      throw new DefAgentHostError(
        'AGENT_LAUNCH_GRANT_INVALID',
        'Agent launch grant is invalid, expired, or already consumed',
        403,
      );
    }
    const origin = normalizeOrigin(input.origin);
    if (record.origin !== origin || record.audience !== input.audience) {
      throw new DefAgentHostError(
        'AGENT_ORIGIN_DENIED',
        'Agent launch grant is not valid for this origin or audience',
        403,
      );
    }

    const capability = this.#randomToken();
    if (!isSecureToken(capability)) throw new Error('Agent capability generator returned an unsafe token');
    const capabilityId = tokenDigest(capability);
    const expiresAt = now + this.#uiCapabilityTtlMs;
    this.#capabilities.set(capabilityId, {
      capabilityId,
      origin,
      audience: record.audience,
      issuedAt: now,
      expiresAt,
    });
    return {
      protocolVersion: DEF_AGENT_PROTOCOL_VERSION,
      capability,
      audience: record.audience,
      expiresAt,
    };
  }

  validateCapability(input: {
    readonly capability: string;
    readonly origin: string;
    readonly audience: AgentLaunchAudience;
  }): AgentUiCapabilityClaims {
    if (!isSecureToken(input.capability)) {
      throw new DefAgentHostError('AGENT_UI_CAPABILITY_INVALID', 'Agent UI capability is required', 403);
    }
    const capabilityId = tokenDigest(input.capability);
    const claims = this.#capabilities.get(capabilityId);
    const now = this.#clock();
    if (!claims || claims.expiresAt <= now) {
      this.#capabilities.delete(capabilityId);
      throw new DefAgentHostError('AGENT_UI_CAPABILITY_INVALID', 'Agent UI capability is invalid or expired', 403);
    }
    if (claims.origin !== normalizeOrigin(input.origin) || claims.audience !== input.audience) {
      throw new DefAgentHostError('AGENT_ORIGIN_DENIED', 'Agent UI capability scope mismatch', 403);
    }
    return claims;
  }

  revokeCapability(capabilityId: string): void {
    this.#capabilities.delete(capabilityId);
  }

  clear(): void {
    this.#launchGrants.clear();
    this.#capabilities.clear();
  }

  #sweep(): void {
    const now = this.#clock();
    for (const [digest, record] of this.#launchGrants) {
      if (record.expiresAt <= now) this.#launchGrants.delete(digest);
    }
    for (const [id, claims] of this.#capabilities) {
      if (claims.expiresAt <= now) this.#capabilities.delete(id);
    }
  }
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
    ) {
      throw new Error('invalid origin');
    }
    return url.origin;
  } catch {
    throw new DefAgentHostError('AGENT_ORIGIN_DENIED', 'Agent browser origin is invalid', 403);
  }
}

function tokenDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isSecureToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{20,200}$/.test(value);
}
