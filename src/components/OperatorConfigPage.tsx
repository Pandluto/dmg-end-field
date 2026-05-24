import React from 'react';
import './CanvasBoard/CanvasBoard.css';
import './OperatorConfigPage.css';
import { useAppContext } from '../context/AppContext';
import { STORAGE_KEYS } from '../constants/storage-keys';
import { adaptRuntimeTemplateToLegacyCharacter, loadLocalOperatorCharacters } from '../core/services/localOperatorAdapter';
import { buildConfigSnapshot } from '../core/calculators/operatorPanelCalculator';
import type { ConfigSnapshot, EquipmentPieceInput, OperatorPanelInput } from '../core/calculators/operatorPanelCalculator';
import type { Character, SkillType } from '../types';
import type {
  OperatorConfigPageCache,
  OperatorConfigPageCharacterConfig,
  OperatorConfigPageEquipmentPieceState,
  OperatorConfigPageEntryState,
} from '../types/storage';
import { getOperatorConfigPageCache, getRuntimeOperatorTemplateMap, safeSessionStorage, setOperatorConfigPageCache } from '../utils/storage';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';

type AttributeItem = {
  label: string;
  value: string;
  tone?: 'main' | 'sub';
};

type EquipmentPart = '护甲' | '护手' | '配件';
type EquipmentEffectId = 'effect1' | 'effect2' | 'effect3';
type EquipmentLevelKey = '0' | '1' | '2' | '3';

interface EquipmentEffect {
  effectId: EquipmentEffectId;
  label: string;
  typeKey: string;
  category: 'ability' | 'buff';
  levels: Partial<Record<EquipmentLevelKey, number>>;
  unit: 'flat' | 'percent';
  raw?: string;
}

interface EquipmentItem {
  equipmentId: string;
  name: string;
  part: EquipmentPart;
  imgUrl?: string;
  effects: Partial<Record<EquipmentEffectId, EquipmentEffect>>;
}

interface EquipmentGearSet {
  gearSetId: string;
  name: string;
  equipments: Record<string, EquipmentItem>;
}

interface EquipmentLibrary {
  gearSets: Record<string, EquipmentGearSet>;
}

interface WeaponSkillLevelData {
  value?: number;
  description?: string;
  passive?: Record<string, unknown>;
}

interface WeaponSkillData {
  name?: string;
  statType?: string;
  levels?: Record<string, WeaponSkillLevelData>;
  effects?: Record<string, {
    name?: string;
    type?: string;
    category?: string;
    levels?: Record<string, number>;
  }>;
}

interface WeaponData {
  name: string;
  rarity?: number;
  type?: string;
  description?: string;
  imgUrl?: string;
  attackGrowth?: Record<string, number>;
  skills?: {
    skill1?: WeaponSkillData;
    skill2?: WeaponSkillData;
    skill3?: WeaponSkillData;
  };
}

type OperatorSkillKey = 'A' | 'B' | 'E' | 'Q';
type CharacterAttributeKey = keyof Character['attributes'];
type RawWeaponLibrary = Record<string, Partial<WeaponData> & { id?: string; imgUrl?: string }>;
type SkillHitDetail = {
  key: string;
  displayName: string;
  value: number | string;
  element: string;
  skillType: OperatorSkillKey;
};
type SkillDetailGroup = {
  id: string;
  displayName: string;
  buttonType: OperatorSkillKey;
  iconUrl?: string;
  hits: SkillHitDetail[];
};
type OperatorConfigPageDraftMap = Record<string, OperatorConfigPageCharacterConfig>;

const SKILL_ITEMS = [
  { key: 'A', name: '普攻占位' },
  { key: 'B', name: '战技占位' },
  { key: 'E', name: '连携技占位' },
  { key: 'Q', name: '终结技占位' },
] as const satisfies ReadonlyArray<{ key: OperatorSkillKey; name: string }>;

const SLOT_COUNT = 8;
const MAX_MASTERY_LEVEL = 3;
// 暂时保留，等待装备区重构后决定是否恢复或删除。
const EQUIPMENT_FORM_ROWS = [
  {
    columns: 'operator-config-page-equip-row--6',
    fields: [
      { label: '力量', suffix: '' },
      { label: '敏捷', suffix: '' },
      { label: '智识', suffix: '' },
      { label: '意志', suffix: '' },
      { label: '主能力', suffix: '%' },
      { label: '副能力', suffix: '%' },
    ],
  },
  {
    columns: 'operator-config-page-equip-row--4',
    fields: [
      { label: '暴击率', suffix: '%' },
      { label: '暴击伤害', suffix: '%' },
      { label: '防御值', suffix: '' },
      { label: '生命', suffix: '' },
    ],
  },
  {
    columns: 'operator-config-page-equip-row--3',
    fields: [
      { label: '物理伤害加成', suffix: '%' },
      { label: '灼热伤害加成', suffix: '%' },
      { label: '电磁伤害加成', suffix: '%' },
    ],
  },
  {
    columns: 'operator-config-page-equip-row--3',
    fields: [
      { label: '寒冷伤害加成', suffix: '%' },
      { label: '自然伤害加成', suffix: '%' },
      { label: '法术伤害加成', suffix: '%' },
    ],
  },
  {
    columns: 'operator-config-page-equip-row--3',
    fields: [
      { label: '战技伤害加成', suffix: '%' },
      { label: '连携技伤害加成', suffix: '%' },
      { label: '终结技伤害加成', suffix: '%' },
    ],
  },
  {
    columns: 'operator-config-page-equip-row--3',
    fields: [
      { label: '普通攻击伤害加成', suffix: '%' },
      { label: '对失衡目标伤害加成', suffix: '%' },
      { label: '源石技艺强度', suffix: '' },
    ],
  },
] as const;

const CHARACTER_LEVEL_VALUES = [1, 20, 30, 40, 50, 60, 70, 80, 90] as const;
const CHARACTER_LEVEL_LABELS = ['1级', '20级', '30级', '40级', '50级', '60级', '70级', '80级', '90级'] as const;
const DEFAULT_WEAPON_SKILL_LEVELS = {
  skill1: 9,
  skill2: 9,
  skill3: 4,
} as const;
const DEFAULT_SKILL_MODE = 'M3';
const EMPTY_RECORD: Record<string, unknown> = {};
const EQUIPMENT_SLOT_KEYS = ['accessory1', 'accessory2', 'armor', 'glove'] as const;
type EquipmentSlotKey = (typeof EQUIPMENT_SLOT_KEYS)[number];
type EquipmentEntryIndex = 0 | 1 | 2;
const DISABLED_CHARACTER_LEVEL_COUNTS = new Set([2, 4, 6]);
const WEAPON_SKILL1_TYPE_MAP: Record<string, string> = {
  敏捷提升: 'agilityBoost',
  力量提升: 'strengthBoost',
  意志提升: 'willBoost',
  智识提升: 'intelligenceBoost',
  主能力提升: 'mainStatBoost',
  副能力提升: 'subStatBoost',
};
const WEAPON_SKILL2_TYPE_MAP: Record<string, string> = {
  攻击提升: 'atkPercentBoost',
  生命提升: 'hp',
  物理伤害提升: 'physicalDmgBonus',
  灼热伤害提升: 'fireDmgBonus',
  电磁伤害提升: 'electricDmgBonus',
  寒冷伤害提升: 'iceDmgBonus',
  自然伤害提升: 'natureDmgBonus',
  暴击率提升: 'critRateBoost',
  暴击伤害提升: 'critDmgBonusBoost',
  源石技艺提升: 'sourceSkillBoost',
  终结技充能效率提升: 'ultimateChargeEfficiency',
  法术伤害提升: 'magicDmgBonus',
  治疗效率提升: 'healingBonus',
};
const WEAPON_LIBRARY_STORAGE_KEY = 'def.weapon-sheet.library.v1';
const EQUIPMENT_LIBRARY_STORAGE_KEY = 'def.equipment-sheet.draft.v1';
const EQUIPMENT_SLOT_METAS = [
  { slotKey: 'armor', groupClass: 'operator-config-page-equip-button-group--1', rowClass: 'operator-config-page-equip-button-row--1', part: '护甲', circleClass: 'operator-config-page-equip-circle--1' },
  { slotKey: 'accessory2', groupClass: 'operator-config-page-equip-button-group--2', rowClass: 'operator-config-page-equip-button-row--2', part: '配件', circleClass: 'operator-config-page-equip-circle--2' },
  { slotKey: 'accessory1', groupClass: 'operator-config-page-equip-button-group--3', rowClass: 'operator-config-page-equip-button-row--3', part: '配件', circleClass: 'operator-config-page-equip-circle--3' },
  { slotKey: 'glove', groupClass: 'operator-config-page-equip-button-group--4', rowClass: 'operator-config-page-equip-button-row--4', part: '护手', circleClass: 'operator-config-page-equip-circle--4' },
] as const satisfies ReadonlyArray<{ slotKey: EquipmentSlotKey; groupClass: string; rowClass: string; part: EquipmentPart; circleClass: string }>;

function resolveStoredImageUrl(path?: string): string {
  if (!path) return '';
  if (/^(?:https?:)?\/\//i.test(path)) return path;
  if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith('user-images/')) {
    return path;
  }
  return path.startsWith('/') ? path : `/${path}`;
}

function resolveWeaponImageUrl(weaponName?: string): string {
  if (!weaponName) return '';
  return `http://127.0.0.1:31457/user-images/img-weapon/${encodeURIComponent(weaponName)}.png`;
}

function readLocalStorageJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function isSameConfigSnapshot(currentSnapshot: ConfigSnapshot | undefined, nextSnapshot: ConfigSnapshot): boolean {
  try {
    return JSON.stringify(currentSnapshot ?? null) === JSON.stringify(nextSnapshot);
  } catch {
    return false;
  }
}

function isReusableConfigSnapshot(snapshot: ConfigSnapshot | undefined): boolean {
  return (
    typeof snapshot?.panel?.display?.atk === 'number'
    && typeof snapshot.panel.display.hp === 'number'
    && typeof snapshot.panel.calc?.atkPercentBoost === 'number'
  );
}

function readSelectedCharacterIdsFromSession(): string[] {
  const raw = safeSessionStorage.getItem(STORAGE_KEYS.SELECTED_CHARACTERS);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .slice(0, 4);
  } catch {
    return [];
  }
}

function normalizeEquipmentLibrary(raw: unknown): EquipmentLibrary {
  const source = raw as Partial<EquipmentLibrary> | null | undefined;
  const next: EquipmentLibrary = {
    gearSets: {},
  };
  const rawGearSets = source?.gearSets && typeof source.gearSets === 'object' ? source.gearSets : {};
  Object.entries(rawGearSets).forEach(([gearSetId, rawSet]) => {
    const setValue = rawSet as Partial<EquipmentGearSet>;
    const equipments: Record<string, EquipmentItem> = {};
    const rawEquipments = setValue.equipments && typeof setValue.equipments === 'object' ? setValue.equipments : {};
    Object.entries(rawEquipments).forEach(([equipmentId, rawEquipment]) => {
      const itemValue = rawEquipment as Partial<EquipmentItem>;
      const effects = (['effect1', 'effect2', 'effect3'] as const).reduce<Partial<Record<EquipmentEffectId, EquipmentEffect>>>((acc, effectId) => {
        const rawEffect = itemValue.effects?.[effectId];
        if (!rawEffect) return acc;
        acc[effectId] = {
          effectId,
          label: String(rawEffect.label || effectId),
          typeKey: String(rawEffect.typeKey || ''),
          category: rawEffect.category === 'ability' ? 'ability' : 'buff',
          levels: rawEffect.levels ?? {},
          unit: rawEffect.unit === 'percent' ? 'percent' : 'flat',
          raw: rawEffect.raw,
        };
        return acc;
      }, {});
      equipments[equipmentId] = {
        equipmentId: String(itemValue.equipmentId || equipmentId),
        name: String(itemValue.name || equipmentId),
        part: itemValue.part === '护甲' || itemValue.part === '护手' ? itemValue.part : '配件',
        imgUrl: String(itemValue.imgUrl || ''),
        effects,
      };
    });
    next.gearSets[gearSetId] = {
      gearSetId: String(setValue.gearSetId || gearSetId),
      name: String(setValue.name || gearSetId),
      equipments,
    };
  });
  return next;
}

function normalizeWeaponLibrary(raw: unknown): Record<string, WeaponData & { id: string; imgUrl: string }> {
  const source = raw && typeof raw === 'object' ? (raw as RawWeaponLibrary) : {};
  const next: Record<string, WeaponData & { id: string; imgUrl: string }> = {};
  Object.entries(source).forEach(([draftId, rawWeapon]) => {
    const weaponName = String(rawWeapon?.name || draftId).trim();
    if (!weaponName) return;
    next[weaponName] = {
      id: String(rawWeapon?.id || draftId || weaponName),
      name: weaponName,
      rarity: typeof rawWeapon?.rarity === 'number' ? rawWeapon.rarity : 6,
      type: String(rawWeapon?.type || ''),
      description: String(rawWeapon?.description || ''),
      attackGrowth: rawWeapon?.attackGrowth ?? {},
      imgUrl: String(rawWeapon?.imgUrl || ''),
      skills: rawWeapon?.skills ?? {},
    };
  });
  return next;
}

function createEquipmentEntry(entryId: string): OperatorConfigPageEntryState {
  return {
    id: entryId,
    config: { level: 0 },
    data: {},
  };
}

function createEquipmentPiece(pieceId = ''): OperatorConfigPageEquipmentPieceState {
  return {
    id: pieceId,
    entryCount: 0,
    entries: [
      createEquipmentEntry('entry1'),
      createEquipmentEntry('entry2'),
      createEquipmentEntry('entry3'),
    ],
    config: {},
    data: {},
  };
}

function createEmptyWeaponState() {
  return {
    id: '',
    config: {
      level: 90,
      potential: '0潜',
      skillLevels: { ...DEFAULT_WEAPON_SKILL_LEVELS },
    },
    data: {},
  };
}

function createCharacterData(character: Character): Record<string, unknown> {
  return {
    id: character.id,
    name: character.name,
    element: character.element,
    rarity: character.rarity,
    profession: character.profession,
    mainStat: character.mainStat,
    subStat: character.subStat,
    attributes: character.attributes,
    avatarUrl: character.avatarUrl ?? '',
    sandboxSkills: character.sandboxSkills ?? [],
    skills: {
      A: {
        name: character.skills.normalAttack.name,
        type: character.skills.normalAttack.type,
      },
      B: {
        name: character.skills.skill.name,
        type: character.skills.skill.type,
      },
      E: {
        name: character.skills.chainSkill.name,
        type: character.skills.chainSkill.type,
      },
      Q: {
        name: character.skills.ultimate.name,
        type: character.skills.ultimate.type,
      },
    },
  };
}

function createDefaultCharacterConfig(character: Character): OperatorConfigPageCharacterConfig {
  return {
    character: {
      id: character.id,
      config: {
        level: 90,
        potential: '0潜',
        favorValue: 60,
      },
      data: createCharacterData(character),
    },
    weapon: {
      ...createEmptyWeaponState(),
    },
    equipment: {
      accessory1: createEquipmentPiece(),
      accessory2: createEquipmentPiece(),
      armor: createEquipmentPiece(),
      glove: createEquipmentPiece(),
    },
    skills: {
      id: character.id,
      config: {
        A: DEFAULT_SKILL_MODE,
        B: DEFAULT_SKILL_MODE,
        E: DEFAULT_SKILL_MODE,
        Q: DEFAULT_SKILL_MODE,
      },
      data: createCharacterData(character).skills as Record<string, unknown>,
    },
  };
}

function createCharacterConfigFromSnapshot(snapshot: ConfigSnapshot, sourceCharacter?: Character | null): OperatorConfigPageCharacterConfig {
  const baseCharacterData = sourceCharacter
    ? createCharacterData(sourceCharacter)
    : {
      id: snapshot.operator.id,
      name: snapshot.operator.name,
      element: snapshot.operator.element,
      mainStat: snapshot.operator.mainStat,
      subStat: snapshot.operator.subStat,
      attributes: {
        [levelValueToAttributeKey(snapshot.operator.level)]: snapshot.operator.baseAttributes,
      },
      skills: {},
    };
  const equipment = {
    accessory1: createEquipmentPiece(),
    accessory2: createEquipmentPiece(),
    armor: createEquipmentPiece(),
    glove: createEquipmentPiece(),
  };

  snapshot.equipment.pieces.forEach((piece) => {
    if (!EQUIPMENT_SLOT_KEYS.includes(piece.slotKey as EquipmentSlotKey)) return;
    const effectEntries = piece.effects.slice(0, 3).map((effect, index) => ({
      id: effect.effectId || `entry${index + 1}`,
      config: { level: effect.level },
      data: {
        effectId: effect.effectId || `effect${index + 1}`,
        label: effect.label,
        typeKey: effect.typeKey,
        category: 'buff',
        levels: { [String(effect.level)]: effect.value },
        unit: effect.unit === 'percent' ? 'percent' : 'flat',
        raw: effect.raw,
      },
    }));
    equipment[piece.slotKey as EquipmentSlotKey] = {
      id: piece.equipmentId,
      entryCount: Math.max(0, Math.min(3, effectEntries.length)),
      entries: [
        ...effectEntries,
        ...Array.from({ length: Math.max(0, 3 - effectEntries.length) }, (_, index) => createEquipmentEntry(`entry${effectEntries.length + index + 1}`)),
      ].slice(0, 3),
      config: {},
      data: {
        equipmentId: piece.equipmentId,
        name: piece.name,
        part: piece.part,
        imgUrl: piece.imgUrl,
        fixedStat: piece.fixedStat,
      },
    };
  });

  return {
    character: {
      id: snapshot.operator.id,
      config: {
        level: snapshot.operator.level,
        potential: snapshot.operator.potential,
        favorValue: snapshot.operator.favorValue,
      },
      data: baseCharacterData,
    },
    weapon: {
      id: snapshot.weapon.name || snapshot.weapon.id,
      config: snapshot.weapon.config,
      data: {
        id: snapshot.weapon.id,
        name: snapshot.weapon.name,
        attackGrowth: {
          [String(snapshot.weapon.config.level)]: snapshot.weapon.attack,
        },
      },
    },
    equipment,
    skills: {
      id: snapshot.operator.id,
      config: {
        A: snapshot.operator.skillConfig.A ?? DEFAULT_SKILL_MODE,
        B: snapshot.operator.skillConfig.B ?? DEFAULT_SKILL_MODE,
        E: snapshot.operator.skillConfig.E ?? DEFAULT_SKILL_MODE,
        Q: snapshot.operator.skillConfig.Q ?? DEFAULT_SKILL_MODE,
      },
      data: (baseCharacterData as Partial<Character>).skills as Record<string, unknown> ?? {},
    },
    sourceSnapshot: snapshot,
  };
}

function buildDraftMapFromSnapshotCache(cache: OperatorConfigPageCache, characters: Character[]): OperatorConfigPageDraftMap {
  const characterMap = new Map(characters.map((character) => [character.id, character] as const));
  return Object.fromEntries(
    Object.entries(cache).map(([characterId, snapshot]) => [
      characterId,
      createCharacterConfigFromSnapshot(snapshot, characterMap.get(characterId) ?? null),
    ])
  );
}

function findEquipmentItemInLibrary(equipmentLibrary: EquipmentLibrary | null, equipmentId: string): EquipmentItem | null {
  if (!equipmentLibrary || !equipmentId) return null;
  return Object.values(equipmentLibrary.gearSets)
    .flatMap((gearSet) => Object.values(gearSet.equipments))
    .find((item) => item.equipmentId === equipmentId) ?? null;
}

function getEquipmentEffectLevelValue(effect: Partial<EquipmentEffect> | undefined, level: number | string): number {
  const levels = effect?.levels;
  if (!levels) return 0;
  const value = levels[String(level) as EquipmentLevelKey];
  return typeof value === 'number' ? value : 0;
}

function hydrateEquipmentPieceFromLibrary(
  piece: OperatorConfigPageEquipmentPieceState,
  libraryItem: EquipmentItem
): OperatorConfigPageEquipmentPieceState {
  const libraryPiece = createEquipmentPieceFromItem(libraryItem);
  const previousEntryByEffectId = new Map(
    piece.entries.map((entry) => {
      const effect = entry.data as Partial<EquipmentEffect>;
      return [String(effect.effectId ?? entry.id), entry] as const;
    })
  );

  return {
    ...libraryPiece,
    entries: libraryPiece.entries.map((entry, index) => {
      const effect = entry.data as Partial<EquipmentEffect>;
      const previousEntry = previousEntryByEffectId.get(String(effect.effectId ?? entry.id)) ?? piece.entries[index];
      return previousEntry
        ? {
          ...entry,
          config: {
            ...entry.config,
            level: previousEntry.config.level,
          },
        }
        : entry;
    }),
  };
}

function hydrateDraftConfigFromLibraries(
  config: OperatorConfigPageCharacterConfig,
  weaponLibrary: Record<string, WeaponData & { id: string; imgUrl: string }>,
  equipmentLibrary: EquipmentLibrary | null
): OperatorConfigPageCharacterConfig {
  const weaponName = config.weapon.id || config.sourceSnapshot?.weapon.name || config.sourceSnapshot?.weapon.id || '';
  const weaponData = weaponLibrary[weaponName];
  let nextConfig = config;
  const currentWeaponData = config.weapon.data as Partial<WeaponData>;
  if (weaponData && (!currentWeaponData.skills || !currentWeaponData.attackGrowth)) {
    nextConfig = {
      ...nextConfig,
      weapon: {
        ...nextConfig.weapon,
        id: weaponData.name,
        data: weaponData as unknown as Record<string, unknown>,
      },
    };
  }

  if (!equipmentLibrary) {
    return nextConfig;
  }

  let equipmentChanged = false;
  const nextEquipment = { ...nextConfig.equipment };
  EQUIPMENT_SLOT_KEYS.forEach((slotKey) => {
    const piece = nextEquipment[slotKey];
    if (!piece.id) return;
    const libraryItem = findEquipmentItemInLibrary(equipmentLibrary, piece.id);
    if (!libraryItem) return;
    nextEquipment[slotKey] = hydrateEquipmentPieceFromLibrary(piece, libraryItem);
    equipmentChanged = true;
  });

  if (!equipmentChanged) {
    return nextConfig;
  }

  return {
    ...nextConfig,
    equipment: nextEquipment,
  };
}

function createEquipmentPieceFromItem(item: EquipmentItem): OperatorConfigPageEquipmentPieceState {
  const effectEntries = (['effect1', 'effect2', 'effect3'] as const)
    .map((effectId) => item.effects[effectId])
    .filter((effect): effect is EquipmentEffect => Boolean(effect))
    .map((effect) => ({
      id: effect.effectId,
      config: { level: 0 },
      data: effect as unknown as Record<string, unknown>,
    }));

  const fallbackEntries = [
    ...effectEntries,
    ...Array.from({ length: Math.max(0, 3 - effectEntries.length) }, (_, index) => createEquipmentEntry(`entry${effectEntries.length + index + 1}`)),
  ].slice(0, 3);

  return {
    id: item.equipmentId,
    entryCount: Math.max(0, Math.min(3, effectEntries.length)),
    entries: fallbackEntries,
    config: {},
    data: item as unknown as Record<string, unknown>,
  };
}

function formatEquipmentEffectValue(effect: EquipmentEffect | undefined, level: number | string): string {
  if (!effect) return '0';
  const numericValue = getEquipmentEffectLevelValue(effect, level);
  const suffix = effect.unit === 'percent' ? '%' : '';
  return `${numericValue}${suffix}`;
}

function truncateMiddleText(text: string, startCount: number, endCount: number): string {
  if (text.length <= startCount + endCount + 1) {
    return text;
  }
  return `${text.slice(0, startCount)}…${text.slice(-endCount)}`;
}

function getEquipmentEntryDisplayParts(entry: OperatorConfigPageEntryState | undefined, level: number | string): {
  head: string;
  tail: string;
  full: string;
} {
  if (!entry?.data || Object.keys(entry.data).length === 0) {
    return {
      head: '无',
      tail: '',
      full: '无',
    };
  }
  const effect = entry.data as unknown as EquipmentEffect;
  const head = `${effect.label} · ${effect.typeKey}`;
  const tail = `+ ${formatEquipmentEffectValue(effect, level)}`;
  return {
    head: truncateMiddleText(head, 4, 5),
    tail,
    full: `${head} ${tail}`,
  };
}

function formatWeaponRarityType(weapon: Partial<WeaponData>): string {
  const rarityText = typeof weapon.rarity === 'number' ? `${weapon.rarity}★` : '';
  const typeText = weapon.type?.trim() ?? '';
  return [rarityText, typeText].filter(Boolean).join(' / ');
}

function formatWeaponMetaLine(level: number, attack: number | null): string {
  return `Lv.${level} / ATK ${attack ?? '---'}`;
}

function formatWeaponSkillValue(levelData: WeaponSkillLevelData | undefined): string {
  if (typeof levelData?.value === 'number') {
    return String(levelData.value);
  }
  return levelData?.description?.trim() || '-';
}

function getWeaponSkillEnglishType(skillKey: 'skill1' | 'skill2' | 'skill3', statType?: string): string {
  const trimmed = statType?.trim() ?? '';
  if (!trimmed) {
    return '';
  }
  if (skillKey === 'skill1') {
    return WEAPON_SKILL1_TYPE_MAP[trimmed] ?? '';
  }
  if (skillKey === 'skill2') {
    return WEAPON_SKILL2_TYPE_MAP[trimmed] ?? '';
  }
  return '';
}

function getWeaponSummaryParts(label: string, typeKey: string, tail: string): { label: string; typeKey: string; tail: string; full: string } {
  return {
    label,
    typeKey,
    tail,
    full: `${label} · ${typeKey} ${tail}`.trim(),
  };
}

function formatWeaponSkillSummary(skillKey: 'skill1' | 'skill2', skill: WeaponSkillData | undefined, level: number): { label: string; typeKey: string; tail: string; full: string } {
  if (!skill) {
    return {
      label: '未选择武器',
      typeKey: '',
      tail: '',
      full: '未选择武器',
    };
  }
  const levelData = skill.levels?.[String(level)];
  const chineseLabel = skill.statType?.trim() || skill.name?.trim() || '-';
  const englishType = getWeaponSkillEnglishType(skillKey, skill.statType);
  return getWeaponSummaryParts(chineseLabel, englishType || '-', `+ ${formatWeaponSkillValue(levelData)}`);
}

function buildWeaponSkill3Lines(skill: WeaponSkillData | undefined, level: number): Array<{ label: string; typeKey: string; tail: string; full: string }> {
  if (!skill) {
    return [{ label: '未选择武器', typeKey: '', tail: '', full: '未选择武器' }];
  }

  const effectLines = Object.entries(skill.effects ?? {})
    .map(([effectKey, effect]) => {
      const value = effect.levels?.[String(level)];
      if (typeof value !== 'number') {
        return null;
      }
      const name = effect.name?.trim() || '效果';
      return getWeaponSummaryParts(name, effect.type?.trim() || effectKey, `+ ${value}`);
    })
    .filter((line): line is { label: string; typeKey: string; tail: string; full: string } => Boolean(line));
  if (effectLines.length > 0) {
    return effectLines;
  }

  const levelData = skill.levels?.[String(level)];
  const passiveEntries = Object.entries(levelData?.passive ?? {});
  if (passiveEntries.length > 0) {
    return passiveEntries.map(([key, value]) => getWeaponSummaryParts(key, 'passive', `+ ${String(value)}`));
  }

  const description = levelData?.description?.trim() || skill.name?.trim() || '未选择武器';
  const lines = description
    .split(/\r?\n|；|;/)
    .map((item) => item.trim())
    .filter(Boolean);
  return lines.length > 0
    ? lines.map((line) => ({ label: line, typeKey: '', tail: '', full: line }))
    : [{ label: '未选择武器', typeKey: '', tail: '', full: '未选择武器' }];
}

function parsePotentialToCount(potential: string): number {
  const numeric = Number.parseInt(potential, 10);
  if (Number.isNaN(numeric)) {
    return 1;
  }
  return Math.min(6, Math.max(1, numeric + 1));
}

function countToPotential(count: number): string {
  return `${Math.max(0, count - 1)}潜`;
}

function levelValueToCount(level: number | string): number {
  const numeric = typeof level === 'number' ? level : Number(level);
  const index = CHARACTER_LEVEL_VALUES.findIndex((value) => value === numeric);
  return index >= 0 ? index : CHARACTER_LEVEL_VALUES.length - 1;
}

function levelCountToValue(count: number): number {
  return CHARACTER_LEVEL_VALUES[Math.max(0, Math.min(CHARACTER_LEVEL_VALUES.length - 1, count))] ?? 90;
}

function levelValueToAttributeKey(level: number | string): CharacterAttributeKey {
  const numeric = typeof level === 'number' ? level : Number(level);
  if (numeric >= 90) return 'level90';
  if (numeric >= 80) return 'level80';
  if (numeric >= 60) return 'level60';
  if (numeric >= 40) return 'level40';
  if (numeric >= 20) return 'level20';
  return 'level1';
}

function getOperatorFavorValue(config: OperatorConfigPageCharacterConfig | null | undefined): number {
  const value = config?.character.config.favorValue;
  return typeof value === 'number' && Number.isFinite(value) ? value : 60;
}

function buildEquipmentPiecesForSnapshot(config: OperatorConfigPageCharacterConfig | null): EquipmentPieceInput[] {
  if (!config) return [];
  return EQUIPMENT_SLOT_KEYS.map((slotKey) => {
    const piece = config.equipment[slotKey];
    const pieceData = piece.data as Partial<EquipmentItem> & { fixedStat?: unknown };
    const effects = piece.entries
      .slice(0, piece.entryCount)
      .map((entry) => {
        const effect = entry.data as Partial<EquipmentEffect>;
        const level = entry.config.level;
        const value = getEquipmentEffectLevelValue(effect, level);
        return {
          effectId: String(effect.effectId ?? entry.id),
          label: String(effect.label ?? entry.id),
          typeKey: String(effect.typeKey ?? ''),
          level,
          value,
          unit: effect.unit ?? 'flat',
          raw: effect.raw,
        };
      })
      .filter((effect) => effect.typeKey.length > 0);
    return {
      slotKey,
      equipmentId: piece.id,
      name: String(pieceData.name ?? piece.id ?? ''),
      part: String(pieceData.part ?? ''),
      imgUrl: String(pieceData.imgUrl ?? ''),
      fixedStat: pieceData.fixedStat,
      effects,
    };
  }).filter((piece) => piece.equipmentId || piece.effects.length > 0);
}

function buildOperatorPanelInput(config: OperatorConfigPageCharacterConfig | null, activeCharacter: Character | null): OperatorPanelInput | null {
  if (!config && !activeCharacter) return null;
  const operatorData = (config?.character.data ?? {}) as Partial<Character>;
  const weaponData = (config?.weapon.data ?? {}) as Partial<WeaponData>;
  return {
    operator: {
      id: config?.character.id ?? activeCharacter?.id ?? '',
      name: operatorData.name ?? activeCharacter?.name ?? '',
      level: config?.character.config.level ?? 90,
      potential: config?.character.config.potential ?? '0潜',
      element: operatorData.element ?? activeCharacter?.element ?? '',
      mainStat: operatorData.mainStat ?? activeCharacter?.mainStat ?? '',
      subStat: operatorData.subStat ?? activeCharacter?.subStat ?? '',
      favorValue: getOperatorFavorValue(config),
      skillConfig: config?.skills.config,
      attributes: operatorData.attributes ?? activeCharacter?.attributes ?? {},
    },
    weapon: {
      id: config?.weapon.id ?? '',
      name: weaponData.name ?? config?.weapon.id ?? '',
      config: config?.weapon.config,
      data: {
        attackGrowth: weaponData.attackGrowth ?? {},
        skills: weaponData.skills ?? {},
      },
    },
    equipment: {
      pieces: buildEquipmentPiecesForSnapshot(config),
    },
  };
}

function skillModeToStage(mode: string): number {
  if (mode === 'M1') return SLOT_COUNT + 1;
  if (mode === 'M2') return SLOT_COUNT + 2;
  if (mode === 'M3') return SLOT_COUNT + MAX_MASTERY_LEVEL;
  if (/^L\d+$/i.test(mode)) {
    const numeric = Number.parseInt(mode.slice(1), 10);
    if (!Number.isNaN(numeric)) {
      return Math.max(0, Math.min(SLOT_COUNT, numeric - 1));
    }
  }
  return SLOT_COUNT + MAX_MASTERY_LEVEL;
}

function stageToSkillMode(stage: number): string {
  if (stage <= 0) return 'L1';
  if (stage <= SLOT_COUNT) return `L${stage + 1}`;
  return `M${stage - SLOT_COUNT}`;
}

function resolveHitValue(hit: { multiplier?: number; levels?: Record<string, number> }, levelKey: string): number | string {
  const leveledValue = hit.levels?.[levelKey];
  if (typeof leveledValue === 'number') {
    return leveledValue;
  }
  if (typeof hit.multiplier === 'number') {
    return hit.multiplier;
  }
  return '-';
}

function buildFallbackSkillDetails(
  skillKey: OperatorSkillKey,
  skill: Character['skills'][keyof Character['skills']] | undefined,
  levelKey: string
): SkillDetailGroup[] {
  if (!skill) {
    return [];
  }

  const multiplier = skill.multipliers[levelKey] ?? skill.multipliers.M3 ?? {};
  const hits = Object.entries(multiplier)
    .filter(([, value]) => typeof value === 'number')
    .map(([hitKey, value]) => ({
      key: hitKey,
      displayName: hitKey,
      value: value ?? '-',
      element: 'unknown',
      skillType: skillKey,
    }));

  return [{
    id: skillKey,
    displayName: skill.name || skillKey,
    buttonType: skillKey,
    hits,
  }];
}

function buildSkillDetailGroups(character: Partial<Character>, skillKey: OperatorSkillKey, levelKey: string): SkillDetailGroup[] {
  const sandboxSkills = character.sandboxSkills ?? [];
  const sandboxGroups = sandboxSkills
    .filter((skill) => skill.buttonType === skillKey)
    .map((skill) => ({
      id: skill.id,
      displayName: skill.displayName || skill.id,
      buttonType: skill.buttonType,
      iconUrl: skill.iconUrl,
      hits: (skill.customHits ?? []).map((hit) => {
        const hitWithLevels = hit as typeof hit & { levels?: Record<string, number> };
        return {
          key: hit.key,
          displayName: hit.displayName || hit.key,
          value: resolveHitValue(hitWithLevels, levelKey),
          element: hit.element,
          skillType: hit.skillType,
        };
      }),
    }));

  if (sandboxGroups.length > 0) {
    return sandboxGroups;
  }

  const fallbackByKey: Record<OperatorSkillKey, Character['skills'][keyof Character['skills']] | undefined> = {
    A: character.skills?.normalAttack,
    B: character.skills?.skill,
    E: character.skills?.chainSkill,
    Q: character.skills?.ultimate,
  };
  return buildFallbackSkillDetails(skillKey, fallbackByKey[skillKey], levelKey);
}

type SkillTrackRowProps = {
  skillKey: string;
  label: string;
  stage: number;
  onChange: (nextStage: number) => void;
  onOpenDetails: () => void;
};

function formatSkillStage(stage: number) {
  if (stage <= 0) {
    return 'L1';
  }

  if (stage <= SLOT_COUNT) {
    return `L${stage + 1}`;
  }

  return `M${stage - SLOT_COUNT}`;
}

function SkillTrackHex({ active }: { active: boolean }) {
  const fill = active ? '#FFF59D' : '#FFFFFF';
  const accent = active ? 'rgba(0, 0, 0, 0.18)' : 'rgba(0, 0, 0, 0.12)';

  return (
    <svg className="operator-config-page-track-hex-svg" viewBox="0 0 32 28" aria-hidden="true">
      <g filter="url(#operator-config-hex-shadow)">
        <polygon points="8,1 24,1 31,14 24,27 8,27 1,14" fill={fill} stroke="#666666" strokeWidth="1" />
      </g>
      <defs>
        <filter id="operator-config-hex-shadow" x="0" y="0" width="32" height="28" filterUnits="userSpaceOnUse">
          <feDropShadow dx="0" dy="1" stdDeviation="0.6" floodColor={accent} />
        </filter>
      </defs>
    </svg>
  );
}

const WEAPON_STAR_SEGMENTS = [
  { id: 4, transform: undefined },
  { id: 3, transform: 'rotate(72 40 30)' },
  { id: 2, transform: 'rotate(144 40 30)' },
  { id: 1, transform: 'rotate(216 40 30)' },
  { id: 5, transform: 'rotate(288 40 30)' },
] as const;

function getWeaponStarSegmentFill(segmentId: number, count: number) {
  if (count === 0) {
    return '#FFF59D';
  }

  if (count === 6) {
    return '#FFFFFF';
  }

  if (segmentId === count) {
    return '#FFF000';
  }

  if (segmentId < count) {
    return '#FFFFFF';
  }

  return '#C7C7C7';
}

function WeaponStarGlyph({
  className,
  count = 0,
  viewBox = '-40 -40 140 140',
}: {
  className?: string;
  count?: number;
  viewBox?: string;
}) {
  const points = '5,42 82,42 102,53 25,53';
  return (
    <svg className={className ?? 'operator-config-page-weapon-star-svg'} viewBox={viewBox} aria-hidden="true">
      {WEAPON_STAR_SEGMENTS.map((segment) => (
        <polygon
          key={segment.id}
          points={points}
          fill={getWeaponStarSegmentFill(segment.id, count)}
          transform={segment.transform}
        />
      ))}
    </svg>
  );
}

function SkillTrackRow({ skillKey, label, stage, onChange, onOpenDetails }: SkillTrackRowProps) {
  const currentStage = stage;
  const currentLevelLabel = formatSkillStage(currentStage);

  return (
    <div className="operator-config-page-track-row">
      <div className="operator-config-page-track-heading">
        <span className="operator-config-page-track-key">{skillKey}</span>
        <span className="operator-config-page-track-label">{label}</span>
        <span className="operator-config-page-track-sublabel">{currentLevelLabel}</span>
        <button
          type="button"
          className="operator-config-page-track-detail-button"
          onClick={onOpenDetails}
        >
          详情
        </button>
      </div>
      <div className="operator-config-page-track-body">
        <div className="operator-config-page-track-slots">
          {Array.from({ length: SLOT_COUNT }, (_, index) => (
            <button
              key={`${label}-slot-${index}`}
              type="button"
              className={`operator-config-page-track-slot${currentStage >= index + 1 ? ' is-active' : ''}`}
              aria-label={`${label} ${formatSkillStage(index + 1)}`}
              aria-pressed={currentStage >= index + 1}
              onClick={() => {
                onChange(currentStage >= index + 1 ? index : index + 1);
              }}
            />
          ))}
        </div>
        <div className="operator-config-page-track-badge-group" aria-label={`${skillKey} 尾标按钮组`}>
          <button
            type="button"
            className={`operator-config-page-track-badge-btn operator-config-page-track-badge-btn--left${currentStage >= SLOT_COUNT + 1 ? ' is-active' : ''}`}
            aria-label={`${skillKey} M1`}
            aria-pressed={currentStage >= SLOT_COUNT + 1}
            onClick={() => {
              onChange(SLOT_COUNT + 1);
            }}
          >
            <SkillTrackHex active={currentStage >= SLOT_COUNT + 1} />
          </button>
          <button
            type="button"
            className={`operator-config-page-track-badge-btn operator-config-page-track-badge-btn--top${currentStage >= SLOT_COUNT + 2 ? ' is-active' : ''}`}
            aria-label={`${skillKey} M2`}
            aria-pressed={currentStage >= SLOT_COUNT + 2}
            onClick={() => {
              onChange(SLOT_COUNT + 2);
            }}
          >
            <SkillTrackHex active={currentStage >= SLOT_COUNT + 2} />
          </button>
          <button
            type="button"
            className={`operator-config-page-track-badge-btn operator-config-page-track-badge-btn--bottom${currentStage >= SLOT_COUNT + MAX_MASTERY_LEVEL ? ' is-active' : ''}`}
            aria-label={`${skillKey} M3`}
            aria-pressed={currentStage >= SLOT_COUNT + MAX_MASTERY_LEVEL}
            onClick={() => {
              onChange(SLOT_COUNT + MAX_MASTERY_LEVEL);
            }}
          >
            <SkillTrackHex active={currentStage >= SLOT_COUNT + MAX_MASTERY_LEVEL} />
          </button>
        </div>
      </div>
    </div>
  );
}

function SkillDetailModal({
  skillKey,
  levelKey,
  groups,
  onClose,
}: {
  skillKey: OperatorSkillKey;
  levelKey: string;
  groups: SkillDetailGroup[];
  onClose: () => void;
}) {
  return (
    <div className="operator-config-page-skill-modal-backdrop" onClick={onClose}>
      <div
        className="operator-config-page-skill-modal"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="operator-config-page-skill-modal-header">
          <div>
            <h3 className="operator-config-page-skill-modal-title">{`${skillKey} 技能详情`}</h3>
            <span className="operator-config-page-skill-modal-subtitle">{`当前等级 ${levelKey}`}</span>
          </div>
          <button type="button" className="operator-config-page-picker-close" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="operator-config-page-skill-modal-body">
          {groups.length === 0 ? (
            <p className="operator-config-page-picker-message">当前角色没有该类型技能数据。</p>
          ) : (
            groups.map((group) => (
              <section key={group.id} className="operator-config-page-skill-card-group">
                <div className="operator-config-page-skill-card-header">
                  {group.iconUrl ? (
                    <img className="operator-config-page-skill-card-icon" src={group.iconUrl} alt={group.displayName} />
                  ) : (
                    <span className="operator-config-page-skill-card-icon-fallback">{group.buttonType}</span>
                  )}
                  <div className="operator-config-page-skill-card-meta">
                    <strong>{group.displayName}</strong>
                    <span>{`${group.buttonType} / ${group.hits.length} hit`}</span>
                  </div>
                </div>
                <div className="operator-config-page-skill-hit-grid">
                  {group.hits.length === 0 ? (
                    <p className="operator-config-page-skill-empty-hit">无 hit 数据</p>
                  ) : (
                    group.hits.map((hit) => (
                      <div key={`${group.id}-${hit.key}`} className="operator-config-page-skill-hit-card">
                        <span className="operator-config-page-skill-hit-key">{hit.key}</span>
                        <strong>{hit.displayName}</strong>
                        <span>{`${hit.value} | ${hit.element} | ${hit.skillType}`}</span>
                      </div>
                    ))
                  )}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function OperatorConfigPage() {
  const { state } = useAppContext();
  const selectedCharacterIds = React.useMemo(
    () => readSelectedCharacterIdsFromSession(),
    [state.loadedCharacters, state.selectedCharacters]
  );
  const localCharacters = React.useMemo(
    () => loadLocalOperatorCharacters(),
    [state.loadedCharacters, state.selectedCharacters]
  );
  const runtimeCharacters = React.useMemo(
    () => Object.values(getRuntimeOperatorTemplateMap()).map(adaptRuntimeTemplateToLegacyCharacter),
    [state.loadedCharacters, state.selectedCharacters]
  );
  const visibleCharacters = React.useMemo(() => {
    const localCharacterMap = new Map(localCharacters.map((character) => [character.id, character] as const));
    const runtimeCharacterMap = new Map(runtimeCharacters.map((character) => [character.id, character] as const));
    const officialCharacterMap = new Map(state.loadedCharacters.map((character) => [character.id, character] as const));

    return selectedCharacterIds
      .map((characterId) => (
        localCharacterMap.get(characterId)
        ?? runtimeCharacterMap.get(characterId)
        ?? officialCharacterMap.get(characterId)
        ?? null
      ))
      .filter((character): character is Character => Boolean(character));
  }, [localCharacters, runtimeCharacters, selectedCharacterIds, state.loadedCharacters]);
  React.useEffect(() => {
    const localCharacterMap = new Map(localCharacters.map((character) => [character.id, character] as const));
    const runtimeCharacterMap = new Map(runtimeCharacters.map((character) => [character.id, character] as const));
    const officialCharacterMap = new Map(state.loadedCharacters.map((character) => [character.id, character] as const));

    console.log('[OperatorConfigPage] selected character resolution', selectedCharacterIds.map((characterId) => ({
      id: characterId,
      source: localCharacterMap.has(characterId)
        ? 'local'
        : runtimeCharacterMap.has(characterId)
          ? 'runtime'
          : officialCharacterMap.has(characterId)
            ? 'official'
            : 'missing',
      resolvedName: localCharacterMap.get(characterId)?.name
        ?? runtimeCharacterMap.get(characterId)?.name
        ?? officialCharacterMap.get(characterId)?.name
        ?? null,
    })));
  }, [localCharacters, runtimeCharacters, selectedCharacterIds, state.loadedCharacters]);
  const [configMap, setConfigMap] = React.useState<OperatorConfigPageDraftMap>(() => buildDraftMapFromSnapshotCache(getOperatorConfigPageCache(), visibleCharacters));
  const [activeCharacterId, setActiveCharacterId] = React.useState<string | null>(() => {
    const cachedActiveCharacterId = safeSessionStorage.getItem(STORAGE_KEYS.OPERATOR_CONFIG_ACTIVE_CHARACTER);
    return visibleCharacters.some((character) => character.id === cachedActiveCharacterId)
      ? cachedActiveCharacterId
      : visibleCharacters[0]?.id ?? null;
  });
  const [equipmentLibrary, setEquipmentLibrary] = React.useState<EquipmentLibrary | null>(null);
  const [equipmentLibraryError, setEquipmentLibraryError] = React.useState<string | null>(null);
  const [equipmentPickerSlot, setEquipmentPickerSlot] = React.useState<EquipmentSlotKey | null>(null);
  const [weaponLibrary, setWeaponLibrary] = React.useState<Record<string, WeaponData & { id: string; imgUrl: string }>>({});
  const [weaponLibraryError, setWeaponLibraryError] = React.useState<string | null>(null);
  const [isWeaponPickerOpen, setIsWeaponPickerOpen] = React.useState(false);
  const [ctiInputValue, setCtiInputValue] = React.useState('');
  const [isCtiDrawerOpen, setIsCtiDrawerOpen] = React.useState(false);
  const [equipmentTooltip, setEquipmentTooltip] = React.useState<{ text: string; x: number; y: number } | null>(null);
  const [activeSkillDetailKey, setActiveSkillDetailKey] = React.useState<OperatorSkillKey | null>(null);
  const [isPanelDetailOpen, setIsPanelDetailOpen] = React.useState(false);
  const ctiSelectorRef = React.useRef<HTMLDivElement | null>(null);
  const weaponConfigIndices = React.useMemo(() => Array.from({ length: 9 }, (_, index) => index + 1), []);
  const equipConfigIndices = React.useMemo(() => Array.from({ length: 3 }, (_, index) => index + 1), []);
  const levelIndices = React.useMemo(() => Array.from({ length: 8 }, (_, index) => index + 1), []);

  const persistConfigMap = React.useCallback((nextConfigMap: OperatorConfigPageDraftMap) => {
    setConfigMap(nextConfigMap);
  }, []);

  const getCharacterById = React.useCallback(
    (characterId: string) => visibleCharacters.find((character) => character.id === characterId) ?? null,
    [visibleCharacters]
  );

  const ensureCharacterConfig = React.useCallback(
    (characterId: string, sourceCharacter?: Character | null) => {
      const character = sourceCharacter ?? getCharacterById(characterId);
      if (!character) return;

      setConfigMap((prev) => {
        const existing = prev[characterId];
        const cachedSnapshot = getOperatorConfigPageCache()[characterId];
        const nextCharacterData = createCharacterData(character);
        const nextCharacterConfig = existing
          ? {
            ...existing,
            character: {
              ...existing.character,
              id: character.id,
              data: nextCharacterData,
            },
            skills: {
              ...existing.skills,
              id: character.id,
              data: nextCharacterData.skills as Record<string, unknown>,
            },
          }
          : cachedSnapshot
            ? createCharacterConfigFromSnapshot(cachedSnapshot, character)
          : createDefaultCharacterConfig(character);
        const next = { ...prev, [characterId]: nextCharacterConfig };
        return next;
      });
    },
    [getCharacterById]
  );

  React.useEffect(() => {
    if (visibleCharacters.length === 0) {
      setActiveCharacterId(null);
      return;
    }

    setActiveCharacterId((prev) => {
      if (prev && visibleCharacters.some((character) => character.id === prev)) {
        return prev;
      }
      const cachedActiveCharacterId = safeSessionStorage.getItem(STORAGE_KEYS.OPERATOR_CONFIG_ACTIVE_CHARACTER);
      return visibleCharacters.some((character) => character.id === cachedActiveCharacterId)
        ? cachedActiveCharacterId
        : visibleCharacters[0]?.id ?? null;
    });
  }, [visibleCharacters]);

  React.useEffect(() => {
    if (!activeCharacterId) return;
    safeSessionStorage.setItem(STORAGE_KEYS.OPERATOR_CONFIG_ACTIVE_CHARACTER, activeCharacterId);
    ensureCharacterConfig(activeCharacterId);
  }, [activeCharacterId, ensureCharacterConfig]);

  React.useEffect(() => {
    const loadLibraries = () => {
      try {
        setWeaponLibraryError(null);
        setEquipmentLibraryError(null);
        const nextWeaponLibrary = normalizeWeaponLibrary(readLocalStorageJson(WEAPON_LIBRARY_STORAGE_KEY, {}));
        const nextEquipmentLibrary = normalizeEquipmentLibrary(readLocalStorageJson(EQUIPMENT_LIBRARY_STORAGE_KEY, { gearSets: {} }));
        setWeaponLibrary(nextWeaponLibrary);
        setEquipmentLibrary(nextEquipmentLibrary);
      } catch (error) {
        setWeaponLibrary({});
        setEquipmentLibrary({ gearSets: {} });
        const message = error instanceof Error ? error.message : '读取失败';
        setWeaponLibraryError(message);
        setEquipmentLibraryError(message);
      }
    };

    loadLibraries();
  }, []);

  React.useEffect(() => {
    if (Object.keys(weaponLibrary).length === 0 && !equipmentLibrary) return;
    setConfigMap((prev) => {
      let changed = false;
      const next = Object.fromEntries(
        Object.entries(prev).map(([characterId, config]) => {
          const hydrated = hydrateDraftConfigFromLibraries(config, weaponLibrary, equipmentLibrary);
          if (hydrated !== config) changed = true;
          return [characterId, hydrated];
        })
      );
      return changed ? next : prev;
    });
  }, [equipmentLibrary, weaponLibrary]);

  const currentConfig = activeCharacterId ? configMap[activeCharacterId] ?? null : null;
  const activeCharacter = activeCharacterId ? getCharacterById(activeCharacterId) : null;
  const characterLevelCount = levelValueToCount(currentConfig?.character.config.level ?? 90);
  const characterPotentialCount = parsePotentialToCount(currentConfig?.character.config.potential ?? '0潜');
  const weaponPotentialCount = parsePotentialToCount(currentConfig?.weapon.config.potential ?? '0潜');
  const weaponSkillLevel1 = currentConfig?.weapon.config.skillLevels.skill1 ?? DEFAULT_WEAPON_SKILL_LEVELS.skill1;
  const weaponSkillLevel2 = currentConfig?.weapon.config.skillLevels.skill2 ?? DEFAULT_WEAPON_SKILL_LEVELS.skill2;
  const weaponSkillLevel3 = currentConfig?.weapon.config.skillLevels.skill3 ?? DEFAULT_WEAPON_SKILL_LEVELS.skill3;
  const currentCharacterData = (currentConfig?.character.data ?? EMPTY_RECORD) as Partial<Character>;
  const currentWeaponData = (currentConfig?.weapon.data ?? EMPTY_RECORD) as Partial<WeaponData>;
  const attributeKey = levelValueToAttributeKey(currentConfig?.character.config.level ?? 90);
  const currentAttributes = currentCharacterData.attributes?.[attributeKey] ?? currentCharacterData.attributes?.level90;
  const skillData = (currentConfig?.skills.data ?? EMPTY_RECORD) as Partial<Record<OperatorSkillKey, { name?: string; type?: string }>>;
  const activeSkillDetailLevel = activeSkillDetailKey
    ? currentConfig?.skills.config[activeSkillDetailKey] ?? DEFAULT_SKILL_MODE
    : DEFAULT_SKILL_MODE;
  const activeSkillDetailGroups = activeSkillDetailKey
    ? buildSkillDetailGroups(activeCharacter ?? currentCharacterData, activeSkillDetailKey, activeSkillDetailLevel)
    : [];
  const currentWeaponName = currentConfig?.weapon.id ?? '';
  const currentWeaponLevel = Number(currentConfig?.weapon.config.level ?? 90);
  const currentWeaponImageUrl = resolveStoredImageUrl(currentWeaponData.imgUrl) || resolveWeaponImageUrl(currentWeaponName);
  const currentWeaponAttack = currentWeaponData.attackGrowth?.[String(currentWeaponLevel)] ?? currentWeaponData.attackGrowth?.['90'] ?? null;
  const currentWeaponSkill1Data = currentWeaponData.skills?.skill1;
  const currentWeaponSkill2Data = currentWeaponData.skills?.skill2;
  const currentWeaponSkill3Data = currentWeaponData.skills?.skill3;
  const currentWeaponRarityType = formatWeaponRarityType(currentWeaponData);
  const currentWeaponSkill1Text = formatWeaponSkillSummary('skill1', currentWeaponSkill1Data, weaponSkillLevel1);
  const currentWeaponSkill2Text = formatWeaponSkillSummary('skill2', currentWeaponSkill2Data, weaponSkillLevel2);
  const currentWeaponSkill3Lines = buildWeaponSkill3Lines(currentWeaponSkill3Data, weaponSkillLevel3);
  const currentWeaponMetaLine = formatWeaponMetaLine(currentWeaponLevel, currentWeaponAttack);
  const configSnapshot = React.useMemo<ConfigSnapshot | null>(() => {
    const sourceSnapshot: ConfigSnapshot | undefined = currentConfig?.sourceSnapshot;
    if (sourceSnapshot && isReusableConfigSnapshot(sourceSnapshot)) return sourceSnapshot;
    const currentWeaponData = (currentConfig?.weapon.data ?? EMPTY_RECORD) as Partial<WeaponData>;
    if (sourceSnapshot?.weapon.name && !currentWeaponData.skills) {
      return null;
    }
    const input = buildOperatorPanelInput(currentConfig, activeCharacter);
    return input ? buildConfigSnapshot(input) : null;
  }, [activeCharacter, currentConfig]);

  React.useEffect(() => {
    if (!activeCharacterId || !configSnapshot) return;
    const snapshotCache = getOperatorConfigPageCache();
    if (isSameConfigSnapshot(snapshotCache[activeCharacterId], configSnapshot)) return;
    setOperatorConfigPageCache({
      ...snapshotCache,
      [activeCharacterId]: configSnapshot,
    });
  }, [activeCharacterId, configSnapshot]);

  const attributeItems = React.useMemo<ReadonlyArray<AttributeItem>>(() => {
    const calc = configSnapshot?.panel.calc;
    const display = configSnapshot?.panel.display;
    return [
      { label: '名称', value: configSnapshot?.operator.name || currentCharacterData.name || activeCharacter?.name || '角色占位' },
      { label: '属性', value: configSnapshot?.operator.element || currentCharacterData.element || activeCharacter?.element || '属性占位' },
      { label: '等级', value: String(configSnapshot?.operator.level ?? currentConfig?.character.config.level ?? 90) },
      { label: '攻击力', value: String(display?.atk ?? currentAttributes?.atk ?? '0000') },
      { label: '力量', value: String(calc?.strength ?? currentAttributes?.strength ?? '000'), tone: 'main' },
      { label: '敏捷', value: String(calc?.agility ?? currentAttributes?.agility ?? '000') },
      { label: '智识', value: String(calc?.intelligence ?? currentAttributes?.intelligence ?? '000'), tone: 'sub' },
      { label: '意志', value: String(calc?.will ?? currentAttributes?.will ?? '000') },
    ];
  }, [activeCharacter?.element, activeCharacter?.name, configSnapshot, currentAttributes, currentCharacterData.element, currentCharacterData.name, currentConfig?.character.config.level]);

  const updateCurrentConfig = React.useCallback((updater: (current: OperatorConfigPageCharacterConfig) => OperatorConfigPageCharacterConfig) => {
    if (!activeCharacterId) return;
    const sourceCharacter = getCharacterById(activeCharacterId);
    if (!sourceCharacter && !configMap[activeCharacterId]) return;

    const baseConfig = configMap[activeCharacterId] ?? (sourceCharacter ? createDefaultCharacterConfig(sourceCharacter) : null);
    if (!baseConfig) return;

    const nextConfig = updater(baseConfig);
    const { sourceSnapshot: _sourceSnapshot, ...nextConfigWithoutSourceSnapshot } = nextConfig;
    persistConfigMap({
      ...configMap,
      [activeCharacterId]: nextConfigWithoutSourceSnapshot,
    });
  }, [activeCharacterId, configMap, getCharacterById, persistConfigMap]);

  const getNextWeaponConfigCount = React.useCallback((currentCount: number, buttonNumber: number) => {
    if (buttonNumber <= currentCount) {
      return buttonNumber;
    }

    return buttonNumber;
  }, []);

  const getWeaponConfigButtonState = React.useCallback((buttonNumber: number, count: number) => {
    if (buttonNumber === count) {
      return 'is-current';
    }

    if (buttonNumber < count) {
      return 'is-lit';
    }

    return 'is-dim';
  }, []);

  const getEquipmentConfigButtonState = React.useCallback((buttonNumber: number, count: number) => {
    if (count === 0) {
      return 'is-dim';
    }

    if (buttonNumber === count) {
      return 'is-current';
    }

    if (buttonNumber < count) {
      return 'is-lit';
    }

    return 'is-dim';
  }, []);

  const getEquipmentEntryLevel = React.useCallback(
    (slotKey: EquipmentSlotKey, entryIndex: EquipmentEntryIndex) => currentConfig?.equipment[slotKey].entries[entryIndex]?.config.level ?? 0,
    [currentConfig]
  );
  const isEquipmentEntryActive = React.useCallback(
    (slotKey: EquipmentSlotKey, entryIndex: EquipmentEntryIndex) => {
      const entryCount = currentConfig?.equipment[slotKey].entryCount ?? 0;
      return entryIndex < entryCount;
    },
    [currentConfig]
  );
  const equipmentOptionsByPart = React.useMemo<Record<EquipmentPart, EquipmentItem[]>>(() => {
    const grouped: Record<EquipmentPart, EquipmentItem[]> = {
      护甲: [],
      护手: [],
      配件: [],
    };
    if (!equipmentLibrary) return grouped;

    Object.values(equipmentLibrary.gearSets).forEach((gearSet) => {
      Object.values(gearSet.equipments).forEach((equipment) => {
        grouped[equipment.part].push(equipment);
      });
    });

    Object.values(grouped).forEach((items) => {
      items.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
    });

    return grouped;
  }, [equipmentLibrary]);
  const equipmentPickerMeta = equipmentPickerSlot
    ? EQUIPMENT_SLOT_METAS.find((item) => item.slotKey === equipmentPickerSlot) ?? null
    : null;
  const equipmentPickerOptions = React.useMemo(() => {
    if (!equipmentPickerMeta) return [];
    const keyword = ctiInputValue.trim().toLowerCase();
    const base = equipmentOptionsByPart[equipmentPickerMeta.part] ?? [];
    if (!keyword) return base;
    return base.filter((item) => {
      const searchText = `${item.name} ${item.equipmentId} ${item.part}`.toLowerCase();
      return searchText.includes(keyword);
    });
  }, [ctiInputValue, equipmentOptionsByPart, equipmentPickerMeta]);
  const weaponOptions = React.useMemo(() => Object.keys(weaponLibrary).sort((left, right) => left.localeCompare(right, 'zh-CN')), [weaponLibrary]);
  const weaponPickerOptions = React.useMemo(() => {
    const keyword = ctiInputValue.trim().toLowerCase();
    if (!keyword) return weaponOptions;
    return weaponOptions.filter((weaponName) => weaponName.toLowerCase().includes(keyword));
  }, [ctiInputValue, weaponOptions]);

  const updateEquipmentEntryLevel = React.useCallback((slotKey: EquipmentSlotKey, entryIndex: EquipmentEntryIndex, nextLevel: number) => {
    updateCurrentConfig((prev) => {
      const piece = prev.equipment[slotKey];
      if (entryIndex >= piece.entryCount) {
        return prev;
      }
      const nextEntries = piece.entries.map((entry, index) =>
        index === entryIndex
          ? {
            ...entry,
            config: {
              ...entry.config,
              level: nextLevel,
            },
          }
          : entry
      );

      return {
        ...prev,
        equipment: {
          ...prev.equipment,
          [slotKey]: {
            ...piece,
            entries: nextEntries,
          },
        },
      };
    });
  }, [updateCurrentConfig]);

  const handleSelectEquipment = React.useCallback((slotKey: EquipmentSlotKey, item: EquipmentItem) => {
    updateCurrentConfig((prev) => ({
      ...prev,
      equipment: {
        ...prev.equipment,
        [slotKey]: createEquipmentPieceFromItem(item),
      },
    }));
    setEquipmentPickerSlot(null);
  }, [updateCurrentConfig]);

  const handleClearEquipment = React.useCallback((slotKey: EquipmentSlotKey) => {
    updateCurrentConfig((prev) => ({
      ...prev,
      equipment: {
        ...prev.equipment,
        [slotKey]: createEquipmentPiece(),
      },
    }));
    setEquipmentPickerSlot(null);
  }, [updateCurrentConfig]);

  const handleSelectWeapon = React.useCallback((weaponName: string) => {
    const payload = weaponLibrary[weaponName];
    if (!payload) {
      setWeaponLibraryError(`未在 localStorage 中找到武器：${weaponName}`);
      return;
    }
    updateCurrentConfig((prev) => ({
      ...prev,
      weapon: {
        ...prev.weapon,
        id: weaponName,
        data: payload as unknown as Record<string, unknown>,
      },
    }));
    setIsWeaponPickerOpen(false);
  }, [updateCurrentConfig, weaponLibrary]);

  const handleClearWeapon = React.useCallback(() => {
    updateCurrentConfig((prev) => ({
      ...prev,
      weapon: createEmptyWeaponState(),
    }));
    setIsWeaponPickerOpen(false);
  }, [updateCurrentConfig]);

  React.useEffect(() => {
    if (!isCtiDrawerOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (ctiSelectorRef.current && !ctiSelectorRef.current.contains(target)) {
        setIsCtiDrawerOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isCtiDrawerOpen]);

  React.useEffect(() => {
    if (!equipmentTooltip) {
      return;
    }

    const handlePointerDown = () => {
      setEquipmentTooltip(null);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [equipmentTooltip]);

  return (
    <div className="operator-config-page-root">
      <div className="operator-config-page-shell">
        <div className="config-panel operator-config-page-panel">
          <div className="config-panel-header">
            <button className="config-panel-back-btn" type="button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.home)}>
              返回
            </button>
          </div>
          <div className="config-panel-content" data-character-id="operator-config-page-static">
            <div className="config-main-area">
              <div className="config-top-grid">
                <section className="config-data-section config-equip-panel config-scrollable-module operator-config-page-equip-zone">
                  <h4 className="config-data-title">装备</h4>
                  <div className="operator-config-page-equip-visual">
                    <div className="operator-config-page-equip-visual-top" aria-hidden="true">
                      <div className="operator-config-page-equip-circles">
                        {EQUIPMENT_SLOT_METAS.map((slotMeta) => {
                          const equipmentPiece = currentConfig?.equipment[slotMeta.slotKey];
                          const equipmentData = equipmentPiece?.data as Partial<EquipmentItem> | undefined;
                          const imageUrl = resolveStoredImageUrl(equipmentData?.imgUrl);
                          return (
                            <button
                              key={slotMeta.slotKey}
                              type="button"
                              className={`operator-config-page-equip-circle ${slotMeta.circleClass}`}
                              aria-label={`选择${slotMeta.part}`}
                              onClick={() => {
                                setEquipmentPickerSlot(slotMeta.slotKey);
                              }}
                            >
                              {imageUrl ? (
                                <img
                                  className="operator-config-page-equip-circle-image"
                                  src={imageUrl}
                                  alt={equipmentData?.name ?? slotMeta.part}
                                />
                              ) : (
                                <span className="operator-config-page-equip-circle-fallback">{equipmentData?.name ?? slotMeta.part}</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      <div className="operator-config-page-equip-button-groups">
                        {EQUIPMENT_SLOT_METAS.map((slotMeta) => (
                          <div key={slotMeta.slotKey} className={`operator-config-page-equip-button-group ${slotMeta.groupClass}`}>
                            {([0, 1, 2] as const).map((entryIndex) => {
                              const currentLevel = getEquipmentEntryLevel(slotMeta.slotKey, entryIndex);
                              const isEntryActive = isEquipmentEntryActive(slotMeta.slotKey, entryIndex);
                              const entry = currentConfig?.equipment[slotMeta.slotKey].entries[entryIndex];
                              const entryDisplay = isEntryActive
                                ? getEquipmentEntryDisplayParts(entry, currentLevel)
                                : { head: '无', tail: '', full: '无' };
                              return (
                                <React.Fragment key={`${slotMeta.slotKey}-${entryIndex}`}>
                                  <div className={`operator-config-page-equip-button-textdiv${isEntryActive ? '' : ' is-disabled'}`}>
                                    <span
                                      className="operator-config-page-equip-button-text"
                                      onMouseEnter={(event) => {
                                        const rect = event.currentTarget.getBoundingClientRect();
                                        setEquipmentTooltip({
                                          text: entryDisplay.full,
                                          x: rect.left - 4,
                                          y: rect.bottom - 44,
                                        });
                                      }}
                                      onMouseMove={(event) => {
                                        const rect = event.currentTarget.getBoundingClientRect();
                                        setEquipmentTooltip({
                                          text: entryDisplay.full,
                                          x: rect.left - 4,
                                          y: rect.bottom - 44,
                                        });
                                      }}
                                      onMouseLeave={() => {
                                        setEquipmentTooltip(null);
                                      }}
                                    >
                                      <span className="operator-config-page-equip-button-text-head">{entryDisplay.head}</span>
                                      {entryDisplay.tail ? <span className="operator-config-page-equip-button-text-tail">{entryDisplay.tail}</span> : null}
                                    </span>
                                  </div>
                                  <div className={`operator-config-page-equip-button-row ${slotMeta.rowClass}${isEntryActive ? '' : ' is-disabled'}`}>
                                    {equipConfigIndices.map((buttonNumber) => (
                                      <button
                                        key={`${slotMeta.slotKey}-${entryIndex}-${buttonNumber}`}
                                        type="button"
                                        className={`operator-config-page-equip-button ${getEquipmentConfigButtonState(buttonNumber, Number(currentLevel))}`}
                                        aria-label={`${slotMeta.slotKey} 词条 ${entryIndex + 1} 档位 L${buttonNumber}`}
                                        aria-pressed={buttonNumber === Number(currentLevel)}
                                        disabled={!isEntryActive}
                                        onClick={() => {
                                          updateEquipmentEntryLevel(
                                            slotMeta.slotKey,
                                            entryIndex,
                                            Number(currentLevel) === buttonNumber ? buttonNumber - 1 : buttonNumber
                                          );
                                        }}
                                      />
                                    ))}
                                  </div>
                                </React.Fragment>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="operator-config-page-equip-visual-bottom" aria-hidden="true" />
                  </div>
                  <div className="operator-config-page-equip-archive" aria-hidden="true" data-archived-row-count={EQUIPMENT_FORM_ROWS.length}>
                    {/* 旧装备数值表单存档：后续可能恢复
                    <div className="config-equip-values-box operator-config-page-equip-values-box">
                      <p className="config-equip-box-title operator-config-page-equip-box-title">装备配置</p>
                      <div className="config-equip-values-grid">
                        {EQUIPMENT_FORM_ROWS.map((row, rowIndex) => (
                          <div key={`equip-row-${rowIndex}`} className={`config-equip-row ${row.columns}`}>
                            {row.fields.map((field) => (
                              <label key={field.label} className="config-equip-item">
                                <span className="config-equip-item-label">{field.label}</span>
                                <span className="config-equip-item-input-wrap">
                                  <span className="config-equip-item-prefix">+</span>
                                  <input type="text" className="config-equip-item-input" value="0" readOnly />
                                  {field.suffix ? <span className="config-equip-item-suffix">{field.suffix}</span> : null}
                                </span>
                              </label>
                            ))}
                          </div>
                        ))}
                      </div>
                      <div className="config-equip-copy-drawer-host">
                        <button type="button" className="config-equip-sync-btn" title="同步按钮占位">
                          同步
                        </button>
                        <button type="button" className="config-equip-copy-btn" title="复制按钮占位">
                          复制
                        </button>
                        <div className="config-equip-copy-drawer" aria-hidden="true">
                          <textarea
                            className="config-equip-copy-textarea"
                            value="装备文本输入占位"
                            readOnly
                          />
                        </div>
                      </div>
                    </div>
                    */}
                    {/* 旧三件套效果区存档：后续可能恢复
                    <div className="config-equip-set-box">
                      <p className="config-equip-box-title">三件套效果</p>
                      <div className="config-equip-set-sub-box">
                        <p className="config-equip-set-title">1、非条件触发部分</p>
                      </div>
                      <div className="config-equip-set-sub-box">
                        <p className="config-equip-set-title">2、条件触发部分</p>
                      </div>
                    </div>
                    */}
                  </div>
                </section>
                <div className="operator-config-page-operator-panel operator-config-page-operator-zone">
                  <section className="operator-config-page-section operator-config-page-stats-section operator-config-page-scrollable">
                    <button
                      type="button"
                      className="operator-config-page-section-title operator-config-page-panel-title-button"
                      onClick={() => setIsPanelDetailOpen(true)}
                    >
                      面板数据
                    </button>
                    <div className="operator-config-page-stats-grid">
                      {attributeItems.map((item) => (
                        <div
                          key={item.label}
                          className={`operator-config-page-stat-item${item.tone === 'main' ? ' is-main' : ''}${item.tone === 'sub' ? ' is-sub' : ''}`}
                        >
                          <span className="operator-config-page-stat-label">{item.label}</span>
                          <span className="operator-config-page-stat-value">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="operator-config-page-section operator-config-page-skills-section operator-config-page-scrollable">
                    <h4 className="operator-config-page-section-title">技能</h4>
                    <div className="operator-config-page-track-list">
                      {SKILL_ITEMS.map((skill) => (
                        <SkillTrackRow
                          key={skill.key}
                          skillKey={skill.key}
                          label={skillData[skill.key]?.name ?? skill.name}
                          stage={skillModeToStage(currentConfig?.skills.config[skill.key as SkillType] ?? DEFAULT_SKILL_MODE)}
                          onOpenDetails={() => setActiveSkillDetailKey(skill.key)}
                          onChange={(nextStage) => {
                            updateCurrentConfig((prev) => ({
                              ...prev,
                              skills: {
                                ...prev.skills,
                                config: {
                                  ...prev.skills.config,
                                  [skill.key]: stageToSkillMode(nextStage),
                                },
                              },
                            }));
                          }}
                        />
                      ))}
                    </div>
                  </section>
                  <section className="operator-config-page-section operator-config-page-role-section">
                    <h4 className="operator-config-page-section-title">角色</h4>
                    <div className="operator-config-page-role-content">
                      <div className="operator-config-page-role-layout">
                        <div className="operator-config-page-level-body">
                          <div className="operator-config-page-level-track" aria-label="角色等级滑条">
                            {levelIndices.map((levelNumber) => {
                              const isDisabledLevel = DISABLED_CHARACTER_LEVEL_COUNTS.has(levelNumber);
                              return (
                                <button
                                  key={levelNumber}
                                  type="button"
                                  className={`operator-config-page-level-slot${levelNumber <= characterLevelCount ? ' is-active' : ''}${isDisabledLevel ? ' is-disabled' : ''}`}
                                  aria-label={`等级按钮 ${levelNumber}`}
                                  aria-pressed={levelNumber <= characterLevelCount}
                                  aria-disabled={isDisabledLevel}
                                  onClick={() => {
                                    if (isDisabledLevel) return;
                                    const nextCount = characterLevelCount >= levelNumber ? levelNumber - 1 : levelNumber;
                                    updateCurrentConfig((prev) => ({
                                      ...prev,
                                      character: {
                                        ...prev.character,
                                        config: {
                                          ...prev.character.config,
                                          level: levelCountToValue(nextCount),
                                        },
                                      },
                                    }));
                                  }}
                                />
                              );
                            })}
                          </div>
                          <label className="operator-config-page-favor-input-layer">
                            <span className="operator-config-page-favor-label">好感</span>
                            <input
                              className="operator-config-page-favor-input"
                              type="number"
                              value={getOperatorFavorValue(currentConfig)}
                              onChange={(event) => {
                                const nextValue = Number(event.target.value);
                                updateCurrentConfig((prev) => ({
                                  ...prev,
                                  character: {
                                    ...prev.character,
                                    config: {
                                      ...prev.character.config,
                                      favorValue: Number.isFinite(nextValue) ? nextValue : 60,
                                    },
                                  },
                                }));
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            className={`operator-config-page-level-badge-box${characterPotentialCount > 0 ? ' is-active' : ''}${characterPotentialCount === 6 ? ' is-max' : ''}`}
                            aria-label={`角色五角星计数器，当前 ${characterPotentialCount}`}
                            aria-pressed={characterPotentialCount > 0}
                            onClick={(event) => {
                              updateCurrentConfig((prev) => ({
                                ...prev,
                                character: {
                                  ...prev.character,
                                  config: {
                                    ...prev.character.config,
                                    potential: countToPotential(characterPotentialCount >= 6 ? 1 : characterPotentialCount + 1),
                                  },
                                },
                              }));
                              event.currentTarget.blur();
                            }}
                          >
                            <WeaponStarGlyph
                              className="operator-config-page-level-badge-svg"
                              count={characterPotentialCount}
                              viewBox="-24 -26 126 122"
                            />
                          </button>
                        </div>
                        <div className="operator-config-page-role-meta">
                          <div className="operator-config-page-role-meta-box operator-config-page-role-level-box">
                            {CHARACTER_LEVEL_LABELS[characterLevelCount] ?? CHARACTER_LEVEL_LABELS[CHARACTER_LEVEL_LABELS.length - 1]}
                          </div>
                          <div className="operator-config-page-role-meta-box operator-config-page-role-potential-box">
                            {Math.max(0, characterPotentialCount - 1)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
                <section
                  className="config-data-section config-info-panel config-scrollable-module config-placeholder-panel config-drawer-host operator-config-page-weapon-zone"
                  data-selected-weapon={currentWeaponName || '未选择武器'}
                >
                  <h4 className="config-data-title">武器</h4>
                  <div className="config-weapon-selector">
                    <div className="config-weapon-choose-showcase">
                      <button
                        type="button"
                        className="config-weapon-choose-content-area config-weapon-choose-content-button"
                        onClick={() => {
                          setWeaponLibraryError(null);
                          setIsWeaponPickerOpen(true);
                        }}
                      >
                        <span className="config-weapon-choose-name">{currentWeaponName || '未选择武器'}</span>

                      </button>
                      <div className="config-weapon-choose-img-area">
                        <div className="config-weapon-choose-detail-textarea">
                          <span className="config-weapon-choose-meta-line">{currentWeaponRarityType || '武器信息未接入'}</span>
                          <span className="config-weapon-choose-meta-line">{currentWeaponMetaLine}</span>
                        </div>
                        <button
                          type="button"
                          className="config-weapon-choose-img-square config-weapon-choose-img-button"
                          aria-label="选择武器"
                          onClick={() => {
                            setWeaponLibraryError(null);
                            setIsWeaponPickerOpen(true);
                          }}
                        >
                          {currentWeaponImageUrl ? (
                            <img
                              className="config-weapon-choose-img"
                              src={currentWeaponImageUrl}
                              alt={currentWeaponName || '武器图'}
                            />
                          ) : (
                            <span className="config-weapon-choose-img-fallback">{currentWeaponName || '武器'}</span>
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="operator-config-page-weapon-star-showcase">
                      <button
                        type="button"
                        className={`operator-config-page-weapon-star-square-box${weaponPotentialCount === 0 ? ' is-zero' : ''}${weaponPotentialCount > 0 ? ' is-active' : ''}${weaponPotentialCount === 6 ? ' is-max' : ''}`}
                        aria-label={`武器星形计数器，当前 ${weaponPotentialCount}`}
                        aria-pressed={weaponPotentialCount > 0}
                        onClick={(event) => {
                          updateCurrentConfig((prev) => ({
                            ...prev,
                            weapon: {
                              ...prev.weapon,
                              config: {
                                ...prev.weapon.config,
                                potential: countToPotential(weaponPotentialCount >= 6 ? 1 : weaponPotentialCount + 1),
                              },
                            },
                          }));
                          event.currentTarget.blur();
                        }}
                      >
                        <WeaponStarGlyph
                          className="operator-config-page-weapon-star-svg operator-config-page-weapon-star-svg--full"
                          count={weaponPotentialCount}
                          viewBox="-24 -26 126 122"
                        />
                      </button>
                    </div>
                    {/*config-weapon-config 相对位置就应该在这里，不允许改 */}
                    <div className="config-weapon-config">
                      <div className="config-weapon-config-container">
                        <div className="config-weapon-config-button-row" aria-label="武器配置按钮组 1">
                          {weaponConfigIndices.map((buttonNumber) => (
                            <button
                              key={buttonNumber}
                              type="button"
                              className={`config-weapon-config-button ${getWeaponConfigButtonState(buttonNumber, weaponSkillLevel1)}`}
                              aria-label={`武器配置按钮 1-${buttonNumber}`}
                              aria-pressed={buttonNumber <= weaponSkillLevel1}
                              onClick={() => {
                                updateCurrentConfig((prev) => ({
                                  ...prev,
                                  weapon: {
                                    ...prev.weapon,
                                    config: {
                                      ...prev.weapon.config,
                                      skillLevels: {
                                        ...prev.weapon.config.skillLevels,
                                        skill1: getNextWeaponConfigCount(weaponSkillLevel1, buttonNumber),
                                      },
                                    },
                                  },
                                }));
                              }}
                            />
                          ))}
                        </div>
                          <div className="config-weapon-config-text">
                            <span className="config-weapon-config-value">{weaponSkillLevel1}</span>
                            <span className="config-weapon-config-summary">
                              <span className="config-weapon-config-summary-label">{currentWeaponSkill1Text.label}</span>
                              {currentWeaponSkill1Text.typeKey ? <span className="config-weapon-config-summary-dot">·</span> : null}
                              {currentWeaponSkill1Text.typeKey ? <span className="config-weapon-config-summary-type">{currentWeaponSkill1Text.typeKey}</span> : null}
                              {currentWeaponSkill1Text.tail ? <span className="config-weapon-config-summary-tail">{currentWeaponSkill1Text.tail}</span> : null}
                            </span>
                          </div>
                      </div>
                      <div className="config-weapon-config-container">
                        <div className="config-weapon-config-button-row" aria-label="武器配置按钮组 2">
                          {weaponConfigIndices.map((buttonNumber) => (
                            <button
                              key={buttonNumber}
                              type="button"
                              className={`config-weapon-config-button ${getWeaponConfigButtonState(buttonNumber, weaponSkillLevel2)}`}
                              aria-label={`武器配置按钮 2-${buttonNumber}`}
                              aria-pressed={buttonNumber <= weaponSkillLevel2}
                              onClick={() => {
                                updateCurrentConfig((prev) => ({
                                  ...prev,
                                  weapon: {
                                    ...prev.weapon,
                                    config: {
                                      ...prev.weapon.config,
                                      skillLevels: {
                                        ...prev.weapon.config.skillLevels,
                                        skill2: getNextWeaponConfigCount(weaponSkillLevel2, buttonNumber),
                                      },
                                    },
                                  },
                                }));
                              }}
                            />
                          ))}
                        </div>
                          <div className="config-weapon-config-text">
                            <span className="config-weapon-config-value">{weaponSkillLevel2}</span>
                            <span className="config-weapon-config-summary">
                              <span className="config-weapon-config-summary-label">{currentWeaponSkill2Text.label}</span>
                              {currentWeaponSkill2Text.typeKey ? <span className="config-weapon-config-summary-dot">·</span> : null}
                              {currentWeaponSkill2Text.typeKey ? <span className="config-weapon-config-summary-type">{currentWeaponSkill2Text.typeKey}</span> : null}
                              {currentWeaponSkill2Text.tail ? <span className="config-weapon-config-summary-tail">{currentWeaponSkill2Text.tail}</span> : null}
                            </span>
                          </div>
                      </div>
                      <div className="config-weapon-config-container-3">
                        <div className="config-weapon-config-button-row" aria-label="武器配置按钮组 3">
                          {weaponConfigIndices.map((buttonNumber) => (
                            <button
                              key={buttonNumber}
                              type="button"
                              className={`config-weapon-config-button ${getWeaponConfigButtonState(buttonNumber, weaponSkillLevel3)}`}
                              aria-label={`武器配置按钮 3-${buttonNumber}`}
                              aria-pressed={buttonNumber <= weaponSkillLevel3}
                              onClick={() => {
                                updateCurrentConfig((prev) => ({
                                  ...prev,
                                  weapon: {
                                    ...prev.weapon,
                                    config: {
                                      ...prev.weapon.config,
                                      skillLevels: {
                                        ...prev.weapon.config.skillLevels,
                                        skill3: getNextWeaponConfigCount(weaponSkillLevel3, buttonNumber),
                                      },
                                    },
                                  },
                                }));
                              }}
                            />
                          ))}
                        </div>
                        <div className="config-weapon-config-text-3">
                          <span className="config-weapon-config-value">{weaponSkillLevel3}</span>
                            <span className="config-weapon-config-summary config-weapon-config-summary--multiline">
                              {currentWeaponSkill3Lines.map((line, index) => (
                                <span key={`weapon-skill3-${index}`} className="config-weapon-config-summary-line">
                                  <span className="config-weapon-config-summary-label">{line.label}</span>
                                  {line.typeKey ? <span className="config-weapon-config-summary-dot">·</span> : null}
                                  {line.typeKey ? <span className="config-weapon-config-summary-type">{line.typeKey}</span> : null}
                                  {line.tail ? <span className="config-weapon-config-summary-tail">{line.tail}</span> : null}
                                </span>
                              ))}
                            </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
                <div className="operator-config-page-weapon-spacer" aria-hidden="true" />
              </div>
              <div className="config-cti-strip config-drawer-host" ref={ctiSelectorRef}>
                <textarea
                  className="config-cti-input"
                  placeholder="CTI 输入武器名/缩写自动搜索"
                  value={ctiInputValue}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setCtiInputValue(nextValue);
                    setIsCtiDrawerOpen(nextValue.trim().length > 0);
                  }}
                  onFocus={() => {
                    if (ctiInputValue.trim().length > 0) {
                      setIsCtiDrawerOpen(true);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setIsCtiDrawerOpen(false);
                    }
                  }}
                />
                <div className={`config-cti-drawer${isCtiDrawerOpen ? ' is-open' : ''}`} role="listbox" aria-hidden={!isCtiDrawerOpen}>
                  {weaponPickerOptions.slice(0, 12).map((weaponName) => (
                    <div key={`cti-${weaponName}`} className="config-weapon-option" aria-hidden="true">
                      {weaponName}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="config-side-rail">
              <div className="config-avatar-strip">
                {visibleCharacters.map((character) => (
                  <button
                    key={character.id}
                    type="button"
                    className={`config-avatar-item${activeCharacterId === character.id ? ' is-active' : ''}`}
                    aria-label={character.name}
                    onClick={() => {
                      setActiveCharacterId(character.id);
                      ensureCharacterConfig(character.id, character);
                    }}
                  >
                    {character.avatarUrl ? (
                      <img
                        className="config-avatar-image"
                        src={character.avatarUrl}
                        alt={`${character.name} 头像`}
                        onError={(event) => {
                          (event.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      {equipmentPickerMeta ? (
        <div className="operator-config-page-picker-backdrop" onClick={() => setEquipmentPickerSlot(null)}>
          <div
            className="operator-config-page-picker-modal"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="operator-config-page-picker-header">
              <h3 className="operator-config-page-picker-title">{`选择${equipmentPickerMeta.part}`}</h3>
              <button type="button" className="operator-config-page-picker-close" onClick={() => setEquipmentPickerSlot(null)}>
                关闭
              </button>
            </div>
            <div className="operator-config-page-picker-body">
              {equipmentLibraryError ? (
                <p className="operator-config-page-picker-message">{`装备数据读取失败：${equipmentLibraryError}`}</p>
              ) : null}
              {!equipmentLibraryError && equipmentPickerOptions.length === 0 ? (
                <p className="operator-config-page-picker-message">未匹配到装备</p>
              ) : null}
              {!equipmentLibraryError && equipmentPickerOptions.length > 0 ? (
                <div className="operator-config-page-picker-grid">
                  <button
                    type="button"
                    className="operator-config-page-picker-option"
                    onClick={() => {
                      if (equipmentPickerSlot) {
                        handleClearEquipment(equipmentPickerSlot);
                      }
                    }}
                  >
                    <div className="operator-config-page-picker-option-image">
                      <span className="operator-config-page-picker-option-fallback">空</span>
                    </div>
                    <div className="operator-config-page-picker-option-meta">
                      <span className="operator-config-page-picker-option-name">不选择装备</span>
                      <span className="operator-config-page-picker-option-id">empty</span>
                    </div>
                  </button>
                  {equipmentPickerOptions.map((item) => {
                    const imageUrl = resolveStoredImageUrl(item.imgUrl);
                    return (
                      <button
                        key={item.equipmentId}
                        type="button"
                        className="operator-config-page-picker-option"
                        onClick={() => {
                          if (equipmentPickerSlot) {
                            handleSelectEquipment(equipmentPickerSlot, item);
                          }
                        }}
                      >
                        <div className="operator-config-page-picker-option-image">
                          {imageUrl ? (
                            <img src={imageUrl} alt={item.name} className="operator-config-page-picker-option-img" />
                          ) : (
                            <span className="operator-config-page-picker-option-fallback">{item.part}</span>
                          )}
                        </div>
                        <div className="operator-config-page-picker-option-meta">
                          <span className="operator-config-page-picker-option-name">{item.name}</span>
                          <span className="operator-config-page-picker-option-id">{item.equipmentId}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {equipmentTooltip ? (
        <div
          className="operator-config-page-equip-tooltip"
          style={{
            left: `${equipmentTooltip.x}px`,
            top: `${equipmentTooltip.y}px`,
          }}
        >
          {equipmentTooltip.text}
        </div>
      ) : null}
      {isPanelDetailOpen ? (
        <div className="operator-config-page-panel-detail-backdrop" onClick={() => setIsPanelDetailOpen(false)}>
          <div
            className="operator-config-page-panel-detail-modal"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="operator-config-page-panel-detail-header">
              <h3 className="operator-config-page-panel-detail-title">面板数据详情</h3>
              <button type="button" className="operator-config-page-panel-detail-close" onClick={() => setIsPanelDetailOpen(false)}>
                关闭
              </button>
            </div>
            <pre className="operator-config-page-panel-detail-content">
              {configSnapshot?.detailMarkdown ?? '暂无面板数据'}
            </pre>
          </div>
        </div>
      ) : null}
      {activeSkillDetailKey ? (
        <SkillDetailModal
          skillKey={activeSkillDetailKey}
          levelKey={activeSkillDetailLevel}
          groups={activeSkillDetailGroups}
          onClose={() => setActiveSkillDetailKey(null)}
        />
      ) : null}
      {isWeaponPickerOpen ? (
        <div className="operator-config-page-picker-backdrop" onClick={() => setIsWeaponPickerOpen(false)}>
          <div
            className="operator-config-page-picker-modal"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="operator-config-page-picker-header">
              <h3 className="operator-config-page-picker-title">选择武器</h3>
              <button type="button" className="operator-config-page-picker-close" onClick={() => setIsWeaponPickerOpen(false)}>
                关闭
              </button>
            </div>
            <div className="operator-config-page-picker-body">
              {weaponLibraryError ? (
                <p className="operator-config-page-picker-message">{`武器库读取失败：${weaponLibraryError}`}</p>
              ) : null}
              {!weaponLibraryError && weaponPickerOptions.length === 0 ? (
                <p className="operator-config-page-picker-message">未匹配到武器</p>
              ) : null}
              {!weaponLibraryError && weaponPickerOptions.length > 0 ? (
                <div className="operator-config-page-picker-grid">
                  <button
                    type="button"
                    className="operator-config-page-picker-option"
                    onClick={handleClearWeapon}
                  >
                    <div className="operator-config-page-picker-option-image">
                      <span className="operator-config-page-picker-option-fallback">空</span>
                    </div>
                    <div className="operator-config-page-picker-option-meta">
                      <span className="operator-config-page-picker-option-name">不选择武器</span>
                      <span className="operator-config-page-picker-option-id">empty</span>
                    </div>
                  </button>
                  {weaponPickerOptions.map((weaponName) => (
                    <button
                      key={weaponName}
                      type="button"
                      className="operator-config-page-picker-option"
                      onClick={() => {
                        handleSelectWeapon(weaponName);
                      }}
                    >
                      <div className="operator-config-page-picker-option-image">
                        <img
                          src={resolveStoredImageUrl(weaponLibrary[weaponName]?.imgUrl) || resolveWeaponImageUrl(weaponName)}
                          alt={weaponName}
                          className="operator-config-page-picker-option-img"
                        />
                      </div>
                      <div className="operator-config-page-picker-option-meta">
                        <span className="operator-config-page-picker-option-name">{weaponName}</span>
                        <span className="operator-config-page-picker-option-id">{weaponLibrary[weaponName]?.id ?? 'weapon'}</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
