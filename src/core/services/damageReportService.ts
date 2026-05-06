import type { SkillButton as RuntimeSkillButton, SkillType } from '../../types';
import type { DamageBonusSnapshot, PersistedAnomalyCard, PersistedSkillButton, SkillButtonBuff } from '../../types/storage';
import { getCharacterConfig, getCharacterInput, getRuntimeOperatorTemplateById } from '../../utils/storage';
import { getBuffById, getSkillButtonById, loadTimelineData } from '../repositories';
import { resolveSkillDamageTemplate } from './skillDamageTemplateResolver';
import { calculateSkillButtonDamageV2 } from '../calculators/skillButtonDamageCalculatorV2';
import { loadLocalOperatorDraftMap } from './localOperatorAdapter';
import {
  calculateAmplifyRate,
  calculateBuffTotals,
  calculateElementDmgBonus,
  calculateFragileRate,
  calculateSkillDmgBonus,
  calculateVulnerabilityRate,
} from '../calculators/buffCalculator';

export interface DamageReportBuffRow {
  id: string;
  traceId: string;
  name: string;
  effect: string;
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
  buffs: DamageReportBuffRow[];
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
  skillDmgBonus: 0,
  chainSkillDmgBonus: 0,
  ultimateDmgBonus: 0,
  allSkillDmgBonus: 0,
  imbalanceDmgBonus: 0,
  allDmgBonus: 0,
};

const LOCAL_BUFF_LIBRARY_KEY = 'ddd.buff-editor.library.v1';

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

function toBuffRows(buffs: SkillButtonBuff[]): DamageReportBuffRow[] {
  return buffs.map((buff) => ({
    id: buff.id,
    traceId: buildBuffTraceId(buff),
    name: buff.displayName || buff.name,
    effect: formatBuffEffect(buff),
  }));
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
    hitMeta: Record<string, { multiplier: number; displayName: string; element: string; skillType: string }>;
  }>,
  skillLevels: Record<string, string> | undefined
): DamageReportCharacterRow['skills'] {
  return Object.entries(skills)
    .sort((left, right) => {
      const order = ['A', 'B', 'E', 'Q'];
      return order.indexOf(left[1].buttonType) - order.indexOf(right[1].buttonType);
    })
    .map(([skillId, skill]) => {
      const hits = Object.entries(skill.hitMeta || {})
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey, 'zh-CN'))
        .map(([hitKey, hit]) => `${hitKey} / ${hit.displayName} / ${(hit.multiplier * 100).toFixed(1)}% / ${formatElementLabel(hit.element)} / ${formatSkillTypeLabel(hit.skillType)}`);

      return {
        id: skillId,
        title: `${skill.buttonType} / ${skill.displayName}`,
        meta: `等级 ${skillLevels?.[skill.buttonType] || '-'}　Hit ${skill.hitCount}`,
        hitLines: hits,
      };
    });
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
  amplifyRate: number,
  fragileRate: number,
  vulnerabilityRate: number,
  comboDamageBonus: number
): number {
  const base = panelAtk * multiplierValue;
  const afterCrit = base * critFactor;
  const afterBonus = afterCrit * damageBonusRate;
  const afterDefense = afterBonus * defenseZone;
  const afterAmplify = afterDefense * (1 + amplifyRate);
  const afterFragile = afterAmplify * (1 + fragileRate);
  const afterVulnerability = afterFragile * (1 + vulnerabilityRate);
  return afterVulnerability * (1 + comboDamageBonus);
}

function resolveAnomalyBaseMultiplierPercent(card: PersistedAnomalyCard): number {
  switch (card.key) {
    case 'magic-burst':
      return 160;
    case 'smash':
      return 150 * (1 + card.level);
    case 'shatter-ice':
      return 120 * (1 + card.level);
    case 'burn':
      return 80 * (1 + card.level);
    case 'freeze':
      return 80 * (1 + card.level);
    case 'knockdown':
    case 'launch':
      return 120;
    default:
      return 0;
  }
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
  normalHitCount: number,
  modifierBuffList: SkillButtonBuff[],
  extraHitBuffList: Array<SkillButtonBuff & { effectKind: 'extraHit'; extraHitConfig: NonNullable<SkillButtonBuff['extraHitConfig']> }>
): DamageReportHitRow[] {
  const anomalyCards = button.anomalyConfig?.selectedDamages ?? [];
  const template = getRuntimeOperatorTemplateById(button.characterId || button.characterName);
  const fallbackElement = template?.element;
  const parsedDamageBonusRecord = characterDamageBonus as unknown as Record<string, number>;
  const sourceSkill = getCharacterConfig(button.characterId || button.characterName)?.panelSnapshot?.sourceSkill ?? 0;
  const sourceSkillZone = 1 + sourceSkill / 100;

  const anomalyRows = anomalyCards.map((card, index) => {
    const baseMultiplierPercent = resolveAnomalyBaseMultiplierPercent(card);
    const levelCoefficient = resolveAnomalyLevelCoefficient(card);
    const elementKey = resolveAnomalyElementKey(card, fallbackElement);
    const appliedBuffs = (card.selectedBuffIds?.length ?? 0) === 0
      ? modifierBuffList
      : modifierBuffList.filter((buff) => card.selectedBuffIds.includes(buff.id));
    const buffTotals = calculateBuffTotals(appliedBuffs);
    const anomalyBaseMultiplier = (baseMultiplierPercent / 100) * levelCoefficient * sourceSkillZone;
    const multiplierAfterBonus = anomalyBaseMultiplier + buffTotals.multiplierBonus;
    const finalMultiplier = multiplierAfterBonus * buffTotals.multiplierMultiplier;
    const allDamageBonus = elementKey === 'physical' ? (characterDamageBonus.allDmgBonus || 0) : 0;
    const damageBonusRate = 1
      + calculateElementDmgBonus(elementKey, parsedDamageBonusRecord, buffTotals)
      + calculateSkillDmgBonus('', parsedDamageBonusRecord, buffTotals)
      + allDamageBonus;
    const amplifyRate = calculateAmplifyRate(elementKey, buffTotals);
    const fragileRate = calculateVulnerabilityRate(elementKey, buffTotals);
    const vulnerabilityRate = calculateFragileRate(elementKey, buffTotals);
    const comboDamageBonus = buffTotals.comboDamageBonus;
    const defenseZone = 0.5;
    const expected = calculateBreakdown(panel.atk, finalMultiplier, 1 + panel.critRate * panel.critDmg, damageBonusRate, defenseZone, amplifyRate, fragileRate, vulnerabilityRate, comboDamageBonus);
    const nonCrit = calculateBreakdown(panel.atk, finalMultiplier, 1, damageBonusRate, defenseZone, amplifyRate, fragileRate, vulnerabilityRate, comboDamageBonus);

    return {
      id: `anomaly-${button.id}-${card.id}`,
      title: `${normalHitCount + index + 1}段 · ${card.label}`,
      sourceKind: 'anomaly' as const,
      damageSourceLabel: formatDamageSourceLabel('anomaly'),
      skillTypeLabel: '异常',
      elementLabel: formatElementLabel(elementKey),
      damage: expected,
      expected,
      nonCrit,
      buffs: toBuffRows(appliedBuffs),
    };
  });

  const extraHitRows = extraHitBuffList.map((buff, index) => {
    const config = buff.extraHitConfig;
    const elementKey = config.damageType;
    const buffTotals = calculateBuffTotals(modifierBuffList);
    const damageBonusRate = 1
      + calculateElementDmgBonus(elementKey, parsedDamageBonusRecord, buffTotals)
      + calculateSkillDmgBonus('', parsedDamageBonusRecord, buffTotals)
      + (elementKey === 'physical' ? (characterDamageBonus.allDmgBonus || 0) : 0);
    const amplifyRate = calculateAmplifyRate(elementKey, buffTotals);
    const fragileRate = calculateVulnerabilityRate(elementKey, buffTotals);
    const vulnerabilityRate = calculateFragileRate(elementKey, buffTotals);
    const comboDamageBonus = buffTotals.comboDamageBonus;
    const defenseZone = 0.5;
    const finalMultiplier = (config.baseMultiplier + buffTotals.multiplierBonus) * buffTotals.multiplierMultiplier;
    const expected = calculateBreakdown(panel.atk, finalMultiplier, 1 + panel.critRate * panel.critDmg, damageBonusRate, defenseZone, amplifyRate, fragileRate, vulnerabilityRate, comboDamageBonus);
    const nonCrit = calculateBreakdown(panel.atk, finalMultiplier, 1, damageBonusRate, defenseZone, amplifyRate, fragileRate, vulnerabilityRate, comboDamageBonus);

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
      buffs: toBuffRows(modifierBuffList),
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
  const buttonSnapshot = button.panelSnapshot;
  const panel = {
    atk: buttonSnapshot?.atk ?? snapshot?.atk ?? 0,
    critRate: buttonSnapshot?.critRate ?? snapshot?.critRate ?? 0.05,
    critDmg: buttonSnapshot?.critDmg ?? snapshot?.critDmg ?? 0.5,
  };
  const allBuffs = getButtonBuffs(button);
  const modifierBuffList = allBuffs.filter(isModifierBuff);
  const extraHitBuffList = allBuffs.filter(isExtraHitBuff);

  const normalHits = resolvedTemplate
    ? calculateSkillButtonDamageV2({
        buttonId: button.id,
        characterId: runtimeButton.characterId,
        runtimeSkillId: resolvedTemplate.runtimeSkillId,
        template: resolvedTemplate,
        buffs: modifierBuffList,
        panel,
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
        buffs: toBuffRows(hit.appliedBuffs),
      }))
    : [];

  const anomalyHits = buildAnomalyReportHits(
    button,
    damageBonus,
    panel,
    normalHits.length,
    modifierBuffList,
    extraHitBuffList
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
        `力量 ${draft.attributes.strength}　敏捷 ${draft.attributes.agility}　智力 ${draft.attributes.intelligence}　意志 ${draft.attributes.will}`,
        `攻击 ${draft.attributes.atk}　生命 ${draft.attributes.hp}`,
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
          panelSnapshot: null,
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
