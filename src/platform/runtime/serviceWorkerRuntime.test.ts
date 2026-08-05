import assert from 'node:assert/strict';
import { reloadLatestPageVersion } from './serviceWorkerRuntime';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalFetch = globalThis.fetch;

const activeController = { id: 'active' } as unknown as ServiceWorker;
const nextController = { id: 'next' } as unknown as ServiceWorker;
let waitingWorker: ServiceWorker | null = null;
let replacedUrl = '';
let updateCalls = 0;

const registration = {
  get installing() {
    return null;
  },
  get waiting() {
    return waitingWorker;
  },
  async update() {
    updateCalls += 1;
    return registration;
  },
} as unknown as ServiceWorkerRegistration;

const serviceWorker = {
  controller: activeController,
  async getRegistration() {
    return registration;
  },
  addEventListener() {},
  removeEventListener() {},
};

const navigatorMock = {
  onLine: true,
  serviceWorker,
};

const windowMock = {
  location: {
    origin: 'https://manual-update.test',
    href: 'https://manual-update.test/#/timeline',
    replace(url: string) {
      replacedUrl = url;
    },
  },
  setTimeout,
  clearTimeout,
};

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: navigatorMock,
});
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: windowMock,
});
globalThis.fetch = async () => new Response('', { status: 200 });

try {
  assert.equal(
    await reloadLatestPageVersion(),
    'up-to-date',
    'manual check should stay on the page when the worker bytes are unchanged',
  );
  assert.equal(updateCalls, 1);
  assert.equal(replacedUrl, '');

  waitingWorker = {
    state: 'installed',
    postMessage(message: unknown) {
      assert.deepEqual(message, { type: 'SKIP_WAITING' });
      serviceWorker.controller = nextController;
    },
  } as unknown as ServiceWorker;
  assert.equal(
    await reloadLatestPageVersion(),
    'reloading',
    'manual check should activate a fully installed waiting worker',
  );
  assert.equal(updateCalls, 2);
  assert.match(replacedUrl, /__sw_recovery=/);

  navigatorMock.onLine = false;
  await assert.rejects(
    reloadLatestPageVersion(),
    /当前处于离线状态/,
    'offline state must never attempt an update',
  );
  assert.equal(updateCalls, 2);
} finally {
  globalThis.fetch = originalFetch;
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete (globalThis as { navigator?: Navigator }).navigator;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete (globalThis as { window?: Window }).window;
}

console.log('Manual page update runtime contract: PASS');
