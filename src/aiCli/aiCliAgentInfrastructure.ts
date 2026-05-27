import {
  type AiAgentClient,
  type AiAgentMessage,
  type AiAgentOperationLog,
  type AiAgentPermissionProfile,
  type AiAgentSession,
} from './aiCliAgentTypes';

const AI_AGENT_SESSIONS_STORAGE_KEY = 'def.ai-agent.sessions.v1';
const AI_AGENT_ACTIVE_SESSION_ID_STORAGE_KEY = 'def.ai-agent.active-session-id.v1';
const AI_AGENT_OPERATION_LOGS_STORAGE_KEY = 'def.ai-agent.operation-logs.v1';
const AI_AGENT_PERMISSION_PROFILES_STORAGE_KEY = 'def.ai-agent.permission-profiles.v1';
const AI_AGENT_LOG_LIMIT = 200;

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readJsonStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key: string, value: unknown) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function createDefaultPermissionProfiles(): AiAgentPermissionProfile[] {
  return [
    {
      id: 'readonly-agent',
      name: 'Readonly Agent',
      client: 'rest',
      allowedCommands: ['help', '/help', 'purpose', '/purpose', 'spec', '/spec', 'draft.show', 'item.list', 'effect.list', 'fill.task', 'fill.task.copy', 'fill.check'],
      allowedWorkflows: ['buff.fill'],
      canRead: true,
      canDryRun: true,
      canWrite: false,
      requiresUserConfirmForWrite: true,
    },
    {
      id: 'confirmed-writer',
      name: 'Confirmed Writer',
      client: 'web-cli',
      allowedCommands: ['*'],
      allowedWorkflows: ['buff.fill'],
      canRead: true,
      canDryRun: true,
      canWrite: true,
      requiresUserConfirmForWrite: true,
    },
    {
      id: 'trusted-local-dev',
      name: 'Trusted Local Dev',
      client: 'web-cli',
      allowedCommands: ['*'],
      allowedWorkflows: ['buff.fill'],
      canRead: true,
      canDryRun: true,
      canWrite: true,
      requiresUserConfirmForWrite: false,
    },
  ];
}

export function readPermissionProfiles() {
  const profiles = readJsonStorage<AiAgentPermissionProfile[]>(AI_AGENT_PERMISSION_PROFILES_STORAGE_KEY, []);
  return profiles.length ? profiles : createDefaultPermissionProfiles();
}

export function findPermissionProfile(client: AiAgentClient) {
  const profiles = readPermissionProfiles();
  return profiles.find((profile) => profile.client === client) || profiles[0] || createDefaultPermissionProfiles()[0];
}

export function commandNeedsWrite(commandName: string) {
  return [
    'operator.add',
    'operator.delete',
    'draft.rename',
    'item.add',
    'item.set',
    'item.delete',
    'effect.add',
    'effect.set',
    'effect.delete',
    'fill.apply',
  ].includes(commandName);
}

export function commandNeedsDryRun(commandName: string) {
  return commandName === 'fill.check';
}

export function canRunCommand(profile: AiAgentPermissionProfile, commandName: string) {
  if (profile.allowedCommands.includes('*')) {
    return true;
  }
  return profile.allowedCommands.includes(commandName);
}

export function assertPermission(profile: AiAgentPermissionProfile, commandName: string) {
  if (!canRunCommand(profile, commandName)) {
    return `command not allowed for ${profile.id}: ${commandName}`;
  }
  if (commandNeedsDryRun(commandName) && !profile.canDryRun) {
    return `dry-run not allowed for ${profile.id}`;
  }
  if (commandNeedsWrite(commandName) && !profile.canWrite) {
    return `write not allowed for ${profile.id}`;
  }
  if (!profile.canRead && !commandNeedsWrite(commandName) && !commandNeedsDryRun(commandName)) {
    return `read not allowed for ${profile.id}`;
  }
  return null;
}

export function readAgentSessions() {
  return readJsonStorage<AiAgentSession[]>(AI_AGENT_SESSIONS_STORAGE_KEY, []);
}

export function writeAgentSessions(sessions: AiAgentSession[]) {
  writeJsonStorage(AI_AGENT_SESSIONS_STORAGE_KEY, sessions);
}

export function readActiveSessionId() {
  return readJsonStorage<string | null>(AI_AGENT_ACTIVE_SESSION_ID_STORAGE_KEY, null);
}

export function ensureActiveSession(client: AiAgentClient) {
  const sessions = readAgentSessions();
  const activeSessionId = readActiveSessionId();
  const existing = sessions.find((session) => session.id === activeSessionId && session.status === 'active');
  if (existing) {
    return existing;
  }

  const now = Date.now();
  const nextSession: AiAgentSession = {
    id: createId('session'),
    createdAt: now,
    updatedAt: now,
    title: 'AI CLI Session',
    client,
    status: 'active',
    messages: [],
    context: {
      currentWorkflow: 'buff.fill',
    },
  };
  writeAgentSessions([nextSession, ...sessions]);
  writeJsonStorage(AI_AGENT_ACTIVE_SESSION_ID_STORAGE_KEY, nextSession.id);
  return nextSession;
}

export function appendSessionMessage(sessionId: string, message: Omit<AiAgentMessage, 'id' | 'createdAt'>) {
  const sessions = readAgentSessions();
  const now = Date.now();
  writeAgentSessions(sessions.map((session) => {
    if (session.id !== sessionId) {
      return session;
    }
    return {
      ...session,
      updatedAt: now,
      messages: [
        ...session.messages,
        {
          id: createId('message'),
          createdAt: now,
          ...message,
        },
      ],
    };
  }));
}

export function updateSessionContext(sessionId: string, patch: AiAgentSession['context']) {
  const sessions = readAgentSessions();
  const now = Date.now();
  writeAgentSessions(sessions.map((session) => {
    if (session.id !== sessionId) {
      return session;
    }
    return {
      ...session,
      updatedAt: now,
      context: {
        ...session.context,
        ...patch,
      },
    };
  }));
}

export function readOperationLogs() {
  return readJsonStorage<AiAgentOperationLog[]>(AI_AGENT_OPERATION_LOGS_STORAGE_KEY, []);
}

export function readAgentRecordSnapshot() {
  return {
    sessions: readAgentSessions(),
    activeSessionId: readActiveSessionId(),
    operationLogs: readOperationLogs(),
    permissionProfiles: readPermissionProfiles(),
  };
}

export function appendOperationLog(log: Omit<AiAgentOperationLog, 'id' | 'createdAt'>) {
  const nextLog: AiAgentOperationLog = {
    id: createId('log'),
    createdAt: Date.now(),
    ...log,
  };
  writeJsonStorage(AI_AGENT_OPERATION_LOGS_STORAGE_KEY, [nextLog, ...readOperationLogs()].slice(0, AI_AGENT_LOG_LIMIT));
}
