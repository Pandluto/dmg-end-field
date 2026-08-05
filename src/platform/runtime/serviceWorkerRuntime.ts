const PAGE_UPDATE_PARAM = '__sw_recovery';
const READY_TIMEOUT_MS = 60_000;
const CONTROL_TIMEOUT_MS = 15_000;
const APP_SHELL_CACHE_PREFIX = 'dmg-app-shell-';

export type OfflineAvailability = {
  supported: boolean;
  ready: boolean;
};

export type PageUpdateResult = 'up-to-date' | 'reloading';

function waitForController(timeoutMs: number): Promise<boolean> {
  if (navigator.serviceWorker.controller) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      resolve(Boolean(navigator.serviceWorker.controller));
    }, timeoutMs);
    const handleControllerChange = () => {
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      resolve(Boolean(navigator.serviceWorker.controller));
    };
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
  });
}

function waitForControllerChange(
  previousController: ServiceWorker | null,
  timeoutMs: number,
): Promise<boolean> {
  if (navigator.serviceWorker.controller !== previousController) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      resolve(navigator.serviceWorker.controller !== previousController);
    }, timeoutMs);
    const handleControllerChange = () => {
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      resolve(true);
    };
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
  });
}

function waitForWorkerInstall(worker: ServiceWorker, timeoutMs: number): Promise<void> {
  if (worker.state === 'installed' || worker.state === 'activated') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      worker.removeEventListener('statechange', handleStateChange);
    };
    const handleStateChange = () => {
      if (worker.state === 'installed' || worker.state === 'activated') {
        cleanup();
        resolve();
      } else if (worker.state === 'redundant') {
        cleanup();
        reject(new Error('新版页面文件下载失败，当前版本仍可继续使用。'));
      }
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('新版页面文件下载超时，当前版本仍可继续使用。'));
    }, timeoutMs);
    worker.addEventListener('statechange', handleStateChange);
  });
}

async function waitForReadyRegistration(): Promise<void> {
  await Promise.race([
    navigator.serviceWorker.ready.then(() => undefined),
    new Promise<never>((_, reject) => {
      window.setTimeout(
        () => reject(new Error('图片缓存服务启动超时。')),
        READY_TIMEOUT_MS,
      );
    }),
  ]);
}

export async function ensureImageServiceWorkerController(): Promise<boolean> {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    return false;
  }
  if (navigator.serviceWorker.controller) return true;

  try {
    let registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration) {
      registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      });
    } else if (navigator.onLine) {
      await registration.update();
    }
    if (registration.installing) {
      await waitForWorkerInstall(registration.installing, READY_TIMEOUT_MS);
    }
    registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
    await waitForReadyRegistration();
    return await waitForController(CONTROL_TIMEOUT_MS);
  } catch {
    // Image interception may recover later. Never block access to the workspace.
    return false;
  }
}

export async function readOfflineAvailability(): Promise<OfflineAvailability> {
  const supported = window.isSecureContext
    && 'serviceWorker' in navigator
    && 'caches' in window;
  if (!supported) return { supported: false, ready: false };
  try {
    const cacheNames = await caches.keys();
    return {
      supported: true,
      ready: Boolean(navigator.serviceWorker.controller)
        && cacheNames.some((cacheName) => cacheName.startsWith(APP_SHELL_CACHE_PREFIX)),
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
  await registration.update();
  if (registration.installing) {
    await waitForWorkerInstall(registration.installing, READY_TIMEOUT_MS * 3);
  }
  const waitingWorker = registration.waiting;
  if (waitingWorker) {
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    const controllerChanged = await waitForControllerChange(
      previousController,
      CONTROL_TIMEOUT_MS * 2,
    );
    if (!controllerChanged) {
      throw new Error('新版已经下载，但未能接管页面；请关闭其他标签页后重试。');
    }
  } else if (navigator.serviceWorker.controller === previousController) {
    return 'up-to-date';
  }

  const target = new URL(window.location.href);
  target.searchParams.set(PAGE_UPDATE_PARAM, String(Date.now()));
  window.location.replace(target.href);
  return 'reloading';
}
