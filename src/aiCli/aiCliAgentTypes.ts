export const AI_CLI_PROTOCOL_VERSION = 1 as const;

export type AiAgentClient = 'web-cli' | 'powershell' | 'codex' | 'claude' | 'rest' | 'mcp';

export type AiAgentWorkflow = 'buff.fill';

export interface AiCliCommandRequest {
  protocolVersion: typeof AI_CLI_PROTOCOL_VERSION;
  requestId?: string;
  client: AiAgentClient;
  command: string;
}

export type AiAgentProposalStatus = 'Wait' | 'Yes' | 'No';

export type AiAgentProposalDomain = 'buff' | 'operator' | 'weapon' | 'equipment';

export interface AiAgentProposal {
  id: string;
  domain: AiAgentProposalDomain;
  operation: string;
  payload: unknown;
  approvalStatus: AiAgentProposalStatus;
  saveStatus: AiAgentProposalStatus;
  client: AiAgentClient;
  sessionId?: string;
  summary?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AiCliCommandResponseProposal {
  id: string;
  domain: AiAgentProposalDomain;
  approval: AiAgentProposalStatus;
  save: AiAgentProposalStatus;
  nextAction?: string;
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
  proposal?: AiCliCommandResponseProposal;
}

export interface AiAgentSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  client: AiAgentClient;
  status: 'active' | 'archived';
  summary?: string;
  messages: AiAgentMessage[];
  context: {
    currentWorkflow?: AiAgentWorkflow;
    currentDraftId?: string;
    currentOperatorId?: string;
    lastCommand?: string;
    lastValidationOk?: boolean;
    pendingProposalId?: string;
  };
  state?: {
    proposalId?: string;
    approval?: AiAgentProposalStatus;
    save?: AiAgentProposalStatus;
    [key: string]: unknown;
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
  requestId?: string;
  sessionId?: string;
  client: AiAgentClient;
  permissionProfileId?: string;
  operationType?: 'command' | 'permission' | 'system' | 'write';
  command: string;
  ok: boolean;
  durationMs?: number;
  writes: boolean;
  storage: string[];
  proposalId?: string;
  approval?: AiAgentProposalStatus;
  save?: AiAgentProposalStatus;
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

export interface AiAgentPermissionError {
  code: 'unknown-command' | 'permission-denied' | 'dry-run-denied' | 'write-denied' | 'read-denied';
  message: string;
}

export interface AiCliExecutionContext {
  sourceText: string;
  sessionId?: string;
}
