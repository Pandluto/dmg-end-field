import type { Character, SkillType } from '../types';
import type { EquipmentLibrary } from '../core/services/operatorEquipmentLibrary';
import { normalizeOperatorEquipmentLibrary } from '../core/services/operatorEquipmentLibrary';
import {
  buildRuntimeTemplatesFromDraftMap,
  normalizeOperatorDraft,
} from '../core/services/operatorTemplateAdapter';
import { adaptRuntimeTemplateToLegacyCharacter } from '../core/services/localOperatorAdapter';
import { normalizeBuffDraft, type BuffDraft, type BuffEffectDraft } from '../components/buffDraftModel';
import { buffFromSearchResult } from '../components/buffBatchEditModel';
import type { LocalBuffSearchResult } from '../components/CanvasBoard/skillButton.shared';
import {
  normalizeWeaponDraft,
  type RawWeaponDraft,
  type WeaponDraft,
} from '../components/weaponDraftModel';
import type { SkillButtonBuff } from '../types/storage';
import { resolvePublicPath } from '../utils/assetResolver';
import type { MobileCatalog } from './model';
import type { OperatorDraft } from '../core/templates/operatorTemplate';
import { fetchCurrentResourceRelease } from '../platform/resources/resourceChannel';
import { sha256Hex } from '../platform/resources/resourceIntegrity';

const DEFAULT_LOCAL_DATA_PATH = 'data/default-local-data.json';
const DATA_ARCHIVE_TYPE = 'def.localdata.archive.v1';
const DATA_MANIFEST_SCHEMA_VERSION = 1;

type JsonRecord = Record<string, unknown>;

type MobileManifestEntry = {
  path: string;
  downloadPath?: string;
  sha256: string;
  size?: number;
};

type MobileDataManifest = {
  schemaVersion: typeof DATA_MANIFEST_SCHEMA_VERSION;
  packageId: string;
  version: string;
  generatedAt?: string;
  files: MobileManifestEntry[];
};

type MobileImageManifest = {
  schemaVersion: typeof DATA_MANIFEST_SCHEMA_VERSION;
  packageId: string;
  version: string;
  generatedAt?: string;
  files: MobileManifestEntry[];
};

type MobileArchive = {
  id: string;
  createdAt?: string;
  exportedAt?: string;
  dataVersion?: string;
  storage: {
    local: JsonRecord;
    session: JsonRecord;
  };
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseRecordValue(value: unknown): JsonRecord | null {
  if (typeof value === 'string') {
    try {
      return parseRecordValue(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return isRecord(value) ? value : null;
}

function requireRecord(value: unknown, label: string): JsonRecord {
  const record = parseRecordValue(value);
  if (!record) {
    throw new Error(`${label}必须是对象。`);
  }
  return record;
}

function appendQuery(url: string, key: string, value: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function normalizeManifestEntry(value: unknown, index: number): MobileManifestEntry {
  if (!isRecord(value)) {
    throw new Error(`第 ${index + 1} 个文件条目无效。`);
  }
  if (typeof value.path !== 'string' || !value.path.trim()) {
    throw new Error(`第 ${index + 1} 个文件条目缺少 path。`);
  }
  const normalizedPath = value.path.trim().replace(/\\/g, '/');
  if (
    normalizedPath.startsWith('/')
    || /^(?:[a-z]+:)?\/\//i.test(normalizedPath)
    || normalizedPath.split('/').includes('..')
  ) {
    throw new Error(`第 ${index + 1} 个文件条目的 path 越界。`);
  }
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256.trim())) {
    throw new Error(`第 ${index + 1} 个文件条目缺少 sha256。`);
  }
  if (
    value.size !== undefined
    && (!Number.isSafeInteger(value.size) || Number(value.size) < 0)
  ) {
    throw new Error(`第 ${index + 1} 个文件条目的 size 无效。`);
  }
  const downloadPath = typeof value.downloadPath === 'string'
    ? value.downloadPath.trim().replace(/\\/g, '/')
    : '';
  if (
    downloadPath
    && (
      downloadPath.startsWith('/')
      || /^(?:[a-z]+:)?\/\//i.test(downloadPath)
      || downloadPath.split('/').includes('..')
    )
  ) {
    throw new Error(`第 ${index + 1} 个文件条目的 downloadPath 越界。`);
  }
  return {
    path: normalizedPath,
    ...(downloadPath ? { downloadPath } : {}),
    sha256: value.sha256.trim(),
    ...(value.size === undefined ? {} : { size: Number(value.size) }),
  };
}

function normalizeDataManifest(value: unknown): MobileDataManifest {
  if (!isRecord(value)) {
    throw new Error('根节点必须是对象。');
  }
  if (value.schemaVersion !== DATA_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`schemaVersion 必须是 ${DATA_MANIFEST_SCHEMA_VERSION}。`);
  }
  if (typeof value.packageId !== 'string' || !value.packageId.trim()) {
    throw new Error('缺少 packageId。');
  }
  if (typeof value.version !== 'string' || !value.version.trim()) {
    throw new Error('缺少 version。');
  }
  if (!Array.isArray(value.files)) {
    throw new Error('files 必须是数组。');
  }

  const files = value.files.map(normalizeManifestEntry);
  const matchingFiles = files.filter((entry) => (
    entry.path.replace(/^\.\//, '').replace(/^\/+/, '') === DEFAULT_LOCAL_DATA_PATH
  ));
  if (matchingFiles.length === 0) {
    throw new Error(`files 中找不到 ${DEFAULT_LOCAL_DATA_PATH}。`);
  }
  if (matchingFiles.length > 1) {
    throw new Error(`${DEFAULT_LOCAL_DATA_PATH} 存在重复条目。`);
  }

  return {
    schemaVersion: DATA_MANIFEST_SCHEMA_VERSION,
    packageId: value.packageId.trim(),
    version: value.version.trim(),
    ...(typeof value.generatedAt === 'string' ? { generatedAt: value.generatedAt } : {}),
    files,
  };
}

function normalizeImageManifest(value: unknown): MobileImageManifest {
  if (!isRecord(value)) {
    throw new Error('根节点必须是对象。');
  }
  if (value.schemaVersion !== DATA_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`schemaVersion 必须是 ${DATA_MANIFEST_SCHEMA_VERSION}。`);
  }
  if (typeof value.packageId !== 'string' || !value.packageId.trim()) {
    throw new Error('缺少 packageId。');
  }
  if (typeof value.version !== 'string' || !value.version.trim()) {
    throw new Error('缺少 version。');
  }
  if (!Array.isArray(value.files)) {
    throw new Error('files 必须是数组。');
  }
  return {
    schemaVersion: DATA_MANIFEST_SCHEMA_VERSION,
    packageId: value.packageId.trim(),
    version: value.version.trim(),
    ...(typeof value.generatedAt === 'string' ? { generatedAt: value.generatedAt } : {}),
    files: value.files.map(normalizeManifestEntry),
  };
}

function normalizeArchive(value: unknown): MobileArchive {
  if (!isRecord(value)) {
    throw new Error('根节点必须是对象。');
  }
  if (value.type !== DATA_ARCHIVE_TYPE) {
    throw new Error(`type 必须是 ${DATA_ARCHIVE_TYPE}。`);
  }
  if (value.schemaVersion !== DATA_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`schemaVersion 必须是 ${DATA_MANIFEST_SCHEMA_VERSION}。`);
  }
  if (typeof value.id !== 'string' || !value.id.trim()) {
    throw new Error('缺少 id。');
  }
  if (!isRecord(value.storage)) {
    throw new Error('缺少 storage。');
  }

  const local = requireRecord(value.storage.local, 'storage.local');
  const session = parseRecordValue(value.storage.session) ?? {};
  const requiredLibraries = [
    'def.operator-editor.library.v1',
    'def.weapon-sheet.library.v1',
    'def.equipment-sheet.library.v1',
    'def.buff-editor.library.v1',
  ];
  requiredLibraries.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(local, key)) {
      throw new Error(`storage.local 缺少 ${key}。`);
    }
    requireRecord(local[key], `storage.local.${key}`);
  });

  return {
    id: value.id.trim(),
    ...(typeof value.createdAt === 'string' ? { createdAt: value.createdAt } : {}),
    ...(typeof value.exportedAt === 'string' ? { exportedAt: value.exportedAt } : {}),
    ...(typeof value.dataVersion === 'string' ? { dataVersion: value.dataVersion } : {}),
    storage: { local, session },
  };
}

async function fetchVerifiedJson(entry: MobileManifestEntry, label: string): Promise<unknown> {
  if (entry.size !== undefined && entry.size > 64 * 1024 * 1024) {
    throw new Error(`${label}体积超出限制。`);
  }
  const sourcePath = entry.downloadPath || entry.path;
  const url = appendQuery(resolvePublicPath(sourcePath), 'sha256', entry.sha256);
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store' });
  } catch {
    throw new Error(`${label}网络请求失败，请检查网络连接。`);
  }
  if (!response.ok) {
    throw new Error(`${label}失败：HTTP ${response.status}。`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 64 * 1024 * 1024) throw new Error(`${label}体积超出限制。`);
  if (
    (entry.size !== undefined && bytes.byteLength !== entry.size)
    || await sha256Hex(bytes) !== entry.sha256
  ) {
    throw new Error(`${label}校验失败。`);
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes).replace(/^\uFEFF/, '')) as unknown;
  } catch {
    throw new Error(`${label}不是有效 JSON。`);
  }
}

function versionImageUrl(path: string | undefined, imageVersion: string): string | undefined {
  const value = path?.trim();
  if (!value) return undefined;
  if (/^(?:data|blob):/i.test(value)) return value;
  const resolved = /^(?:[a-z]+:)?\/\//i.test(value) || /^(?:file):/i.test(value)
    ? value
    : resolvePublicPath(value);
  const hashIndex = resolved.indexOf('#');
  const withoutHash = hashIndex >= 0 ? resolved.slice(0, hashIndex) : resolved;
  const hash = hashIndex >= 0 ? resolved.slice(hashIndex) : '';
  return `${appendQuery(withoutHash, 'imageVersion', imageVersion)}${hash}`;
}

export function versionMobileImageUrl(path: string | undefined, imageVersion: string): string | undefined {
  return versionImageUrl(path, imageVersion);
}

function versionCharacterImages(
  character: Character,
  sourceDraft: OperatorDraft | undefined,
  imageVersion: string,
): Character {
  const rawSkillByType: Partial<Record<SkillType, { iconUrl?: string }>> = {};
  const rawSkills = sourceDraft?.skills ?? {};
  Object.values(rawSkills).forEach((skill) => {
    if (skill.buttonType in { A: true, B: true, E: true, Q: true, Dot: true }) {
      rawSkillByType[skill.buttonType] = skill;
    }
  });

  const skillIconMap = Object.fromEntries(
    Object.entries(character.skillIconMap ?? {}).flatMap(([skillType, iconUrl]) => {
      const resolved = versionImageUrl(
        rawSkillByType[skillType as SkillType]?.iconUrl || iconUrl,
        imageVersion,
      );
      return resolved ? [[skillType, resolved]] : [];
    }),
  ) as Character['skillIconMap'];

  const sandboxSkills = character.sandboxSkills?.map((skill) => {
    const rawSkill = rawSkills[skill.id];
    const iconUrl = versionImageUrl(rawSkill?.iconUrl || skill.iconUrl, imageVersion);
    return iconUrl ? { ...skill, iconUrl } : { ...skill, iconUrl: undefined };
  });

  return {
    ...character,
    librarySource: 'official',
    avatarUrl: versionImageUrl(sourceDraft?.avatarUrl || character.avatarUrl, imageVersion),
    skillIconMap,
    sandboxSkills: sandboxSkills?.map((skill) => ({ ...skill, source: 'official' })),
  };
}

function normalizeOperatorLibrary(value: unknown, imageVersion: string): Character[] {
  const source = requireRecord(value, '干员库');
  const normalizedDraftMap = Object.fromEntries(
    Object.entries(source).map(([libraryKey, rawDraft]) => {
      if (!isRecord(rawDraft)) {
        throw new Error(`干员 ${libraryKey} 必须是对象。`);
      }
      const draft = normalizeOperatorDraft(cloneJson(rawDraft) as unknown as OperatorDraft);
      return [libraryKey, draft] as const;
    }),
  ) as Record<string, OperatorDraft>;
  const sourceDraftsById = new Map(
    Object.values(normalizedDraftMap).map((draft) => [draft.id, draft] as const),
  );
  const templates = buildRuntimeTemplatesFromDraftMap(normalizedDraftMap);
  return templates.map((template) => versionCharacterImages(
    adaptRuntimeTemplateToLegacyCharacter(template),
    sourceDraftsById.get(template.id),
    imageVersion,
  ));
}

function imageStem(imagePath: string): string {
  const fileName = imagePath.replace(/\\/g, '/').split('/').pop() || '';
  const extensionIndex = fileName.lastIndexOf('.');
  return (extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName)
    .normalize('NFKC');
}

function weaponImagePathPriority(imagePath: string): number {
  if (imagePath.includes('/img-wepaon/')) return 0;
  if (imagePath.includes('/img-operator/')) return 1;
  return 2;
}

function buildImagePathByStem(files: MobileManifestEntry[]): Map<string, string> {
  const paths = new Map<string, string>();
  files.forEach((entry) => {
    const stem = imageStem(entry.path);
    if (!stem) return;
    const current = paths.get(stem);
    if (!current || weaponImagePathPriority(entry.path) < weaponImagePathPriority(current)) {
      paths.set(stem, entry.path);
    }
  });
  return paths;
}

function normalizeWeaponLibrary(
  value: unknown,
  imageVersion: string,
  imageFiles: MobileManifestEntry[],
): Record<string, WeaponDraft> {
  const source = requireRecord(value, '武器库');
  const imagePathByStem = buildImagePathByStem(imageFiles);
  return Object.fromEntries(
    Object.entries(source).map(([libraryKey, rawWeapon]) => {
      if (!isRecord(rawWeapon)) {
        throw new Error(`武器 ${libraryKey} 必须是对象。`);
      }
      const weapon = normalizeWeaponDraft(cloneJson(rawWeapon) as RawWeaponDraft);
      const imagePath = weapon.imgUrl || imagePathByStem.get(weapon.name.trim().normalize('NFKC'));
      return [
        libraryKey,
        {
          ...weapon,
          imgUrl: versionImageUrl(imagePath, imageVersion) || '',
        },
      ] as const;
    }),
  );
}

function versionEquipmentImages(library: EquipmentLibrary, imageVersion: string): EquipmentLibrary {
  return {
    gearSets: Object.fromEntries(
      Object.entries(library.gearSets).map(([gearSetId, gearSet]) => [
        gearSetId,
        {
          ...gearSet,
          equipments: Object.fromEntries(
            Object.entries(gearSet.equipments).map(([equipmentId, equipment]) => [
              equipmentId,
              {
                ...equipment,
                ...(equipment.imgUrl
                  ? { imgUrl: versionImageUrl(equipment.imgUrl, imageVersion) }
                  : {}),
              },
            ]),
          ),
        },
      ]),
    ),
  };
}

export function flattenMobileBuffLibrary(value: unknown): SkillButtonBuff[] {
  const source = requireRecord(value, 'Buff 库');
  return Object.entries(source).flatMap(([groupKey, rawGroup]) => {
    if (!isRecord(rawGroup)) {
      throw new Error(`Buff 组 ${groupKey} 必须是对象。`);
    }
    const draft = normalizeBuffDraft(
      cloneJson(rawGroup) as Partial<BuffDraft> & {
        buffs?: Record<string, Partial<BuffEffectDraft>>;
      },
    );
    return Object.entries(draft.items).flatMap(([itemKey, item]) => (
      Object.entries(item.effects).map(([effectKey, effect]) => {
        const entry: LocalBuffSearchResult = {
          key: `${groupKey}/${itemKey}/${effectKey}`,
          sourceKind: 'local',
          groupId: groupKey,
          groupName: draft.name || groupKey,
          itemId: itemKey,
          itemName: item.name || itemKey,
          effectId: effectKey,
          displayName: effect.displayName || effectKey,
          name: effect.name || effectKey,
          type: effect.type,
          value: effect.value,
          description: effect.description,
          condition: effect.condition,
          category: effect.category,
          maxStacks: effect.maxStacks,
          sourceName: effect.sourceName || item.sourceName || draft.sourceName || draft.name || groupKey,
          source: effect.source || draft.source || 'online',
          level: effect.level || '',
          valueMode: effect.valueMode,
          derivedValue: effect.derivedValue,
          effectKind: effect.effectKind,
          extraHitConfig: effect.extraHitConfig,
          multiplier: effect.multiplier,
        };
        return buffFromSearchResult(entry);
      })
    ));
  });
}

function buildMobileCatalog(
  archive: MobileArchive,
  dataManifest: MobileDataManifest,
  imageManifest: MobileImageManifest,
): MobileCatalog {
  const local = archive.storage.local;
  const imageVersion = imageManifest.version;
  try {
    const characters = normalizeOperatorLibrary(
      local['def.operator-editor.library.v1'],
      imageVersion,
    );
    const weapons = normalizeWeaponLibrary(
      local['def.weapon-sheet.library.v1'],
      imageVersion,
      imageManifest.files,
    );
    const equipmentSource = requireRecord(
      local['def.equipment-sheet.library.v1'],
      '装备库',
    );
    const gearSets = requireRecord(equipmentSource.gearSets, '装备库 gearSets');
    const equipment = versionEquipmentImages(
      normalizeOperatorEquipmentLibrary(cloneJson({ ...equipmentSource, gearSets })),
      imageVersion,
    );
    const buffs = flattenMobileBuffLibrary(local['def.buff-editor.library.v1']);
    return {
      dataVersion: dataManifest.version || archive.dataVersion || '',
      imageVersion,
      generatedAt: dataManifest.generatedAt || archive.exportedAt || archive.createdAt || imageManifest.generatedAt || '',
      characters,
      weapons,
      equipment,
      buffs,
    };
  } catch (error) {
    throw new Error(`移动端官方目录转换失败：${errorMessage(error)}`);
  }
}

export async function loadMobileCatalog(): Promise<MobileCatalog> {
  const release = await fetchCurrentResourceRelease({ fresh: true });
  const rawDataManifest = release.dataManifest;

  let dataManifest: MobileDataManifest;
  try {
    dataManifest = normalizeDataManifest(rawDataManifest);
  } catch (error) {
    throw new Error(`移动端数据清单格式无效：${errorMessage(error)}`);
  }

  const dataEntry = dataManifest.files.find((entry) => (
    entry.path.replace(/^\.\//, '').replace(/^\/+/, '') === DEFAULT_LOCAL_DATA_PATH
  ));
  if (!dataEntry) {
    throw new Error(`移动端数据清单格式无效：找不到 ${DEFAULT_LOCAL_DATA_PATH}。`);
  }

  const rawArchive = await fetchVerifiedJson(dataEntry, '移动端官方数据包加载');

  let archive: MobileArchive;
  try {
    archive = normalizeArchive(rawArchive);
  } catch (error) {
    throw new Error(`移动端官方数据包格式无效：${errorMessage(error)}`);
  }

  const rawImageManifest = release.imageManifest;
  let imageManifest: MobileImageManifest;
  try {
    imageManifest = normalizeImageManifest(rawImageManifest);
  } catch (error) {
    throw new Error(`移动端图片清单格式无效：${errorMessage(error)}`);
  }

  return buildMobileCatalog(archive, dataManifest, imageManifest);
}
