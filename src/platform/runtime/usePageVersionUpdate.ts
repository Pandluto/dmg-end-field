import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_VERSION_LABEL, formatVersionLabel } from './appVersion';
import {
  checkLatestPageVersion,
  type PageVersionCheckResult,
} from './pageVersionRuntime';
import { reloadLatestPageVersion } from './serviceWorkerRuntime';

const AUTO_CHECK_INTERVAL_MS = 30 * 60 * 1_000;

export type PageVersionUpdatePhase =
  | 'checking'
  | 'up-to-date'
  | 'update-available'
  | 'updating'
  | 'update-failed'
  | 'check-failed'
  | 'offline';

export type PageVersionUpdateState = {
  phase: PageVersionUpdatePhase;
  currentVersionLabel: string;
  latestVersionLabel: string | null;
  latestShellVersion: string | null;
  error: string;
};

function checkedState(result: PageVersionCheckResult): PageVersionUpdateState {
  return {
    phase: result.updateAvailable ? 'update-available' : 'up-to-date',
    currentVersionLabel: formatVersionLabel(result.current.releaseVersion),
    latestVersionLabel: formatVersionLabel(result.latest.releaseVersion),
    latestShellVersion: result.latest.shellVersion,
    error: '',
  };
}

export function usePageVersionUpdate(enabled = true): {
  state: PageVersionUpdateState;
  update: () => Promise<void>;
} {
  const [state, setState] = useState<PageVersionUpdateState>(() => ({
    phase: enabled ? (navigator.onLine ? 'checking' : 'offline') : 'up-to-date',
    currentVersionLabel: APP_VERSION_LABEL,
    latestVersionLabel: null,
    latestShellVersion: null,
    error: '',
  }));
  const checkSequenceRef = useRef(0);
  const updatingRef = useRef(false);

  const check = useCallback(async () => {
    if (!enabled) return;
    if (updatingRef.current) return;
    const sequence = checkSequenceRef.current + 1;
    checkSequenceRef.current = sequence;
    if (!navigator.onLine) {
      setState((current) => ({ ...current, phase: 'offline', error: '' }));
      return;
    }

    setState((current) => ({ ...current, phase: 'checking', error: '' }));
    try {
      const result = await checkLatestPageVersion();
      if (checkSequenceRef.current === sequence) setState(checkedState(result));
    } catch (error) {
      if (checkSequenceRef.current !== sequence) return;
      setState((current) => ({
        ...current,
        phase: navigator.onLine ? 'check-failed' : 'offline',
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [enabled]);

  const update = useCallback(async () => {
    if (!enabled) return;
    if (!['update-available', 'update-failed'].includes(state.phase)) return;
    updatingRef.current = true;
    checkSequenceRef.current += 1;
    setState((current) => ({ ...current, phase: 'updating', error: '' }));
    try {
      const result = await reloadLatestPageVersion();
      if (result === 'up-to-date') {
        updatingRef.current = false;
        await check();
      }
    } catch (error) {
      setState((current) => ({
        ...current,
        phase: 'update-failed',
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      updatingRef.current = false;
    }
  }, [check, enabled, state.phase]);

  useEffect(() => {
    if (!enabled) return undefined;
    const handleOnline = () => void check();
    const handleOffline = () => {
      checkSequenceRef.current += 1;
      setState((current) => ({ ...current, phase: 'offline', error: '' }));
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void check();
    };

    void check();
    const interval = window.setInterval(() => void check(), AUTO_CHECK_INTERVAL_MS);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      checkSequenceRef.current += 1;
      window.clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [check, enabled]);

  return { state, update };
}
