import {
  type AiAgentClient,
  type AiAgentMessage,
  type AiAgentOperationLog,
  type AiAgentPermissionError,
  type AiAgentPermissionProfile,
  type AiAgentProposal,
  type AiAgentSession,
} from './aiCliAgentTypes';

const AI_AGENT_SESSIONS_STORAGE_KEY = 'def.ai-agent.sessions.v1';
const AI_AGENT_ACTIVE_SESSION_ID_STORAGE_KEY = 'def.ai-agent.active-session-id.v1';
const AI_AGENT_SESSION_STORAGE_KEY = 'def.ai-agent.session.v1';
const AI_AGENT_OPERATION_LOGS_STORAGE_KEY = 'def.ai-agent.operation-logs.v1';
const AI_AGENT_PERMISSION_PROFILES_STORAGE_KEY = 'def.ai-agent.permission-profiles.v1';
export const AI_AGENT_PROPOSALS_STORAGE_KEY = 'def.ai-agent.proposals.v1';
const AI_AGENT_CONTEXT_MESSAGE_LIMIT = 80;

export const KNOWN_COMMANDS = new Set([
  'help', '/help',
  'purpose', '/purpose',
  'spec', '/spec',
  'route',
  'agent.logs', 'agent.sessions', 'agent.guide',
  'buff.list', 'buff.show', 'buff.search', 'buff.open',
  'weapon.list', 'weapon.search', 'weapon.show', 'weapon.draft.show', 'weapon.open',
  'operator.current', 'operator.library', 'operator.library.show', 'operator.fill.task', 'operator.fill.check', 'operator.fill.apply',
  'equipment.current', 'equipment.library', 'equipment.library.show', 'equipment.setbuff', 'equipment.fill.task', 'equipment.fill.check', 'equipment.fill.apply',
  'operator.add', 'operator.show', 'operator.delete',
  'draft.show', 'draft.rename',
  'item.list', 'item.add', 'item.set', 'item.delete',
  'effect.list', 'effect.add', 'effect.set', 'effect.delete',
  'fill.task', 'fill.task.copy', 'fill.check', 'fill.apply', 'fill.source',
  'weapon.fill.task', 'weapon.fill.check', 'weapon.fill.apply',
  'proposal.list', 'proposal.show', 'proposal.approve', 'proposal.reject', 'proposal.save', 'proposal.unsave', 'proposal.clear',
  'y', 'n',
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
      allowedCommands: ['help', '/help', 'purpose', '/purpose', 'spec', '/spec', 'route', 'buff.list', 'buff.show', 'buff.search', 'draft.show', 'item.list', 'effect.list', 'operator.show', 'fill.task', 'fill.task.copy', 'fill.check', 'fill.source', 'agent.logs', 'agent.sessions', 'agent.guide', 'proposal.list', 'proposal.show', 'weapon.list', 'weapon.search', 'weapon.show', 'weapon.draft.show', 'weapon.fill.task', 'weapon.fill.check', 'operator.current', 'operator.library', 'operator.library.show', 'operator.fill.task', 'operator.fill.check', 'equipment.current', 'equipment.library', 'equipment.library.show', 'equipment.fill.task', 'equipment.fill.check'],
      allowedWorkflows: ['buff.fill', 'weapon.fill', 'operator.fill', 'equipment.fill'],
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
      allowedWorkflows: ['buff.fill', 'weapon.fill', 'operator.fill', 'equipment.fill'],
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
      allowedWorkflows: ['buff.fill', 'weapon.fill', 'operator.fill', 'equipment.fill'],
      canRead: true,
      canDryRun: true,
      canWrite: true,
      requiresUserConfirmForWrite: false,
    },
  ];
}

// 系统保证 readonly-agent 拥有的基础读命令
// 这些命令是 readonly 核心能力，不是一次性迁移，后续新增 readonly 命令也应加入
const GUARANTEED_READONLY_COMMANDS = ['agent.logs', 'agent.sessions', 'agent.guide', 'route', 'operator.show', 'fill.source', 'proposal.list', 'proposal.show', 'weapon.list', 'weapon.search', 'weapon.show', 'weapon.draft.show', 'weapon.fill.task', 'weapon.fill.check', 'operator.current', 'operator.library', 'operator.library.show', 'operator.fill.task', 'operator.fill.check', 'equipment.current', 'equipment.library', 'equipment.library.show', 'equipment.fill.task', 'equipment.fill.check'];

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
    'weapon.open',
    'buff.open',
    'draft.rename',
    'item.add',
    'item.set',
    'item.delete',
    'effect.add',
    'effect.set',
    'effect.delete',
    'fill.apply',
    'weapon.fill.apply',
    'operator.fill.apply',
    'equipment.fill.apply',
    'equipment.setbuff',
    'proposal.approve',
    'proposal.reject',
    'proposal.save',
    'proposal.unsave',
    'proposal.clear',
    'y',
    'n',
  ].includes(commandName);
}

export function commandNeedsDryRun(commandName: string) {
  return commandName === 'fill.check' || commandName === 'weapon.fill.check' || commandName === 'operator.fill.check' || commandName === 'equipment.fill.check';
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
    proposals: readAgentProposals(),
  };
}

/**
 * Validate an external proposal before import.
 * Rejects proposals with missing or invalid required fields.
 */
function isValidExternalProposal(proposal: unknown): proposal is AiAgentProposal {
  if (!proposal || typeof proposal !== 'object') return false;
  const p = proposal as Record<string, unknown>;
  if (!p.id || typeof p.id !== 'string') return false;
  if (!p.domain || (p.domain !== 'buff' && p.domain !== 'weapon' && p.domain !== 'operator' && p.domain !== 'equipment')) return false;
  if (!p.operation || typeof p.operation !== 'string') return false;
  if (!p.payload || typeof p.payload !== 'object' || Array.isArray(p.payload)) return false;
  if (!p.approvalStatus || (p.approvalStatus !== 'Wait' && p.approvalStatus !== 'Yes' && p.approvalStatus !== 'No')) return false;
  if (!p.saveStatus || (p.saveStatus !== 'Wait' && p.saveStatus !== 'Yes' && p.saveStatus !== 'No')) return false;
  if (!p.client || typeof p.client !== 'string') return false;
  return true;
}

/**
 * Import external proposals (e.g. from REST/SSE) into browser localStorage.
 * - Deduplicates by proposal.id.
 * - Browser-side state wins: if local proposal is already saved/rejected/unsaved, do not overwrite.
 * - Reassigns sessionId to current web-cli session so Y/N shortcuts work.
 * - Preserves original client in `client`, marks reviewer in `reviewedBy`.
 * - Rejects incomplete or invalid proposals (missing domain/payload/approvalStatus/saveStatus/client/id).
 * Returns the number of newly imported proposals and the total pending count after import.
 */
export function importExternalProposals(
  externalProposals: unknown[],
  currentSessionId: string,
): { imported: number; pendingCount: number; lines: string[]; rejected: number; resolvedSynced: number } {
  const localProposals = readAgentProposals();
  const localMap = new Map(localProposals.map((p) => [p.id, p]));
  let imported = 0;
  let rejected = 0;
  let resolvedSynced = 0;

  for (const ext of externalProposals) {
    if (!isValidExternalProposal(ext)) {
      rejected++;
      continue;
    }
    const extPending = ext.approvalStatus === 'Wait' || (ext.approvalStatus === 'Yes' && ext.saveStatus === 'Wait');
    const local = localMap.get(ext.id);
    if (local) {
      // Browser-side state wins: if local is already resolved, skip
      if (local.approvalStatus !== 'Wait' && !(local.approvalStatus === 'Yes' && local.saveStatus === 'Wait')) {
        continue;
      }
      // If local is pending but external is also pending, keep local (avoid overwriting)
      if (extPending) {
        continue;
      }
      const index = localProposals.findIndex((p) => p.id === ext.id);
      if (index >= 0) {
        localProposals[index] = {
          ...local,
          approvalStatus: ext.approvalStatus,
          saveStatus: ext.saveStatus,
          reviewedBy: ext.reviewedBy || ext.client,
          updatedAt: Date.now(),
        };
        resolvedSynced++;
      }
      continue;
    }
    // Only import proposals that are pending (Wait or Yes/Wait)
    if (!extPending) {
      continue;
    }
    const merged: AiAgentProposal = {
      ...ext,
      sessionId: currentSessionId,
      reviewedBy: 'web-cli',
      updatedAt: Date.now(),
    };
    if (local) {
      // Replace existing entry at same index to keep order
      const index = localProposals.findIndex((p) => p.id === ext.id);
      if (index >= 0) {
        localProposals[index] = merged;
      } else {
        localProposals.push(merged);
      }
    } else {
      localProposals.push(merged);
      imported++;
    }
  }

  writeJsonStorage(AI_AGENT_PROPOSALS_STORAGE_KEY, localProposals);

  const pendingCount = localProposals.filter(
    (p) =>
      p.sessionId === currentSessionId
      && (p.approvalStatus === 'Wait' || (p.approvalStatus === 'Yes' && p.saveStatus === 'Wait')),
  ).length;

  const lines: string[] = [];
  if (imported > 0) {
    lines.push(`[handoff] imported ${imported} external proposal${imported === 1 ? '' : 's'} (已导入 ${imported} 个外部提案)`);
    if (pendingCount === 1) {
      lines.push('[state] 1 pending proposal in current session (当前会话 1 个待处理提案)');
      lines.push('[next] Use proposal.list or press Y (使用 proposal.list 查看，或按 Y 审批)');
    } else if (pendingCount > 1) {
      lines.push(`[state] ${pendingCount} pending proposals in current session (当前会话 ${pendingCount} 个待处理提案)`);
      lines.push('[next] Y/N is blocked. Use proposal.list, explicit commands, or REST proposal.clear (Y/N 已阻塞；先查看列表、显式处理，或让外部模型调用 proposal.clear)');
    }
  }
  if (rejected > 0) {
    lines.push(`[warn] rejected ${rejected} incomplete proposal${rejected === 1 ? '' : 's'} (拒绝 ${rejected} 个不完整提案)`);
  }
  if (resolvedSynced > 0) {
    lines.push(`[handoff] synced ${resolvedSynced} resolved proposal${resolvedSynced === 1 ? '' : 's'} (已同步关闭 ${resolvedSynced} 个提案)`);
    lines.push(`[state] ${pendingCount} pending proposals in current session (当前会话 ${pendingCount} 个待处理提案)`);
  }

  return { imported, pendingCount, lines, rejected, resolvedSynced };
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

// Proposal service

export function createAgentProposal(params: Omit<AiAgentProposal, 'id' | 'createdAt' | 'updatedAt'>): AiAgentProposal {
  const now = Date.now();
  const proposal: AiAgentProposal = {
    id: createId('proposal'),
    createdAt: now,
    updatedAt: now,
    ...params,
  };
  const existing = readJsonStorage<AiAgentProposal[]>(AI_AGENT_PROPOSALS_STORAGE_KEY, []);
  writeJsonStorage(AI_AGENT_PROPOSALS_STORAGE_KEY, [...existing, proposal]);
  return proposal;
}

export function readAgentProposals(): AiAgentProposal[] {
  return readJsonStorage<AiAgentProposal[]>(AI_AGENT_PROPOSALS_STORAGE_KEY, []);
}

export function readPendingAgentProposals(sessionId?: string): AiAgentProposal[] {
  const all = readAgentProposals().filter((p) => p.approvalStatus === 'Wait' || (p.approvalStatus === 'Yes' && p.saveStatus === 'Wait'));
  if (sessionId === undefined) {
    return all;
  }
  return all.filter((p) => p.sessionId === sessionId);
}

export function readPendingAgentProposal(sessionId?: string): AiAgentProposal | null {
  const pending = readPendingAgentProposals(sessionId);
  return pending[pending.length - 1] ?? null;
}

function updateAgentProposal(id: string, patch: Partial<Omit<AiAgentProposal, 'id' | 'createdAt'>>): AiAgentProposal | null {
  const existing = readAgentProposals();
  const index = existing.findIndex((p) => p.id === id);
  if (index < 0) {
    return null;
  }
  const updated: AiAgentProposal = {
    ...existing[index],
    ...patch,
    updatedAt: Date.now(),
  };
  const next = [...existing];
  next[index] = updated;
  writeJsonStorage(AI_AGENT_PROPOSALS_STORAGE_KEY, next);
  return updated;
}

export function approveAgentProposal(id: string): AiAgentProposal | null {
  const proposal = readAgentProposals().find((p) => p.id === id);
  if (!proposal || proposal.approvalStatus !== 'Wait') {
    return null;
  }
  return updateAgentProposal(id, { approvalStatus: 'Yes' });
}

export function rejectAgentProposal(id: string): AiAgentProposal | null {
  const proposal = readAgentProposals().find((p) => p.id === id);
  if (!proposal || proposal.approvalStatus !== 'Wait') {
    return null;
  }
  return updateAgentProposal(id, { approvalStatus: 'No', saveStatus: 'No' });
}

export function markAgentProposalSaved(id: string): AiAgentProposal | null {
  const proposal = readAgentProposals().find((p) => p.id === id);
  if (!proposal || proposal.approvalStatus !== 'Yes' || proposal.saveStatus !== 'Wait') {
    return null;
  }
  return updateAgentProposal(id, { saveStatus: 'Yes' });
}

export function markAgentProposalUnsaved(id: string): AiAgentProposal | null {
  const proposal = readAgentProposals().find((p) => p.id === id);
  if (!proposal || proposal.approvalStatus !== 'Yes' || proposal.saveStatus !== 'Wait') {
    return null;
  }
  return updateAgentProposal(id, { saveStatus: 'No' });
}

export function clearPendingAgentProposals(sessionId?: string, reviewer: AiAgentClient = 'web-cli'): { cleared: AiAgentProposal[]; remaining: number } {
  const existing = readAgentProposals();
  const now = Date.now();
  const cleared: AiAgentProposal[] = [];
  const next = existing.map((proposal) => {
    const isPending = proposal.approvalStatus === 'Wait' || (proposal.approvalStatus === 'Yes' && proposal.saveStatus === 'Wait');
    if (!isPending || (sessionId !== undefined && proposal.sessionId !== sessionId)) {
      return proposal;
    }
    const updated: AiAgentProposal = {
      ...proposal,
      approvalStatus: proposal.approvalStatus === 'Wait' ? 'No' : proposal.approvalStatus,
      saveStatus: 'No',
      reviewedBy: reviewer,
      updatedAt: now,
    };
    cleared.push(updated);
    return updated;
  });
  writeJsonStorage(AI_AGENT_PROPOSALS_STORAGE_KEY, next);
  const remaining = next.filter(
    (p) =>
      (sessionId === undefined || p.sessionId === sessionId)
      && (p.approvalStatus === 'Wait' || (p.approvalStatus === 'Yes' && p.saveStatus === 'Wait')),
  ).length;
  return { cleared, remaining };
}
