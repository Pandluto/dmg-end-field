import type { SkillButton as RuntimeSkillButton, SkillType } from '../../types';
import type { DamageBonusSnapshot, PersistedAnomalyCard, PersistedSkillButton, SkillButtonBuff } from '../../types/storage';
import { getCharacterComputed, getCharacterConfig, getCharacterInput, getRuntimeOperatorTemplateById } from '../../utils/storage';
import { getBuffById, getSkillButtonById, loadTimelineData } from '../repositories';
import { resolveSkillDamageTemplate } from './skillDamageTemplateResolver';
import { calculateSkillButtonDamageV2 } from '../calculators/skillButtonDamageCalculatorV2';
import { loadLocalOperatorDraftMap } from './localOperatorAdapter';
import { buildAnomalyStateDerivedBuffs, buildAnomalyStateSnapshotBuffs } from './anomalyStateBuffs';
import { getAnomalyStateSnapshotsByIds } from './anomalyStateSnapshotStorage';
import {
  calculateAmplifyRate,
  calculateBuffTotals,
  calculateElementDmgBonus,
  calculateFragileRate,
  calculateResistanceZone,
  calculateSkillDmgBonus,
  calculateVulnerabilityRate,
} from '../calculators/buffCalculator';
import type { ResistanceZoneResult } from '../calculators/buffCalculator';
import type { BuffContribution, ZoneCalculationResult } from '../calculators/buffZoneCalculator';

export interface DamageReportBuffRow {
  id: string;
  traceId: string;
  name: string;
  effect: string;
  type?: string;
  zone?: BuffContribution['zone'];
  rawValue?: number;
  runtimeCoefficient?: number;
  effectiveValue?: number;
  multiplierCoefficient?: number;
  multiplier?: boolean;
}

export interface DamageReportZoneRow {
  key: BuffContribution['zone'];
  additiveTotal: number;
  multiplierProduct: number;
  finalValue: number;
}

export interface DamageReportHitRow {
  id: string;
  title: string;
  sourceKind: 'normal' | 'anomaly' | 'extraHit';
  damageSourceLabel: string;
  skillTypeLabel: string;
  elementLabel: string;
  damage: number;
  expected: number;
  nonCrit: number;
  resistanceZone: number;
  resistance: ResistanceZoneResult;
  buffs: DamageReportBuffRow[];
  zones?: DamageReportZoneRow[];
}

export interface DamageReportButtonRow {
  id: string;
  characterId: string;
  groupLabel: string;
  orderLabel: string;
  characterName: string;
  skillName: string;
  skillType: string;
  damage: number;
  expected: number;
  nonCrit: number;
  share: number;
  hits: DamageReportHitRow[];
}

export interface DamageReportCharacterRow {
  characterId: string;
  characterName: string;
  weaponName: string;
  weaponPotentialMode: string;
  level: number | null;
  skillLevels: string[];
  attributeLines: string[];
  equipmentLines: string[];
  skills: Array<{
    id: string;
    title: string;
    meta: string;
    hitLines: string[];
  }>;
}

export interface DamageReportSnapshot {
  generatedAt: number;
  totalDamage: number;
  totalExpected: number;
  totalNonCrit: number;
  buttonCount: number;
  buttons: DamageReportButtonRow[];
  characters: DamageReportCharacterRow[];
}

const EMPTY_DAMAGE_BONUS: DamageBonusSnapshot = {
  physicalDmgBonus: 0,
  fireDmgBonus: 0,
  electricDmgBonus: 0,
  iceDmgBonus: 0,
  natureDmgBonus: 0,
  magicDmgBonus: 0,
  normalAttackDmgBonus: 0,
  dotDmgBonus: 0,
  skillDmgBonus: 0,
  chainSkillDmgBonus: 0,
  ultimateDmgBonus: 0,
  allSkillDmgBonus: 0,
  imbalanceDmgBonus: 0,
  allDmgBonus: 0,
};

const LOCAL_BUFF_LIBRARY_KEY = 'def.buff-editor.library.v1';

function isModifierBuff(buff: SkillButtonBuff): boolean {
  return buff.effectKind !== 'extraHit';
}

function isExtraHitBuff(buff: SkillButtonBuff): buff is SkillButtonBuff & { effectKind: 'extraHit'; extraHitConfig: NonNullable<SkillButtonBuff['extraHitConfig']> } {
  return buff.effectKind === 'extraHit' && !!buff.extraHitConfig;
}

function formatBuffEffect(buff: SkillButtonBuff): string {
  if (buff.description?.trim()) {
    return buff.description.trim();
  }
  if (buff.type && typeof buff.value === 'number') {
    return `${buff.type}: ${buff.value}`;
  }
  if (buff.type) {
    return buff.type;
  }
  return '无';
}

type LocalBuffLibraryRecord = Record<string, {
  id?: string;
  name?: string;
  sourceName?: string;
  items?: Record<string, {
    id?: string;
    name?: string;
    sourceName?: string;
    effects?: Record<string, {
      id?: string;
      displayName?: string;
      name?: string;
      type?: string;
      value?: number;
      description?: string;
      condition?: string;
      sourceName?: string;
      source?: string;
      level?: string;
      effectKind?: 'modifier' | 'extraHit';
      extraHitConfig?: SkillButtonBuff['extraHitConfig'];
    }>;
  }>;
}>;

function buildLocalBuffIdentity(buff: Pick<SkillButtonBuff, 'displayName' | 'name' | 'type' | 'value' | 'description' | 'condition' | 'sourceName' | 'source' | 'level' | 'effectKind' | 'extraHitConfig'>): string {
  return JSON.stringify({
    displayName: buff.displayName || '',
    name: buff.name || '',
    type: buff.type || '',
    value: typeof buff.value === 'number' ? buff.value : null,
    description: buff.description || '',
    condition: buff.condition || '',
    sourceName: buff.sourceName || '',
    source: buff.source || '',
    level: buff.level || '',
    effectKind: buff.effectKind || 'modifier',
    extraHitConfig: buff.extraHitConfig || null,
  });
}

function resolveLocalLibraryTraceId(buff: SkillButtonBuff): string | null {
  if (typeof window === 'undefined' || buff.source !== 'local_custom') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_BUFF_LIBRARY_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as LocalBuffLibraryRecord;
    const targetIdentity = buildLocalBuffIdentity(buff);

    for (const [groupKey, group] of Object.entries(parsed)) {
      for (const [itemKey, item] of Object.entries(group.items || {})) {
        for (const [effectKey, effect] of Object.entries(item.effects || {})) {
          const identity = buildLocalBuffIdentity({
            displayName: effect.displayName || effectKey,
            name: effect.name || effectKey,
            type: effect.type,
            value: effect.value,
            description: effect.description,
            condition: effect.condition,
            sourceName: effect.sourceName || item.sourceName || group.sourceName || group.name || groupKey,
            source: effect.source || 'local_custom',
            level: effect.level || '',
            effectKind: effect.effectKind,
            extraHitConfig: effect.extraHitConfig,
          });
          if (identity === targetIdentity) {
            return `${group.id?.trim() || groupKey}.${item.id?.trim() || itemKey}.${effect.id?.trim() || effectKey}`;
          }
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}

function buildBuffTraceId(buff: SkillButtonBuff): string {
  const localTraceId = resolveLocalLibraryTraceId(buff);
  if (localTraceId) {
    return localTraceId;
  }

  const parts: string[] = [];
  if (buff.sourceName?.trim()) {
    parts.push(buff.sourceName.trim());
  } else if (buff.source?.trim()) {
    parts.push(buff.source.trim());
  }
  if (buff.level?.trim()) {
    parts.push(buff.level.trim());
  }
  if (buff.displayName?.trim()) {
    parts.push(buff.displayName.trim());
  } else if (buff.name?.trim()) {
    parts.push(buff.name.trim());
  }
  parts.push(buff.id);
  return parts.join(' / ');
}

function toBuffRows(
  buffs: SkillButtonBuff[],
  contributions: BuffContribution[] = []
): DamageReportBuffRow[] {
  return buffs.map((buff) => ({
    ...(() => {
      const contribution = contributions.find((item) => item.buffId === buff.id);
      return contribution ? {
        type: contribution.type,
        zone: contribution.zone,
        rawValue: contribution.rawValue,
        runtimeCoefficient: contribution.runtimeCoefficient,
        effectiveValue: contribution.effectiveValue,
        multiplierCoefficient: contribution.multiplierCoefficient,
        multiplier: contribution.multiplier,
      } : {};
    })(),
    id: buff.id,
    traceId: buildBuffTraceId(buff),
    name: buff.displayName || buff.name,
    effect: formatBuffEffect(buff),
  }));
}

function toZoneRows(zones: Array<[BuffContribution['zone'], ZoneCalculationResult | undefined]>): DamageReportZoneRow[] {
  return zones.flatMap(([key, zone]) => zone ? [{
    key,
    additiveTotal: zone.additiveTotal,
    multiplierProduct: zone.multiplierProduct,
    finalValue: zone.finalValue,
  }] : []);
}

function buildRuntimeButton(button: PersistedSkillButton): RuntimeSkillButton {
  const template = getRuntimeOperatorTemplateById(button.characterId || button.characterName);
  return {
    id: button.id,
    characterId: button.characterId || button.characterName,
    characterName: button.characterName,
    skillType: button.skillType as SkillType,
    position: button.position,
    staffIndex: button.staffIndex,
    lineIndex: button.staffIndex,
    nodeIndex: button.nodeIndex,
    nodeNumber: button.nodeNumber,
    isDragging: false,
    isSelected: false,
    isFromSandbox: true,
    skillIconUrl: button.skillIconUrl,
    runtimeSkillId: button.runtimeSkillId,
    skillDisplayName: button.skillDisplayName,
    customHits: button.customHits,
    element: template?.element,
  };
}

function formatElementLabel(element: string | undefined): string {
  switch (element) {
    case 'physical':
      return '物理';
    case 'fire':
      return '火';
    case 'electric':
      return '雷';
    case 'ice':
      return '冰';
    case 'nature':
      return '自然';
    case 'magic':
      return '法术';
    default:
      return element || '-';
  }
}

function formatSkillTypeLabel(skillType: string | undefined): string {
  switch (skillType) {
    case 'A':
      return 'A';
    case 'B':
      return 'B';
    case 'E':
      return 'E';
    case 'Q':
      return 'Q';
    case 'Dot':
      return '持续伤害';
    default:
      return skillType || '-';
  }
}

function formatEquipmentFieldLabel(key: string): string {
  switch (key) {
    case 'strength':
      return '力量';
    case 'agility':
      return '敏捷';
    case 'intelligence':
      return '智力';
    case 'will':
      return '意志';
    case 'mainStatBoost':
      return '主属性提升';
    case 'subStatBoost':
      return '副属性提升';
    case 'allStatBoost':
      return '全属性提升';
    case 'flatAtk':
      return '固定攻击';
    case 'atkPercentBoost':
      return '攻击力百分比提升';
    case 'critRateBoost':
      return '暴击率提升';
    case 'critDmgBonusBoost':
      return '暴击伤害提升';
    case 'physicalDmgBonus':
      return '物理伤害加成';
    case 'fireDmgBonus':
      return '火伤害加成';
    case 'electricDmgBonus':
      return '雷伤害加成';
    case 'iceDmgBonus':
      return '冰伤害加成';
    case 'natureDmgBonus':
      return '自然伤害加成';
    case 'magicDmgBonus':
      return '法术伤害加成';
    case 'skillDmgBonus':
      return '技能伤害加成';
    case 'chainSkillDmgBonus':
      return '连携技伤害加成';
    case 'ultimateDmgBonus':
      return '终结技伤害加成';
    case 'normalAttackDmgBonus':
      return '普攻伤害加成';
    case 'dotDmgBonus':
      return '持续伤害加成';
    case 'imbalanceDmgBonus':
      return '失衡伤害加成';
    case 'sourceSkillBoost':
      return '源石技艺强度';
    case 'allSkillDmgBonus':
      return '全技能伤害加成';
    case 'allDmgBonus':
      return '全伤害加成';
    case 'defense':
      return '防御';
    case 'hp':
      return '生命';
    default:
      return key;
  }
}

function formatEquipmentValue(key: string, value: number): string {
  switch (key) {
    case 'atkPercentBoost':
    case 'critRateBoost':
    case 'critDmgBonusBoost':
    case 'physicalDmgBonus':
    case 'fireDmgBonus':
    case 'electricDmgBonus':
    case 'iceDmgBonus':
    case 'natureDmgBonus':
    case 'magicDmgBonus':
    case 'skillDmgBonus':
    case 'chainSkillDmgBonus':
    case 'ultimateDmgBonus':
    case 'normalAttackDmgBonus':
    case 'dotDmgBonus':
    case 'imbalanceDmgBonus':
    case 'allSkillDmgBonus':
    case 'allDmgBonus':
    case 'weaponAtkPercent':
      return `${(value * 100).toFixed(1)}%`;
    default:
      return `${value}`;
  }
}

function buildEquipmentLines(equipment: Record<string, number | undefined> | undefined): string[] {
  if (!equipment) {
    return [];
  }

  return Object.entries(equipment)
    .filter(([, value]) => typeof value === 'number' && value !== 0)
    .map(([key, value]) => `${formatEquipmentFieldLabel(key)}: ${formatEquipmentValue(key, value as number)}`);
}

function buildSkillRows(
  skills: Record<string, {
    displayName: string;
    buttonType: string;
    hitCount: number;
    hitMeta: Record<string, { multiplier?: number; levels?: Record<string, number>; displayName: string; element: string; skillType: string }>;
  }>,
  skillLevels: Record<string, string> | undefined
): DamageReportCharacterRow['skills'] {
  return Object.entries(skills)
    .sort((left, right) => {
      const order = ['A', 'B', 'E', 'Q'];
      return order.indexOf(left[1].buttonType) - order.indexOf(right[1].buttonType);
    })
    .map(([skillId, skill]) => {
      const levelKey = skillLevels?.[skill.buttonType] || 'M3';
      const hits = Object.entries(skill.hitMeta || {})
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey, 'zh-CN'))
        .map(([hitKey, hit]) => {
          const multiplier = hit.levels?.[levelKey] ?? hit.levels?.M3 ?? hit.multiplier ?? 0;
          return `${hitKey} / ${hit.displayName} / ${(multiplier * 100).toFixed(1)}% / ${formatElementLabel(hit.element)} / ${formatSkillTypeLabel(hit.skillType)}`;
        });

      return {
        id: skillId,
        title: `${skill.buttonType} / ${skill.displayName}`,
        meta: `等级 ${skillLevels?.[skill.buttonType] || '-'}　Hit ${skill.hitCount}`,
        hitLines: hits,
      };
    });
}

function resolveDraftAttributeValue(attributes: Record<string, unknown>, attributeKey: string, levelKey = 'level90'): number {
  const rawValue = attributes[attributeKey];
  if (typeof rawValue === 'number') {
    return rawValue;
  }
  if (rawValue && typeof rawValue === 'object') {
    const levelValues = rawValue as Record<string, unknown>;
    const value = levelValues[levelKey] ?? levelValues.level90;
    return typeof value === 'number' ? value : 0;
  }
  return 0;
}

function formatDamageSourceLabel(sourceKind: DamageReportHitRow['sourceKind']): string {
  switch (sourceKind) {
    case 'normal':
      return '主伤害';
    case 'anomaly':
      return '异常段';
    case 'extraHit':
      return '额外 hit';
    default:
      return sourceKind;
  }
}

function getButtonBuffs(button: PersistedSkillButton): SkillButtonBuff[] {
  return (button.selectedBuff || [])
    .map((buffId) => getBuffById(buffId))
    .filter((buff): buff is SkillButtonBuff => Boolean(buff));
}

function calculateBreakdown(
  panelAtk: number,
  multiplierValue: number,
  critFactor: number,
  damageBonusRate: number,
  defenseZone: number,
  resistanceZone: number,
  amplifyRate: number,
  fragileRate: number,
  vulnerabilityRate: number,
  comboDamageBonus: number,
  imbalanceDamageBonus: number
): number {
  const base = panelAtk * multiplierValue;
  const afterCrit = base * critFactor;
  const afterBonus = afterCrit * damageBonusRate;
  const afterDefense = afterBonus * defenseZone;
  const afterResistance = afterDefense * resistanceZone;
  const afterAmplify = afterResistance * (1 + amplifyRate);
  const afterFragile = afterAmplify * (1 + fragileRate);
  const afterVulnerability = afterFragile * (1 + vulnerabilityRate);
  const afterCombo = afterVulnerability * (1 + comboDamageBonus);
  return afterCombo * (1 + imbalanceDamageBonus);
}

function buildPersistedDisabledBuffMap(button: PersistedSkillButton): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(button.panelConfig?.manualDisabledBuffIdsBySegmentKey ?? {}).map(([segmentKey, buffIds]) => [
      segmentKey,
      Array.isArray(buffIds) ? buffIds : [],
    ])
  );
}

function buildPersistedDisabledHitKeys(button: PersistedSkillButton): string[] {
  return Array.isArray(button.panelConfig?.manualDisabledHitKeys)
    ? button.panelConfig.manualDisabledHitKeys.filter((hitKey): hitKey is string => typeof hitKey === 'string')
    : [];
}

function buildDamageReportPanelBase(button: PersistedSkillButton): {
  baseAtk: number;
  characterAtk: number;
  weaponAtk: number;
  weaponAtkPercent: number;
  abilityBonus: number;
  critRate: number;
  critDmg: number;
} | null {
  const computedPanel = getCharacterComputed(button.characterId || button.characterName)?.panel;
  if (!computedPanel) {
    return null;
  }

  return {
    baseAtk: computedPanel.baseAtk,
    characterAtk: computedPanel.characterAtk,
    weaponAtk: computedPanel.weaponAtk,
    weaponAtkPercent: computedPanel.weaponAtkPercent,
    abilityBonus: computedPanel.abilityBonus,
    critRate: computedPanel.critRate ?? 0.05,
    critDmg: computedPanel.critDmg ?? 0.5,
  };
}

function buildDamageReportPanel(
  panelBase: ReturnType<typeof buildDamageReportPanelBase>,
  fallbackPanel: { atk: number; critRate: number; critDmg: number },
  appliedBuffs: SkillButtonBuff[],
  stackCounts: Record<string, number> = {}
): { atk: number; critRate: number; critDmg: number } {
  if (!panelBase) {
    return fallbackPanel;
  }

  const buffTotals = calculateBuffTotals(appliedBuffs.filter(isModifierBuff), stackCounts);
  const currentAtkPercent = panelBase.weaponAtkPercent * 0.01;
  const rawAtk = panelBase.characterAtk + panelBase.weaponAtk;
  const fixedAtk = panelBase.baseAtk - rawAtk * (1 + currentAtkPercent);
  const nextBaseAtk = rawAtk * (1 + currentAtkPercent + buffTotals.atkPercentBoost) + fixedAtk;
  const abilityAtkPercentBonus = panelBase.abilityBonus * 0.01;

  return {
    atk: nextBaseAtk * (1 + abilityAtkPercentBonus),
    critRate: (panelBase.critRate ?? 0.05) + buffTotals.critRateBoost,
    critDmg: (panelBase.critDmg ?? 0.5) + buffTotals.critDmgBonusBoost,
  };
}

function readExtraHitStackCount(
  buff: SkillButtonBuff,
  stackCounts: Record<string, number> = {}
): number {
  if (buff.category !== 'countable') {
    return 1;
  }
  const maxStacks = typeof buff.maxStacks === 'number' && Number.isFinite(buff.maxStacks) && buff.maxStacks > 0
    ? Math.floor(buff.maxStacks)
    : 1;
  const rawCount = stackCounts[buff.id];
  const stackCount = typeof rawCount === 'number' && Number.isFinite(rawCount)
    ? Math.floor(rawCount)
    : maxStacks;
  return Math.min(Math.max(stackCount, 0), maxStacks);
}

function resolveAnomalyBaseMultiplierPercent(card: PersistedAnomalyCard): number {
  switch (card.key) {
    case 'magic-burst':
      return 160;
    case 'smash':
      return 150 * (1 + card.level);
    case 'armor-break':
      return 50 * (1 + card.level);
    case 'shatter-ice':
      return 120 * (1 + card.level);
    case 'conductive':
    case 'corrosion':
    case 'burn':
    case 'freeze':
      return 80 * (1 + card.level);
    case 'knockdown':
    case 'launch':
      return 120;
    default:
      return 0;
  }
}

function resolveBurnDotTotalMultiplierPercent(card: PersistedAnomalyCard): number {
  const durationSeconds = typeof card.durationSeconds === 'number' ? card.durationSeconds : 0;
  if (card.key !== 'burn' || resolveBurnDamageMode(card) === 'initialOnly' || durationSeconds <= 0) {
    return 0;
  }
  return 12 * (1 + card.level) * durationSeconds;
}

function resolveBurnDamageMode(card: PersistedAnomalyCard): NonNullable<PersistedAnomalyCard['burnDamageMode']> {
  if (card.key !== 'burn') {
    return 'initialOnly';
  }
  return card.burnDamageMode ?? (card.includeDotInTotal ? 'dotOnly' : 'initialOnly');
}

function resolveAnomalyLevelCoefficient(card: PersistedAnomalyCard): number {
  const currentOperatorLevel = 90;
  if (card.key === 'shatter-ice' || card.category === 'magic') {
    return 1 + (currentOperatorLevel - 1) / 196;
  }
  return 1 + (currentOperatorLevel - 1) / 392;
}

function resolveAnomalyElementKey(card: PersistedAnomalyCard, fallbackElement: string | undefined): string {
  switch (card.key) {
    case 'smash':
    case 'knockdown':
    case 'launch':
    case 'shatter-ice':
    case 'armor-break':
      return 'physical';
    case 'conductive':
      return 'electric';
    case 'corrosion':
      return 'nature';
    case 'burn':
      return 'fire';
    case 'freeze':
      return 'ice';
    case 'magic-burst':
      return fallbackElement ?? 'magic';
    default:
      return fallbackElement ?? 'magic';
  }
}

function buildAnomalyReportHits(
  button: PersistedSkillButton,
  characterDamageBonus: DamageBonusSnapshot,
  panel: { atk: number; critRate: number; critDmg: number },
  panelBase: ReturnType<typeof buildDamageReportPanelBase>,
  disabledBuffIdsBySegmentKey: Record<string, string[]>,
  normalHitCount: number,
  modifierBuffList: SkillButtonBuff[],
  extraHitBuffList: Array<SkillButtonBuff & { effectKind: 'extraHit'; extraHitConfig: NonNullable<SkillButtonBuff['extraHitConfig']> }>,
  stackCounts: Record<string, number> = {}
): DamageReportHitRow[] {
  const anomalyCards = button.anomalyConfig?.selectedDamages ?? [];
  const template = getRuntimeOperatorTemplateById(button.characterId || button.characterName);
  const fallbackElement = template?.element;
  const parsedDamageBonusRecord = characterDamageBonus as unknown as Record<string, number>;
  const baseSourceSkill = getCharacterConfig(button.characterId || button.characterName)?.panelSnapshot?.sourceSkill ?? 0;

  let anomalySequenceOffset = 0;
  const anomalyRows = anomalyCards.flatMap((card) => {
    const baseMultiplierPercent = resolveAnomalyBaseMultiplierPercent(card);
    const levelCoefficient = resolveAnomalyLevelCoefficient(card);
    const elementKey = resolveAnomalyElementKey(card, fallbackElement);
    const disabledBuffIds = new Set(disabledBuffIdsBySegmentKey[card.id] ?? []);
    const appliedBuffs = ((card.selectedBuffIds?.length ?? 0) === 0
      ? modifierBuffList
      : modifierBuffList.filter((buff) => card.selectedBuffIds.includes(buff.id)))
      .filter((buff) => !disabledBuffIds.has(buff.id));
    const segmentPanel = buildDamageReportPanel(panelBase, panel, appliedBuffs, stackCounts);
    const buffTotals = calculateBuffTotals(appliedBuffs, stackCounts);
    const sourceSkill = baseSourceSkill + buffTotals.sourceSkillBoost;
    const sourceSkillZone = 1 + sourceSkill / 100;
    const anomalyBaseMultiplier = (baseMultiplierPercent / 100) * levelCoefficient * sourceSkillZone;
    const multiplierAfterBonus = anomalyBaseMultiplier + buffTotals.multiplierBonus;
    const finalMultiplier = multiplierAfterBonus * buffTotals.multiplierMultiplier;
    const allDamageBonus = (characterDamageBonus.allDmgBonus || 0) + (buffTotals.allDmgBonus || 0);
    const damageBonusRate = 1
      + calculateElementDmgBonus(elementKey, parsedDamageBonusRecord, buffTotals)
      + calculateSkillDmgBonus('', parsedDamageBonusRecord, buffTotals)
      + allDamageBonus;
    const resistance = calculateResistanceZone(elementKey, button.resistanceConfig?.targetResistance, buffTotals);
    const amplifyRate = calculateAmplifyRate(elementKey, buffTotals);
    const fragileRate = calculateFragileRate(elementKey, buffTotals);
    const vulnerabilityRate = calculateVulnerabilityRate(elementKey, buffTotals);
    const comboDamageBonus = buffTotals.comboDamageBonus;
    const imbalanceDamageBonus = buffTotals.imbalanceDamageBonus + (elementKey === 'physical' ? (characterDamageBonus.imbalanceDmgBonus || 0) : 0);
    const defenseZone = 0.5;
    const expected = calculateBreakdown(segmentPanel.atk, finalMultiplier, 1 + segmentPanel.critRate * segmentPanel.critDmg, damageBonusRate, defenseZone, resistance.resistanceZone, amplifyRate, fragileRate, vulnerabilityRate, comboDamageBonus, imbalanceDamageBonus);
    const nonCrit = calculateBreakdown(segmentPanel.atk, finalMultiplier, 1, damageBonusRate, defenseZone, resistance.resistanceZone, amplifyRate, fragileRate, vulnerabilityRate, comboDamageBonus, imbalanceDamageBonus);
    const sequenceNumber = normalHitCount + anomalySequenceOffset + 1;
    const burnDamageMode = resolveBurnDamageMode(card);

    const initialRow: DamageReportHitRow = {
      id: `anomaly-${button.id}-${card.id}`,
      title: `${sequenceNumber}段 · ${card.label}`,
      sourceKind: 'anomaly' as const,
      damageSourceLabel: formatDamageSourceLabel('anomaly'),
      skillTypeLabel: '异常',
      elementLabel: formatElementLabel(elementKey),
      damage: expected,
      expected,
      nonCrit,
      resistanceZone: resistance.resistanceZone,
      resistance,
      buffs: toBuffRows(appliedBuffs),
    };

    const burnTickMultiplierPercent = 12 * (1 + card.level);
    const burnDotMultiplierPercent = burnDamageMode === 'splitDot'
      ? burnTickMultiplierPercent
      : resolveBurnDotTotalMultiplierPercent(card);
    if (burnDotMultiplierPercent <= 0) {
      anomalySequenceOffset += 1;
      return [initialRow];
    }

    const burnDotBaseMultiplier = (burnDotMultiplierPercent / 100) * levelCoefficient * sourceSkillZone;
    const burnDotFinalMultiplier = (burnDotBaseMultiplier + buffTotals.multiplierBonus) * buffTotals.multiplierMultiplier;
    const burnDotExpected = calculateBreakdown(segmentPanel.atk, burnDotFinalMultiplier, 1 + segmentPanel.critRate * segmentPanel.critDmg, damageBonusRate, defenseZone, resistance.resistanceZone, amplifyRate, fragileRate, vulnerabilityRate, comboDamageBonus, imbalanceDamageBonus);
    const burnDotNonCrit = calculateBreakdown(segmentPanel.atk, burnDotFinalMultiplier, 1, damageBonusRate, defenseZone, resistance.resistanceZone, amplifyRate, fragileRate, vulnerabilityRate, comboDamageBonus, imbalanceDamageBonus);

    const buildDotRow = (sequence: number, keySuffix: string, titleSuffix = '持续'): DamageReportHitRow => ({
      ...initialRow,
      id: `anomaly-${button.id}-${card.id}-${keySuffix}`,
      title: `${sequence}段 · ${card.label}${titleSuffix}`,
      damage: burnDotExpected,
      expected: burnDotExpected,
      nonCrit: burnDotNonCrit,
    });

    if (burnDamageMode === 'splitDot') {
      const hitCount = Math.max(1, Math.trunc(card.durationSeconds ?? 0));
      const dotRows = Array.from({ length: hitCount }, (_, dotIndex) => buildDotRow(
        sequenceNumber + dotIndex,
        `dot-${dotIndex + 1}`,
        `持续 ${dotIndex + 1}/${hitCount}`
      ));
      anomalySequenceOffset += hitCount;
      return dotRows;
    }

    if (burnDamageMode === 'dotOnly') {
      anomalySequenceOffset += 1;
      return [buildDotRow(sequenceNumber, 'dot')];
    }
    anomalySequenceOffset += 1;
    return [initialRow];
  });

  const extraHitRows = extraHitBuffList.map((buff, index) => {
    const config = buff.extraHitConfig;
    const elementKey = config.damageType;
    const stackCount = readExtraHitStackCount(buff, stackCounts);
    const stackedBaseMultiplier = config.baseMultiplier * stackCount;
    const segmentKey = `buff-extra-hit-${buff.id}`;
    const disabledBuffIds = new Set(disabledBuffIdsBySegmentKey[segmentKey] ?? []);
    const appliedBuffs = modifierBuffList.filter((item) => !disabledBuffIds.has(item.id));
    const segmentPanel = buildDamageReportPanel(panelBase, panel, appliedBuffs, stackCounts);
    const buffTotals = calculateBuffTotals(appliedBuffs, stackCounts);
    const damageBonusRate = 1
      + calculateElementDmgBonus(elementKey, parsedDamageBonusRecord, buffTotals)
      + calculateSkillDmgBonus('', parsedDamageBonusRecord, buffTotals)
      + (characterDamageBonus.allDmgBonus || 0)
      + (buffTotals.allDmgBonus || 0);
    const resistance = calculateResistanceZone(elementKey, button.resistanceConfig?.targetResistance, buffTotals);
    const amplifyRate = calculateAmplifyRate(elementKey, buffTotals);
    const fragileRate = calculateFragileRate(elementKey, buffTotals);
    const vulnerabilityRate = calculateVulnerabilityRate(elementKey, buffTotals);
    const comboDamageBonus = buffTotals.comboDamageBonus;
    const imbalanceDamageBonus = buffTotals.imbalanceDamageBonus + (elementKey === 'physical' ? (characterDamageBonus.imbalanceDmgBonus || 0) : 0);
    const defenseZone = 0.5;
    const finalMultiplier = (stackedBaseMultiplier + buffTotals.multiplierBonus) * buffTotals.multiplierMultiplier;
    const expected = calculateBreakdown(segmentPanel.atk, finalMultiplier, 1 + segmentPanel.critRate * segmentPanel.critDmg, damageBonusRate, defenseZone, resistance.resistanceZone, amplifyRate, fragileRate, vulnerabilityRate, comboDamageBonus, imbalanceDamageBonus);
    const nonCrit = calculateBreakdown(segmentPanel.atk, finalMultiplier, 1, damageBonusRate, defenseZone, resistance.resistanceZone, amplifyRate, fragileRate, vulnerabilityRate, comboDamageBonus, imbalanceDamageBonus);

    return {
      id: `extra-hit-${button.id}-${buff.id}`,
      title: `${normalHitCount + anomalyRows.length + index + 1}段 · ${buff.displayName}`,
      sourceKind: 'extraHit' as const,
      damageSourceLabel: formatDamageSourceLabel('extraHit'),
      skillTypeLabel: formatSkillTypeLabel(button.skillType),
      elementLabel: formatElementLabel(elementKey),
      damage: expected,
      expected,
      nonCrit,
      resistanceZone: resistance.resistanceZone,
      resistance,
      buffs: toBuffRows(appliedBuffs),
    };
  });

  return [...anomalyRows, ...extraHitRows];
}

function buildButtonReportRow(
  button: PersistedSkillButton,
  orderIndex: number
): DamageReportButtonRow | null {
  const runtimeButton = buildRuntimeButton(button);
  const resolvedTemplate = resolveSkillDamageTemplate(runtimeButton);
  const characterConfig = getCharacterConfig(button.characterId || button.characterName);
  const damageBonus = characterConfig?.infoSnap ?? EMPTY_DAMAGE_BONUS;
  const snapshot = characterConfig?.panelSnapshot;
  const buttonSnapshot = button.runtimeSnapshot;
  const panel = {
    atk: buttonSnapshot?.atk ?? snapshot?.atk ?? 0,
    critRate: buttonSnapshot?.critRate ?? snapshot?.critRate ?? 0.05,
    critDmg: buttonSnapshot?.critDmg ?? snapshot?.critDmg ?? 0.5,
  };
  const panelBase = buildDamageReportPanelBase(button);
  const disabledBuffIdsBySegmentKey = buildPersistedDisabledBuffMap(button);
  const disabledHitKeys = buildPersistedDisabledHitKeys(button);
  const disabledBuffIdsByHitKey = resolvedTemplate
    ? Object.fromEntries(
        resolvedTemplate.hits.map((hit) => [
          hit.key,
          disabledBuffIdsBySegmentKey[`normal-hit-${hit.key}`] ?? [],
        ])
      )
    : {};
  const allBuffs = getButtonBuffs(button);
  const modifierBuffList = allBuffs.filter(isModifierBuff);
  const anomalyStatuses = button.anomalyConfig?.selectedStatuses ?? [];
  const anomalyStateSnapshots = getAnomalyStateSnapshotsByIds(button.anomalyConfig?.selectedStateSnapshotIds ?? []);
  const stateDerivedBuffList = buildAnomalyStateDerivedBuffs(anomalyStatuses, button.skillType);
  const stateSnapshotBuffList = buildAnomalyStateSnapshotBuffs(anomalyStateSnapshots);
  const combinedModifierBuffList = [...modifierBuffList, ...stateDerivedBuffList, ...stateSnapshotBuffList];
  const extraHitBuffList = allBuffs.filter(isExtraHitBuff);

  const normalHits = resolvedTemplate
    ? calculateSkillButtonDamageV2({
        buttonId: button.id,
        characterId: runtimeButton.characterId,
        runtimeSkillId: resolvedTemplate.runtimeSkillId,
        template: resolvedTemplate,
        buffs: combinedModifierBuffList,
        buffStackCounts: button.buffStackCounts ?? {},
        panel,
        panelBase: panelBase ?? undefined,
        disabledBuffIdsByHitKey,
        disabledHitKeys,
        targetResistance: button.resistanceConfig?.targetResistance,
        damageBonus,
      }).hits.map((hit, index) => ({
        id: `normal-${button.id}-${hit.hit.key}-${index}`,
        title: `${index + 1}段 · ${hit.hit.displayName}`,
        sourceKind: 'normal' as const,
        damageSourceLabel: formatDamageSourceLabel('normal'),
        skillTypeLabel: formatSkillTypeLabel(hit.hit.skillType),
        elementLabel: formatElementLabel(hit.hit.element),
        damage: hit.expected.final,
        expected: hit.expected.final,
        nonCrit: hit.nonCrit.final,
        resistanceZone: hit.zones.resistanceZone,
        resistance: hit.zones.resistance,
        buffs: toBuffRows(hit.appliedBuffs, hit.buffContributions),
        zones: toZoneRows([
          ['skillMultiplier', hit.zones.skillMultiplier],
          ['damageBonus', hit.zones.damageBonus],
          ['amplify', hit.zones.amplify],
          ['fragile', hit.zones.fragile],
          ['vulnerability', hit.zones.vulnerability],
        ]),
      }))
    : [];

  const anomalyHits = buildAnomalyReportHits(
    button,
    damageBonus,
    panel,
    panelBase,
    disabledBuffIdsBySegmentKey,
    normalHits.length,
    combinedModifierBuffList,
    extraHitBuffList,
    button.buffStackCounts ?? {}
  );

  const hits = [...normalHits, ...anomalyHits];
  if (hits.length === 0 && !resolvedTemplate) {
    return null;
  }

  const expected = hits.reduce((sum, hit) => sum + hit.expected, 0);
  const nonCrit = hits.reduce((sum, hit) => sum + hit.nonCrit, 0);

  return {
    id: button.id,
    characterId: runtimeButton.characterId,
    groupLabel: `第${button.staffIndex + 1}组`,
    orderLabel: `${orderIndex + 1}`.padStart(2, '0'),
    characterName: button.characterName,
    skillName: resolvedTemplate?.displayName ?? button.skillDisplayName ?? button.skillType,
    skillType: button.skillType,
    damage: expected,
    expected,
    nonCrit,
    share: 0,
    hits,
  };
}

function buildCharacterReportRow(characterId: string, fallbackName: string): DamageReportCharacterRow {
  const localDraftMap = loadLocalOperatorDraftMap();
  const draft = localDraftMap[characterId];
  const input = getCharacterInput(characterId);
  const config = getCharacterConfig(characterId);

  const attributeLines = draft
    ? [
        `等级 ${draft.level}`,
        `力量 ${resolveDraftAttributeValue(draft.attributes, 'strength')}　敏捷 ${resolveDraftAttributeValue(draft.attributes, 'agility')}　智力 ${resolveDraftAttributeValue(draft.attributes, 'intelligence')}　意志 ${resolveDraftAttributeValue(draft.attributes, 'will')}`,
        `攻击 ${resolveDraftAttributeValue(draft.attributes, 'atk')}　生命 ${resolveDraftAttributeValue(draft.attributes, 'hp')}`,
      ]
    : ['本地角色库未找到该角色草稿'];

  return {
    characterId,
    characterName: draft?.name || fallbackName || config?.characterName || characterId,
    weaponName: input?.weapon?.name || draft?.weapon || '无',
    weaponPotentialMode: input?.weapon?.potentialMode || '-',
    level: draft?.level ?? null,
    skillLevels: input
      ? ['A', 'B', 'E', 'Q'].map((skillType) => `${skillType} ${input.skillLevels?.[skillType as keyof typeof input.skillLevels] || '-'}`)
      : [],
    attributeLines,
    equipmentLines: buildEquipmentLines(input?.equipment),
    skills: draft ? buildSkillRows(draft.skills, input?.skillLevels as Record<string, string> | undefined) : [],
  };
}

export function buildDamageReportSnapshot(): DamageReportSnapshot {
  const timelineData = loadTimelineData();
  if (!timelineData || !Array.isArray(timelineData.staffLines)) {
    return {
      generatedAt: Date.now(),
      totalDamage: 0,
      totalExpected: 0,
      totalNonCrit: 0,
      buttonCount: 0,
      buttons: [],
      characters: [],
    };
  }

  const buttons: DamageReportButtonRow[] = [];
  const flattenedButtons = timelineData.staffLines.flatMap((staffLine) =>
    (Array.isArray(staffLine.buttons) ? staffLine.buttons : []).map((timelineButton) => ({
      timelineButton,
      staffIndex: staffLine.staffIndex,
    }))
  );

  flattenedButtons
    .sort((left, right) => {
      const xDiff = (left.timelineButton.position?.x ?? 0) - (right.timelineButton.position?.x ?? 0);
      if (Math.abs(xDiff) > 0.001) {
        return xDiff;
      }
      const yDiff = (left.timelineButton.position?.y ?? 0) - (right.timelineButton.position?.y ?? 0);
      if (Math.abs(yDiff) > 0.001) {
        return yDiff;
      }
      return (left.timelineButton.nodeIndex ?? 0) - (right.timelineButton.nodeIndex ?? 0);
    })
    .forEach(({ timelineButton, staffIndex }, orderIndex) => {
      const persisted = getSkillButtonById(timelineButton.id);
      const reportRow = buildButtonReportRow(
        persisted ?? {
          id: timelineButton.id,
          characterId: timelineButton.characterId || timelineButton.characterName,
          characterName: timelineButton.characterName,
          skillType: timelineButton.skillType,
          staffIndex,
          nodeIndex: timelineButton.nodeIndex,
          nodeNumber: timelineButton.nodeNumber,
          position: timelineButton.position,
          runtimeSkillId: timelineButton.runtimeSkillId,
          skillDisplayName: timelineButton.skillDisplayName,
          skillIconUrl: timelineButton.skillIconUrl,
          customHits: timelineButton.customHits,
          selectedBuff: [],
          panelConfig: { selectedBuff: [] },
          runtimeSnapshot: null,
        },
        orderIndex
      );
      if (reportRow) {
        buttons.push(reportRow);
      }
    });

  const totalExpected = buttons.reduce((sum, button) => sum + button.expected, 0);
  const totalNonCrit = buttons.reduce((sum, button) => sum + button.nonCrit, 0);
  const characterSeen = new Set<string>();
  const characters: DamageReportCharacterRow[] = [];

  buttons.forEach((button) => {
    if (characterSeen.has(button.characterId)) {
      return;
    }
    characterSeen.add(button.characterId);
    characters.push(buildCharacterReportRow(button.characterId, button.characterName));
  });

  return {
    generatedAt: Date.now(),
    totalDamage: totalExpected,
    totalExpected,
    totalNonCrit,
    buttonCount: buttons.length,
    buttons: buttons.map((button) => ({
      ...button,
      share: totalExpected > 0 ? button.expected / totalExpected : 0,
    })),
    characters,
  };
}

