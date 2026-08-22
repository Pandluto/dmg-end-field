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
import { NotificationCenterProvider } from '../../platform/notifications/NotificationCenterProvider';
import { getAppHostExtension } from '../../platform/host/appHost';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../../utils/appRoute';
import { AccessGate } from './AccessGate';
import { RuntimeFailurePage } from './RuntimeFailurePage';
import { SecondaryTabPage } from './SecondaryTabPage';
import { WelcomePage } from './WelcomePage';
import './web-app.css';

type BootstrapPhase = 'checking-access' | 'locked' | 'starting' | 'secondary' | 'onboarding' | 'ready' | 'failed';

export function WebBootstrap() {
  const [hostExtension] = useState(() => getAppHostExtension());
  const hostWorkspace = hostExtension.workspace;
  const [phase, setPhase] = useState<BootstrapPhase>(
    () => (hostWorkspace?.skipAccessGate ? 'starting' : 'checking-access'),
  );
  const [failure, setFailure] = useState('');
  const [installedPackage, setInstalledPackage] = useState<InstalledResourcePackage | null>(null);
  const [installedImagePackage, setInstalledImagePackage] = useState<InstalledImagePackage | null>(null);

  const initializeWorkspace = useCallback(async () => {
    setPhase('starting');
    setFailure('');
    try {
      await hostWorkspace?.prepare?.();
      let role = await workspaceLease.start();
      if (role !== 'writer' && hostWorkspace?.requestControlWhenSecondary) {
        role = await workspaceLease.requestControl();
      }
      if (role !== 'writer') {
        setPhase('secondary');
        return;
      }
      await webDatabase.initialize();
      await hostWorkspace?.afterDatabaseReady?.();
      await bootstrapPersistentStorage();
      await bootstrapUserWorkspaceBridge();
      await hostWorkspace?.afterStorageReady?.();
      await initializeWebImageLibrary();
      await normalizeAppliedLocalDataImagePaths();
      void requestPersistentBrowserStorage();
      const [installed, imagePackage] = await Promise.all([
        readInstalledResourcePackage(),
        readInstalledImagePackage(),
      ]);
      if (imagePackage && !await ensureImageServiceWorkerController()) {
        const defaultMessage = '图片缓存服务没有接管当前页面。请保持联网后重新检查；本地存档不会受影响。';
        throw new Error(hostWorkspace?.serviceWorkerFailureMessage?.(defaultMessage) || defaultMessage);
      }
      if (imagePackage) await initializeAppTheme().catch(() => undefined);
      setInstalledPackage(installed);
      setInstalledImagePackage(imagePackage);
      const complete = Boolean(installed && imagePackage);
      if (complete && !hasAnyAppliedIndependentLibraries()) {
        await applyDefaultLocalDataPackage({ backup: false });
      }
      await hostWorkspace?.afterResourcesReady?.({
        resourcePackage: installed,
        imagePackage,
      });
      setPhase(complete ? 'ready' : 'onboarding');
      if (complete && (window.location.hash === '' || window.location.hash === '#/')) {
        navigateToAppPath(APP_ROUTE_PATHS.welcome);
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      setPhase('failed');
    }
  }, [hostWorkspace]);

  const handleInstalled = useCallback(async (
    resourcePackage: InstalledResourcePackage,
    imagePackage: InstalledImagePackage,
  ) => {
    setPhase('starting');
    setFailure('');
    try {
      if (!await ensureImageServiceWorkerController()) {
        const defaultMessage = '图片缓存服务没有接管当前页面。请保持联网后重新检查；本地存档不会受影响。';
        throw new Error(hostWorkspace?.serviceWorkerFailureMessage?.(defaultMessage) || defaultMessage);
      }
      await initializeAppTheme().catch(() => undefined);
      await hostWorkspace?.afterResourcesInstalled?.({
        resourcePackage,
        imagePackage,
      });
      setInstalledPackage(resourcePackage);
      setInstalledImagePackage(imagePackage);
      navigateToAppPath(APP_ROUTE_PATHS.welcome);
      setPhase('ready');
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      setPhase('failed');
    }
  }, [hostWorkspace]);

  useEffect(() => {
    if (hostWorkspace?.skipAccessGate) {
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
  }, [hostWorkspace, initializeWorkspace]);

  useEffect(() => {
    const handleReleaseRequest = async () => {
      try {
        await hostWorkspace?.beforeRelease?.();
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
  }, [hostWorkspace]);

  useEffect(() => {
    const flushOnHide = () => {
      if (document.visibilityState === 'hidden') void flushPersistentStorage();
    };
    document.addEventListener('visibilitychange', flushOnHide);
    return () => document.removeEventListener('visibilitychange', flushOnHide);
  }, []);

  if (phase === 'checking-access' || phase === 'starting') {
    return (
      <main className="web-entry-screen">
        <div className="boot-indicator">
          <span />
          <p>{phase === 'checking-access'
            ? '检查访问状态'
            : hostWorkspace?.startupLabel?.() || '正在打开浏览器工作区'}</p>
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
    const retry = () => void initializeWorkspace();
    const customFailure = hostWorkspace?.renderFailure?.(failure, retry);
    if (customFailure) return customFailure;
    return (
      <RuntimeFailurePage
        error={failure}
        onRetry={retry}
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
      <NotificationCenterProvider>
        <App key={`${installedPackage?.version || 'web-lts'}:${installedImagePackage?.version || 'no-images'}`} />
      </NotificationCenterProvider>
    </AppProvider>
  );
}
