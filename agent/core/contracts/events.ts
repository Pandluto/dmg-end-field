import type {
  ClientTurnId,
  CommandId,
  DatabaseGeneration,
  DefSessionId,
  DefTurnId,
  EngineMessageId,
  EngineSessionId,
  EngineTurnId,
  InteractionId,
  TimelineId,
  ToolCallId,
  WorkspaceId,
} from './ids.ts';
import type { InteractionKind, InteractionStatus } from './interaction.ts';
import type { JsonValue } from './json.ts';
import type { ProductCommandResultStatus } from './product.ts';
import type {
  DefHarnessBusinessId,
  DefHarnessOperationId,
  DefHarnessPhaseKind,
  DefHarnessPlanTraceEvent,
  DefHarnessTerminalState,
} from './harness.ts';

type EmptyEventPayload = Record<string, never>;
type NoEventCorrelation = Record<never, never>;

interface DefCommandBindingPayload {
  readonly workspaceId: WorkspaceId;
  readonly databaseGeneration: DatabaseGeneration;
  readonly timelineId: TimelineId;
  readonly checkoutTargetId: string | null;
  readonly beforeRevision: number;
}

interface DefCommandSettledPayload extends DefCommandBindingPayload {
  readonly status: ProductCommandResultStatus;
  readonly afterRevision: number | null;
  readonly browserReceiptDigest: string | null;
  readonly code?: string;
  readonly message?: string;
}

export interface DefEventPayloadMap {
  'session.ready': {
    readonly engineKind: string;
    readonly engineRuntimeVersion: string;
  };
  'session.recovered': {
    readonly engineKind: string;
    readonly engineRuntimeVersion: string;
  };
  'session.archived': { readonly reason: string };
  'session.orphaned': { readonly code: string; readonly message: string };
  'turn.accepted': {
    readonly clientTurnId: ClientTurnId;
    readonly userMessage: string;
  };
  'response.first-token': EmptyEventPayload;
  'response.delta': { readonly delta: string };
  'tool.requested': {
    readonly name: string;
    readonly risk: 'read' | 'propose' | 'mutate';
    readonly input: JsonValue;
  };
  'tool.started': { readonly name: string };
  'tool.result': { readonly result: JsonValue };
  'tool.error': {
    readonly code: string;
    readonly message: string;
    readonly details?: JsonValue;
  };
  'harness.routed': {
    readonly businessId: DefHarnessBusinessId;
    readonly operation: DefHarnessOperationId;
    readonly revision: string;
    readonly sourceLineage: string;
    readonly contentHash: string;
    readonly planEvents?: readonly DefHarnessPlanTraceEvent[];
  };
  'harness.resumed': {
    readonly sourceTransactionId: string;
    readonly sourceDefTurnId: DefTurnId;
  };
  'harness.phase.entered': {
    readonly businessId: DefHarnessBusinessId | null;
    readonly operation: DefHarnessOperationId | null;
    readonly phaseId: string;
    readonly phaseKind: DefHarnessPhaseKind;
  };
  'harness.tool.projected': {
    readonly projectionRevision: number;
    readonly tools: readonly string[];
  };
  'harness.terminal': {
    readonly businessId: DefHarnessBusinessId | null;
    readonly operation: DefHarnessOperationId | null;
    readonly phaseId: string;
    readonly terminalState: DefHarnessTerminalState;
    readonly code?: string;
    readonly planEvents?: readonly DefHarnessPlanTraceEvent[];
  };
  'interaction.requested': {
    readonly kind: InteractionKind;
    readonly prompt: string;
    readonly expiresAt: string;
  };
  'interaction.resolved': {
    readonly status: Exclude<InteractionStatus, 'pending'>;
    readonly value?: JsonValue;
  };
  'command.queued': DefCommandBindingPayload & {
    readonly op: string;
    readonly afterRevision: null;
    readonly browserReceiptDigest: null;
  };
  'command.dispatched': DefCommandBindingPayload & {
    readonly op: string;
    readonly afterRevision: null;
    readonly browserReceiptDigest: null;
  };
  'command.claimed': DefCommandBindingPayload & {
    readonly executorLeaseId: string;
    readonly afterRevision: null;
    readonly browserReceiptDigest: string;
  };
  'command.committed': DefCommandBindingPayload & {
    readonly afterRevision: number;
    readonly browserReceiptDigest: string;
  };
  'command.result': DefCommandSettledPayload;
  'command.reconciled': DefCommandSettledPayload;
  'command.orphaned': DefCommandBindingPayload & {
    readonly code: string;
    readonly message: string;
    readonly afterRevision: null;
    readonly browserReceiptDigest: string | null;
  };
  'turn.completed': { readonly output?: JsonValue };
  'turn.stopped': { readonly code: string; readonly message?: string };
  'turn.interrupted': {
    readonly code: string;
    readonly message: string;
    readonly reconcileRequiredCommandIds: readonly CommandId[];
  };
  'turn.failed': { readonly code: string; readonly message: string };
}

export type DefEventType = keyof DefEventPayloadMap;

interface DefEventBase {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly defSessionId: DefSessionId;
  readonly diagnostics?: {
    readonly engineKind?: string;
    readonly engineSessionId?: EngineSessionId;
    readonly engineTurnId?: EngineTurnId;
    readonly engineMessageId?: EngineMessageId;
  };
}

interface DefTurnCorrelation {
  readonly defTurnId: DefTurnId;
}

interface DefToolCorrelation extends DefTurnCorrelation {
  readonly toolCallId: ToolCallId;
}

interface DefInteractionCorrelation extends DefTurnCorrelation {
  readonly interactionId: InteractionId;
  readonly toolCallId?: ToolCallId;
}

interface DefCommandCorrelation extends DefToolCorrelation {
  readonly interactionId?: InteractionId;
  readonly commandId: CommandId;
}

export interface DefEventCorrelationMap {
  'session.ready': NoEventCorrelation;
  'session.recovered': NoEventCorrelation;
  'session.archived': NoEventCorrelation;
  'session.orphaned': NoEventCorrelation;
  'turn.accepted': DefTurnCorrelation;
  'response.first-token': DefTurnCorrelation;
  'response.delta': DefTurnCorrelation;
  'tool.requested': DefToolCorrelation;
  'tool.started': DefToolCorrelation;
  'tool.result': DefToolCorrelation;
  'tool.error': DefToolCorrelation;
  'harness.routed': DefTurnCorrelation;
  'harness.resumed': DefTurnCorrelation;
  'harness.phase.entered': DefTurnCorrelation;
  'harness.tool.projected': DefTurnCorrelation;
  'harness.terminal': DefTurnCorrelation;
  'interaction.requested': DefInteractionCorrelation;
  'interaction.resolved': DefInteractionCorrelation;
  'command.queued': DefCommandCorrelation;
  'command.dispatched': DefCommandCorrelation;
  'command.claimed': DefCommandCorrelation;
  'command.committed': DefCommandCorrelation;
  'command.result': DefCommandCorrelation;
  'command.reconciled': DefCommandCorrelation;
  'command.orphaned': DefCommandCorrelation;
  'turn.completed': DefTurnCorrelation;
  'turn.stopped': DefTurnCorrelation;
  'turn.interrupted': DefTurnCorrelation;
  'turn.failed': DefTurnCorrelation;
}

export type DefEventEnvelope<Type extends DefEventType = DefEventType> =
  Type extends DefEventType
    ? DefEventBase
      & DefEventCorrelationMap[Type]
      & {
        readonly type: Type;
        readonly payload: DefEventPayloadMap[Type];
      }
    : never;

export type DefEvent = DefEventEnvelope;
