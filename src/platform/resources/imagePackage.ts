import { unzip } from 'fflate';
import { resolvePublicPath } from '../../utils/assetResolver';
import { webDatabase } from '../database/webDatabase';

const IMAGE_PACKAGE_ID = 'dmg-end-field-image-pack';
const IMAGE_CACHE_NAME = 'dmg-image-pack-v1';
const IMAGE_MANIFEST_PATH = 'web-image-manifest.json';

export type ImagePackageManifest = {
  schemaVersion: 1;
  packageId: typeof IMAGE_PACKAGE_ID;
  version: string;
  generatedAt: string;
  releaseTag: string;
  files: Array<{ path: string; sha256: string; size: number }>;
  totalBytes: number;
  archive: {
    path: string;
    fileName: string;
    sha256: string;
    size: number;
    sourceUrl: string;
  };
};

export type InstalledImagePackage = {
  packageId: string;
  version: string;
  installedAt: number;
  verifiedAt: number;
  byteSize: number;
  manifest: ImagePackageManifest;
};

export type ImageInstallProgress = {
  stage: 'downloading' | 'extracting' | 'verifying';
  completed: number;
  total: number;
  downloadedBytes: number;
  totalBytes: number;
  currentPath: string;
};

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return bytesToHex(await crypto.subtle.digest('SHA-256', copy.buffer));
}

function mimeType(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

async function readResponseBytes(
  response: Response,
  totalBytes: number,
  onProgress?: (progress: ImageInstallProgress) => void,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    received += value.byteLength;
    onProgress?.({
      stage: 'downloading',
      completed: 0,
      total: 1,
      downloadedBytes: received,
      totalBytes,
      currentPath: '正在下载图片压缩包',
    });
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function unzipArchive(archive: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(archive, (error, files) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(Object.fromEntries(
        Object.entries(files).map(([path, bytes]) => [path.replace(/\\/g, '/'), bytes]),
      ));
    });
  });
}

export async function fetchImagePackageManifest(): Promise<ImagePackageManifest> {
  const response = await fetch(resolvePublicPath(IMAGE_MANIFEST_PATH), { cache: 'no-store' });
  if (!response.ok) throw new Error(`图片包清单加载失败：HTTP ${response.status}`);
  const manifest = await response.json() as ImagePackageManifest;
  if (
    manifest.schemaVersion !== 1
    || manifest.packageId !== IMAGE_PACKAGE_ID
    || !Array.isArray(manifest.files)
    || !manifest.archive?.path
  ) {
    throw new Error('图片包清单格式无效。');
  }
  return manifest;
}

export async function readInstalledImagePackage(): Promise<InstalledImagePackage | null> {
  const rows = await webDatabase.query<{
    package_id: string;
    version: string;
    manifest_json: string;
    installed_at: number;
    verified_at: number;
    byte_size: number;
  }>(
    `
      SELECT package_id, version, manifest_json, installed_at, verified_at, byte_size
      FROM data_packages WHERE package_id = ?
    `,
    [IMAGE_PACKAGE_ID],
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
      manifest: JSON.parse(String(row.manifest_json)) as ImagePackageManifest,
    };
  } catch {
    return null;
  }
}

export async function installDefaultImagePackage(
  onProgress?: (progress: ImageInstallProgress) => void,
): Promise<InstalledImagePackage> {
  const manifest = await fetchImagePackageManifest();
  const archiveResponse = await fetch(resolvePublicPath(manifest.archive.path), {
    cache: 'no-store',
  });
  if (!archiveResponse.ok) {
    throw new Error(
      `图片包尚未部署到本地站点（HTTP ${archiveResponse.status}）。`
      + '请先运行 npm run assets:web-prepare。',
    );
  }
  const archive = await readResponseBytes(archiveResponse, manifest.archive.size, onProgress);
  if (archive.byteLength !== manifest.archive.size) {
    throw new Error(`图片包体积不符：${archive.byteLength} != ${manifest.archive.size}`);
  }
  if (await sha256(archive) !== manifest.archive.sha256) {
    throw new Error('图片压缩包 SHA-256 校验失败。');
  }
  onProgress?.({
    stage: 'extracting',
    completed: 0,
    total: manifest.files.length,
    downloadedBytes: archive.byteLength,
    totalBytes: manifest.archive.size,
    currentPath: '正在解压图片包',
  });
  const extracted = await unzipArchive(archive);
  const cache = await caches.open(IMAGE_CACHE_NAME);

  for (let index = 0; index < manifest.files.length; index += 1) {
    const entry = manifest.files[index];
    const archivePath = entry.path.replace(/^assets\//, '');
    const bytes = extracted[archivePath];
    if (!bytes) throw new Error(`图片包缺少文件：${entry.path}`);
    if (bytes.byteLength !== entry.size) {
      throw new Error(`图片体积不符：${entry.path}`);
    }
    if (await sha256(bytes) !== entry.sha256) {
      throw new Error(`图片校验失败：${entry.path}`);
    }
    const responseBytes = new Uint8Array(bytes.byteLength);
    responseBytes.set(bytes);
    await cache.put(
      resolvePublicPath(entry.path),
      new Response(responseBytes.buffer, {
        headers: {
          'Content-Type': mimeType(entry.path),
          'Content-Length': String(entry.size),
          'X-Dmg-Image-Package': manifest.version,
        },
      }),
    );
    onProgress?.({
      stage: 'verifying',
      completed: index + 1,
      total: manifest.files.length,
      downloadedBytes: archive.byteLength,
      totalBytes: manifest.archive.size,
      currentPath: entry.path,
    });
  }

  const installedAt = Date.now();
  await webDatabase.execute(
    `
      INSERT INTO data_packages(
        package_id, version, manifest_json, installed_at, verified_at, byte_size
      ) VALUES (?, ?, ?, ?, ?, ?)
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
      manifest.totalBytes,
    ],
  );
  return {
    packageId: manifest.packageId,
    version: manifest.version,
    installedAt,
    verifiedAt: installedAt,
    byteSize: manifest.totalBytes,
    manifest,
  };
}

export async function removeDefaultImagePackage(): Promise<void> {
  await caches.delete(IMAGE_CACHE_NAME);
  await webDatabase.execute('DELETE FROM data_packages WHERE package_id = ?', [IMAGE_PACKAGE_ID]);
}
