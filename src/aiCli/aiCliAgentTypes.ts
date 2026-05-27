export const AI_CLI_PROTOCOL_VERSION = 1 as const;

export type AiAgentClient = 'web-cli' | 'powershell' | 'codex' | 'claude' | 'rest' | 'mcp';

export type AiAgentWorkflow = 'buff.fill';

export interface AiCliCommandRequest {
  protocolVersion: typeof AI_CLI_PROTOCOL_VERSION;
  requestId?: string;
  client: AiAgentClient;
  command: string;
}

export interface AiCliCommandResponse {
  ok: boolean;
  protocolVersion: typeof AI_CLI_PROTOCOL_VERSION;
  requestId?: string;
  lines: string[];
  data?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  effects: {
    writes: boolean;
    storage: string[];
  };
  copyText?: string;
}

export interface AiAgentSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  client: AiAgentClient;
  status: 'active' | 'archived';
  messages: AiAgentMessage[];
  context: {
    currentWorkflow?: AiAgentWorkflow;
    currentDraftId?: string;
    currentOperatorId?: string;
    lastCommand?: string;
    lastValidationOk?: boolean;
  };
}

export interface AiAgentMessage {
  id: string;
  createdAt: number;
  role: 'user' | 'agent' | 'app' | 'tool';
  text: string;
  data?: unknown;
}

export interface AiAgentOperationLog {
  id: string;
  createdAt: number;
  sessionId?: string;
  client: AiAgentClient;
  command: string;
  ok: boolean;
  durationMs?: number;
  writes: boolean;
  storage: string[];
  errorCode?: string;
  errorMessage?: string;
}

export interface AiAgentPermissionProfile {
  id: 'readonly-agent' | 'confirmed-writer' | 'trusted-local-dev' | string;
  name: string;
  client: AiAgentClient;
  allowedCommands: string[];
  allowedWorkflows: AiAgentWorkflow[];
  canRead: boolean;
  canDryRun: boolean;
  canWrite: boolean;
  requiresUserConfirmForWrite: boolean;
}

export interface AiCliExecutionContext {
  sourceText: string;
  sessionId?: string;
}
