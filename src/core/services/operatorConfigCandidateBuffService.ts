import type { ConfigSnapshot, WeaponSkillDetail } from '../calculators/operatorPanelCalculator';
import type { BuffEffectKind, BuffExtraHitConfig, BuffMultiplier, CandidateBuff } from '../domain/buff';
import { getCandidateBuffList, getOperatorConfigPageCache, setCandidateBuffList } from '../repositories';
import { resolvePublicPath } from '../../utils/assetResolver';
import { normalizeExtraHitConfig } from './buffExtraHit';
import { normalizeStoredBuffDefinition } from './buffStorageNormalization';

interface EquipmentThreePieceBuffLike {
  effectId?: string;
  name?: string;
  category?: string;
  typeKey?: string;
  value?: number;
  raw?: string;
  effectKind?: BuffEffectKind;
  extraHitConfig?: BuffExtraHitConfig;
  multiplier?: BuffMultiplier;
}

interface EquipmentItemLike {
  equipmentId?: string;
}

interface EquipmentGearSetLike {
  gearSetId?: string;
  name?: string;
  threePieceBuff?: EquipmentThreePieceBuffLike;
  threePieceBuffs?: Record<string, EquipmentThreePieceBuffLike>;
  equipments?: Record<string, EquipmentItemLike>;
}

interface EquipmentLibraryLike {
  gearSets?: Record<string, EquipmentGearSetLike>;
}

interface SnapshotCandidateCharacterRef {
  id: string;
  name: string;
}

const EQUIPMENT_LIBRARY_PATH = 'data/equipments/equipments.json';
const EQUIPMENT_DRAFT_STORAGE_KEY = 'def.equipment-sheet.draft.v1';

function normalizeBuffTypeKey(typeKey: string): string {
  if (typeKey === 'atk') return 'flatAtk';
  if (typeKey === 'allElementDmgBonus') return 'magicDmgBonus';
  if (typeKey === 'multiplierMultiplier') return 'multiplierBonus';
  return typeKey;
}

function readLocalStorageJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function loadEquipmentLibraryForBuffs(): Promise<EquipmentLibraryLike> {
  const localDraft = readLocalStorageJson<EquipmentLibraryLike | null>(EQUIPMENT_DRAFT_STORAGE_KEY, null);
  if (localDraft?.gearSets) {
    return localDraft;
  }

  try {
    const response = await fetch(resolvePublicPath(EQUIPMENT_LIBRARY_PATH));
    if (!response.ok) return { gearSets: {} };
    return await response.json() as EquipmentLibraryLike;
  } catch {
    return { gearSets: {} };
  }
}

function candidateKey(buff: CandidateBuff): string {
  return [
    buff.source,
    buff.sourceName,
    buff.name,
    buff.level,
    buff.type ?? '',
    buff.value ?? '',
    buff.condition ?? '',
    buff.origin ?? '',
    buff.ownerBuffDomain ?? '',
    buff.ownerCharacterId ?? '',
    buff.ownerBuffGroup ?? '',
    buff.effectKind ?? 'modifier',
    buff.extraHitConfig ? JSON.stringify(buff.extraHitConfig) : '',
    buff.multiplier?.coefficient ?? '',
  ].join('|');
}

export function mergeCandidateBuffs(...groups: CandidateBuff[][]): CandidateBuff[] {
  const seen = new Set<string>();
  return groups.flat().filter((buff) => {
    const key = candidateKey(buff);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildSnapshotCandidateBase(snapshot: ConfigSnapshot): Pick<CandidateBuff, 'origin' | 'ownerCharacterId'> {
  return {
    origin: 'operatorConfigSnapshot',
    ownerCharacterId: snapshot.operator.id,
  };
}

function buildOperatorBuffCandidate(
  snapshot: ConfigSnapshot,
  groupKey: 'talent' | 'potential' | 'skill',
  effectKey: string,
  effect: ConfigSnapshot['operator']['buffs'][typeof groupKey]['effects'][string]
): CandidateBuff | null {
  const normalizedEffect = normalizeStoredBuffDefinition(effect) as typeof effect & {
    multiplier?: BuffMultiplier;
  };
  const effectKind = normalizedEffect.effectKind === 'extraHit' ? 'extraHit' : 'modifier';
  const category = normalizedEffect.category === 'countable'
    ? 'countable'
    : normalizedEffect.category === 'condition'
      ? 'condition'
      : 'passive';
  if (effectKind === 'modifier' && category === 'passive') return null;
  const type = normalizeBuffTypeKey(normalizedEffect.type || '');
  if (effectKind === 'modifier' && !type) return null;
  const sourceName = snapshot.operator.name || snapshot.operator.id;
  return {
    origin: 'operatorStudio',
    ownerBuffDomain: 'operator',
    ownerCharacterId: snapshot.operator.id,
    ownerBuffGroup: groupKey,
    displayName: normalizedEffect.name || effectKey,
    name: `operator-studio:${snapshot.operator.id}:${groupKey}:${normalizedEffect.effectId || effectKey}`,
    level: groupKey,
    value: effectKind === 'extraHit' ? undefined : normalizedEffect.value,
    type: effectKind === 'extraHit' ? undefined : type,
    source: sourceName,
    sourceName,
    description: normalizedEffect.description || normalizedEffect.raw || `${normalizedEffect.name || effectKey} ${normalizedEffect.value ?? ''}`.trim(),
    condition: category === 'condition' ? 'condition' : category === 'countable' ? 'countable' : 'passive',
    category,
    ...(category === 'countable' && typeof normalizedEffect.maxStacks === 'number' && Number.isFinite(normalizedEffect.maxStacks)
      ? { maxStacks: Math.max(1, Math.floor(normalizedEffect.maxStacks)) }
      : {}),
    ...(effectKind === 'modifier' && normalizedEffect.multiplier
      ? { multiplier: normalizedEffect.multiplier }
      : {}),
    valueMode: normalizedEffect.valueMode,
    derivedValue: normalizedEffect.derivedValue,
    effectKind,
    ...(effectKind === 'extraHit'
      ? { extraHitConfig: normalizeExtraHitConfig(normalizedEffect.extraHitConfig, `${normalizedEffect.effectId || effectKey}-extra-hit`) }
      : {}),
  };
}

export function buildSnapshotOperatorCandidateBuffs(snapshot: ConfigSnapshot): CandidateBuff[] {
  const buffs = snapshot.operator.buffs ?? {
    talent: { effects: {} },
    potential: { effects: {} },
    skill: { effects: {} },
  };
  return (['talent', 'potential', 'skill'] as const).flatMap((groupKey) => (
    Object.entries(buffs[groupKey]?.effects || {})
      .map(([effectKey, effect]) => buildOperatorBuffCandidate(snapshot, groupKey, effectKey, effect))
      .filter((buff): buff is CandidateBuff => Boolean(buff))
  ));
}

function buildWeaponDetailCandidate(snapshot: ConfigSnapshot, detail: WeaponSkillDetail, index: number): CandidateBuff | null {
  const normalizedDetail = normalizeStoredBuffDefinition({
    ...detail,
    type: detail.typeKey,
  }) as WeaponSkillDetail & { type: string; multiplier?: BuffMultiplier };
  const effectKind = normalizedDetail.effectKind === 'extraHit' ? 'extraHit' : 'modifier';
  if (effectKind === 'modifier' && normalizedDetail.category === 'passive') return null;
  const type = normalizeBuffTypeKey(normalizedDetail.type);
  if (effectKind === 'modifier' && !type) return null;
  const sourceName = snapshot.weapon.name || snapshot.weapon.id || snapshot.operator.name;
  return {
    ...buildSnapshotCandidateBase(snapshot),
    ownerBuffDomain: 'weapon',
    ownerBuffGroup: 'weaponSkill',
    displayName: normalizedDetail.label || `${sourceName} skill3 effect ${index + 1}`,
    name: `operator-config-snapshot:${snapshot.operator.id}:weapon:${snapshot.weapon.id || sourceName}:skill3:${normalizedDetail.effectKey || index + 1}`,
    level: `Lv${normalizedDetail.level}`,
    value: effectKind === 'extraHit' ? undefined : normalizedDetail.value,
    type: effectKind === 'extraHit' ? undefined : type,
    source: sourceName,
    sourceName,
    description: `${normalizedDetail.label || normalizedDetail.type} ${normalizedDetail.value ?? ''}`.trim(),
    condition: effectKind === 'extraHit' ? 'passive' : normalizedDetail.category || 'condition',
    category: effectKind === 'extraHit' ? 'passive' : 'condition',
    ...(effectKind === 'modifier' && normalizedDetail.multiplier
      ? { multiplier: normalizedDetail.multiplier }
      : {}),
    effectKind,
    ...(effectKind === 'extraHit'
      ? { extraHitConfig: normalizeExtraHitConfig({ ...normalizedDetail.extraHitConfig, baseMultiplier: normalizedDetail.value }, `${normalizedDetail.effectKey || index + 1}-extra-hit`) }
      : {}),
  };
}

export function buildSnapshotWeaponCandidateBuffs(snapshot: ConfigSnapshot): CandidateBuff[] {
  return snapshot.weapon.skills.skill3.effects
    .map((detail, index) => buildWeaponDetailCandidate(snapshot, detail, index))
    .filter((buff): buff is CandidateBuff => Boolean(buff));
}

function getThreePieceBuffEntries(gearSet: EquipmentGearSetLike): EquipmentThreePieceBuffLike[] {
  const entries = Object.values(gearSet.threePieceBuffs || {});
  if (entries.length > 0) return entries;
  return gearSet.threePieceBuff ? [gearSet.threePieceBuff] : [];
}

export function buildSnapshotEquipmentCandidateBuffs(snapshot: ConfigSnapshot, equipmentLibrary: EquipmentLibraryLike): CandidateBuff[] {
  const selectedEquipmentIds = snapshot.equipment.pieces
    .map((piece) => piece.equipmentId)
    .filter((equipmentId) => equipmentId.length > 0);
  if (selectedEquipmentIds.length < 3) return [];

  return Object.entries(equipmentLibrary.gearSets || {}).flatMap(([fallbackSetId, gearSet]) => {
    const setEquipmentIds = Object.values(gearSet.equipments || {})
      .map((equipment) => equipment.equipmentId)
      .filter((equipmentId): equipmentId is string => Boolean(equipmentId));
    const selectedCount = selectedEquipmentIds.filter((equipmentId) => setEquipmentIds.includes(equipmentId)).length;
    if (selectedCount < 3) return [];

    const sourceName = gearSet.name || gearSet.gearSetId || fallbackSetId;
    return getThreePieceBuffEntries(gearSet)
      .map((buff, index): CandidateBuff | null => {
        const normalizedBuff = normalizeStoredBuffDefinition({
          ...buff,
          type: buff.typeKey,
        }) as EquipmentThreePieceBuffLike & { type: string };
        const effectKind = normalizedBuff.effectKind === 'extraHit' ? 'extraHit' : 'modifier';
        if (effectKind === 'modifier' && normalizedBuff.category !== 'condition') return null;
        const type = normalizeBuffTypeKey(normalizedBuff.type || '');
        const hasValue = typeof normalizedBuff.value === 'number' && Number.isFinite(normalizedBuff.value);
        if (effectKind === 'modifier' && (!type || (!hasValue && !normalizedBuff.multiplier))) return null;
        return {
          ...buildSnapshotCandidateBase(snapshot),
          ownerBuffDomain: 'equipment',
          ownerBuffGroup: 'threePiece',
          displayName: normalizedBuff.name || `${sourceName} 三件套效果 ${index + 1}`,
          name: `operator-config-snapshot:${snapshot.operator.id}:equipment:${gearSet.gearSetId || fallbackSetId}:${normalizedBuff.effectId || index + 1}`,
          level: '三件套',
          value: effectKind === 'extraHit' ? undefined : normalizedBuff.value,
          type: effectKind === 'extraHit' ? undefined : type,
          source: sourceName,
          sourceName,
          description: normalizedBuff.raw || `${normalizedBuff.name || type} ${normalizedBuff.value ?? ''}`.trim(),
          condition: effectKind === 'extraHit' ? 'passive' : normalizedBuff.category === 'condition' ? '三件套条件效果' : undefined,
          category: effectKind === 'extraHit' ? 'passive' : 'condition',
          ...(effectKind === 'modifier' && normalizedBuff.multiplier
            ? { multiplier: normalizedBuff.multiplier }
            : {}),
          effectKind,
          ...(effectKind === 'extraHit'
            ? { extraHitConfig: normalizeExtraHitConfig(normalizedBuff.extraHitConfig, `${normalizedBuff.effectId || index + 1}-extra-hit`) }
            : {}),
        };
      })
      .filter((buff): buff is CandidateBuff => Boolean(buff));
  });
}

export async function buildSnapshotCandidateBuffs(characters: SnapshotCandidateCharacterRef[]): Promise<CandidateBuff[]> {
  const snapshotCache = getOperatorConfigPageCache();
  const equipmentLibrary = await loadEquipmentLibraryForBuffs();
  return characters.flatMap((character) => {
    const snapshot = snapshotCache[character.id];
    if (!snapshot) return [];
    return [
      ...buildSnapshotOperatorCandidateBuffs(snapshot),
      ...buildSnapshotWeaponCandidateBuffs(snapshot),
      ...buildSnapshotEquipmentCandidateBuffs(snapshot, equipmentLibrary),
    ];
  });
}

function isSnapshotCandidateOwnedBy(buff: CandidateBuff, characterIds: Set<string>): boolean {
  if ((buff.origin === 'operatorConfigSnapshot' || buff.origin === 'operatorStudio') && buff.ownerCharacterId) {
    return characterIds.has(buff.ownerCharacterId);
  }
  if (buff.name.startsWith('operator-config-snapshot:')) {
    const [, characterId] = buff.name.split(':');
    return characterIds.has(characterId);
  }
  return false;
}

export function retainCandidateBuffsNotOwnedByCharacterIds(buffs: CandidateBuff[], characterIds: string[]): CandidateBuff[] {
  const characterIdSet = new Set(characterIds.filter(Boolean));
  return buffs.filter((buff) => !isSnapshotCandidateOwnedBy(buff, characterIdSet));
}

export async function refreshSnapshotCandidateBuffsForCharacterIds(characterIds: string[]): Promise<CandidateBuff[]> {
  const uniqueCharacterIds = Array.from(new Set(characterIds.filter(Boolean)));
  const snapshotCache = getOperatorConfigPageCache();
  const characters = uniqueCharacterIds
    .filter((characterId) => snapshotCache[characterId])
    .map((characterId) => ({
      id: characterId,
      name: snapshotCache[characterId].operator.name || characterId,
    }));
  const snapshotBuffs = await buildSnapshotCandidateBuffs(characters);
  const retainedBuffs = retainCandidateBuffsNotOwnedByCharacterIds(getCandidateBuffList(), uniqueCharacterIds);
  const allBuffs = mergeCandidateBuffs(retainedBuffs, snapshotBuffs);
  setCandidateBuffList(allBuffs);
  return allBuffs;
}
