import type { ImageAssetEntry } from '../components/ImageManager/types';

// ── Managed directory constants ──

const MANAGED_REL = 'assets/images';
const MANAGED_TOP = 'images';

// ── Capability detection ──

function hasHostMethod(name: string): boolean {
  const rt = window.desktopRuntime;
  if (!rt) return false;
  return typeof (rt as unknown as Record<string, unknown>)[name] === 'function';
}

// ── Unified host API ──

export const assetHostApi = {
  // ── Capabilities (all derived from real backend presence) ──

  get canList(): boolean {
    return hasHostMethod('listImageAssets');
  },
  get canImport(): boolean {
    return hasHostMethod('importImageAssets') || hasHostMethod('importImageAssetsFromBrowser');
  },
  get canRename(): boolean {
    return hasHostMethod('renameImageAsset');
  },
  get canDeleteFile(): boolean {
    return hasHostMethod('deleteImageAsset');
  },
  get canCreateDir(): boolean {
    return hasHostMethod('createImageDirectory');
  },
  get canDeleteDir(): boolean {
    return hasHostMethod('deleteImageDirectory');
  },
  get isElectron(): boolean {
    return hasHostMethod('listImageAssets');
  },

  /** Human-readable backend status for UI hints. */
  get backendLabel(): string {
    if (this.isElectron) {
      const writable = this.canImport || this.canCreateDir;
      return writable ? '桌面端 · 可管理' : '桌面端 · 只读浏览';
    }
    return '浏览器端 · 只读（未接入宿主）';
  },

  // ── Operations ──

  async listAssets(): Promise<ImageAssetEntry[]> {
    if (hasHostMethod('listImageAssets')) {
      return window.desktopRuntime!.listImageAssets!();
    }
    const { resolvePublicPath } = await import('./assetResolver');
    const url = resolvePublicPath(`${MANAGED_REL}/_manifest.json`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async importFiles(
    items: { fileName: string; data: string }[],
    targetDir?: string,
  ): Promise<{ ok: boolean; results: { fileName: string; ok: boolean; error?: string }[]; error?: string }> {
    if (!hasHostMethod('importImageAssetsFromBrowser')) {
      return { ok: false, results: [], error: '当前环境不支持导入' };
    }
    return window.desktopRuntime!.importImageAssetsFromBrowser!({ items, targetDir });
  },

  async createDirectory(
    dirName: string,
    parentDir?: string,
  ): Promise<{ ok: boolean; error?: string; createdPath?: string }> {
    if (!hasHostMethod('createImageDirectory')) {
      return { ok: false, error: '当前环境不支持创建目录' };
    }
    return window.desktopRuntime!.createImageDirectory!({ dirName, parentDir });
  },

  async deleteDirectory(
    relativePath: string,
  ): Promise<{ ok: boolean; error?: string; lockedFiles?: string[] }> {
    if (!hasHostMethod('deleteImageDirectory')) {
      return { ok: false, error: '当前环境不支持删除目录' };
    }
    return window.desktopRuntime!.deleteImageDirectory!({ relativePath });
  },

  async renameFile(
    relativePath: string,
    newName: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!hasHostMethod('renameImageAsset')) {
      return { ok: false, error: '当前环境不支持重命名' };
    }
    return window.desktopRuntime!.renameImageAsset!({ relativePath, newName });
  },

  async deleteFile(
    relativePath: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!hasHostMethod('deleteImageAsset')) {
      return { ok: false, error: '当前环境不支持删除文件' };
    }
    return window.desktopRuntime!.deleteImageAsset!({ relativePath });
  },
};

// ── Managed directory helpers ──

/** Check whether a frontend dir path belongs to the managed tree. */
export function isManagedDir(dir: string): boolean {
  return dir === MANAGED_TOP || dir.startsWith(MANAGED_TOP + '/');
}

/** Convert a frontend dir path to backend-relative (strip "images" prefix). Returns undefined for non-managed. */
export function toManagedRelative(dir: string): string | undefined {
  if (!dir) return undefined;
  if (dir === MANAGED_TOP) return undefined;
  if (dir.startsWith(MANAGED_TOP + '/')) return dir.slice(MANAGED_TOP.length + 1);
  return undefined;
}

/** Resolve a backend-relative path back to a frontend dir path. */
export function fromManagedRelative(rel: string | undefined): string {
  if (!rel) return MANAGED_TOP;
  return `${MANAGED_TOP}/${rel}`;
}

/** Format a relativePath into a human-readable directory label. */
export function managedDirLabel(relativePath: string): string {
  const prefix = `${MANAGED_REL}/`;
  if (!relativePath.startsWith(prefix)) {
    const parts = relativePath.split('/');
    parts.pop();
    return parts.join('/') || '/';
  }
  const stripped = relativePath.slice(prefix.length);
  const i = stripped.lastIndexOf('/');
  return i === -1 ? '/' : stripped.slice(0, i);
}
