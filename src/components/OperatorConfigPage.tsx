import React from 'react';
import './CanvasBoard/CanvasBoard.css';
import './OperatorConfigPage.css';
import { useAppContext } from '../context/AppContext';
import type { Character, SkillType } from '../types';
import type {
  OperatorConfigPageCache,
  OperatorConfigPageCharacterConfig,
  OperatorConfigPageEquipmentPieceState,
  OperatorConfigPageEntryState,
} from '../types/storage';
import { getOperatorConfigPageCache, setOperatorConfigPageCache } from '../utils/storage';

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
}

interface WeaponData {
  name: string;
  rarity?: number;
  description?: string;
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
const WEAPON_LIBRARY_STORAGE_KEY = 'def.weapon-sheet.library.v1';
const EQUIPMENT_LIBRARY_STORAGE_KEY = 'def.equipment-sheet.draft.v1';
const EQUIPMENT_SLOT_METAS = [
  { slotKey: 'accessory1', groupClass: 'operator-config-page-equip-button-group--1', rowClass: 'operator-config-page-equip-button-row--1', part: '配件', circleClass: 'operator-config-page-equip-circle--1' },
  { slotKey: 'accessory2', groupClass: 'operator-config-page-equip-button-group--2', rowClass: 'operator-config-page-equip-button-row--2', part: '配件', circleClass: 'operator-config-page-equip-circle--2' },
  { slotKey: 'armor', groupClass: 'operator-config-page-equip-button-group--3', rowClass: 'operator-config-page-equip-button-row--3', part: '护甲', circleClass: 'operator-config-page-equip-circle--3' },
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
    config: { level: 3 },
    data: {},
  };
}

function createEquipmentPiece(pieceId = ''): OperatorConfigPageEquipmentPieceState {
  return {
    id: pieceId,
    entryCount: 3,
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
    panel: {},
  };
}

function createEquipmentPieceFromItem(item: EquipmentItem): OperatorConfigPageEquipmentPieceState {
  const effectEntries = (['effect1', 'effect2', 'effect3'] as const)
    .map((effectId) => item.effects[effectId])
    .filter((effect): effect is EquipmentEffect => Boolean(effect))
    .map((effect) => ({
      id: effect.effectId,
      config: { level: 3 },
      data: effect as unknown as Record<string, unknown>,
    }));

  const fallbackEntries = [
    ...effectEntries,
    ...Array.from({ length: Math.max(0, 3 - effectEntries.length) }, (_, index) => createEquipmentEntry(`entry${effectEntries.length + index + 1}`)),
  ].slice(0, 3);

  return {
    id: item.equipmentId,
    entryCount: Math.max(1, Math.min(3, effectEntries.length || 1)),
    entries: fallbackEntries,
    config: {},
    data: item as unknown as Record<string, unknown>,
  };
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

type SkillTrackRowProps = {
  skillKey: string;
  label: string;
  stage: number;
  onChange: (nextStage: number) => void;
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

function SkillTrackRow({ skillKey, label, stage, onChange }: SkillTrackRowProps) {
  const currentStage = stage;
  const currentLevelLabel = formatSkillStage(currentStage);

  return (
    <div className="operator-config-page-track-row">
      <div className="operator-config-page-track-heading">
        <span className="operator-config-page-track-key">{skillKey}</span>
        <span className="operator-config-page-track-label">{label}</span>
        <span className="operator-config-page-track-sublabel">{currentLevelLabel}</span>
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

export function OperatorConfigPage() {
  const { state } = useAppContext();
  const visibleCharacters = React.useMemo(
    () => (state.selectedCharacters.length > 0 ? state.selectedCharacters : state.loadedCharacters).slice(0, 4),
    [state.loadedCharacters, state.selectedCharacters]
  );
  const [configMap, setConfigMap] = React.useState<OperatorConfigPageCache>(() => getOperatorConfigPageCache());
  const [activeCharacterId, setActiveCharacterId] = React.useState<string | null>(() => visibleCharacters[0]?.id ?? null);
  const [equipmentLibrary, setEquipmentLibrary] = React.useState<EquipmentLibrary | null>(null);
  const [equipmentLibraryError, setEquipmentLibraryError] = React.useState<string | null>(null);
  const [equipmentPickerSlot, setEquipmentPickerSlot] = React.useState<EquipmentSlotKey | null>(null);
  const [weaponLibrary, setWeaponLibrary] = React.useState<Record<string, WeaponData & { id: string; imgUrl: string }>>({});
  const [weaponLibraryError, setWeaponLibraryError] = React.useState<string | null>(null);
  const [isWeaponPickerOpen, setIsWeaponPickerOpen] = React.useState(false);
  const [ctiInputValue, setCtiInputValue] = React.useState('');
  const [isCtiDrawerOpen, setIsCtiDrawerOpen] = React.useState(false);
  const ctiSelectorRef = React.useRef<HTMLDivElement | null>(null);
  const weaponConfigIndices = React.useMemo(() => Array.from({ length: 9 }, (_, index) => index + 1), []);
  const equipConfigIndices = React.useMemo(() => Array.from({ length: 3 }, (_, index) => index + 1), []);
  const levelIndices = React.useMemo(() => Array.from({ length: 8 }, (_, index) => index + 1), []);

  const persistConfigMap = React.useCallback((nextConfigMap: OperatorConfigPageCache) => {
    setOperatorConfigPageCache(nextConfigMap);
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
        const nextCharacterConfig = existing
          ? {
              ...existing,
              character: {
                ...existing.character,
                id: character.id,
                data: createCharacterData(character),
              },
            }
          : createDefaultCharacterConfig(character);
        const next = { ...prev, [characterId]: nextCharacterConfig };
        setOperatorConfigPageCache(next);
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
      return visibleCharacters[0]?.id ?? null;
    });
  }, [visibleCharacters]);

  React.useEffect(() => {
    if (!activeCharacterId) return;
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
  const currentWeaponName = currentConfig?.weapon.id ?? '';
  const currentWeaponLevel = Number(currentConfig?.weapon.config.level ?? 90);
  const currentWeaponImageUrl = resolveStoredImageUrl((currentWeaponData as Partial<WeaponData> & { imgUrl?: string }).imgUrl) || resolveWeaponImageUrl(currentWeaponName);
  const currentWeaponAttack = currentWeaponData.attackGrowth?.[String(currentWeaponLevel)] ?? currentWeaponData.attackGrowth?.['90'] ?? null;
  const currentWeaponSkill1Data = currentWeaponData.skills?.skill1;
  const currentWeaponSkill2Data = currentWeaponData.skills?.skill2;
  const currentWeaponSkill3Data = currentWeaponData.skills?.skill3;
  const currentWeaponSkill1Text =
    currentWeaponSkill1Data?.levels?.[String(weaponSkillLevel1)]?.description ?? currentWeaponSkill1Data?.name ?? '未选择武器';
  const currentWeaponSkill2Text =
    currentWeaponSkill2Data?.levels?.[String(weaponSkillLevel2)]?.description ?? currentWeaponSkill2Data?.name ?? '未选择武器';
  const currentWeaponSkill3Text =
    currentWeaponSkill3Data?.levels?.[String(weaponSkillLevel3)]?.description ?? currentWeaponSkill3Data?.name ?? '未选择武器';
  const attributeItems = React.useMemo<ReadonlyArray<AttributeItem>>(() => {
    return [
      { label: '名称', value: currentCharacterData.name ?? activeCharacter?.name ?? '角色占位' },
      { label: '属性', value: currentCharacterData.element ?? activeCharacter?.element ?? '属性占位' },
      { label: '等级', value: String(currentConfig?.character.config.level ?? 90) },
      { label: '攻击力', value: String(currentAttributes?.atk ?? '0000') },
      { label: '力量', value: String(currentAttributes?.strength ?? '000'), tone: 'main' },
      { label: '敏捷', value: String(currentAttributes?.agility ?? '000') },
      { label: '智识', value: String(currentAttributes?.intelligence ?? '000'), tone: 'sub' },
      { label: '意志', value: String(currentAttributes?.will ?? '000') },
    ];
  }, [activeCharacter?.element, activeCharacter?.name, currentAttributes, currentCharacterData.name, currentConfig?.character.config.level]);

  const updateCurrentConfig = React.useCallback((updater: (current: OperatorConfigPageCharacterConfig) => OperatorConfigPageCharacterConfig) => {
    if (!activeCharacterId) return;
    const sourceCharacter = getCharacterById(activeCharacterId);
    if (!sourceCharacter && !configMap[activeCharacterId]) return;

    const baseConfig = configMap[activeCharacterId] ?? (sourceCharacter ? createDefaultCharacterConfig(sourceCharacter) : null);
    if (!baseConfig) return;

    const nextConfig = updater(baseConfig);
    persistConfigMap({
      ...configMap,
      [activeCharacterId]: nextConfig,
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

  const getEquipmentEntryLevel = React.useCallback(
    (slotKey: EquipmentSlotKey, entryIndex: EquipmentEntryIndex) => currentConfig?.equipment[slotKey].entries[entryIndex]?.config.level ?? 3,
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

  return (
    <div className="operator-config-page-root">
      <div className="operator-config-page-shell">
        <div className="config-panel operator-config-page-panel">
          <div className="config-panel-header">
            <button className="config-panel-back-btn" type="button">
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
                                return (
                                  <React.Fragment key={`${slotMeta.slotKey}-${entryIndex}`}>
                                    <div className="operator-config-page-equip-button-textdiv">{currentLevel}</div>
                                    <div className={`operator-config-page-equip-button-row ${slotMeta.rowClass}`}>
                                      {equipConfigIndices.map((buttonNumber) => (
                                        <button
                                          key={`${slotMeta.slotKey}-${entryIndex}-${buttonNumber}`}
                                          type="button"
                                          className={`operator-config-page-equip-button ${getWeaponConfigButtonState(buttonNumber, Number(currentLevel))}`}
                                          aria-label={`${slotMeta.slotKey} 词条 ${entryIndex + 1} 档位 ${buttonNumber}`}
                                          aria-pressed={buttonNumber <= Number(currentLevel)}
                                          onClick={() => {
                                            updateEquipmentEntryLevel(
                                              slotMeta.slotKey,
                                              entryIndex,
                                              getNextWeaponConfigCount(Number(currentLevel), buttonNumber)
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
                    <h4 className="operator-config-page-section-title">基础数据</h4>
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
                            {levelIndices.map((levelNumber) => (
                              <button
                              key={levelNumber}
                              type="button"
                              className={`operator-config-page-level-slot${levelNumber <= characterLevelCount ? ' is-active' : ''}`}
                              aria-label={`等级按钮 ${levelNumber}`}
                              aria-pressed={levelNumber <= characterLevelCount}
                              onClick={() => {
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
                          ))}
                        </div>
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
                        <span className="config-weapon-choose-detail">{`ATK ${currentWeaponAttack ?? '---'} / Lv.${currentWeaponLevel}`}</span>
                        <span className="config-weapon-choose-detail">{currentWeaponSkill1Text}</span>
                        <span className="config-weapon-choose-detail">{currentWeaponSkill2Text}</span>
                        <span className="config-weapon-choose-detail">{currentWeaponSkill3Text}</span>
                      </button>
                      <div className="config-weapon-choose-img-area">
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
                        <div className="config-weapon-config-text">{weaponSkillLevel1}</div>
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
                        <div className="config-weapon-config-text">{weaponSkillLevel2}</div>
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
                        <div className="config-weapon-config-text-3">{weaponSkillLevel3}</div>
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
                    <span className="operator-config-page-avatar-fallback">{character.name.slice(-1)}</span>
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
