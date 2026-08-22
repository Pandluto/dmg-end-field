import { resolvePublicPath } from '../../utils/assetResolver';
import { webDatabase } from '../database/webDatabase';
import { fetchCurrentResourceRelease } from './resourceChannel';
import { sha256Hex } from './resourceIntegrity';
import { resolveOfficialResourcePath } from './resourceTransport';

const DEFAULT_PACKAGE_ID = 'dmg-end-field-core-data';
const RESOURCE_CACHE_NAME = 'dmg-resource-pack-v1';

export type ResourceManifestEntry = {
  path: string;
  downloadPath?: string;
  sha256: string;
  size: number;
};

export type ResourcePackageManifest = {
  schemaVersion: 1;
  packageId: string;
  version: string;
  releaseVersion?: string;
  generatedAt: string;
  summary?: {
    operators: number;
    weapons: number;
    images: number;
  };
  files: ResourceManifestEntry[];
  totalBytes: number;
};

export type InstalledResourcePackage = {
  packageId: string;
  version: string;
  installedAt: number;
  verifiedAt: number;
  byteSize: number;
  manifest: ResourcePackageManifest;
};

export type ResourceInstallProgress = {
  completed: number;
  total: number;
  downloadedBytes: number;
  totalBytes: number;
  currentPath: string;
};

function isPortableResourcePath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && !/^(?:[a-z]+:)?\/\//i.test(value)
    && !value.startsWith('/')
    && !value.split('/').includes('..');
}

function absoluteResourceCacheUrl(path: string): string {
  const baseUrl = typeof window === 'undefined'
    ? 'https://dmg-resource-package.invalid/'
    : window.location.href;
  return new URL(resolvePublicPath(path), baseUrl).href;
}

export async function fetchResourcePackageManifest(
  options: { fresh?: boolean } = {},
): Promise<ResourcePackageManifest> {
  const context = await fetchCurrentResourceRelease(options);
  const manifest = context.dataManifest as ResourcePackageManifest;
  if (
    manifest.schemaVersion !== 1
    || manifest.packageId !== DEFAULT_PACKAGE_ID
    || !Array.isArray(manifest.files)
    || manifest.files.length === 0
    || manifest.files.length > 16
    || manifest.files.some((entry) => (
      !isPortableResourcePath(entry.path)
      || (entry.downloadPath !== undefined && !isPortableResourcePath(entry.downloadPath))
      || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || !Number.isSafeInteger(entry.size)
      || entry.size <= 0
    ))
    || manifest.totalBytes !== manifest.files.reduce((total, entry) => total + entry.size, 0)
    || manifest.totalBytes > 64 * 1024 * 1024
    || (
      manifest.summary !== undefined
      && (
        !Number.isSafeInteger(manifest.summary.operators)
        || manifest.summary.operators <= 0
        || !Number.isSafeInteger(manifest.summary.weapons)
        || manifest.summary.weapons <= 0
        || !Number.isSafeInteger(manifest.summary.images)
        || manifest.summary.images <= 0
      )
    )
  ) {
    throw new Error('资源清单格式无效。');
  }
  if (
    context.channel
    && manifest.releaseVersion !== context.channel.releaseVersion
  ) {
    throw new Error('数据清单不属于当前服务器资源版本。');
  }
  return manifest;
}

export async function readInstalledResourcePackage(): Promise<InstalledResourcePackage | null> {
  const rows = await webDatabase.query<{
    package_id: string;
    version: string;
    manifest_json: string;
    installed_at: number;
    verified_at: number;
    byte_size: number;
  }>(
    'SELECT package_id, version, manifest_json, installed_at, verified_at, byte_size FROM data_packages WHERE package_id = ?',
    [DEFAULT_PACKAGE_ID],
  );
  const row = rows[0];
  if (!row) return null;
  try {
    const installed = {
      packageId: String(row.package_id),
      version: String(row.version),
      installedAt: Number(row.installed_at),
      verifiedAt: Number(row.verified_at),
      byteSize: Number(row.byte_size),
      manifest: JSON.parse(String(row.manifest_json)) as ResourcePackageManifest,
    };
    return await verifyInstalledResourcePackageCache(installed) ? installed : null;
  } catch {
    return null;
  }
}

export async function verifyInstalledResourcePackageCache(
  installed: InstalledResourcePackage,
): Promise<boolean> {
  if (
    installed.packageId !== DEFAULT_PACKAGE_ID
    || installed.manifest.packageId !== DEFAULT_PACKAGE_ID
    || installed.version !== installed.manifest.version
    || !Array.isArray(installed.manifest.files)
    || installed.manifest.files.length === 0
    || !('caches' in globalThis)
  ) {
    return false;
  }

  try {
    const cache = await caches.open(RESOURCE_CACHE_NAME);
    const expectedUrls = new Set(
      installed.manifest.files.map((entry) => absoluteResourceCacheUrl(entry.path)),
    );
    const cachedRequests = await cache.keys();
    return cachedRequests.length === expectedUrls.size
      && cachedRequests.every((request) => expectedUrls.has(request.url));
  } catch {
    return false;
  }
}

export async function installDefaultResourcePackage(
  onProgress?: (progress: ResourceInstallProgress) => void,
): Promise<InstalledResourcePackage> {
  const manifest = await fetchResourcePackageManifest();
  const cache = await caches.open(RESOURCE_CACHE_NAME);
  let downloadedBytes = 0;

  for (let index = 0; index < manifest.files.length; index += 1) {
    const entry = manifest.files[index];
    const url = resolvePublicPath(entry.path);
    const downloadUrl = entry.downloadPath
      ? resolveOfficialResourcePath(entry.downloadPath)
      : resolvePublicPath(entry.path);
    const versionedUrl = `${downloadUrl}${downloadUrl.includes('?') ? '&' : '?'}sha256=${entry.sha256}`;
    let response: Response;
    try {
      // Workbox uses the complete URL as its CacheFirst key. The content hash
      // prevents a stale previous release from being compared with a newer
      // manifest while still allowing a verified offline reinstall.
      response = await fetch(versionedUrl, { cache: 'no-store' });
    } catch {
      response = await fetch(url);
    }
    if (!response.ok) {
      throw new Error(`资源下载失败：${entry.path}（HTTP ${response.status}）`);
    }
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    const digest = await sha256Hex(bytes);
    if (digest !== entry.sha256) {
      throw new Error(`资源校验失败：${entry.path}`);
    }
    await cache.put(url, response);
    downloadedBytes += bytes.byteLength;
    onProgress?.({
      completed: index + 1,
      total: manifest.files.length,
      downloadedBytes,
      totalBytes: manifest.totalBytes,
      currentPath: entry.path,
    });
  }

  const expectedUrls = new Set(
    manifest.files.map((entry) => absoluteResourceCacheUrl(entry.path)),
  );
  const cachedRequests = await cache.keys();
  await Promise.all(
    cachedRequests
      .filter((request) => !expectedUrls.has(request.url))
      .map((request) => cache.delete(request)),
  );

  const installedAt = Date.now();
  await webDatabase.execute(
    `
      INSERT INTO data_packages(package_id, version, manifest_json, installed_at, verified_at, byte_size)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(package_id) DO UPDATE SET
        version = excluded.version,
        manifest_json = excluded.manifest_json,
        installed_at = excluded.installed_at,
        verified_at = excluded.verified_at,
        byte_size = excluded.byte_size
    `,
    [
      manifest.packageId,
      manifest.version,
      JSON.stringify(manifest),
      installedAt,
      installedAt,
      downloadedBytes,
    ],
  );
  return {
    packageId: manifest.packageId,
    version: manifest.version,
    installedAt,
    verifiedAt: installedAt,
    byteSize: downloadedBytes,
    manifest,
  };
}

export async function readInstalledResourcePackageFile(
  path: string,
): Promise<{ bytes: Uint8Array; installed: InstalledResourcePackage; entry: ResourceManifestEntry }> {
  const installed = await readInstalledResourcePackage();
  if (!installed) throw new Error('官方基础资料尚未下载。');
  const entry = installed.manifest.files.find((candidate) => candidate.path === path);
  if (!entry) throw new Error(`已安装资料包中找不到 ${path}。`);
  const cache = await caches.open(RESOURCE_CACHE_NAME);
  const response = await cache.match(resolvePublicPath(entry.path));
  if (!response) throw new Error(`官方基础资料缓存缺少 ${entry.path}。`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== entry.size || await sha256Hex(bytes) !== entry.sha256) {
    throw new Error(`官方基础资料缓存校验失败：${entry.path}`);
  }
  return { bytes, installed, entry };
}

export async function removeDefaultResourcePackage(): Promise<void> {
  await caches.delete(RESOURCE_CACHE_NAME);
  await webDatabase.execute('DELETE FROM data_packages WHERE package_id = ?', [DEFAULT_PACKAGE_ID]);
}
