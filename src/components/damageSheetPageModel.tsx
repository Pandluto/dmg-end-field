import type { SkillButton as RuntimeSkillButton, SkillButtonData, SkillType } from '../types';
import type { CharacterInputConfig, PersistedSkillButton, SkillButtonBuff } from '../types/storage';
import { getCharacterComputed, getCharacterConfig, getCharacterInput } from '../utils/storage';
import { getBuffById, getSkillButtonById, loadTimelineData } from '../core/repositories';
import { buildAnomalyStateDerivedBuffs, buildAnomalyStateSnapshotBuffs } from '../core/services/anomalyStateBuffs';
import { getAnomalyStateSnapshotsByIds } from '../core/services/anomalyStateSnapshotStorage';
import { resolveSkillDamageTemplate } from '../core/services/skillDamageTemplateResolver';
import { calculateSkillButtonDamageV2 } from '../core/calculators/skillButtonDamageCalculatorV2';
import type { HitCalcResult } from '../core/calculators/skillDamage.types';
import type { SupportedBuffZone } from '../core/domain/buffTypeRegistry';
import { buildAnomalyDamageSegments } from './CanvasBoard/skillButtonAnomalyDamage';

export const ENABLE_ADVANCED_SHEET_SIDEBAR = false;

interface SheetColumn {
  key: string;
  title: string;
  width: number;
  group: string;
  align?: 'left' | 'right' | 'center';
  sticky?: boolean;
}

export interface CharacterGroupRow {
  kind: 'character';
  id: string;
  characterId: string;
  characterName: string;
  title: string;
  subtitle: string;
  meta: string;
}

interface ButtonGroupRow {
  kind: 'button';
  id: string;
  buttonId: string;
  characterId: string;
  characterName: string;
  title: string;
  subtitle: string;
  meta: string;
}

export interface HitValueRow {
  kind: 'hit';
  id: string;
  characterId: string;
  buttonId: string;
  rowIndex: number;
  values: Record<string, string>;
  detail: HitRowDetail;
}

export type SheetRow = CharacterGroupRow | ButtonGroupRow | HitValueRow;

interface ButtonWithContext {
  button: SkillButtonData;
  staffIndex: number;
  characterName: string;
}

export interface WorkbookCellView {
  key: string;
  address: string;
  value: string;
  width: number;
  colSpan: number;
  rowSpan: number;
  align: 'left' | 'right' | 'center';
  kind: 'group' | 'header' | 'character' | 'button' | 'data';
  sourceRowId?: string;
  columnKey?: string;
}

export interface WorkbookRowView {
  key: string;
  rowNumber: number;
  kind: WorkbookCellView['kind'];
  cells: WorkbookCellView[];
  sourceRow?: SheetRow;
}

export interface SelectedWorkbookCell {
  address: string;
  value: string;
  sourceRowId?: string;
  columnKey?: string;
}

export interface SheetContextMenuState {
  x: number;
  y: number;
  target: 'sheet' | 'character' | 'group' | 'buff';
  characterId?: string;
  group?: string;
  buffId?: string;
}

export type SheetSidebarTab = 'related' | 'local' | 'anomaly' | 'state' | 'anomaly-state';
export type SheetOrderMode = 'character' | 'cast';
export type BuffFrameState = 'enabled' | 'disabled';
export type BuffFrameSpan = 'single' | 'start' | 'middle' | 'end';

export type DamageSheetContextMenuAction = {
  key: string;
  label: string;
  icon: 'delete' | 'cancel' | 'confirm';
  onSelect: () => void;
};

interface HitRowDetail {
  characterName: string;
  buttonName: string;
  hitLabel: string;
  hit: HitCalcResult['hit'];
  hitResult: HitCalcResult;
}

function formatInteger(value: number): string {
  return Number.isFinite(value) ? value.toFixed(0) : '-';
}

function formatRatio(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : '-';
}

function formatPercent(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '-';
}

function formatBuffEffectValue(type: string | undefined, value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '';
  }
  const sign = value >= 0 ? '+' : '';
  if (type === 'sourceSkillBoost') {
    return ` ${sign}${value.toFixed(1)}`;
  }
  return ` ${sign}${(value * 100).toFixed(1)}%`;
}

export function formatHitBuffContribution(hitResult: HitCalcResult, buff: SkillButtonBuff): string {
  const contribution = hitResult.buffContributions?.find((item) => item.buffId === buff.id);
  if (!contribution) {
    return `${buff.type || 'Buff'}${formatBuffEffectValue(buff.type, buff.value)}`;
  }
  if (contribution.multiplier) {
    return `${contribution.type} × ${(contribution.multiplierCoefficient ?? contribution.effectiveValue).toFixed(3)}`;
  }
  return `${contribution.type} · n ${contribution.rawValue.toFixed(3)} × k ${contribution.runtimeCoefficient.toFixed(3)} = kn ${contribution.effectiveValue.toFixed(3)}`;
}

function formatSkillLevels(input: CharacterInputConfig | null): string {
  if (!input) {
    return 'A - / B - / E - / Q - / Dot -';
  }
  return `A ${input.skillLevels.A} / B ${input.skillLevels.B} / E ${input.skillLevels.E} / Q ${input.skillLevels.Q} / Dot ${input.skillLevels.Dot ?? '-'}`;
}

function formatCharacterMeta(characterId: string): string {
  const input = getCharacterInput(characterId);
  const config = getCharacterConfig(characterId);
  const computed = getCharacterComputed(characterId);
  const sourceSkill = computed?.panel.sourceSkill ?? input?.equipment.sourceSkillBoost ?? 0;
  const weaponName = input?.weapon.name?.trim() || config?.weaponName || '未配置武器';
  const potential = input?.potential ?? config?.characterPotential ?? '未配置潜能';
  return `${potential} · ${weaponName} · 源石技艺 ${formatRatio(sourceSkill)}`;
}

export function buildColumns(): SheetColumn[] {
  return [
    { key: 'characterName', title: '干员', width: 112, group: '索引', sticky: true },
    { key: 'hitLabel', title: '命中', width: 64, group: '索引', sticky: true, align: 'center' },
    { key: 'skillType', title: '类型', width: 32, group: '索引', align: 'center' },
    { key: 'element', title: '属性', width: 32, group: '索引', align: 'center' },
    { key: 'baseMultiplier', title: '基础倍率', width: 76, group: '倍率区', align: 'right' },
    { key: 'bonusMultiplier', title: '加算倍率', width: 76, group: '倍率区', align: 'right' },
    { key: 'finalMultiplier', title: '最终倍率', width: 76, group: '倍率区', align: 'right' },
    { key: 'atk', title: '实时攻击', width: 82, group: '面板区', align: 'right' },
    { key: 'critRate', title: '暴击率', width: 64, group: '面板区', align: 'right' },
    { key: 'critDmg', title: '暴伤', width: 64, group: '面板区', align: 'right' },
    { key: 'sourceSkill', title: '源石技艺', width: 70, group: '面板区', align: 'right' },
    { key: 'damageBonusRate', title: '总加成', width: 68, group: '加成区', align: 'right' },
    { key: 'defenseZone', title: '防御区', width: 68, group: '乘区', align: 'right' },
    { key: 'resistanceZone', title: '抗性区', width: 68, group: '乘区', align: 'right' },
    { key: 'amplifyRate', title: '增幅区', width: 68, group: '乘区', align: 'right' },
    { key: 'fragileRate', title: '易伤区', width: 68, group: '乘区', align: 'right' },
    { key: 'vulnerabilityRate', title: '脆弱区', width: 68, group: '乘区', align: 'right' },
    { key: 'comboDamageBonus', title: '连击区', width: 68, group: '乘区', align: 'right' },
    { key: 'imbalanceDamageBonus', title: '失衡区', width: 68, group: '乘区', align: 'right' },
    { key: 'baseDamage', title: '基础伤害', width: 84, group: '结果区', align: 'right' },
    { key: 'nonCrit', title: '非暴伤害', width: 84, group: '结果区', align: 'right' },
    { key: 'crit', title: '暴击伤害', width: 84, group: '结果区', align: 'right' },
    { key: 'expected', title: '期望伤害', width: 84, group: '结果区', align: 'right' },
  ];
}

function sortButtonContextsByCastOrder(left: ButtonWithContext, right: ButtonWithContext): number {
  const xDiff = (left.button.position?.x ?? 0) - (right.button.position?.x ?? 0);
  if (Math.abs(xDiff) > 0.001) {
    return xDiff;
  }

  const yDiff = (left.button.position?.y ?? 0) - (right.button.position?.y ?? 0);
  if (Math.abs(yDiff) > 0.001) {
    return yDiff;
  }

  return (left.button.nodeIndex ?? 0) - (right.button.nodeIndex ?? 0);
}

function buildRuntimeButton(button: PersistedSkillButton): RuntimeSkillButton {
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
  };
}

export function getButtonBuffs(button: PersistedSkillButton): SkillButtonBuff[] {
  return (button.selectedBuff || [])
    .map((buffId) => getBuffById(buffId))
    .filter((buff): buff is SkillButtonBuff => Boolean(buff));
}

function buildDamagePanelBase(characterId: string) {
  const computedPanel = getCharacterComputed(characterId)?.panel;
  if (!computedPanel) {
    return undefined;
  }

  return {
    baseAtk: computedPanel.baseAtk,
    characterAtk: computedPanel.characterAtk,
    weaponAtk: computedPanel.weaponAtk,
    weaponAtkPercent: computedPanel.weaponAtkPercent,
    abilityBonus: computedPanel.abilityBonus,
    critRate: computedPanel.critRate ?? 0.05,
    critDmg: computedPanel.critDmg ?? 0.5,
    strength: computedPanel.strength,
    agility: computedPanel.agility,
    intelligence: computedPanel.intelligence,
    will: computedPanel.will,
    mainStatFinal: computedPanel.mainStatFinal,
    subStatFinal: computedPanel.subStatFinal,
    mainStatRaw: computedPanel.mainStatRaw,
    subStatRaw: computedPanel.subStatRaw,
    mainStatField: computedPanel.mainStatField,
    subStatField: computedPanel.subStatField,
    mainStatScale: computedPanel.mainStatScale,
    subStatScale: computedPanel.subStatScale,
    allStatScale: computedPanel.allStatScale,
  };
}

function getStructuredZoneForColumn(
  hitResult: HitCalcResult,
  columnKey: string
) {
  switch (columnKey) {
    case 'damageBonusRate':
      return hitResult.zones.damageBonus;
    case 'amplifyRate':
      return hitResult.zones.amplify;
    case 'fragileRate':
      return hitResult.zones.fragile;
    case 'vulnerabilityRate':
      return hitResult.zones.vulnerability;
    case 'baseMultiplier':
    case 'bonusMultiplier':
    case 'finalMultiplier':
      return hitResult.zones.skillMultiplier;
    default:
      return undefined;
  }
}

function getZoneFinalValue(hitResult: HitCalcResult, zone: SupportedBuffZone): number {
  switch (zone) {
    case 'damageBonus':
      return hitResult.zones.damageBonus?.finalValue ?? hitResult.zones.damageBonusRate;
    case 'amplify':
      return hitResult.zones.amplify?.finalValue ?? 1 + hitResult.zones.amplifyRate;
    case 'fragile':
      return hitResult.zones.fragile?.finalValue ?? 1 + hitResult.zones.fragileRate;
    case 'vulnerability':
      return hitResult.zones.vulnerability?.finalValue ?? 1 + hitResult.zones.vulnerabilityRate;
    case 'skillMultiplier':
      return hitResult.zones.skillMultiplier?.finalValue ?? hitResult.multiplier.afterMultiply;
  }
}

function formatStructuredZoneFormula(hitResult: HitCalcResult, columnKey: string): string | null {
  const zone = getStructuredZoneForColumn(hitResult, columnKey);
  if (!zone) {
    return null;
  }
  const isSkillMultiplier = columnKey === 'baseMultiplier'
    || columnKey === 'bonusMultiplier'
    || columnKey === 'finalMultiplier';
  const baseValue = isSkillMultiplier
    ? hitResult.multiplier.base
    : zone.finalValue - zone.additiveTotal * zone.multiplierProduct;
  return `${baseValue.toFixed(3)} + ${zone.multiplierProduct.toFixed(3)} × ${zone.additiveTotal.toFixed(3)} = ${zone.finalValue.toFixed(3)}`;
}

function parsePercentText(value: string): number {
  const numeric = Number(value.replace('%', '').trim());
  return Number.isFinite(numeric) ? numeric / 100 : 0;
}

function parseNumberText(value: string): number {
  const numeric = Number(value.replace('%', '').trim());
  return Number.isFinite(numeric) ? numeric : 0;
}

function isDamageBonusBuffForHit(buff: SkillButtonBuff, hit: HitCalcResult['hit']): boolean {
  switch (buff.type) {
    case 'allDmgBonus':
      return true;
    case 'physicalDmgBonus':
      return hit.element === 'physical';
    case 'magicDmgBonus':
      return hit.element !== 'physical';
    case 'fireDmgBonus':
      return hit.element === 'fire';
    case 'electricDmgBonus':
      return hit.element === 'electric';
    case 'iceDmgBonus':
      return hit.element === 'ice';
    case 'natureDmgBonus':
      return hit.element === 'nature';
    case 'allElementDmgBonus':
      return hit.element !== 'physical';
    case 'normalAttackDmgBonus':
      return hit.skillType === 'A';
    case 'dotDmgBonus':
      return hit.skillType === 'Dot';
    case 'skillDmgBonus':
      return hit.skillType === 'B';
    case 'chainSkillDmgBonus':
      return hit.skillType === 'E';
    case 'ultimateDmgBonus':
      return hit.skillType === 'Q';
    case 'allSkillDmgBonus':
      return hit.skillType !== 'A' && hit.skillType !== 'Dot';
    default:
      return false;
  }
}

function isAmplifyBuffForHit(buff: SkillButtonBuff, hit: HitCalcResult['hit']): boolean {
  switch (buff.type) {
    case 'physicalAmplify':
      return hit.element === 'physical';
    case 'magicAmplify':
      return hit.element !== 'physical';
    case 'fireAmplify':
      return hit.element === 'fire';
    case 'electricAmplify':
      return hit.element === 'electric';
    case 'iceAmplify':
      return hit.element === 'ice';
    case 'natureAmplify':
      return hit.element === 'nature';
    default:
      return false;
  }
}

function isFragileBuffForHit(buff: SkillButtonBuff, hit: HitCalcResult['hit']): boolean {
  switch (buff.type) {
    case 'physicalFragile':
      return hit.element === 'physical';
    case 'magicFragile':
      return hit.element !== 'physical';
    case 'fireFragile':
      return hit.element === 'fire';
    case 'electricFragile':
      return hit.element === 'electric';
    case 'iceFragile':
      return hit.element === 'ice';
    case 'natureFragile':
      return hit.element === 'nature';
    default:
      return false;
  }
}

function isVulnerabilityBuffForHit(buff: SkillButtonBuff, hit: HitCalcResult['hit']): boolean {
  switch (buff.type) {
    case 'physicalVulnerability':
      return hit.element === 'physical';
    case 'magicVulnerability':
      return hit.element !== 'physical';
    case 'fireVulnerability':
      return hit.element === 'fire';
    case 'electricVulnerability':
      return hit.element === 'electric';
    case 'iceVulnerability':
      return hit.element === 'ice';
    case 'natureVulnerability':
      return hit.element === 'nature';
    default:
      return false;
  }
}

function isResistanceBuffForHit(buff: SkillButtonBuff, hit: HitCalcResult['hit']): boolean {
  switch (buff.type) {
    case 'allCorrosion':
    case 'allResistanceIgnore':
      return true;
    case 'physicalCorrosion':
    case 'physicalResistanceIgnore':
      return hit.element === 'physical';
    case 'magicCorrosion':
    case 'magicResistanceIgnore':
      return hit.element !== 'physical';
    case 'fireCorrosion':
    case 'fireResistanceIgnore':
      return hit.element === 'fire';
    case 'electricCorrosion':
    case 'electricResistanceIgnore':
      return hit.element === 'electric';
    case 'iceCorrosion':
    case 'iceResistanceIgnore':
      return hit.element === 'ice';
    case 'natureCorrosion':
    case 'natureResistanceIgnore':
      return hit.element === 'nature';
    default:
      return false;
  }
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
      return '-';
  }
}

function buildHitRowsForButton(
  persistedButton: PersistedSkillButton,
  characterId: string,
  characterName: string,
  rowIndexStart: number
): HitValueRow[] {
  const runtimeButton = buildRuntimeButton(persistedButton);
  const template = resolveSkillDamageTemplate(runtimeButton);
  const characterConfig = getCharacterConfig(characterId);
  const computed = getCharacterComputed(characterId);
  const snapshot = characterConfig?.panelSnapshot;
  const buttonSnapshot = persistedButton.runtimeSnapshot;

  if (!template || !snapshot) {
    return [];
  }

  const globallyDisabledBuffIds = new Set(persistedButton.panelConfig?.globallyDisabledBuffIds ?? []);
  const baseBuffs = getButtonBuffs(persistedButton)
    .filter((buff) => !globallyDisabledBuffIds.has(buff.id));
  const anomalyStatuses = persistedButton.anomalyConfig?.selectedStatuses ?? [];
  const anomalyStateSnapshots = getAnomalyStateSnapshotsByIds(persistedButton.anomalyConfig?.selectedStateSnapshotIds ?? []);
  const combinedBuffs = [
    ...baseBuffs.filter((buff) => buff.effectKind !== 'extraHit'),
    ...buildAnomalyStateDerivedBuffs(anomalyStatuses, persistedButton.skillType),
    ...buildAnomalyStateSnapshotBuffs(anomalyStateSnapshots),
  ];

  const disabledBuffIdsByHitKey = template.hits.length > 0
    ? Object.fromEntries(
        template.hits.map((hit) => [
          hit.key,
          persistedButton.panelConfig?.manualDisabledBuffIdsBySegmentKey?.[`normal-hit-${hit.key}`] ?? [],
        ])
      )
    : undefined;

  const result = calculateSkillButtonDamageV2({
    buttonId: persistedButton.id,
    characterId,
    runtimeSkillId: template.runtimeSkillId,
    template,
    buffs: combinedBuffs,
    panel: {
      atk: buttonSnapshot?.atk ?? snapshot.atk ?? 0,
      critRate: buttonSnapshot?.critRate ?? snapshot.critRate ?? 0.05,
      critDmg: buttonSnapshot?.critDmg ?? snapshot.critDmg ?? 0.5,
    },
    panelBase: buildDamagePanelBase(characterId),
    disabledBuffIdsByHitKey,
    targetResistance: persistedButton.resistanceConfig?.targetResistance,
    damageBonus: characterConfig?.infoSnap ?? {
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
    },
  });

  const normalRows: HitValueRow[] = result.hits.map((hit, index) => ({
    kind: 'hit',
    id: `${persistedButton.id}-${hit.hit.key}-${index}`,
    characterId,
    buttonId: persistedButton.id,
    rowIndex: rowIndexStart + index,
    values: {
      characterName,
      hitLabel: hit.hit.displayName || hit.hit.key || `第${index + 1}击`,
      skillType: hit.hit.skillType,
      element: formatElementLabel(hit.hit.element),
      baseMultiplier: formatPercent(hit.multiplier.base),
      bonusMultiplier: formatPercent(hit.multiplier.afterBonus - hit.multiplier.base),
      finalMultiplier: formatPercent(hit.multiplier.afterMultiply),
      atk: formatInteger(hit.panel.atk),
      critRate: formatPercent(hit.panel.critRate),
      critDmg: formatPercent(hit.panel.critDmg),
      sourceSkill: formatRatio(computed?.panel.sourceSkill ?? 0),
      damageBonusRate: formatRatio(getZoneFinalValue(hit, 'damageBonus')),
      defenseZone: formatRatio(hit.zones.defenseZone),
      resistanceZone: formatRatio(hit.zones.resistanceZone),
      amplifyRate: formatRatio(getZoneFinalValue(hit, 'amplify')),
      fragileRate: formatRatio(getZoneFinalValue(hit, 'fragile')),
      vulnerabilityRate: formatRatio(getZoneFinalValue(hit, 'vulnerability')),
      comboDamageBonus: formatRatio(1 + hit.zones.comboDamageBonus),
      imbalanceDamageBonus: formatRatio(1 + hit.zones.imbalanceDamageBonus),
      baseDamage: formatInteger(hit.nonCrit.base),
      nonCrit: formatInteger(hit.nonCrit.final),
      crit: formatInteger(hit.crit.final),
      expected: formatInteger(hit.expected.final),
    },
    detail: {
      characterName,
      buttonName: persistedButton.skillDisplayName || persistedButton.skillType,
      hitLabel: hit.hit.displayName || hit.hit.key || `第${index + 1}击`,
      hit: hit.hit,
      hitResult: hit,
    },
  }));

  const damageBonus = characterConfig?.infoSnap ?? {
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
  const baseSourceSkill = computed?.panel.sourceSkill ?? 0;
  const panelBase = buildDamagePanelBase(characterId) ?? null;
  const anomalySegments = buildAnomalyDamageSegments({
    panelBase,
    panelData: {
      atk: buttonSnapshot?.atk ?? snapshot.atk ?? 0,
      critRate: buttonSnapshot?.critRate ?? snapshot.critRate ?? 0.05,
      critDmg: buttonSnapshot?.critDmg ?? snapshot.critDmg ?? 0.5,
    },
    hitCards: result.hits.map((hit) => ({
      displayName: hit.hit.displayName || hit.hit.key,
      nonCritText: formatInteger(hit.nonCrit.final),
    })),
    selectedAnomalyDamages: persistedButton.anomalyConfig?.selectedDamages ?? [],
    buttonCharacterId: characterId,
    element: undefined,
    damageBonus,
    targetResistance: persistedButton.resistanceConfig?.targetResistance,
    fullCombinedModifierBuffList: combinedBuffs,
    extraHitBuffList: [],
    manuallyDisabledBuffIdsBySegmentKey: persistedButton.panelConfig?.manualDisabledBuffIdsBySegmentKey ?? {},
    getEffectiveCharacterSourceSkillBoost: (_sourceCharacterId, buffs = []) => (
      baseSourceSkill + buffs.reduce((sum, buff) => (
        buff.type === 'sourceSkillBoost' && typeof buff.value === 'number'
          ? sum + buff.value
          : sum
      ), 0)
    ),
  });

  const anomalyRows = anomalySegments.map((segment, index): HitValueRow => {
    const baseMultiplier = parsePercentText(segment.baseMultiplierText);
    const finalMultiplier = parsePercentText(segment.multiplierText);
    const panelAtk = parseNumberText(segment.panelAtkText);
    const critRate = parsePercentText(segment.critRateText);
    const critDmg = parsePercentText(segment.critDmgText);
    const resistanceBase = parseNumberText(segment.resistanceBaseText);
    const corrosion = parseNumberText(segment.corrosionText);
    const resistanceIgnore = parseNumberText(segment.resistanceIgnoreText);
    const resistanceZone = parseNumberText(segment.resistanceZoneText);
    const hitResult: HitCalcResult = {
      hit: {
        key: segment.key,
        displayName: segment.compactTitle,
        multiplier: baseMultiplier,
        element: segment.elementKey as HitCalcResult['hit']['element'],
        skillType: persistedButton.skillType as HitCalcResult['hit']['skillType'],
      },
      isDisabled: false,
      appliedBuffs: combinedBuffs,
      panel: {
        atk: panelAtk,
        critRate,
        critDmg,
      },
      multiplier: {
        base: baseMultiplier,
        afterBonus: finalMultiplier,
        afterMultiply: finalMultiplier,
      },
      zones: {
        elementBonus: parsePercentText(segment.elementBonusText),
        skillBonus: parsePercentText(segment.skillBonusText),
        allDamageBonus: parsePercentText(segment.allDamageBonusText),
        damageBonusRate: parseNumberText(segment.damageBonusRateText),
        amplifyRate: parseNumberText(segment.amplifyRateText),
        fragileRate: parseNumberText(segment.fragileRateText),
        vulnerabilityRate: parseNumberText(segment.vulnerabilityRateText),
        comboDamageBonus: parseNumberText(segment.comboDamageBonusText),
        imbalanceDamageBonus: parseNumberText(segment.imbalanceDamageBonusText),
        defenseZone: parseNumberText(segment.defenseZoneText),
        resistanceZone,
        resistance: {
          baseResistance: resistanceBase,
          corrosion,
          resistanceIgnore,
          effectiveResistance: resistanceBase - corrosion,
          resistanceZone,
          formulaText: segment.resistanceFormulaText,
        },
      },
      nonCrit: {
        base: panelAtk * finalMultiplier,
        afterCrit: panelAtk * finalMultiplier,
        afterBonus: 0,
        afterDefense: 0,
        afterResistance: 0,
        afterAmplify: 0,
        afterFragile: 0,
        afterVulnerability: 0,
        final: segment.nonCritValue,
      },
      crit: {
        base: panelAtk * finalMultiplier,
        afterCrit: 0,
        afterBonus: 0,
        afterDefense: 0,
        afterResistance: 0,
        afterAmplify: 0,
        afterFragile: 0,
        afterVulnerability: 0,
        final: segment.critValue,
      },
      expected: {
        base: panelAtk * finalMultiplier,
        afterCrit: 0,
        afterBonus: 0,
        afterDefense: 0,
        afterResistance: 0,
        afterAmplify: 0,
        afterFragile: 0,
        afterVulnerability: 0,
        final: segment.expectedValue,
      },
    };

    return {
      kind: 'hit',
      id: `${persistedButton.id}-${segment.key}`,
      characterId,
      buttonId: persistedButton.id,
      rowIndex: rowIndexStart + normalRows.length + index,
      values: {
        characterName,
        hitLabel: segment.compactTitle,
        skillType: '异常',
        element: segment.elementText,
        baseMultiplier: segment.baseMultiplierText,
        bonusMultiplier: formatPercent(finalMultiplier - baseMultiplier),
        finalMultiplier: segment.multiplierText,
        atk: segment.panelAtkText,
        critRate: segment.critRateText,
        critDmg: segment.critDmgText,
        sourceSkill: segment.sourceSkillBoostText,
        damageBonusRate: segment.damageBonusRateText,
        defenseZone: segment.defenseZoneText,
        resistanceZone: formatRatio(resistanceZone),
        amplifyRate: formatRatio(1 + parseNumberText(segment.amplifyRateText)),
        fragileRate: formatRatio(1 + parseNumberText(segment.fragileRateText)),
        vulnerabilityRate: formatRatio(1 + parseNumberText(segment.vulnerabilityRateText)),
        comboDamageBonus: formatRatio(1 + parseNumberText(segment.comboDamageBonusText)),
        imbalanceDamageBonus: formatRatio(1 + parseNumberText(segment.imbalanceDamageBonusText)),
        baseDamage: formatInteger(panelAtk * finalMultiplier),
        nonCrit: segment.nonCritText,
        crit: segment.critText,
        expected: segment.expectedText,
      },
      detail: {
        characterName,
        buttonName: persistedButton.skillDisplayName || persistedButton.skillType,
        hitLabel: segment.compactTitle,
        hit: hitResult.hit,
        hitResult,
      },
    };
  });

  return [...normalRows, ...anomalyRows];
}

function toPersistedButton(item: ButtonWithContext): PersistedSkillButton {
  return getSkillButtonById(item.button.id) ?? {
    id: item.button.id,
    characterId: item.button.characterId || item.button.characterName,
    characterName: item.button.characterName,
    skillType: item.button.skillType,
    staffIndex: item.staffIndex,
    nodeIndex: item.button.nodeIndex,
    nodeNumber: item.button.nodeNumber,
    position: item.button.position,
    runtimeSkillId: item.button.runtimeSkillId,
    skillDisplayName: item.button.skillDisplayName,
    skillIconUrl: item.button.skillIconUrl,
    customHits: item.button.customHits,
    selectedBuff: [],
    panelConfig: { selectedBuff: [] },
    runtimeSnapshot: null,
  };
}

export function buildSheetRows(
  selectedCharacters: Array<{ id: string; name: string }>,
  orderMode: SheetOrderMode
): { rows: SheetRow[]; totalHitCount: number } {
  const timelineData = loadTimelineData();
  if (!timelineData) {
    return { rows: [], totalHitCount: 0 };
  }

  const flattenedButtons = timelineData.staffLines.flatMap((staffLine) => (
    (Array.isArray(staffLine.buttons) ? staffLine.buttons : []).map((button) => ({
      button,
      staffIndex: staffLine.staffIndex,
      characterName: staffLine.characterName,
    }))
  ));

  const rows: SheetRow[] = [];
  let totalHitCount = 0;
  let rowIndex = 1;

  const selectedCharacterMap = new Map(
    selectedCharacters.map((character) => [character.name, character])
  );

  const pushCharacterRow = (character: { id: string; name: string }) => {
    rows.push({
      kind: 'character',
      id: `character-${character.id}`,
      characterId: character.id,
      characterName: character.name,
      title: character.name,
      subtitle: formatSkillLevels(getCharacterInput(character.id)),
      meta: formatCharacterMeta(character.id),
    });
  };

  const pushButtonRows = (
    character: { id: string; name: string },
    item: ButtonWithContext,
    buttonIndex: number
  ) => {
    const persistedButton = toPersistedButton(item);
    const buttonName = persistedButton.skillDisplayName || persistedButton.skillType;
    const hitRows = buildHitRowsForButton(
      persistedButton,
      character.id,
      character.name,
      rowIndex
    );

    rows.push({
      kind: 'button',
      id: `button-${persistedButton.id}`,
      buttonId: persistedButton.id,
      characterId: character.id,
      characterName: character.name,
      title: `${persistedButton.skillType} / ${buttonName}`,
      subtitle: `按钮 ${buttonIndex} · 节点 ${persistedButton.nodeNumber}`,
      meta: `${hitRows.length} 段命中 · 期望总伤 ${formatInteger(hitRows.reduce((sum, row) => sum + Number(row.values.expected || 0), 0))}`,
    });

    rows.push(...hitRows);
    totalHitCount += hitRows.length;
    rowIndex += hitRows.length;
  };

  if (orderMode === 'cast') {
    const castOrderedButtons = flattenedButtons
      .filter((item) => selectedCharacterMap.has(item.characterName))
      .sort(sortButtonContextsByCastOrder);

    castOrderedButtons.forEach((item, index) => {
      const character = selectedCharacterMap.get(item.characterName);
      if (!character) {
        return;
      }
      pushButtonRows(character, item, index + 1);
    });
  } else {
    selectedCharacters.forEach((character) => {
      const characterButtons = flattenedButtons
        .filter((item) => item.characterName === character.name)
        .sort((left, right) => {
          const leftNode = left.button.nodeIndex ?? 0;
          const rightNode = right.button.nodeIndex ?? 0;
          if (leftNode !== rightNode) {
            return leftNode - rightNode;
          }
          return (left.button.position?.y ?? 0) - (right.button.position?.y ?? 0);
        });

      if (characterButtons.length === 0) {
        return;
      }

      pushCharacterRow(character);
      characterButtons.forEach((item, buttonIndex) => {
        pushButtonRows(character, item, buttonIndex + 1);
      });
    });
  }

  return { rows, totalHitCount };
}

function buildColumnGroups(columns: SheetColumn[]): Array<{ group: string; width: number; count: number }> {
  const groups: Array<{ group: string; width: number; count: number }> = [];
  columns.forEach((column) => {
    const existing = groups[groups.length - 1];
    if (existing && existing.group === column.group) {
      existing.width += column.width;
      existing.count += 1;
      return;
    }
    groups.push({ group: column.group, width: column.width, count: 1 });
  });
  return groups;
}

function columnIndexToLabel(index: number): string {
  let current = index + 1;
  let label = '';
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }
  return label;
}

function buildWorkbookSheet(rows: SheetRow[], columns: SheetColumn[]): WorkbookRowView[] {
  const columnGroups = buildColumnGroups(columns);
  const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
  let groupStartColumn = 0;
  const groupRow: WorkbookRowView = {
    key: 'row-1',
    rowNumber: 1,
    kind: 'group',
    cells: columnGroups.map((group) => {
      const startColumn = groupStartColumn;
      groupStartColumn += group.count;
      return {
        key: `1-${startColumn + 1}`,
        address: `${columnIndexToLabel(startColumn)}1`,
        value: group.group,
        width: group.width,
        colSpan: group.count,
        rowSpan: 1,
        align: 'center',
        kind: 'group',
      };
    }),
  };
  const headerRow: WorkbookRowView = {
    key: 'row-2',
    rowNumber: 2,
    kind: 'header',
    cells: columns.map((column, columnIndex) => ({
      key: `2-${columnIndex + 1}`,
      address: `${columnIndexToLabel(columnIndex)}2`,
      value: column.title,
      width: column.width,
      colSpan: 1,
      rowSpan: 1,
      align: column.align ?? 'left',
      kind: 'header',
    })),
  };
  const dataRows = rows.map<WorkbookRowView>((row, rowIndex) => {
    const rowNumber = rowIndex + 3;
    const rowKind = row.kind === 'character' ? 'character' : row.kind === 'button' ? 'button' : 'data';
    if (row.kind !== 'hit') {
      return {
        key: `row-${rowNumber}`,
        rowNumber,
        kind: rowKind,
        sourceRow: row,
        cells: [{
          key: `${rowNumber}-1`,
          address: `A${rowNumber}`,
          value: row.title,
          width: totalWidth,
          colSpan: columns.length,
          rowSpan: 1,
          align: 'left',
          kind: rowKind,
        }],
      };
    }
    return {
      key: `row-${rowNumber}`,
      rowNumber,
      kind: 'data',
      sourceRow: row,
      cells: columns.map((column, columnIndex) => ({
        key: `${rowNumber}-${columnIndex + 1}`,
        address: `${columnIndexToLabel(columnIndex)}${rowNumber}`,
        value: row.values[column.key] ?? '',
        width: column.width,
        colSpan: 1,
        rowSpan: 1,
        align: column.align ?? 'left',
        kind: 'data',
        sourceRowId: row.id,
        columnKey: column.key,
      })),
    };
  });
  return [groupRow, headerRow, ...dataRows];
}

export function filterRelevantBuffsForColumn(
  buffs: SkillButtonBuff[],
  hit: HitCalcResult['hit'],
  columnKey: string,
): SkillButtonBuff[] {
  switch (columnKey) {
    case 'atk':
      return buffs.filter((buff) => ['atkPercentBoost', 'flatAtk', 'mainStatBoost', 'subStatBoost', 'allStatBoost', 'strengthBoost', 'agilityBoost', 'intelligenceBoost', 'willBoost'].includes(buff.type || ''));
    case 'critRate':
      return buffs.filter((buff) => buff.type === 'critRateBoost');
    case 'critDmg':
      return buffs.filter((buff) => buff.type === 'critDmgBonusBoost');
    case 'baseMultiplier':
    case 'bonusMultiplier':
    case 'finalMultiplier':
      return buffs.filter((buff) => buff.type === 'multiplierBonus' || buff.type === 'multiplierMultiplier');
    case 'damageBonusRate':
      return buffs.filter((buff) => isDamageBonusBuffForHit(buff, hit));
    case 'resistanceZone':
      return buffs.filter((buff) => isResistanceBuffForHit(buff, hit));
    case 'amplifyRate':
      return buffs.filter((buff) => isAmplifyBuffForHit(buff, hit));
    case 'fragileRate':
      return buffs.filter((buff) => isFragileBuffForHit(buff, hit));
    case 'vulnerabilityRate':
      return buffs.filter((buff) => isVulnerabilityBuffForHit(buff, hit));
    case 'comboDamageBonus':
      return buffs.filter((buff) => buff.type === 'comboDamageBonus');
    case 'imbalanceDamageBonus':
      return buffs.filter((buff) => buff.type === 'imbalanceDmgBonus');
    default:
      return buffs;
  }
}

export function getRelevantBuffsForColumn(hitRow: HitValueRow, columnKey: string): SkillButtonBuff[] {
  const { detail } = hitRow;
  const structuredZone = getStructuredZoneForColumn(detail.hitResult, columnKey);
  if (structuredZone) {
    const contributionIds = new Set([
      ...structuredZone.additiveContributions,
      ...structuredZone.multiplierContributions,
    ].map((contribution) => contribution.buffId));
    return detail.hitResult.appliedBuffs.filter((buff) => contributionIds.has(buff.id));
  }
  return filterRelevantBuffsForColumn(detail.hitResult.appliedBuffs, detail.hit, columnKey);
}

export function getHighlightColumnKeyForBuff(buff: SkillButtonBuff | null): string | null {
  if (buff?.multiplier) {
    switch (buff.type) {
      case 'multiplierBonus':
        return 'finalMultiplier';
      case 'physicalDmgBonus':
      case 'magicDmgBonus':
      case 'fireDmgBonus':
      case 'electricDmgBonus':
      case 'iceDmgBonus':
      case 'natureDmgBonus':
      case 'allElementDmgBonus':
      case 'normalAttackDmgBonus':
      case 'dotDmgBonus':
      case 'skillDmgBonus':
      case 'chainSkillDmgBonus':
      case 'ultimateDmgBonus':
      case 'allSkillDmgBonus':
      case 'allDmgBonus':
        return 'damageBonusRate';
      case 'physicalAmplify':
      case 'magicAmplify':
      case 'fireAmplify':
      case 'electricAmplify':
      case 'iceAmplify':
      case 'natureAmplify':
        return 'amplifyRate';
      case 'physicalFragile':
      case 'magicFragile':
      case 'fireFragile':
      case 'electricFragile':
      case 'iceFragile':
      case 'natureFragile':
        return 'fragileRate';
      case 'physicalVulnerability':
      case 'magicVulnerability':
      case 'fireVulnerability':
      case 'electricVulnerability':
      case 'iceVulnerability':
      case 'natureVulnerability':
        return 'vulnerabilityRate';
    }
  }
  switch (buff?.type) {
    case 'atkPercentBoost':
    case 'flatAtk':
    case 'mainStatBoost':
    case 'subStatBoost':
    case 'allStatBoost':
    case 'strengthBoost':
    case 'agilityBoost':
    case 'intelligenceBoost':
    case 'willBoost':
      return 'atk';
    case 'critRateBoost':
      return 'critRate';
    case 'critDmgBonusBoost':
      return 'critDmg';
    case 'multiplierBonus':
      return 'bonusMultiplier';
    case 'multiplierMultiplier':
      return 'finalMultiplier';
    case 'physicalDmgBonus':
    case 'magicDmgBonus':
    case 'fireDmgBonus':
    case 'electricDmgBonus':
    case 'iceDmgBonus':
    case 'natureDmgBonus':
    case 'allElementDmgBonus':
    case 'normalAttackDmgBonus':
    case 'dotDmgBonus':
    case 'skillDmgBonus':
    case 'chainSkillDmgBonus':
    case 'ultimateDmgBonus':
    case 'allSkillDmgBonus':
    case 'allDmgBonus':
      return 'damageBonusRate';
    case 'physicalAmplify':
    case 'magicAmplify':
    case 'fireAmplify':
    case 'electricAmplify':
    case 'iceAmplify':
    case 'natureAmplify':
      return 'amplifyRate';
    case 'allCorrosion':
    case 'physicalCorrosion':
    case 'magicCorrosion':
    case 'fireCorrosion':
    case 'electricCorrosion':
    case 'iceCorrosion':
    case 'natureCorrosion':
    case 'physicalResistanceIgnore':
    case 'magicResistanceIgnore':
    case 'fireResistanceIgnore':
    case 'electricResistanceIgnore':
    case 'iceResistanceIgnore':
    case 'natureResistanceIgnore':
    case 'allResistanceIgnore':
      return 'resistanceZone';
    case 'physicalFragile':
    case 'magicFragile':
    case 'fireFragile':
    case 'electricFragile':
    case 'iceFragile':
    case 'natureFragile':
      return 'fragileRate';
    case 'physicalVulnerability':
    case 'magicVulnerability':
    case 'fireVulnerability':
    case 'electricVulnerability':
    case 'iceVulnerability':
    case 'natureVulnerability':
      return 'vulnerabilityRate';
    case 'comboDamageBonus':
      return 'comboDamageBonus';
    case 'imbalanceDmgBonus':
      return 'imbalanceDamageBonus';
    case 'sourceSkillBoost':
      return 'sourceSkill';
    default:
      return null;
  }
}

export function summarizeBuffFrameStates(states: BuffFrameState[]): BuffFrameState | null {
  if (states.length === 0) {
    return null;
  }
  return states.every((state) => state === 'disabled') ? 'disabled' : 'enabled';
}

export function buildFormulaText(hitRow: HitValueRow | null, columnKey: string | undefined, fallback: string): string {
  if (!hitRow || !columnKey) {
    return fallback;
  }

  const { hitResult } = hitRow.detail;
  const structuredFormula = formatStructuredZoneFormula(hitResult, columnKey);
  if (structuredFormula) {
    return structuredFormula;
  }

  switch (columnKey) {
    case 'fragileRate': {
      const buffs = getRelevantBuffsForColumn(hitRow, columnKey);
      const pieces = ['1.000', ...buffs.map((buff) => `${buff.value && buff.value >= 0 ? '+' : ''}${(buff.value ?? 0).toFixed(3)}`)];
      return `${pieces.join(' ')} = ${(1 + hitResult.zones.fragileRate).toFixed(3)}`;
    }
    case 'vulnerabilityRate': {
      const buffs = getRelevantBuffsForColumn(hitRow, columnKey);
      const pieces = ['1.000', ...buffs.map((buff) => `${buff.value && buff.value >= 0 ? '+' : ''}${(buff.value ?? 0).toFixed(3)}`)];
      return `${pieces.join(' ')} = ${(1 + hitResult.zones.vulnerabilityRate).toFixed(3)}`;
    }
    case 'amplifyRate': {
      const buffs = getRelevantBuffsForColumn(hitRow, columnKey);
      const pieces = ['1.000', ...buffs.map((buff) => `${buff.value && buff.value >= 0 ? '+' : ''}${(buff.value ?? 0).toFixed(3)}`)];
      return `${pieces.join(' ')} = ${(1 + hitResult.zones.amplifyRate).toFixed(3)}`;
    }
    case 'damageBonusRate':
      return `1.000 + ${hitResult.zones.elementBonus.toFixed(3)} + ${hitResult.zones.skillBonus.toFixed(3)} + ${hitResult.zones.allDamageBonus.toFixed(3)} = ${hitResult.zones.damageBonusRate.toFixed(3)}`;
    case 'resistanceZone':
      return hitResult.zones.resistance.formulaText;
    case 'bonusMultiplier':
      return `${formatPercent(hitResult.multiplier.afterBonus - hitResult.multiplier.base)} = ${formatPercent(hitResult.multiplier.afterBonus)} - ${formatPercent(hitResult.multiplier.base)}`;
    case 'finalMultiplier':
      return `${formatPercent(hitResult.multiplier.afterBonus)} × ${(hitResult.multiplier.afterMultiply / Math.max(hitResult.multiplier.afterBonus, 0.0001)).toFixed(3)} = ${formatPercent(hitResult.multiplier.afterMultiply)}`;
    default:
      return fallback;
  }
}

export function buildWorkbookView(rows: SheetRow[], columns: SheetColumn[]): WorkbookRowView[] {
  return buildWorkbookSheet(rows, columns);
}
