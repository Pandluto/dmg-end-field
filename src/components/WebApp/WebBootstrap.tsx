import { useCallback, useEffect, useState } from 'react';
import App from '../../App';
import { AppProvider } from '../../context/AppContext';
import { readAccessLeaseStatus } from '../../platform/auth/accessLease';
import {
  requestPersistentBrowserStorage,
  webDatabase,
} from '../../platform/database/webDatabase';
import {
  readInstalledResourcePackage,
  type InstalledResourcePackage,
} from '../../platform/resources/resourcePackage';
import {
  readInstalledImagePackage,
  type InstalledImagePackage,
} from '../../platform/resources/imagePackage';
import { workspaceLease } from '../../platform/runtime/workspaceLease';
import {
  bootstrapPersistentStorage,
  flushPersistentStorage,
} from '../../platform/storage/persistentStorage';
import { bootstrapUserWorkspaceBridge, flushUserWorkspaceState } from '../../utils/userWorkspaceBridge';
import { initializeWebImageLibrary } from '../../platform/resources/webImageLibrary';
import {
  applyDefaultLocalDataPackage,
  hasAnyAppliedIndependentLibraries,
  normalizeAppliedLocalDataImagePaths,
} from '../../platform/data/localDataPackages';
import { ensureImageServiceWorkerController } from '../../platform/runtime/serviceWorkerRuntime';
import { initializeAppTheme } from '../../platform/theme/appTheme';
import { isDesktopWebHost } from '../../platform/runtime/desktopWebHost';
import {
  browserAgentRuntime,
  desktopAgentBridge,
  desktopAgentConsumerController,
} from '../../platform/agent/browserAgentRuntime';
import { isDesktopAgentModeRoute } from '../../platform/agent/desktopAgentBridge';
import {
  captureDesktopMcpCapability,
  hasDesktopMcpReviewAuthority,
} from '../../platform/runtime/desktopMcpBridge';
import {
  bootstrapLegacyFillHostGateway,
  publishLegacyFillHostSnapshot,
} from '../../legacyFillHost/runtime';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../../utils/appRoute';
import { AccessGate } from './AccessGate';
import { RuntimeFailurePage } from './RuntimeFailurePage';
import { SecondaryTabPage } from './SecondaryTabPage';
import { WelcomePage } from './WelcomePage';
import './web-app.css';

type BootstrapPhase =
  | 'checking-access'
  | 'authorizing-agent'
  | 'agent-unauthorized'
  | 'locked'
  | 'starting'
  | 'secondary'
  | 'onboarding'
  | 'ready'
  | 'failed';

export function WebBootstrap() {
  const desktopWebHost = isDesktopWebHost();
  const [agentMode] = useState(() => isDesktopAgentModeRoute());
  const [desktopMcpContext] = useState(() => {
    const capability = desktopWebHost && captureDesktopMcpCapability();
    return {
      capability,
      reviewLaunch: capability && hasDesktopMcpReviewAuthority(),
    };
  });
  const desktopMcpCapability = desktopMcpContext.capability;
  const [phase, setPhase] = useState<BootstrapPhase>(
    () => (agentMode ? 'authorizing-agent' : desktopWebHost ? 'starting' : 'checking-access'),
  );
  const [failure, setFailure] = useState('');
  const [installedPackage, setInstalledPackage] = useState<InstalledResourcePackage | null>(null);
  const [installedImagePackage, setInstalledImagePackage] = useState<InstalledImagePackage | null>(null);

  const initializeWorkspace = useCallback(async () => {
    setPhase('starting');
    setFailure('');
    try {
      let role = await workspaceLease.start();
      if (role !== 'writer' && (desktopMcpContext.reviewLaunch || agentMode)) {
        role = await workspaceLease.requestControl();
      }
      if (role !== 'writer') {
        setPhase('secondary');
        return;
      }
      await webDatabase.initialize();
      if (agentMode) {
        await browserAgentRuntime.initializeWorkspace();
        await desktopAgentConsumerController.start();
      }
      await bootstrapPersistentStorage();
      await bootstrapUserWorkspaceBridge();
      if (desktopMcpCapability) {
        await bootstrapLegacyFillHostGateway().catch(() => null);
      }
      await initializeWebImageLibrary();
      await normalizeAppliedLocalDataImagePaths();
      void requestPersistentBrowserStorage();
      const [installed, imagePackage] = await Promise.all([
        readInstalledResourcePackage(),
        readInstalledImagePackage(),
      ]);
      if (imagePackage && !await ensureImageServiceWorkerController()) {
        throw new Error(
          desktopWebHost
            ? '本地图片资源服务没有接管当前页面；浏览器存档不会受影响。'
            : '图片缓存服务没有接管当前页面。请保持联网后重新检查；本地存档不会受影响。',
        );
      }
      if (imagePackage) await initializeAppTheme().catch(() => undefined);
      setInstalledPackage(installed);
      setInstalledImagePackage(imagePackage);
      const complete = Boolean(installed && imagePackage);
      if (complete && !hasAnyAppliedIndependentLibraries()) {
        await applyDefaultLocalDataPackage({ backup: false });
      }
      if (complete && desktopMcpCapability) {
        await publishLegacyFillHostSnapshot().catch(() => null);
      }
      setPhase(complete ? 'ready' : 'onboarding');
      if (complete && (window.location.hash === '' || window.location.hash === '#/')) {
        navigateToAppPath(APP_ROUTE_PATHS.welcome);
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      setPhase('failed');
    }
  }, [agentMode, desktopMcpCapability, desktopMcpContext.reviewLaunch, desktopWebHost]);

  const handleInstalled = useCallback(async (
    resourcePackage: InstalledResourcePackage,
    imagePackage: InstalledImagePackage,
  ) => {
    setPhase('starting');
    setFailure('');
    try {
      if (!await ensureImageServiceWorkerController()) {
        throw new Error(
          desktopWebHost
            ? '本地图片资源服务没有接管当前页面；浏览器存档不会受影响。'
            : '图片缓存服务没有接管当前页面。请保持联网后重新检查；本地存档不会受影响。',
        );
      }
      await initializeAppTheme().catch(() => undefined);
      if (desktopMcpCapability) {
        await publishLegacyFillHostSnapshot().catch(() => null);
      }
      setInstalledPackage(resourcePackage);
      setInstalledImagePackage(imagePackage);
      navigateToAppPath(APP_ROUTE_PATHS.welcome);
      setPhase('ready');
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      setPhase('failed');
    }
  }, [desktopMcpCapability, desktopWebHost]);

  useEffect(() => {
    if (agentMode) {
      let cancelled = false;
      void desktopAgentBridge.initialize().then((state) => {
        if (cancelled) return;
        if (state.authorization !== 'authorized' || state.host !== 'ready') {
          setFailure(state.error || 'AI 模式授权无效，请从桌面 Shell 重新打开。');
          setPhase('agent-unauthorized');
          return;
        }
        void initializeWorkspace();
      }).catch((error: unknown) => {
        if (cancelled) return;
        setFailure(error instanceof Error ? error.message : String(error));
        setPhase('agent-unauthorized');
      });
      return () => {
        cancelled = true;
      };
    }
    if (desktopWebHost) {
      void initializeWorkspace();
      return undefined;
    }
    let cancelled = false;
    void readAccessLeaseStatus().then((status) => {
      if (cancelled) return;
      if (!status.granted) {
        setPhase('locked');
        return;
      }
      void initializeWorkspace();
    });
    return () => {
      cancelled = true;
    };
  }, [agentMode, desktopWebHost, initializeWorkspace]);

  useEffect(() => {
    const handleReleaseRequest = async () => {
      try {
        await Promise.all([flushPersistentStorage(), flushUserWorkspaceState()]);
        await webDatabase.close();
      } finally {
        workspaceLease.release();
        setPhase('secondary');
      }
    };
    window.addEventListener('dmg-workspace-release-requested', handleReleaseRequest);
    return () => {
      window.removeEventListener('dmg-workspace-release-requested', handleReleaseRequest);
    };
  }, []);

  useEffect(() => {
    const flushOnHide = () => {
      if (document.visibilityState === 'hidden') void flushPersistentStorage();
    };
    document.addEventListener('visibilitychange', flushOnHide);
    return () => document.removeEventListener('visibilitychange', flushOnHide);
  }, []);

  if (phase === 'checking-access' || phase === 'authorizing-agent' || phase === 'starting') {
    return (
      <main className="web-entry-screen">
        <div className="boot-indicator">
          <span />
          <p>
            {phase === 'checking-access'
              ? '检查访问状态'
              : phase === 'authorizing-agent'
                ? '正在验证 AI 模式授权'
              : '正在打开浏览器工作区'}
          </p>
        </div>
      </main>
    );
  }

  if (phase === 'agent-unauthorized') {
    return (
      <main className="web-entry-screen" role="alert">
        <div className="boot-indicator">
          <p>请从桌面 Shell 打开 AI 模式</p>
          <small>{failure || '当前标签页没有有效的一次性授权。'}</small>
        </div>
      </main>
    );
  }

  if (phase === 'locked') {
    return <AccessGate onUnlocked={() => void initializeWorkspace()} />;
  }

  if (phase === 'secondary') {
    return <SecondaryTabPage onControlAcquired={() => void initializeWorkspace()} />;
  }

  if (phase === 'failed') {
    return (
      <RuntimeFailurePage
        error={failure}
        onRetry={() => initializeWorkspace()}
      />
    );
  }

  if (phase === 'onboarding') {
    return (
      <WelcomePage
        onInstalled={(resourcePackage, imagePackage) => {
          void handleInstalled(resourcePackage, imagePackage);
        }}
      />
    );
  }

  return (
    <AppProvider>
      <App key={`${installedPackage?.version || 'web-lts'}:${installedImagePackage?.version || 'no-images'}`} />
    </AppProvider>
  );
}
