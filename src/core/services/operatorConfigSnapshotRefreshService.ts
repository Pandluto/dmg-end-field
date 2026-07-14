import { buildConfigSnapshot } from '../calculators/operatorPanelCalculator';
import type {
  ConfigSnapshot,
  EquipmentPieceInput,
  EquipmentSetBuffInput,
  OperatorBuffEffectInput,
  OperatorBuffInput,
  OperatorPanelInput,
  WeaponSkillInput,
} from '../calculators/operatorPanelCalculator';
import type { BuffData, CandidateBuff } from '../domain/buff';
import type { Character } from '../../types';
import type { CharacterConfigJson, OperatorConfigPageCache } from '../../types/storage';
import type { EquipmentConfig } from '../../utils/equipmentParser';
import { isPercentField } from '../../utils/equipmentParser';
import { resolvePublicPath } from '../../utils/assetResolver';
import { getCharacterConfigMap } from '../../utils/storage';
import { normalizeGameKnowledgeText, resolveGameGearSetAlias } from '../../utils/gameKnowledge';
import { getOperatorConfigPageCache, setOperatorConfigPageCache } from '../repositories';
import { normalizeExtraHitConfig } from './buffExtraHit';
import { normalizeStoredBuffDefinition } from './buffStorageNormalization';

type EquipmentPart = '护甲' | '护手' | '配件';
type EquipmentEffectId = 'effect1' | 'effect2' | 'effect3';
type EquipmentLevelKey = '0' | '1' | '2' | '3';
type OperatorSkillKey = 'A' | 'B' | 'E' | 'Q' | 'Dot';
export type OperatorConfigEquipmentSlotKey = 'armor' | 'accessory2' | 'accessory1' | 'glove';

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
  fixedStat?: unknown;
  effects: Partial<Record<EquipmentEffectId, EquipmentEffect>>;
}

interface EquipmentThreePieceBuff {
  effectId: string;
  name: string;
  category: 'positive' | 'passive' | 'condition' | 'countable' | '';
  typeKey: string;
  value: number;
  unit: 'flat' | 'percent';
  description?: string;
  raw?: string;
  valueMode?: 'fixed' | 'derived';
  derivedValue?: {
    source: 'hp' | 'atk' | 'strength' | 'agility' | 'intelligence' | 'will' | 'sourceSkill';
    perPointValue: number;
  };
  maxStacks?: number;
  multiplier?: { coefficient: number };
  effectKind?: 'modifier' | 'extraHit';
  extraHitConfig?: EquipmentSetBuffInput['extraHitConfig'];
}

interface EquipmentGearSet {
  gearSetId: string;
  name: string;
  threePieceBuff?: EquipmentThreePieceBuff;
  threePieceBuffs?: Record<string, EquipmentThreePieceBuff>;
  equipments: Record<string, EquipmentItem>;
}

interface EquipmentLibrary {
  gearSets: Record<string, EquipmentGearSet>;
}

interface WeaponData {
  id?: string;
  name?: string;
  rarity?: number;
  type?: string;
  description?: string;
  imgUrl?: string;
  attackGrowth?: Record<string, number>;
  skills?: {
    skill1?: WeaponSkillInput;
    skill2?: WeaponSkillInput;
    skill3?: WeaponSkillInput;
  };
}

type WeaponLibrary = Record<string, WeaponData & { id: string; name: string; imgUrl: string }>;
type RawWeaponLibrary = Record<string, Partial<WeaponData> & { id?: string; imgUrl?: string }>;

const WEAPON_LIBRARY_STORAGE_KEY = 'def.weapon-sheet.library.v1';
const EQUIPMENT_DRAFT_STORAGE_KEY = 'def.equipment-sheet.draft.v1';
const EQUIPMENT_LIBRARY_STORAGE_KEY = 'def.equipment-sheet.library.v1';
const DEFAULT_OPERATOR_SKILL_CONFIG: Record<OperatorSkillKey, string> = {
  A: 'M3',
  B: 'M3',
  E: 'M3',
  Q: 'M3',
  Dot: 'M3',
};
const DEFAULT_WEAPON_SKILL_LEVELS = {
  skill1: 9,
  skill2: 9,
  skill3: 4,
};
const EQUIPMENT_SLOT_METAS: Array<{ slotKey: OperatorConfigEquipmentSlotKey; part: EquipmentPart }> = [
  { slotKey: 'armor', part: '护甲' },
  { slotKey: 'accessory2', part: '配件' },
  { slotKey: 'accessory1', part: '配件' },
  { slotKey: 'glove', part: '护手' },
];

export interface OperatorEquipmentSelectionInput {
  slotKey?: OperatorConfigEquipmentSlotKey;
  part?: EquipmentPart;
  equipmentId?: string;
  equipmentName?: string;
  gearSetId?: string;
  gearSetName?: string;
  fillSlots?: boolean;
  entryLevel?: number | string;
  entryLevels?: Array<number | string> | Record<string, number | string>;
}

export interface OperatorEquipmentSelectionResult {
  slotKey: OperatorConfigEquipmentSlotKey;
  gearSetId: string;
  gearSetName: string;
  equipmentId: string;
  name: string;
  part: EquipmentPart;
  effects: Array<{
    effectId: string;
    label: string;
    typeKey: string;
    level: number | string;
    value: number;
    unit?: string;
  }>;
}

export interface OperatorConfigSnapshotRefreshResult {
  refreshedCharacterIds: string[];
  skippedCharacterIds: string[];
  cache: OperatorConfigPageCache;
}

function readLocalStorageJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function loadPublicJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(resolvePublicPath(path), { cache: 'no-store' });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function normalizeLegacyEquipmentPercentValue(
  typeKey: string,
  unit: 'flat' | 'percent' | string | undefined,
  value: number,
  raw?: unknown,
): number {
  const nonDecimalTypeKeys = new Set([
    'strengthBoost',
    'agilityBoost',
    'intelligenceBoost',
    'willBoost',
    'flatAtk',
    'mainStat',
    'subStat',
    'sourceSkillBoost',
  ]);
  if (unit !== 'percent' || nonDecimalTypeKeys.has(typeKey)) return value;
  const rawText = String(raw || '');
  if (!rawText.includes('%')) return value;
  const rawNumbers = (rawText.match(/[+-]?\d+(?:\.\d+)?/g) || []).map(Number).filter(Number.isFinite);
  const matchesStoredDecimal = rawNumbers.some((rawNumber) => Math.abs(value - rawNumber / 100) < 1e-4);
  if (matchesStoredDecimal) return value;
  const matchesLegacyPercent = rawNumbers.some((rawNumber) => Math.abs(value - rawNumber) < 1e-6);
  if (matchesLegacyPercent) return value / 100;
  if (Math.abs(value) > 1) return value / 100;
  return value;
}

function normalizeEquipmentLibrary(raw: unknown): EquipmentLibrary {
  const source = raw as Partial<EquipmentLibrary> | null | undefined;
  const next: EquipmentLibrary = { gearSets: {} };
  const rawGearSets = source?.gearSets && typeof source.gearSets === 'object' ? source.gearSets : {};
  Object.entries(rawGearSets).forEach(([gearSetId, rawSet]) => {
    const setValue = rawSet as Partial<EquipmentGearSet>;
    const equipments: Record<string, EquipmentItem> = {};
    const threePieceBuffs: Record<string, EquipmentThreePieceBuff> = {};
    const normalizeThreePieceBuffCategory = (category: unknown): EquipmentThreePieceBuff['category'] => (
      category === 'positive' || category === 'passive' || category === 'condition' || category === 'countable'
        ? category
        : ''
    );
    const normalizeThreePieceBuff = (effectId: string, rawBuff: Partial<EquipmentThreePieceBuff>): EquipmentThreePieceBuff => {
      const effectKind = rawBuff.effectKind === 'extraHit' ? 'extraHit' : 'modifier';
      const typeKey = effectKind === 'extraHit' ? '' : String(rawBuff.typeKey || '');
      const unit = rawBuff.unit === 'flat' ? 'flat' : 'percent';
      const rawValue = typeof rawBuff.value === 'number' && Number.isFinite(rawBuff.value) ? rawBuff.value : 0;
      return {
        effectId: String(rawBuff.effectId || effectId),
        name: String(rawBuff.name || effectId),
        category: effectKind === 'extraHit'
          ? normalizeThreePieceBuffCategory(rawBuff.category) === 'countable' ? 'countable' : 'passive'
          : normalizeThreePieceBuffCategory(rawBuff.category),
        typeKey,
        value: effectKind === 'extraHit' ? 0 : normalizeLegacyEquipmentPercentValue(typeKey, unit, rawValue, rawBuff.raw),
        unit,
        raw: rawBuff.raw,
        description: rawBuff.description,
        valueMode: rawBuff.valueMode,
        derivedValue: rawBuff.derivedValue,
        maxStacks: rawBuff.maxStacks,
        multiplier: rawBuff.multiplier,
        effectKind,
        ...(effectKind === 'extraHit'
          ? { extraHitConfig: normalizeExtraHitConfig(rawBuff.extraHitConfig, `${effectId}-extra-hit`) }
          : {}),
      };
    };
    Object.entries(setValue.threePieceBuffs ?? {}).forEach(([effectId, rawBuff]) => {
      threePieceBuffs[effectId] = normalizeThreePieceBuff(effectId, rawBuff as Partial<EquipmentThreePieceBuff>);
    });
    if (setValue.threePieceBuff && Object.keys(threePieceBuffs).length === 0) {
      threePieceBuffs.effect1 = normalizeThreePieceBuff('effect1', setValue.threePieceBuff);
    }
    Object.entries(setValue.equipments ?? {}).forEach(([equipmentId, rawEquipment]) => {
      const itemValue = rawEquipment as Partial<EquipmentItem>;
      const effects = (['effect1', 'effect2', 'effect3'] as const).reduce<Partial<Record<EquipmentEffectId, EquipmentEffect>>>((acc, effectId) => {
        const rawEffect = itemValue.effects?.[effectId];
        if (!rawEffect) return acc;
        const typeKey = String(rawEffect.typeKey || '');
        const unit = rawEffect.unit === 'percent' ? 'percent' : 'flat';
        acc[effectId] = {
          effectId,
          label: String(rawEffect.label || effectId),
          typeKey,
          category: rawEffect.category === 'ability' ? 'ability' : 'buff',
          levels: Object.fromEntries(
            Object.entries(rawEffect.levels ?? {}).flatMap(([levelKey, levelValue]) => {
              const parsed = typeof levelValue === 'number' && Number.isFinite(levelValue) ? levelValue : Number(levelValue);
              return Number.isFinite(parsed)
                ? [[levelKey, normalizeLegacyEquipmentPercentValue(typeKey, unit, parsed, rawEffect.raw)]]
                : [];
            }),
          ) as Partial<Record<EquipmentLevelKey, number>>,
          unit,
          raw: rawEffect.raw,
        };
        return acc;
      }, {});
      equipments[equipmentId] = {
        equipmentId: String(itemValue.equipmentId || equipmentId),
        name: String(itemValue.name || equipmentId),
        part: itemValue.part === '护甲' || itemValue.part === '护手' ? itemValue.part : '配件',
        imgUrl: String(itemValue.imgUrl || ''),
        fixedStat: itemValue.fixedStat,
        effects,
      };
    });
    next.gearSets[gearSetId] = {
      gearSetId: String(setValue.gearSetId || gearSetId),
      name: String(setValue.name || gearSetId),
      ...(Object.keys(threePieceBuffs).length > 0 ? { threePieceBuffs } : {}),
      equipments,
    };
  });
  return next;
}

function readEquipmentLibraryFromStorage(): EquipmentLibrary {
  const library = normalizeEquipmentLibrary(readLocalStorageJson(EQUIPMENT_LIBRARY_STORAGE_KEY, { gearSets: {} }));
  if (Object.keys(library.gearSets).length > 0) {
    return library;
  }
  return normalizeEquipmentLibrary(readLocalStorageJson(EQUIPMENT_DRAFT_STORAGE_KEY, { gearSets: {} }));
}

function normalizeWeaponLibrary(raw: unknown): WeaponLibrary {
  const source = raw && typeof raw === 'object' ? (raw as RawWeaponLibrary) : {};
  const next: WeaponLibrary = {};
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

function parsePotentialToCount(potential: string | undefined): number {
  const value = potential?.trim() || '0潜';
  if (value === '满潜') return 6;
  const numeric = Number.parseInt(value, 10);
  if (Number.isNaN(numeric)) return 1;
  return Math.min(6, Math.max(1, numeric + 1));
}

function normalizePotentialForCalculator(potential: string | undefined): string {
  const count = parsePotentialToCount(potential);
  return `${Math.max(0, count - 1)}潜`;
}

function defaultCharacterPotential(character: Character): string {
  return character.rarity === 6 ? '0潜' : '5潜';
}

function legacyWeaponPotential(mode: CharacterConfigJson['weaponPotentialMode'] | undefined): string {
  return mode === 'PMAX' ? '5潜' : '0潜';
}

function getWeaponSkill3PotentialBonus(weaponPotential: string): number {
  return Math.max(0, Math.min(5, parsePotentialToCount(weaponPotential) - 1));
}

function resolveWeaponData(weaponName: string, weaponLibrary: WeaponLibrary): WeaponData | null {
  if (!weaponName) return null;
  const localWeapon =
    weaponLibrary[weaponName] ??
    Object.values(weaponLibrary).find((weapon) => weapon.id === weaponName || weapon.name === weaponName);
  return localWeapon ?? null;
}

function buildWeaponDataFromSnapshot(snapshot: ConfigSnapshot | undefined): WeaponData | null {
  if (!snapshot?.weapon.name && !snapshot?.weapon.id) return null;
  const weapon = snapshot.weapon;
  const skill1 = weapon.skills.skill1
    ? {
      name: weapon.skills.skill1.label,
      statType: weapon.skills.skill1.typeKey,
      levels: {
        [String(weapon.skills.skill1.level)]: {
          value: weapon.skills.skill1.value,
          description: String(weapon.skills.skill1.raw ?? ''),
        },
      },
    }
    : undefined;
  const skill2 = weapon.skills.skill2
    ? {
      name: weapon.skills.skill2.label,
      statType: weapon.skills.skill2.typeKey,
      levels: {
        [String(weapon.skills.skill2.level)]: {
          value: weapon.skills.skill2.value,
          description: String(weapon.skills.skill2.raw ?? ''),
        },
      },
    }
    : undefined;
  const skill3Effects = Object.fromEntries(
    weapon.skills.skill3.effects.map((effect, index) => [
      effect.effectKey || `effect${index + 1}`,
      {
        name: effect.label,
        type: effect.typeKey,
        category: effect.category,
        levels: {
          [String(effect.level)]: effect.value,
        },
        valueMode: effect.valueMode,
        derivedValue: effect.derivedValue,
        maxStacks: effect.maxStacks,
        multiplier: effect.multiplier,
        effectKind: effect.effectKind,
        extraHitConfig: effect.extraHitConfig,
      },
    ]),
  );
  return {
    id: weapon.id,
    name: weapon.name || weapon.id,
    attackGrowth: {
      [String(weapon.config.level)]: weapon.attack,
      90: weapon.attack,
    },
    skills: {
      ...(skill1 ? { skill1 } : {}),
      ...(skill2 ? { skill2 } : {}),
      skill3: {
        effects: skill3Effects,
      },
    },
  };
}

function getEquipmentEffectLevelValue(effect: Partial<EquipmentEffect> | undefined, level: number | string): number {
  const value = effect?.levels?.[String(level) as EquipmentLevelKey];
  return typeof value === 'number' ? value : 0;
}

function findEquipmentItemInLibrary(equipmentLibrary: EquipmentLibrary | null, equipmentId: string): EquipmentItem | null {
  if (!equipmentLibrary || !equipmentId) return null;
  return Object.values(equipmentLibrary.gearSets)
    .flatMap((gearSet) => Object.values(gearSet.equipments))
    .find((item) => item.equipmentId === equipmentId) ?? null;
}

function findEquipmentGearSet(
  equipmentLibrary: EquipmentLibrary,
  selection: OperatorEquipmentSelectionInput,
): EquipmentGearSet | null {
  if (!selection.gearSetId && !selection.gearSetName) return null;
  const targetId = selection.gearSetId?.trim();
  const targetName = selection.gearSetName?.trim();
  const aliasId = resolveGameGearSetAlias(targetId)?.gearSetId ?? resolveGameGearSetAlias(targetName)?.gearSetId;
  const normalizedId = normalizeGameKnowledgeText(targetId);
  const normalizedName = normalizeGameKnowledgeText(targetName);
  return Object.entries(equipmentLibrary.gearSets)
    .map(([gearSetId, gearSet]) => ({ ...gearSet, gearSetId: gearSet.gearSetId || gearSetId }))
    .find((gearSet) => (
      (targetId && gearSet.gearSetId === targetId) ||
      (targetName && gearSet.name === targetName) ||
      (aliasId && gearSet.gearSetId === aliasId) ||
      (normalizedId && normalizeGameKnowledgeText(gearSet.gearSetId) === normalizedId) ||
      (normalizedName && (
        normalizeGameKnowledgeText(gearSet.name) === normalizedName ||
        normalizeGameKnowledgeText(gearSet.gearSetId) === normalizedName
      ))
    )) ?? null;
}

function findEquipmentWithGearSet(
  equipmentLibrary: EquipmentLibrary,
  selection: OperatorEquipmentSelectionInput,
): { gearSet: EquipmentGearSet; equipment: EquipmentItem } | null {
  const targetGearSet = findEquipmentGearSet(equipmentLibrary, selection);
  const gearSets = targetGearSet
    ? [targetGearSet]
    : Object.entries(equipmentLibrary.gearSets).map(([gearSetId, gearSet]) => ({
        ...gearSet,
        gearSetId: gearSet.gearSetId || gearSetId,
      }));
  const targetId = selection.equipmentId?.trim();
  const targetName = selection.equipmentName?.trim();
  const targetPart = selection.part;

  for (const gearSet of gearSets) {
    const match = Object.entries(gearSet.equipments)
      .map(([equipmentId, equipment]) => ({ ...equipment, equipmentId: equipment.equipmentId || equipmentId }))
      .find((equipment) => {
        if (targetPart && equipment.part !== targetPart) return false;
        if (targetId && equipment.equipmentId !== targetId) return false;
        if (targetName && equipment.name !== targetName) return false;
        return Boolean(targetId || targetName);
      });
    if (match) {
      return { gearSet, equipment: match };
    }
  }

  return null;
}

function resolveEquipmentEntryLevel(
  effectId: string,
  index: number,
  selection: OperatorEquipmentSelectionInput,
): number | string {
  if (Array.isArray(selection.entryLevels) && selection.entryLevels[index] !== undefined) {
    return selection.entryLevels[index];
  }
  if (selection.entryLevels && !Array.isArray(selection.entryLevels)) {
    const keyed = selection.entryLevels[effectId] ?? selection.entryLevels[`effect${index + 1}`] ?? selection.entryLevels[String(index)];
    if (keyed !== undefined) return keyed;
  }
  return selection.entryLevel ?? 0;
}

function createEquipmentPieceFromSelection(
  slotKey: OperatorConfigEquipmentSlotKey,
  gearSet: EquipmentGearSet,
  equipment: EquipmentItem,
  selection: OperatorEquipmentSelectionInput,
): { piece: ConfigSnapshot['equipment']['pieces'][number]; result: OperatorEquipmentSelectionResult } {
  const effects: ConfigSnapshot['equipment']['pieces'][number]['effects'] = (['effect1', 'effect2', 'effect3'] as const)
    .flatMap((effectId, index) => {
      const effect = equipment.effects[effectId];
      if (!effect) return [];
      const level = resolveEquipmentEntryLevel(effect.effectId || effectId, index, selection);
      return [{
        effectId: String(effect.effectId || effectId),
        label: effect.label,
        typeKey: effect.typeKey,
        level,
        value: getEquipmentEffectLevelValue(effect, level),
        unit: effect.unit,
        raw: effect.raw,
      }];
    });
  const piece: ConfigSnapshot['equipment']['pieces'][number] = {
    slotKey,
    equipmentId: equipment.equipmentId,
    name: equipment.name,
    part: equipment.part,
    imgUrl: equipment.imgUrl,
    fixedStat: equipment.fixedStat,
    effects,
  };
  return {
    piece,
    result: {
      slotKey,
      gearSetId: gearSet.gearSetId,
      gearSetName: gearSet.name,
      equipmentId: equipment.equipmentId,
      name: equipment.name,
      part: equipment.part,
      effects: effects.map((effect) => ({
        effectId: effect.effectId,
        label: effect.label,
        typeKey: effect.typeKey,
        level: effect.level,
        value: effect.value,
        unit: effect.unit,
      })),
    },
  };
}

function resolveEquipmentSlotKey(
  selection: OperatorEquipmentSelectionInput,
  equipment: EquipmentItem,
  usedSlotKeys: Set<OperatorConfigEquipmentSlotKey>,
  currentPieces: EquipmentPieceInput[],
): OperatorConfigEquipmentSlotKey {
  if (selection.slotKey) return selection.slotKey;
  const matchingSlots = EQUIPMENT_SLOT_METAS
    .filter((meta) => meta.part === (selection.part ?? equipment.part))
    .map((meta) => meta.slotKey);
  const emptySlot = matchingSlots.find((slotKey) => (
    !usedSlotKeys.has(slotKey) &&
    !currentPieces.some((piece) => piece.slotKey === slotKey && piece.equipmentId)
  ));
  if (emptySlot) return emptySlot;
  return matchingSlots.find((slotKey) => !usedSlotKeys.has(slotKey)) ?? matchingSlots[0] ?? 'accessory1';
}

function expandEquipmentSelections(
  equipmentLibrary: EquipmentLibrary,
  selections: OperatorEquipmentSelectionInput[],
): OperatorEquipmentSelectionInput[] {
  return selections.flatMap((selection) => {
    // A resolver may include the first matching equipment together with the
    // user's explicit "fill every slot" intent.  The intent is authoritative:
    // do not silently downgrade a four-slot request to that one piece.
    if (!selection.fillSlots) {
      return [selection];
    }
    const gearSet = findEquipmentGearSet(equipmentLibrary, selection);
    if (!gearSet) return [selection];
    const byPart = (part: EquipmentPart) => Object.values(gearSet.equipments)
      .filter((equipment) => equipment.part === part)
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
    const armors = byPart('护甲');
    const gloves = byPart('护手');
    const accessories = byPart('配件');
    // Resolver input can carry the first candidate's id/name/slot.  Those are
    // useful for a single-piece request, but must not constrain the remaining
    // generated slots in a fillSlots request.
    const {
      equipmentId: _equipmentId,
      equipmentName: _equipmentName,
      slotKey: _slotKey,
      part: _part,
      ...fillSelection
    } = selection;
    void _equipmentId;
    void _equipmentName;
    void _slotKey;
    void _part;
    const expanded: OperatorEquipmentSelectionInput[] = [];
    if (armors[0]) expanded.push({ ...fillSelection, fillSlots: false, slotKey: 'armor', equipmentId: armors[0].equipmentId });
    if (gloves[0]) expanded.push({ ...fillSelection, fillSlots: false, slotKey: 'glove', equipmentId: gloves[0].equipmentId });
    if (accessories[0]) expanded.push({ ...fillSelection, fillSlots: false, slotKey: 'accessory1', equipmentId: accessories[0].equipmentId });
    if (accessories[1]) expanded.push({ ...fillSelection, fillSlots: false, slotKey: 'accessory2', equipmentId: accessories[1].equipmentId });
    return expanded;
  });
}

export function applyOperatorEquipmentSelectionsToSnapshot(
  snapshot: ConfigSnapshot,
  selections: OperatorEquipmentSelectionInput[],
): { snapshot: ConfigSnapshot; applied: OperatorEquipmentSelectionResult[] } {
  const equipmentLibrary = readEquipmentLibraryFromStorage();
  if (Object.keys(equipmentLibrary.gearSets).length === 0) {
    throw new Error('装备库为空，无法设置装备');
  }
  const expandedSelections = expandEquipmentSelections(equipmentLibrary, selections);
  const nextPieces: ConfigSnapshot['equipment']['pieces'] = [...snapshot.equipment.pieces];
  const applied: OperatorEquipmentSelectionResult[] = [];
  const usedSlotKeys = new Set<OperatorConfigEquipmentSlotKey>();

  expandedSelections.forEach((selection) => {
    const resolved = findEquipmentWithGearSet(equipmentLibrary, selection);
    if (!resolved) {
      throw new Error(`未找到装备: ${selection.equipmentId || selection.equipmentName || selection.gearSetId || selection.gearSetName || '(empty)'}`);
    }
    const slotKey = resolveEquipmentSlotKey(selection, resolved.equipment, usedSlotKeys, nextPieces);
    usedSlotKeys.add(slotKey);
    const { piece, result } = createEquipmentPieceFromSelection(slotKey, resolved.gearSet, resolved.equipment, selection);
    const existingIndex = nextPieces.findIndex((current) => current.slotKey === slotKey);
    if (existingIndex >= 0) {
      nextPieces[existingIndex] = piece;
    } else {
      nextPieces.push(piece);
    }
    applied.push(result);
  });

  return {
    snapshot: {
      ...snapshot,
      equipment: {
        ...snapshot.equipment,
        pieces: nextPieces,
        setBuffs: buildEquipmentSetBuffsForSnapshot({
          ...snapshot,
          equipment: {
            ...snapshot.equipment,
            pieces: nextPieces,
          },
        }, equipmentLibrary),
      },
    },
    applied,
  };
}

function buildEquipmentPiecesFromSnapshot(
  snapshot: ConfigSnapshot | undefined,
  equipmentLibrary: EquipmentLibrary | null,
): EquipmentPieceInput[] {
  if (!snapshot) return [];
  return snapshot.equipment.pieces.map((piece) => {
    const libraryItem = findEquipmentItemInLibrary(equipmentLibrary, piece.equipmentId);
    if (!libraryItem) return piece;
    const libraryEffects = Object.values(libraryItem.effects).filter((effect): effect is EquipmentEffect => Boolean(effect));
    return {
      slotKey: piece.slotKey,
      equipmentId: libraryItem.equipmentId,
      name: libraryItem.name,
      part: libraryItem.part,
      imgUrl: libraryItem.imgUrl,
      fixedStat: libraryItem.fixedStat,
      effects: piece.effects.map((currentEffect, index) => {
        const libraryEffect =
          libraryItem.effects[currentEffect.effectId as EquipmentEffectId] ??
          libraryEffects[index] ??
          null;
        if (!libraryEffect) return currentEffect;
        return {
          ...currentEffect,
          label: libraryEffect.label,
          typeKey: libraryEffect.typeKey,
          value: getEquipmentEffectLevelValue(libraryEffect, currentEffect.level),
          unit: libraryEffect.unit,
          raw: libraryEffect.raw,
        };
      }),
    };
  });
}

function buildEquipmentPiecesFromLegacyConfig(legacyConfig: CharacterConfigJson | undefined): EquipmentPieceInput[] {
  const equipment = legacyConfig?.equipment as Partial<EquipmentConfig> | undefined;
  if (!equipment) return [];
  const effects: EquipmentPieceInput['effects'] = Object.entries(equipment)
    .flatMap(([key, rawValue]) => {
      const value = typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : 0;
      if (value === 0) return [];
      const typedKey = key as keyof EquipmentConfig;
      const unit: 'flat' | 'percent' = isPercentField(typedKey) ? 'percent' : 'flat';
      return [{
        effectId: key,
        label: key,
        typeKey: key,
        level: 'legacy',
        value,
        unit,
        raw: key,
      }];
    });
  return effects.length > 0
    ? [{
      slotKey: 'legacy',
      equipmentId: 'legacy-equipment',
      name: '兼容装备面板',
      part: '',
      effects,
    }]
    : [];
}

function buildEquipmentSetBuffsForSnapshot(
  snapshot: ConfigSnapshot | undefined,
  equipmentLibrary: EquipmentLibrary | null,
): EquipmentSetBuffInput[] {
  if (!snapshot || !equipmentLibrary) return snapshot?.equipment.setBuffs ?? [];
  const selectedEquipmentIds = snapshot.equipment.pieces
    .map((piece) => piece.equipmentId)
    .filter((equipmentId) => equipmentId.length > 0);
  if (selectedEquipmentIds.length < 3) return [];

  return Object.values(equipmentLibrary.gearSets).flatMap((gearSet) => {
    const setEquipmentIds = new Set(
      Object.entries(gearSet.equipments).flatMap(([equipmentId, equipment]) => [equipmentId, equipment.equipmentId]),
    );
    const selectedCount = selectedEquipmentIds.filter((equipmentId) => setEquipmentIds.has(equipmentId)).length;
    if (selectedCount < 3) return [];
    return Object.values(gearSet.threePieceBuffs ?? {})
      .filter((buff) => buff.effectKind === 'extraHit' || buff.typeKey.trim().length > 0)
      .map((buff) => ({
        effectId: buff.effectId,
        label: buff.name || buff.effectId,
        typeKey: buff.typeKey,
        level: '三件套',
        value: buff.value,
        unit: buff.unit,
        raw: buff.raw,
        gearSetId: gearSet.gearSetId,
        gearSetName: gearSet.name,
        category: buff.category,
        valueMode: buff.valueMode,
        derivedValue: buff.derivedValue,
        maxStacks: buff.maxStacks,
        multiplier: buff.multiplier,
        effectKind: buff.effectKind,
        extraHitConfig: buff.extraHitConfig,
      }));
  });
}

function createEmptyOperatorBuffs(): OperatorBuffInput {
  return {
    talent: { effects: {} },
    potential: { effects: {} },
    skill: { effects: {} },
  };
}

function normalizeOperatorBuffInput(value: unknown): OperatorBuffInput {
  const source = value as Partial<OperatorBuffInput> | undefined;
  return {
    talent: { effects: { ...(source?.talent?.effects ?? {}) } },
    potential: { effects: { ...(source?.potential?.effects ?? {}) } },
    skill: { effects: { ...(source?.skill?.effects ?? {}) } },
  } as OperatorBuffInput;
}

function inferOperatorBuffGroup(buff: CandidateBuff): keyof OperatorBuffInput {
  if (buff.ownerBuffGroup === 'talent' || buff.ownerBuffGroup === 'potential' || buff.ownerBuffGroup === 'skill') {
    return buff.ownerBuffGroup;
  }
  const text = [buff.source, buff.sourceName, buff.level, buff.displayName, buff.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (text.includes('potential') || text.includes('potentials') || text.includes('潜能')) return 'potential';
  if (text.includes('skill') || text.includes('技能')) return 'skill';
  return 'talent';
}

function normalizePublicBuffCategory(category: CandidateBuff['category']): OperatorBuffEffectInput['category'] {
  if (category === 'passive' || category === 'countable' || category === 'condition') return category;
  return 'condition';
}

function normalizePublicBuffEffect(buff: CandidateBuff, index: number): OperatorBuffEffectInput | null {
  const normalized = normalizeStoredBuffDefinition(buff) as CandidateBuff;
  const effectKind = normalized.effectKind === 'extraHit' ? 'extraHit' : 'modifier';
  const type = effectKind === 'extraHit' ? '' : String(normalized.type || '');
  if (effectKind === 'modifier' && !type) return null;
  return {
    schemaVersion: 2,
    effectId: normalized.name || normalized.displayName || `json-buff-${index + 1}`,
    name: normalized.name || normalized.displayName || `json-buff-${index + 1}`,
    type,
    category: normalizePublicBuffCategory(normalized.category),
    value: effectKind === 'extraHit' ? undefined : normalized.value,
    maxStacks: normalized.maxStacks,
    unit: 'unit' in normalized ? String((normalized as CandidateBuff & { unit?: string }).unit) : undefined,
    description: normalized.description,
    raw: normalized.condition || normalized.sourceName,
    valueMode: normalized.valueMode,
    derivedValue: normalized.derivedValue,
    effectKind,
    multiplier: normalized.multiplier,
    ...(effectKind === 'extraHit'
      ? { extraHitConfig: normalizeExtraHitConfig(normalized.extraHitConfig, `${normalized.name || index}-extra-hit`) }
      : {}),
  };
}

async function loadPublicOperatorBuffs(character: Character): Promise<OperatorBuffInput> {
  const data = await loadPublicJson<BuffData>(`data/characters/${character.name}/${character.name}buff.json`);
  const result = createEmptyOperatorBuffs();
  (data?.buffs ?? []).forEach((buff, index) => {
    const effect = normalizePublicBuffEffect(buff, index);
    if (!effect) return;
    const groupKey = inferOperatorBuffGroup(buff);
    const effectKey = `${effect.effectId}:${index}`;
    result[groupKey].effects[effectKey] = effect;
  });
  return result;
}

function mergeOperatorBuffs(...groups: OperatorBuffInput[]): OperatorBuffInput {
  const merged = createEmptyOperatorBuffs();
  (['talent', 'potential', 'skill'] as const).forEach((groupKey) => {
    groups.forEach((group) => {
      Object.assign(merged[groupKey].effects, group[groupKey]?.effects ?? {});
    });
  });
  return merged;
}

async function buildOperatorBuffs(character: Character, snapshot: ConfigSnapshot | undefined): Promise<OperatorBuffInput> {
  const sourceBuffs = normalizeOperatorBuffInput(character.operatorBuffs ?? snapshot?.operator.buffs);
  const publicBuffs = await loadPublicOperatorBuffs(character);
  return mergeOperatorBuffs(sourceBuffs, publicBuffs);
}

function resolveWeaponName(snapshot: ConfigSnapshot | undefined, legacyConfig: CharacterConfigJson | undefined): string {
  const snapshotWeaponName = snapshot?.weapon.name || snapshot?.weapon.id || '';
  if (snapshotWeaponName) return snapshotWeaponName;
  const legacyWeaponName = legacyConfig?.weaponName || '';
  return legacyWeaponName === '无' ? '' : legacyWeaponName;
}

function buildSkillConfig(snapshot: ConfigSnapshot | undefined, legacyConfig: CharacterConfigJson | undefined): Record<OperatorSkillKey, string> {
  return {
    ...DEFAULT_OPERATOR_SKILL_CONFIG,
    ...(legacyConfig?.skillLevelModeMap ?? {}),
    ...(snapshot?.operator.skillConfig ?? {}),
    Dot: DEFAULT_OPERATOR_SKILL_CONFIG.Dot,
  };
}

function buildWeaponConfig(snapshot: ConfigSnapshot | undefined, legacyConfig: CharacterConfigJson | undefined) {
  if (snapshot?.weapon.config) {
    return snapshot.weapon.config;
  }
  const potential = legacyWeaponPotential(legacyConfig?.weaponPotentialMode);
  return {
    level: 90,
    potential,
    skillLevels: {
      skill1: DEFAULT_WEAPON_SKILL_LEVELS.skill1,
      skill2: DEFAULT_WEAPON_SKILL_LEVELS.skill2,
      skill3: DEFAULT_WEAPON_SKILL_LEVELS.skill3 + getWeaponSkill3PotentialBonus(potential),
    },
  };
}

async function buildSnapshotForCharacter(
  character: Character,
  snapshot: ConfigSnapshot | undefined,
  legacyConfig: CharacterConfigJson | undefined,
  weaponLibrary: WeaponLibrary,
  equipmentLibrary: EquipmentLibrary | null,
): Promise<ConfigSnapshot | null> {
  const weaponName = resolveWeaponName(snapshot, legacyConfig);
  const loadedWeaponData = weaponName ? resolveWeaponData(weaponName, weaponLibrary) : null;
  const fallbackWeaponData = buildWeaponDataFromSnapshot(snapshot);
  const weaponData = loadedWeaponData ?? fallbackWeaponData;
  const characterPotential = normalizePotentialForCalculator(
    snapshot?.operator.potential ?? legacyConfig?.characterPotential ?? defaultCharacterPotential(character),
  );
  const equipmentPieces = snapshot
    ? buildEquipmentPiecesFromSnapshot(snapshot, equipmentLibrary)
    : buildEquipmentPiecesFromLegacyConfig(legacyConfig);
  const input: OperatorPanelInput = {
    operator: {
      id: character.id,
      name: character.name,
      level: snapshot?.operator.level ?? 90,
      potential: characterPotential,
      element: character.element,
      mainStat: character.mainStat,
      subStat: character.subStat,
      mainStatFlatBonus: snapshot?.operator.mainStatFlatBonus ?? 60,
      subStatFlatBonus: snapshot?.operator.subStatFlatBonus ?? 0,
      skillConfig: buildSkillConfig(snapshot, legacyConfig),
      attributes: character.attributes,
      buffs: await buildOperatorBuffs(character, snapshot),
    },
    weapon: {
      id: weaponName,
      name: weaponData?.name || weaponName,
      config: buildWeaponConfig(snapshot, legacyConfig),
      data: {
        attackGrowth: weaponData?.attackGrowth ?? {},
        skills: weaponData?.skills ?? {},
      },
    },
    equipment: {
      pieces: equipmentPieces,
      setBuffs: buildEquipmentSetBuffsForSnapshot(snapshot, equipmentLibrary),
    },
  };
  return buildConfigSnapshot(input);
}

export async function refreshOperatorConfigSnapshotsForCharacters(
  characters: Character[],
): Promise<OperatorConfigSnapshotRefreshResult> {
  const uniqueCharacters = Array.from(
    new Map(characters.filter((character) => character.id).map((character) => [character.id, character])).values(),
  );
  const currentCache = getOperatorConfigPageCache();
  const legacyConfigMap = getCharacterConfigMap();
  const weaponLibrary = normalizeWeaponLibrary(readLocalStorageJson(WEAPON_LIBRARY_STORAGE_KEY, {}));
  const equipmentLibrary = readEquipmentLibraryFromStorage();
  const nextCache: OperatorConfigPageCache = { ...currentCache };
  const refreshedCharacterIds: string[] = [];
  const skippedCharacterIds: string[] = [];

  const entries = await Promise.all(
    uniqueCharacters.map(async (character) => {
      const legacyConfig =
        legacyConfigMap[character.id] ??
        Object.values(legacyConfigMap).find((config) => config.characterName === character.name);
      const snapshot = currentCache[character.id];
      const nextSnapshot = await buildSnapshotForCharacter(character, snapshot, legacyConfig, weaponLibrary, equipmentLibrary);
      return { character, nextSnapshot };
    }),
  );

  entries.forEach(({ character, nextSnapshot }) => {
    if (!nextSnapshot) {
      skippedCharacterIds.push(character.id);
      return;
    }
    nextCache[character.id] = nextSnapshot;
    refreshedCharacterIds.push(character.id);
  });

  if (refreshedCharacterIds.length > 0) {
    setOperatorConfigPageCache(nextCache);
  }

  return {
    refreshedCharacterIds,
    skippedCharacterIds,
    cache: nextCache,
  };
}
