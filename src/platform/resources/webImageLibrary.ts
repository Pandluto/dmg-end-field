import type { ImageAssetEntry } from '../../components/ImageManager/types';
import { webDatabase, type SqlPrimitive, type SqlStatement } from '../database/webDatabase';
import {
  validateManagedDirPath,
  validateManagedFilePath,
} from '../../utils/imageFileService';
import {
  createWebImagePathIndex,
  type WebImageIndexedPath,
} from './webImagePathIndex';
import { createWebImageObjectUrlRegistry } from './webImageObjectUrlRegistry';

type CapListener = (caps: WebImageLibraryCapabilities) => void;
type ImageChangeListener = () => void;
type ImageRow = Record<string, SqlPrimitive>;

export type PortableWebImageAsset = {
  relativePath: string;
  mimeType: string;
  sizeBytes: number;
  updatedAt: number;
  sha256: string;
  contentBase64: string;
};

export interface WebImageLibraryCapabilities {
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
  isWritable: boolean;
  backendLabel: string;
  transportKind: 'browser-sqlite';
}

const WEB_CAPABILITIES: WebImageLibraryCapabilities = {
  canList: true,
  canImport: true,
  canRename: true,
  canRenameDir: true,
  canDeleteFile: true,
  canCreateDir: true,
  canDeleteDir: true,
  canReveal: false,
  canManageRoots: false,
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

const BUILTIN_IMAGE_INDEX_PATH = 'assets/images/_manifest.json';

let currentCapabilities = WEB_CAPABILITIES;
let builtinManifest: ImageAssetEntry[] | null = null;
let initializationPromise: Promise<void> | null = null;
const capabilityListeners = new Set<CapListener>();
const imageChangeListeners = new Set<ImageChangeListener>();
const objectUrlRegistry = createWebImageObjectUrlRegistry();
let pathIndex = createWebImagePathIndex([]);

function notifyCapabilityListeners(): void {
  capabilityListeners.forEach((listener) => listener(currentCapabilities));
}

function notifyImageChangeListeners(): void {
  imageChangeListeners.forEach((listener) => listener());
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

function builtinImageIndexUrl(): string {
  const url = staticAssetUrl(BUILTIN_IMAGE_INDEX_PATH);
  if (!import.meta.env.DEV) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}dev=${Date.now()}`;
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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
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
    canonicalPath: kind === 'file' ? relativePath : undefined,
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
  // A previously installed development worker may still own this origin and
  // contain an obsolete image-package cache. Development must read the index
  // served by Vite so a stale cache cannot block the entire workspace boot.
  const response = await fetch(builtinImageIndexUrl(), {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`图片索引加载失败：HTTP ${response.status}`);
  const payload = await response.json() as unknown;
  if (!Array.isArray(payload)) throw new Error('图片索引格式无效。');
  builtinManifest = payload.map((rawEntry) => {
    const entry = rawEntry as Partial<ImageAssetEntry>;
    const relativePath = typeof entry.relativePath === 'string'
      ? normalizeSlashes(entry.relativePath)
      : '';
    const sizeBytes = Number(entry.sizeBytes);
    const updatedAt = Number(entry.updatedAt);
    if (!relativePath.startsWith('assets/images/') || !Number.isFinite(sizeBytes)) {
      throw new Error('图片索引格式无效。');
    }
    const fileName = relativePath.split('/').pop() || relativePath;
    const { baseName, ext } = fileParts(fileName);
    return {
      fileName,
      baseName,
      ext,
      relativePath,
      sizeBytes,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
      writable: false,
      source: 'release',
      rootId: 'release',
      rootLabel: '官方图片包',
      rootPriority: -1,
    };
  });
  return builtinManifest;
}

async function loadUserRows(): Promise<ImageRow[]> {
  return webDatabase.query<ImageRow>(
    'SELECT * FROM image_assets ORDER BY relative_path ASC',
  );
}

function hydrateRows(rows: ImageRow[]): void {
  const objectUrlEntries = [];
  for (const row of rows) {
    const relativePath = String(row.relative_path || '');
    if (!relativePath || String(row.mime_type || '') === 'inode/directory') continue;
    const content = toBytes(row.content);
    if (content) {
      objectUrlEntries.push({
        relativePath,
        mimeType: String(row.mime_type || ''),
        content,
      });
    }
  }
  const objectUrlsChanged = objectUrlRegistry.synchronize(objectUrlEntries);
  const indexedPaths: WebImageIndexedPath[] = [
    ...(builtinManifest || [])
      .filter((entry) => entry.kind !== 'dir')
      .map((entry) => ({
        relativePath: entry.relativePath,
        source: 'release' as const,
      })),
    ...rows
      .filter((row) => String(row.mime_type || '') !== 'inode/directory')
      .map((row) => ({
        relativePath: String(row.relative_path || ''),
        source: 'user' as const,
      })),
  ];
  pathIndex = createWebImagePathIndex(indexedPaths);
  if (objectUrlsChanged) {
    notifyImageChangeListeners();
  }
}

export async function initializeWebImageLibrary(): Promise<void> {
  if (initializationPromise) return initializationPromise;
  initializationPromise = Promise.all([loadBuiltinManifest(), loadUserRows()])
    .then(([, rows]) => {
      hydrateRows(rows);
    })
    .finally(() => {
      initializationPromise = null;
    });
  return initializationPromise;
}

/**
 * Canonicalize a stored image reference against the installed Web image
 * library. Historical desktop formats are accepted only at this boundary;
 * business data is persisted with the matched assets/images path.
 */
export function canonicalizeWebImageReference(path?: string | null): string | null {
  if (!path) return null;
  return pathIndex.resolve(path, window.location.origin)?.canonicalPath || path;
}

export function canonicalizeWebImageReferences<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeWebImageReferences(item)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, child]) => [key, canonicalizeWebImageReferences(child)]),
    ) as T;
  }
  if (typeof value === 'string') {
    return (canonicalizeWebImageReference(value) || value) as T;
  }
  return value;
}

/**
 * Resolve a Web image-library reference. Custom SQLite BLOBs become object
 * URLs; release images use the same-origin URL fulfilled by the image cache.
 */
export function resolveWebImageUrl(path?: string | null): string | null {
  if (!path) return null;
  if (/^(?:data|blob):/i.test(path)) return path;
  const canonical = canonicalizeWebImageReference(path);
  if (!canonical) return null;
  if (/^(?:data|blob):/i.test(canonical)) return canonical;
  if (/^https?:/i.test(canonical)) return canonical;
  const normalized = normalizeSlashes(canonical);
  return objectUrlRegistry.get(normalized) || staticAssetUrl(normalized);
}

export async function exportWebImageAssets(): Promise<PortableWebImageAsset[]> {
  const rows = await webDatabase.query<ImageRow>(
    `
      SELECT * FROM image_assets
      WHERE source = 'user' AND writable = 1
        AND mime_type != 'inode/directory' AND content IS NOT NULL
      ORDER BY relative_path ASC
    `,
  );
  const assets: PortableWebImageAsset[] = [];
  for (const row of rows) {
    const relativePath = String(row.relative_path || '');
    const validated = validateManagedFilePath(relativePath);
    const bytes = toBytes(row.content);
    if (!validated.ok || !bytes) continue;
    assets.push({
      relativePath: validated.normalized,
      mimeType: String(row.mime_type || 'application/octet-stream'),
      sizeBytes: bytes.byteLength,
      updatedAt: Number(row.updated_at || 0),
      sha256: await sha256Bytes(bytes),
      contentBase64: bytesToBase64(bytes),
    });
  }
  return assets;
}

export async function importWebImageAssets(
  assets: PortableWebImageAsset[],
): Promise<{ imported: number; totalBytes: number }> {
  if (!assets.length) return { imported: 0, totalBytes: 0 };
  const statements: SqlStatement[] = [];
  let totalBytes = 0;
  for (const asset of assets) {
    const validated = validateManagedFilePath(asset.relativePath);
    if (!validated.ok) throw new Error(`数据包图片路径无效：${asset.relativePath}`);
    const fileName = validated.normalized.split('/').pop() || '';
    const { baseName, ext } = fileParts(fileName);
    if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
      throw new Error(`数据包图片格式无效：${fileName}`);
    }
    const content = base64ToBytes(asset.contentBase64);
    if (content.byteLength !== asset.sizeBytes) {
      throw new Error(`数据包图片体积不符：${asset.relativePath}`);
    }
    if (await sha256Bytes(content) !== asset.sha256) {
      throw new Error(`数据包图片校验失败：${asset.relativePath}`);
    }
    totalBytes += content.byteLength;
    statements.push({
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
        validated.normalized,
        fileName,
        baseName,
        ext,
        asset.mimeType || MIME_BY_EXTENSION[ext] || 'application/octet-stream',
        content,
        content.byteLength,
        Number(asset.updatedAt) || Date.now(),
      ],
    });
  }
  await webDatabase.batch(statements);
  hydrateRows(await loadUserRows());
  return { imported: statements.length, totalBytes };
}

export function getCapabilities(): WebImageLibraryCapabilities {
  return currentCapabilities;
}

export function subscribeCapabilities(listener: CapListener): () => void {
  capabilityListeners.add(listener);
  return () => capabilityListeners.delete(listener);
}

export function subscribeWebImageLibraryChanges(listener: ImageChangeListener): () => void {
  imageChangeListeners.add(listener);
  return () => imageChangeListeners.delete(listener);
}

export async function refreshCapabilities(): Promise<WebImageLibraryCapabilities> {
  await webDatabase.initialize();
  currentCapabilities = WEB_CAPABILITIES;
  notifyCapabilityListeners();
  return currentCapabilities;
}

export function getWebImageUrl(entry: ImageAssetEntry): string | null {
  if (entry.source === 'user') {
    return objectUrlRegistry.get(entry.relativePath);
  }
  return resolveWebImageUrl(entry.relativePath || entry.canonicalPath);
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

export const webImageLibrary = {
  getCapabilities,
  subscribeCapabilities,
  subscribeChanges: subscribeWebImageLibraryChanges,
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
      hydrateRows(await loadUserRows());
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
      await webDatabase.execute(
        `
          DELETE FROM image_assets
          WHERE relative_path = ? OR relative_path LIKE ? ESCAPE '\\'
        `,
        [prefix, `${prefix.replace(/[%_\\]/g, '\\$&')}/%`],
      );
      hydrateRows(await loadUserRows());
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
      hydrateRows(await loadUserRows());
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
    hydrateRows(await loadUserRows());
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

export { isManagedDir, normalizeDir } from '../../utils/imageFileService';
