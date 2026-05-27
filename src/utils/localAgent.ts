const LOCAL_AGENT_BASE_URL = 'http://127.0.0.1:31457';

export interface LocalAgentHealth {
  ok: boolean;
  service: string;
  host: string;
  port: number;
  shell: {
    running: boolean;
    pid: number | null;
    startedAt: number | null;
    minimized?: boolean;
    visible?: boolean;
    state?: 'visible' | 'hidden' | 'missing';
  };
  aiCliRest?: {
    running: boolean;
    pid: number | null;
    startedAt: number | null;
    url: string;
    started?: boolean;
    stopped?: boolean;
    reason?: string;
  };
  web: {
    url: string;
    openedAt: number | null;
  };
}

export async function getLocalAgentHealth(): Promise<LocalAgentHealth> {
  const response = await fetch(`${LOCAL_AGENT_BASE_URL}/health`);
  if (!response.ok) {
    throw new Error(`Local agent health request failed: ${response.status}`);
  }
  return response.json() as Promise<LocalAgentHealth>;
}

export async function requestOpenShell(): Promise<LocalAgentHealth['shell']> {
  const response = await fetch(`${LOCAL_AGENT_BASE_URL}/open-shell`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Open shell request failed: ${response.status}`);
  }

  const payload = await response.json() as {
    ok: boolean;
    shell: LocalAgentHealth['shell'] & { started?: boolean; reason?: string };
  };

  return payload.shell;
}

export async function requestCloseShell(): Promise<LocalAgentHealth['shell']> {
  const response = await fetch(`${LOCAL_AGENT_BASE_URL}/close-shell`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Close shell request failed: ${response.status}`);
  }

  const payload = await response.json() as {
    ok: boolean;
    shell: LocalAgentHealth['shell'] & { stopped?: boolean; reason?: string };
  };

  return payload.shell;
}

export async function requestOpenAiCliRest(): Promise<NonNullable<LocalAgentHealth['aiCliRest']>> {
  const response = await fetch(`${LOCAL_AGENT_BASE_URL}/open-ai-cli-rest`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Open AI CLI REST request failed: ${response.status}`);
  }

  const payload = await response.json() as {
    ok: boolean;
    aiCliRest: NonNullable<LocalAgentHealth['aiCliRest']>;
  };

  return payload.aiCliRest;
}

export async function requestCloseAiCliRest(): Promise<NonNullable<LocalAgentHealth['aiCliRest']>> {
  const response = await fetch(`${LOCAL_AGENT_BASE_URL}/close-ai-cli-rest`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Close AI CLI REST request failed: ${response.status}`);
  }

  const payload = await response.json() as {
    ok: boolean;
    aiCliRest: NonNullable<LocalAgentHealth['aiCliRest']>;
  };

  return payload.aiCliRest;
}
