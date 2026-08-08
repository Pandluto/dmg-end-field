/**
 * DEF-owned Host tool port, adapted from pi-mono AgentTool behavior and the
 * existing DEF EngineTurnHandle projection contract.
 */
import type { DefTurnId, ToolCallId } from '../../core/contracts/ids.ts';
import type { JsonObject, JsonValue } from '../../core/contracts/json.ts';
import type {
  RuntimeToolCallBlock,
  RuntimeToolResultPayload,
} from './messages.ts';
import type { RuntimeRunId, RuntimeSessionId, RuntimeTurnId } from './ids.ts';

export type RuntimeToolRisk = 'read' | 'propose' | 'mutate';

export interface RuntimeToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly risk: RuntimeToolRisk;
}

export interface RuntimeToolProjection {
  readonly revision: number;
  readonly tools: readonly RuntimeToolDescriptor[];
}

export interface RuntimeToolInvocation {
  readonly sessionId: RuntimeSessionId;
  readonly defTurnId: DefTurnId;
  readonly runId: RuntimeRunId;
  readonly turnId: RuntimeTurnId;
  readonly call: RuntimeToolCallBlock;
  readonly projectionRevision: number;
}

export interface RuntimeToolUpdate {
  readonly toolCallId: ToolCallId;
  readonly detail: JsonValue;
}

export interface RuntimeToolSettlement {
  readonly toolCallId: ToolCallId;
  readonly result: RuntimeToolResultPayload;
  /**
   * The Host accepts the result and this next projection in one critical
   * section before resolving invoke(). The Agent loop must not begin another
   * provider turn before receiving both values together.
   */
  readonly nextProjection: RuntimeToolProjection;
}

export type RuntimeToolUpdateListener = (
  update: RuntimeToolUpdate,
) => void | Promise<void>;

export interface RuntimeToolBridge {
  /**
   * Normal tool failures resolve with RuntimeToolSettlement.result.status=failed.
   * Rejection is reserved for cancellation, shutdown, or a bridge protocol
   * violation that cannot safely be represented as a model-visible result.
   */
  invoke(
    input: RuntimeToolInvocation,
    signal: AbortSignal,
    onUpdate: RuntimeToolUpdateListener,
  ): Promise<RuntimeToolSettlement>;
}
