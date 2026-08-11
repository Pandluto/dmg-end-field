import { resolvePublicPath } from '../../utils/assetResolver';
import { webDatabase } from '../database/webDatabase';

const DEFAULT_PACKAGE_ID = 'dmg-end-field-core-data';
const RESOURCE_CACHE_NAME = 'dmg-resource-pack-v1';
const MANIFEST_PATH = 'web-data-manifest.json';

export type ResourceManifestEntry = {
  path: string;
  sha256: string;
  size: number;
};

export type ResourcePackageManifest = {
  schemaVersion: 1;
  packageId: string;
  version: string;
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

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function absoluteResourceCacheUrl(path: string): string {
  const baseUrl = typeof window === 'undefined'
    ? 'https://dmg-resource-package.invalid/'
    : window.location.href;
  return new URL(resolvePublicPath(path), baseUrl).href;
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  return bytesToHex(await crypto.subtle.digest('SHA-256', buffer));
}

export async function fetchResourcePackageManifest(): Promise<ResourcePackageManifest> {
  const manifestUrl = resolvePublicPath(MANIFEST_PATH);
  const freshUrl = `${manifestUrl}${manifestUrl.includes('?') ? '&' : '?'}install=${Date.now()}`;
  let response: Response;
  try {
    // The PWA precache can still answer a no-store request with an older
    // manifest. A unique URL forces an online install to read one coherent
    // manifest/file generation; the stable URL remains the offline fallback.
    response = await fetch(freshUrl, { cache: 'no-store' });
  } catch {
    response = await fetch(manifestUrl);
  }
  if (!response.ok) throw new Error(`资源清单加载失败：HTTP ${response.status}`);
  const manifest = await response.json() as ResourcePackageManifest;
  if (
    manifest.schemaVersion !== 1
    || manifest.packageId !== DEFAULT_PACKAGE_ID
    || !Array.isArray(manifest.files)
    || manifest.files.length === 0
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
    const versionedUrl = `${url}${url.includes('?') ? '&' : '?'}sha256=${entry.sha256}`;
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
    const bytes = await response.clone().arrayBuffer();
    const digest = await sha256(bytes);
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

export async function removeDefaultResourcePackage(): Promise<void> {
  await caches.delete(RESOURCE_CACHE_NAME);
  await webDatabase.execute('DELETE FROM data_packages WHERE package_id = ?', [DEFAULT_PACKAGE_ID]);
}
