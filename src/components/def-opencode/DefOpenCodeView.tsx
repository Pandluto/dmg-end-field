import { useEffect, useMemo, useRef, useState } from 'react';
import './DefOpenCodeView.css';

export type DefOpenCodeHost = 'workbench' | 'ai-cli';

type NativeSession = {
  id: string;
  uiPath: string;
  host: DefOpenCodeHost;
  directory: string;
  agent?: string;
  profile?: {
    schemaVersion: number;
    host: DefOpenCodeHost;
    agent: string;
    lockedAgent: boolean;
    lockedModel: boolean;
    theme: string;
  };
};

interface DefOpenCodeViewProps {
  host: DefOpenCodeHost;
  title: string;
  onClose?: () => void;
  workbenchContext?: Record<string, unknown>;
}

const SIDECAR_PORT = 17322;
const INTEROP_BASE_URL = 'http://127.0.0.1:31457/def-agent/interop/v1';

export function DefOpenCodeView({
  host,
  title,
  onClose,
  workbenchContext,
}: DefOpenCodeViewProps) {
  const [status, setStatus] = useState<'checking' | 'ready' | 'error'>('checking');
  const [session, setSession] = useState<NativeSession | null>(null);
  const origin = useMemo(() => (
    host === 'workbench'
      ? `http://127.0.0.1:${SIDECAR_PORT}`
      : `http://localhost:${SIDECAR_PORT}`
  ), [host]);

  const storageKey = `def-opencode.native-session.${host}.v1`;

  const sessionExists = async (candidate: NativeSession) => {
    if (!candidate.directory) return false;
    const response = await fetch(
      `${origin}/api/native/bootstrap?sessionID=${encodeURIComponent(candidate.id)}&directory=${encodeURIComponent(candidate.directory)}`,
      { headers: { accept: 'application/json' } },
    );
    if (!response.ok) return false;
    const payload = await response.json() as { ok?: boolean };
    return payload.ok === true;
  };

  const createNativeSession = async () => {
    const response = await fetch(`${origin}/api/native/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as { ok?: boolean; session?: NativeSession };
    if (!payload.ok || !payload.session?.id || !payload.session.uiPath) throw new Error('Invalid native session response');
    window.localStorage.setItem(storageKey, JSON.stringify(payload.session));
    setSession(payload.session);
    setStatus('ready');
  };

  const frameSrc = useMemo(() => {
    if (!session) return '';
    const url = new URL(session.uiPath, origin);
    url.searchParams.set('def_host', host);
    return url.toString();
  }, [host, origin, session]);

  useEffect(() => {
    let disposed = false;
    const bootstrap = async () => {
      const ensureResponse = await fetch(`${origin}/api/runtime/ensure`, { method: 'POST' });
      if (!ensureResponse.ok) throw new Error(`HTTP ${ensureResponse.status}`);
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as NativeSession;
          if (
            parsed?.id
            && parsed.uiPath
            && parsed.host === host
            && await sessionExists(parsed)
          ) {
            if (!disposed) {
              setSession(parsed);
              setStatus('ready');
            }
            return;
          }
        } catch {
          // Invalid or obsolete persisted sessions are replaced below.
        }
        window.localStorage.removeItem(storageKey);
      }
      if (!disposed) await createNativeSession();
    };
    bootstrap().catch(() => { if (!disposed) setStatus('error'); });
    return () => { disposed = true; };
  }, [host, origin, storageKey]);

  useEffect(() => {
    if (host !== 'workbench' || !session || !workbenchContext) return;
    const controller = new AbortController();
    void fetch(`${origin}/api/native/context`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionID: session.id, directory: session.directory, context: workbenchContext }),
      signal: controller.signal,
    }).catch(() => undefined);
    return () => controller.abort();
  }, [host, origin, session, workbenchContext]);

  useEffect(() => {
    if (host !== 'workbench' || !session) return;
    // A per-effect capability makes a delayed development cleanup unable to
    // close the consumer that replaced it.
    const consumerId = crypto.randomUUID();
    const renderSecret = crypto.randomUUID();
    const controller = new AbortController();
    void fetch(`${INTEROP_BASE_URL}/ui/consumer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ consumerId, renderSecret, host, sessionId: session.id, directory: session.directory }),
      signal: controller.signal,
    }).catch(() => undefined);

    return () => {
      controller.abort();
      void fetch(`${INTEROP_BASE_URL}/ui/consumer/close`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ consumerId, renderSecret, sessionId: session.id }),
      }).catch(() => undefined);
    };
  }, [host, origin, session]);

  return (
    <section
      className={`def-opencode-view def-opencode-view--${host}`}
      data-def-opencode-host={host}
      data-def-opencode-session-id={session?.id || undefined}
    >
      {onClose ? (
        <nav className="def-opencode-view__nav" aria-label="DEF OpenCode navigation">
          <button type="button" onClick={onClose}>返回</button>
          <button
            type="button"
            onClick={() => {
              setStatus('checking');
              void createNativeSession().catch(() => setStatus('error'));
            }}
          >
            新建 DEF 会话
          </button>
        </nav>
      ) : null}
      <div className="def-opencode-view__body">
        {status === 'error' ? (
          <div className="def-opencode-view__status" role="alert">
            DEF OpenCode 服务未就绪。请确认本地 Agent sidecar 已启动。
          </div>
        ) : session ? (
          <iframe
            key={`${origin}:${session.id}`}
            className="def-opencode-view__frame"
            src={frameSrc}
            title={`${title} OpenCode`}
            allow="clipboard-read; clipboard-write"
          />
        ) : null}
        {status === 'checking' ? <div className="def-opencode-view__loading">正在连接 OpenCode…</div> : null}
      </div>
    </section>
  );
}
