import type { ConfigSnapshot, WeaponSkillDetail } from '../calculators/operatorPanelCalculator';
import type { CandidateBuff } from '../domain/buff';
import { getCandidateBuffList, setCandidateBuffList } from '../repositories';
import { resolvePublicPath } from '../../utils/assetResolver';
import { getOperatorConfigPageCache } from '../../utils/storage';

interface EquipmentThreePieceBuffLike {
  effectId?: string;
  name?: string;
  category?: string;
  typeKey?: string;
  value?: number;
  raw?: string;
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
  if (typeKey === 'allElementDmgBonus') return 'magicDmgBonus';
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
    buff.ownerCharacterId ?? '',
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
  const type = normalizeBuffTypeKey(effect.type || '');
  if (!type) return null;
  const sourceName = snapshot.operator.name || snapshot.operator.id;
  return {
    origin: 'operatorStudio',
    ownerCharacterId: snapshot.operator.id,
    ownerBuffGroup: groupKey,
    displayName: effect.name || effectKey,
    name: `operator-studio:${snapshot.operator.id}:${groupKey}:${effect.effectId || effectKey}`,
    level: groupKey,
    value: effect.value,
    type,
    source: sourceName,
    sourceName,
    description: effect.description || effect.raw || `${effect.name || effectKey} ${effect.value ?? ''}`.trim(),
    condition: effect.category === 'condition' ? 'condition' : 'positive',
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
  if (detail.category === 'passive') return null;
  const type = normalizeBuffTypeKey(detail.typeKey);
  if (!type) return null;
  const sourceName = snapshot.weapon.name || snapshot.weapon.id || snapshot.operator.name;
  return {
    ...buildSnapshotCandidateBase(snapshot),
    displayName: detail.label || `${sourceName} skill3 effect ${index + 1}`,
    name: `operator-config-snapshot:${snapshot.operator.id}:weapon:${snapshot.weapon.id || sourceName}:skill3:${detail.effectKey || index + 1}`,
    level: `Lv${detail.level}`,
    value: detail.value,
    type,
    source: sourceName,
    sourceName,
    description: `${detail.label || detail.typeKey} ${detail.value}`,
    condition: detail.category || 'condition',
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
        if (buff.category !== 'condition') return null;
        const type = normalizeBuffTypeKey(buff.typeKey || '');
        if (!type || typeof buff.value !== 'number' || !Number.isFinite(buff.value)) return null;
        return {
          ...buildSnapshotCandidateBase(snapshot),
          displayName: buff.name || `${sourceName} 三件套效果 ${index + 1}`,
          name: `operator-config-snapshot:${snapshot.operator.id}:equipment:${gearSet.gearSetId || fallbackSetId}:${buff.effectId || index + 1}`,
          level: '三件套',
          value: buff.value,
          type,
          source: sourceName,
          sourceName,
          description: buff.raw || `${buff.name || type} ${buff.value}`,
          condition: buff.category === 'condition' ? '三件套条件效果' : undefined,
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
