import { APP_VERSION } from './appVersion';

const PAGE_VERSION_PATH = '/version.json';
const PAGE_VERSION_META_NAME = 'dmg-app-shell-version';
const APP_SHELL_CACHE_PREFIX = 'dmg-app-shell-';
const CONTROLLER_VERSION_TIMEOUT_MS = 750;
const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHELL_VERSION_PATTERN = /^[a-f0-9]{16}$/;

export type PageVersionManifest = {
  schemaVersion: 1;
  releaseVersion: string;
  shellVersion: string;
};

export type PageVersionCheckResult = {
  current: PageVersionManifest;
  latest: PageVersionManifest;
  updateAvailable: boolean;
};

function isPageVersionManifest(value: unknown): value is PageVersionManifest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PageVersionManifest>;
  return candidate.schemaVersion === 1
    && typeof candidate.releaseVersion === 'string'
    && RELEASE_VERSION_PATTERN.test(candidate.releaseVersion)
    && typeof candidate.shellVersion === 'string'
    && (
      SHELL_VERSION_PATTERN.test(candidate.shellVersion)
      || candidate.shellVersion === 'development'
    );
}

function readDocumentShellVersion(): string {
  return document
    .querySelector<HTMLMetaElement>(`meta[name="${PAGE_VERSION_META_NAME}"]`)
    ?.content
    .trim() || 'unknown';
}

async function readControllerVersion(): Promise<PageVersionManifest | null> {
  if (!('serviceWorker' in navigator)) return null;
  const controller = navigator.serviceWorker.controller;
  if (!controller) return null;
  if (typeof MessageChannel === 'undefined') return null;

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = (value: PageVersionManifest | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      channel.port1.close();
      resolve(value);
    };
    const timeout = window.setTimeout(() => finish(null), CONTROLLER_VERSION_TIMEOUT_MS);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      finish(isPageVersionManifest(event.data) ? event.data : null);
    };
    try {
      controller.postMessage(
        { type: 'GET_PAGE_VERSION' },
        [channel.port2],
      );
    } catch {
      finish(null);
    }
  });
}

async function readCachedShellVersions(): Promise<string[]> {
  if (!('caches' in window)) return [];
  try {
    return (await caches.keys())
      .filter((name) => name.startsWith(APP_SHELL_CACHE_PREFIX))
      .map((name) => name.slice(APP_SHELL_CACHE_PREFIX.length))
      .filter((version) => SHELL_VERSION_PATTERN.test(version));
  } catch {
    return [];
  }
}

function selectCurrentShellVersion(
  cachedVersions: string[],
  documentVersion: string,
  latestVersion: string,
  hasWaitingWorker: boolean,
): string {
  if (cachedVersions.length === 1) return cachedVersions[0];
  if (cachedVersions.length > 1) {
    if (hasWaitingWorker) {
      return cachedVersions.find((version) => version !== latestVersion)
        || cachedVersions[0];
    }
    if (cachedVersions.includes(documentVersion)) return documentVersion;
    return cachedVersions.find((version) => version !== latestVersion)
      || cachedVersions[0];
  }
  return documentVersion;
}

export async function checkLatestPageVersion(): Promise<PageVersionCheckResult> {
  if (!navigator.onLine) {
    throw new Error('当前处于离线状态，暂时无法检查页面版本。');
  }

  const versionUrl = new URL(PAGE_VERSION_PATH, window.location.origin);
  versionUrl.searchParams.set('check', String(Date.now()));
  const response = await fetch(versionUrl, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`无法检查服务器版本（HTTP ${response.status}）。`);
  }

  const payload: unknown = await response.json();
  if (!isPageVersionManifest(payload)) {
    throw new Error('服务器返回的版本信息无效。');
  }

  const registration = 'serviceWorker' in navigator
    ? await navigator.serviceWorker.getRegistration('/')
    : undefined;
  const [controllerVersion, cachedVersions] = await Promise.all([
    readControllerVersion(),
    readCachedShellVersions(),
  ]);
  const documentVersion = readDocumentShellVersion();
  const hasWaitingUpdate = Boolean(
    registration?.waiting
    && (registration.active || navigator.serviceWorker.controller),
  );
  const current = controllerVersion || {
    schemaVersion: 1,
    releaseVersion: APP_VERSION,
    shellVersion: selectCurrentShellVersion(
      cachedVersions,
      documentVersion,
      payload.shellVersion,
      hasWaitingUpdate,
    ),
  };
  const comparableShellVersions = SHELL_VERSION_PATTERN.test(current.shellVersion)
    && SHELL_VERSION_PATTERN.test(payload.shellVersion);
  const updateAvailable = hasWaitingUpdate
    || current.releaseVersion !== payload.releaseVersion
    || (comparableShellVersions && current.shellVersion !== payload.shellVersion);

  return {
    current,
    latest: payload,
    updateAvailable,
  };
}
