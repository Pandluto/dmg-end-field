import { lazy, type ReactNode } from 'react';
import { WorkbenchFrame } from '../../components/WorkbenchFrame';
import {
  bootstrapLegacyFillHostGateway,
  publishLegacyFillHostSnapshot,
} from '../../legacyFillHost/runtime';
import { installAppHostExtension } from '../host/appHost';
import { installOfficialResourceTransport } from '../resources/resourceTransport';
import {
  captureDesktopMcpCapability,
  hasDesktopMcpReviewAuthority,
} from '../runtime/desktopMcpBridge';
import { isDesktopWebHost } from '../runtime/desktopWebHost';
import { installDesktopResourceWorkerRuntime } from './desktopResourceWorker';

export const DESKTOP_MCP_FILL_PATH = '/mcp-fill';
export const DESKTOP_LEGACY_FILL_REVIEW_PATH = '/legacy-fill-review';
export const DESKTOP_AGENT_MODE_PATH = '/timeline/ai';
export const DESKTOP_OFFICIAL_RESOURCE_PROXY_PREFIX = '/__dmg_official_resources__/';

const McpFillPage = lazy(async () => ({
  default: (await import('../../components/McpFillPage')).McpFillPage,
}));

const AgentModePanelWithRuntime = lazy(async () => {
  const [{ AgentModeOverlay: Overlay }, runtime] = await Promise.all([
    import('../../components/AgentMode'),
    import('../agent/browserAgentRuntime'),
  ]);
  return {
    default: ({ onOpenWorkNodePanel }: { onOpenWorkNodePanel?: () => void | Promise<void> }) => (
      <Overlay
        embedded
        bridge={runtime.desktopAgentBridge}
        consumerController={runtime.desktopAgentConsumerController}
        onOpenWorkNodePanel={onOpenWorkNodePanel
          ? () => void onOpenWorkNodePanel()
          : undefined}
        onExit={() => void runtime.exitDesktopAgentModeToWorkbench()}
      />
    ),
  };
});

function DesktopAgentRoute() {
  return (
    <WorkbenchFrame
      isAgentMode
      agentModePanel={({ onOpenWorkNodePanel }) => (
        <AgentModePanelWithRuntime onOpenWorkNodePanel={onOpenWorkNodePanel} />
      )}
    />
  );
}

function DesktopHostFailure({ message, retry }: { message: string; retry: () => void }) {
  const authorizationFailure = /AI 模式|授权|capability|Agent Host/i.test(message);
  return (
    <main className="web-entry-screen" role="alert">
      <div className="boot-indicator">
        <p>{authorizationFailure ? '请从桌面 Shell 打开 AI 模式' : '桌面工作区没有完整启动'}</p>
        <small>{message}</small>
        <button type="button" onClick={retry}>重新检查</button>
      </div>
    </main>
  );
}

function resolveDesktopOfficialResourcePath(path: string): string {
  const normalized = path.replace(/^\.?\//, '');
  if (!normalized.startsWith('resources/')) return path;
  return `${DESKTOP_OFFICIAL_RESOURCE_PROXY_PREFIX}${normalized}`;
}

function isMcpRoute(path: string): boolean {
  return path === DESKTOP_MCP_FILL_PATH || path === DESKTOP_LEGACY_FILL_REVIEW_PATH;
}

export function installDesktopHostExtension(): boolean {
  if (!isDesktopWebHost() || window.__DMG_MOBILE_ENTRY__) return false;

  const agentMode = window.location.hash.split('?')[0] === `#${DESKTOP_AGENT_MODE_PATH}`;
  const desktopMcpCapability = captureDesktopMcpCapability();
  const reviewLaunch = desktopMcpCapability && hasDesktopMcpReviewAuthority();

  installDesktopResourceWorkerRuntime();
  installOfficialResourceTransport({
    id: 'desktop-domestic-proxy',
    resolve: resolveDesktopOfficialResourcePath,
    fallbackToBundledOnUnavailable: true,
  });
  installAppHostExtension({
    id: 'desktop-shell',
    beforeMount: () => installDesktopResourceWorkerRuntime(),
    workspace: {
      skipAccessGate: true,
      requestControlWhenSecondary: Boolean(reviewLaunch || agentMode),
      startupLabel: () => agentMode ? '正在验证 AI 模式授权' : '正在打开桌面浏览器工作区',
      prepare: async () => {
        if (!agentMode) return;
        const { desktopAgentBridge } = await import('../agent/browserAgentRuntime');
        let state = await desktopAgentBridge.initialize();
        if (state.authorization !== 'authorized' || state.host !== 'ready') {
          await desktopAgentBridge.retryAuthorization();
          await desktopAgentBridge.refreshHostState();
          state = desktopAgentBridge.getState();
        }
        if (state.authorization !== 'authorized' || state.host !== 'ready') {
          throw new Error(state.error || 'AI 模式授权无效，请从桌面 Shell 重新打开。');
        }
      },
      afterDatabaseReady: async () => {
        if (!agentMode) return;
        const runtime = await import('../agent/browserAgentRuntime');
        await runtime.browserAgentRuntime.initializeWorkspace();
        await runtime.desktopAgentConsumerController.start();
      },
      afterStorageReady: async () => {
        if (desktopMcpCapability) await bootstrapLegacyFillHostGateway().catch(() => null);
      },
      afterResourcesReady: async ({ resourcePackage, imagePackage }) => {
        if (resourcePackage && imagePackage && desktopMcpCapability) {
          await publishLegacyFillHostSnapshot().catch(() => null);
        }
      },
      afterResourcesInstalled: async () => {
        if (desktopMcpCapability) await publishLegacyFillHostSnapshot().catch(() => null);
      },
      beforeRelease: async () => {
        if (!agentMode) return;
        const runtime = await import('../agent/browserAgentRuntime');
        runtime.browserAgentRuntime.cancelCommandPull();
        await runtime.browserAgentRuntime.suspendWritableBinding().catch(() => undefined);
        await runtime.desktopAgentConsumerController.stop().catch(() => undefined);
      },
      serviceWorkerFailureMessage: () => '本地图片资源服务没有接管当前页面；浏览器存档不会受影响。',
      renderFailure: (message, retry): ReactNode => (
        <DesktopHostFailure message={message} retry={retry} />
      ),
    },
    routes: {
      isWorkspacePath: (path) => path === DESKTOP_AGENT_MODE_PATH,
      resolve: (path) => {
        if (isMcpRoute(path)) {
          return {
            node: <McpFillPage />,
            kind: 'exclusive',
            boundaryKey: path,
          };
        }
        if (path === DESKTOP_AGENT_MODE_PATH) {
          return {
            node: <DesktopAgentRoute />,
            activatesWorkspace: true,
            boundaryKey: 'desktop-agent-workbench',
          };
        }
        return null;
      },
    },
    ui: {
      showPageVersionUpdate: false,
      showAccessSettings: false,
      showLocalResourcePackager: false,
    },
  });
  return true;
}
