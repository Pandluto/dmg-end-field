const LOCAL_BRIDGE_BASE_URL = 'http://127.0.0.1:31457';

export interface LocalBridgeHealth {
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
}

export async function getLocalBridgeHealth(): Promise<LocalBridgeHealth> {
  const response = await fetch(`${LOCAL_BRIDGE_BASE_URL}/health`);
  if (!response.ok) {
    throw new Error(`Local bridge health request failed: ${response.status}`);
  }
  return response.json() as Promise<LocalBridgeHealth>;
}

export async function requestOpenShell(): Promise<LocalBridgeHealth['shell']> {
  const response = await fetch(`${LOCAL_BRIDGE_BASE_URL}/open-shell`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Open shell request failed: ${response.status}`);
  }

  const payload = await response.json() as {
    ok: boolean;
    shell: LocalBridgeHealth['shell'] & { started?: boolean; reason?: string };
  };

  return payload.shell;
}

export async function requestCloseShell(): Promise<LocalBridgeHealth['shell']> {
  const response = await fetch(`${LOCAL_BRIDGE_BASE_URL}/close-shell`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Close shell request failed: ${response.status}`);
  }

  const payload = await response.json() as {
    ok: boolean;
    shell: LocalBridgeHealth['shell'] & { stopped?: boolean; reason?: string };
  };

  return payload.shell;
}
