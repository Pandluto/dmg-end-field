import type { EngineToolDescriptor } from './engine.ts';
import type { DefSessionId, DefTurnId, ToolCallId } from './ids.ts';
import type { JsonValue } from './json.ts';
import type { ProductBinding, ProductSnapshotEnvelope } from './product.ts';

export interface DefToolDescriptor extends EngineToolDescriptor {
  readonly risk: 'read';
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

export type DefToolErrorCode =
  | 'DEF_TOOL_UNSUPPORTED'
  | 'DEF_TOOL_INPUT_INVALID'
  | 'DEF_TOOL_PRODUCT_SNAPSHOT_INVALID'
  | 'DEF_DAMAGE_REPORT_UNAVAILABLE'
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
