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
import { APP_ROUTE_PATHS, navigateToAppPath } from '../../utils/appRoute';
import { AccessGate } from './AccessGate';
import { RuntimeFailurePage } from './RuntimeFailurePage';
import { SecondaryTabPage } from './SecondaryTabPage';
import { WelcomePage } from './WelcomePage';
import './web-app.css';

type BootstrapPhase = 'checking-access' | 'locked' | 'starting' | 'secondary' | 'onboarding' | 'ready' | 'failed';

export function WebBootstrap() {
  const [phase, setPhase] = useState<BootstrapPhase>('checking-access');
  const [failure, setFailure] = useState('');
  const [installedPackage, setInstalledPackage] = useState<InstalledResourcePackage | null>(null);
  const [installedImagePackage, setInstalledImagePackage] = useState<InstalledImagePackage | null>(null);

  const initializeWorkspace = useCallback(async () => {
    setPhase('starting');
    setFailure('');
    try {
      const role = await workspaceLease.start();
      if (role !== 'writer') {
        setPhase('secondary');
        return;
      }
      await webDatabase.initialize();
      await bootstrapPersistentStorage();
      await bootstrapUserWorkspaceBridge();
      await initializeWebImageLibrary();
      await normalizeAppliedLocalDataImagePaths();
      void requestPersistentBrowserStorage();
      const [installed, imagePackage] = await Promise.all([
        readInstalledResourcePackage(),
        readInstalledImagePackage(),
      ]);
      setInstalledPackage(installed);
      setInstalledImagePackage(imagePackage);
      const complete = Boolean(installed && imagePackage);
      if (imagePackage) await ensureImageServiceWorkerController();
      if (complete && !hasAnyAppliedIndependentLibraries()) {
        await applyDefaultLocalDataPackage({ backup: false });
      }
      setPhase(complete ? 'ready' : 'onboarding');
      if (complete && (window.location.hash === '' || window.location.hash === '#/')) {
        navigateToAppPath(APP_ROUTE_PATHS.welcome);
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      setPhase('failed');
    }
  }, []);

  const handleInstalled = useCallback(async (
    resourcePackage: InstalledResourcePackage,
    imagePackage: InstalledImagePackage,
  ) => {
    setPhase('starting');
    setFailure('');
    try {
      await ensureImageServiceWorkerController();
      setInstalledPackage(resourcePackage);
      setInstalledImagePackage(imagePackage);
      navigateToAppPath(APP_ROUTE_PATHS.welcome);
      setPhase('ready');
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      setPhase('failed');
    }
  }, []);

  useEffect(() => {
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
  }, [initializeWorkspace]);

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

  if (phase === 'checking-access' || phase === 'starting') {
    return (
      <main className="web-entry-screen">
        <div className="boot-indicator">
          <span />
          <p>{phase === 'checking-access' ? '检查访问状态' : '正在打开浏览器工作区'}</p>
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
    return <RuntimeFailurePage error={failure} />;
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
