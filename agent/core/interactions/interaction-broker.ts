import type {
  CommandId,
  DefSessionId,
  DefTurnId,
  InteractionId,
  ToolCallId,
} from '../contracts/ids.ts';
import type {
  ApprovalCapabilityClaims,
  InteractionKind,
  InteractionRequest,
  InteractionResponse,
  InteractionStateBinding,
  InteractionStatus,
} from '../contracts/interaction.ts';
import type { JsonObject, JsonValue } from '../contracts/json.ts';

export type InteractionBrokerErrorCode =
  | 'INTERACTION_BROKER_CONFIG_INVALID'
  | 'INTERACTION_REQUEST_INVALID'
  | 'INTERACTION_ID_CONFLICT'
  | 'INTERACTION_NOT_FOUND'
  | 'INTERACTION_NOT_PENDING'
  | 'INTERACTION_KIND_MISMATCH'
  | 'INTERACTION_RESPONSE_INVALID'
  | 'INTERACTION_RESPONSE_CONFLICT'
  | 'INTERACTION_CAPABILITY_UNAVAILABLE'
  | 'INTERACTION_CAPABILITY_INVALID'
  | 'INTERACTION_CAPABILITY_BINDING_MISMATCH'
  | 'INTERACTION_CAPABILITY_COMMAND_CONFLICT'
  | 'INTERACTION_CAPABILITY_CONSUMED'
  | 'INTERACTION_CAPABILITY_INVALIDATED'
  | 'INTERACTION_CAPABILITY_EXPIRED'
  | 'INTERACTION_NONCE_CONFLICT';

export class InteractionBrokerError extends Error {
  readonly code: InteractionBrokerErrorCode;

  constructor(code: InteractionBrokerErrorCode, message: string) {
    super(message);
    this.name = 'InteractionBrokerError';
    this.code = code;
  }
}

export type ApprovalCapabilityState =
  | 'not-applicable'
  | 'not-issued'
  | 'issued'
  | 'consumed'
  | 'invalidated';

export interface InteractionSnapshot {
  readonly request: InteractionRequest;
  readonly status: InteractionStatus;
  readonly response: InteractionResponse | null;
  readonly capabilityState: ApprovalCapabilityState;
}

export interface InteractionFilter {
  readonly defSessionId?: DefSessionId;
  readonly defTurnId?: DefTurnId;
  readonly kind?: InteractionKind;
}

export interface ApprovalCapabilityExpectation {
  readonly interactionId?: InteractionId;
  readonly commandId?: CommandId;
  readonly defSessionId?: DefSessionId;
  readonly defTurnId?: DefTurnId;
  readonly toolCallId?: ToolCallId;
  readonly proposalHash?: string;
  readonly binding?: InteractionStateBinding;
  readonly scope?: readonly string[];
}

export interface InteractionBrokerOptions {
  readonly clock?: () => number;
  readonly keyEpoch?: string;
  readonly nonceFactory?: (interactionId: InteractionId) => string;
}

type CapabilityInvalidationReason = 'expired' | 'explicit';

type StoredCapability = {
  claims: ApprovalCapabilityClaims;
  state: Exclude<ApprovalCapabilityState, 'not-applicable' | 'not-issued'>;
  invalidationReason?: CapabilityInvalidationReason;
};

type StoredInteraction = {
  request: InteractionRequest;
  requestFingerprint: string;
  status: InteractionStatus;
  response: InteractionResponse | null;
  capability: StoredCapability | null;
};

export class InteractionBroker {
  readonly #clock: () => number;
  readonly #keyEpoch: string;
  readonly #nonceFactory: (interactionId: InteractionId) => string;
  readonly #interactions = new Map<InteractionId, StoredInteraction>();
  readonly #usedNonces = new Set<string>();

  get keyEpoch(): string {
    return this.#keyEpoch;
  }

  constructor(options: InteractionBrokerOptions = {}) {
    this.#clock = options.clock ?? Date.now;
    this.#keyEpoch = options.keyEpoch ?? 'memory';
    if (!this.#keyEpoch.trim()) {
      throw new InteractionBrokerError(
        'INTERACTION_BROKER_CONFIG_INVALID',
        'Interaction Broker keyEpoch must be a non-empty string',
      );
    }

    let nonceSequence = 0;
    this.#nonceFactory = options.nonceFactory ?? (() => `memory-nonce-${++nonceSequence}`);
  }

  register(request: InteractionRequest): InteractionSnapshot {
    const now = this.#now();
    this.#expireDue(now);
    this.#assertValidRequest(request);
    const requestFingerprint = stableSerialize(request);
    const existing = this.#interactions.get(request.interactionId);
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new InteractionBrokerError(
          'INTERACTION_ID_CONFLICT',
          `Interaction ${request.interactionId} is already registered with a different request`,
        );
      }
      return this.#snapshot(existing);
    }

    const stored: StoredInteraction = {
      request: cloneRequest(request),
      requestFingerprint,
      status: 'pending',
      response: null,
      capability: null,
    };
    this.#interactions.set(request.interactionId, stored);
    if (timestamp(request.expiresAt) <= now) {
      this.#resolvePending(stored, this.#generatedResponse(request.interactionId, 'expired', now));
    }
    return this.#snapshot(stored);
  }

  get(interactionId: InteractionId): InteractionSnapshot | null {
    this.#expireDue(this.#now());
    const interaction = this.#interactions.get(interactionId);
    return interaction ? this.#snapshot(interaction) : null;
  }

  require(interactionId: InteractionId): InteractionSnapshot {
    const snapshot = this.get(interactionId);
    if (!snapshot) {
      throw new InteractionBrokerError(
        'INTERACTION_NOT_FOUND',
        `Interaction ${interactionId} does not exist`,
      );
    }
    return snapshot;
  }

  listPending(filter: InteractionFilter = {}): readonly InteractionSnapshot[] {
    this.#expireDue(this.#now());
    return [...this.#interactions.values()]
      .filter((interaction) => interaction.status === 'pending')
      .filter((interaction) => (
        filter.defSessionId === undefined
        || interaction.request.defSessionId === filter.defSessionId
      ))
      .filter((interaction) => (
        filter.defTurnId === undefined
        || interaction.request.defTurnId === filter.defTurnId
      ))
      .filter((interaction) => (
        filter.kind === undefined
        || interaction.request.kind === filter.kind
      ))
      .map((interaction) => this.#snapshot(interaction));
  }

  answer(interactionId: InteractionId, value: JsonValue): InteractionSnapshot {
    return this.#respondGenerated(interactionId, 'answered', value);
  }

  approve(interactionId: InteractionId, value?: JsonValue): InteractionSnapshot {
    return this.#respondGenerated(interactionId, 'approved', value);
  }

  reject(interactionId: InteractionId, value?: JsonValue): InteractionSnapshot {
    return this.#respondGenerated(interactionId, 'rejected', value);
  }

  cancel(interactionId: InteractionId): InteractionSnapshot {
    return this.#respondGenerated(interactionId, 'cancelled');
  }

  expire(interactionId: InteractionId): InteractionSnapshot {
    return this.#respondGenerated(interactionId, 'expired');
  }

  stale(interactionId: InteractionId): InteractionSnapshot {
    return this.#respondGenerated(interactionId, 'stale');
  }

  respond(response: InteractionResponse): InteractionSnapshot {
    const now = this.#now();
    this.#expireDue(now);
    const interaction = this.#requireStored(response.interactionId);
    this.#assertResponse(response, interaction.request.kind);
    if (interaction.status !== 'pending') {
      if (interaction.response && equivalentResponse(interaction.response, response)) {
        return this.#snapshot(interaction);
      }
      throw new InteractionBrokerError(
        'INTERACTION_RESPONSE_CONFLICT',
        `Interaction ${response.interactionId} is already resolved as ${interaction.status}`,
      );
    }
    this.#resolvePending(interaction, response);
    return this.#snapshot(interaction);
  }

  expireDue(): readonly InteractionSnapshot[] {
    const now = this.#now();
    this.#expireDue(now);
    return [...this.#interactions.values()]
      .filter((interaction) => interaction.status === 'expired')
      .map((interaction) => this.#snapshot(interaction));
  }

  issueApprovalCapability(
    interactionId: InteractionId,
    commandId: CommandId,
  ): ApprovalCapabilityClaims {
    const now = this.#now();
    this.#expireDue(now);
    const interaction = this.#requireStored(interactionId);
    if (interaction.request.kind !== 'approval') {
      throw new InteractionBrokerError(
        'INTERACTION_KIND_MISMATCH',
        `Interaction ${interactionId} is not an approval`,
      );
    }
    if (interaction.status !== 'approved') {
      throw new InteractionBrokerError(
        'INTERACTION_CAPABILITY_UNAVAILABLE',
        `Interaction ${interactionId} is not approved`,
      );
    }
    const existing = interaction.capability;
    if (existing) {
      if (existing.claims.commandId !== commandId) {
        throw new InteractionBrokerError(
          'INTERACTION_CAPABILITY_COMMAND_CONFLICT',
          `Interaction ${interactionId} already issued a capability for another Command`,
        );
      }
      this.#assertCapabilityState(existing);
      return cloneClaims(existing.claims);
    }
    if (!interaction.request.toolCallId) {
      throw new InteractionBrokerError(
        'INTERACTION_CAPABILITY_UNAVAILABLE',
        `Approved Interaction ${interactionId} has no Tool Call binding`,
      );
    }
    if (timestamp(interaction.request.expiresAt) <= now) {
      throw new InteractionBrokerError(
        'INTERACTION_CAPABILITY_EXPIRED',
        `Approval capability for Interaction ${interactionId} has expired`,
      );
    }
    const nonce = this.#nonceFactory(interactionId);
    if (typeof nonce !== 'string' || !nonce.trim()) {
      throw new InteractionBrokerError(
        'INTERACTION_BROKER_CONFIG_INVALID',
        'Interaction Broker nonceFactory must return a non-empty string',
      );
    }
    if (this.#usedNonces.has(nonce)) {
      throw new InteractionBrokerError(
        'INTERACTION_NONCE_CONFLICT',
        `Nonce ${nonce} was already used by this Interaction Broker`,
      );
    }

    const claims: ApprovalCapabilityClaims = {
      schemaVersion: 1,
      audience: 'browser-product-gateway',
      keyEpoch: this.#keyEpoch,
      nonce,
      issuedAt: toIso(now),
      expiresAt: interaction.request.expiresAt,
      interactionId,
      commandId,
      defSessionId: interaction.request.defSessionId,
      defTurnId: interaction.request.defTurnId,
      toolCallId: interaction.request.toolCallId,
      proposalHash: interaction.request.proposalHash,
      binding: cloneBinding(interaction.request.binding),
      scope: [...interaction.request.scope],
    };
    interaction.capability = { claims, state: 'issued' };
    this.#usedNonces.add(nonce);
    return cloneClaims(claims);
  }

  validateApprovalCapability(
    claims: ApprovalCapabilityClaims,
    expected: ApprovalCapabilityExpectation = {},
  ): ApprovalCapabilityClaims {
    const now = this.#now();
    this.#expireDue(now);
    const located = this.#locateCapability(claims);
    this.#assertCapabilityState(located.capability);
    if (timestamp(located.capability.claims.expiresAt) <= now) {
      located.capability.state = 'invalidated';
      located.capability.invalidationReason = 'expired';
      throw new InteractionBrokerError(
        'INTERACTION_CAPABILITY_EXPIRED',
        `Approval capability for Interaction ${claims.interactionId} has expired`,
      );
    }
    if (located.interaction.status !== 'approved') {
      throw new InteractionBrokerError(
        'INTERACTION_CAPABILITY_INVALID',
        `Approval Interaction ${claims.interactionId} is not in the approved state`,
      );
    }
    this.#assertExpectedClaims(located.capability.claims, expected);
    return cloneClaims(located.capability.claims);
  }

  consumeApprovalCapability(
    claims: ApprovalCapabilityClaims,
    expected: ApprovalCapabilityExpectation = {},
  ): ApprovalCapabilityClaims {
    const validated = this.validateApprovalCapability(claims, expected);
    const located = this.#locateCapability(validated);
    located.capability.state = 'consumed';
    delete located.capability.invalidationReason;
    return cloneClaims(validated);
  }

  invalidateApprovalCapability(claims: ApprovalCapabilityClaims): void {
    this.#expireDue(this.#now());
    const located = this.#locateCapability(claims);
    if (located.capability.state !== 'issued') return;
    located.capability.state = 'invalidated';
    located.capability.invalidationReason = 'explicit';
  }

  #respondGenerated(
    interactionId: InteractionId,
    status: Exclude<InteractionStatus, 'pending'>,
    value?: JsonValue,
  ): InteractionSnapshot {
    const now = this.#now();
    const response: InteractionResponse = value === undefined
      ? { interactionId, status, resolvedAt: toIso(now) }
      : { interactionId, status, value, resolvedAt: toIso(now) };
    return this.respond(response);
  }

  #expireDue(now: number): void {
    for (const interaction of this.#interactions.values()) {
      if (interaction.status === 'pending' && timestamp(interaction.request.expiresAt) <= now) {
        this.#resolvePending(
          interaction,
          this.#generatedResponse(interaction.request.interactionId, 'expired', now),
        );
      }
      if (
        interaction.capability?.state === 'issued'
        && timestamp(interaction.capability.claims.expiresAt) <= now
      ) {
        interaction.capability.state = 'invalidated';
        interaction.capability.invalidationReason = 'expired';
      }
    }
  }

  #resolvePending(interaction: StoredInteraction, response: InteractionResponse): void {
    interaction.status = response.status;
    interaction.response = cloneResponse(response);
  }

  #assertResponse(response: InteractionResponse, kind: InteractionKind): void {
    if ((response.status as string) === 'pending') {
      throw new InteractionBrokerError(
        'INTERACTION_RESPONSE_INVALID',
        'Interaction responses cannot use the pending status',
      );
    }
    if (response.interactionId.trim() === '') {
      throw new InteractionBrokerError(
        'INTERACTION_RESPONSE_INVALID',
        'Interaction response must include an interactionId',
      );
    }
    if (!Number.isFinite(timestamp(response.resolvedAt))) {
      throw new InteractionBrokerError(
        'INTERACTION_RESPONSE_INVALID',
        'Interaction response resolvedAt must be a valid timestamp',
      );
    }
    const allowed = kind === 'question'
      ? response.status === 'answered'
        || response.status === 'cancelled'
        || response.status === 'expired'
        || response.status === 'stale'
      : response.status === 'approved'
        || response.status === 'rejected'
        || response.status === 'cancelled'
        || response.status === 'expired'
        || response.status === 'stale';
    if (!allowed) {
      throw new InteractionBrokerError(
        'INTERACTION_KIND_MISMATCH',
        `Interaction kind ${kind} cannot resolve as ${response.status}`,
      );
    }

    const hasValue = Object.prototype.hasOwnProperty.call(response, 'value');
    const value = response.value;
    if (hasValue && (value === undefined || !isJsonValue(value))) {
      throw new InteractionBrokerError(
        'INTERACTION_RESPONSE_INVALID',
        'Interaction response value must be a JSON value',
      );
    }
    if (response.status === 'answered' && !hasValue) {
      throw new InteractionBrokerError(
        'INTERACTION_RESPONSE_INVALID',
        'A question answer must include a value',
      );
    }
    if (
      (response.status === 'cancelled' || response.status === 'expired' || response.status === 'stale')
      && hasValue
    ) {
      throw new InteractionBrokerError(
        'INTERACTION_RESPONSE_INVALID',
        `${response.status} responses cannot include a value`,
      );
    }
  }

  #assertValidRequest(request: InteractionRequest): void {
    if (!request.interactionId.trim() || !request.defSessionId.trim() || !request.defTurnId.trim()) {
      throw new InteractionBrokerError(
        'INTERACTION_REQUEST_INVALID',
        'Interaction request must include non-empty interaction, session and turn IDs',
      );
    }
    if (!request.prompt.trim()) {
      throw new InteractionBrokerError(
        'INTERACTION_REQUEST_INVALID',
        'Interaction request prompt must be non-empty',
      );
    }
    const createdAt = timestamp(request.createdAt);
    const expiresAt = timestamp(request.expiresAt);
    if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= createdAt) {
      throw new InteractionBrokerError(
        'INTERACTION_REQUEST_INVALID',
        'Interaction request must have a valid expiresAt after createdAt',
      );
    }
    if (request.kind === 'question') {
      if (request.details !== undefined && !isJsonObject(request.details)) {
        throw new InteractionBrokerError(
          'INTERACTION_REQUEST_INVALID',
          'Question details must be a JSON object',
        );
      }
      return;
    }
    if (request.kind !== 'approval') {
      throw new InteractionBrokerError(
        'INTERACTION_REQUEST_INVALID',
        'Interaction request kind is invalid',
      );
    }
    if (!request.proposalHash.trim() || !isJsonValue(request.proposal)) {
      throw new InteractionBrokerError(
        'INTERACTION_REQUEST_INVALID',
        'Approval request must include a proposal hash and JSON proposal',
      );
    }
    if (
      !Array.isArray(request.scope)
      || request.scope.some((scope) => typeof scope !== 'string' || !scope.trim())
      || !isBinding(request.binding)
    ) {
      throw new InteractionBrokerError(
        'INTERACTION_REQUEST_INVALID',
        'Approval request must include a valid binding and scope',
      );
    }
  }

  #assertExpectedClaims(
    claims: ApprovalCapabilityClaims,
    expected: ApprovalCapabilityExpectation,
  ): void {
    if (expected.interactionId !== undefined && claims.interactionId !== expected.interactionId) {
      this.#throwBindingMismatch('interactionId');
    }
    if (expected.commandId !== undefined && claims.commandId !== expected.commandId) {
      this.#throwBindingMismatch('commandId');
    }
    if (expected.defSessionId !== undefined && claims.defSessionId !== expected.defSessionId) {
      this.#throwBindingMismatch('defSessionId');
    }
    if (expected.defTurnId !== undefined && claims.defTurnId !== expected.defTurnId) {
      this.#throwBindingMismatch('defTurnId');
    }
    if (expected.toolCallId !== undefined && claims.toolCallId !== expected.toolCallId) {
      this.#throwBindingMismatch('toolCallId');
    }
    if (expected.proposalHash !== undefined && claims.proposalHash !== expected.proposalHash) {
      this.#throwBindingMismatch('proposalHash');
    }
    if (expected.binding !== undefined && !sameBinding(claims.binding, expected.binding)) {
      this.#throwBindingMismatch('binding');
    }
    if (expected.scope !== undefined && !sameStringArray(claims.scope, expected.scope)) {
      this.#throwBindingMismatch('scope');
    }
  }

  #throwBindingMismatch(field: string): never {
    throw new InteractionBrokerError(
      'INTERACTION_CAPABILITY_BINDING_MISMATCH',
      `Approval capability ${field} binding does not match the expected value`,
    );
  }

  #assertCapabilityState(capability: StoredCapability): void {
    if (capability.state === 'consumed') {
      throw new InteractionBrokerError(
        'INTERACTION_CAPABILITY_CONSUMED',
        'Approval capability has already been consumed',
      );
    }
    if (capability.state === 'invalidated') {
      throw new InteractionBrokerError(
        capability.invalidationReason === 'expired'
          ? 'INTERACTION_CAPABILITY_EXPIRED'
          : 'INTERACTION_CAPABILITY_INVALIDATED',
        capability.invalidationReason === 'expired'
          ? 'Approval capability has expired'
          : 'Approval capability has been invalidated',
      );
    }
  }

  #locateCapability(claims: ApprovalCapabilityClaims): {
    readonly interaction: StoredInteraction;
    readonly capability: StoredCapability;
  } {
    if (!isApprovalCapabilityClaims(claims)) {
      throw new InteractionBrokerError(
        'INTERACTION_CAPABILITY_INVALID',
        'Approval capability claims are malformed',
      );
    }
    const interaction = this.#interactions.get(claims.interactionId);
    if (
      !interaction
      || interaction.request.kind !== 'approval'
      || !interaction.capability
      || stableSerialize(interaction.capability.claims) !== stableSerialize(claims)
    ) {
      throw new InteractionBrokerError(
        'INTERACTION_CAPABILITY_INVALID',
        'Approval capability claims are not issued by this Interaction Broker',
      );
    }
    return { interaction, capability: interaction.capability };
  }

  #requireStored(interactionId: InteractionId): StoredInteraction {
    const interaction = this.#interactions.get(interactionId);
    if (!interaction) {
      throw new InteractionBrokerError(
        'INTERACTION_NOT_FOUND',
        `Interaction ${interactionId} does not exist`,
      );
    }
    return interaction;
  }

  #snapshot(interaction: StoredInteraction): InteractionSnapshot {
    const capabilityState: ApprovalCapabilityState = interaction.request.kind === 'question'
      ? 'not-applicable'
      : interaction.capability?.state ?? 'not-issued';
    return {
      request: cloneRequest(interaction.request),
      status: interaction.status,
      response: interaction.response ? cloneResponse(interaction.response) : null,
      capabilityState,
    };
  }

  #generatedResponse(
    interactionId: InteractionId,
    status: Exclude<InteractionStatus, 'pending'>,
    now: number,
  ): InteractionResponse {
    return { interactionId, status, resolvedAt: toIso(now) };
  }

  #now(): number {
    const now = this.#clock();
    if (!Number.isFinite(now)) {
      throw new InteractionBrokerError(
        'INTERACTION_BROKER_CONFIG_INVALID',
        'Interaction Broker clock must return a finite number',
      );
    }
    return now;
  }
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function toIso(value: number): string {
  try {
    return new Date(value).toISOString();
  } catch {
    throw new InteractionBrokerError(
      'INTERACTION_BROKER_CONFIG_INVALID',
      'Interaction Broker clock returned a timestamp outside the supported Date range',
    );
  }
}

function equivalentResponse(left: InteractionResponse, right: InteractionResponse): boolean {
  const leftHasValue = Object.prototype.hasOwnProperty.call(left, 'value');
  const rightHasValue = Object.prototype.hasOwnProperty.call(right, 'value');
  if (left.status !== right.status || leftHasValue !== rightHasValue) return false;
  if (!leftHasValue) return true;
  return stableSerialize(left.value) === stableSerialize(right.value);
}

function cloneRequest(request: InteractionRequest): InteractionRequest {
  if (request.kind === 'question') {
    return {
      ...request,
      ...(request.details === undefined ? {} : { details: cloneJsonObject(request.details) }),
    };
  }
  return {
    ...request,
    binding: cloneBinding(request.binding),
    scope: [...request.scope],
    proposal: cloneJsonValue(request.proposal),
  };
}

function cloneResponse(response: InteractionResponse): InteractionResponse {
  return Object.prototype.hasOwnProperty.call(response, 'value')
    ? { ...response, value: cloneJsonValue(response.value as JsonValue) }
    : { ...response };
}

function cloneClaims(claims: ApprovalCapabilityClaims): ApprovalCapabilityClaims {
  return {
    ...claims,
    binding: cloneBinding(claims.binding),
    scope: [...claims.scope],
  };
}

function cloneBinding(binding: InteractionStateBinding): InteractionStateBinding {
  return { ...binding };
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((entry) => cloneJsonValue(entry));
  if (value !== null && typeof value === 'object') {
    const clone: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) clone[key] = cloneJsonValue(entry);
    return clone;
  }
  return value;
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return cloneJsonValue(value) as JsonObject;
}

function sameBinding(left: InteractionStateBinding, right: InteractionStateBinding): boolean {
  return left.workspaceId === right.workspaceId
    && left.databaseGeneration === right.databaseGeneration
    && left.timelineId === right.timelineId
    && left.checkoutTargetId === right.checkoutTargetId
    && left.checkoutUpdatedAt === right.checkoutUpdatedAt
    && left.contentRevision === right.contentRevision
    && left.snapshotDigest === right.snapshotDigest;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((entry) => isJsonValue(entry));
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry));
  return isJsonObject(value);
}

function isBinding(value: unknown): value is InteractionStateBinding {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const binding = value as Record<string, unknown>;
  return typeof binding.workspaceId === 'string'
    && binding.workspaceId.trim() !== ''
    && typeof binding.databaseGeneration === 'string'
    && binding.databaseGeneration.trim() !== ''
    && typeof binding.timelineId === 'string'
    && binding.timelineId.trim() !== ''
    && (binding.checkoutTargetId === null || typeof binding.checkoutTargetId === 'string')
    && typeof binding.checkoutUpdatedAt === 'number'
    && Number.isFinite(binding.checkoutUpdatedAt)
    && typeof binding.contentRevision === 'number'
    && Number.isSafeInteger(binding.contentRevision)
    && typeof binding.snapshotDigest === 'string'
    && binding.snapshotDigest.trim() !== '';
}

function isApprovalCapabilityClaims(value: unknown): value is ApprovalCapabilityClaims {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const claims = value as Record<string, unknown>;
  return claims.schemaVersion === 1
    && claims.audience === 'browser-product-gateway'
    && typeof claims.keyEpoch === 'string'
    && claims.keyEpoch.trim() !== ''
    && typeof claims.nonce === 'string'
    && claims.nonce.trim() !== ''
    && typeof claims.issuedAt === 'string'
    && Number.isFinite(timestamp(claims.issuedAt))
    && typeof claims.expiresAt === 'string'
    && Number.isFinite(timestamp(claims.expiresAt))
    && typeof claims.interactionId === 'string'
    && claims.interactionId.trim() !== ''
    && typeof claims.commandId === 'string'
    && claims.commandId.trim() !== ''
    && typeof claims.defSessionId === 'string'
    && claims.defSessionId.trim() !== ''
    && typeof claims.defTurnId === 'string'
    && claims.defTurnId.trim() !== ''
    && typeof claims.toolCallId === 'string'
    && claims.toolCallId.trim() !== ''
    && typeof claims.proposalHash === 'string'
    && claims.proposalHash.trim() !== ''
    && isBinding(claims.binding)
    && Array.isArray(claims.scope)
    && claims.scope.every((scope) => typeof scope === 'string' && scope.trim() !== '');
}

function stableSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : `number:${value}`;
  if (Array.isArray(value)) return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(object[key])}`)
      .join(',')}}`;
  }
  return `${typeof value}:${String(value)}`;
}
