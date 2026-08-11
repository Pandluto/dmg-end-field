import { strToU8, zipSync, type Zippable } from 'fflate';
import {
  RESOURCE_RELEASE_SCHEMA_VERSION,
  RESOURCE_RELEASE_TYPE,
  buildCanonicalOfficialArchive,
  normalizePortablePath,
  releaseSourceDate,
  stableJson,
  type ResourceFileDescriptor,
  type ResourceReleaseManifest,
} from './resourceReleaseCore.ts';

export type ResourceReleaseInputImage = {
  relativePath: string;
  bytes: Uint8Array;
};

export type ResourceReleaseBuildProgress = {
  stage: 'validating' | 'hashing-images' | 'compressing-images' | 'assembling';
  completed: number;
  total: number;
  label: string;
};

export type BuiltResourceRelease = {
  fileName: string;
  bytes: Uint8Array;
  manifest: ResourceReleaseManifest;
  canonicalData: Uint8Array;
  imageArchive: Uint8Array;
};

const textEncoder = new TextEncoder();

function digestBytes(bytes: Uint8Array): Promise<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return crypto.subtle.digest('SHA-256', copy.buffer);
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await digestBytes(bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function deterministicMtime(exportedAt: string): Date {
  const source = new Date(exportedAt);
  const year = source.getUTCFullYear();
  if (Number.isNaN(source.getTime()) || year < 1980 || year > 2099) {
    return new Date('1980-01-01T00:00:00.000Z');
  }
  return source;
}

function safeSourceFileName(value: string): string {
  const parts = value.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1]?.trim() || 'share-data.json';
}

export async function buildResourceRelease(input: {
  shareData: unknown;
  shareDataFileName: string;
  images: ResourceReleaseInputImage[];
  onProgress?: (progress: ResourceReleaseBuildProgress) => void;
}): Promise<BuiltResourceRelease> {
  input.onProgress?.({
    stage: 'validating',
    completed: 0,
    total: input.images.length,
    label: '正在校验 Share Data 与图片目录',
  });
  if (input.images.length === 0) throw new Error('图片目录为空。');

  const sortedImages = input.images
    .map((image) => ({
      ...image,
      relativePath: normalizePortablePath(image.relativePath),
    }))
    .sort((left, right) => (
      left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
    ));
  const duplicate = sortedImages.find((image, index) => (
    index > 0 && sortedImages[index - 1].relativePath === image.relativePath
  ));
  if (duplicate) throw new Error(`图片目录存在重复路径：${duplicate.relativePath}`);

  const canonicalImagePaths = sortedImages.map((image) => `assets/images/${image.relativePath}`);
  const { archive, summary } = buildCanonicalOfficialArchive({
    source: input.shareData,
    sourceFileName: safeSourceFileName(input.shareDataFileName),
    imagePaths: canonicalImagePaths,
  });
  const canonicalData = textEncoder.encode(`${JSON.stringify(archive)}\n`);
  const dataSha256 = await sha256Bytes(canonicalData);
  const imageFiles: ResourceFileDescriptor[] = [];
  for (let index = 0; index < sortedImages.length; index += 1) {
    const image = sortedImages[index];
    const canonicalPath = canonicalImagePaths[index];
    imageFiles.push({
      path: canonicalPath,
      sha256: await sha256Bytes(image.bytes),
      size: image.bytes.byteLength,
    });
    input.onProgress?.({
      stage: 'hashing-images',
      completed: index + 1,
      total: sortedImages.length,
      label: canonicalPath,
    });
  }

  const imageIndexSha256 = await sha256Bytes(textEncoder.encode(stableJson(imageFiles)));
  const sourceDate = releaseSourceDate(archive.exportedAt);
  const rootSha256 = await sha256Bytes(textEncoder.encode(stableJson({
    schemaVersion: RESOURCE_RELEASE_SCHEMA_VERSION,
    data: { sha256: dataSha256, size: canonicalData.byteLength },
    images: {
      indexSha256: imageIndexSha256,
      files: imageFiles.length,
      totalBytes: imageFiles.reduce((total, entry) => total + entry.size, 0),
    },
  })));
  const releaseVersion = `${sourceDate}.${rootSha256.slice(0, 12)}`;
  const dataVersion = `${sourceDate}.${dataSha256.slice(0, 8)}`;
  const imageVersion = `${sourceDate}.${imageIndexSha256.slice(0, 12)}`;
  const imageArchiveFileName = `assets-${imageVersion}-full.zip`;
  const mtime = deterministicMtime(archive.exportedAt);

  input.onProgress?.({
    stage: 'compressing-images',
    completed: 0,
    total: sortedImages.length,
    label: '正在生成完整图片压缩包',
  });
  const imageZipEntries: Zippable = {};
  for (const image of sortedImages) {
    imageZipEntries[`images/${image.relativePath}`] = [
      image.bytes,
      { level: 6, mtime },
    ];
  }
  const imageArchive = zipSync(imageZipEntries, { level: 6, mtime });
  const imageArchiveSha256 = await sha256Bytes(imageArchive);

  const manifest: ResourceReleaseManifest = {
    type: RESOURCE_RELEASE_TYPE,
    schemaVersion: RESOURCE_RELEASE_SCHEMA_VERSION,
    releaseVersion,
    rootSha256,
    generatedAt: archive.exportedAt,
    source: {
      fileName: safeSourceFileName(input.shareDataFileName),
      archiveId: archive.source.archiveId,
      exportedAt: archive.exportedAt,
    },
    data: {
      version: dataVersion,
      file: {
        path: 'data/default-local-data.json',
        sha256: dataSha256,
        size: canonicalData.byteLength,
      },
      summary,
    },
    images: {
      version: imageVersion,
      totalBytes: imageFiles.reduce((total, entry) => total + entry.size, 0),
      indexSha256: imageIndexSha256,
      archive: {
        path: `images/${imageArchiveFileName}`,
        fileName: imageArchiveFileName,
        sha256: imageArchiveSha256,
        size: imageArchive.byteLength,
      },
      files: imageFiles,
    },
  };
  const manifestBytes = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  input.onProgress?.({
    stage: 'assembling',
    completed: sortedImages.length,
    total: sortedImages.length,
    label: '正在组装资源发布包',
  });
  const bundleEntries: Zippable = {
    'resource-release-manifest.json': [manifestBytes, { level: 6, mtime }],
    [manifest.data.file.path]: [canonicalData, { level: 6, mtime }],
    [manifest.images.archive.path]: [imageArchive, { level: 0, mtime }],
  };
  const bytes = zipSync(bundleEntries, { level: 0, mtime });
  return {
    fileName: `dmg-resource-release-${releaseVersion}.zip`,
    bytes,
    manifest,
    canonicalData,
    imageArchive,
  };
}
