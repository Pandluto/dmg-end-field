import { useCallback, useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import type { SkillButton as RuntimeSkillButton, SkillButtonData, SkillType } from '../types';
import type { CharacterInputConfig, PersistedSkillButton, SkillButtonBuff } from '../types/storage';
import { useAppContext } from '../context/AppContext';
import { getCharacterComputed, getCharacterConfig, getCharacterInput } from '../utils/storage';
import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import { getBuffById, getSkillButtonById, loadTimelineData, upsertSkillButton } from '../core/repositories';
import { buildAnomalyStateDerivedBuffs, buildAnomalyStateSnapshotBuffs } from '../core/services/anomalyStateBuffs';
import { getAnomalyStateSnapshotsByIds } from '../core/services/anomalyStateSnapshotStorage';
import { resolveSkillDamageTemplate } from '../core/services/skillDamageTemplateResolver';
import { calculateSkillButtonDamageV2 } from '../core/calculators/skillButtonDamageCalculatorV2';
import type { HitCalcResult } from '../core/calculators/skillDamage.types';
import { addSkillButtonBuff, recomputeSkillButtonPanel } from '../hooks/useSkillButtonBuffs';
import {
  type LocalBuffSearchResult,
  isModifierBuff,
  readLocalBuffSearchEntries,
} from './CanvasBoard/skillButton.shared';
import {
  SkillButtonAnomalyPanel,
  SkillButtonAnomalyStatePanel,
  SkillButtonStatePanel,
} from './CanvasBoard/SkillButtonAnomalyPanels';
import { useSkillButtonAnomaly } from './CanvasBoard/useSkillButtonAnomaly';
import './DamageSheetPage.css';

interface SheetColumn {
  key: string;
  title: string;
  width: number;
  group: string;
  align?: 'left' | 'right' | 'center';
  sticky?: boolean;
}

interface CharacterGroupRow {
  kind: 'character';
  id: string;
  characterName: string;
  title: string;
  subtitle: string;
  meta: string;
}

interface ButtonGroupRow {
  kind: 'button';
  id: string;
  characterId: string;
  title: string;
  subtitle: string;
  meta: string;
}

interface HitValueRow {
  kind: 'hit';
  id: string;
  characterId: string;
  buttonId: string;
  rowIndex: number;
  values: Record<string, string>;
  detail: HitRowDetail;
}

type SheetRow = CharacterGroupRow | ButtonGroupRow | HitValueRow;

interface ButtonWithContext {
  button: SkillButtonData;
  staffIndex: number;
  characterName: string;
}

interface WorkbookMergeInfo {
  master: boolean;
  colSpan: number;
  rowSpan: number;
  hidden: boolean;
}

interface WorkbookCellView {
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

interface WorkbookRowView {
  key: string;
  rowNumber: number;
  kind: WorkbookCellView['kind'];
  cells: WorkbookCellView[];
}

interface SelectedWorkbookCell {
  address: string;
  value: string;
  sourceRowId?: string;
  columnKey?: string;
}

type SheetSidebarTab = 'related' | 'local' | 'anomaly' | 'state' | 'anomaly-state';

interface UndoSnapshot {
  id: string;
  createdAt: number;
  label: string;
  sessionEntries: Array<[string, string]>;
}

const DAMAGE_SHEET_UNDO_KEY = 'def.damage-sheet.undo.v1';
const DAMAGE_SHEET_UNDO_LIMIT = 5;
const ENABLE_ADVANCED_SHEET_SIDEBAR = false;

interface WorkbookSheetBuildResult {
  workbook: ExcelJS.Workbook;
  worksheet: ExcelJS.Worksheet;
  mergeMap: Record<string, WorkbookMergeInfo>;
  rowKinds: Record<number, WorkbookCellView['kind']>;
  sheetRowsByWorksheetRow: Record<number, SheetRow>;
}

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

function formatSkillLevels(input: CharacterInputConfig | null): string {
  if (!input) {
    return 'A - / B - / E - / Q -';
  }
  return `A ${input.skillLevels.A} / B ${input.skillLevels.B} / E ${input.skillLevels.E} / Q ${input.skillLevels.Q}`;
}

function formatCharacterMeta(characterId: string): string {
  const input = getCharacterInput(characterId);
  const computed = getCharacterComputed(characterId);
  const sourceSkill = computed?.panel.sourceSkill ?? input?.equipment.sourceSkillBoost ?? 0;
  const weaponName = input?.weapon.name?.trim() || '未配置武器';
  const potential = input?.potential ?? '未配置潜能';
  return `${potential} · ${weaponName} · 源石技艺 ${formatRatio(sourceSkill)}`;
}

function buildColumns(): SheetColumn[] {
  return [
    { key: 'characterName', title: '干员', width: 112, group: '索引', sticky: true },
    { key: 'hitLabel', title: 'Hit', width: 64, group: '索引', sticky: true, align: 'center' },
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

function getButtonBuffs(button: PersistedSkillButton): SkillButtonBuff[] {
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
  };
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
    case 'skillDmgBonus':
      return hit.skillType === 'B';
    case 'chainSkillDmgBonus':
      return hit.skillType === 'E';
    case 'ultimateDmgBonus':
      return hit.skillType === 'Q';
    case 'allSkillDmgBonus':
      return hit.skillType !== 'A';
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
    case 'magicTakenDmgBonus':
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
  const buttonSnapshot = persistedButton.panelSnapshot;

  if (!template || !snapshot) {
    return [];
  }

  const baseBuffs = getButtonBuffs(persistedButton);
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
    damageBonus: characterConfig?.infoSnap ?? {
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
    },
  });

  return result.hits.map((hit, index) => ({
    kind: 'hit',
    id: `${persistedButton.id}-${hit.hit.key}-${index}`,
    characterId,
    buttonId: persistedButton.id,
    rowIndex: rowIndexStart + index,
    values: {
      characterName,
      hitLabel: hit.hit.displayName || hit.hit.key || `Hit ${index + 1}`,
      skillType: hit.hit.skillType,
      element: formatElementLabel(hit.hit.element),
      baseMultiplier: formatPercent(hit.multiplier.base),
      bonusMultiplier: formatPercent(hit.multiplier.afterBonus - hit.multiplier.base),
      finalMultiplier: formatPercent(hit.multiplier.afterMultiply),
      atk: formatInteger(hit.panel.atk),
      critRate: formatPercent(hit.panel.critRate),
      critDmg: formatPercent(hit.panel.critDmg),
      sourceSkill: formatRatio(computed?.panel.sourceSkill ?? 0),
      damageBonusRate: formatRatio(hit.zones.damageBonusRate),
      defenseZone: formatRatio(hit.zones.defenseZone),
      amplifyRate: formatRatio(1 + hit.zones.amplifyRate),
      fragileRate: formatRatio(1 + hit.zones.vulnerabilityRate),
      vulnerabilityRate: formatRatio(1 + hit.zones.fragileRate),
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
      hitLabel: hit.hit.displayName || hit.hit.key || `Hit ${index + 1}`,
      hit: hit.hit,
      hitResult: hit,
    },
  }));
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
    panelSnapshot: null,
  };
}

function buildSheetRows(
  selectedCharacters: Array<{ id: string; name: string }>
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

    rows.push({
      kind: 'character',
      id: `character-${character.id}`,
      characterName: character.name,
      title: character.name,
      subtitle: formatSkillLevels(getCharacterInput(character.id)),
      meta: formatCharacterMeta(character.id),
    });

    characterButtons.forEach((item, buttonIndex) => {
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
        characterId: character.id,
        title: `${persistedButton.skillType} / ${buttonName}`,
        subtitle: `按钮 ${buttonIndex + 1} · 节点 ${persistedButton.nodeNumber}`,
        meta: `${hitRows.length} 个 Hit · 期望总伤 ${formatInteger(hitRows.reduce((sum, row) => sum + Number(row.values.expected || 0), 0))}`,
      });

      rows.push(...hitRows);
      totalHitCount += hitRows.length;
      rowIndex += hitRows.length;
    });
  });

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

function registerMerge(
  mergeMap: Record<string, WorkbookMergeInfo>,
  rowStart: number,
  colStart: number,
  rowEnd: number,
  colEnd: number
): void {
  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let col = colStart; col <= colEnd; col += 1) {
      mergeMap[`${row}:${col}`] = {
        master: row === rowStart && col === colStart,
        colSpan: colEnd - colStart + 1,
        rowSpan: rowEnd - rowStart + 1,
        hidden: !(row === rowStart && col === colStart),
      };
    }
  }
}

function buildWorkbookSheet(rows: SheetRow[], columns: SheetColumn[]): WorkbookSheetBuildResult {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Codex';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('伤害过程表');
  const mergeMap: Record<string, WorkbookMergeInfo> = {};
  const rowKinds: Record<number, WorkbookCellView['kind']> = {};
  const sheetRowsByWorksheetRow: Record<number, SheetRow> = {};
  const columnGroups = buildColumnGroups(columns);

  let currentColumn = 1;
  columnGroups.forEach((group) => {
    const startColumn = currentColumn;
    const endColumn = startColumn + group.count - 1;
    if (group.count > 1) {
      worksheet.mergeCells(1, startColumn, 1, endColumn);
      registerMerge(mergeMap, 1, startColumn, 1, endColumn);
    }
    const cell = worksheet.getCell(1, startColumn);
    cell.value = group.group;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.font = { bold: true, color: { argb: 'FF185C37' }, size: 10 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF3F7F4' },
    };
    currentColumn = endColumn + 1;
  });
  rowKinds[1] = 'group';
  worksheet.getRow(1).height = 22;

  columns.forEach((column, index) => {
    const cell = worksheet.getCell(2, index + 1);
    cell.value = column.title;
    cell.font = { bold: true, color: { argb: 'FF202124' }, size: 10 };
    cell.alignment = {
      horizontal: column.align === 'right' ? 'right' : column.align === 'center' ? 'center' : 'left',
      vertical: 'middle',
    };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFDFDFD' },
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD7D7D7' } },
      bottom: { style: 'thin', color: { argb: 'FFD7D7D7' } },
      left: { style: 'thin', color: { argb: 'FFD7D7D7' } },
      right: { style: 'thin', color: { argb: 'FFD7D7D7' } },
    };
    worksheet.getColumn(index + 1).width = Math.max(3, column.width / 10);
  });
  rowKinds[2] = 'header';
  worksheet.getRow(2).height = 24;

  let excelRowIndex = 3;
  rows.forEach((row) => {
    if (row.kind === 'character') {
      worksheet.mergeCells(excelRowIndex, 1, excelRowIndex, columns.length);
      registerMerge(mergeMap, excelRowIndex, 1, excelRowIndex, columns.length);
      const cell = worksheet.getCell(excelRowIndex, 1);
      cell.value = row.title;
      cell.font = { bold: true, color: { argb: 'FF202124' }, size: 10 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEFF4F1' },
      };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFD7D7D7' } },
      };
      worksheet.getRow(excelRowIndex).height = 22;
      rowKinds[excelRowIndex] = 'character';
      sheetRowsByWorksheetRow[excelRowIndex] = row;
      excelRowIndex += 1;
      return;
    }

    if (row.kind === 'button') {
      worksheet.mergeCells(excelRowIndex, 1, excelRowIndex, columns.length);
      registerMerge(mergeMap, excelRowIndex, 1, excelRowIndex, columns.length);
      const cell = worksheet.getCell(excelRowIndex, 1);
      cell.value = row.title;
      cell.font = { bold: true, color: { argb: 'FF2B2F33' }, size: 10 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF7F9F8' },
      };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE1E4E8' } },
      };
      worksheet.getRow(excelRowIndex).height = 20;
      rowKinds[excelRowIndex] = 'button';
      sheetRowsByWorksheetRow[excelRowIndex] = row;
      excelRowIndex += 1;
      return;
    }

    columns.forEach((column, index) => {
      const cell = worksheet.getCell(excelRowIndex, index + 1);
      cell.value = row.values[column.key] ?? '';
      cell.alignment = {
        horizontal: column.align === 'right' ? 'right' : column.align === 'center' ? 'center' : 'left',
        vertical: 'middle',
      };
      cell.font = { size: 10, color: { argb: 'FF202124' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE8EAED' } },
        bottom: { style: 'thin', color: { argb: 'FFE8EAED' } },
        left: { style: 'thin', color: { argb: 'FFE8EAED' } },
        right: { style: 'thin', color: { argb: 'FFE8EAED' } },
      };
    });
    worksheet.getRow(excelRowIndex).height = 20;
    rowKinds[excelRowIndex] = 'data';
    sheetRowsByWorksheetRow[excelRowIndex] = row;
    excelRowIndex += 1;
  });

  return { workbook, worksheet, mergeMap, rowKinds, sheetRowsByWorksheetRow };
}

function getCellTextValue(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value == null) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object' && 'richText' in value && Array.isArray(value.richText)) {
    return value.richText.map((item) => item.text).join('');
  }
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') {
    return value.text;
  }
  return String(value);
}

function mapAlignment(value: ExcelJS.Alignment['horizontal'] | undefined): WorkbookCellView['align'] {
  if (value === 'right') {
    return 'right';
  }
  if (value === 'center') {
    return 'center';
  }
  return 'left';
}

function workbookWidthToPixels(width: number | undefined): number {
  const safeWidth = width ?? 3;
  return Math.max(24, Math.round(safeWidth * 10));
}

function getRelevantBuffsForColumn(hitRow: HitValueRow, columnKey: string): SkillButtonBuff[] {
  const { detail } = hitRow;
  const { hitResult } = detail;

  switch (columnKey) {
    case 'atk':
      return hitResult.appliedBuffs.filter((buff) => ['atkPercentBoost', 'flatAtk', 'mainStatBoost', 'subStatBoost', 'allStatBoost', 'strengthBoost', 'agilityBoost', 'intelligenceBoost', 'willBoost'].includes(buff.type || ''));
    case 'critRate':
      return hitResult.appliedBuffs.filter((buff) => buff.type === 'critRateBoost');
    case 'critDmg':
      return hitResult.appliedBuffs.filter((buff) => buff.type === 'critDmgBonusBoost');
    case 'baseMultiplier':
    case 'bonusMultiplier':
    case 'finalMultiplier':
      return hitResult.appliedBuffs.filter((buff) => buff.type === 'multiplierBonus' || buff.type === 'multiplierMultiplier');
    case 'damageBonusRate':
      return hitResult.appliedBuffs.filter((buff) => isDamageBonusBuffForHit(buff, detail.hit));
    case 'amplifyRate':
      return hitResult.appliedBuffs.filter((buff) => isAmplifyBuffForHit(buff, detail.hit));
    case 'fragileRate':
      return hitResult.appliedBuffs.filter((buff) => isFragileBuffForHit(buff, detail.hit));
    case 'vulnerabilityRate':
      return hitResult.appliedBuffs.filter((buff) => isVulnerabilityBuffForHit(buff, detail.hit));
    case 'comboDamageBonus':
      return hitResult.appliedBuffs.filter((buff) => buff.type === 'comboDamageBonus');
    case 'imbalanceDamageBonus':
      return hitResult.appliedBuffs.filter((buff) => buff.type === 'imbalanceDmgBonus');
    default:
      return hitResult.appliedBuffs;
  }
}

function buildFormulaText(hitRow: HitValueRow | null, columnKey: string | undefined, fallback: string): string {
  if (!hitRow || !columnKey) {
    return fallback;
  }

  const { hitResult } = hitRow.detail;

  switch (columnKey) {
    case 'fragileRate': {
      const buffs = getRelevantBuffsForColumn(hitRow, columnKey);
      const pieces = ['1.000', ...buffs.map((buff) => `${buff.value && buff.value >= 0 ? '+' : ''}${(buff.value ?? 0).toFixed(3)}`)];
      return `${pieces.join(' ')} = ${(1 + hitResult.zones.vulnerabilityRate).toFixed(3)}`;
    }
    case 'vulnerabilityRate': {
      const buffs = getRelevantBuffsForColumn(hitRow, columnKey);
      const pieces = ['1.000', ...buffs.map((buff) => `${buff.value && buff.value >= 0 ? '+' : ''}${(buff.value ?? 0).toFixed(3)}`)];
      return `${pieces.join(' ')} = ${(1 + hitResult.zones.fragileRate).toFixed(3)}`;
    }
    case 'amplifyRate': {
      const buffs = getRelevantBuffsForColumn(hitRow, columnKey);
      const pieces = ['1.000', ...buffs.map((buff) => `${buff.value && buff.value >= 0 ? '+' : ''}${(buff.value ?? 0).toFixed(3)}`)];
      return `${pieces.join(' ')} = ${(1 + hitResult.zones.amplifyRate).toFixed(3)}`;
    }
    case 'damageBonusRate':
      return `1.000 + ${hitResult.zones.elementBonus.toFixed(3)} + ${hitResult.zones.skillBonus.toFixed(3)} + ${hitResult.zones.allDamageBonus.toFixed(3)} = ${hitResult.zones.damageBonusRate.toFixed(3)}`;
    case 'bonusMultiplier':
      return `${formatPercent(hitResult.multiplier.afterBonus - hitResult.multiplier.base)} = ${formatPercent(hitResult.multiplier.afterBonus)} - ${formatPercent(hitResult.multiplier.base)}`;
    case 'finalMultiplier':
      return `${formatPercent(hitResult.multiplier.afterBonus)} × ${(hitResult.multiplier.afterMultiply / Math.max(hitResult.multiplier.afterBonus, 0.0001)).toFixed(3)} = ${formatPercent(hitResult.multiplier.afterMultiply)}`;
    default:
      return fallback;
  }
}

function formatUndoLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function readUndoSnapshots(): UndoSnapshot[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(DAMAGE_SHEET_UNDO_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as UndoSnapshot[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeUndoSnapshots(snapshots: UndoSnapshot[]): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(DAMAGE_SHEET_UNDO_KEY, JSON.stringify(snapshots));
}

function captureSessionSnapshot(label: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  const sessionEntries: Array<[string, string]> = [];
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index);
    if (!key) {
      continue;
    }
    const value = window.sessionStorage.getItem(key);
    if (value != null) {
      sessionEntries.push([key, value]);
    }
  }

  const snapshot: UndoSnapshot = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    label,
    sessionEntries,
  };

  const nextSnapshots = [snapshot, ...readUndoSnapshots()].slice(0, DAMAGE_SHEET_UNDO_LIMIT);
  writeUndoSnapshots(nextSnapshots);
}

function restoreUndoSnapshot(snapshotId: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const snapshots = readUndoSnapshots();
  const target = snapshots.find((item) => item.id === snapshotId);
  if (!target) {
    return false;
  }

  window.sessionStorage.clear();
  target.sessionEntries.forEach(([key, value]) => {
    window.sessionStorage.setItem(key, value);
  });

  writeUndoSnapshots(snapshots.filter((item) => item.id !== snapshotId));
  return true;
}

function buildWorkbookView(rows: SheetRow[], columns: SheetColumn[]): WorkbookRowView[] {
  const { worksheet, mergeMap, rowKinds, sheetRowsByWorksheetRow } = buildWorkbookSheet(rows, columns);
  const result: WorkbookRowView[] = [];

  for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const rowKind = rowKinds[rowIndex] ?? 'data';
    const cells: WorkbookCellView[] = [];

    for (let colIndex = 1; colIndex <= columns.length; colIndex += 1) {
      const mergeInfo = mergeMap[`${rowIndex}:${colIndex}`];
      if (mergeInfo?.hidden) {
        continue;
      }

      const cell = worksheet.getCell(rowIndex, colIndex);
      const colSpan = mergeInfo?.colSpan ?? 1;
      const rowSpan = mergeInfo?.rowSpan ?? 1;
      let width = 0;
      for (let offset = 0; offset < colSpan; offset += 1) {
        width += workbookWidthToPixels(worksheet.getColumn(colIndex + offset).width);
      }

      cells.push({
        key: `${rowIndex}-${colIndex}`,
        address: cell.address,
        value: getCellTextValue(cell),
        width,
        colSpan,
        rowSpan,
        align: mapAlignment(cell.alignment?.horizontal),
        kind: rowKind,
        sourceRowId: sheetRowsByWorksheetRow[rowIndex]?.kind === 'hit' ? sheetRowsByWorksheetRow[rowIndex].id : undefined,
        columnKey: sheetRowsByWorksheetRow[rowIndex]?.kind === 'hit' ? columns[colIndex - 1]?.key : undefined,
      });
    }

    result.push({
      key: `row-${rowIndex}`,
      rowNumber: rowIndex,
      kind: rowKind,
      cells,
    });
  }

  return result;
}

async function exportRowsToWorkbook(rows: SheetRow[], columns: SheetColumn[]): Promise<void> {
  const { workbook } = buildWorkbookSheet(rows, columns);
  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = buffer instanceof Uint8Array
    ? buffer
    : new Uint8Array(buffer as ArrayBufferLike);
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  const blob = new Blob(
    [arrayBuffer],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `伤害过程表-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function isDamageSheetPath(path: string): boolean {
  return path === APP_ROUTE_PATHS.damageSheet;
}

export function DamageSheetPage() {
  const { state } = useAppContext();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [totalHitCount, setTotalHitCount] = useState(0);
  const [selectedWorkbookCell, setSelectedWorkbookCell] = useState<SelectedWorkbookCell | null>(null);
  const [undoSnapshots, setUndoSnapshots] = useState<UndoSnapshot[]>([]);
  const [isUndoMenuOpen, setIsUndoMenuOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SheetSidebarTab>('related');
  const [buffSearchKeyword, setBuffSearchKeyword] = useState('');

  const columns = useMemo(() => buildColumns(), []);
  const workbookRows = useMemo(() => buildWorkbookView(rows, columns), [rows, columns]);

  const handleGenerate = useCallback(() => {
    setIsGenerating(true);
    try {
      const next = buildSheetRows(
        state.selectedCharacters.map((character) => ({
          id: character.id,
          name: character.name,
        }))
      );
      setRows(next.rows);
      setTotalHitCount(next.totalHitCount);
      const firstWorkbookDataRow = buildWorkbookView(next.rows, columns).find((row) => row.kind === 'data');
      const firstWorkbookDataCell = firstWorkbookDataRow?.cells[0];
      setSelectedWorkbookCell(firstWorkbookDataCell ? {
        address: firstWorkbookDataCell.address,
        value: firstWorkbookDataCell.value,
        sourceRowId: firstWorkbookDataCell.sourceRowId,
        columnKey: firstWorkbookDataCell.columnKey,
      } : null);
    } finally {
      setIsGenerating(false);
    }
  }, [columns, state.selectedCharacters]);

  useEffect(() => {
    handleGenerate();
  }, [handleGenerate]);
  const selectedHitRow = useMemo(() => (
    selectedWorkbookCell?.sourceRowId
      ? rows.find((row): row is HitValueRow => row.kind === 'hit' && row.id === selectedWorkbookCell.sourceRowId) ?? null
      : null
  ), [rows, selectedWorkbookCell]);
  const selectedValue = buildFormulaText(
    selectedHitRow,
    selectedWorkbookCell?.columnKey,
    selectedWorkbookCell?.value ?? '未选择单元格'
  );
  const selectedAddress = selectedWorkbookCell?.address ?? '-';
  const relevantBuffs = useMemo(() => (
    selectedHitRow && selectedWorkbookCell?.columnKey
      ? getRelevantBuffsForColumn(selectedHitRow, selectedWorkbookCell.columnKey)
      : []
  ), [selectedHitRow, selectedWorkbookCell]);
  const selectedPersistedButton = useMemo(
    () => (selectedHitRow ? getSkillButtonById(selectedHitRow.buttonId) : null),
    [selectedHitRow]
  );
  const selectedSegmentKey = selectedHitRow ? `normal-hit-${selectedHitRow.detail.hit.key}` : null;
  const manuallyDisabledBuffIds = useMemo(() => {
    if (!selectedPersistedButton || !selectedSegmentKey) {
      return [];
    }
    return selectedPersistedButton.panelConfig?.manualDisabledBuffIdsBySegmentKey?.[selectedSegmentKey] ?? [];
  }, [selectedPersistedButton, selectedSegmentKey]);
  const localBuffSearchEntries = useMemo(() => readLocalBuffSearchEntries(), []);
  const filteredLocalBuffSearchResults = useMemo(() => {
    const keyword = buffSearchKeyword.trim().toLowerCase();
    if (!keyword) {
      return [];
    }
    return localBuffSearchEntries.filter((entry) => (
      [
        entry.displayName,
        entry.name,
        entry.itemName,
        entry.groupName,
        entry.sourceName,
        entry.type,
        entry.description,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    ));
  }, [buffSearchKeyword, localBuffSearchEntries]);

  const anomalyModifierBuffList = useMemo(
    () => (selectedPersistedButton ? getButtonBuffs(selectedPersistedButton).filter(isModifierBuff) : []),
    [selectedPersistedButton]
  );

  const anomalyState = useSkillButtonAnomaly({
    buttonId: selectedPersistedButton?.id ?? '__sheet-empty__',
    buttonCharacterId: selectedPersistedButton?.characterId ?? '',
    buttonSkillType: selectedPersistedButton?.skillType ?? 'A',
    characterName: selectedHitRow?.detail.characterName ?? '',
    selectedCharacters: state.selectedCharacters.map((character) => ({
      id: character.id,
      name: character.name,
    })),
    modifierBuffList: anomalyModifierBuffList,
  });
  const {
    loadPersistedAnomalyCards,
  } = anomalyState;

  const totalCharacterCount = state.selectedCharacters.length;
  const totalButtonCount = rows.filter((row) => row.kind === 'button').length;

  const handleExportXlsx = useCallback(async () => {
    if (rows.length === 0) {
      return;
    }

    setIsExporting(true);
    try {
      await exportRowsToWorkbook(rows, columns);
    } finally {
      setIsExporting(false);
    }
  }, [columns, rows]);

  const persistManualBuffTweaks = useCallback((nextMap: Record<string, string[]>) => {
    if (!selectedPersistedButton) {
      return;
    }
    upsertSkillButton({
      ...selectedPersistedButton,
      panelConfig: {
        ...(selectedPersistedButton.panelConfig ?? { selectedBuff: [...(selectedPersistedButton.selectedBuff ?? [])] }),
        selectedBuff: [...(selectedPersistedButton.selectedBuff ?? [])],
        manualDisabledBuffIdsBySegmentKey: nextMap,
      },
      updatedAt: Date.now(),
    });
  }, [selectedPersistedButton]);

  const handleRefreshAndKeepSelection = useCallback(() => {
    handleGenerate();
    setUndoSnapshots(readUndoSnapshots());
  }, [handleGenerate]);

  const toggleManualBuffForSelectedHit = useCallback((buffId: string) => {
    if (!selectedPersistedButton || !selectedSegmentKey) {
      return;
    }

    captureSessionSnapshot(`切换 Buff 命中 · ${selectedHitRow?.detail.buttonName ?? selectedPersistedButton.skillDisplayName ?? selectedPersistedButton.skillType}`);
    const currentMap = selectedPersistedButton.panelConfig?.manualDisabledBuffIdsBySegmentKey ?? {};
    const currentIds = currentMap[selectedSegmentKey] ?? [];
    const nextIds = currentIds.includes(buffId)
      ? currentIds.filter((id) => id !== buffId)
      : [...currentIds, buffId];
    const nextMap = {
      ...currentMap,
      [selectedSegmentKey]: nextIds,
    };
    persistManualBuffTweaks(nextMap);
    recomputeSkillButtonPanel(selectedPersistedButton.id);
    handleRefreshAndKeepSelection();
  }, [handleRefreshAndKeepSelection, persistManualBuffTweaks, selectedHitRow?.detail.buttonName, selectedPersistedButton, selectedSegmentKey]);

  const handleApplyLocalBuffSearchResult = useCallback((entry: LocalBuffSearchResult) => {
    if (!selectedPersistedButton) {
      return;
    }

    captureSessionSnapshot(`添加 Buff · ${entry.displayName}`);
    const result = addSkillButtonBuff(selectedPersistedButton.id, {
      name: entry.name,
      displayName: entry.displayName,
      sourceName: entry.sourceName,
      level: entry.level || '',
      type: entry.type,
      value: entry.value,
      description: entry.description,
      source: entry.source,
      condition: entry.condition,
      effectKind: entry.effectKind,
      extraHitConfig: entry.extraHitConfig,
      refCount: 1,
    });

    if (result.success) {
      recomputeSkillButtonPanel(selectedPersistedButton.id);
      setBuffSearchKeyword('');
      handleRefreshAndKeepSelection();
    }
  }, [handleRefreshAndKeepSelection, selectedPersistedButton]);

  const handleRestoreUndoSnapshot = useCallback((snapshotId: string) => {
    const restored = restoreUndoSnapshot(snapshotId);
    if (!restored) {
      return;
    }
    setIsUndoMenuOpen(false);
    handleGenerate();
    setUndoSnapshots(readUndoSnapshots());
  }, [handleGenerate]);

  useEffect(() => {
    setUndoSnapshots(readUndoSnapshots());
  }, []);

  useEffect(() => {
    if (!selectedPersistedButton) {
      return;
    }
    loadPersistedAnomalyCards();
  }, [loadPersistedAnomalyCards, selectedPersistedButton?.id]);

  const withUndo = useCallback((label: string, fn: () => void) => {
    captureSessionSnapshot(label);
    fn();
    handleRefreshAndKeepSelection();
  }, [handleRefreshAndKeepSelection]);

  return (
    <div className="damage-sheet-page">
      <header className="damage-sheet-topbar">
        <div className="damage-sheet-topbar-left">
          <button type="button" className="damage-sheet-back-button" onClick={() => navigateToAppPath(APP_ROUTE_PATHS.home)}>
            返回主界面
          </button>
          <div className="damage-sheet-title-block">
            <h1>伤害过程表</h1>
            <p>基于 ExcelJS 工作簿单元格模型的伤害过程视图。</p>
          </div>
        </div>
        <div className="damage-sheet-topbar-right">
          <div className="damage-sheet-undo-wrap">
            <button
              type="button"
              className="damage-sheet-action-button"
              onClick={() => setIsUndoMenuOpen((open) => !open)}
              disabled={undoSnapshots.length === 0}
            >
              撤回
            </button>
            {isUndoMenuOpen && undoSnapshots.length > 0 ? (
              <div className="damage-sheet-undo-menu">
                {undoSnapshots.map((snapshot) => (
                  <button
                    key={snapshot.id}
                    type="button"
                    className="damage-sheet-undo-item"
                    onClick={() => handleRestoreUndoSnapshot(snapshot.id)}
                  >
                    <strong>{formatUndoLabel(snapshot.createdAt)}</strong>
                    <span>{snapshot.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" className="damage-sheet-action-button" onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? '刷新中...' : '刷新表格'}
          </button>
          <button type="button" className="damage-sheet-action-button" onClick={handleExportXlsx} disabled={isExporting || rows.length === 0}>
            {isExporting ? '导出中...' : '导出 XLSX'}
          </button>
          <button type="button" className="damage-sheet-action-button" disabled>
            复制
          </button>
          <button type="button" className="damage-sheet-action-button" disabled>
            出图
          </button>
        </div>
      </header>

      <section className="damage-sheet-ribbon">
        <div className="damage-sheet-ribbon-card">
          <span className="damage-sheet-ribbon-label">干员</span>
          <strong>{totalCharacterCount}</strong>
        </div>
        <div className="damage-sheet-ribbon-card">
          <span className="damage-sheet-ribbon-label">按钮</span>
          <strong>{totalButtonCount}</strong>
        </div>
        <div className="damage-sheet-ribbon-card">
          <span className="damage-sheet-ribbon-label">Hit</span>
          <strong>{totalHitCount}</strong>
        </div>
        <div className="damage-sheet-formula-bar">
          <span className="damage-sheet-formula-address">{selectedAddress}</span>
          <span className="damage-sheet-formula-label">fx</span>
          <div className="damage-sheet-formula-value">{selectedValue}</div>
        </div>
      </section>

      <main className="damage-sheet-workspace">
        <aside className="damage-sheet-sidebar">
          <div className="damage-sheet-sidebar-title">工作表</div>
          <button type="button" className="damage-sheet-sheet-tab is-active">
            ExcelJS 过程
          </button>
          <div className="damage-sheet-sidebar-title">格子明细</div>
          {ENABLE_ADVANCED_SHEET_SIDEBAR ? (
            <div className="damage-sheet-sidebar-tabs">
              <button type="button" className={`damage-sheet-mini-tab${sidebarTab === 'related' ? ' is-active' : ''}`} onClick={() => setSidebarTab('related')}>相关</button>
              <button type="button" className={`damage-sheet-mini-tab${sidebarTab === 'local' ? ' is-active' : ''}`} onClick={() => setSidebarTab('local')}>本地</button>
              <button type="button" className={`damage-sheet-mini-tab${sidebarTab === 'anomaly' ? ' is-active' : ''}`} onClick={() => setSidebarTab('anomaly')}>异常</button>
              <button type="button" className={`damage-sheet-mini-tab${sidebarTab === 'state' ? ' is-active' : ''}`} onClick={() => setSidebarTab('state')}>状态</button>
              <button type="button" className={`damage-sheet-mini-tab${sidebarTab === 'anomaly-state' ? ' is-active' : ''}`} onClick={() => setSidebarTab('anomaly-state')}>快照</button>
            </div>
          ) : null}
          <div className="damage-sheet-sidebar-note">
            {selectedWorkbookCell?.columnKey && selectedHitRow
              ? `${selectedWorkbookCell.address} · ${selectedHitRow.detail.buttonName} · ${selectedHitRow.detail.hitLabel}`
              : '点击任意 Hit 单元格后，这里显示当前格子的相关 Buff。'}
          </div>
          {(!ENABLE_ADVANCED_SHEET_SIDEBAR || sidebarTab === 'related') ? (
            <div className="damage-sheet-buff-grid">
              {selectedHitRow ? (
                relevantBuffs.length > 0 ? relevantBuffs.map((buff) => {
                  const isDisabled = manuallyDisabledBuffIds.includes(buff.id);
                  return (
                    <div key={buff.id} className={`damage-sheet-buff-card${isDisabled ? ' is-muted' : ''}`} title={`来源：${buff.sourceName || buff.source || '未知'}\n类型：${buff.type || '未标注'}\n${buff.description || buff.condition || ''}`}>
                      <button type="button" className={`damage-sheet-buff-tag${isDisabled ? '' : ' is-active'}`} onClick={() => toggleManualBuffForSelectedHit(buff.id)}>
                        <span className="damage-sheet-buff-name">{buff.displayName}</span>
                        <span className="damage-sheet-buff-effect">{buff.type || 'Buff'}{typeof buff.value === 'number' ? ` ${buff.value >= 0 ? '+' : ''}${(buff.value * 100).toFixed(1)}%` : ''}</span>
                      </button>
                    </div>
                  );
                }) : (
                  <div className="damage-sheet-detail-empty">当前格子没有命中相关 Buff。</div>
                )
              ) : (
              <div className="damage-sheet-detail-empty">先选中一个 Hit 格子。</div>
            )}
          </div>
          ) : null}
          {ENABLE_ADVANCED_SHEET_SIDEBAR && sidebarTab === 'local' ? (
            selectedPersistedButton ? (
              <div className="damage-sheet-local-panel">
                <input
                  className="damage-sheet-local-search"
                  value={buffSearchKeyword}
                  onChange={(event) => setBuffSearchKeyword(event.target.value)}
                  placeholder="输入关键词后显示本地 Buff"
                />
                {buffSearchKeyword.trim() ? (
                  filteredLocalBuffSearchResults.length > 0 ? (
                    <div className="damage-sheet-local-results">
                      {filteredLocalBuffSearchResults.map((entry) => (
                        <button key={entry.key} type="button" className="damage-sheet-local-item" onClick={() => handleApplyLocalBuffSearchResult(entry)}>
                          <strong>{entry.displayName}</strong>
                          <span>{entry.sourceName || entry.groupName}</span>
                          <span>{entry.type || 'Buff'}{typeof entry.value === 'number' ? ` ${entry.value >= 0 ? '+' : ''}${(entry.value * 100).toFixed(1)}%` : ''}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="damage-sheet-detail-empty">没有匹配到本地 Buff。</div>
                  )
                ) : (
                  <div className="damage-sheet-detail-empty">输入关键词后再显示本地 Buff 结果。</div>
                )}
              </div>
            ) : (
              <div className="damage-sheet-detail-empty">先选中一个 Hit 格子。</div>
            )
          ) : null}
          {ENABLE_ADVANCED_SHEET_SIDEBAR && sidebarTab === 'anomaly' ? (
            selectedPersistedButton ? (
              <div className="damage-sheet-embedded-panel">
                <SkillButtonAnomalyPanel
                  activeAnomaly={anomalyState.activeAnomaly}
                  activeAnomalyGroup={anomalyState.activeAnomalyGroup}
                  activeAnomalyLevel={anomalyState.activeAnomalyLevel}
                  activeAnomalyPreview={anomalyState.activeAnomalyPreview}
                  activeSourceCharacter={anomalyState.activeSourceCharacter}
                  sourceCharacters={anomalyState.sourceCharacters}
                  selectedAnomalyDamages={anomalyState.selectedAnomalyDamages}
                  activeDurationSeconds={anomalyState.activeDurationSeconds}
                  includeDotInTotal={anomalyState.includeDotInTotal}
                  onSetActiveAnomalyGroup={anomalyState.setActiveAnomalyGroup}
                  onResetActiveAnomalyKey={() => anomalyState.setActiveAnomalyKey(null)}
                  onSelectAnomaly={anomalyState.handleSelectAnomaly}
                  onApplyActiveAnomaly={() => withUndo(`异常区调整 · ${selectedPersistedButton.skillDisplayName ?? selectedPersistedButton.skillType}`, anomalyState.handleApplyActiveAnomaly)}
                  onSetActiveAnomalyLevel={anomalyState.setActiveAnomalyLevel}
                  onSetActiveAnomalySourceId={anomalyState.setActiveAnomalySourceId}
                  onSetIncludeDotInTotal={anomalyState.setIncludeDotInTotal}
                  onSetActiveDurationSeconds={anomalyState.setActiveDurationSeconds}
                  onRemoveAnomalyCard={(kind, cardId) => withUndo(`移除异常卡 · ${selectedPersistedButton.skillDisplayName ?? selectedPersistedButton.skillType}`, () => anomalyState.removeAnomalyCard(kind, cardId))}
                />
              </div>
            ) : (
              <div className="damage-sheet-detail-empty">先选中一个 Hit 格子。</div>
            )
          ) : null}
          {ENABLE_ADVANCED_SHEET_SIDEBAR && sidebarTab === 'state' ? (
            selectedPersistedButton ? (
              <div className="damage-sheet-embedded-panel">
                <SkillButtonStatePanel
                  activeAnomaly={anomalyState.activeAnomaly}
                  activeAnomalyLevel={anomalyState.activeAnomalyLevel}
                  activeAnomalyPreview={anomalyState.activeAnomalyPreview}
                  selectedStatusCards={anomalyState.selectedStatusCards}
                  onSelectAnomaly={anomalyState.handleSelectAnomaly}
                  onApplyActiveAnomaly={() => withUndo(`状态区调整 · ${selectedPersistedButton.skillDisplayName ?? selectedPersistedButton.skillType}`, anomalyState.handleApplyActiveAnomaly)}
                  onSetActiveAnomalyLevel={anomalyState.setActiveAnomalyLevel}
                  onRemoveAnomalyCard={(kind, cardId) => withUndo(`移除状态卡 · ${selectedPersistedButton.skillDisplayName ?? selectedPersistedButton.skillType}`, () => anomalyState.removeAnomalyCard(kind, cardId))}
                />
              </div>
            ) : (
              <div className="damage-sheet-detail-empty">先选中一个 Hit 格子。</div>
            )
          ) : null}
          {ENABLE_ADVANCED_SHEET_SIDEBAR && sidebarTab === 'anomaly-state' ? (
            selectedPersistedButton ? (
              <div className="damage-sheet-embedded-panel">
                <SkillButtonAnomalyStatePanel
                  activeAnomalyStateOption={anomalyState.activeAnomalyStateOption}
                  activeAnomalyStateLevel={anomalyState.activeAnomalyStateLevel}
                  activeAnomalyStateDurationSeconds={anomalyState.activeAnomalyStateDurationSeconds}
                  activeAnomalyStatePreview={anomalyState.activeAnomalyStatePreview}
                  activeAnomalyStateSourceCharacter={anomalyState.activeAnomalyStateSourceCharacter}
                  sourceCharacters={anomalyState.sourceCharacters}
                  selectedAnomalyStateSnapshots={anomalyState.selectedAnomalyStateSnapshots}
                  availableAnomalyStateSnapshots={anomalyState.availableAnomalyStateSnapshots}
                  anomalyStateSnapshotUsageCounts={anomalyState.anomalyStateSnapshotUsageCounts}
                  onSelectAnomalyState={anomalyState.handleSelectAnomalyState}
                  onCreateSnapshot={() => withUndo(`创建异常快照 · ${selectedPersistedButton.skillDisplayName ?? selectedPersistedButton.skillType}`, anomalyState.handleCreateAnomalyStateSnapshot)}
                  onSetActiveAnomalyStateLevel={anomalyState.setActiveAnomalyStateLevel}
                  onSetActiveAnomalyStateSourceId={anomalyState.setActiveAnomalyStateSourceId}
                  onSetActiveAnomalyStateDurationSeconds={anomalyState.setActiveAnomalyStateDurationSeconds}
                  onRemoveAnomalyStateSnapshotCard={(snapshotId) => withUndo(`卸载异常快照 · ${selectedPersistedButton.skillDisplayName ?? selectedPersistedButton.skillType}`, () => anomalyState.removeAnomalyStateSnapshotCard(snapshotId))}
                  onAttachAnomalyStateSnapshotCard={(snapshotId) => withUndo(`挂载异常快照 · ${selectedPersistedButton.skillDisplayName ?? selectedPersistedButton.skillType}`, () => anomalyState.attachAnomalyStateSnapshotCard(snapshotId))}
                  onDeleteAnomalyStateSnapshotCard={(snapshotId) => withUndo(`删除异常快照 · ${selectedPersistedButton.skillDisplayName ?? selectedPersistedButton.skillType}`, () => anomalyState.deleteAnomalyStateSnapshotCard(snapshotId))}
                />
              </div>
            ) : (
              <div className="damage-sheet-detail-empty">先选中一个 Hit 格子。</div>
            )
          ) : null}
        </aside>
        <section className="damage-sheet-excel-shell">
          <div className="damage-sheet-excel-scroll">
            {workbookRows.length === 0 ? (
              <div className="damage-sheet-empty-state">
                <h2>当前没有可展示的 ExcelJS 数据</h2>
                <p>先保证时间轴中有角色和按钮，再刷新这张表。</p>
              </div>
            ) : (
              workbookRows.map((row) => (
                <div key={row.key} className={`damage-sheet-excel-row is-${row.kind}`}>
                  <div className="damage-sheet-excel-row-number">{row.rowNumber}</div>
                  <div className="damage-sheet-excel-row-cells">
                    {row.cells.map((cell) => (
                      <div
                        key={cell.key}
                        className={`damage-sheet-excel-cell is-${cell.kind} is-${cell.align}${selectedWorkbookCell?.address === cell.address ? ' is-active' : ''}`}
                        style={{ width: `${cell.width}px` }}
                        onClick={() => setSelectedWorkbookCell({
                          address: cell.address,
                          value: cell.value,
                          sourceRowId: cell.sourceRowId,
                          columnKey: cell.columnKey,
                        })}
                      >
                        {cell.value}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
