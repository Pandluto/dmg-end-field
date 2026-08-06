import { useEffect, useMemo, useState } from 'react';
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
import { workspaceLease } from '../../platform/runtime/workspaceLease';
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

function statusLabel(value: string): string {
  const labels: Record<string, string> = {
    pending: '等待中',
    ready: '已就绪',
    unavailable: '不可用',
    error: '异常',
    authorized: '已授权',
    missing: '未授权',
    failed: '授权失败',
    idle: '未启动',
    blocked: '未满足条件',
    registering: '注册中',
    registered: '已注册',
    closed: '已关闭',
    writer: 'writer',
    reader: 'reader',
    visible: '可见',
    hidden: '不可见',
  };
  return labels[value] || value;
}

function StatusRow({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  return (
    <div className="agent-mode-status-row">
      <dt>{label}</dt>
      <dd data-tone={tone}>{value}</dd>
    </div>
  );
}

function toneFor(value: string): 'neutral' | 'good' | 'warn' | 'bad' {
  if (['ready', 'authorized', 'registered'].includes(value)) return 'good';
  if (['error', 'failed', 'unavailable'].includes(value)) return 'bad';
  if (['pending', 'registering', 'blocked', 'missing'].includes(value)) return 'warn';
  return 'neutral';
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
  const [bridgeState, setBridgeState] = useState<DesktopAgentBridgeState>(
    () => bridge.getState() || INITIAL_BRIDGE_STATE,
  );
  const [consumerState, setConsumerState] = useState<DesktopAgentConsumerSnapshot>(
    () => consumerController.getState(),
  );

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

  const writerValue = `${statusLabel(consumerState.visible ? 'visible' : 'hidden')} · ${statusLabel(consumerState.role)}`;
  const engineValue = bridgeState.engine
    ? `${statusLabel(bridgeState.engine.state)}${bridgeState.engine.reason ? ` · ${bridgeState.engine.reason}` : ''}`
    : '等待 Host 状态';
  const rootClassName = ['agent-mode-overlay', className].filter(Boolean).join(' ');

  return (
    <aside className={rootClassName} aria-label="AI 模式状态">
      <div className="agent-mode-header">
        <div>
          <p className="agent-mode-eyebrow">DEF AGENT</p>
          <h1>AI 模式</h1>
        </div>
        <span className="agent-mode-pending-badge">引擎待接入</span>
      </div>
      <dl className="agent-mode-status-list">
        <StatusRow label="Host" value={statusLabel(bridgeState.host)} tone={toneFor(bridgeState.host)} />
        <StatusRow label="授权" value={statusLabel(bridgeState.authorization)} tone={toneFor(bridgeState.authorization)} />
        <StatusRow label="Writer" value={writerValue} tone={toneFor(consumerState.role)} />
        <StatusRow label="Consumer" value={statusLabel(consumerState.state)} tone={toneFor(consumerState.state)} />
        <StatusRow label="Engine" value={engineValue} tone={toneFor(bridgeState.engine?.state || 'pending')} />
      </dl>
      {bridgeState.error && <p className="agent-mode-error" role="status">{bridgeState.error}</p>}
      {consumerState.error && <p className="agent-mode-error" role="status">{consumerState.error}</p>}
      <p className="agent-mode-note">
        当前页面只负责授权、状态与浏览器工作区桥接；真实引擎接入前不会显示聊天框，也不会伪造回复。
      </p>
    </aside>
  );
}
