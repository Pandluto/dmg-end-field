import { strFromU8, unzipSync } from 'fflate';
import {
  OFFICIAL_LIBRARY_KEYS,
  RESOURCE_RELEASE_SCHEMA_VERSION,
  RESOURCE_RELEASE_TYPE,
  assertResourceDescriptor,
  assertSha256,
  normalizePortablePath,
  releaseSourceDate,
  stableJson,
  type ResourceReleaseManifest,
} from './resourceReleaseCore.ts';
import { releaseBuildStamp, sha256Bytes } from './resourceReleasePackager.ts';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)
  ) >>> 0;
}

function inspectZipEntries(
  bytes: Uint8Array,
  label: string,
  limits: { maxFiles: number; maxEntryBytes: number; maxTotalBytes: number },
): string[] {
  let endOffset = -1;
  const minimum = Math.max(0, bytes.byteLength - 65_557);
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (readUint32(bytes, offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error(`${label}不是有效 ZIP。`);
  const count = readUint16(bytes, endOffset + 10);
  if (count === 0 || count > limits.maxFiles) {
    throw new Error(`${label}文件数量超出限制。`);
  }
  let offset = readUint32(bytes, endOffset + 16);
  let totalUncompressedBytes = 0;
  const names: string[] = [];
  const seen = new Set<string>();
  const decoder = new TextDecoder();
  for (let index = 0; index < count; index += 1) {
    if (readUint32(bytes, offset) !== 0x02014b50) {
      throw new Error(`${label}中央目录损坏。`);
    }
    const madeBy = readUint16(bytes, offset + 4);
    const flags = readUint16(bytes, offset + 8);
    const uncompressedSize = readUint32(bytes, offset + 24);
    const nameLength = readUint16(bytes, offset + 28);
    const extraLength = readUint16(bytes, offset + 30);
    const commentLength = readUint16(bytes, offset + 32);
    const externalAttributes = readUint32(bytes, offset + 38);
    if ((flags & 1) !== 0) throw new Error(`${label}不能包含加密文件。`);
    if (uncompressedSize > limits.maxEntryBytes) {
      throw new Error(`${label}文件体积超出限制。`);
    }
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > limits.maxTotalBytes) {
      throw new Error(`${label}解压体积超出限制。`);
    }
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    normalizePortablePath(name);
    if (name.endsWith('/')) throw new Error(`${label}不能包含目录条目：${name}`);
    if (seen.has(name)) throw new Error(`${label}包含重复文件：${name}`);
    const creatorSystem = madeBy >>> 8;
    const unixMode = externalAttributes >>> 16;
    if (creatorSystem === 3 && (unixMode & 0o170000) === 0o120000) {
      throw new Error(`${label}不能包含符号链接：${name}`);
    }
    seen.add(name);
    names.push(name);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

function sameStringSet(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length
    && [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

function normalizeManifest(value: unknown): ResourceReleaseManifest {
  if (
    !isRecord(value)
    || value.type !== RESOURCE_RELEASE_TYPE
    || value.schemaVersion !== RESOURCE_RELEASE_SCHEMA_VERSION
    || typeof value.releaseVersion !== 'string'
    || !value.releaseVersion
    || typeof value.generatedAt !== 'string'
    || !isRecord(value.source)
    || !isRecord(value.data)
    || !isRecord(value.images)
  ) {
    throw new Error('resource-release-manifest.json 格式无效。');
  }
  assertSha256(value.rootSha256, '资源根');
  assertResourceDescriptor(value.data.file, '数据文件');
  assertResourceDescriptor(value.images.archive, '图片压缩包');
  if (
    !Array.isArray(value.images.files)
    || value.images.files.length === 0
    || typeof (value.images.archive as JsonRecord).fileName !== 'string'
  ) {
    throw new Error('图片文件清单无效。');
  }
  value.images.files.forEach((entry, index) => assertResourceDescriptor(entry, `图片 ${index + 1}`));
  const paths = value.images.files.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length || paths.some((path) => !path.startsWith('assets/images/'))) {
    throw new Error('图片清单包含重复或越界路径。');
  }
  return value as unknown as ResourceReleaseManifest;
}

export async function verifyResourceReleaseBundle(bytes: Uint8Array): Promise<{
  manifest: ResourceReleaseManifest;
  dataBytes: Uint8Array;
  imageArchiveBytes: Uint8Array;
  imageFiles: Record<string, Uint8Array>;
}> {
  const outerNames = inspectZipEntries(bytes, '资源发布包', {
    maxFiles: 3,
    maxEntryBytes: 128 * 1024 * 1024,
    maxTotalBytes: 192 * 1024 * 1024,
  });
  const outerFiles = unzipSync(bytes);
  const manifestBytes = outerFiles['resource-release-manifest.json'];
  if (!manifestBytes) throw new Error('资源发布包缺少 resource-release-manifest.json。');
  let manifest: ResourceReleaseManifest;
  try {
    manifest = normalizeManifest(JSON.parse(strFromU8(manifestBytes).replace(/^\uFEFF/, '')));
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
  const expectedOuter = [
    'resource-release-manifest.json',
    manifest.data.file.path,
    manifest.images.archive.path,
  ];
  if (!sameStringSet(outerNames, expectedOuter)) {
    throw new Error('资源发布包只能包含清单、标准数据和一个图片压缩包。');
  }

  const dataBytes = outerFiles[manifest.data.file.path];
  const imageArchiveBytes = outerFiles[manifest.images.archive.path];
  if (!dataBytes || !imageArchiveBytes) throw new Error('资源发布包内容不完整。');
  if (
    dataBytes.byteLength !== manifest.data.file.size
    || await sha256Bytes(dataBytes) !== manifest.data.file.sha256
  ) {
    throw new Error('标准数据文件 SHA-256 或体积不符。');
  }
  if (
    imageArchiveBytes.byteLength !== manifest.images.archive.size
    || await sha256Bytes(imageArchiveBytes) !== manifest.images.archive.sha256
  ) {
    throw new Error('图片压缩包 SHA-256 或体积不符。');
  }

  const imageNames = inspectZipEntries(imageArchiveBytes, '图片压缩包', {
    maxFiles: 10_000,
    maxEntryBytes: 32 * 1024 * 1024,
    maxTotalBytes: 512 * 1024 * 1024,
  });
  const expectedImageNames = manifest.images.files.map((entry) => (
    entry.path.replace(/^assets\//, '')
  ));
  if (!sameStringSet(imageNames, expectedImageNames)) {
    throw new Error('图片压缩包与图片文件清单不一致。');
  }
  const imageFiles = unzipSync(imageArchiveBytes);
  for (const entry of manifest.images.files) {
    const archivePath = entry.path.replace(/^assets\//, '');
    const imageBytes = imageFiles[archivePath];
    if (
      !imageBytes
      || imageBytes.byteLength !== entry.size
      || await sha256Bytes(imageBytes) !== entry.sha256
    ) {
      throw new Error(`图片校验失败：${entry.path}`);
    }
  }

  const archive = JSON.parse(strFromU8(dataBytes)) as unknown;
  if (!isRecord(archive) || archive.type !== 'def.localdata.archive.v1' || !isRecord(archive.storage)) {
    throw new Error('标准数据不是 Local Data/Share Data 归档。');
  }
  const local = isRecord(archive.storage.local) ? archive.storage.local : {};
  for (const key of OFFICIAL_LIBRARY_KEYS) {
    if (!isRecord(local[key])) throw new Error(`标准数据缺少 ${key}。`);
  }

  const imageIndexSha256 = await sha256Bytes(new TextEncoder().encode(stableJson(manifest.images.files)));
  if (imageIndexSha256 !== manifest.images.indexSha256) {
    throw new Error('图片索引根哈希不符。');
  }
  const rootSha256 = await sha256Bytes(new TextEncoder().encode(stableJson({
    schemaVersion: RESOURCE_RELEASE_SCHEMA_VERSION,
    data: { sha256: manifest.data.file.sha256, size: manifest.data.file.size },
    images: {
      indexSha256: manifest.images.indexSha256,
      files: manifest.images.files.length,
      totalBytes: manifest.images.files.reduce((total, entry) => total + entry.size, 0),
    },
  })));
  if (rootSha256 !== manifest.rootSha256) throw new Error('资源根 SHA-256 不符。');
  const releaseStamp = releaseBuildStamp(manifest.generatedAt);
  const timestampedVersion = `${releaseStamp}.${rootSha256.slice(0, 12)}`;
  const legacyStamp = releaseSourceDate(manifest.source.exportedAt);
  const legacyVersion = `${legacyStamp}.${rootSha256.slice(0, 12)}`;
  const versionStamp = manifest.releaseVersion === timestampedVersion
    ? releaseStamp
    : manifest.releaseVersion === legacyVersion
      ? legacyStamp
      : null;
  if (!versionStamp) throw new Error('资源版本号与生成时间或内容不一致。');
  if (manifest.data.version !== `${versionStamp}.${manifest.data.file.sha256.slice(0, 8)}`) {
    throw new Error('数据版本号与版本时间或内容不一致。');
  }
  if (manifest.images.version !== `${versionStamp}.${manifest.images.indexSha256.slice(0, 12)}`) {
    throw new Error('图片版本号与版本时间或内容不一致。');
  }
  return { manifest, dataBytes, imageArchiveBytes, imageFiles };
}
