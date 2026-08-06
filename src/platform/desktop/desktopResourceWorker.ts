import { isDesktopRuntime } from './desktopHost';

const DESKTOP_WORKER_PATH = '/sw-desktop.js';
const CONTROL_TIMEOUT_MS = 30_000;

function controllerIsDesktopWorker(): boolean {
  const controller = navigator.serviceWorker.controller;
  if (!controller) return false;
  return new URL(controller.scriptURL, window.location.origin).pathname
    === DESKTOP_WORKER_PATH;
}

function waitForController(): Promise<boolean> {
  if (controllerIsDesktopWorker()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      resolve(controllerIsDesktopWorker());
    };
    const handleControllerChange = () => finish();
    const timeout = window.setTimeout(finish, CONTROL_TIMEOUT_MS);
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
  });
}

let ensureInFlight: Promise<boolean> | null = null;

async function ensureDesktopResourceWorker(): Promise<boolean> {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return false;
  if (controllerIsDesktopWorker()) return true;

  const registration = await navigator.serviceWorker.register(DESKTOP_WORKER_PATH, {
    scope: '/',
    updateViaCache: 'none',
  });
  await registration.update().catch(() => undefined);
  registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
  if (controllerIsDesktopWorker()) return true;
  return waitForController();
}

export function installDesktopResourceWorkerRuntime(): void {
  if (!isDesktopRuntime()) return;
  window.__DMG_ENSURE_SERVICE_WORKER__ = () => {
    if (!ensureInFlight) {
      ensureInFlight = ensureDesktopResourceWorker().finally(() => {
        ensureInFlight = null;
      });
    }
    return ensureInFlight;
  };
}
