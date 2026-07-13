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
  const consumerIdRef = useRef<string>('');
  const renderSecretRef = useRef<string>('');
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const frameLoadedRef = useRef(false);
  const bridgeReadyRef = useRef(false);
  const pendingRenderRef = useRef<Array<{ sessionId: string; turnId: string }>>([]);
  const renderNonceRef = useRef<Map<string, string>>(new Map());
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
    const consumerId = consumerIdRef.current || crypto.randomUUID();
    const renderSecret = renderSecretRef.current || crypto.randomUUID();
    consumerIdRef.current = consumerId;
    renderSecretRef.current = renderSecret;
    const url = new URL(session.uiPath, origin);
    url.searchParams.set('def_host', host);
    if (host === 'workbench') {
      url.searchParams.set('def_interop_consumer', consumerId);
      url.searchParams.set('def_interop_render_secret', renderSecret);
    }
    return url.toString();
  }, [host, origin, session]);

  const requestRenderedCheck = async (consumerId: string, sessionId: string, turnId: string) => {
    const targetResponse = await fetch(`${INTEROP_BASE_URL}/ui/render-target`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ consumerId, renderSecret: renderSecretRef.current, sessionId, turnId }),
    });
    if (!targetResponse.ok) return;
    const target = await targetResponse.json() as { rawUserText?: string; renderNonce?: string };
    if (!target.renderNonce) return;
    renderNonceRef.current.set(turnId, target.renderNonce);
    const frame = frameRef.current;
    if (!frame?.contentWindow || !frameLoadedRef.current || !bridgeReadyRef.current) {
      if (!pendingRenderRef.current.some((item) => item.sessionId === sessionId && item.turnId === turnId)) {
        pendingRenderRef.current.push({ sessionId, turnId });
      }
      if (frame?.contentWindow && frameLoadedRef.current) {
        frame.contentWindow.postMessage({ type: 'def-opencode-interop-probe', protocolVersion: 1, sessionId }, origin);
      }
      return;
    }
    frame.contentWindow.postMessage({
      type: 'def-opencode-interop-await-render',
      protocolVersion: 1,
      sessionId,
      turnId,
      rawUserText: target.rawUserText,
      renderNonce: target.renderNonce,
    }, origin);
  };

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
    frameLoadedRef.current = false;
    bridgeReadyRef.current = false;
    const consumerId = consumerIdRef.current || crypto.randomUUID();
    const renderSecret = renderSecretRef.current || crypto.randomUUID();
    consumerIdRef.current = consumerId;
    renderSecretRef.current = renderSecret;
    const controller = new AbortController();
    void fetch(`${INTEROP_BASE_URL}/ui/consumer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ consumerId, renderSecret, host, sessionId: session.id, directory: session.directory }),
      signal: controller.signal,
    }).catch(() => undefined);

    const events = new EventSource(`${INTEROP_BASE_URL}/ui-events`);
    const rendered = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as { sessionId?: string; turnId?: string };
      if (payload.sessionId !== session.id || !payload.turnId) return;
      void requestRenderedCheck(consumerId, session.id, payload.turnId).catch(() => undefined);
    };
    events.addEventListener('ui-prompt-consumed', rendered);
    return () => {
      controller.abort();
      void fetch(`${INTEROP_BASE_URL}/ui/consumer/close`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ consumerId, sessionId: session.id }),
      }).catch(() => undefined);
      events.removeEventListener('ui-prompt-consumed', rendered);
      events.close();
    };
  }, [host, origin, session]);

  useEffect(() => {
    if (host !== 'workbench' || !session) return;
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== origin || event.source !== frameRef.current?.contentWindow) return;
      const payload = event.data as { type?: string; protocolVersion?: number; sessionId?: string; turnId?: string; renderNonce?: string };
      if (payload?.protocolVersion !== 1 || payload.sessionId !== session.id) return;
      if (payload.type === 'def-opencode-interop-ready') {
        bridgeReadyRef.current = true;
        frameRef.current?.contentWindow?.postMessage({
          type: 'def-opencode-interop-ready-ack',
          protocolVersion: 1,
          sessionId: session.id,
        }, origin);
        const pending = pendingRenderRef.current.splice(0);
        for (const item of pending) {
          if (item.sessionId !== session.id) continue;
          void requestRenderedCheck(consumerIdRef.current, item.sessionId, item.turnId).catch(() => undefined);
        }
        return;
      }
      if (payload.type !== 'def-opencode-interop-rendered' || !payload.turnId || renderNonceRef.current.get(payload.turnId) !== payload.renderNonce) return;
      renderNonceRef.current.delete(payload.turnId);
      void fetch(`${INTEROP_BASE_URL}/ui/rendered`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ consumerId: consumerIdRef.current, renderSecret: renderSecretRef.current, renderNonce: payload.renderNonce, sessionId: session.id, turnId: payload.turnId, surface: 'native-iframe', target: 'user-message' }),
      }).catch(() => undefined);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
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
            ref={frameRef}
            key={`${origin}:${session.id}`}
            className="def-opencode-view__frame"
            src={frameSrc}
            title={`${title} OpenCode`}
            allow="clipboard-read; clipboard-write"
            onLoad={() => {
              const frame = frameRef.current;
              if (!frame?.contentWindow) return;
              frameLoadedRef.current = true;
              // A load event only proves that the native document loaded.  The
              // render bridge is ready solely after the injected script replies
              // to this probe; otherwise a missing injection can be mistaken
              // for a rendered user message.
              bridgeReadyRef.current = false;
              frame.contentWindow.postMessage({ type: 'def-opencode-interop-probe', protocolVersion: 1, sessionId: session.id }, origin);
            }}
          />
        ) : null}
        {status === 'checking' ? <div className="def-opencode-view__loading">正在连接 OpenCode…</div> : null}
      </div>
    </section>
  );
}
