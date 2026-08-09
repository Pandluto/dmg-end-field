import { useCallback, useEffect, useState } from 'react';
import { AccessGate } from '../components/WebApp/AccessGate';
import { readAccessLeaseStatus } from '../platform/auth/accessLease';
import type { MobileCatalog } from './model';
import { loadMobileCatalog } from './mobileCatalog';
import { MobileApp } from './MobileApp';
import '../components/WebApp/web-app.css';
import './MobileBootstrap.css';

type MobileBootstrapPhase = 'checking-access' | 'locked' | 'loading' | 'ready' | 'failed';

const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1_000;

async function readLatestMobileVersions(): Promise<{ dataVersion: string; imageVersion: string }> {
  const requestVersion = async (pathname: string) => {
    const url = new URL(pathname, window.location.origin);
    url.searchParams.set('mobile-check', String(Date.now()));
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return '';
    const payload = await response.json() as { version?: unknown };
    return typeof payload.version === 'string' ? payload.version : '';
  };
  const [dataVersion, imageVersion] = await Promise.all([
    requestVersion('/web-data-manifest.json'),
    requestVersion('/web-image-manifest.json'),
  ]);
  return { dataVersion, imageVersion };
}

export function MobileBootstrap() {
  const [phase, setPhase] = useState<MobileBootstrapPhase>('checking-access');
  const [catalog, setCatalog] = useState<MobileCatalog | null>(null);
  const [failure, setFailure] = useState('');
  const [updateAvailable, setUpdateAvailable] = useState(false);

  const initialize = useCallback(async () => {
    setPhase('loading');
    setFailure('');
    try {
      const nextCatalog = await loadMobileCatalog();
      setCatalog(nextCatalog);
      setUpdateAvailable(false);
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
      void initialize();
    });
    return () => {
      cancelled = true;
    };
  }, [initialize]);

  useEffect(() => {
    if (phase !== 'ready' || !catalog) return undefined;
    let cancelled = false;
    const check = async () => {
      try {
        const latest = await readLatestMobileVersions();
        if (!cancelled && (
          (latest.dataVersion && latest.dataVersion !== catalog.dataVersion)
          || (latest.imageVersion && latest.imageVersion !== catalog.imageVersion)
        )) {
          setUpdateAvailable(true);
        }
      } catch {
        // A background version check must not interrupt the current draft.
      }
    };
    const timer = window.setInterval(() => void check(), VERSION_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [catalog, phase]);

  if (phase === 'checking-access') {
    return (
      <main className="mobile-bootstrap-state" aria-live="polite">
        <span className="mobile-bootstrap-spinner" />
        <strong>正在检查访问权限</strong>
      </main>
    );
  }

  if (phase === 'locked') {
    return <AccessGate variant="mobile" onUnlocked={() => void initialize()} />;
  }

  if (phase === 'loading') {
    return (
      <main className="mobile-bootstrap-state" aria-live="polite">
        <span className="mobile-bootstrap-spinner" />
        <strong>正在读取线上最新资料</strong>
        <small>干员、武器、装备、Buff 与图片会保持同一版本</small>
      </main>
    );
  }

  if (phase === 'failed' || !catalog) {
    return (
      <main className="mobile-bootstrap-state is-error" role="alert">
        <span className="mobile-bootstrap-error-mark">!</span>
        <strong>线上资料没有完整载入</strong>
        <p>{failure || '请检查网络后重试。'}</p>
        <button type="button" onClick={() => void initialize()}>重新读取</button>
      </main>
    );
  }

  return (
    <MobileApp
      catalog={catalog}
      updateAvailable={updateAvailable}
      onReloadLatest={() => window.location.reload()}
    />
  );
}
