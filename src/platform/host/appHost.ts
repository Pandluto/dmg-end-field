import type { ReactNode } from 'react';
import type { InstalledImagePackage } from '../resources/imagePackage';
import type { InstalledResourcePackage } from '../resources/resourcePackage';

export type HostRouteResolution = {
  node: ReactNode;
  kind?: 'page' | 'exclusive';
  activatesWorkspace?: boolean;
  boundaryKey?: string;
};

export type HostWorkspaceResourceState = {
  resourcePackage: InstalledResourcePackage | null;
  imagePackage: InstalledImagePackage | null;
};

export type HostWorkspaceLifecycle = {
  skipAccessGate?: boolean;
  requestControlWhenSecondary?: boolean;
  startupLabel?: () => string;
  prepare?: () => Promise<void>;
  afterDatabaseReady?: () => Promise<void> | void;
  afterStorageReady?: () => Promise<void> | void;
  afterResourcesReady?: (state: HostWorkspaceResourceState) => Promise<void> | void;
  afterResourcesInstalled?: (state: {
    resourcePackage: InstalledResourcePackage;
    imagePackage: InstalledImagePackage;
  }) => Promise<void> | void;
  beforeRelease?: () => Promise<void> | void;
  serviceWorkerFailureMessage?: (defaultMessage: string) => string;
  renderFailure?: (message: string, retry: () => void) => ReactNode;
};

export type AppHostExtension = {
  id: string;
  beforeMount?: () => Promise<void> | void;
  workspace?: HostWorkspaceLifecycle;
  routes?: {
    isWorkspacePath?: (path: string) => boolean;
    resolve?: (path: string) => HostRouteResolution | null;
  };
  ui?: {
    showPageVersionUpdate?: boolean;
    showAccessSettings?: boolean;
    showLocalResourcePackager?: boolean;
  };
};

const WEB_HOST_EXTENSION: Readonly<AppHostExtension> = Object.freeze({
  id: 'web',
  workspace: Object.freeze({
    skipAccessGate: false,
    requestControlWhenSecondary: false,
  }),
  ui: Object.freeze({
    showPageVersionUpdate: true,
    showAccessSettings: true,
    showLocalResourcePackager: true,
  }),
});

let activeHostExtension: AppHostExtension = WEB_HOST_EXTENSION;

function normalizeHostExtension(extension: AppHostExtension): AppHostExtension {
  if (!extension || typeof extension.id !== 'string' || !extension.id.trim()) {
    throw new TypeError('App host extension requires a non-empty id.');
  }
  return Object.freeze({
    ...WEB_HOST_EXTENSION,
    ...extension,
    id: extension.id.trim(),
    workspace: Object.freeze({
      ...WEB_HOST_EXTENSION.workspace,
      ...extension.workspace,
    }),
    routes: extension.routes ? Object.freeze({ ...extension.routes }) : undefined,
    ui: Object.freeze({
      ...WEB_HOST_EXTENSION.ui,
      ...extension.ui,
    }),
  });
}

export function installAppHostExtension(extension: AppHostExtension): () => void {
  const previous = activeHostExtension;
  const installed = normalizeHostExtension(extension);
  activeHostExtension = installed;
  return () => {
    if (activeHostExtension === installed) activeHostExtension = previous;
  };
}

export function getAppHostExtension(): AppHostExtension {
  return activeHostExtension;
}

export function resetAppHostExtensionForTests(): void {
  activeHostExtension = WEB_HOST_EXTENSION;
}
