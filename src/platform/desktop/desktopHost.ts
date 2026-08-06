export type DesktopCapabilities = {
  host: 'desktop';
  shell: true;
  releaseTools: {
    images: boolean;
    data: boolean;
  };
  agent: {
    available: false;
    reason: string;
  };
  mcp: {
    available: false;
    reason: string;
  };
};

export type DesktopAppInfo = {
  name: string;
  version: string;
  platform: string;
  arch: string;
  origin: string;
};

export type DesktopSettings = {
  scale: string;
  availableScales: string[];
};

export type DesktopDialogResult = {
  ok: boolean;
  canceled?: boolean;
  path?: string;
  error?: string;
};

export type DesktopReleaseResult = {
  ok: boolean;
  error?: string;
  result?: {
    outputDir: string;
    manifestPath: string;
    packagePaths: string[];
    totalFiles?: number;
    assetVersion?: string;
    version?: string;
  };
};

export type DesktopHost = {
  getCapabilities(): Promise<DesktopCapabilities>;
  getAppInfo(): Promise<DesktopAppInfo>;
  getSettings(): Promise<DesktopSettings>;
  setScale(scale: string): Promise<{ ok: boolean; scale: string }>;
  quit(): Promise<{ ok: boolean }>;
  onBeforeQuit(callback: () => void): () => void;
  confirmReadyToQuit(): void;
  pickImageReleaseSource(): Promise<DesktopDialogResult>;
  pickDataReleaseSource(): Promise<DesktopDialogResult>;
  pickReleaseOutput(): Promise<DesktopDialogResult>;
  buildImageRelease(options: {
    assetVersion: string;
    releaseTag?: string;
  }): Promise<DesktopReleaseResult>;
  buildDataRelease(options: {
    dataVersion: string;
  }): Promise<DesktopReleaseResult>;
  revealPath(path: string): Promise<DesktopDialogResult>;
};

declare global {
  interface Window {
    desktopHost?: DesktopHost;
  }
}

export function readDesktopHost(): DesktopHost | null {
  if (typeof window === 'undefined') return null;
  return window.desktopHost || null;
}

export function isDesktopRuntime(): boolean {
  return readDesktopHost() !== null;
}
