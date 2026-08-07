export type DefAgentHostErrorCode =
  | 'AGENT_LAUNCH_GRANT_INVALID'
  | 'AGENT_UI_CAPABILITY_INVALID'
  | 'AGENT_ORIGIN_DENIED'
  | 'AGENT_CONSUMER_REQUIRED'
  | 'AGENT_CONSUMER_CONFLICT'
  | 'AGENT_CONSUMER_STALE'
  | 'AGENT_BINDING_CONFLICT'
  | 'AGENT_COMMAND_CONFLICT'
  | 'AGENT_COMMAND_CAPACITY_REACHED'
  | 'AGENT_COMMAND_NOT_FOUND'
  | 'AGENT_COMMAND_TIMEOUT'
  | 'AGENT_SESSION_NOT_FOUND'
  | 'AGENT_SESSION_LIMIT_REACHED'
  | 'AGENT_SESSION_TURN_LIMIT_REACHED'
  | 'AGENT_CLIENT_TURN_CONFLICT'
  | 'AGENT_EVENT_CAPACITY_REACHED'
  | 'AGENT_EVENT_CURSOR_INVALID'
  | 'AGENT_EVENT_LIMIT_INVALID'
  | 'AGENT_TURN_BUSY'
  | 'AGENT_TURN_OUTPUT_LIMIT'
  | 'AGENT_TURN_START_CANCELLED'
  | 'AGENT_TURN_NOT_FOUND'
  | 'AGENT_TOOL_UNSUPPORTED';

export class DefAgentHostError extends Error {
  readonly code: DefAgentHostErrorCode;
  readonly statusCode: number;

  constructor(code: DefAgentHostErrorCode, message: string, statusCode = 409) {
    super(message);
    this.name = 'DefAgentHostError';
    this.code = code;
    this.statusCode = statusCode;
  }
}
