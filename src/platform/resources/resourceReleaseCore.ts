export const RESOURCE_RELEASE_SCHEMA_VERSION = 1 as const;
export const RESOURCE_RELEASE_TYPE = 'dmg.resource-release.v1' as const;
export const RESOURCE_CHANNEL_TYPE = 'dmg.resource-channel.v1' as const;
export const RESOURCE_DEPLOYMENT_TYPE = 'dmg.resource-deployment.v1' as const;

export const OFFICIAL_LIBRARY_KEYS = [
  'def.operator-editor.library.v1',
  'def.weapon-sheet.library.v1',
  'def.equipment-sheet.library.v1',
  'def.buff-editor.library.v1',
] as const;

export const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.svg',
]);

export type ResourceFileDescriptor = {
  path: string;
  sha256: string;
  size: number;
};

export type ResourceReleaseManifest = {
  type: typeof RESOURCE_RELEASE_TYPE;
  schemaVersion: typeof RESOURCE_RELEASE_SCHEMA_VERSION;
  releaseVersion: string;
  rootSha256: string;
  generatedAt: string;
  source: {
    fileName: string;
    archiveId: string;
    exportedAt: string;
  };
  data: {
    version: string;
    file: ResourceFileDescriptor;
    summary: {
      operators: number;
      weapons: number;
      images: number;
    };
  };
  images: {
    version: string;
    totalBytes: number;
    indexSha256: string;
    archive: ResourceFileDescriptor & { fileName: string };
    files: ResourceFileDescriptor[];
  };
};

export type ResourceManifestPointer = ResourceFileDescriptor;

export type ResourceDeploymentManifest = Omit<ResourceReleaseManifest, 'type'> & {
  type: typeof RESOURCE_DEPLOYMENT_TYPE;
  delivery: {
    dataManifest: ResourceManifestPointer;
    imageManifest: ResourceManifestPointer;
  };
};

export type ResourceChannelManifest = {
  type: typeof RESOURCE_CHANNEL_TYPE;
  schemaVersion: typeof RESOURCE_RELEASE_SCHEMA_VERSION;
  channel: 'stable';
  releaseVersion: string;
  publishedAt: string;
  releaseManifest: ResourceManifestPointer;
};

type JsonRecord = Record<string, unknown>;

export type CanonicalOfficialArchive = {
  type: 'def.localdata.archive.v1';
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  createdAt: string;
  exportedAt: string;
  sections: string[];
  storage: { local: JsonRecord; session: JsonRecord };
  timelineArchives: unknown[];
  source: { archiveId: string; fileName: string };
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parsedRecord(value: unknown): JsonRecord {
  if (typeof value === 'string') {
    try {
      return parsedRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return isRecord(value) ? value : {};
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function fileName(path: string): string {
  const parts = normalizeSlashes(path).split('/');
  return parts[parts.length - 1] || '';
}

function extension(path: string): string {
  const name = fileName(path);
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index).toLowerCase() : '';
}

function stem(path: string): string {
  const name = fileName(path);
  const ext = extension(name);
  return ext ? name.slice(0, -ext.length) : name;
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function normalizePortablePath(path: string): string {
  if (/^[\\/]/.test(path) || /^[A-Za-z]:[\\/]/.test(path)) {
    throw new Error(`路径无效：${path}`);
  }
  const normalized = normalizeSlashes(path);
  if (
    !normalized
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`路径无效：${path}`);
  }
  return normalized;
}

export function detectImageRoot(paths: string[]): {
  mode: 'assets/images' | 'images' | 'direct';
  files: Array<{ sourcePath: string; relativePath: string }>;
} {
  const normalized = paths.map(normalizePortablePath);
  const imageFiles = normalized.filter((path) => SUPPORTED_IMAGE_EXTENSIONS.has(extension(path)));
  const assetsPrefix = imageFiles.filter((path) => path.startsWith('assets/images/'));
  const imagesPrefix = imageFiles.filter((path) => path.startsWith('images/'));
  const selected = assetsPrefix.length > 0
    ? { mode: 'assets/images' as const, paths: assetsPrefix, prefix: 'assets/images/' }
    : imagesPrefix.length > 0
      ? { mode: 'images' as const, paths: imagesPrefix, prefix: 'images/' }
      : { mode: 'direct' as const, paths: imageFiles, prefix: '' };
  const files = selected.paths.map((sourcePath) => ({
    sourcePath,
    relativePath: normalizePortablePath(sourcePath.slice(selected.prefix.length)),
  }));
  if (files.length === 0) {
    throw new Error('所选目录中没有 PNG、JPG、WebP、GIF 或 SVG 图片。');
  }
  const duplicate = files
    .map((entry) => entry.relativePath)
    .find((path, index, all) => all.indexOf(path) !== index);
  if (duplicate) throw new Error(`图片目录存在重复路径：${duplicate}`);
  return { mode: selected.mode, files };
}

function normalizeIsoDate(value: unknown): string {
  const date = new Date(typeof value === 'string' ? value : '');
  if (Number.isNaN(date.getTime())) {
    throw new Error('Share Data 缺少有效的 createdAt/exportedAt。');
  }
  return date.toISOString();
}

export function releaseSourceDate(value: string): string {
  return value.slice(0, 10).replace(/-/g, '');
}

function createImagePathResolver(imagePaths: string[]) {
  const available = new Set(imagePaths.map(normalizePortablePath));
  const byFileName = new Map<string, string>();
  const byStem = new Map<string, string>();
  for (const imagePath of [...available].sort()) {
    const name = fileName(imagePath);
    const preferred = !byFileName.has(name) || imagePath.includes('/img-equipment/icon_cn/');
    if (preferred) {
      byFileName.set(name, imagePath);
      byStem.set(stem(name), imagePath);
    }
  }

  const resolveAvailable = (candidates: string[], name: string): string | undefined => {
    const exact = candidates.find((candidate) => available.has(candidate));
    const imageStem = stem(name);
    return exact
      || byFileName.get(name)
      || byStem.get(imageStem)
      || byStem.get(imageStem.replace(/·[壹贰叁肆伍陆柒捌玖拾]型$/, ''));
  };

  const normalizeLegacyAvatar = (normalized: string): string | undefined => {
    const parts = normalized.replace(/^assets\/avatars\//, '').split('/').filter(Boolean);
    const operatorName = parts.shift() || '';
    const name = parts[parts.length - 1] || '';
    if (!operatorName || !name) return undefined;
    const avatar = `assets/images/img-operator/${name}`;
    const skill = `assets/images/img-operator/skiil-icon/${operatorName}/${parts.join('/')}`;
    const operatorDirectory = `assets/images/img-operator/${operatorName}/${parts.join('/')}`;
    const isAvatar = parts.length === 1 && stem(name) === operatorName;
    return resolveAvailable(
      isAvatar ? [avatar, operatorDirectory, skill] : [skill, operatorDirectory, avatar],
      name,
    );
  };

  return (value: string): string => {
    let normalized = normalizeSlashes(value);
    try {
      const url = new URL(value);
      if (!['127.0.0.1:31457', 'localhost:31457'].includes(url.host)) return value;
      normalized = normalizeSlashes(decodeURIComponent(url.pathname));
    } catch {
      try {
        normalized = decodeURIComponent(normalized);
      } catch {
        // A malformed legacy path is reported as unresolved below.
      }
    }

    if (normalized.startsWith('assets/images/')) {
      const mapped = resolveAvailable([normalized], fileName(normalized));
      if (!mapped) throw new Error(`图片目录中不存在数据引用：${normalized}`);
      return mapped;
    }
    if (normalized.startsWith('assets/avatars/')) {
      const mapped = normalizeLegacyAvatar(normalized);
      if (!mapped) throw new Error(`图片目录中不存在旧干员引用：${normalized}`);
      return mapped;
    }
    if (normalized.startsWith('user-images/')) {
      const relative = normalized.slice('user-images/'.length);
      const candidate = relative.startsWith('img-equipment/icon_cn/')
        ? `assets/images/${relative}`
        : relative.startsWith('img-equipment/')
          ? `assets/images/img-equipment/icon_cn/${relative.slice('img-equipment/'.length)}`
          : `assets/images/${relative.replace(/^images\//, '')}`;
      const mapped = resolveAvailable([candidate], fileName(normalized));
      if (!mapped) throw new Error(`图片目录中不存在数据引用：${normalized}`);
      return mapped;
    }
    if (
      normalized.startsWith('public/images/')
      || normalized.startsWith('/public/images/')
      || normalized.startsWith('images/character/')
      || normalized.startsWith('images/weapon/')
    ) {
      throw new Error(`资料仍引用已废弃图片路径：${normalized}`);
    }
    return value;
  };
}

function normalizeArchiveValues(value: unknown, normalizeImagePath: (value: string) => string): unknown {
  if (Array.isArray(value)) {
    return value.map((child) => normalizeArchiveValues(child, normalizeImagePath));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        normalizeArchiveValues(child, normalizeImagePath),
      ]),
    );
  }
  return typeof value === 'string' ? normalizeImagePath(value) : value;
}

export function buildCanonicalOfficialArchive(input: {
  source: unknown;
  sourceFileName: string;
  imagePaths: string[];
}): {
  archive: CanonicalOfficialArchive;
  summary: { operators: number; weapons: number; images: number };
} {
  if (!isRecord(input.source) || input.source.type !== 'def.localdata.archive.v1') {
    throw new Error('所选文件不是 Share Data（def.localdata.archive.v1）。');
  }
  const storage = parsedRecord(input.source.storage);
  const sourceLocal = parsedRecord(storage.local);
  const missing = OFFICIAL_LIBRARY_KEYS.filter((key) => (
    !Object.prototype.hasOwnProperty.call(sourceLocal, key)
    || Object.keys(parsedRecord(sourceLocal[key])).length === 0
  ));
  if (missing.length > 0) {
    throw new Error(`Share Data 缺少官方资料库：${missing.join('、')}`);
  }

  const imagePaths = input.imagePaths.map(normalizePortablePath).sort();
  const normalizeImagePath = createImagePathResolver(imagePaths);
  const local = normalizeArchiveValues(
    Object.fromEntries(OFFICIAL_LIBRARY_KEYS.map((key) => [key, parsedRecord(sourceLocal[key])])),
    normalizeImagePath,
  ) as JsonRecord;
  const timelineArchives = normalizeArchiveValues(
    Array.isArray(input.source.timelineArchives) ? input.source.timelineArchives : [],
    normalizeImagePath,
  ) as unknown[];
  const exportedAt = normalizeIsoDate(input.source.exportedAt || input.source.createdAt);
  const createdAt = normalizeIsoDate(input.source.createdAt || input.source.exportedAt);
  const archiveId = typeof input.source.id === 'string' && input.source.id.trim()
    ? input.source.id.trim()
    : `share-${releaseSourceDate(exportedAt)}`;
  const operators = Object.keys(parsedRecord(local[OFFICIAL_LIBRARY_KEYS[0]])).length;
  const weapons = Object.keys(parsedRecord(local[OFFICIAL_LIBRARY_KEYS[1]])).length;
  if (operators < 30 || weapons < 75) {
    throw new Error(`Share Data 不完整：只有 ${operators} 位干员、${weapons} 件武器。`);
  }

  return {
    archive: {
      type: 'def.localdata.archive.v1',
      schemaVersion: 1,
      id: 'web-lts-official-data',
      name: 'Web LTS 官方基础数据',
      description: '从 Share Data 整理的干员、武器、装备、Buff 与共享排轴。',
      createdAt,
      exportedAt,
      sections: ['operators', 'weapons', 'equipments', 'buffs', 'timeline'],
      storage: { local, session: {} },
      timelineArchives,
      source: { archiveId, fileName: input.sourceFileName },
    },
    summary: { operators, weapons, images: imagePaths.length },
  };
}

export function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} SHA-256 无效。`);
  }
}

export function assertResourceDescriptor(
  value: unknown,
  label: string,
): asserts value is ResourceFileDescriptor {
  if (!isRecord(value)) throw new Error(`${label}无效。`);
  normalizePortablePath(String(value.path || ''));
  assertSha256(value.sha256, label);
  if (!Number.isSafeInteger(value.size) || Number(value.size) <= 0) {
    throw new Error(`${label}体积无效。`);
  }
}

export function normalizeResourceChannel(value: unknown): ResourceChannelManifest {
  if (
    !isRecord(value)
    || value.type !== RESOURCE_CHANNEL_TYPE
    || value.schemaVersion !== RESOURCE_RELEASE_SCHEMA_VERSION
    || value.channel !== 'stable'
    || typeof value.releaseVersion !== 'string'
    || !value.releaseVersion.trim()
    || typeof value.publishedAt !== 'string'
  ) {
    throw new Error('服务器资源通道清单格式无效。');
  }
  assertResourceDescriptor(value.releaseManifest, '资源版本清单');
  return value as ResourceChannelManifest;
}

export function normalizeResourceDeployment(value: unknown): ResourceDeploymentManifest {
  if (
    !isRecord(value)
    || value.type !== RESOURCE_DEPLOYMENT_TYPE
    || value.schemaVersion !== RESOURCE_RELEASE_SCHEMA_VERSION
    || typeof value.releaseVersion !== 'string'
    || !isRecord(value.delivery)
  ) {
    throw new Error('服务器资源版本清单格式无效。');
  }
  assertSha256(value.rootSha256, '资源根');
  assertResourceDescriptor(value.delivery.dataManifest, '数据清单');
  assertResourceDescriptor(value.delivery.imageManifest, '图片清单');
  return value as ResourceDeploymentManifest;
}
