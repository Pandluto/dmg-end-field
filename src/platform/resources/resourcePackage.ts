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

async function sha256(buffer: ArrayBuffer): Promise<string> {
  return bytesToHex(await crypto.subtle.digest('SHA-256', buffer));
}

export async function fetchResourcePackageManifest(): Promise<ResourcePackageManifest> {
  const response = await fetch(resolvePublicPath(MANIFEST_PATH), { cache: 'no-store' });
  if (!response.ok) throw new Error(`资源清单加载失败：HTTP ${response.status}`);
  const manifest = await response.json() as ResourcePackageManifest;
  if (
    manifest.schemaVersion !== 1
    || manifest.packageId !== DEFAULT_PACKAGE_ID
    || !Array.isArray(manifest.files)
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
    return {
      packageId: String(row.package_id),
      version: String(row.version),
      installedAt: Number(row.installed_at),
      verifiedAt: Number(row.verified_at),
      byteSize: Number(row.byte_size),
      manifest: JSON.parse(String(row.manifest_json)) as ResourcePackageManifest,
    };
  } catch {
    return null;
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
    const response = await fetch(url, { cache: 'no-store' });
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

