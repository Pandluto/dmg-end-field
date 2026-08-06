export type OpenCodeEngineErrorCode =
  | 'OPENCODE_RUNTIME_MISSING'
  | 'OPENCODE_RUNTIME_INVALID'
  | 'OPENCODE_RUNTIME_UNSUPPORTED'
  | 'OPENCODE_PROFILE_MISSING'
  | 'OPENCODE_PROFILE_INVALID'
  | 'OPENCODE_PROFILE_CONFLICT'
  | 'OPENCODE_PROCESS_START_FAILED'
  | 'OPENCODE_PROCESS_STOP_FAILED'
  | 'OPENCODE_PROCESS_EXITED'
  | 'OPENCODE_SESSION_RECOVERY_FAILED'
  | 'OPENCODE_HTTP_FAILED'
  | 'OPENCODE_RESPONSE_INVALID'
  | 'OPENCODE_BRIDGE_UNAUTHORIZED'
  | 'OPENCODE_BRIDGE_INVALID'
  | 'OPENCODE_BRIDGE_CORRELATION_FAILED'
  | 'OPENCODE_TOOL_UNSUPPORTED';

export class OpenCodeEngineError extends Error {
  readonly code: OpenCodeEngineErrorCode;

  constructor(code: OpenCodeEngineErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OpenCodeEngineError';
    this.code = code;
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
