import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import ReactMarkdown from 'react-markdown';
import {
  DEF_AGENT_IN_MEMORY_LIMITS,
  type AgentProductSession,
} from '../../../agent/core/contracts/browser-protocol.ts';
import {
  asClientTurnId,
  type ClientTurnId,
  type DefSessionId,
} from '../../../agent/core/contracts/ids.ts';
import type { ProductBinding } from '../../../agent/core/contracts/product.ts';
import {
  createDesktopAgentBridge,
  createDesktopAgentConsumerController,
  type AgentConsumerControllerDocument,
  type AgentWorkspaceLease,
  type DesktopAgentBridge,
  type DesktopAgentBridgeState,
  type DesktopAgentConsumerController,
  type DesktopAgentConsumerSnapshot,
} from '../../platform/agent/desktopAgentBridge';
import {
  AgentEventPoller,
  type AgentEventPollerSnapshot,
} from '../../platform/agent/agentEventPoller';
import { workspaceLease } from '../../platform/runtime/workspaceLease';
import {
  findActiveAgentTurn,
  projectAgentTranscript,
  type AgentToolView,
  type AgentTurnStatus,
} from './agentModeModel';
import './AgentModeOverlay.css';

const EMPTY_BINDING = (): ProductBinding | null => null;

export interface AgentModeOverlayProps {
  readonly bridge?: DesktopAgentBridge;
  readonly consumerController?: DesktopAgentConsumerController;
  readonly workspaceLease?: AgentWorkspaceLease;
  readonly document?: AgentConsumerControllerDocument;
  readonly getBinding?: () => ProductBinding | null;
  readonly className?: string;
}

const INITIAL_BRIDGE_STATE: DesktopAgentBridgeState = {
  route: false,
  authorization: 'pending',
  host: 'pending',
  engine: null,
  error: null,
};

const INITIAL_POLLER_STATE: AgentEventPollerSnapshot = {
  defSessionId: null,
  cursor: 0,
  events: [],
  status: 'idle',
  error: null,
};

type BusyAction = 'create' | 'send' | 'abort' | null;

interface PendingTurnRetry {
  readonly defSessionId: DefSessionId;
  readonly clientTurnId: ClientTurnId;
  readonly userMessage: string;
}

function makeClientTurnId(): ClientTurnId {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return asClientTurnId(`client-turn-${crypto.randomUUID()}`);
  }
  return asClientTurnId(`client-turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
}

function userFacingAgentError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  if (code === 'AGENT_SESSION_LIMIT_REACHED') {
    return `本次 Agent Host 最多保留 ${DEF_AGENT_IN_MEMORY_LIMITS.maxSessionsPerHost} 个会话；重启桌面端可开始新的临时会话。`;
  }
  if (code === 'AGENT_SESSION_TURN_LIMIT_REACHED') {
    return `当前会话已达到 ${DEF_AGENT_IN_MEMORY_LIMITS.maxTurnsPerSession} 轮，请新建会话继续。`;
  }
  if (code === 'AGENT_EVENT_CAPACITY_REACHED') {
    return '当前会话的临时事件记录已满；现有记录仍完整保留，请新建会话继续。';
  }
  if (code === 'AGENT_TURN_OUTPUT_LIMIT') {
    return '本轮输出过长，已安全停止；当前会话仍可继续发送下一条消息。';
  }
  if (code === 'AGENT_COMMAND_CAPACITY_REACHED') {
    return '本次 Agent Host 的浏览器指令记录已满，请重启桌面端后继续。';
  }
  return error instanceof Error ? error.message : String(error);
}

function sessionLabel(session: AgentProductSession, index: number): string {
  const timestamp = session.createdAt.replace('T', ' ').slice(5, 16);
  return `会话 ${index + 1}${timestamp ? ` · ${timestamp}` : ''}`;
}

function terminalLabel(status: AgentTurnStatus): string {
  const labels: Record<AgentTurnStatus, string> = {
    running: '运行中',
    completed: '已完成',
    stopped: '已停止',
    failed: '失败',
    interrupted: '已中断',
  };
  return labels[status];
}

function toolStatusLabel(tool: AgentToolView): string {
  if (tool.status === 'requested') return '等待执行';
  if (tool.status === 'running') return '执行中';
  if (tool.status === 'succeeded') return '已完成';
  return '失败';
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function compactId(value: string | null): string {
  if (!value) return '当前排轴';
  return value.length > 20 ? `${value.slice(0, 9)}…${value.slice(-7)}` : value;
}

function ToolCard({ tool }: { tool: AgentToolView }) {
  return (
    <article className="agent-mode-tool" data-status={tool.status}>
      <div className="agent-mode-tool-summary">
        <span className="agent-mode-tool-mark" aria-hidden="true">⌁</span>
        <strong>{tool.name}</strong>
        <span>{toolStatusLabel(tool)}</span>
      </div>
      {(tool.input !== null || tool.result !== undefined || tool.message) && (
        <details>
          <summary>查看过程</summary>
          {tool.input !== null && (
            <div>
              <small>输入</small>
              <pre>{formatJson(tool.input)}</pre>
            </div>
          )}
          {tool.result !== undefined && (
            <div>
              <small>结果</small>
              <pre>{formatJson(tool.result)}</pre>
            </div>
          )}
          {tool.message && <p className="agent-mode-tool-error">{tool.code ? `${tool.code}：` : ''}{tool.message}</p>}
        </details>
      )}
    </article>
  );
}

export function AgentModeOverlay({
  bridge: injectedBridge,
  consumerController: injectedConsumerController,
  workspaceLease: injectedWorkspaceLease,
  document: injectedDocument,
  getBinding: injectedGetBinding,
  className,
}: AgentModeOverlayProps) {
  const bridge = useMemo(
    () => injectedBridge || createDesktopAgentBridge(),
    [injectedBridge],
  );
  const lease = injectedWorkspaceLease || workspaceLease;
  const getBinding = injectedGetBinding || EMPTY_BINDING;
  const ownedConsumerController = useMemo<DesktopAgentConsumerController>(
    () => createDesktopAgentConsumerController({
      bridge,
      workspaceLease: lease,
      document: injectedDocument,
      getBinding,
    }),
    [bridge, injectedDocument, getBinding, lease],
  );
  const consumerController = injectedConsumerController || ownedConsumerController;
  const managesConsumerLifecycle = !injectedConsumerController;
  const poller = useMemo(() => new AgentEventPoller({ reader: bridge }), [bridge]);
  const pendingRetryRef = useRef<PendingTurnRetry | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const [bridgeState, setBridgeState] = useState<DesktopAgentBridgeState>(
    () => bridge.getState() || INITIAL_BRIDGE_STATE,
  );
  const [consumerState, setConsumerState] = useState<DesktopAgentConsumerSnapshot>(
    () => consumerController.getState(),
  );
  const [pollerState, setPollerState] = useState<AgentEventPollerSnapshot>(
    () => poller.getState() || INITIAL_POLLER_STATE,
  );
  const [sessions, setSessions] = useState<readonly AgentProductSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<DefSessionId | null>(null);
  const [input, setInput] = useState('');
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let active = true;
    const unsubscribeBridge = bridge.subscribe((state) => {
      if (active) setBridgeState(state);
    });
    const unsubscribeConsumer = consumerController.subscribe((state) => {
      if (active) setConsumerState(state);
    });
    const initialize = async () => {
      await bridge.initialize();
      if (active && managesConsumerLifecycle) await consumerController.start();
    };
    void initialize();
    const refreshHandle = typeof window === 'undefined'
      ? null
      : window.setInterval(() => {
        void bridge.refreshHostState().catch(() => undefined);
        if (bridge.getSessionCapability()) void bridge.refreshUiState().catch(() => undefined);
      }, 5_000);
    return () => {
      active = false;
      unsubscribeBridge();
      unsubscribeConsumer();
      if (refreshHandle !== null) window.clearInterval(refreshHandle);
      if (managesConsumerLifecycle) void consumerController.stop();
    };
  }, [bridge, consumerController, managesConsumerLifecycle]);

  useEffect(() => poller.subscribe(setPollerState), [poller]);

  const productReady = bridgeState.authorization === 'authorized'
    && bridgeState.host === 'ready'
    && bridgeState.engine?.state === 'ready'
    && consumerState.state === 'registered'
    && Boolean(consumerState.consumer);
  const binding = consumerState.consumer?.binding || null;
  const bindingKey = binding
    ? `${binding.workspaceId}:${binding.databaseGeneration}:${binding.timelineId}`
    : '';

  useEffect(() => {
    let active = true;
    if (!productReady || !bindingKey) return () => { active = false; };
    setLoadingSessions(true);
    setOperationError(null);
    void bridge.listSessions()
      .then((nextSessions) => {
        if (!active) return;
        setSessions(nextSessions);
        setActiveSessionId((current) => (
          current && nextSessions.some((session) => session.defSessionId === current)
            ? current
            : nextSessions[0]?.defSessionId || null
        ));
      })
      .catch((error: unknown) => {
        if (active) setOperationError(userFacingAgentError(error));
      })
      .finally(() => {
        if (active) setLoadingSessions(false);
      });
    return () => { active = false; };
  }, [bindingKey, bridge, productReady]);

  useEffect(() => {
    poller.setSession(activeSessionId);
  }, [activeSessionId, poller]);

  useEffect(() => {
    const currentDocument = injectedDocument || (typeof document === 'undefined' ? null : document);
    const synchronize = () => {
      if (
        productReady
        && activeSessionId
        && (!currentDocument || currentDocument.visibilityState === 'visible')
      ) poller.start();
      else poller.stop();
    };
    synchronize();
    currentDocument?.addEventListener('visibilitychange', synchronize);
    return () => {
      currentDocument?.removeEventListener('visibilitychange', synchronize);
      poller.stop();
    };
  }, [activeSessionId, injectedDocument, poller, productReady]);

  const transcriptProjection = useMemo(() => {
    try {
      return { turns: projectAgentTranscript(pollerState.events), error: null as string | null };
    } catch (error) {
      return {
        turns: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [pollerState.events]);
  const activeTurn = findActiveAgentTurn(transcriptProjection.turns);

  useEffect(() => {
    const retry = pendingRetryRef.current;
    if (!retry) return;
    const accepted = transcriptProjection.turns.some((turn) => turn.clientTurnId === retry.clientTurnId);
    if (!accepted) return;
    pendingRetryRef.current = null;
    setInput((current) => current.trim() === retry.userMessage ? '' : current);
  }, [transcriptProjection.turns]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ block: 'end' });
  }, [pollerState.cursor]);

  const handleCreateSession = async () => {
    if (!productReady || busyAction) return;
    setBusyAction('create');
    setOperationError(null);
    try {
      const session = await bridge.createSession();
      setSessions((current) => [session, ...current.filter((item) => item.defSessionId !== session.defSessionId)]);
      setActiveSessionId(session.defSessionId);
    } catch (error) {
      setOperationError(userFacingAgentError(error));
    } finally {
      setBusyAction(null);
    }
  };

  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault();
    const userMessage = input.trim();
    if (!activeSessionId || !userMessage || activeTurn || busyAction || !productReady) return;
    const pending = pendingRetryRef.current;
    const retry = pending
      && pending.defSessionId === activeSessionId
      && pending.userMessage === userMessage
      ? pending
      : {
        defSessionId: activeSessionId,
        clientTurnId: makeClientTurnId(),
        userMessage,
      };
    pendingRetryRef.current = retry;
    setBusyAction('send');
    setOperationError(null);
    try {
      await bridge.startTurn(activeSessionId, {
        clientTurnId: retry.clientTurnId,
        userMessage,
      });
      pendingRetryRef.current = null;
      setInput('');
      await poller.refresh();
    } catch (error) {
      setOperationError(userFacingAgentError(error));
    } finally {
      setBusyAction(null);
    }
  };

  const handleAbort = async () => {
    if (!activeTurn || busyAction) return;
    setBusyAction('abort');
    setOperationError(null);
    try {
      await bridge.abortTurn(activeTurn.defTurnId);
      await poller.refresh();
    } catch (error) {
      setOperationError(userFacingAgentError(error));
    } finally {
      setBusyAction(null);
    }
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void handleSubmit();
  };

  const rootClassName = [
    'agent-mode-overlay',
    collapsed ? 'is-collapsed' : '',
    className,
  ].filter(Boolean).join(' ');
  const readinessMessage = bridgeState.authorization !== 'authorized'
    ? '请从桌面 Shell 重新打开 AI 模式。'
    : bridgeState.host !== 'ready'
      ? 'Agent Host 尚未就绪。'
      : bridgeState.engine?.state !== 'ready'
        ? bridgeState.engine?.reason || 'Agent 引擎尚未就绪。'
        : consumerState.state !== 'registered'
          ? consumerState.error || '正在等待当前工作区成为可见 writer。'
          : null;

  if (collapsed) {
    return (
      <aside className={rootClassName} aria-label="AI 模式">
        <button
          type="button"
          className="agent-mode-expand-button"
          onClick={() => setCollapsed(false)}
          aria-expanded="false"
          title="展开 AI 模式"
        >
          <span>AI</span>
          <i data-ready={productReady ? 'true' : 'false'} />
        </button>
      </aside>
    );
  }

  return (
    <aside className={rootClassName} aria-label="AI 模式">
      <header className="agent-mode-header">
        <div className="agent-mode-title">
          <span className="agent-mode-logo" aria-hidden="true">AI</span>
          <div>
            <p>DEF AGENT</p>
            <h1>AI 模式</h1>
          </div>
        </div>
        <div className="agent-mode-header-actions">
          <span className="agent-mode-readiness" data-ready={productReady ? 'true' : 'false'}>
            {productReady ? '已就绪' : '未就绪'}
          </span>
          <button type="button" onClick={() => setCollapsed(true)} aria-label="收起 AI 模式">›</button>
        </div>
      </header>

      <section className="agent-mode-context" aria-label="当前 Agent 上下文">
        <div className="agent-mode-binding">
          <span>Timeline</span>
          <strong title={binding?.timelineId || ''}>{binding ? compactId(binding.timelineId) : '等待工作区'}</strong>
          <small title={binding?.checkoutTargetId || ''}>{binding ? compactId(binding.checkoutTargetId) : '—'}</small>
        </div>
        <div className="agent-mode-session-controls">
          <select
            value={activeSessionId || ''}
            onChange={(event) => {
              const selected = sessions.find((session) => session.defSessionId === event.target.value);
              setActiveSessionId(selected?.defSessionId || null);
              setOperationError(null);
            }}
            disabled={!sessions.length || loadingSessions || Boolean(busyAction) || Boolean(activeTurn)}
            aria-label="当前 AI 会话"
          >
            {!sessions.length && <option value="">{loadingSessions ? '读取会话…' : '尚无会话'}</option>}
            {sessions.map((session, index) => (
              <option key={session.defSessionId} value={session.defSessionId}>{sessionLabel(session, index)}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void handleCreateSession()}
            disabled={!productReady || Boolean(busyAction) || Boolean(activeTurn)}
          >
            {busyAction === 'create' ? '创建中…' : '新建'}
          </button>
        </div>
      </section>

      <main className="agent-mode-transcript" aria-live="polite">
        {readinessMessage && (
          <div className="agent-mode-empty" data-tone="warn">
            <strong>AI 模式还不能开始</strong>
            <p>{readinessMessage}</p>
          </div>
        )}
        {!readinessMessage && !activeSessionId && (
          <div className="agent-mode-empty">
            <strong>建立第一段会话</strong>
            <p>会话会绑定当前 Timeline；消息与工具过程只从 DEF Event Journal 重建。</p>
            <button type="button" onClick={() => void handleCreateSession()} disabled={Boolean(busyAction)}>
              新建会话
            </button>
          </div>
        )}
        {!readinessMessage && activeSessionId && !transcriptProjection.turns.length && pollerState.status !== 'error' && (
          <div className="agent-mode-empty">
            <strong>可以开始了</strong>
            <p>直接询问当前工作区中的干员、装备、Buff 或伤害计算。</p>
          </div>
        )}
        {transcriptProjection.turns.map((turn) => (
          <section className="agent-mode-turn" key={turn.defTurnId} data-status={turn.status}>
            {turn.userMessage && <p className="agent-mode-user-message">{turn.userMessage}</p>}
            {turn.tools.length > 0 && (
              <div className="agent-mode-tools">
                {turn.tools.map((tool) => <ToolCard key={tool.toolCallId} tool={tool} />)}
              </div>
            )}
            {turn.assistantText && (
              <div className="agent-mode-assistant-message">
                <ReactMarkdown>{turn.assistantText}</ReactMarkdown>
              </div>
            )}
            {turn.status === 'running' && !turn.assistantText && !turn.tools.length && (
              <p className="agent-mode-thinking"><span />正在思考</p>
            )}
            {turn.status !== 'running' && (
              <div className="agent-mode-terminal" data-status={turn.status}>
                <span>{terminalLabel(turn.status)}</span>
                {turn.terminalMessage && <p>{turn.terminalMessage}</p>}
              </div>
            )}
          </section>
        ))}
        {(operationError || bridgeState.error || consumerState.error || pollerState.error || transcriptProjection.error) && (
          <div className="agent-mode-error" role="status">
            {operationError || pollerState.error || transcriptProjection.error || consumerState.error || bridgeState.error}
          </div>
        )}
        <div ref={transcriptEndRef} />
      </main>

      <form className="agent-mode-composer" onSubmit={(event) => void handleSubmit(event)}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={activeSessionId ? '询问当前工作区…' : '请先新建会话'}
          maxLength={16_000}
          rows={3}
          disabled={!productReady || !activeSessionId || Boolean(activeTurn)}
          aria-label="发送给 DEF Agent 的消息"
        />
        <div className="agent-mode-composer-footer">
          <small>{input.length.toLocaleString()} / 16,000</small>
          {activeTurn ? (
            <button
              type="button"
              className="agent-mode-stop-button"
              onClick={() => void handleAbort()}
              disabled={Boolean(busyAction)}
            >
              {busyAction === 'abort' ? '停止中…' : '停止'}
            </button>
          ) : (
            <button
              type="submit"
              disabled={!productReady || !activeSessionId || !input.trim() || Boolean(busyAction)}
            >
              {busyAction === 'send' ? '发送中…' : pendingRetryRef.current ? '重试发送' : '发送'}
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}
