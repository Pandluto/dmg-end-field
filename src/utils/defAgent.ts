const LOCAL_AGENT_BASE_URL = 'http://127.0.0.1:31457';

export interface DefAgentRuntimeInfo {
  running: boolean;
  pid: number | null;
  startedAt: number | null;
  url: string;
  started?: boolean;
  stopped?: boolean;
  ready?: boolean;
  reason?: string;
  error?: string;
}

export interface DeepSeekConfigSummary {
  provider: 'deepseek';
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
}

export interface DefAgentChatResult {
  ok: boolean;
  provider: string;
  model?: string;
  content?: string;
  error?: string;
  status?: number;
  usedRemoteModel?: boolean;
  realOpenCode?: boolean;
  sessionID?: string;
  agent?: string;
  eventTypes?: string[];
  openCodeParts?: string[];
  activity?: DefAgentActivityItem[];
  steps?: DefAgentLoopStep[];
  rawUsage?: DefAgentTokens;
}

export type DefAgentThinkingEffort = 'low' | 'medium' | 'high';

export interface DefAgentTokens {
  total: number;
  prompt: number;
  completion: number;
  reasoning?: number;
}

export type DefAgentStreamEventType =
  | 'session.created'
  | 'message.start'
  | 'step.start'
  | 'reasoning'
  | 'tool.start'
  | 'tool.content'
  | 'tool.error'
  | 'text'
  | 'step.finish'
  | 'stopped'
  | 'done'
  | 'error'
  | string;

export interface DefAgentStreamEvent {
  seq?: number;
  type: DefAgentStreamEventType;
  at?: number;
  sessionId?: string;
  sessionID?: string;
  messageId?: string;
  partId?: string;
  id?: string;
  callId?: string;
  toolName?: string;
  businessToolName?: string;
  status?: string;
  title?: string;
  input?: unknown;
  result?: string;
  proposalId?: string;
  error?: string;
  text?: string;
  content?: string;
  agent?: string;
  model?: string;
  skillId?: string;
  tokens?: DefAgentTokens;
  ok?: boolean;
  turnId?: string;
  clientTurnId?: string;
  summary?: string;
  redacted?: boolean;
  resumed?: boolean;
}

export interface DefAgentSessionSummary {
  id: string;
  sessionID?: string;
  title?: string;
  agent?: string;
  model?: string;
  skillId?: string;
  active?: boolean;
  stopped?: boolean;
  archived?: boolean;
  persisted?: boolean;
  createdAt?: number;
  updatedAt?: number;
  tokens?: DefAgentTokens;
  lastSeq?: number;
}

export interface DefAgentTranscriptMessage {
  id?: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  meta?: string;
  sessionId?: string;
  activity?: DefAgentActivityItem[];
  loopSteps?: DefAgentLoopStep[];
  tokens?: DefAgentTokens;
  isStreaming?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface DefAgentTranscript {
  session: DefAgentSessionSummary;
  messages: DefAgentTranscriptMessage[];
}

export interface DefAgentWorkbenchTestUiEvent {
  at?: number;
  prompt: string;
  clientTurnId: string;
  thinkingEffort?: DefAgentThinkingEffort;
  sessionId?: string;
  sessionID?: string;
  mode?: 'stream' | 'continue' | string;
  snapshotAvailable?: boolean;
  evidenceAvailable?: boolean;
  replay?: boolean;
}

export type DefCodexIngressMode = 'pure-blackbox' | 'diagnostic';

export interface DefCodexInteropError {
  code: string;
  message: string;
  component: string;
  retryable: boolean;
  ids?: Record<string, string>;
  nextAction?: string;
}

export interface DefCodexInteropTurn {
  accepted: boolean;
  testRunId: string;
  sessionId: string;
  turnId: string;
  clientTurnId: string;
  ingressMode: DefCodexIngressMode;
  rawUserText: string;
  providerVisibleUserText: string;
  snapshotAvailable: boolean;
  eventCursor: string;
  links: Record<string, string>;
}

export interface DefCodexInteropStatus {
  protocol: 'def-codex-interop';
  protocolVersion: 1;
  developmentOnly: boolean;
  bridge: { ready: boolean; version: string };
  agent: { ready: boolean; state: string; version?: string };
  workbench: { snapshotAvailable: boolean; uiConnected: boolean; uiConsumerCount: number };
  capabilities: string[];
}

export interface DefAgentLoopStep {
  phase: 'think' | 'act' | 'observe' | 'answer';
  label: string;
  detail?: string;
  status: 'pending' | 'running' | 'done' | 'stopped' | 'error';
}

export interface DefAgentActivityItem {
  id?: string;
  kind: 'event' | 'step' | 'reasoning' | 'tool' | 'message' | string;
  title: string;
  detail?: string;
  result?: string;
  input?: unknown;
  status: 'pending' | 'running' | 'done' | 'stopped' | 'error' | string;
}

async function readJsonResponse<T>(response: Response, label: string): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error === 'string'
      ? payload.error
      : `${label} failed: HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export async function requestOpenDefAgent(): Promise<DefAgentRuntimeInfo> {
  const response = await fetch(`${LOCAL_AGENT_BASE_URL}/open-def-agent`, {
    method: 'POST',
  });
  const payload = await readJsonResponse<{ ok: boolean; defAgent: DefAgentRuntimeInfo }>(response, 'Open DEF agent');
  return payload.defAgent;
}

export async function requestCloseDefAgent(): Promise<DefAgentRuntimeInfo> {
  const response = await fetch(`${LOCAL_AGENT_BASE_URL}/close-def-agent`, {
    method: 'POST',
  });
  const payload = await readJsonResponse<{ ok: boolean; defAgent: DefAgentRuntimeInfo }>(response, 'Close DEF agent');
  return payload.defAgent;
}

export async function saveDeepSeekConfig(config: {
  apiKey: string;
  baseUrl: string;
  model: string;
}): Promise<DeepSeekConfigSummary> {
  const response = await fetch(`${LOCAL_AGENT_BASE_URL}/def-agent/deepseek-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(config),
  });
  const payload = await readJsonResponse<{ ok: boolean; deepseek: DeepSeekConfigSummary }>(response, 'Save DeepSeek config');
  return payload.deepseek;
}

export async function sendDefAgentMessage(
  message: string,
  options: {
    thinkingEffort?: DefAgentThinkingEffort;
    skillId?: string;
    signal?: AbortSignal;
  } = {},
): Promise<DefAgentChatResult> {
  const response = await fetch(`${LOCAL_AGENT_BASE_URL}/def-agent/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      message,
      thinkingEffort: options.thinkingEffort || 'medium',
      skillId: options.skillId,
    }),
    signal: options.signal,
  });
  const payload = await readJsonResponse<{ ok: boolean; result: DefAgentChatResult }>(response, 'DEF agent chat');
  return payload.result;
}

function openDefAgentEventSource(sessionId: string, fromSeq = 0): EventSource {
  const url = new URL(`${LOCAL_AGENT_BASE_URL}/def-agent/chat/${encodeURIComponent(sessionId)}/events`);
  if (fromSeq > 0) url.searchParams.set('from', String(fromSeq));
  return new EventSource(url.toString());
}

export async function startDefAgentStream(
  message: string,
  options: {
    thinkingEffort?: DefAgentThinkingEffort;
    skillId?: string;
    fromSeq?: number;
    clientTurnId?: string;
  } = {},
): Promise<{ sessionId: string; eventSource: EventSource }> {
  const response = await fetch(`${LOCAL_AGENT_BASE_URL}/def-agent/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      message,
      thinkingEffort: options.thinkingEffort || 'medium',
      skillId: options.skillId,
      clientTurnId: options.clientTurnId,
    }),
  });
  const payload = await readJsonResponse<{ ok: boolean; sessionId?: string; sessionID?: string }>(response, 'Start DEF agent stream');
  const sessionId = payload.sessionId || payload.sessionID;
  if (!sessionId) throw new Error('Start DEF agent stream failed: no session id');
  return {
    sessionId,
    eventSource: openDefAgentEventSource(sessionId, options.fromSeq || 0),
  };
}

export async function sendDefAgentContinue(
  sessionId: string,
  message: string,
  clientTurnId?: string,
  options: {
    thinkingEffort?: DefAgentThinkingEffort;
    skillId?: string;
  } = {},
): Promise<{ ok: boolean; sessionId?: string; sessionID?: string }> {
  const response = await fetch(`${LOCAL_AGENT_BASE_URL}/def-agent/chat/${encodeURIComponent(sessionId)}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      message,
      clientTurnId,
      thinkingEffort: options.thinkingEffort || 'medium',
      skillId: options.skillId,
    }),
  });
  return readJsonResponse<{ ok: boolean; sessionId?: string; sessionID?: string }>(response, 'Continue DEF agent stream');
}

export function subscribeDefAgentSession(sessionId: string, fromSeq = 0): EventSource {
  return openDefAgentEventSource(sessionId, fromSeq);
}

export async function authorizeDefCodexInterop(): Promise<{ token: string; expiresAt: number }> {
  const response = await fetch(`${LOCAL_AGENT_BASE_URL}/def-agent/interop/v1/authorize`, { method: 'POST' });
  return readJsonResponse<{ token: string; expiresAt: number }>(response, 'Authorize DEF Codex interop');
}

export async function getDefCodexInteropStatus(): Promise<DefCodexInteropStatus> {
  const response = await fetch(`${LOCAL_AGENT_BASE_URL}/def-agent/interop/v1/status`, { cache: 'no-store' });
  return readJsonResponse<DefCodexInteropStatus>(response, 'Read DEF Codex interop status');
}

export async function startDefCodexInteropTurn(input: {
  token: string;
  rawUserText: string;
  clientTurnId: string;
  ingressMode?: DefCodexIngressMode;
  thinkingEffort?: DefAgentThinkingEffort;
  diagnostic?: { purpose: string; scope?: string; mutationAllowed?: boolean };
}): Promise<DefCodexInteropTurn> {
  const response = await fetch(`${LOCAL_AGENT_BASE_URL}/def-agent/interop/v1/turns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${input.token}` },
    body: JSON.stringify({ protocolVersion: 1, ...input }),
  });
  const payload = await readJsonResponse<{ turn: DefCodexInteropTurn }>(response, 'Start DEF Codex interop turn');
  return payload.turn;
}

export async function continueDefCodexInteropTurn(sessionId: string, input: Omit<Parameters<typeof startDefCodexInteropTurn>[0], 'sessionId'>): Promise<DefCodexInteropTurn> {
  const response = await fetch(`${LOCAL_AGENT_BASE_URL}/def-agent/interop/v1/sessions/${encodeURIComponent(sessionId)}/turns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${input.token}` },
    body: JSON.stringify({ protocolVersion: 1, ...input }),
  });
  const payload = await readJsonResponse<{ turn: DefCodexInteropTurn }>(response, 'Continue DEF Codex interop turn');
  return payload.turn;
}

export function subscribeDefCodexInteropEvents(sessionId: string, from = 0): EventSource {
  const url = new URL(`${LOCAL_AGENT_BASE_URL}/def-agent/interop/v1/sessions/${encodeURIComponent(sessionId)}/events`);
  if (from > 0) url.searchParams.set('from', String(from));
  return new EventSource(url.toString());
}

export function subscribeDefCodexInteropUiEvents(from = 0): EventSource {
  const url = new URL(`${LOCAL_AGENT_BASE_URL}/def-agent/interop/v1/ui-events`);
  if (from > 0) url.searchParams.set('from', String(from));
  return new EventSource(url.toString());
}

export async function stopDefAgentStream(sessionId: string): Promise<{ ok: boolean; stopped?: boolean; reason?: string; sessionID?: string }> {
  const response = await fetch(`${LOCAL_AGENT_BASE_URL}/def-agent/chat/${encodeURIComponent(sessionId)}/stop`, {
    method: 'POST',
  });
  const payload = await readJsonResponse<{
    ok: boolean;
    result: { ok: boolean; stopped?: boolean; reason?: string; sessionID?: string };
  }>(response, 'Stop DEF agent stream');
  return payload.result;
}

export async function listDefAgentSessions(): Promise<DefAgentSessionSummary[]> {
  const response = await fetch(`${LOCAL_AGENT_BASE_URL}/def-agent/chat/sessions`, {
    cache: 'no-store',
  });
  const payload = await readJsonResponse<{ ok: boolean; sessions: DefAgentSessionSummary[] }>(response, 'List DEF agent sessions');
  return payload.sessions || [];
}

export async function listPersistedDefAgentSessions(limit = 100): Promise<DefAgentSessionSummary[]> {
  const url = new URL(`${LOCAL_AGENT_BASE_URL}/def-agent/chat/persisted-sessions`);
  url.searchParams.set('limit', String(limit));
  const response = await fetch(url.toString(), {
    cache: 'no-store',
  });
  const payload = await readJsonResponse<{ ok: boolean; sessions: DefAgentSessionSummary[] }>(response, 'List persisted DEF agent sessions');
  return payload.sessions || [];
}

export async function hydrateDefAgentSession(sessionId: string): Promise<DefAgentTranscript> {
  const response = await fetch(`${LOCAL_AGENT_BASE_URL}/def-agent/chat/${encodeURIComponent(sessionId)}/transcript`, {
    cache: 'no-store',
  });
  return readJsonResponse<DefAgentTranscript & { ok: boolean }>(response, 'Hydrate DEF agent session');
}

export async function stopDefAgentMessage(): Promise<{ ok: boolean; stopped?: boolean; reason?: string; sessionID?: string }> {
  const response = await fetch(`${LOCAL_AGENT_BASE_URL}/def-agent/chat/stop`, {
    method: 'POST',
  });
  const payload = await readJsonResponse<{
    ok: boolean;
    result: { ok: boolean; stopped?: boolean; reason?: string; sessionID?: string };
  }>(response, 'Stop DEF agent chat');
  return payload.result;
}
