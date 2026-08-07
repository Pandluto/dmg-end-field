import {
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {
  AgentNativeUiLaunch,
  AgentProductSession,
} from '../../../agent/core/contracts/browser-protocol';
import type { DefSessionId } from '../../../agent/core/contracts/ids';
import type { ProductBinding } from '../../../agent/core/contracts';
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

/**
 * OpenCode's native sidebar intentionally removes archived sessions and has no
 * restore action.  Keep the recovery list in the DEF shell so recovery is
 * explicit and never silently creates a replacement session.
 */
export function archivedSessionsForRecovery(
  sessions: readonly AgentProductSession[],
): readonly AgentProductSession[] {
  return sessions
    .filter((session) => session.status === 'archived')
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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
  const [archivedSessions, setArchivedSessions] = useState<readonly AgentProductSession[]>([]);
  const [restoringSessionId, setRestoringSessionId] = useState<DefSessionId | null>(null);
  const [status, setStatus] = useState('正在连接 OpenCode…');
  const [error, setError] = useState<string | null>(null);

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
      const archived = archivedSessionsForRecovery(listed);
      setArchivedSessions(archived);
      let selected = chooseSession(listed, uiState.activeDefSessionId);
      if (!selected) {
        if (bridgeState.engine?.state !== 'ready') {
          throw new Error(bridgeState.engine?.reason || 'OpenCode 引擎尚未就绪。');
        }
        setStatus(archived.length > 0
          ? '正在创建新的 DEF 会话；已归档会话仍可随时恢复…'
          : '正在创建 DEF 会话…');
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
    bridgeState.capabilityRevision,
    connected,
    consumerState.error,
    consumerState.state,
    launchRevision,
  ]);

  const restoreArchivedSession = async (session: AgentProductSession): Promise<void> => {
    if (restoringSessionId) return;
    setRestoringSessionId(session.defSessionId);
    setError(null);
    setStatus('正在恢复已归档会话…');
    try {
      const restored = await bridge.restoreNativeUiSession(session.defSessionId);
      setArchivedSessions((current) => current.filter((candidate) => candidate.defSessionId !== session.defSessionId));
      setStatus('正在打开恢复的 OpenCode 会话…');
      const nextLaunch = await bridge.launchNativeUi(restored.defSessionId);
      setLaunch(nextLaunch);
      setStatus('');
    } catch (cause) {
      setError(operationMessage(cause));
      setStatus('恢复失败，请重试。');
    } finally {
      setRestoringSessionId(null);
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

      {archivedSessions.length > 0 && (
        <section
          aria-label="已归档 AI 会话"
          style={{
            position: 'absolute',
            zIndex: 4,
            top: 48,
            left: 12,
            right: 12,
            maxHeight: 180,
            overflow: 'auto',
            padding: '10px 12px',
            border: '1px solid rgba(17, 17, 17, .16)',
            borderRadius: 8,
            background: 'rgba(250, 250, 250, .94)',
            boxShadow: '0 4px 16px rgba(0, 0, 0, .1)',
            backdropFilter: 'blur(10px)',
          }}
        >
          <strong style={{ display: 'block', font: '600 12px/1.4 system-ui, sans-serif' }}>
            已归档会话
          </strong>
          <p style={{ margin: '3px 0 8px', color: '#6f6f6a', font: '400 11px/1.45 system-ui, sans-serif' }}>
            原版 OpenCode 没有恢复入口，请手动选择要恢复的会话。
          </p>
          <div style={{ display: 'grid', gap: 5 }}>
            {archivedSessions.map((session) => (
              <div
                key={session.defSessionId}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: '400 11px/1.4 system-ui, sans-serif' }}>
                  {session.defSessionId}
                </span>
                <button
                  type="button"
                  disabled={restoringSessionId !== null}
                  onClick={() => void restoreArchivedSession(session)}
                  style={{ flex: '0 0 auto', border: '1px solid #b6b6b0', borderRadius: 5, padding: '3px 8px', color: '#272724', background: '#fff', cursor: 'pointer', font: '500 11px/1.3 system-ui, sans-serif' }}
                >
                  {restoringSessionId === session.defSessionId ? '恢复中…' : '恢复'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

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
              onClick={async () => {
                setError(null);
                setLaunch(null);
                setLaunchRevision((current) => current + 1);
                setStatus(bridgeState.authorization === 'authorized'
                  ? '正在刷新 Agent 状态…'
                  : '正在向桌面 Shell 重新申请 AI 模式授权…');
                try {
                  if (bridgeState.authorization === 'authorized') await bridge.refreshUiState();
                  else await bridge.retryAuthorization();
                  await consumerController.refreshEligibility();
                } catch (cause) {
                  setError(operationMessage(cause));
                }
              }}
            >
              重试
            </button>
          )}
        </div>
      )}

    </aside>
  );
}
