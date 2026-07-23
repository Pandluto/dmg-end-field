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

export type DefAgentThinkingEffort = 'low' | 'medium' | 'high';

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
