// ── ImageManager Communication Layer ──
// Unified entry point for desktop IPC and browser bridge HTTP transport.
// Does NOT contain path rules, file-system logic, or page state.
// Path semantics belong to imageFileService.ts.

import type { ImageAssetEntry } from '../components/ImageManager/types';
import {
  validateManagedDirPath,
  validateManagedFilePath,
  toUserImageRelPath,
} from './imageFileService';

const BRIDGE_ORIGIN = 'http://127.0.0.1:31457';
const BRIDGE_TIMEOUT_MS = 15000;
const CAPABILITY_TIMEOUT_MS = 2500;

type CapListener = (caps: ImageManagerCapabilities) => void;

interface BridgeCapabilityPayload {
  canList: boolean;
  canImport: boolean;
  canRename: boolean;
  canRenameDir: boolean;
  canDeleteFile: boolean;
  canCreateDir: boolean;
  canDeleteDir: boolean;
  canReveal: boolean;
  canManageRoots?: boolean;
  primaryRoot?: string;
  rootsConfigPath?: string;
  backendLabel?: string;
  transportKind?: ImageManagerCapabilities['transportKind'];
}

export interface ImageManagerCapabilities {
  canList: boolean;
  canImport: boolean;
  canRename: boolean;
  canRenameDir: boolean;
  canDeleteFile: boolean;
  canCreateDir: boolean;
  canDeleteDir: boolean;
  canReveal: boolean;
  canManageRoots?: boolean;
  primaryRoot?: string;
  rootsConfigPath?: string;
  isElectron: boolean;
  isWritable: boolean;
  backendLabel: string;
  transportKind: 'electron' | 'web-bridge' | 'browser-readonly';
}

function hasHostMethod(name: string): boolean {
  const rt = window.desktopRuntime;
  if (!rt) return false;
  return typeof (rt as unknown as Record<string, unknown>)[name] === 'function';
}

function buildCapabilities(
  partial: Omit<ImageManagerCapabilities, 'isWritable'>,
): ImageManagerCapabilities {
  const isWritable = partial.canImport
    && partial.canRename
    && partial.canRenameDir
    && partial.canDeleteFile
    && partial.canCreateDir
    && partial.canDeleteDir;
  return {
    ...partial,
    isWritable,
  };
}

function getDesktopCapabilities(): ImageManagerCapabilities {
  const canList = hasHostMethod('listImageAssets');
  const canImport = hasHostMethod('importImageAssetsToDir');
  const canRename = hasHostMethod('renameImageAsset');
  const canRenameDir = hasHostMethod('renameImageDirectory');
  const canDeleteFile = hasHostMethod('deleteImageAsset');
  const canCreateDir = hasHostMethod('createImageDirectory');
  const canDeleteDir = hasHostMethod('deleteImageDirectory');
  const canReveal = hasHostMethod('revealInExplorer');
  const isWritable = canImport && canRename && canRenameDir && canDeleteFile && canCreateDir && canDeleteDir;

  return {
    canList,
    canImport,
    canRename,
    canRenameDir,
    canDeleteFile,
    canCreateDir,
    canDeleteDir,
    canReveal,
    isElectron: true,
    isWritable,
    backendLabel: isWritable ? '桌面端 · 可管理' : '桌面端 · 受限',
    transportKind: 'electron',
  };
}

function getBrowserReadonlyCapabilities(): ImageManagerCapabilities {
  return buildCapabilities({
    canList: true,
    canImport: false,
    canRename: false,
    canRenameDir: false,
    canDeleteFile: false,
    canCreateDir: false,
    canDeleteDir: false,
    canReveal: false,
    isElectron: false,
    backendLabel: '浏览器端 · 只读预览',
    transportKind: 'browser-readonly',
  });
}

function getWebBridgeCapabilities(payload: BridgeCapabilityPayload): ImageManagerCapabilities {
  return buildCapabilities({
    canList: Boolean(payload.canList),
    canImport: Boolean(payload.canImport),
    canRename: Boolean(payload.canRename),
    canRenameDir: Boolean(payload.canRenameDir),
    canDeleteFile: Boolean(payload.canDeleteFile),
    canCreateDir: Boolean(payload.canCreateDir),
    canDeleteDir: Boolean(payload.canDeleteDir),
    canReveal: Boolean(payload.canReveal),
    canManageRoots: Boolean(payload.canManageRoots),
    primaryRoot: payload.primaryRoot,
    rootsConfigPath: payload.rootsConfigPath,
    isElectron: false,
    backendLabel: payload.backendLabel || '网页端 · 远程管理',
    transportKind: payload.transportKind || 'web-bridge',
  });
}

let currentCapabilities = hasHostMethod('listImageAssets')
  ? getDesktopCapabilities()
  : getBrowserReadonlyCapabilities();

const capabilityListeners = new Set<CapListener>();
let capabilityRefreshPromise: Promise<ImageManagerCapabilities> | null = null;

function notifyCapabilityListeners() {
  for (const listener of capabilityListeners) {
    listener(currentCapabilities);
  }
}

function setCapabilities(next: ImageManagerCapabilities): ImageManagerCapabilities {
  currentCapabilities = next;
  notifyCapabilityListeners();
  return currentCapabilities;
}

function isDesktopTransport(): boolean {
  return hasHostMethod('listImageAssets');
}

async function fetchBridgeJson<T>(
  pathname: string,
  init?: RequestInit,
  timeoutMs = BRIDGE_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BRIDGE_ORIGIN}${pathname}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        typeof (data as { error?: unknown }).error === 'string'
          ? (data as { error: string }).error
          : `HTTP ${response.status}`,
      );
    }
    return data as T;
  } finally {
    window.clearTimeout(timer);
  }
}

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error(`读取文件失败: ${file.name}`));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const [, base64 = ''] = result.split(',', 2);
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

async function pickBrowserImportItems(): Promise<{ fileName: string; data: string }[] | null> {
  if (typeof document === 'undefined') return null;

  const files = await new Promise<File[] | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.png,.jpg,.jpeg,.webp,.gif,.svg';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.top = '-9999px';

    let settled = false;
    const finish = (picked: File[] | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', handleFocus, true);
      input.remove();
      resolve(picked);
    };
    const handleFocus = () => {
      window.setTimeout(() => {
        if (!settled) finish(null);
      }, 300);
    };

    input.addEventListener('change', () => {
      const picked = input.files ? Array.from(input.files) : [];
      finish(picked.length > 0 ? picked : null);
    }, { once: true });

    window.addEventListener('focus', handleFocus, true);
    document.body.appendChild(input);
    input.click();
  });

  if (!files || files.length === 0) return null;

  const items = await Promise.all(files.map(async (file) => ({
    fileName: file.name,
    data: await readFileAsBase64(file),
  })));
  return items;
}

function requireCapability(cap: keyof ImageManagerCapabilities): { ok: true } | { ok: false; error: string } {
  const caps = getCapabilities();
  if (!caps[cap]) {
    return { ok: false, error: '当前环境不支持此操作' };
  }
  return { ok: true };
}

export function getCapabilities(): ImageManagerCapabilities {
  return currentCapabilities;
}

export function subscribeCapabilities(listener: CapListener): () => void {
  capabilityListeners.add(listener);
  return () => {
    capabilityListeners.delete(listener);
  };
}

export async function refreshCapabilities(): Promise<ImageManagerCapabilities> {
  if (isDesktopTransport()) {
    return setCapabilities(getDesktopCapabilities());
  }

  if (capabilityRefreshPromise) return capabilityRefreshPromise;

  capabilityRefreshPromise = (async () => {
    try {
      const response = await fetchBridgeJson<{ ok: boolean; capabilities: BridgeCapabilityPayload }>(
        '/image-assets/capabilities',
        { method: 'GET' },
        CAPABILITY_TIMEOUT_MS,
      );
      if (!response.ok) {
        return setCapabilities(getBrowserReadonlyCapabilities());
      }
      return setCapabilities(getWebBridgeCapabilities(response.capabilities));
    } catch {
      return setCapabilities(getBrowserReadonlyCapabilities());
    } finally {
      capabilityRefreshPromise = null;
    }
  })();

  return capabilityRefreshPromise;
}

/** Build a URL for a user image served by the Electron bridge HTTP server. */
export function getUserImageUrl(entry: ImageAssetEntry): string | null {
  const rel = toUserImageRelPath(entry);
  if (!rel) return null;
  const encodedRel = rel.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  if (!encodedRel) return null;
  return `${BRIDGE_ORIGIN}/user-images/${encodedRel}`;
}

export const imageBridge = {
  getCapabilities,
  subscribeCapabilities,
  refreshCapabilities,

  async listAssets(): Promise<ImageAssetEntry[]> {
    if (isDesktopTransport()) {
      const list = await window.desktopRuntime!.listImageAssets!();
      setCapabilities(getDesktopCapabilities());
      return list;
    }

    try {
      const response = await fetchBridgeJson<{ ok: boolean; items: ImageAssetEntry[] }>('/image-assets/list', { method: 'GET' });
      void refreshCapabilities();
      return response.items;
    } catch {
      setCapabilities(getBrowserReadonlyCapabilities());
      const { resolvePublicPath } = await import('./assetResolver');
      // Legacy browser fallback endpoint. Although the path is assets/images/_manifest.json,
      // the manifest may contain the full builtin asset image set.
      const url = resolvePublicPath('assets/images/_manifest.json');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }
  },

  async importToDir(targetDir?: string): Promise<{ ok: boolean; error?: string; imported?: string[] }> {
    if (isDesktopTransport()) {
      const result = await window.desktopRuntime!.importImageAssetsToDir!({ targetDir });
      setCapabilities(getDesktopCapabilities());
      return result;
    }

    const cap = requireCapability('canImport');
    if (!cap.ok) return cap;

    const items = await pickBrowserImportItems();
    if (!items) return { ok: false, error: '已取消' };

    const response = await fetchBridgeJson<{ ok: boolean; error?: string; results?: { fileName: string; ok: boolean; error?: string }[] }>(
      '/image-assets/import-from-browser',
      {
        method: 'POST',
        body: JSON.stringify({ items, targetDir }),
      },
    );

    return {
      ok: response.ok,
      error: response.error,
      imported: response.results?.filter((item) => item.ok).map((item) => item.fileName),
    };
  },

  async createDirectory(dirName: string, parentDir?: string): Promise<{ ok: boolean; error?: string; createdPath?: string }> {
    if (isDesktopTransport()) {
      const result = await window.desktopRuntime!.createImageDirectory!({ dirName, parentDir });
      setCapabilities(getDesktopCapabilities());
      return result;
    }

    const cap = requireCapability('canCreateDir');
    if (!cap.ok) return cap;

    return fetchBridgeJson('/image-assets/create-directory', {
      method: 'POST',
      body: JSON.stringify({ dirName, parentDir }),
    });
  },

  async deleteDirectory(relativePath: string): Promise<{ ok: boolean; error?: string; lockedFiles?: string[] }> {
    if (isDesktopTransport()) {
      const result = await window.desktopRuntime!.deleteImageDirectory!({ relativePath });
      setCapabilities(getDesktopCapabilities());
      return result;
    }

    const cap = requireCapability('canDeleteDir');
    if (!cap.ok) return cap;

    return fetchBridgeJson('/image-assets/delete-directory', {
      method: 'POST',
      body: JSON.stringify({ relativePath }),
    });
  },

  async renameFile(relativePath: string, newName: string): Promise<{ ok: boolean; error?: string }> {
    if (isDesktopTransport()) {
      const result = await window.desktopRuntime!.renameImageAsset!({ relativePath, newName });
      setCapabilities(getDesktopCapabilities());
      return result;
    }

    const cap = requireCapability('canRename');
    if (!cap.ok) return cap;

    return fetchBridgeJson('/image-assets/rename-file', {
      method: 'POST',
      body: JSON.stringify({ relativePath, newName }),
    });
  },

  async renameDirectory(dirPath: string, newName: string): Promise<{ ok: boolean; error?: string; newPath?: string }> {
    if (isDesktopTransport()) {
      const result = await window.desktopRuntime!.renameImageDirectory!({ dirPath, newName });
      setCapabilities(getDesktopCapabilities());
      return result;
    }

    const cap = requireCapability('canRenameDir');
    if (!cap.ok) return cap;

    return fetchBridgeJson('/image-assets/rename-directory', {
      method: 'POST',
      body: JSON.stringify({ dirPath, newName }),
    });
  },

  async deleteFile(relativePath: string): Promise<{ ok: boolean; error?: string }> {
    if (isDesktopTransport()) {
      const result = await window.desktopRuntime!.deleteImageAsset!({ relativePath });
      setCapabilities(getDesktopCapabilities());
      return result;
    }

    const cap = requireCapability('canDeleteFile');
    if (!cap.ok) return cap;

    return fetchBridgeJson('/image-assets/delete-file', {
      method: 'POST',
      body: JSON.stringify({ relativePath }),
    });
  },

  async revealFile(relativePath: string): Promise<{ ok: boolean; error?: string }> {
    const validated = validateManagedFilePath(relativePath);
    if (!validated.ok) return validated;

    if (isDesktopTransport()) {
      const result = await window.desktopRuntime!.revealInExplorer!({ kind: 'file', relativePath: validated.normalized });
      setCapabilities(getDesktopCapabilities());
      return result;
    }

    const cap = requireCapability('canReveal');
    if (!cap.ok) return cap;

    return fetchBridgeJson('/image-assets/reveal-file', {
      method: 'POST',
      body: JSON.stringify({ relativePath: validated.normalized }),
    });
  },

  async revealDirectory(dirPath: string): Promise<{ ok: boolean; error?: string }> {
    const validated = validateManagedDirPath(dirPath);
    if (!validated.ok) return validated;

    if (isDesktopTransport()) {
      const result = await window.desktopRuntime!.revealInExplorer!({ kind: 'dir', dirPath: validated.normalized });
      setCapabilities(getDesktopCapabilities());
      return result;
    }

    const cap = requireCapability('canReveal');
    if (!cap.ok) return cap;

    return fetchBridgeJson('/image-assets/reveal-directory', {
      method: 'POST',
      body: JSON.stringify({ dirPath: validated.normalized }),
    });
  },
};

export { isManagedDir, normalizeDir } from './imageFileService';
