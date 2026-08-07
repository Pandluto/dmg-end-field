import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {
  AgentNativeUiLaunch,
  AgentProductSession,
} from '../../../agent/core/contracts/browser-protocol';
import type {
  DefSessionId,
  InteractionId,
} from '../../../agent/core/contracts/ids';
import type {
  InteractionRequest,
  InteractionResponse,
  JsonValue,
  ProductBinding,
} from '../../../agent/core/contracts';
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
import { workspaceLease } from '../../platform/runtime/workspaceLease';
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

type InteractionResponseAction = 'answered' | 'approved' | 'rejected' | 'cancelled';

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function operationMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function chooseSession(
  sessions: readonly AgentProductSession[],
  activeDefSessionId: DefSessionId | null,
): AgentProductSession | null {
  const active = sessions.find((session) => (
    session.defSessionId === activeDefSessionId && session.status === 'ready'
  ));
  if (active) return active;
  return [...sessions]
    .filter((session) => session.status === 'ready')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
}

function InteractionDock({
  interactions,
  busyId,
  drafts,
  error,
  onDraft,
  onRespond,
}: {
  readonly interactions: readonly InteractionRequest[];
  readonly busyId: InteractionId | null;
  readonly drafts: Readonly<Record<string, string>>;
  readonly error: string | null;
  readonly onDraft: (id: InteractionId, value: string) => void;
  readonly onRespond: (
    id: InteractionId,
    status: InteractionResponseAction,
    value?: JsonValue,
  ) => void;
}) {
  if (!interactions.length && !error) return null;
  return (
    <section className="agent-native-interaction-dock" aria-label="待处理的 AI 操作">
      {error && <p className="agent-native-interaction-error" role="alert">{error}</p>}
      {interactions.map((interaction) => {
        const id = interaction.interactionId as InteractionId;
        const busy = busyId !== null;
        const options = interaction.kind === 'question'
          && Array.isArray(interaction.details?.options)
          && interaction.details.options.every((item) => typeof item === 'string')
          ? interaction.details.options as string[]
          : [];
        return (
          <article key={id} className="agent-native-interaction-card" data-kind={interaction.kind}>
            <header>
              <strong>{interaction.kind === 'question' ? '需要回答' : '需要确认'}</strong>
              <span>DEF Host</span>
            </header>
            <p>{interaction.prompt}</p>
            {interaction.kind === 'approval' && (
              <details open>
                <summary>查看变更提案</summary>
                <pre>{formatJson(interaction.proposal)}</pre>
              </details>
            )}
            {interaction.kind === 'question' ? (
              <div className="agent-native-interaction-answer">
                {options.length > 0 && (
                  <div className="agent-native-interaction-options">
                    {options.map((option) => (
                      <button
                        key={option}
                        type="button"
                        disabled={busy}
                        onClick={() => onRespond(id, 'answered', option)}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  rows={2}
                  maxLength={8_000}
                  value={drafts[id] ?? ''}
                  disabled={busy}
                  placeholder="输入回答"
                  onChange={(event) => onDraft(id, event.target.value)}
                />
                <div className="agent-native-interaction-actions">
                  <button
                    type="button"
                    disabled={busy || !(drafts[id] ?? '').trim()}
                    onClick={() => onRespond(id, 'answered', (drafts[id] ?? '').trim())}
                  >
                    提交
                  </button>
                  <button type="button" disabled={busy} onClick={() => onRespond(id, 'cancelled')}>
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div className="agent-native-interaction-actions">
                <button type="button" disabled={busy} onClick={() => onRespond(id, 'approved')}>
                  批准
                </button>
                <button type="button" disabled={busy} onClick={() => onRespond(id, 'rejected')}>
                  拒绝
                </button>
              </div>
            )}
          </article>
        );
      })}
    </section>
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
  const [bridgeState, setBridgeState] = useState<DesktopAgentBridgeState>(() => bridge.getState());
  const [consumerState, setConsumerState] = useState<DesktopAgentConsumerSnapshot>(
    () => consumerController.getState(),
  );
  const [launch, setLaunch] = useState<AgentNativeUiLaunch | null>(null);
  const [launchRevision, setLaunchRevision] = useState(0);
  const [status, setStatus] = useState('正在连接 OpenCode…');
  const [error, setError] = useState<string | null>(null);
  const [interactions, setInteractions] = useState<readonly InteractionRequest[]>([]);
  const [interactionBusyId, setInteractionBusyId] = useState<InteractionId | null>(null);
  const [interactionDrafts, setInteractionDrafts] = useState<Record<string, string>>({});
  const [interactionError, setInteractionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const unsubscribeBridge = bridge.subscribe((next) => {
      if (active) setBridgeState(next);
    });
    const unsubscribeConsumer = consumerController.subscribe((next) => {
      if (active) setConsumerState(next);
    });
    void bridge.initialize().then(async () => {
      if (active && managesConsumerLifecycle) await consumerController.start();
    }).catch((cause) => {
      if (active) setError(operationMessage(cause));
    });
    return () => {
      active = false;
      unsubscribeBridge();
      unsubscribeConsumer();
      if (managesConsumerLifecycle) void consumerController.stop();
    };
  }, [bridge, consumerController, managesConsumerLifecycle]);

  const connected = bridgeState.authorization === 'authorized'
    && bridgeState.host === 'ready'
    && consumerState.state === 'registered'
    && Boolean(consumerState.consumer);
  const bindingKey = consumerState.consumer
    ? [
      consumerState.consumer.binding.workspaceId,
      consumerState.consumer.binding.databaseGeneration,
      consumerState.consumer.binding.timelineId,
    ].join(':')
    : '';

  useEffect(() => {
    if (!connected) {
      setLaunch(null);
      if (bridgeState.authorization !== 'authorized') setStatus('请从桌面 Shell 重新打开 AI 模式。');
      else if (consumerState.state !== 'registered') setStatus(consumerState.error || '正在绑定当前工作区…');
      else setStatus('Agent Host 尚未就绪。');
      return;
    }
    let disposed = false;
    const openNativeUi = async () => {
      setError(null);
      setStatus('正在读取 DEF 会话…');
      const [uiState, listed] = await Promise.all([
        bridge.getUiState(),
        bridge.listSessions(),
      ]);
      if (disposed) return;
      let selected = chooseSession(listed, uiState.activeDefSessionId);
      if (!selected) {
        if (bridgeState.engine?.state !== 'ready') {
          throw new Error(bridgeState.engine?.reason || 'OpenCode 引擎尚未就绪。');
        }
        setStatus('正在创建 DEF 会话…');
        selected = await bridge.createSession();
        if (disposed) return;
      }
      setStatus('正在打开原版 OpenCode UI…');
      const nextLaunch = await bridge.launchNativeUi(selected.defSessionId);
      if (disposed) return;
      setLaunch(nextLaunch);
      setStatus('');
    };
    void openNativeUi().catch((cause) => {
      if (!disposed) setError(operationMessage(cause));
    });
    return () => {
      disposed = true;
    };
  }, [
    bindingKey,
    bridge,
    bridgeState.engine?.reason,
    bridgeState.engine?.state,
    connected,
    consumerState.error,
    consumerState.state,
    launchRevision,
  ]);

  const refreshInteractions = useCallback(async () => {
    if (!connected) return;
    const pending = await bridge.listPendingInteractions();
    setInteractions(pending);
  }, [bridge, connected]);

  useEffect(() => {
    if (!connected) {
      setInteractions([]);
      return;
    }
    let disposed = false;
    const refresh = async () => {
      try {
        const pending = await bridge.listPendingInteractions();
        if (!disposed) {
          setInteractions(pending);
          setInteractionError(null);
        }
      } catch (cause) {
        if (!disposed) setInteractionError(operationMessage(cause));
      }
    };
    void refresh();
    const handle = window.setInterval(() => void refresh(), 750);
    return () => {
      disposed = true;
      window.clearInterval(handle);
    };
  }, [bridge, connected]);

  const respondInteraction = async (
    interactionId: InteractionId,
    action: InteractionResponseAction,
    value?: JsonValue,
  ) => {
    setInteractionBusyId(interactionId);
    setInteractionError(null);
    try {
      let response: InteractionResponse;
      if (action === 'answered') response = await bridge.answerQuestion(interactionId, value ?? '');
      else if (action === 'approved') response = await bridge.approveInteraction(interactionId);
      else if (action === 'rejected') response = await bridge.rejectInteraction(interactionId, value);
      else response = await bridge.cancelInteraction(interactionId);
      if (response.status === 'answered' || response.status === 'approved' || response.status === 'rejected' || response.status === 'cancelled') {
        setInteractionDrafts((current) => {
          const next = { ...current };
          delete next[interactionId];
          return next;
        });
      }
      await refreshInteractions();
    } catch (cause) {
      setInteractionError(operationMessage(cause));
    } finally {
      setInteractionBusyId(null);
    }
  };

  const rootClassName = [
    'agent-mode-overlay',
    'agent-native-opencode-host',
    embedded ? 'is-embedded' : '',
    className,
  ].filter(Boolean).join(' ');
  const visibleError = error || bridgeState.error || consumerState.error;

  return (
    <aside className={rootClassName} aria-label="AI 模式">
      <div className="agent-native-shell-actions">
        {onExit && (
          <button type="button" onClick={onExit} title="退出 AI 模式" aria-label="退出 AI 模式">
            AI
          </button>
        )}
        {onOpenWorkNodePanel && (
          <button
            type="button"
            onClick={onOpenWorkNodePanel}
            title="Work node 节点树"
            aria-label="Work node 节点树"
          >
            <WorkNodeTreeIcon className="agent-native-shell-icon" />
          </button>
        )}
      </div>

      {launch && !visibleError ? (
        <iframe
          key={launch.src}
          className="agent-native-opencode-frame"
          src={launch.src}
          title="DEF OpenCode"
          allow="clipboard-read; clipboard-write"
        />
      ) : (
        <div className="agent-native-opencode-status" role={visibleError ? 'alert' : 'status'}>
          <strong>{visibleError ? 'OpenCode UI 未能打开' : 'DEF OpenCode'}</strong>
          <p>{visibleError || status}</p>
          {visibleError && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setLaunch(null);
                setLaunchRevision((current) => current + 1);
                void bridge.refreshUiState().then(() => consumerController.refreshEligibility());
              }}
            >
              重试
            </button>
          )}
        </div>
      )}

      <InteractionDock
        interactions={interactions}
        busyId={interactionBusyId}
        drafts={interactionDrafts}
        error={interactionError}
        onDraft={(id, value) => setInteractionDrafts((current) => ({ ...current, [id]: value }))}
        onRespond={(id, action, value) => void respondInteraction(id, action, value)}
      />
    </aside>
  );
}
