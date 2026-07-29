import type { ImageAssetEntry } from '../components/ImageManager/types';
import { webDatabase, type SqlPrimitive, type SqlStatement } from '../platform/database/webDatabase';
import {
  validateManagedDirPath,
  validateManagedFilePath,
  toUserImageRelPath,
} from './imageFileService';

type CapListener = (caps: ImageManagerCapabilities) => void;
type ImageRow = Record<string, SqlPrimitive>;

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
  transportKind: 'browser-sqlite';
}

const BROWSER_CAPABILITIES: ImageManagerCapabilities = {
  canList: true,
  canImport: true,
  canRename: true,
  canRenameDir: true,
  canDeleteFile: true,
  canCreateDir: true,
  canDeleteDir: true,
  canReveal: false,
  canManageRoots: false,
  isElectron: false,
  isWritable: true,
  backendLabel: '浏览器 SQLite · 可管理',
  transportKind: 'browser-sqlite',
};

const ALLOWED_IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.svg',
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

let currentCapabilities = BROWSER_CAPABILITIES;
let builtinManifest: ImageAssetEntry[] | null = null;
let hydrationPromise: Promise<void> | null = null;
const capabilityListeners = new Set<CapListener>();
const objectUrlByPath = new Map<string, string>();
const staticPathByFileName = new Map<string, string>();
const userPathByFileName = new Map<string, string>();

function notifyCapabilityListeners(): void {
  capabilityListeners.forEach((listener) => listener(currentCapabilities));
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

function normalizeBaseUrl(): string {
  const base = import.meta.env.BASE_URL || '/';
  return base.endsWith('/') ? base : `${base}/`;
}

function staticAssetUrl(relativePath: string): string {
  return `${normalizeBaseUrl()}${normalizeSlashes(relativePath)}`;
}

function fileParts(fileName: string): { baseName: string; ext: string } {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return { baseName: fileName, ext: '' };
  return {
    baseName: fileName.slice(0, dot),
    ext: fileName.slice(dot).toLowerCase(),
  };
}

function validateName(value: string, kind: 'file' | 'directory'): string {
  const name = value.trim();
  if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name)) {
    throw new Error(`${kind === 'file' ? '文件' : '目录'}名称无效`);
  }
  return name;
}

function normalizeManagedSubdirectory(value?: string): string {
  if (!value) return '';
  const normalized = normalizeSlashes(value).replace(/\/+$/, '');
  if (
    !normalized
    || normalized === '.'
    || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('目标目录无效');
  }
  return normalized;
}

function toBytes(value: SqlPrimitive | undefined): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

function revokeObjectUrl(relativePath: string): void {
  const previous = objectUrlByPath.get(relativePath);
  if (!previous) return;
  URL.revokeObjectURL(previous);
  objectUrlByPath.delete(relativePath);
}

function registerObjectUrl(
  relativePath: string,
  mimeType: string,
  content: Uint8Array,
): string {
  revokeObjectUrl(relativePath);
  const bytes = new Uint8Array(content);
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType || 'application/octet-stream' }));
  objectUrlByPath.set(relativePath, url);
  const fileName = relativePath.split('/').pop();
  if (fileName) userPathByFileName.set(fileName, relativePath);
  return url;
}

function rowToEntry(row: ImageRow): ImageAssetEntry {
  const relativePath = String(row.relative_path || '');
  const fileName = String(row.file_name || relativePath.split('/').pop() || '');
  const mimeType = String(row.mime_type || '');
  const kind = mimeType === 'inode/directory' ? 'dir' : 'file';
  return {
    kind,
    fileName,
    baseName: String(row.base_name || fileParts(fileName).baseName),
    ext: String(row.extension || fileParts(fileName).ext),
    relativePath,
    source: 'user',
    canonicalPath: kind === 'file'
      ? `user-images/${relativePath.replace(/^assets\/images\//, '')}`
      : undefined,
    rootId: 'browser-sqlite',
    rootLabel: '浏览器自定义图片',
    rootPriority: 100,
    writable: true,
    sizeBytes: Number(row.size_bytes || 0),
    updatedAt: Number(row.updated_at || 0),
  };
}

async function loadBuiltinManifest(): Promise<ImageAssetEntry[]> {
  if (builtinManifest) return builtinManifest;
  const response = await fetch(staticAssetUrl('web-image-manifest.json'), {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`图片索引加载失败：HTTP ${response.status}`);
  const payload = await response.json() as {
    generatedAt?: string;
    files?: Array<{ path: string; size: number }>;
  };
  const updatedAt = Date.parse(payload.generatedAt || '') || 0;
  builtinManifest = Array.isArray(payload.files)
    ? payload.files.map((entry) => {
      const fileName = entry.path.split('/').pop() || entry.path;
      const { baseName, ext } = fileParts(fileName);
      return {
        fileName,
        baseName,
        ext,
        relativePath: entry.path,
        sizeBytes: entry.size,
        updatedAt,
        writable: false,
        source: 'release',
        rootId: 'release',
        rootLabel: '官方图片包',
        rootPriority: -1,
      };
    })
    : [];
  staticPathByFileName.clear();
  for (const entry of builtinManifest) {
    if (entry.kind === 'dir') continue;
    const existing = staticPathByFileName.get(entry.fileName);
    const preferred = !existing
      || entry.relativePath.includes('/icon_cn/')
      || entry.source === 'release';
    if (preferred) staticPathByFileName.set(entry.fileName, entry.relativePath);
  }
  return builtinManifest;
}

async function loadUserRows(): Promise<ImageRow[]> {
  return webDatabase.query<ImageRow>(
    'SELECT * FROM image_assets ORDER BY relative_path ASC',
  );
}

function hydrateRows(rows: ImageRow[]): void {
  const present = new Set<string>();
  userPathByFileName.clear();
  for (const row of rows) {
    const relativePath = String(row.relative_path || '');
    if (!relativePath || String(row.mime_type || '') === 'inode/directory') continue;
    present.add(relativePath);
    const content = toBytes(row.content);
    if (content) registerObjectUrl(relativePath, String(row.mime_type || ''), content);
  }
  for (const path of [...objectUrlByPath.keys()]) {
    if (!present.has(path)) revokeObjectUrl(path);
  }
}

export async function hydrateBrowserImageAssets(): Promise<void> {
  if (hydrationPromise) return hydrationPromise;
  hydrationPromise = Promise.all([loadBuiltinManifest(), loadUserRows()])
    .then(([, rows]) => {
      hydrateRows(rows);
    })
    .finally(() => {
      hydrationPromise = null;
    });
  return hydrationPromise;
}

function resolveLegacyUserImagePath(relativePath: string): string {
  const normalized = normalizeSlashes(relativePath)
    .replace(/^user-images\//, '')
    .replace(/^data\/images\//, '');
  if (normalized.startsWith('img-equipment/') && !normalized.startsWith('img-equipment/icon_cn/')) {
    return `assets/images/img-equipment/icon_cn/${normalized.slice('img-equipment/'.length)}`;
  }
  if (normalized.startsWith('images/')) return `assets/images/${normalized}`;
  if (normalized.includes('/')) return `assets/images/${normalized}`;
  return userPathByFileName.get(normalized)
    || staticPathByFileName.get(normalized)
    || `assets/images/${normalized}`;
}

/**
 * Resolve every browser-era, desktop-era and current image reference without
 * contacting localhost. User BLOBs become object URLs; release images retain
 * their canonical same-origin path and are fulfilled by the image pack cache.
 */
export function resolveBrowserImageUrl(path?: string | null): string | null {
  if (!path) return null;
  if (/^(?:data|blob):/i.test(path)) return path;
  let normalized = path;
  try {
    const url = new URL(path, window.location.href);
    if (url.hostname === '127.0.0.1' && url.port === '31457') {
      normalized = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    } else if (/^https?:/i.test(path) && url.origin !== window.location.origin) {
      return path;
    } else {
      normalized = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    }
  } catch {
    normalized = path;
  }
  normalized = normalizeSlashes(normalized);
  const relativePath = normalized.startsWith('user-images/')
    || normalized.startsWith('data/images/')
    ? resolveLegacyUserImagePath(normalized)
    : normalized.startsWith('assets/')
      ? normalized
      : staticPathByFileName.get(normalized.split('/').pop() || '') || normalized;
  return objectUrlByPath.get(relativePath) || staticAssetUrl(relativePath);
}

export function getCapabilities(): ImageManagerCapabilities {
  return currentCapabilities;
}

export function subscribeCapabilities(listener: CapListener): () => void {
  capabilityListeners.add(listener);
  return () => capabilityListeners.delete(listener);
}

export async function refreshCapabilities(): Promise<ImageManagerCapabilities> {
  await webDatabase.initialize();
  currentCapabilities = BROWSER_CAPABILITIES;
  notifyCapabilityListeners();
  return currentCapabilities;
}

export function getUserImageUrl(entry: ImageAssetEntry): string | null {
  const rel = toUserImageRelPath(entry);
  if (entry.source === 'user') {
    return objectUrlByPath.get(entry.relativePath)
      || (rel ? objectUrlByPath.get(`assets/images/${rel}`) || null : null);
  }
  return resolveBrowserImageUrl(entry.relativePath || entry.canonicalPath);
}

async function pickBrowserFiles(): Promise<File[] | null> {
  if (typeof document === 'undefined') return null;
  return new Promise<File[] | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.png,.jpg,.jpeg,.webp,.gif,.svg';
    input.hidden = true;
    let settled = false;
    const finish = (value: File[] | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', handleFocus, true);
      input.remove();
      resolve(value);
    };
    const handleFocus = () => {
      window.setTimeout(() => {
        if (!settled) finish(null);
      }, 300);
    };
    input.addEventListener('change', () => {
      const files = input.files ? Array.from(input.files) : [];
      finish(files.length ? files : null);
    }, { once: true });
    window.addEventListener('focus', handleFocus, true);
    document.body.appendChild(input);
    input.click();
  });
}

function fileUpsertStatement(
  relativePath: string,
  file: File,
  content: Uint8Array,
  updatedAt: number,
): SqlStatement {
  const { baseName, ext } = fileParts(file.name);
  if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
    throw new Error(`不支持的图片格式：${file.name}`);
  }
  return {
    sql: `
      INSERT INTO image_assets(
        relative_path, file_name, base_name, extension, mime_type, content,
        source, writable, size_bytes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'user', 1, ?, ?)
      ON CONFLICT(relative_path) DO UPDATE SET
        file_name = excluded.file_name,
        base_name = excluded.base_name,
        extension = excluded.extension,
        mime_type = excluded.mime_type,
        content = excluded.content,
        source = excluded.source,
        writable = excluded.writable,
        size_bytes = excluded.size_bytes,
        updated_at = excluded.updated_at
    `,
    bind: [
      relativePath,
      file.name,
      baseName,
      ext,
      file.type || MIME_BY_EXTENSION[ext] || 'application/octet-stream',
      content,
      content.byteLength,
      updatedAt,
    ],
  };
}

export const imageBridge = {
  getCapabilities,
  subscribeCapabilities,
  refreshCapabilities,

  async listAssets(): Promise<ImageAssetEntry[]> {
    const [builtin, rows] = await Promise.all([loadBuiltinManifest(), loadUserRows()]);
    hydrateRows(rows);
    const merged = new Map<string, ImageAssetEntry>();
    builtin.forEach((entry) => merged.set(entry.relativePath, {
      ...entry,
      writable: false,
      source: entry.source === 'user' ? 'release' : entry.source,
    }));
    rows.map(rowToEntry).forEach((entry) => merged.set(entry.relativePath, entry));
    return [...merged.values()];
  },

  async importToDir(
    targetDir?: string,
  ): Promise<{ ok: boolean; error?: string; imported?: string[] }> {
    try {
      const files = await pickBrowserFiles();
      if (!files) return { ok: false, error: '已取消' };
      const directory = normalizeManagedSubdirectory(targetDir);
      const updatedAt = Date.now();
      const prepared = await Promise.all(files.map(async (file) => {
        validateName(file.name, 'file');
        const content = new Uint8Array(await file.arrayBuffer());
        const relativePath = `assets/images/${directory ? `${directory}/` : ''}${file.name}`;
        return {
          file,
          content,
          relativePath,
          statement: fileUpsertStatement(relativePath, file, content, updatedAt),
        };
      }));
      await webDatabase.batch(prepared.map((item) => item.statement));
      for (const item of prepared) {
        registerObjectUrl(
          item.relativePath,
          item.file.type || MIME_BY_EXTENSION[fileParts(item.file.name).ext],
          item.content,
        );
      }
      return { ok: true, imported: prepared.map((item) => item.file.name) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  async createDirectory(
    dirName: string,
    parentDir?: string,
  ): Promise<{ ok: boolean; error?: string; createdPath?: string }> {
    try {
      const name = validateName(dirName, 'directory');
      const parent = normalizeManagedSubdirectory(parentDir);
      const createdPath = parent ? `${parent}/${name}` : name;
      const relativePath = `assets/images/${createdPath}`;
      await webDatabase.execute(
        `
          INSERT INTO image_assets(
            relative_path, file_name, base_name, extension, mime_type, content,
            source, writable, size_bytes, updated_at
          ) VALUES (?, ?, ?, '', 'inode/directory', NULL, 'user', 1, 0, ?)
          ON CONFLICT(relative_path) DO NOTHING
        `,
        [relativePath, name, name, Date.now()],
      );
      return { ok: true, createdPath };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  async deleteDirectory(
    relativePath: string,
  ): Promise<{ ok: boolean; error?: string; lockedFiles?: string[] }> {
    try {
      const directory = normalizeManagedSubdirectory(relativePath);
      const prefix = `assets/images/${directory}`;
      const builtin = await loadBuiltinManifest();
      const lockedFiles = builtin
        .filter((entry) => entry.relativePath === prefix || entry.relativePath.startsWith(`${prefix}/`))
        .map((entry) => entry.relativePath);
      if (lockedFiles.length) {
        return {
          ok: false,
          error: '目录中包含基础资料图片，不能删除整个目录。',
          lockedFiles,
        };
      }
      const rows = await webDatabase.query<ImageRow>(
        `
          SELECT relative_path FROM image_assets
          WHERE relative_path = ? OR relative_path LIKE ? ESCAPE '\\'
        `,
        [prefix, `${prefix.replace(/[%_\\]/g, '\\$&')}/%`],
      );
      await webDatabase.execute(
        `
          DELETE FROM image_assets
          WHERE relative_path = ? OR relative_path LIKE ? ESCAPE '\\'
        `,
        [prefix, `${prefix.replace(/[%_\\]/g, '\\$&')}/%`],
      );
      rows.forEach((row) => revokeObjectUrl(String(row.relative_path || '')));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  async renameFile(
    relativePath: string,
    newName: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const validated = validateManagedFilePath(relativePath);
      if (!validated.ok) return validated;
      const fileName = validateName(newName, 'file');
      const { baseName, ext } = fileParts(fileName);
      if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) throw new Error('重命名后必须保留支持的图片扩展名');
      const slash = validated.normalized.lastIndexOf('/');
      const newPath = `${validated.normalized.slice(0, slash + 1)}${fileName}`;
      const rows = await webDatabase.query<ImageRow>(
        'SELECT * FROM image_assets WHERE relative_path = ? AND writable = 1',
        [validated.normalized],
      );
      if (!rows[0]) throw new Error('只能重命名浏览器中导入的图片');
      await webDatabase.execute(
        `
          UPDATE image_assets SET
            relative_path = ?, file_name = ?, base_name = ?, extension = ?, updated_at = ?
          WHERE relative_path = ? AND writable = 1
        `,
        [newPath, fileName, baseName, ext, Date.now(), validated.normalized],
      );
      const content = toBytes(rows[0].content);
      revokeObjectUrl(validated.normalized);
      if (content) registerObjectUrl(newPath, String(rows[0].mime_type || ''), content);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  async renameDirectory(
    dirPath: string,
    newName: string,
  ): Promise<{ ok: boolean; error?: string; newPath?: string }> {
    try {
      const directory = normalizeManagedSubdirectory(dirPath);
      const name = validateName(newName, 'directory');
      const parts = directory.split('/');
      parts[parts.length - 1] = name;
      const newDirectory = parts.join('/');
      const oldPrefix = `assets/images/${directory}`;
      const newPrefix = `assets/images/${newDirectory}`;
      const rows = await webDatabase.query<ImageRow>(
        `
          SELECT * FROM image_assets
          WHERE relative_path = ? OR relative_path LIKE ? ESCAPE '\\'
          ORDER BY LENGTH(relative_path) ASC
        `,
        [oldPrefix, `${oldPrefix.replace(/[%_\\]/g, '\\$&')}/%`],
      );
      if (!rows.length) throw new Error('只能重命名浏览器中创建的目录');
      const statements = rows.map<SqlStatement>((row) => {
        const oldPath = String(row.relative_path || '');
        const nextPath = `${newPrefix}${oldPath.slice(oldPrefix.length)}`;
        const nextFileName = nextPath.split('/').pop() || '';
        return {
          sql: `
            UPDATE image_assets
            SET relative_path = ?, file_name = ?, updated_at = ?
            WHERE relative_path = ? AND writable = 1
          `,
          bind: [nextPath, nextFileName, Date.now(), oldPath],
        };
      });
      await webDatabase.batch(statements);
      hydrateRows(await loadUserRows());
      return { ok: true, newPath: newDirectory };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  async deleteFile(relativePath: string): Promise<{ ok: boolean; error?: string }> {
    const validated = validateManagedFilePath(relativePath);
    if (!validated.ok) return validated;
    const result = await webDatabase.execute(
      'DELETE FROM image_assets WHERE relative_path = ? AND writable = 1',
      [validated.normalized],
    );
    if (!result.changes) return { ok: false, error: '只能删除浏览器中导入的图片' };
    revokeObjectUrl(validated.normalized);
    return { ok: true };
  },

  async revealFile(relativePath: string): Promise<{ ok: boolean; error?: string }> {
    const validated = validateManagedFilePath(relativePath);
    if (!validated.ok) return validated;
    return { ok: false, error: '浏览器没有“在访达中显示”能力，可复制图片路径。' };
  },

  async revealDirectory(dirPath: string): Promise<{ ok: boolean; error?: string }> {
    const validated = validateManagedDirPath(dirPath);
    if (!validated.ok) return validated;
    return { ok: false, error: '浏览器没有“在访达中显示”能力。' };
  },
};

export { isManagedDir, normalizeDir } from './imageFileService';
