import {
  useCallback,
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
import type { InteractionRequest } from '../../../agent/core/contracts/interaction.ts';
import {
  asClientTurnId,
  type ClientTurnId,
  type DefSessionId,
  type InteractionId,
} from '../../../agent/core/contracts/ids.ts';
import type { JsonValue } from '../../../agent/core/contracts/json.ts';
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
import { AGENT_SELECTION_WORKSPACE_TIMELINE_ID } from '../../platform/agent/browserAgentRuntime';
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
import { WorkNodeTreeIcon } from '../CanvasBoard/WorkNodeTreeIcon';
import './AgentModeOverlay.css';

const EMPTY_BINDING = (): ProductBinding | null => null;

export interface AgentModeOverlayProps {
  readonly bridge?: DesktopAgentBridge;
  readonly consumerController?: DesktopAgentConsumerController;
  readonly workspaceLease?: AgentWorkspaceLease;
  readonly document?: AgentConsumerControllerDocument;
  readonly getBinding?: () => ProductBinding | null;
  readonly className?: string;
  readonly embedded?: boolean;
  readonly onExit?: () => void;
  readonly onOpenWorkNodePanel?: () => void;
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

type BusyAction = 'create' | 'send' | 'abort' | 'archive' | 'restore' | 'delete' | null;

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
  const state = session.status === 'archived'
    ? ' · 已归档'
    : session.status === 'engine-unavailable'
      ? ' · 待恢复'
      : '';
  return `会话 ${index + 1}${timestamp ? ` · ${timestamp}` : ''}${state}`;
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

function SpinnerIcon() {
  return (
    <svg className="main-workbench-ai-inline-icon main-workbench-ai-spinner" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg className="main-workbench-ai-inline-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 4v5h-5" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg className="main-workbench-ai-inline-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4 20 12 4 20l2.8-8L4 4z" />
      <path d="M7 12h6" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="main-workbench-ai-inline-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 8h8v8H8z" />
    </svg>
  );
}

function NewChatIcon() {
  return (
    <svg className="main-workbench-ai-inline-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
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

type InteractionResponseAction = 'answered' | 'approved' | 'rejected' | 'cancelled';

interface InteractionCardProps {
  readonly interaction: InteractionRequest;
  readonly questionDraft: string;
  readonly busy: boolean;
  readonly onQuestionDraftChange: (interactionId: InteractionId, value: string) => void;
  readonly onRespond: (
    interactionId: InteractionId,
    status: InteractionResponseAction,
    value?: JsonValue,
  ) => void;
}

function InteractionCard({
  interaction,
  questionDraft,
  busy,
  onQuestionDraftChange,
  onRespond,
}: InteractionCardProps) {
  const interactionId = interaction.interactionId as InteractionId;
  const questionOptions = interaction.kind === 'question'
    && Array.isArray(interaction.details?.options)
    && interaction.details.options.every((option) => typeof option === 'string')
    ? interaction.details.options as string[]
    : [];
  return (
    <article className="main-workbench-ai-interaction" data-kind={interaction.kind}>
      <div className="main-workbench-ai-interaction-heading">
        <span className="main-workbench-ai-interaction-badge">
          {interaction.kind === 'question' ? '需要回答' : '需要确认'}
        </span>
        <span className="main-workbench-ai-interaction-id" title={interaction.interactionId}>
          {compactId(interaction.interactionId)}
        </span>
      </div>
      <p className="main-workbench-ai-interaction-prompt">{interaction.prompt}</p>

      {interaction.kind === 'question' && interaction.details && (
        <details className="main-workbench-ai-interaction-details">
          <summary>查看问题详情</summary>
          <pre>{formatJson(interaction.details)}</pre>
        </details>
      )}

      {interaction.kind === 'approval' && (
        <div className="main-workbench-ai-interaction-proposal">
          <div className="main-workbench-ai-interaction-scope">
            <small>变更范围</small>
            <div>
              {interaction.scope.map((scope) => (
                <span key={scope}>{scope}</span>
              ))}
            </div>
          </div>
          <details open>
            <summary>提案摘要</summary>
            <pre>{formatJson(interaction.proposal)}</pre>
          </details>
        </div>
      )}

      {interaction.kind === 'question' ? (
        <div className="main-workbench-ai-interaction-actions">
          {questionOptions.length > 0 && (
            <div className="main-workbench-ai-interaction-options" aria-label="可选回答">
              {questionOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onRespond(interactionId, 'answered', option)}
                  disabled={busy}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          <textarea
            value={questionDraft}
            onChange={(event) => onQuestionDraftChange(interactionId, event.target.value)}
            rows={2}
            maxLength={8_000}
            disabled={busy}
            placeholder="输入回答"
            aria-label="interaction 问题回答"
          />
          <div className="main-workbench-ai-interaction-buttons">
            <button
              type="button"
              onClick={() => onRespond(interactionId, 'answered', questionDraft)}
              disabled={busy || !questionDraft.trim()}
            >
              回答
            </button>
            <button
              type="button"
              className="is-muted"
              onClick={() => onRespond(interactionId, 'cancelled')}
              disabled={busy}
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <div className="main-workbench-ai-interaction-buttons">
          <button
            type="button"
            className="is-primary"
            onClick={() => onRespond(interactionId, 'approved')}
            disabled={busy}
          >
            批准
          </button>
          <button
            type="button"
            className="is-danger"
            onClick={() => onRespond(interactionId, 'rejected')}
            disabled={busy}
          >
            拒绝
          </button>
          <button
            type="button"
            className="is-muted"
            onClick={() => onRespond(interactionId, 'cancelled')}
            disabled={busy}
          >
            取消
          </button>
        </div>
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
  embedded = false,
  onExit,
  onOpenWorkNodePanel,
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
  const autoCreateBindingRef = useRef('');
  const currentBindingKeyRef = useRef('');
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
  const [loadedSessionBindingKey, setLoadedSessionBindingKey] = useState('');
  const [operationError, setOperationError] = useState<string | null>(null);
  const [interactions, setInteractions] = useState<readonly InteractionRequest[]>([]);
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, string>>({});
  const [interactionBusyId, setInteractionBusyId] = useState<InteractionId | null>(null);
  const [interactionError, setInteractionError] = useState<string | null>(null);

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

  const productConnected = bridgeState.authorization === 'authorized'
    && bridgeState.host === 'ready'
    && consumerState.state === 'registered'
    && Boolean(consumerState.consumer);
  const engineReady = bridgeState.engine?.state === 'ready';
  const binding = consumerState.consumer?.binding || null;
  const bindingKey = binding
    ? `${binding.workspaceId}:${binding.databaseGeneration}:${binding.timelineId}`
    : '';
  currentBindingKeyRef.current = bindingKey;
  const timelineBound = productConnected
    && Boolean(binding)
    && binding?.timelineId !== AGENT_SELECTION_WORKSPACE_TIMELINE_ID;
  const awaitingTeamSelection = productConnected
    && binding?.timelineId === AGENT_SELECTION_WORKSPACE_TIMELINE_ID;
  const turnReady = timelineBound && engineReady;
  const activeSession = sessions.find((session) => session.defSessionId === activeSessionId) || null;
  const activeSessionReady = turnReady && activeSession?.status === 'ready';

  const refreshInteractions = useCallback(async () => {
    if (!productConnected || !activeSessionId) {
      setInteractions([]);
      setInteractionError(null);
      return;
    }
    try {
      const next = await bridge.listPendingInteractions();
      const current = next.filter((interaction) => interaction.defSessionId === activeSessionId);
      setInteractions(current);
      setQuestionDrafts((drafts) => {
        const activeIds = new Set<string>(current.map((interaction) => interaction.interactionId));
        const retained = Object.fromEntries(
          Object.entries(drafts).filter(([interactionId]) => activeIds.has(interactionId)),
        );
        return Object.keys(retained).length === Object.keys(drafts).length ? drafts : retained;
      });
      setInteractionError(null);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code || '')
        : '';
      // Older Hosts can still run the read/conversation path before the
      // interaction routes are enabled. Keep that path usable while polling
      // remains ready to consume the routes as soon as they appear.
      if (code === 'AGENT_ROUTE_NOT_FOUND') return;
      setInteractionError(userFacingAgentError(error));
    }
  }, [activeSessionId, bridge, productConnected]);

  useEffect(() => {
    if (!productConnected || !activeSessionId) {
      setInteractions([]);
      setInteractionError(null);
      return undefined;
    }
    let active = true;
    let inFlight = false;
    const refresh = () => {
      if (!active || inFlight) return;
      inFlight = true;
      void refreshInteractions().finally(() => {
        inFlight = false;
      });
    };
    refresh();
    const handle = typeof window === 'undefined' ? null : window.setInterval(refresh, 750);
    return () => {
      active = false;
      if (handle !== null) window.clearInterval(handle);
    };
  }, [activeSessionId, productConnected, refreshInteractions]);

  useEffect(() => {
    let active = true;
    setSessions([]);
    setActiveSessionId(null);
    if (!timelineBound || !bindingKey) {
      setLoadedSessionBindingKey('');
      return () => { active = false; };
    }
    setLoadedSessionBindingKey('');
    setLoadingSessions(true);
    setOperationError(null);
    void bridge.listSessions()
      .then((nextSessions) => {
        if (!active) return;
        setSessions(nextSessions);
        setLoadedSessionBindingKey(bindingKey);
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
  }, [bindingKey, bridge, timelineBound]);

  useEffect(() => {
    poller.setSession(activeSessionId);
  }, [activeSessionId, poller]);

  useEffect(() => {
    const currentDocument = injectedDocument || (typeof document === 'undefined' ? null : document);
    const synchronize = () => {
      if (
        productConnected
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
  }, [activeSessionId, injectedDocument, poller, productConnected]);

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
    if (!turnReady || !bindingKey || busyAction) return;
    const requestedBindingKey = bindingKey;
    setBusyAction('create');
    setOperationError(null);
    try {
      const session = await bridge.createSession();
      // Workbench restoration can replace the initial selection snapshot while
      // OpenCode is still cold-starting. Never attach that completed Session to
      // the newer Timeline; the next binding effect will create/list the right
      // one instead.
      if (currentBindingKeyRef.current !== requestedBindingKey) return;
      setSessions((current) => [session, ...current.filter((item) => item.defSessionId !== session.defSessionId)]);
      setActiveSessionId(session.defSessionId);
    } catch (error) {
      setOperationError(userFacingAgentError(error));
    } finally {
      setBusyAction(null);
    }
  };

  useEffect(() => {
    if (
      !turnReady
      || !bindingKey
      || loadedSessionBindingKey !== bindingKey
      || loadingSessions
      || sessions.length > 0
      || busyAction
      || autoCreateBindingRef.current === bindingKey
    ) return;
    autoCreateBindingRef.current = bindingKey;
    void handleCreateSession();
  }, [bindingKey, busyAction, loadedSessionBindingKey, loadingSessions, sessions.length, turnReady]);

  const submitMessage = async (message: string) => {
    const userMessage = message.trim();
    if (!activeSessionId || !userMessage || activeTurn || busyAction || !activeSessionReady) return;
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

  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault();
    await submitMessage(input);
  };

  const handleRetry = async (userMessage: string) => {
    if (activeTurn || busyAction) return;
    setInput(userMessage);
    await submitMessage(userMessage);
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

  const handleArchiveSession = async () => {
    if (!activeSession || activeSession.status === 'archived' || activeTurn || busyAction) return;
    setBusyAction('archive');
    setOperationError(null);
    try {
      const archived = await bridge.archiveSession(activeSession.defSessionId);
      setSessions((current) => current.map((session) => (
        session.defSessionId === archived.defSessionId ? archived : session
      )));
    } catch (error) {
      setOperationError(userFacingAgentError(error));
    } finally {
      setBusyAction(null);
    }
  };

  const handleRestoreSession = async () => {
    if (!activeSession || activeSession.status !== 'archived' || activeTurn || busyAction) return;
    setBusyAction('restore');
    setOperationError(null);
    try {
      const restored = await bridge.restoreSession(activeSession.defSessionId);
      setSessions((current) => current.map((session) => (
        session.defSessionId === restored.defSessionId ? restored : session
      )));
    } catch (error) {
      setOperationError(userFacingAgentError(error));
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteSession = async () => {
    if (!activeSession || activeTurn || busyAction) return;
    const confirmed = typeof window === 'undefined' || window.confirm(
      '只删除这个 AI 会话及其对话记录；不会删除排轴、Work Node、图片或 SQLite 数据。继续吗？',
    );
    if (!confirmed) return;
    setBusyAction('delete');
    setOperationError(null);
    try {
      await bridge.deleteSession(activeSession.defSessionId);
      autoCreateBindingRef.current = bindingKey;
      const remaining = sessions.filter((session) => session.defSessionId !== activeSession.defSessionId);
      setSessions(remaining);
      setActiveSessionId(remaining[0]?.defSessionId || null);
    } catch (error) {
      setOperationError(userFacingAgentError(error));
    } finally {
      setBusyAction(null);
    }
  };

  const handleInteractionResponse = async (
    interactionId: InteractionId,
    status: InteractionResponseAction,
    value?: JsonValue,
  ) => {
    if (interactionBusyId) return;
    setInteractionBusyId(interactionId);
    setInteractionError(null);
    try {
      await bridge.respondInteraction(interactionId, {
        status,
        ...(value === undefined ? {} : { value }),
      });
      setInteractions((current) => current.filter((interaction) => interaction.interactionId !== interactionId));
      setQuestionDrafts((current) => {
        if (!(interactionId in current)) return current;
        const next = { ...current };
        delete next[interactionId];
        return next;
      });
      await refreshInteractions();
    } catch (error) {
      setInteractionError(userFacingAgentError(error));
    } finally {
      setInteractionBusyId(null);
    }
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void handleSubmit();
  };

  const handleExit = async () => {
    if (busyAction) return;
    if (activeTurn) {
      const confirmed = typeof window === 'undefined' || window.confirm(
        'AI 正在回复。退出会先停止当前回复，已经显示的对话会保留。继续吗？',
      );
      if (!confirmed) return;
      setBusyAction('abort');
      setOperationError(null);
      try {
        await bridge.abortTurn(activeTurn.defTurnId);
        await poller.refresh();
      } catch (error) {
        setOperationError(userFacingAgentError(error));
        return;
      } finally {
        setBusyAction(null);
      }
    }
    onExit?.();
  };

  const rootClassName = [
    'agent-mode-overlay',
    embedded ? 'is-embedded' : '',
    className,
  ].filter(Boolean).join(' ');
  const readinessMessage = bridgeState.authorization !== 'authorized'
    ? '请从桌面 Shell 重新打开 AI 模式。'
    : bridgeState.host !== 'ready'
      ? 'Agent Host 尚未就绪。'
          : consumerState.state !== 'registered'
          ? consumerState.error || '正在等待当前工作区成为可见 writer。'
          : !timelineBound
            ? awaitingTeamSelection
              ? '请先在左侧选择至少一名干员；进入排轴后即可开始 AI 对话。'
              : '正在等待当前 Timeline 完成装载。'
            : !engineReady
              ? bridgeState.engine?.reason || 'Agent 引擎尚未就绪；历史会话仍可查看。'
              : null;
  const visibleError = operationError
    || pollerState.error
    || transcriptProjection.error
    || interactionError
    || consumerState.error
    || bridgeState.error;
  const completedTools = transcriptProjection.turns.reduce(
    (count, turn) => count + turn.tools.filter((tool) => tool.status === 'succeeded').length,
    0,
  );
  const statusText = visibleError
    || readinessMessage
    || (busyAction === 'create' ? '正在创建会话'
      : busyAction === 'send' ? '正在发送'
        : busyAction === 'abort' ? '正在停止'
      : activeTurn ? '正在思考'
          : interactionBusyId ? '正在提交交互'
            : pollerState.status === 'error' ? '事件读取失败'
              : '待命');

  return (
    <aside className={`${rootClassName} main-workbench-ai-panel`} aria-label="AI 模式">
      <div className="sandbox-characters-extra-spacer main-workbench-ai-topbar">
        {onExit && (
          <button
            type="button"
            className="sandbox-reserved-action sandbox-reserved-action--ai is-active"
            onClick={() => void handleExit()}
            aria-label="退出 AI 模式"
            aria-pressed="true"
            title="退出 AI 模式"
          >
            <span className="sandbox-reserved-action-text">AI</span>
          </button>
        )}
        {onOpenWorkNodePanel && (
          <button
            type="button"
            className="main-workbench-ai-topbar-button"
            onClick={onOpenWorkNodePanel}
            aria-label="Work node 节点树"
            title="Work node 节点树"
          >
            <WorkNodeTreeIcon className="main-workbench-ai-inline-icon" />
          </button>
        )}
        <div className="main-workbench-ai-session">
          <strong>DEF OpenCode</strong>
          <span title={activeSessionId || ''}>{compactId(activeSessionId)} · {bridgeState.engine?.kind || 'engine'}</span>
        </div>
        <select
          className="main-workbench-ai-session-select"
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
        {activeSession && (
          <div className="main-workbench-ai-session-actions" aria-label="AI 会话操作">
            {activeSession.status === 'archived' ? (
              <button
                type="button"
                onClick={() => void handleRestoreSession()}
                disabled={!turnReady || Boolean(busyAction) || Boolean(activeTurn)}
                title="恢复会话"
              >恢复</button>
            ) : (
              <button
                type="button"
                onClick={() => void handleArchiveSession()}
                disabled={Boolean(busyAction) || Boolean(activeTurn)}
                title="归档会话"
              >归档</button>
            )}
            <button
              type="button"
              className="is-danger"
              onClick={() => void handleDeleteSession()}
              disabled={Boolean(busyAction) || Boolean(activeTurn)}
              title="删除会话"
            >删除</button>
          </div>
        )}
      </div>

      <div className="main-workbench-ai-node-summary" aria-label="当前 AI 上下文">
        <span data-ready={turnReady ? 'true' : 'false'}>{turnReady ? '已就绪' : timelineBound ? '引擎不可用' : awaitingTeamSelection ? '等待选队' : '等待工作区'}</span>
        <span title={binding?.timelineId || ''}>{awaitingTeamSelection ? '尚未选择队伍' : binding ? compactId(binding.timelineId) : 'Timeline'}</span>
        <span>{completedTools ? `工具完成 ${completedTools}` : timelineBound ? '已绑定当前排轴' : '尚未绑定排轴'}</span>
      </div>

      <div className="main-workbench-ai-body">
        <main className="main-workbench-ai-messages" aria-live="polite">
          {readinessMessage && (
            <article className="main-workbench-ai-message is-system is-error">
              <span>系统</span>
              <p>{readinessMessage}</p>
            </article>
          )}
          {!readinessMessage && !activeSessionId && (
            <article className="main-workbench-ai-message is-system">
              <span>系统</span>
              <p>正在建立绑定当前 Timeline 的 DEF 会话。</p>
            </article>
          )}
          {!readinessMessage && activeSessionId && !transcriptProjection.turns.length && pollerState.status !== 'error' && (
            <article className="main-workbench-ai-message is-system">
              <span>系统</span>
              <p>可以开始了。可询问当前干员、装备、Buff、排轴或伤害计算。</p>
            </article>
          )}
          {interactions.length > 0 && (
            <section className="main-workbench-ai-interactions" aria-label="待处理的 AI 交互">
              <div className="main-workbench-ai-interactions-heading">
                <span>需要你的操作</span>
                <small>{interactions.length} 项待处理</small>
              </div>
              {interactions.map((interaction) => (
                <InteractionCard
                  key={interaction.interactionId}
                  interaction={interaction}
                  questionDraft={questionDrafts[interaction.interactionId] || ''}
                  busy={interactionBusyId === interaction.interactionId || Boolean(interactionBusyId)}
                  onQuestionDraftChange={(interactionId, value) => {
                    setQuestionDrafts((current) => ({ ...current, [interactionId]: value }));
                  }}
                  onRespond={(interactionId, status, value) => {
                    void handleInteractionResponse(interactionId, status, value);
                  }}
                />
              ))}
            </section>
          )}
          {transcriptProjection.turns.map((turn) => (
            <div className="main-workbench-ai-turn" key={turn.defTurnId} data-status={turn.status}>
              {turn.userMessage && (
                <article className="main-workbench-ai-message is-user">
                  <span>你</span>
                  <p>{turn.userMessage}</p>
                </article>
              )}
              <article className={`main-workbench-ai-message is-agent is-${turn.status}`}>
                  <span>后台</span>
                  {turn.tools.length > 0 && (
                    <div className="agent-mode-tools">
                      {turn.tools.map((tool) => <ToolCard key={tool.toolCallId} tool={tool} />)}
                    </div>
                  )}
                  {turn.assistantText && (
                    <div className="main-workbench-ai-markdown agent-mode-assistant-message">
                      <ReactMarkdown>{turn.assistantText}</ReactMarkdown>
                    </div>
                  )}
                  {turn.status !== 'running' && (
                    <div className="agent-mode-terminal" data-status={turn.status}>
                      <span>{terminalLabel(turn.status)}</span>
                      {turn.terminalMessage && <p>{turn.terminalMessage}</p>}
                    </div>
                  )}
                  <div className="main-workbench-ai-message-actions">
                    {turn.status === 'running' && (
                      <span className="main-workbench-ai-thinking">
                        <SpinnerIcon />
                        正在思考
                      </span>
                    )}
                    <div className="main-workbench-ai-message-action-buttons">
                      <button
                        type="button"
                        className="main-workbench-ai-icon-button"
                        onClick={() => void handleRetry(turn.userMessage)}
                        disabled={Boolean(activeTurn) || Boolean(busyAction) || !turn.userMessage}
                        aria-label="重试这条消息"
                        title="重试这条消息"
                      >
                        <RetryIcon />
                      </button>
                    </div>
                  </div>
              </article>
            </div>
          ))}
          {visibleError && visibleError !== readinessMessage && (
            <article className="main-workbench-ai-message is-system is-error" role="status">
              <span>系统</span>
              <p>{visibleError}</p>
            </article>
          )}
          <div ref={transcriptEndRef} />
        </main>
      </div>

      <form className="main-workbench-ai-composer" onSubmit={(event) => void handleSubmit(event)}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={activeSessionId ? '输入排轴问题' : '正在建立会话'}
          maxLength={16_000}
          rows={3}
          disabled={!activeSessionReady || !activeSessionId || Boolean(activeTurn)}
          aria-label="发送给 DEF Agent 的消息"
        />
        {activeTurn ? (
          <button
            type="button"
            onClick={() => void handleAbort()}
            disabled={Boolean(busyAction)}
            aria-label="停止"
            title="停止"
          >
            <StopIcon />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!activeSessionReady || !activeSessionId || !input.trim() || Boolean(busyAction)}
            aria-label="发送"
            title="发送"
          >
            <SendIcon />
          </button>
        )}
      </form>

      <div className="main-workbench-ai-status">
        <span>{statusText}</span>
        <button
          type="button"
          onClick={() => void handleCreateSession()}
          disabled={!turnReady || Boolean(busyAction) || Boolean(activeTurn)}
          aria-label="新对话"
          title="新对话"
        >
          <NewChatIcon />
        </button>
      </div>
    </aside>
  );
}
