import { useEffect, useMemo, useState } from 'react';
import './DefOpenCodeView.css';

export type DefOpenCodeHost = 'workbench' | 'ai-cli';

type NativeSession = {
  id: string;
  uiPath: string;
  host: DefOpenCodeHost;
};

interface DefOpenCodeViewProps {
  host: DefOpenCodeHost;
  title: string;
  onClose?: () => void;
  onOpenWorkNodePanel?: () => void;
}

const SIDECAR_PORT = 17322;

export function DefOpenCodeView({
  host,
  title,
  onClose,
  onOpenWorkNodePanel,
}: DefOpenCodeViewProps) {
  const [status, setStatus] = useState<'checking' | 'ready' | 'error'>('checking');
  const [session, setSession] = useState<NativeSession | null>(null);
  const origin = useMemo(() => (
    host === 'workbench'
      ? `http://127.0.0.1:${SIDECAR_PORT}`
      : `http://localhost:${SIDECAR_PORT}`
  ), [host]);

  const storageKey = `def-opencode.native-session.${host}.v1`;

  const createSession = async () => {
    setStatus('checking');
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

  useEffect(() => {
    let disposed = false;
    const bootstrap = async () => {
      const ensureResponse = await fetch(`${origin}/api/runtime/ensure`, { method: 'POST' });
      if (!ensureResponse.ok) throw new Error(`HTTP ${ensureResponse.status}`);
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as NativeSession;
        if (parsed?.id && parsed.uiPath && parsed.host === host) {
          if (!disposed) {
            setSession(parsed);
            setStatus('ready');
          }
          return;
        }
      }
      const response = await fetch(`${origin}/api/native/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ host }),
      });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as { ok?: boolean; session?: NativeSession };
      if (!payload.ok || !payload.session?.id || !payload.session.uiPath) throw new Error('Invalid native session response');
      window.localStorage.setItem(storageKey, JSON.stringify(payload.session));
      if (!disposed) {
        setSession(payload.session);
        setStatus('ready');
      }
    };
    bootstrap().catch(() => { if (!disposed) setStatus('error'); });
    return () => { disposed = true; };
  }, [host, origin, storageKey]);

  return (
    <section className={`def-opencode-view def-opencode-view--${host}`} data-def-opencode-host={host}>
      <header className="def-opencode-view__header">
        <div>
          <strong>{title}</strong>
          <span>OpenCode 1.17.11 · {host === 'workbench' ? '节点修改会话' : '数据资源会话'}</span>
        </div>
        <nav aria-label="DEF OpenCode controls">
          <button type="button" onClick={() => void createSession().catch(() => setStatus('error'))}>新建会话</button>
          {onOpenWorkNodePanel ? <button type="button" onClick={onOpenWorkNodePanel}>工作节点</button> : null}
          {onClose ? <button type="button" onClick={onClose}>返回</button> : null}
        </nav>
      </header>
      <div className="def-opencode-view__body">
        {status === 'error' ? (
          <div className="def-opencode-view__status" role="alert">
            DEF OpenCode 服务未就绪。请确认本地 Agent sidecar 已启动。
          </div>
        ) : session ? (
          <iframe
            key={`${origin}:${session.id}`}
            className="def-opencode-view__frame"
            src={`${origin}${session.uiPath}`}
            title={`${title} OpenCode`}
            allow="clipboard-read; clipboard-write"
          />
        ) : null}
        {status === 'checking' ? <div className="def-opencode-view__loading">正在连接 OpenCode…</div> : null}
      </div>
    </section>
  );
}
