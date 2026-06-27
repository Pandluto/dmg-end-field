import type { ConfigSnapshot, WeaponSkillDetail } from '../calculators/operatorPanelCalculator';
import type { BuffData, BuffEffectKind, BuffExtraHitConfig, BuffMultiplier, CandidateBuff } from '../domain/buff';
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
  valueMode?: 'fixed' | 'derived';
  derivedValue?: {
    source: 'hp' | 'atk' | 'strength' | 'agility' | 'intelligence' | 'will' | 'sourceSkill';
    perPointValue: number;
  };
  maxStacks?: number;
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

type CandidateContentDomain = 'operator' | 'weapon';

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
    buff.category ?? '',
    buff.maxStacks ?? '',
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

function uniqueCharacterRefs(characters: SnapshotCandidateCharacterRef[]): SnapshotCandidateCharacterRef[] {
  const seen = new Set<string>();
  return characters.filter((character) => {
    const id = character.id?.trim();
    if (!id || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

async function loadPublicBuffData(path: string): Promise<BuffData | null> {
  try {
    const response = await fetch(resolvePublicPath(path));
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as BuffData;
  } catch (error) {
    console.warn('加载可用 Buff 数据失败:', path, error);
    return null;
  }
}

function normalizeJsonCandidateCategory(category: CandidateBuff['category']): CandidateBuff['category'] {
  if (category === 'passive' || category === 'countable' || category === 'condition') {
    return category;
  }
  return 'condition';
}

function inferOperatorJsonBuffGroup(buff: CandidateBuff): CandidateBuff['ownerBuffGroup'] {
  if (buff.ownerBuffGroup) {
    return buff.ownerBuffGroup;
  }
  const text = [
    buff.name,
    buff.displayName,
    buff.level,
    buff.source,
    buff.sourceName,
    buff.condition,
    buff.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (text.includes('potential') || text.includes('potentials') || text.includes('潜能')) {
    return 'potential';
  }
  if (text.includes('talent') || text.includes('天赋')) {
    return 'talent';
  }
  if (text.includes('skill') || text.includes('技能')) {
    return 'skill';
  }
  return 'talent';
}

function normalizeJsonCandidateBuff(
  rawBuff: CandidateBuff,
  options: {
    character: SnapshotCandidateCharacterRef;
    domain: CandidateContentDomain;
    ownerName: string;
    index: number;
  },
): CandidateBuff | null {
  const normalized = normalizeStoredBuffDefinition(rawBuff) as CandidateBuff & {
    multiplier?: BuffMultiplier;
    extraHitConfig?: BuffExtraHitConfig;
  };
  const effectKind: BuffEffectKind = normalized.effectKind === 'extraHit' ? 'extraHit' : 'modifier';
  const type = effectKind === 'extraHit' ? undefined : normalizeBuffTypeKey(normalized.type || '');
  if (effectKind === 'modifier' && !type) {
    return null;
  }
  const category = normalizeJsonCandidateCategory(normalized.category);
  const fallbackName = `${options.domain}-json:${options.character.id}:${options.index + 1}`;
  const sourceName = normalized.sourceName || normalized.source || options.ownerName;
  return {
    ...normalized,
    origin: normalized.origin ?? 'json',
    ownerBuffDomain: options.domain,
    ownerCharacterId: options.character.id,
    ownerBuffGroup:
      normalized.ownerBuffGroup ??
      (options.domain === 'operator' ? inferOperatorJsonBuffGroup(normalized) : 'weaponSkill'),
    displayName: normalized.displayName || normalized.name || `${options.ownerName} Buff ${options.index + 1}`,
    name: normalized.name || fallbackName,
    level: normalized.level || '',
    value: effectKind === 'extraHit' ? undefined : normalized.value,
    type,
    source: options.ownerName,
    sourceName,
    description: normalized.description || '',
    condition: normalized.condition || (category === 'condition' ? 'condition' : category),
    category,
    effectKind,
    multiplier: effectKind === 'modifier' ? normalized.multiplier : undefined,
    extraHitConfig:
      effectKind === 'extraHit'
        ? normalizeExtraHitConfig(
          normalized.extraHitConfig,
          `${options.domain}-json:${options.character.id}:${normalized.name || options.index}`,
        )
        : undefined,
  };
}

async function buildCharacterJsonCandidateBuffs(characters: SnapshotCandidateCharacterRef[]): Promise<CandidateBuff[]> {
  const lists = await Promise.all(
    uniqueCharacterRefs(characters).map(async (character) => {
      const data = await loadPublicBuffData(`data/characters/${character.name}/${character.name}buff.json`);
      const buffs = Array.isArray(data?.buffs) ? data.buffs : [];
      return buffs
        .map((buff, index) =>
          normalizeJsonCandidateBuff(buff, {
            character,
            domain: 'operator',
            ownerName: character.name,
            index,
          }),
        )
        .filter((buff): buff is CandidateBuff => Boolean(buff));
    }),
  );
  return lists.flat();
}

async function buildWeaponJsonCandidateBuffs(characters: SnapshotCandidateCharacterRef[]): Promise<CandidateBuff[]> {
  const snapshotCache = getOperatorConfigPageCache();
  const lists = await Promise.all(
    uniqueCharacterRefs(characters).map(async (character) => {
      const snapshot = snapshotCache[character.id];
      const weaponName = snapshot?.weapon?.name?.trim() || snapshot?.weapon?.id?.trim();
      if (!weaponName) {
        return [];
      }
      let data = await loadPublicBuffData(`data/weapons/${weaponName}/${weaponName}buff.json`);
      if (!data && weaponName.includes('.')) {
        data = await loadPublicBuffData(`data/weapons/${weaponName}/${weaponName}.buff.json`);
      }
      const buffs = Array.isArray(data?.buffs) ? data.buffs : [];
      return buffs
        .map((buff, index) =>
          normalizeJsonCandidateBuff(buff, {
            character,
            domain: 'weapon',
            ownerName: weaponName,
            index,
          }),
        )
        .filter((buff): buff is CandidateBuff => Boolean(buff));
    }),
  );
  return lists.flat();
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
  if (effectKind === 'modifier' && category === 'passive' && !normalizedEffect.multiplier) return null;
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
  const category = normalizedDetail.category === 'countable'
    ? 'countable'
    : normalizedDetail.category === 'passive'
      ? 'passive'
      : 'condition';
  if (effectKind === 'modifier' && category === 'passive' && !normalizedDetail.multiplier) return null;
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
    condition: category === 'condition' ? 'condition' : category === 'countable' ? 'countable' : 'passive',
    category,
    ...(effectKind === 'modifier' && normalizedDetail.multiplier
      ? { multiplier: normalizedDetail.multiplier }
      : {}),
    ...(category === 'countable' && normalizedDetail.maxStacks
      ? { maxStacks: normalizedDetail.maxStacks }
      : {}),
    valueMode: normalizedDetail.valueMode,
    derivedValue: normalizedDetail.derivedValue,
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
    const setEquipmentIds = Object.entries(gearSet.equipments || {})
      .flatMap(([equipmentKey, equipment]) => [equipmentKey, equipment.equipmentId])
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
        const category = normalizedBuff.category === 'countable' ? 'countable' : normalizedBuff.category === 'condition' ? 'condition' : 'passive';
        if (effectKind === 'modifier' && category === 'passive' && !normalizedBuff.multiplier) return null;
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
          condition: category === 'condition' ? '三件套条件效果' : category,
          category,
          ...(category === 'countable' && normalizedBuff.maxStacks
            ? { maxStacks: normalizedBuff.maxStacks }
            : {}),
          ...(effectKind === 'modifier' && normalizedBuff.multiplier
            ? { multiplier: normalizedBuff.multiplier }
            : {}),
          valueMode: normalizedBuff.valueMode,
          derivedValue: normalizedBuff.derivedValue,
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

function isAvailableCandidateOwnedBy(buff: CandidateBuff, characterIds: Set<string>): boolean {
  if (!buff.ownerCharacterId || !characterIds.has(buff.ownerCharacterId)) {
    return false;
  }
  return (
    buff.origin === 'operatorConfigSnapshot' ||
    buff.origin === 'operatorStudio' ||
    buff.origin === 'json' ||
    buff.name.startsWith('operator-config-snapshot:') ||
    buff.name.startsWith('operator-studio:') ||
    buff.name.startsWith('operator-json:') ||
    buff.name.startsWith('weapon-json:')
  );
}

function retainAvailableCandidateBuffsNotOwnedByCharacterIds(
  buffs: CandidateBuff[],
  characterIds: string[],
): CandidateBuff[] {
  const characterIdSet = new Set(characterIds.filter(Boolean));
  return buffs.filter((buff) => !isAvailableCandidateOwnedBy(buff, characterIdSet));
}

export async function refreshAvailableCandidateBuffsForCharacters(
  characters: SnapshotCandidateCharacterRef[],
): Promise<CandidateBuff[]> {
  const uniqueCharacters = uniqueCharacterRefs(characters);
  const uniqueCharacterIds = uniqueCharacters.map((character) => character.id);
  const [snapshotBuffs, characterJsonBuffs, weaponJsonBuffs] = await Promise.all([
    buildSnapshotCandidateBuffs(uniqueCharacters),
    buildCharacterJsonCandidateBuffs(uniqueCharacters),
    buildWeaponJsonCandidateBuffs(uniqueCharacters),
  ]);
  const retainedBuffs = retainAvailableCandidateBuffsNotOwnedByCharacterIds(getCandidateBuffList(), uniqueCharacterIds);
  const allBuffs = mergeCandidateBuffs(retainedBuffs, characterJsonBuffs, snapshotBuffs, weaponJsonBuffs);
  setCandidateBuffList(allBuffs);
  return allBuffs;
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
