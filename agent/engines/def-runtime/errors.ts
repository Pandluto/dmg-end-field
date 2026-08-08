export type DefRuntimeEngineErrorCode =
  | 'DEF_RUNTIME_SHUTDOWN'
  | 'DEF_RUNTIME_PROFILE_NOT_FOUND'
  | 'DEF_RUNTIME_SESSION_NOT_FOUND'
  | 'DEF_RUNTIME_SESSION_INCOMPATIBLE'
  | 'DEF_RUNTIME_TURN_INACTIVE'
  | 'DEF_RUNTIME_INTERACTION_UNSUPPORTED'
  | 'DEF_RUNTIME_PROJECTION_UNSUPPORTED';

export class DefRuntimeEngineError extends Error {
  readonly code: DefRuntimeEngineErrorCode;

  constructor(code: DefRuntimeEngineErrorCode, message: string) {
    super(message);
    this.name = 'DefRuntimeEngineError';
    this.code = code;
  }
}
