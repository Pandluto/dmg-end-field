import type { BuffEffectKind, BuffExtraHitConfig, BuffMultiplier } from '../domain/buff';
import type { EquipmentSetBuffInput } from '../calculators/operatorPanelCalculator';
import { normalizeExtraHitConfig } from './buffExtraHit';

export type EquipmentPart = '护甲' | '护手' | '配件';
export type EquipmentEffectId = 'effect1' | 'effect2' | 'effect3';
export type EquipmentLevelKey = '0' | '1' | '2' | '3';

export interface EquipmentEffect {
  effectId: EquipmentEffectId;
  label: string;
  typeKey: string;
  category: 'ability' | 'buff';
  levels: Partial<Record<EquipmentLevelKey, number>>;
  unit: 'flat' | 'percent';
  raw?: string;
}

export interface EquipmentItem {
  equipmentId: string;
  name: string;
  part: EquipmentPart;
  imgUrl?: string;
  fixedStat?: unknown;
  effects: Partial<Record<EquipmentEffectId, EquipmentEffect>>;
}

export interface EquipmentThreePieceBuff {
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
  multiplier?: BuffMultiplier;
  effectKind?: BuffEffectKind;
  extraHitConfig?: BuffExtraHitConfig;
}

export interface EquipmentGearSet {
  gearSetId: string;
  name: string;
  threePieceBuff?: EquipmentThreePieceBuff;
  threePieceBuffs?: Record<string, EquipmentThreePieceBuff>;
  equipments: Record<string, EquipmentItem>;
}

export interface EquipmentLibrary {
  gearSets: Record<string, EquipmentGearSet>;
}

function normalizeEquipmentEffectForOperatorConfig(
  effectId: EquipmentEffectId,
  lastEffectId: EquipmentEffectId | undefined,
  typeKey: string,
  unit: 'flat' | 'percent',
): { typeKey: string; unit: 'flat' | 'percent' } {
  if (effectId !== lastEffectId && typeKey === 'mainStatBoost') {
    return { typeKey: 'mainStat', unit: 'flat' };
  }
  if (effectId !== lastEffectId && typeKey === 'subStatBoost') {
    return { typeKey: 'subStat', unit: 'flat' };
  }
  return { typeKey, unit };
}

export function normalizeOperatorEquipmentLibrary(raw: unknown): EquipmentLibrary {
  const source = raw as Partial<EquipmentLibrary> | null | undefined;
  const next: EquipmentLibrary = { gearSets: {} };
  const rawGearSets = source?.gearSets && typeof source.gearSets === 'object' ? source.gearSets : {};
  Object.entries(rawGearSets).forEach(([gearSetId, rawSet]) => {
    const setValue = rawSet as Partial<EquipmentGearSet>;
    const equipments: Record<string, EquipmentItem> = {};
    const threePieceBuffs: Record<string, EquipmentThreePieceBuff> = {};
    const rawThreePieceBuffs = setValue.threePieceBuffs && typeof setValue.threePieceBuffs === 'object'
      ? setValue.threePieceBuffs
      : {};
    const normalizeThreePieceBuffCategory = (category: unknown): EquipmentThreePieceBuff['category'] => (
      category === 'positive' || category === 'passive' || category === 'condition' || category === 'countable'
        ? category
        : ''
    );
    const normalizeThreePieceBuff = (
      effectId: string,
      rawBuff: Partial<EquipmentThreePieceBuff>,
    ): EquipmentThreePieceBuff => {
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
        value: effectKind === 'extraHit' ? 0 : rawValue,
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
    Object.entries(rawThreePieceBuffs).forEach(([effectId, rawBuff]) => {
      threePieceBuffs[effectId] = normalizeThreePieceBuff(
        effectId,
        rawBuff as Partial<EquipmentThreePieceBuff>,
      );
    });
    if (setValue.threePieceBuff && Object.keys(threePieceBuffs).length === 0) {
      threePieceBuffs.effect1 = normalizeThreePieceBuff('effect1', setValue.threePieceBuff);
    }
    const rawEquipments = setValue.equipments && typeof setValue.equipments === 'object'
      ? setValue.equipments
      : {};
    Object.entries(rawEquipments).forEach(([equipmentId, rawEquipment]) => {
      const itemValue = rawEquipment as Partial<EquipmentItem>;
      const effectIds = ['effect1', 'effect2', 'effect3'] as const;
      const lastEffectId = [...effectIds].reverse().find((effectId) => Boolean(itemValue.effects?.[effectId]));
      const effects = effectIds.reduce<Partial<Record<EquipmentEffectId, EquipmentEffect>>>((acc, effectId) => {
        const rawEffect = itemValue.effects?.[effectId];
        if (!rawEffect) return acc;
        const normalizedEffect = normalizeEquipmentEffectForOperatorConfig(
          effectId,
          lastEffectId,
          String(rawEffect.typeKey || ''),
          rawEffect.unit === 'percent' ? 'percent' : 'flat',
        );
        acc[effectId] = {
          effectId,
          label: String(rawEffect.label || effectId),
          typeKey: normalizedEffect.typeKey,
          category: rawEffect.category === 'ability' ? 'ability' : 'buff',
          levels: Object.fromEntries(Object.entries(rawEffect.levels ?? {}).flatMap(([levelKey, levelValue]) => {
            const parsed = typeof levelValue === 'number' && Number.isFinite(levelValue) ? levelValue : Number(levelValue);
            return Number.isFinite(parsed) ? [[levelKey, parsed]] : [];
          })) as Partial<Record<EquipmentLevelKey, number>>,
          unit: normalizedEffect.unit,
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

export function findOperatorEquipmentItem(
  equipmentLibrary: EquipmentLibrary | null,
  equipmentId: string,
): EquipmentItem | null {
  if (!equipmentLibrary || !equipmentId) return null;
  return Object.values(equipmentLibrary.gearSets)
    .flatMap((gearSet) => Object.values(gearSet.equipments))
    .find((item) => item.equipmentId === equipmentId) ?? null;
}

export function getOperatorEquipmentEffectLevelValue(
  effect: Partial<EquipmentEffect> | undefined,
  level: number | string,
): number {
  const levels = effect?.levels;
  if (!levels) return 0;
  const value = levels[String(level) as EquipmentLevelKey];
  return typeof value === 'number' ? value : 0;
}

export function buildOperatorEquipmentSetBuffs(
  selectedEquipmentIds: string[],
  equipmentLibrary: EquipmentLibrary,
): EquipmentSetBuffInput[] {
  if (selectedEquipmentIds.length < 3) return [];

  return Object.values(equipmentLibrary.gearSets).flatMap((gearSet) => {
    const setEquipmentIds = new Set(Object.entries(gearSet.equipments).flatMap(([equipmentId, equipment]) => [
      equipmentId,
      equipment.equipmentId,
    ]));
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
