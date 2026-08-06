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
    });

export interface InteractionResponse {
  readonly interactionId: InteractionId;
  readonly status: Exclude<InteractionStatus, 'pending'>;
  readonly value?: JsonValue;
  readonly resolvedAt: string;
}

export interface ApprovalCapabilityClaims {
  readonly schemaVersion: 1;
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
