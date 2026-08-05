import assert from 'node:assert/strict';
import {
  ensureImageServiceWorkerController,
  reloadLatestPageVersion,
} from './serviceWorkerRuntime';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalFetch = globalThis.fetch;

type Listener = () => void;

class MockWorker {
  state: ServiceWorkerState;
  readonly version: string;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(version: string, state: ServiceWorkerState = 'activated') {
    this.version = version;
    this.state = state;
  }

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) || new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string) {
    for (const listener of this.listeners.get(type) || []) listener();
  }

  postMessage(message: { type?: string }, transfer?: Transferable[]) {
    if (message.type === 'GET_PAGE_VERSION') {
      (transfer?.[0] as MessagePort | undefined)?.postMessage({
        schemaVersion: 1,
        releaseVersion: '1.8.2',
        shellVersion: this.version,
      });
      return;
    }
    if (message.type === 'SKIP_WAITING') {
      this.state = 'activated';
      this.emit('statechange');
      serviceWorker.controller = this as unknown as ServiceWorker;
      serviceWorker.emit('controllerchange');
    }
  }
}

const activeController = new MockWorker('active-shell');
const nextController = new MockWorker('next-shell', 'installed');
let waitingWorker: MockWorker | null = null;
let replacedUrl = '';
let updateCalls = 0;
let ensureCalls = 0;

const registrationListeners = new Map<string, Set<Listener>>();
const registration = {
  get installing() {
    return null;
  },
  get waiting() {
    return waitingWorker as unknown as ServiceWorker | null;
  },
  get active() {
    return serviceWorker.controller;
  },
  async update() {
    updateCalls += 1;
    return registration;
  },
  addEventListener(type: string, listener: Listener) {
    const listeners = registrationListeners.get(type) || new Set<Listener>();
    listeners.add(listener);
    registrationListeners.set(type, listeners);
  },
  removeEventListener(type: string, listener: Listener) {
    registrationListeners.get(type)?.delete(listener);
  },
} as unknown as ServiceWorkerRegistration;

const serviceWorkerListeners = new Map<string, Set<Listener>>();
const serviceWorker = {
  controller: activeController as unknown as ServiceWorker | null,
  async getRegistration() {
    return registration;
  },
  addEventListener(type: string, listener: Listener) {
    const listeners = serviceWorkerListeners.get(type) || new Set<Listener>();
    listeners.add(listener);
    serviceWorkerListeners.set(type, listeners);
  },
  removeEventListener(type: string, listener: Listener) {
    serviceWorkerListeners.get(type)?.delete(listener);
  },
  emit(type: string) {
    for (const listener of serviceWorkerListeners.get(type) || []) listener();
  },
};

const navigatorMock = {
  onLine: true,
  serviceWorker,
};

const windowMock = {
  isSecureContext: true,
  __DMG_ENSURE_SERVICE_WORKER__: async () => {
    ensureCalls += 1;
    return true;
  },
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
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: {
    querySelector: () => ({ content: 'next-shell' }),
  },
});
globalThis.fetch = async () => new Response('', { status: 200 });

try {
  assert.equal(
    await ensureImageServiceWorkerController(),
    true,
    'controller readiness must use the document-shell migration transaction',
  );
  assert.equal(
    ensureCalls,
    1,
    'an existing but stale controller must not bypass document-shell verification',
  );

  assert.equal(
    await reloadLatestPageVersion(),
    'up-to-date',
    'manual check should stay on the page when the worker bytes are unchanged',
  );
  assert.equal(updateCalls, 1);
  assert.equal(replacedUrl, '');

  waitingWorker = nextController;
  assert.equal(
    await reloadLatestPageVersion(),
    'reloading',
    'manual check should activate a fully installed waiting worker',
  );
  assert.equal(updateCalls, 2);
  assert.match(replacedUrl, /__sw_recovery=/);
  assert.equal(serviceWorker.controller, nextController as unknown as ServiceWorker);

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
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else delete (globalThis as { document?: Document }).document;
}

console.log('Manual page update and controller migration contract: PASS');
