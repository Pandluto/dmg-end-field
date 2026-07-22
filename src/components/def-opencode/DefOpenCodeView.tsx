import { useEffect, useMemo, useRef, useState } from 'react';
import './DefOpenCodeView.css';

export type DefOpenCodeHost = 'workbench' | 'ai-cli';

type NativeSession = {
  id: string;
  uiPath: string;
  host: DefOpenCodeHost;
  directory: string;
  timelineId?: string;
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

type NativeSessionCleanupResult = {
  ok: boolean;
  host: 'ai-cli';
  keptSessionID: string;
  targetCount: number;
  deletedCount: number;
  alreadyDeletedCount: number;
  failed: Array<{ sessionID: string; code: string; httpStatus?: number }>;
};

interface DefOpenCodeViewProps {
  host: DefOpenCodeHost;
  title: string;
  onClose?: () => void;
  workbenchContext?: Record<string, unknown>;
  timelineId?: string;
  workbenchIsTemporary?: boolean;
}

const SIDECAR_PORT = 17322;
const SIDECAR_BOOTSTRAP_URL = 'http://127.0.0.1:31457/open-def-agent';
const INTEROP_BASE_URL = 'http://127.0.0.1:31457/def-agent/interop/v1';

export function DefOpenCodeView({
  host,
  title,
  onClose,
  workbenchContext,
  timelineId,
  workbenchIsTemporary = false,
}: DefOpenCodeViewProps) {
  const [status, setStatus] = useState<'checking' | 'ready' | 'blocked' | 'error'>('checking');
  const [statusError, setStatusError] = useState('');
  const [session, setSession] = useState<NativeSession | null>(null);
  const [frameRevision, setFrameRevision] = useState(0);
  const [cleanupInProgress, setCleanupInProgress] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{ kind: 'success' | 'partial' | 'error'; message: string } | null>(null);
  const mountedRef = useRef(true);
  const cleanupAbortRef = useRef<AbortController | null>(null);
  const origin = useMemo(() => (
    host === 'workbench'
      ? `http://127.0.0.1:${SIDECAR_PORT}`
      : `http://localhost:${SIDECAR_PORT}`
  ), [host]);
  const developmentHarnessSelector = useMemo(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return '';
    return new URL(window.location.href).searchParams.get('__defHarnessSelector')?.trim() || '';
  }, []);

  const normalizedTimelineId = typeof timelineId === 'string' ? timelineId.trim() : '';
  const storageKey = `def-opencode.native-session.${host}${host === 'workbench' ? `.${encodeURIComponent(normalizedTimelineId)}` : ''}${developmentHarnessSelector ? `.${encodeURIComponent(developmentHarnessSelector)}` : ''}.v2`;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanupAbortRef.current?.abort();
      cleanupAbortRef.current = null;
    };
  }, []);

  const ensureNativeSidecar = async () => {
    const response = await fetch(SIDECAR_BOOTSTRAP_URL, { method: 'POST' });
    if (!response.ok) throw new Error(`Sidecar bootstrap failed: HTTP ${response.status}`);
    const payload = await response.json() as {
      ok?: boolean;
      defAgent?: { ready?: boolean; running?: boolean; error?: string };
    };
    if (!payload.ok || payload.defAgent?.ready === false || payload.defAgent?.running === false) {
      throw new Error(payload.defAgent?.error || 'DEF OpenCode sidecar failed to start.');
    }
  };

  const sessionExists = async (candidate: NativeSession) => {
    if (!candidate.directory || (host === 'workbench' && candidate.timelineId !== normalizedTimelineId)) return false;
    const response = await fetch(
      `${origin}/api/native/bootstrap?sessionID=${encodeURIComponent(candidate.id)}&directory=${encodeURIComponent(candidate.directory)}`,
      { headers: { accept: 'application/json' } },
    );
    if (!response.ok) return false;
    const payload = await response.json() as { ok?: boolean };
    return payload.ok === true;
  };

  const createNativeSession = async () => {
    await ensureNativeSidecar();
    const response = await fetch(`${origin}/api/native/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        host,
        ...(host === 'workbench' ? { timelineId: normalizedTimelineId } : {}),
        ...(developmentHarnessSelector ? { harnessSelector: developmentHarnessSelector } : {}),
      }),
    });
    const payload = await response.json().catch(() => null) as {
      ok?: boolean;
      session?: NativeSession;
      error?: string | { message?: string; code?: string };
    } | null;
    if (!response.ok) {
      const detail = typeof payload?.error === 'string'
        ? payload.error
        : payload?.error?.message || payload?.error?.code || '';
      throw new Error(detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`);
    }
    if (!payload?.ok || !payload.session?.id || !payload.session.uiPath || (host === 'workbench' && payload.session.timelineId !== normalizedTimelineId)) throw new Error('Invalid native session response');
    // The native session already exists once this response succeeds. A full
    // browser cache must not discard that live session or make the AI panel
    // look offline merely because its optional recovery handle cannot persist.
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(payload.session));
    } catch (error) {
      console.warn('[DefOpenCodeView] native session recovery cache unavailable:', error);
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify(payload.session));
      } catch (sessionError) {
        console.warn('[DefOpenCodeView] tab session recovery cache unavailable:', sessionError);
      }
    }
    setSession(payload.session);
    setCleanupResult(null);
    setStatusError('');
    setStatus('ready');
  };

  const cleanupSessionHistory = async () => {
    if (host !== 'ai-cli' || !session || cleanupInProgress || cleanupAbortRef.current) return;
    const confirmed = window.confirm('旧的 DEF Shell 会话将被永久删除，无法恢复。当前会话会保留。是否继续？');
    if (!confirmed) return;
    const controller = new AbortController();
    cleanupAbortRef.current = controller;
    setCleanupInProgress(true);
    setCleanupResult(null);
    try {
      const response = await fetch(`${origin}/api/native/sessions/cleanup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ host: 'ai-cli', keepSessionID: session.id }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as (NativeSessionCleanupResult & { error?: string }) | null;
      if (!mountedRef.current || controller.signal.aborted) return;
      if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
      if (
        !payload
        || payload.host !== 'ai-cli'
        || payload.keptSessionID !== session.id
        || !Number.isInteger(payload.targetCount)
        || !Number.isInteger(payload.deletedCount)
        || !Number.isInteger(payload.alreadyDeletedCount)
        || !Array.isArray(payload.failed)
      ) throw new Error('Invalid native session cleanup response');
      const failedCount = payload.failed.length;
      setCleanupResult({
        kind: payload.ok && failedCount === 0 ? 'success' : 'partial',
        message: `${payload.ok && failedCount === 0 ? '清理完成' : '清理未完全完成'}：已删除 ${payload.deletedCount}，已不存在 ${payload.alreadyDeletedCount}，失败 ${failedCount}。`,
      });
      setFrameRevision((revision) => revision + 1);
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted) return;
      setCleanupResult({
        kind: 'error',
        message: `清理失败：${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      if (cleanupAbortRef.current === controller) cleanupAbortRef.current = null;
      if (mountedRef.current && !controller.signal.aborted) setCleanupInProgress(false);
    }
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
      if (host === 'workbench' && (workbenchIsTemporary || !normalizedTimelineId)) {
        if (!disposed) {
          setSession(null);
          setStatus('blocked');
        }
        return;
      }
      await ensureNativeSidecar();
      const ensureResponse = await fetch(`${origin}/api/runtime/ensure`, { method: 'POST' });
      const ensurePayload = await ensureResponse.json().catch(() => null) as { error?: string } | null;
      if (!ensureResponse.ok) {
        throw new Error(ensurePayload?.error ? `HTTP ${ensureResponse.status}: ${ensurePayload.error}` : `HTTP ${ensureResponse.status}`);
      }
      const stored = window.localStorage.getItem(storageKey) || window.sessionStorage.getItem(storageKey);
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
        window.sessionStorage.removeItem(storageKey);
      }
      if (!disposed) await createNativeSession();
    };
    bootstrap().catch((error) => {
      if (!disposed) {
        setStatusError(error instanceof Error ? error.message : String(error));
        setStatus('error');
      }
    });
    return () => { disposed = true; };
  }, [host, normalizedTimelineId, origin, storageKey, workbenchIsTemporary]);

  useEffect(() => {
    if (host !== 'workbench' || !session || !workbenchContext || session.timelineId !== normalizedTimelineId) return;
    const controller = new AbortController();
    void fetch(`${origin}/api/native/context`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionID: session.id, directory: session.directory, context: workbenchContext }),
      signal: controller.signal,
    }).catch(() => undefined);
    return () => controller.abort();
  }, [host, normalizedTimelineId, origin, session, workbenchContext]);

  useEffect(() => {
    if (host !== 'workbench' || !session || session.timelineId !== normalizedTimelineId) return;
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
  }, [host, normalizedTimelineId, origin, session]);

  return (
    <section
      className={`def-opencode-view def-opencode-view--${host}`}
      data-def-opencode-host={host}
      data-def-opencode-session-id={session?.id || undefined}
    >
      {onClose ? (
        <nav className="def-opencode-view__nav" aria-label="DEF OpenCode navigation">
          <button type="button" disabled={cleanupInProgress} onClick={onClose}>返回</button>
          <button
            type="button"
            disabled={cleanupInProgress}
            onClick={() => {
              if (host === 'workbench' && (workbenchIsTemporary || !normalizedTimelineId)) {
                setStatus('blocked');
                return;
              }
              setStatus('checking');
              setStatusError('');
              void createNativeSession().catch((error) => {
                setStatusError(error instanceof Error ? error.message : String(error));
                setStatus('error');
              });
            }}
          >
            新建 DEF 会话
          </button>
          {host === 'ai-cli' ? (
            <button
              type="button"
              disabled={cleanupInProgress || !session}
              onClick={() => { void cleanupSessionHistory(); }}
            >
              {cleanupInProgress ? '正在清理…' : '清理会话记录'}
            </button>
          ) : null}
        </nav>
      ) : null}
      {cleanupResult ? (
        <div
          className="def-opencode-view__cleanup-result"
          data-kind={cleanupResult.kind}
          role={cleanupResult.kind === 'error' ? 'alert' : 'status'}
        >
          {cleanupResult.message}
        </div>
      ) : null}
      <div className="def-opencode-view__body">
        {status === 'error' ? (
          <div className="def-opencode-view__status" role="alert">
            DEF OpenCode 服务未就绪。{statusError || '请确认本地 Agent sidecar 已启动。'}
          </div>
        ) : status === 'blocked' ? (
          <div className="def-opencode-view__status" role="alert">
            当前 SQLite 工作区尚未完成首次保存/命名，暂不能进入 AI 模式。
          </div>
        ) : session ? (
          <iframe
            key={`${origin}:${session.id}:${frameRevision}`}
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
