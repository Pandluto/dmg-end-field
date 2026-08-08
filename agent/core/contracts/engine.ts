import type {
  ClientTurnId,
  DefSessionId,
  DefTurnId,
  EngineMessageId,
  EngineSessionId,
  EngineTurnId,
  InteractionId,
  ToolCallId,
} from './ids.ts';
import type { JsonObject, JsonValue } from './json.ts';

export type EngineHealth =
  | {
      status: 'ready';
      kind: string;
      runtimeVersion: string;
    }
  | {
      status: 'unavailable';
      kind: string;
      code: string;
      message: string;
    };

export interface EngineSessionRef {
  readonly kind: string;
  readonly sessionId: EngineSessionId;
  readonly runtimeVersion: string;
  readonly storeSchemaVersion: number;
}

export interface EngineTurnRef {
  readonly session: EngineSessionRef;
  readonly turnId: EngineTurnId;
}

export interface EngineSessionCreateInput {
  readonly defSessionId: DefSessionId;
  readonly providerProfileRef: string;
  readonly metadata?: JsonObject;
}

export type EngineRecoveryResult =
  | { status: 'recovered'; ref: EngineSessionRef }
  | { status: 'missing' }
  | { status: 'incompatible'; code: string; message: string };

export type EngineToolRisk = 'read' | 'propose' | 'mutate';

export interface EngineToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly risk: EngineToolRisk;
}

export interface EngineToolProjectionInput {
  readonly revision: number;
  readonly tools: readonly EngineToolDescriptor[];
}

/**
 * A browser-selected attachment that is intentionally forwarded to the
 * configured model provider. Host adapters must only accept bounded data URLs;
 * local file paths and remote URLs are never part of this contract.
 */
export interface EngineUserAttachment {
  readonly type: 'file';
  readonly mime: string;
  readonly filename: string;
  readonly url: string;
}

export interface EngineTurnInput {
  readonly engineSession: EngineSessionRef;
  readonly defSessionId: DefSessionId;
  readonly clientTurnId: ClientTurnId;
  readonly defTurnId: DefTurnId;
  /**
   * OpenCode's native UI publishes an optimistic user message before its
   * prompt request completes.  When present, the adapter must use that exact
   * native message id so the upstream UI can reconcile the optimistic row
   * with the Engine-owned transcript instead of rendering a duplicate.
   */
  readonly engineUserMessageId?: EngineMessageId;
  readonly systemContext: string;
  readonly userMessage: string;
  readonly userAttachments?: readonly EngineUserAttachment[];
  readonly providerProfileRef: string;
  readonly toolProjection: EngineToolProjectionInput;
  readonly context?: JsonObject;
}

interface EngineEventBase {
  readonly engineTurnId: EngineTurnId;
  readonly ordinal: number;
}

export type EngineEvent =
  | (EngineEventBase & {
      type: 'response.delta';
      messageId: EngineMessageId;
      delta: string;
    })
  | (EngineEventBase & {
      type: 'tool.requested';
      toolCallId: ToolCallId;
      name: string;
      input: JsonValue;
    })
  | (EngineEventBase & {
      type: 'interaction.requested';
      interactionId: InteractionId;
      interactionKind: 'question' | 'approval';
      prompt: string;
      payload?: JsonObject;
    })
  | (EngineEventBase & {
      type: 'tool-projection.applied';
      revision: number;
    })
  | (EngineEventBase & {
      type: 'turn.completed';
      output?: JsonValue;
    })
  | (EngineEventBase & {
      type: 'turn.failed';
      code: string;
      message: string;
    })
  | (EngineEventBase & {
      type: 'turn.aborted';
      reason: EngineAbortReason;
    });

export type EngineTerminalEvent = Extract<
  EngineEvent,
  { type: 'turn.completed' | 'turn.failed' | 'turn.aborted' }
>;

export function isEngineTerminalEvent(event: EngineEvent): event is EngineTerminalEvent {
  return event.type === 'turn.completed' || event.type === 'turn.failed' || event.type === 'turn.aborted';
}

export type EngineToolResultInput =
  | {
      readonly toolCallId: ToolCallId;
      readonly status: 'succeeded';
      readonly result: JsonValue;
    }
  | {
      readonly toolCallId: ToolCallId;
      readonly status: 'failed';
      readonly code: string;
      readonly message: string;
      readonly details?: JsonValue;
    };

export type EngineInteractionResolution =
  | 'answered'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'stale';

export type EngineInteractionResultInput =
  | {
      readonly interactionId: InteractionId;
      readonly interactionKind: 'question';
      readonly resolution: 'answered';
      readonly value: JsonValue;
    }
  | {
      readonly interactionId: InteractionId;
      readonly interactionKind: 'question';
      readonly resolution: 'expired' | 'cancelled' | 'stale';
      readonly value?: never;
    }
  | {
      readonly interactionId: InteractionId;
      readonly interactionKind: 'approval';
      readonly resolution: 'approved' | 'rejected';
      readonly value?: JsonValue;
    }
  | {
      readonly interactionId: InteractionId;
      readonly interactionKind: 'approval';
      readonly resolution: 'expired' | 'cancelled' | 'stale';
      readonly value?: never;
    };

export interface EngineAbortReason {
  readonly code: string;
  readonly message?: string;
}

export interface EngineSteeringInput {
  readonly clientTurnId: ClientTurnId;
  readonly userMessage: string;
}

export interface AbortResult {
  readonly status: 'aborted' | 'already-terminal';
  readonly terminalType: EngineTerminalEvent['type'];
}

export interface CompactionResult {
  readonly status: 'compacted' | 'not-needed';
  readonly summaryRef?: string;
}

export interface EngineTurnHandle {
  readonly ref: EngineTurnRef;
  readonly events: AsyncIterable<EngineEvent>;
  submitToolResult(input: EngineToolResultInput): Promise<void>;
  /**
   * Atomically accepts a Tool result and the projection for the next Harness
   * phase before the Engine may resume inference or emit a terminal event.
   */
  submitToolResultAndUpdateProjection(
    input: EngineToolResultInput,
    projection: EngineToolProjectionInput,
  ): Promise<void>;
  submitInteractionResult(input: EngineInteractionResultInput): Promise<void>;
  updateToolProjection(input: EngineToolProjectionInput): Promise<void>;
  /** Pi Agent-style mid-run guidance; unsupported Engines may omit it. */
  steer?(input: EngineSteeringInput): Promise<void>;
  abort(reason: EngineAbortReason): Promise<AbortResult>;
}

export interface AgentEngine {
  readonly kind: string;
  probe(): Promise<EngineHealth>;
  createSession(input: EngineSessionCreateInput): Promise<EngineSessionRef>;
  recoverSession(ref: EngineSessionRef): Promise<EngineRecoveryResult>;
  startTurn(input: EngineTurnInput): Promise<EngineTurnHandle>;
  compact?(ref: EngineSessionRef): Promise<CompactionResult>;
  disposeSession(ref: EngineSessionRef): Promise<void>;
  shutdown(): Promise<void>;
}

export type AgentEngineProtocolErrorCode =
  | 'ENGINE_SHUTDOWN'
  | 'ENGINE_SESSION_NOT_FOUND'
  | 'ENGINE_SESSION_INCOMPATIBLE'
  | 'ENGINE_TURN_TERMINAL'
  | 'ENGINE_INPUT_UNEXPECTED'
  | 'ENGINE_CORRELATION_CONFLICT'
  | 'ENGINE_PROJECTION_STALE'
  | 'ENGINE_INTERACTION_KIND_MISMATCH'
  | 'ENGINE_INTERACTION_RESOLUTION_INVALID';

export class AgentEngineProtocolError extends Error {
  readonly code: AgentEngineProtocolErrorCode;

  constructor(code: AgentEngineProtocolErrorCode, message: string) {
    super(message);
    this.name = 'AgentEngineProtocolError';
    this.code = code;
  }
}
