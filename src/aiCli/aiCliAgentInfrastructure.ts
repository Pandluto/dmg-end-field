import {
  type AiAgentClient,
  type AiAgentMessage,
  type AiAgentOperationLog,
  type AiAgentPermissionError,
  type AiAgentPermissionProfile,
  type AiAgentSession,
} from './aiCliAgentTypes';

const AI_AGENT_SESSIONS_STORAGE_KEY = 'def.ai-agent.sessions.v1';
const AI_AGENT_ACTIVE_SESSION_ID_STORAGE_KEY = 'def.ai-agent.active-session-id.v1';
const AI_AGENT_SESSION_STORAGE_KEY = 'def.ai-agent.session.v1';
const AI_AGENT_OPERATION_LOGS_STORAGE_KEY = 'def.ai-agent.operation-logs.v1';
const AI_AGENT_PERMISSION_PROFILES_STORAGE_KEY = 'def.ai-agent.permission-profiles.v1';
const AI_AGENT_CONTEXT_MESSAGE_LIMIT = 80;

export const KNOWN_COMMANDS = new Set([
  'help', '/help',
  'purpose', '/purpose',
  'spec', '/spec',
  'route',
  'agent.logs', 'agent.sessions', 'agent.guide',
  'buff.list', 'buff.show', 'buff.search', 'buff.open',
  'operator.add', 'operator.show', 'operator.delete',
  'draft.show', 'draft.rename',
  'item.list', 'item.add', 'item.set', 'item.delete',
  'effect.list', 'effect.add', 'effect.set', 'effect.delete',
  'fill.task', 'fill.task.copy', 'fill.check', 'fill.apply', 'fill.source',
]);

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
      allowedCommands: ['help', '/help', 'purpose', '/purpose', 'spec', '/spec', 'route', 'buff.list', 'buff.show', 'buff.search', 'draft.show', 'item.list', 'effect.list', 'operator.show', 'fill.task', 'fill.task.copy', 'fill.check', 'fill.source', 'agent.logs', 'agent.sessions', 'agent.guide'],
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

// 系统保证 readonly-agent 拥有的基础读命令
// 这些命令是 readonly 核心能力，不是一次性迁移，后续新增 readonly 命令也应加入
const GUARANTEED_READONLY_COMMANDS = ['agent.logs', 'agent.sessions', 'agent.guide', 'route', 'operator.show', 'fill.source'];

export function readPermissionProfiles(): AiAgentPermissionProfile[] {
  const storedProfiles = readJsonStorage<AiAgentPermissionProfile[]>(AI_AGENT_PERMISSION_PROFILES_STORAGE_KEY, []);
  const defaultProfiles = createDefaultPermissionProfiles();

  if (!storedProfiles.length) {
    return defaultProfiles;
  }

  // 自动补齐缺失的命令（系统保证的基础读命令）
  // 只针对 readonly-agent，补齐 GUARANTEED_READONLY_COMMANDS 中的命令
  const migratedProfiles = storedProfiles.map((stored) => {
    if (stored.id !== 'readonly-agent') {
      return stored;
    }

    const storedCommands = new Set(stored.allowedCommands);
    const missingCommands = GUARANTEED_READONLY_COMMANDS.filter((cmd) => !storedCommands.has(cmd));

    if (missingCommands.length === 0) {
      return stored;
    }

    return {
      ...stored,
      allowedCommands: [...stored.allowedCommands, ...missingCommands],
    };
  });

  return migratedProfiles;
}

export function findPermissionProfile(client: AiAgentClient) {
  const profiles = readPermissionProfiles();
  return profiles.find((profile) => profile.client === client) || profiles[0] || createDefaultPermissionProfiles()[0];
}

export function commandNeedsWrite(commandName: string) {
  return [
    'operator.add',
    'operator.delete',
    'buff.open',
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

export function assertPermission(profile: AiAgentPermissionProfile, commandName: string): AiAgentPermissionError | null {
  if (!KNOWN_COMMANDS.has(commandName)) {
    return { code: 'unknown-command', message: `unknown command: ${commandName}` };
  }
  if (!canRunCommand(profile, commandName)) {
    return { code: 'permission-denied', message: `command not allowed for ${profile.id}: ${commandName}` };
  }
  if (commandNeedsDryRun(commandName) && !profile.canDryRun) {
    return { code: 'dry-run-denied', message: `dry-run not allowed for ${profile.id}` };
  }
  if (commandNeedsWrite(commandName) && !profile.canWrite) {
    return { code: 'write-denied', message: `write not allowed for ${profile.id}` };
  }
  if (!profile.canRead && !commandNeedsWrite(commandName) && !commandNeedsDryRun(commandName)) {
    return { code: 'read-denied', message: `read not allowed for ${profile.id}` };
  }
  return null;
}

export function readAgentSessions() {
  const session = readAgentSession();
  return session ? [session] : [];
}

export function writeAgentSessions(sessions: AiAgentSession[]) {
  if (sessions[0]) {
    writeAgentSession(sessions[0]);
  }
}

export function readActiveSessionId() {
  const singleSession = readJsonStorage<AiAgentSession | null>(AI_AGENT_SESSION_STORAGE_KEY, null);
  return singleSession?.id ?? readJsonStorage<string | null>(AI_AGENT_ACTIVE_SESSION_ID_STORAGE_KEY, null);
}

function createAgentSession(client: AiAgentClient): AiAgentSession {
  const now = Date.now();
  return {
    id: createId('session'),
    createdAt: now,
    updatedAt: now,
    title: 'AI CLI Session',
    client,
    status: 'active',
    summary: '',
    messages: [],
    context: {
      currentWorkflow: 'buff.fill',
    },
    state: {},
  };
}

function normalizeAgentSession(session: AiAgentSession, client: AiAgentClient): AiAgentSession {
  return {
    ...session,
    client: session.client || client,
    status: 'active',
    summary: session.summary ?? '',
    messages: Array.isArray(session.messages) ? session.messages.slice(-AI_AGENT_CONTEXT_MESSAGE_LIMIT) : [],
    context: session.context || { currentWorkflow: 'buff.fill' },
    state: session.state || {},
  };
}

export function readAgentSession(): AiAgentSession | null {
  const singleSession = readJsonStorage<AiAgentSession | null>(AI_AGENT_SESSION_STORAGE_KEY, null);
  if (singleSession) {
    return normalizeAgentSession(singleSession, singleSession.client);
  }

  const legacySessions = readJsonStorage<AiAgentSession[]>(AI_AGENT_SESSIONS_STORAGE_KEY, []);
  const activeSessionId = readActiveSessionId();
  const legacySession = legacySessions.find((session) => session.id === activeSessionId && session.status === 'active')
    || legacySessions.find((session) => session.status === 'active')
    || legacySessions[0]
    || null;
  return legacySession ? normalizeAgentSession(legacySession, legacySession.client) : null;
}

export function writeAgentSession(session: AiAgentSession) {
  writeJsonStorage(AI_AGENT_SESSION_STORAGE_KEY, normalizeAgentSession(session, session.client));
}

export function ensureAgentSession(client: AiAgentClient) {
  const existing = readAgentSession();
  if (existing) {
    const normalized = normalizeAgentSession(existing, client);
    if (normalized.client !== client && !normalized.client) {
      writeAgentSession(normalized);
    }
    return normalized;
  }

  const nextSession = createAgentSession(client);
  writeAgentSession(nextSession);
  writeJsonStorage(AI_AGENT_ACTIVE_SESSION_ID_STORAGE_KEY, nextSession.id);
  return nextSession;
}

export const ensureActiveSession = ensureAgentSession;

export function appendSessionMessage(sessionId: string, message: Omit<AiAgentMessage, 'id' | 'createdAt'>) {
  const session = ensureAgentSession('web-cli');
  const now = Date.now();
  writeAgentSession({
    ...session,
    id: sessionId || session.id,
    updatedAt: now,
    messages: [
      ...session.messages,
      {
        id: createId('message'),
        createdAt: now,
        ...message,
      },
    ].slice(-AI_AGENT_CONTEXT_MESSAGE_LIMIT),
  });
}

export function updateSessionContext(sessionId: string, patch: AiAgentSession['context']) {
  const session = ensureAgentSession('web-cli');
  const now = Date.now();
  writeAgentSession({
    ...session,
    id: sessionId || session.id,
    updatedAt: now,
    context: {
      ...session.context,
      ...patch,
    },
  });
}

export function overwriteSessionSummary(summary: string) {
  const session = ensureAgentSession('web-cli');
  writeAgentSession({
    ...session,
    updatedAt: Date.now(),
    summary,
  });
}

export function overwriteSessionState(state: Record<string, unknown>) {
  const session = ensureAgentSession('web-cli');
  writeAgentSession({
    ...session,
    updatedAt: Date.now(),
    state,
  });
}

export function readOperationLogs() {
  return [...readJsonStorage<AiAgentOperationLog[]>(AI_AGENT_OPERATION_LOGS_STORAGE_KEY, [])]
    .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
}

export function readAgentRecordSnapshot() {
  return {
    sessions: readAgentSessions(),
    activeSessionId: readActiveSessionId(),
    session: readAgentSession(),
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
  const existingLogs = readJsonStorage<AiAgentOperationLog[]>(AI_AGENT_OPERATION_LOGS_STORAGE_KEY, []);
  writeJsonStorage(AI_AGENT_OPERATION_LOGS_STORAGE_KEY, [...existingLogs, nextLog]);
}
