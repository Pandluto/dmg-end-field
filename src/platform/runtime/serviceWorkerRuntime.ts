const PAGE_UPDATE_PARAM = '__sw_recovery';
const READY_TIMEOUT_MS = 90_000;
const CONTROL_TIMEOUT_MS = 30_000;
const WORKER_VERSION_TIMEOUT_MS = 2_000;
const APP_SHELL_CACHE_PREFIX = 'dmg-app-shell-';
const APP_SHELL_COMPLETE_MARKER = '/__dmg_app_shell_complete__';

export type OfflineAvailability = {
  supported: boolean;
  ready: boolean;
};

export type PageUpdateResult = 'up-to-date' | 'reloading';

type WorkerPageVersion = {
  schemaVersion: number;
  releaseVersion: string;
  shellVersion: string;
};

let ensureControllerInFlight: Promise<boolean> | null = null;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function readDocumentShellVersion(): string {
  return document
    .querySelector<HTMLMetaElement>('meta[name="dmg-app-shell-version"]')
    ?.content
    ?.trim() || '';
}

function readWorkerPageVersion(worker: ServiceWorker | null): Promise<WorkerPageVersion | null> {
  if (!worker || typeof MessageChannel === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (value: WorkerPageVersion | null) => {
      window.clearTimeout(timeout);
      channel.port1.close();
      resolve(value);
    };
    const timeout = window.setTimeout(() => finish(null), WORKER_VERSION_TIMEOUT_MS);
    channel.port1.onmessage = (event: MessageEvent<Partial<WorkerPageVersion>>) => {
      const value = event.data;
      finish(
        value?.schemaVersion === 1 && typeof value.shellVersion === 'string'
          ? {
              schemaVersion: value.schemaVersion,
              releaseVersion: String(value.releaseVersion || ''),
              shellVersion: value.shellVersion,
            }
          : null,
      );
    };
    try {
      worker.postMessage({ type: 'GET_PAGE_VERSION' }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

async function controllerMatchesShell(shellVersion: string): Promise<boolean> {
  if (!shellVersion) return Boolean(navigator.serviceWorker.controller);
  const version = await readWorkerPageVersion(navigator.serviceWorker.controller);
  return version?.shellVersion === shellVersion;
}

function waitForWorkerState(
  worker: ServiceWorker,
  acceptedStates: ServiceWorkerState[],
  timeoutMs: number,
): Promise<boolean> {
  if (acceptedStates.includes(worker.state)) return Promise.resolve(true);
  if (worker.state === 'redundant') return Promise.resolve(false);
  return new Promise((resolve) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      worker.removeEventListener('statechange', handleStateChange);
    };
    const handleStateChange = () => {
      if (acceptedStates.includes(worker.state)) {
        cleanup();
        resolve(true);
      } else if (worker.state === 'redundant') {
        cleanup();
        resolve(false);
      }
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve(acceptedStates.includes(worker.state));
    }, timeoutMs);
    worker.addEventListener('statechange', handleStateChange);
  });
}

async function waitForControllerShell(shellVersion: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await controllerMatchesShell(shellVersion)) return true;
    await delay(200);
  }
  return controllerMatchesShell(shellVersion);
}

async function activateMatchingWorker(
  registration: ServiceWorkerRegistration,
  shellVersion: string,
): Promise<boolean> {
  const candidates = [...new Set([
    registration.waiting,
    registration.installing,
    registration.active,
  ].filter((worker): worker is ServiceWorker => Boolean(worker)))];

  for (const worker of candidates) {
    if (worker.state === 'installing') {
      const installed = await waitForWorkerState(
        worker,
        ['installed', 'activated'],
        READY_TIMEOUT_MS,
      );
      if (!installed) continue;
    }
    const version = await readWorkerPageVersion(worker);
    if (version?.shellVersion !== shellVersion) continue;
    if (worker.state === 'installed') {
      worker.postMessage({ type: 'SKIP_WAITING' });
    }
    if (worker.state === 'installed' || worker.state === 'activating') {
      const activated = await waitForWorkerState(worker, ['activated'], CONTROL_TIMEOUT_MS);
      if (!activated) continue;
    }
    if (worker.state === 'activated') {
      return waitForControllerShell(shellVersion, CONTROL_TIMEOUT_MS);
    }
  }
  return false;
}

async function ensureControllerForDocumentShell(): Promise<boolean> {
  const shellVersion = readDocumentShellVersion();
  if (await controllerMatchesShell(shellVersion)) return true;

  let registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration) {
    registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });
  }

  const deadline = Date.now() + READY_TIMEOUT_MS;
  let retryDelay = 250;
  while (Date.now() < deadline) {
    if (await activateMatchingWorker(registration, shellVersion)) return true;
    if (!navigator.onLine) return false;

    try {
      await registration.update();
    } catch {
      // Sites may briefly expose the new page before every release file reaches
      // the edge. Keep retrying this one bounded migration transaction.
    }
    if (await activateMatchingWorker(registration, shellVersion)) return true;
    await delay(retryDelay);
    retryDelay = Math.min(retryDelay * 2, 4_000);
  }
  return controllerMatchesShell(shellVersion);
}

export async function ensureImageServiceWorkerController(): Promise<boolean> {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return false;
  if (ensureControllerInFlight) return ensureControllerInFlight;

  ensureControllerInFlight = (async () => {
    try {
      if (window.__DMG_ENSURE_SERVICE_WORKER__) {
        return await window.__DMG_ENSURE_SERVICE_WORKER__();
      }
      return await ensureControllerForDocumentShell();
    } catch {
      return false;
    }
  })();
  try {
    return await ensureControllerInFlight;
  } finally {
    ensureControllerInFlight = null;
  }
}

export async function readOfflineAvailability(): Promise<OfflineAvailability> {
  const supported = window.isSecureContext
    && 'serviceWorker' in navigator
    && 'caches' in window;
  if (!supported) return { supported: false, ready: false };
  try {
    const shellVersion = readDocumentShellVersion();
    const cache = await caches.open(`${APP_SHELL_CACHE_PREFIX}${shellVersion}`);
    const marker = await cache.match(APP_SHELL_COMPLETE_MARKER);
    const markerVersion = marker ? await marker.text() : '';
    return {
      supported: true,
      ready: await controllerMatchesShell(shellVersion)
        && markerVersion === shellVersion,
    };
  } catch {
    return { supported: true, ready: false };
  }
}

export async function reloadLatestPageVersion(): Promise<PageUpdateResult> {
  if (!navigator.onLine) {
    throw new Error('当前处于离线状态，连接网络后再更新页面。');
  }

  const serviceWorkerUrl = new URL('/sw.js', window.location.origin);
  serviceWorkerUrl.searchParams.set('update', String(Date.now()));
  const response = await fetch(serviceWorkerUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`无法访问页面更新服务（HTTP ${response.status}）。`);
  }

  if (!('serviceWorker' in navigator)) {
    throw new Error('当前浏览器不支持页面离线更新服务。');
  }

  const registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration) {
    throw new Error('页面更新服务尚未就绪，请重新载入后再试。');
  }

  const previousController = navigator.serviceWorker.controller;
  let discoveredWorker = registration.installing;
  const handleUpdateFound = () => {
    discoveredWorker = registration.installing;
  };
  registration.addEventListener('updatefound', handleUpdateFound);
  try {
    await registration.update();
  } finally {
    registration.removeEventListener('updatefound', handleUpdateFound);
  }

  const installingWorker = registration.installing || discoveredWorker;
  if (installingWorker) {
    const installed = await waitForWorkerState(
      installingWorker,
      ['installed', 'activated'],
      READY_TIMEOUT_MS * 2,
    );
    if (!installed) {
      throw new Error('新版页面文件下载失败，当前版本仍可继续使用。');
    }
  }

  const waitingWorker = registration.waiting;
  if (waitingWorker) {
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    const activated = await waitForWorkerState(
      waitingWorker,
      ['activated'],
      CONTROL_TIMEOUT_MS * 2,
    );
    if (!activated) {
      throw new Error('新版已经下载，但未能完成安装；请保持页面打开后重试。');
    }
  }

  if (navigator.serviceWorker.controller === previousController) {
    if (!waitingWorker && !installingWorker) return 'up-to-date';
    const changed = await new Promise<boolean>((resolve) => {
      const timeout = window.setTimeout(() => {
        navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
        resolve(navigator.serviceWorker.controller !== previousController);
      }, CONTROL_TIMEOUT_MS);
      const handleControllerChange = () => {
        window.clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
        resolve(true);
      };
      navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
    });
    if (!changed) {
      throw new Error('新版已经安装，但未能接管页面；请关闭其他标签页后重试。');
    }
  }

  const target = new URL(window.location.href);
  target.searchParams.set(PAGE_UPDATE_PARAM, String(Date.now()));
  window.location.replace(target.href);
  return 'reloading';
}
