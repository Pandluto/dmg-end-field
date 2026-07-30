const CONTROLLER_RELOAD_KEY = 'dmg.sw-controller-reload.v1';
const PAGE_UPDATE_PARAM = '__sw_recovery';
const READY_TIMEOUT_MS = 8_000;
const CONTROL_TIMEOUT_MS = 4_000;

function readReloadAttempt(): boolean {
  try {
    return sessionStorage.getItem(CONTROLLER_RELOAD_KEY) === '1';
  } catch {
    return false;
  }
}

function writeReloadAttempt(value: boolean): void {
  try {
    if (value) sessionStorage.setItem(CONTROLLER_RELOAD_KEY, '1');
    else sessionStorage.removeItem(CONTROLLER_RELOAD_KEY);
  } catch {
    // Continue without the reload guard when session storage is unavailable.
  }
}

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

export async function ensureImageServiceWorkerController(): Promise<void> {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    throw new Error('图片缓存需要 localhost 或 HTTPS 安全上下文。');
  }
  if (navigator.serviceWorker.controller) {
    writeReloadAttempt(false);
    return;
  }

  try {
    await waitForReadyRegistration();
    if (await waitForController(CONTROL_TIMEOUT_MS)) {
      writeReloadAttempt(false);
      return;
    }
  } catch (error) {
    if (readReloadAttempt()) throw error;
  }

  if (!readReloadAttempt()) {
    writeReloadAttempt(true);
    window.location.reload();
    await new Promise<void>(() => {
      // Keep bootstrap suspended until the browser replaces this document.
    });
  }

  throw new Error('图片缓存服务未能接管页面，请使用“修复并重新加载”。');
}

export async function reloadLatestPageVersion(): Promise<void> {
  if (!navigator.onLine) {
    throw new Error('当前处于离线状态，连接网络后再更新页面。');
  }

  const serviceWorkerUrl = new URL('/sw.js', window.location.origin);
  serviceWorkerUrl.searchParams.set('update', String(Date.now()));
  const response = await fetch(serviceWorkerUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`无法访问页面更新服务（HTTP ${response.status}）。`);
  }

  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }

  const target = new URL(window.location.href);
  target.searchParams.set(PAGE_UPDATE_PARAM, String(Date.now()));
  window.location.replace(target.href);
}
