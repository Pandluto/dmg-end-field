import { useEffect, useMemo, useState } from 'react';
import './DefOpenCodeView.css';

export type DefOpenCodeHost = 'workbench' | 'ai-cli';

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
  const origin = useMemo(() => (
    host === 'workbench'
      ? `http://127.0.0.1:${SIDECAR_PORT}`
      : `http://localhost:${SIDECAR_PORT}`
  ), [host]);

  useEffect(() => {
    let disposed = false;
    fetch(`${origin}/health`, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!disposed) setStatus('ready');
      })
      .catch(() => {
        if (!disposed) setStatus('error');
      });
    return () => { disposed = true; };
  }, [origin]);

  return (
    <section className={`def-opencode-view def-opencode-view--${host}`} data-def-opencode-host={host}>
      <header className="def-opencode-view__header">
        <div>
          <strong>{title}</strong>
          <span>OpenCode 1.17.11 · {host === 'workbench' ? '节点修改会话' : '数据资源会话'}</span>
        </div>
        <nav aria-label="DEF OpenCode controls">
          {onOpenWorkNodePanel ? <button type="button" onClick={onOpenWorkNodePanel}>工作节点</button> : null}
          {onClose ? <button type="button" onClick={onClose}>返回</button> : null}
        </nav>
      </header>
      <div className="def-opencode-view__body">
        {status === 'error' ? (
          <div className="def-opencode-view__status" role="alert">
            DEF OpenCode 服务未就绪。请确认本地 Agent sidecar 已启动。
          </div>
        ) : (
          <iframe
            key={origin}
            className="def-opencode-view__frame"
            src={`${origin}/`}
            title={`${title} OpenCode`}
            allow="clipboard-read; clipboard-write"
          />
        )}
        {status === 'checking' ? <div className="def-opencode-view__loading">正在连接 OpenCode…</div> : null}
      </div>
    </section>
  );
}
