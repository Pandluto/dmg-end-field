import assert from 'node:assert/strict';
import { checkLatestPageVersion, type PageVersionManifest } from './pageVersionRuntime';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
const originalFetch = globalThis.fetch;

let online = true;
let waitingWorker: ServiceWorker | null = null;
let activeWorker: ServiceWorker | null = null;
let cacheNames = ['dmg-app-shell-1111111111111111'];
let documentShellVersion = '1111111111111111';
let latestManifest: PageVersionManifest = {
  schemaVersion: 1,
  releaseVersion: '1.8.2',
  shellVersion: '1111111111111111',
};
let versionFetches = 0;

const serviceWorker = {
  controller: null,
  async getRegistration() {
    return { active: activeWorker, waiting: waitingWorker } as ServiceWorkerRegistration;
  },
};
const navigatorMock = {
  get onLine() {
    return online;
  },
  serviceWorker,
};
const cachesMock = {
  async keys() {
    return cacheNames;
  },
};
const windowMock = {
  location: { origin: 'https://version-check.test' },
  caches: cachesMock,
  setTimeout,
  clearTimeout,
};
const documentMock = {
  querySelector() {
    return { content: documentShellVersion };
  },
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
  value: documentMock,
});
Object.defineProperty(globalThis, 'caches', {
  configurable: true,
  value: cachesMock,
});
globalThis.fetch = async () => {
  versionFetches += 1;
  return Response.json(latestManifest);
};

try {
  const currentResult = await checkLatestPageVersion();
  assert.equal(currentResult.updateAvailable, false);
  assert.equal(currentResult.current.shellVersion, '1111111111111111');
  assert.equal(versionFetches, 1, 'version check should fetch only the lightweight manifest');

  latestManifest = { ...latestManifest, shellVersion: '2222222222222222' };
  const shellUpdateResult = await checkLatestPageVersion();
  assert.equal(shellUpdateResult.updateAvailable, true, 'a different server shell must be offered');
  assert.deepEqual(cacheNames, ['dmg-app-shell-1111111111111111']);

  cacheNames = ['dmg-app-shell-2222222222222222'];
  documentShellVersion = '2222222222222222';
  latestManifest = { ...latestManifest, releaseVersion: '1.8.3' };
  assert.equal(
    (await checkLatestPageVersion()).updateAvailable,
    true,
    'a different release version must be offered even when shell identifiers match',
  );

  latestManifest = { ...latestManifest, releaseVersion: '1.8.2' };
  activeWorker = {} as ServiceWorker;
  waitingWorker = {} as ServiceWorker;
  assert.equal(
    (await checkLatestPageVersion()).updateAvailable,
    true,
    'an already downloaded waiting worker must still require user activation',
  );

  online = false;
  await assert.rejects(checkLatestPageVersion(), /离线状态/);
  assert.equal(versionFetches, 4, 'offline checks must not issue a network request');
} finally {
  globalThis.fetch = originalFetch;
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete (globalThis as { navigator?: Navigator }).navigator;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete (globalThis as { window?: Window }).window;
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else delete (globalThis as { document?: Document }).document;
  if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches);
  else delete (globalThis as { caches?: CacheStorage }).caches;
}

console.log('Automatic page version check contract: PASS');
