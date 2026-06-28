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
}

export type DefAgentThinkingEffort = 'low' | 'medium' | 'high';

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
