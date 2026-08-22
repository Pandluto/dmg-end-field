import { unzip } from 'fflate';
import { resolvePublicPath } from '../../utils/assetResolver';
import { webDatabase } from '../database/webDatabase';
import { fetchCurrentResourceRelease } from './resourceChannel';
import { sha256Hex } from './resourceIntegrity';
import { resolveOfficialResourcePath } from './resourceTransport';

const IMAGE_PACKAGE_ID = 'dmg-end-field-image-pack';
const IMAGE_CACHE_NAME = 'dmg-image-pack-v1';

export type ImagePackageManifest = {
  schemaVersion: 1;
  packageId: typeof IMAGE_PACKAGE_ID;
  version: string;
  releaseVersion?: string;
  generatedAt: string;
  releaseTag: string;
  files: Array<{ path: string; sha256: string; size: number }>;
  totalBytes: number;
  publicBasePath?: string;
  archive: {
    path: string;
    fileName: string;
    sha256: string;
    size: number;
    parts?: Array<{
      path: string;
      fileName: string;
      sha256: string;
      size: number;
    }>;
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

class ImageArchiveUnavailableError extends Error {}

function isPortableImagePath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && !/^(?:[a-z]+:)?\/\//i.test(value)
    && !value.startsWith('/')
    && !value.split('/').includes('..');
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return sha256Hex(bytes);
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
  expectedBytes: number,
  downloadedBefore: number,
  totalDownloadBytes: number,
  currentPath: string,
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
      downloadedBytes: downloadedBefore + received,
      totalBytes: totalDownloadBytes,
      currentPath,
    });
  }
  if (received !== expectedBytes) {
    throw new Error(`图片包分片体积不符：${received} != ${expectedBytes}`);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function downloadArchive(
  manifest: ImagePackageManifest,
  onProgress?: (progress: ImageInstallProgress) => void,
): Promise<Uint8Array> {
  const parts = manifest.archive.parts?.length
    ? manifest.archive.parts
    : [{
      path: manifest.archive.path,
      fileName: manifest.archive.fileName,
      sha256: manifest.archive.sha256,
      size: manifest.archive.size,
    }];
  const archive = new Uint8Array(manifest.archive.size);
  let offset = 0;

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const response = await fetch(resolveOfficialResourcePath(part.path), { cache: 'no-store' });
    if (!response.ok) {
      if (response.status === 404 || response.status === 410) {
        throw new ImageArchiveUnavailableError(
          `当前站点未部署图片压缩分片：${part.fileName}`,
        );
      }
      throw new Error(
        `图片包分片尚未部署到站点（${part.fileName}，HTTP ${response.status}）。`
        + '请先运行 npm run assets:web-prepare。',
      );
    }
    const bytes = await readResponseBytes(
      response,
      part.size,
      offset,
      manifest.archive.size,
      parts.length > 1
        ? `正在下载图片压缩包（${index + 1}/${parts.length}）`
        : '正在下载图片压缩包',
      onProgress,
    );
    if (await sha256(bytes) !== part.sha256) {
      throw new Error(`图片包分片 SHA-256 校验失败：${part.fileName}`);
    }
    archive.set(bytes, offset);
    offset += bytes.byteLength;
  }

  if (offset !== manifest.archive.size) {
    throw new Error(`图片包体积不符：${offset} != ${manifest.archive.size}`);
  }
  if (await sha256(archive) !== manifest.archive.sha256) {
    throw new Error('图片压缩包 SHA-256 校验失败。');
  }
  return archive;
}

async function cacheVerifiedImage(
  cache: Cache,
  entry: ImagePackageManifest['files'][number],
  bytes: Uint8Array,
  version: string,
): Promise<void> {
  if (bytes.byteLength !== entry.size) throw new Error(`图片体积不符：${entry.path}`);
  if (await sha256(bytes) !== entry.sha256) throw new Error(`图片校验失败：${entry.path}`);
  const responseBytes = new Uint8Array(bytes.byteLength);
  responseBytes.set(bytes);
  await cache.put(
    resolvePublicPath(entry.path),
    new Response(responseBytes.buffer, {
      headers: {
        'Content-Type': mimeType(entry.path),
        'Content-Length': String(entry.size),
        'X-Dmg-Image-Package': version,
      },
    }),
  );
}

async function installImageFilesDirectly(
  manifest: ImagePackageManifest,
  cache: Cache,
  onProgress?: (progress: ImageInstallProgress) => void,
): Promise<void> {
  const concurrency = 8;
  let completed = 0;
  let downloadedBytes = 0;
  onProgress?.({
    stage: 'downloading',
    completed,
    total: manifest.files.length,
    downloadedBytes,
    totalBytes: manifest.totalBytes,
    currentPath: '当前站点使用独立图片文件，正在切换下载方式',
  });
  for (let offset = 0; offset < manifest.files.length; offset += concurrency) {
    const batch = manifest.files.slice(offset, offset + concurrency);
    await Promise.all(batch.map(async (entry) => {
      const source = resolvePublicPath(entry.path);
      const separator = source.includes('?') ? '&' : '?';
      const response = await fetch(`${source}${separator}sha256=${entry.sha256}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`图片文件下载失败：${entry.path}（HTTP ${response.status}）`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      await cacheVerifiedImage(cache, entry, bytes, manifest.version);
      completed += 1;
      downloadedBytes += bytes.byteLength;
      onProgress?.({
        stage: 'downloading',
        completed,
        total: manifest.files.length,
        downloadedBytes,
        totalBytes: manifest.totalBytes,
        currentPath: entry.path,
      });
    }));
  }
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

export async function fetchImagePackageManifest(
  options: { fresh?: boolean } = {},
): Promise<ImagePackageManifest> {
  const context = await fetchCurrentResourceRelease(options);
  const manifest = context.imageManifest as ImagePackageManifest;
  if (
    manifest.schemaVersion !== 1
    || manifest.packageId !== IMAGE_PACKAGE_ID
    || !Array.isArray(manifest.files)
    || manifest.files.length === 0
    || manifest.files.length > 10_000
    || manifest.files.some((entry) => (
      !isPortableImagePath(entry.path)
      || !entry.path.startsWith('assets/images/')
      || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || !Number.isSafeInteger(entry.size)
      || entry.size <= 0
    ))
    || !manifest.archive?.path
    || !isPortableImagePath(manifest.archive.path)
    || !/^[a-f0-9]{64}$/.test(manifest.archive.sha256)
    || !Number.isSafeInteger(manifest.archive.size)
    || manifest.archive.size <= 0
    || manifest.archive.size > 256 * 1024 * 1024
    || manifest.totalBytes !== manifest.files.reduce((total, entry) => total + entry.size, 0)
    || (
      manifest.archive.parts !== undefined
      && (
        !Array.isArray(manifest.archive.parts)
        || manifest.archive.parts.length === 0
        || manifest.archive.parts.some((part) => (
          !isPortableImagePath(part.path)
          || !/^[a-f0-9]{64}$/.test(part.sha256)
          || !Number.isSafeInteger(part.size)
          || part.size <= 0
          || part.size > 25 * 1024 * 1024
        ))
        || manifest.archive.parts.reduce((total, part) => total + part.size, 0)
          !== manifest.archive.size
      )
    )
  ) {
    throw new Error('图片包清单格式无效。');
  }
  if (
    context.channel
    && manifest.releaseVersion !== context.channel.releaseVersion
  ) {
    throw new Error('图片清单不属于当前服务器资源版本。');
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
    const installed = {
      packageId: String(row.package_id),
      version: String(row.version),
      installedAt: Number(row.installed_at),
      verifiedAt: Number(row.verified_at),
      byteSize: Number(row.byte_size),
      manifest: JSON.parse(String(row.manifest_json)) as ImagePackageManifest,
    };
    return await verifyInstalledImagePackageCache(installed) ? installed : null;
  } catch {
    return null;
  }
}

function absoluteImageCacheUrl(path: string): string {
  const baseUrl = typeof window === 'undefined'
    ? 'https://dmg-image-package.invalid/'
    : window.location.href;
  return new URL(resolvePublicPath(path), baseUrl).href;
}

export async function verifyInstalledImagePackageCache(
  installed: InstalledImagePackage,
): Promise<boolean> {
  if (
    installed.packageId !== IMAGE_PACKAGE_ID
    || installed.manifest.packageId !== IMAGE_PACKAGE_ID
    || installed.version !== installed.manifest.version
    || !Array.isArray(installed.manifest.files)
    || !('caches' in globalThis)
  ) {
    return false;
  }

  try {
    const cache = await caches.open(IMAGE_CACHE_NAME);
    const cachedRequests = await cache.keys();
    const cachedByUrl = new Map(cachedRequests.map((request) => [request.url, request]));
    const verificationBatchSize = 32;
    for (
      let offset = 0;
      offset < installed.manifest.files.length;
      offset += verificationBatchSize
    ) {
      const results = await Promise.all(
        installed.manifest.files
          .slice(offset, offset + verificationBatchSize)
          .map(async (entry) => {
            const request = cachedByUrl.get(absoluteImageCacheUrl(entry.path));
            if (!request) return false;
            const response = await cache.match(request);
            return Boolean(
              response
              && response.headers.get('X-Dmg-Image-Package') === installed.version
              && Number(response.headers.get('Content-Length')) === entry.size,
            );
          }),
      );
      if (results.includes(false)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function installDefaultImagePackage(
  onProgress?: (progress: ImageInstallProgress) => void,
): Promise<InstalledImagePackage> {
  if (!('caches' in globalThis)) {
    throw new Error('浏览器图片缓存不可用。请关闭无痕模式或受限存储后重试。');
  }
  const manifest = await fetchImagePackageManifest();
  const cache = await caches.open(IMAGE_CACHE_NAME);
  let archive: Uint8Array | null = null;
  try {
    archive = await downloadArchive(manifest, onProgress);
  } catch (error) {
    if (!(error instanceof ImageArchiveUnavailableError)) throw error;
  }
  if (archive) {
    onProgress?.({
      stage: 'extracting',
      completed: 0,
      total: manifest.files.length,
      downloadedBytes: archive.byteLength,
      totalBytes: manifest.archive.size,
      currentPath: '正在解压图片包',
    });
    const extracted = await unzipArchive(archive);
    for (let index = 0; index < manifest.files.length; index += 1) {
      const entry = manifest.files[index];
      const archivePath = entry.path.replace(/^assets\//, '');
      const bytes = extracted[archivePath];
      if (!bytes) throw new Error(`图片包缺少文件：${entry.path}`);
      await cacheVerifiedImage(cache, entry, bytes, manifest.version);
      onProgress?.({
        stage: 'verifying',
        completed: index + 1,
        total: manifest.files.length,
        downloadedBytes: archive.byteLength,
        totalBytes: manifest.archive.size,
        currentPath: entry.path,
      });
    }
  } else {
    await installImageFilesDirectly(manifest, cache, onProgress);
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
