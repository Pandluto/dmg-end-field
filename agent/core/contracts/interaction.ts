import type {
  CommandId,
  DatabaseGeneration,
  DefSessionId,
  DefTurnId,
  InteractionId,
  TimelineId,
  ToolCallId,
  WorkspaceId,
} from './ids.ts';
import type { JsonObject, JsonValue } from './json.ts';
import {
  isPreparedWorkNodeCandidateRef,
  isPreparedWorkNodeReview,
  type DefPreparedWorkNodeCandidateRefV1,
  type DefPreparedWorkNodeReviewV1,
} from './prepared-work-node.ts';

export type InteractionKind = 'question' | 'approval';
export type InteractionStatus =
  | 'pending'
  | 'answered'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'stale';

export interface InteractionStateBinding {
  readonly workspaceId: WorkspaceId;
  readonly databaseGeneration: DatabaseGeneration;
  readonly timelineId: TimelineId;
  readonly checkoutTargetId: string | null;
  readonly checkoutUpdatedAt: number;
  readonly contentRevision: number;
  readonly snapshotDigest: string;
}

interface InteractionRequestBase {
  readonly interactionId: InteractionId;
  readonly defSessionId: DefSessionId;
  readonly defTurnId: DefTurnId;
  readonly toolCallId?: ToolCallId;
  readonly prompt: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export type InteractionRequest =
  | (InteractionRequestBase & {
      readonly kind: 'question';
      readonly details?: JsonObject;
    })
  | (InteractionRequestBase & {
      readonly kind: 'approval';
      readonly proposalHash: string;
      readonly binding: InteractionStateBinding;
      readonly scope: readonly string[];
      readonly proposal: JsonValue;
      /** Compact, signed candidate identity; full review remains on the interaction. */
      readonly candidate?: DefPreparedWorkNodeCandidateRefV1;
      readonly candidateReview?: DefPreparedWorkNodeReviewV1;
    });

export interface InteractionResponse {
  readonly interactionId: InteractionId;
  readonly status: Exclude<InteractionStatus, 'pending'>;
  readonly value?: JsonValue;
  readonly resolvedAt: string;
}

interface ApprovalCapabilityClaimsBase {
  readonly audience: 'browser-product-gateway';
  readonly keyEpoch: string;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly interactionId: InteractionId;
  readonly commandId: CommandId;
  readonly defSessionId: DefSessionId;
  readonly defTurnId: DefTurnId;
  readonly toolCallId: ToolCallId;
  readonly proposalHash: string;
  readonly binding: InteractionStateBinding;
  readonly scope: readonly string[];
}

export interface ApprovalCapabilityClaimsV1 extends ApprovalCapabilityClaimsBase {
  readonly schemaVersion: 1;
}

export interface ApprovalCapabilityClaimsV2 extends ApprovalCapabilityClaimsBase {
  readonly schemaVersion: 2;
  readonly candidate: DefPreparedWorkNodeCandidateRefV1;
}

export type ApprovalCapabilityClaims = ApprovalCapabilityClaimsV1 | ApprovalCapabilityClaimsV2;

export function isApprovalCapabilityClaimsShape(value: unknown): value is ApprovalCapabilityClaims {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const claims = value as Record<string, unknown>;
  const common = [
    'audience', 'keyEpoch', 'nonce', 'issuedAt', 'expiresAt', 'interactionId',
    'commandId', 'defSessionId', 'defTurnId', 'toolCallId', 'proposalHash', 'binding', 'scope',
  ];
  const version = claims.schemaVersion;
  const allowed = version === 1 ? ['schemaVersion', ...common] : ['schemaVersion', ...common, 'candidate'];
  if (Object.keys(claims).length !== allowed.length || !allowed.every((key) => Object.prototype.hasOwnProperty.call(claims, key))) {
    return false;
  }
  if (
    (version !== 1 && version !== 2)
    || claims.audience !== 'browser-product-gateway'
    || common.some((key) => typeof claims[key] !== 'string' && !['binding', 'scope'].includes(key))
    || common.filter((key) => !['binding', 'scope'].includes(key)).some((key) => !boundedClaimString(claims[key]))
    || !isTimestampString(claims.issuedAt)
    || !isTimestampString(claims.expiresAt)
    || !isInteractionBindingShape(claims.binding)
    || !Array.isArray(claims.scope)
    || claims.scope.length === 0
    || claims.scope.length > 64
    || claims.scope.some((entry) => !boundedClaimString(entry))
  ) return false;
  return version === 1 || isPreparedWorkNodeCandidateRef(claims.candidate);
}

function isInteractionBindingShape(value: unknown): value is InteractionStateBinding {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const binding = value as Record<string, unknown>;
  return Object.keys(binding).length === 7
    && boundedClaimString(binding.workspaceId)
    && boundedClaimString(binding.databaseGeneration)
    && boundedClaimString(binding.timelineId)
    && (binding.checkoutTargetId === null || boundedClaimString(binding.checkoutTargetId))
    && typeof binding.checkoutUpdatedAt === 'number' && Number.isFinite(binding.checkoutUpdatedAt)
    && typeof binding.contentRevision === 'number' && Number.isSafeInteger(binding.contentRevision)
    && boundedClaimString(binding.snapshotDigest);
}

function boundedClaimString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && Boolean(value.trim());
}

function isTimestampString(value: unknown): value is string {
  return boundedClaimString(value) && Number.isFinite(Date.parse(value));
}

export function isPreparedApprovalCapabilityClaims(
  value: unknown,
): value is ApprovalCapabilityClaimsV2 {
  return isApprovalCapabilityClaimsShape(value) && value.schemaVersion === 2;
}

export function interactionRequestCandidateIsValid(
  request: Extract<InteractionRequest, { kind: 'approval' }>,
): boolean {
  if (request.candidateReview !== undefined && request.candidate === undefined) return false;
  return (request.candidate === undefined || isPreparedWorkNodeCandidateRef(request.candidate))
    && (request.candidateReview === undefined || (
      isPreparedWorkNodeReview(request.candidateReview)
      && request.candidate !== undefined
      && request.candidateReview.manifest.proposalId === request.candidate.proposalId
      && request.candidateReview.manifest.nodeId === request.candidate.nodeId
      && request.candidateReview.manifest.nodeRevision === request.candidate.nodeRevision
      && request.candidateReview.manifest.diffDigest === request.candidate.diffDigest
      && request.candidateReview.manifest.proposalDigest === request.candidate.proposalDigest
      && request.candidateReview.manifest.scope.length === request.candidate.scope.length
      && request.candidateReview.manifest.scope.every((scope, index) => scope === request.candidate!.scope[index])
    ));
}
