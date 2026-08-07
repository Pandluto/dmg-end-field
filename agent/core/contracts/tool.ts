import type { EngineToolDescriptor, EngineToolRisk } from './engine.ts';
import type { DefSessionId, DefTurnId, ToolCallId } from './ids.ts';
import type { JsonObject, JsonValue } from './json.ts';
import type { ProductBinding, ProductSnapshotEnvelope } from './product.ts';

export interface DefToolDescriptor extends EngineToolDescriptor {
  readonly risk: EngineToolRisk;
}

export interface DefProductSnapshotReader {
  getSnapshot(binding: ProductBinding): Promise<ProductSnapshotEnvelope>;
}

export interface DefToolExecutionContext {
  readonly defSessionId: DefSessionId;
  readonly defTurnId: DefTurnId;
  readonly toolCallId: ToolCallId;
  readonly binding: ProductBinding;
  readonly product: DefProductSnapshotReader;
  readonly abortSignal: AbortSignal;
}

export interface DefToolHandler {
  readonly descriptor: DefToolDescriptor;
  execute(input: JsonValue, context: DefToolExecutionContext): Promise<JsonValue>;
}

export type DefInteractiveToolPlan =
  | {
      readonly kind: 'question';
      readonly prompt: string;
      readonly details?: JsonObject;
    }
  | {
      readonly kind: 'command';
      readonly command: JsonObject;
      readonly visiblePostcondition?: JsonObject;
    }
  | {
      readonly kind: 'mutation';
      readonly prompt: string;
      readonly proposal: JsonValue;
      readonly scope: readonly string[];
      readonly command: JsonObject;
      readonly followUp?: 'checkout-prepared-work-node';
      readonly visiblePostcondition?: JsonObject;
    };

export interface DefInteractiveToolHandler {
  readonly descriptor: DefToolDescriptor;
  prepare(input: JsonValue, context: DefToolExecutionContext): Promise<DefInteractiveToolPlan>;
}

export interface DefWorkbenchToolRegistry {
  listDescriptors(): readonly DefToolDescriptor[];
  resolveDescriptor(name: string): DefToolDescriptor | null;
  executeRead(name: string, input: JsonValue, context: DefToolExecutionContext): Promise<JsonValue>;
  prepareInteractive(
    name: string,
    input: JsonValue,
    context: DefToolExecutionContext,
  ): Promise<DefInteractiveToolPlan>;
}

export type DefToolErrorCode =
  | 'DEF_TOOL_UNSUPPORTED'
  | 'DEF_TOOL_INPUT_INVALID'
  | 'DEF_TOOL_PRODUCT_SNAPSHOT_INVALID'
  | 'DEF_DAMAGE_REPORT_UNAVAILABLE'
  | 'DEF_INTERACTION_REJECTED'
  | 'DEF_INTERACTION_CANCELLED'
  | 'DEF_INTERACTION_EXPIRED'
  | 'DEF_INTERACTION_STALE'
  | 'DEF_PRODUCT_COMMAND_FAILED'
  | 'DEF_TOOL_ABORTED';

export class DefToolExecutionError extends Error {
  readonly code: DefToolErrorCode;
  readonly details?: JsonValue;

  constructor(
    code: DefToolErrorCode,
    message: string,
    details?: JsonValue,
  ) {
    super(message);
    this.name = 'DefToolExecutionError';
    this.code = code;
    this.details = details;
  }
}
