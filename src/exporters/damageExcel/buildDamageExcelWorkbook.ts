import ExcelJS from 'exceljs';
import type {
  BuildDamageExcelWorkbookInput,
  DamageExcelHitRow,
  DamageExcelStorageEntry,
} from './damageExcelModel.ts';
import type { SkillButtonBuff } from '../../types/storage.ts';

type BuffCellRefMap = Map<string, { type: string; cellRef: string; value: number }>;
type BuffCellRef = NonNullable<ReturnType<BuffCellRefMap['get']>>;
type RuntimeBuff = SkillButtonBuff & Record<string, unknown>;

function styleHeader(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FF202124' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F7F4' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD7D7D7' } },
      bottom: { style: 'thin', color: { argb: 'FFD7D7D7' } },
      left: { style: 'thin', color: { argb: 'FFD7D7D7' } },
      right: { style: 'thin', color: { argb: 'FFD7D7D7' } },
    };
  });
}

function styleBody(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.alignment = { vertical: 'middle' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFE8EAED' } },
      bottom: { style: 'thin', color: { argb: 'FFE8EAED' } },
      left: { style: 'thin', color: { argb: 'FFE8EAED' } },
      right: { style: 'thin', color: { argb: 'FFE8EAED' } },
    };
  });
}

function setColumnWidths(sheet: ExcelJS.Worksheet, widths: number[]): void {
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
}

function getHitRows(input: BuildDamageExcelWorkbookInput): DamageExcelHitRow[] {
  return input.rows.filter((row): row is DamageExcelHitRow => row.kind === 'hit');
}

function getCharacterRows(input: BuildDamageExcelWorkbookInput) {
  return input.rows.filter((row) => row.kind === 'character');
}

function parseElementLabel(element: string | undefined): string {
  switch (element) {
    case 'physical':
      return '物理';
    case 'fire':
      return '灼热';
    case 'electric':
      return '电磁';
    case 'ice':
      return '寒冷';
    case 'nature':
      return '自然';
    case 'magic':
      return '法术';
    default:
      return element || '';
  }
}

function getBuffTargetKey(buff: SkillButtonBuff): string {
  const target = buff.target;
  if (!target || target.mode === 'all') {
    return '';
  }
  switch (target.mode) {
    case 'damageKey':
      return target.key;
    case 'skillType':
      return target.skillType;
    case 'element':
      return target.element;
    default:
      return '';
  }
}

function readBuffTextField(buff: SkillButtonBuff, key: string): string {
  const value = (buff as RuntimeBuff)[key];
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function addOperatorSheet(workbook: ExcelJS.Workbook, input: BuildDamageExcelWorkbookInput): void {
  const sheet = workbook.addWorksheet('干员');
  sheet.getRow(1).values = ['干员ID', '干员名', '技能等级', '面板摘要', '说明'];
  styleHeader(sheet.getRow(1));

  const characterRows = getCharacterRows(input);
  characterRows.forEach((row, index) => {
    const excelRow = sheet.getRow(index + 2);
    excelRow.values = [row.characterId, row.characterName, row.subtitle, row.meta, '从当前软件状态导出的干员源数据'];
    styleBody(excelRow);
  });

  setColumnWidths(sheet, [18, 18, 26, 42, 36]);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function addEmptySourceSheet(workbook: ExcelJS.Workbook, name: '武器' | '装备'): void {
  const sheet = workbook.addWorksheet(name);
  sheet.getRow(1).values = ['来源ID', '来源名称', '字段', '数值', '说明'];
  styleHeader(sheet.getRow(1));
  sheet.getRow(2).values = ['', '', '', '', '当前导出先把武器/装备产生的可计算修正统一归一到 Buff 表'];
  styleBody(sheet.getRow(2));
  setColumnWidths(sheet, [18, 24, 20, 16, 58]);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function addBuffCellRef(refs: BuffCellRefMap, buffId: string, type: string, cellRef: string, value: number): void {
  refs.set(buffId, { type, cellRef, value });
}

function getSelectedBuffIdsForHit(input: BuildDamageExcelWorkbookInput, hitRow: DamageExcelHitRow): string[] {
  const button = input.skillButtonTable?.[hitRow.buttonId];
  const selectedBuffIds = button?.panelConfig?.selectedBuff ?? [];
  const segmentKey = `normal-hit-${hitRow.detail.hit.key}`;
  const disabledBuffIds = new Set(button?.panelConfig?.manualDisabledBuffIdsBySegmentKey?.[segmentKey] ?? []);
  return selectedBuffIds.filter((buffId) => !disabledBuffIds.has(buffId));
}

function getBuffCellRefs(refs: BuffCellRefMap, buffIds: string[], type: string): string[] {
  return getBuffCellRefsForTypes(refs, buffIds, [type]);
}

function getBuffCellRefsForTypes(refs: BuffCellRefMap, buffIds: string[], types: string[]): string[] {
  const typeSet = new Set(types);
  return buffIds
    .map((buffId) => refs.get(buffId))
    .filter((ref): ref is BuffCellRef => ref !== undefined && typeSet.has(ref.type))
    .map((ref) => ref.cellRef);
}

function sumBuffValuesForTypes(refs: BuffCellRefMap, buffIds: string[], types: string[]): number {
  const typeSet = new Set(types);
  return buffIds.reduce((total, buffId) => {
    const ref = refs.get(buffId);
    return ref && typeSet.has(ref.type) ? total + ref.value : total;
  }, 0);
}

function sumFormula(refs: string[]): string {
  return refs.length > 0 ? refs.join('+') : '0';
}

function additiveFormula(baseValue: number, refs: string[]): string {
  const pieces: string[] = [];
  if (Math.abs(baseValue) > 0.0000001 || refs.length === 0) {
    pieces.push(String(baseValue));
  }
  pieces.push(...refs);
  return pieces.join('+');
}

function multiplicativeFormula(baseValue: number, refs: string[]): string {
  const pieces: string[] = [];
  if (Math.abs(baseValue - 1) > 0.0000001 || refs.length === 0) {
    pieces.push(String(baseValue));
  }
  pieces.push(...refs);
  return pieces.join('*');
}

function getElementDamageBonusTypes(element: string | undefined): string[] {
  if (element === 'physical') {
    return ['physicalDmgBonus'];
  }
  const types = ['magicDmgBonus', 'allElementDmgBonus'];
  if (element) {
    types.unshift(`${element}DmgBonus`);
  }
  return types;
}

function getSkillDamageBonusTypes(skillType: string | undefined): string[] {
  switch (skillType) {
    case 'A':
      return ['normalAttackDmgBonus'];
    case 'B':
      return ['skillDmgBonus', 'allSkillDmgBonus'];
    case 'E':
      return ['chainSkillDmgBonus', 'allSkillDmgBonus'];
    case 'Q':
      return ['ultimateDmgBonus', 'allSkillDmgBonus'];
    default:
      return [];
  }
}

function getElementZoneTypes(element: string | undefined, suffix: 'Amplify' | 'Fragile' | 'Vulnerability'): string[] {
  if (element === 'physical') {
    return [`physical${suffix}`];
  }
  const types = [`magic${suffix}`];
  if (element) {
    types.unshift(`${element}${suffix}`);
  }
  return types;
}

function addBuffSheet(
  workbook: ExcelJS.Workbook,
  allBuffList: SkillButtonBuff[],
): BuffCellRefMap {
  const sheet = workbook.addWorksheet('Buff');
  const refs: BuffCellRefMap = new Map();
  sheet.getRow(1).values = [
    'Buff ID',
    '来源名称',
    '显示名称',
    '目标模式',
    '目标键',
    '类型',
    '启用',
    '数值',
    '说明',
    'Tab',
  ];
  styleHeader(sheet.getRow(1));

  let rowNumber = 2;
  allBuffList.forEach((buff) => {
    const row = sheet.getRow(rowNumber);
    row.values = [
      buff.id,
      buff.sourceName || buff.source || '',
      buff.displayName || buff.name || buff.id,
      buff.target?.mode ?? 'all',
      getBuffTargetKey(buff),
      buff.type || '',
      true,
      buff.value ?? 0,
      buff.condition || buff.description || '',
      readBuffTextField(buff, 'tab'),
    ];
    styleBody(row);
    if (buff.type) {
      addBuffCellRef(refs, buff.id, buff.type, `Buff!H${rowNumber}`, buff.value ?? 0);
    }
    rowNumber += 1;
  });

  setColumnWidths(sheet, [24, 22, 24, 14, 18, 24, 10, 12, 42, 16]);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return refs;
}

function addSnapshotSheet(workbook: ExcelJS.Workbook, entries: DamageExcelStorageEntry[]): void {
  const sheet = workbook.addWorksheet('快照');
  sheet.getRow(1).values = ['键', '值', '说明'];
  styleHeader(sheet.getRow(1));

  if (entries.length === 0) {
    sheet.getRow(2).values = ['导出', '未捕获存储快照', '快照只做留档，不参与公式计算'];
    styleBody(sheet.getRow(2));
  } else {
    entries.forEach((entry, index) => {
      const row = sheet.getRow(index + 2);
      row.values = [entry.key, entry.value, '快照只做留档，不参与公式计算'];
      styleBody(row);
    });
  }

  setColumnWidths(sheet, [42, 90, 42]);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function addHitSheet(workbook: ExcelJS.Workbook, input: BuildDamageExcelWorkbookInput, hitRows: DamageExcelHitRow[], buffRefs: BuffCellRefMap): void {
  const sheet = workbook.addWorksheet('命中');
  sheet.getRow(1).values = [
    '命中ID',
    '干员ID',
    '干员名',
    '按钮ID',
    '命中名',
    '属性',
    '技能类型',
    '基础倍率',
    '倍率加算',
    '倍率乘法',
    '加算后倍率',
    '最终倍率',
    '面板攻击',
    '面板暴击率',
    '面板暴伤',
    '面板元素加成',
    '面板技能加成',
    '面板全伤加成',
    '加成区',
    '防御区',
    '增幅区',
    '易伤区',
    '脆弱区',
    '连击区',
    '失衡区',
  ];
  styleHeader(sheet.getRow(1));

  hitRows.forEach((hitRow, index) => {
    const rowNumber = index + 2;
    const result = hitRow.detail.hitResult;
    const element = hitRow.detail.hit.element;
    const skillType = hitRow.detail.hit.skillType;
    const row = sheet.getRow(rowNumber);
    const selectedBuffIds = getSelectedBuffIdsForHit(input, hitRow);
    const multiplierBonusRefs = getBuffCellRefs(buffRefs, selectedBuffIds, 'multiplierBonus');
    const multiplierMultiplierRefs = getBuffCellRefs(buffRefs, selectedBuffIds, 'multiplierMultiplier');
    const baseMultiplierBonus = result.multiplier.afterBonus - result.multiplier.base - sumBuffValuesForTypes(buffRefs, selectedBuffIds, ['multiplierBonus']);
    const selectedMultiplierProduct = selectedBuffIds.reduce((total, buffId) => {
      const ref = buffRefs.get(buffId);
      return ref?.type === 'multiplierMultiplier' ? total * ref.value : total;
    }, 1);
    const totalMultiplierProduct = result.multiplier.afterMultiply / Math.max(result.multiplier.afterBonus, 0.000001);
    const baseMultiplierProduct = totalMultiplierProduct / selectedMultiplierProduct;
    const elementDamageBonusTypes = getElementDamageBonusTypes(element);
    const skillDamageBonusTypes = getSkillDamageBonusTypes(skillType);
    const allDamageBonusTypes = ['allDmgBonus'];
    const damageBonusRefs = getBuffCellRefsForTypes(
      buffRefs,
      selectedBuffIds,
      [...elementDamageBonusTypes, ...skillDamageBonusTypes, ...allDamageBonusTypes],
    );
    const baseElementBonus = (result.zones.elementBonus ?? 0) - sumBuffValuesForTypes(buffRefs, selectedBuffIds, elementDamageBonusTypes);
    const baseSkillBonus = (result.zones.skillBonus ?? 0) - sumBuffValuesForTypes(buffRefs, selectedBuffIds, skillDamageBonusTypes);
    const baseAllDamageBonus = (result.zones.allDamageBonus ?? 0) - sumBuffValuesForTypes(buffRefs, selectedBuffIds, allDamageBonusTypes);
    const amplifyFormula = sumFormula(getBuffCellRefsForTypes(buffRefs, selectedBuffIds, getElementZoneTypes(element, 'Amplify')));
    const fragileFormula = sumFormula(getBuffCellRefsForTypes(buffRefs, selectedBuffIds, getElementZoneTypes(element, 'Fragile')));
    const vulnerabilityFormula = sumFormula(getBuffCellRefsForTypes(buffRefs, selectedBuffIds, getElementZoneTypes(element, 'Vulnerability')));
    const comboFormula = sumFormula(getBuffCellRefs(buffRefs, selectedBuffIds, 'comboDamageBonus'));
    const imbalanceFormula = sumFormula(getBuffCellRefs(buffRefs, selectedBuffIds, 'imbalanceDmgBonus'));
    row.values = [
      hitRow.id,
      hitRow.characterId,
      hitRow.detail.characterName,
      hitRow.buttonId,
      hitRow.detail.hitLabel,
      parseElementLabel(hitRow.detail.hit.element),
      hitRow.detail.hit.skillType || '',
      result.multiplier.base,
      { formula: additiveFormula(baseMultiplierBonus, multiplierBonusRefs), result: result.multiplier.afterBonus - result.multiplier.base },
      { formula: multiplicativeFormula(baseMultiplierProduct, multiplierMultiplierRefs), result: totalMultiplierProduct },
      { formula: `H${rowNumber}+I${rowNumber}`, result: result.multiplier.afterBonus },
      { formula: `K${rowNumber}*J${rowNumber}`, result: result.multiplier.afterMultiply },
      result.panel.atk,
      result.panel.critRate,
      result.panel.critDmg,
      baseElementBonus,
      baseSkillBonus,
      baseAllDamageBonus,
      {
        formula: `1+P${rowNumber}+Q${rowNumber}+R${rowNumber}${damageBonusRefs.length === 0 ? '' : `+${damageBonusRefs.join('+')}`}`,
        result: result.zones.damageBonusRate,
      },
      result.zones.defenseZone,
      {
        formula: amplifyFormula === '0' ? '1' : `1+${amplifyFormula}`,
        result: 1 + result.zones.amplifyRate,
      },
      {
        formula: fragileFormula === '0' ? '1' : `1+${fragileFormula}`,
        result: 1 + result.zones.fragileRate,
      },
      {
        formula: vulnerabilityFormula === '0' ? '1' : `1+${vulnerabilityFormula}`,
        result: 1 + result.zones.vulnerabilityRate,
      },
      { formula: comboFormula === '0' ? '1' : `1+${comboFormula}`, result: 1 + result.zones.comboDamageBonus },
      { formula: imbalanceFormula === '0' ? '1' : `1+${imbalanceFormula}`, result: 1 + result.zones.imbalanceDamageBonus },
    ];
    styleBody(row);
  });

  setColumnWidths(sheet, [24, 18, 18, 24, 18, 10, 10, 14, 14, 16, 18, 16, 14, 14, 14, 18, 18, 18, 16, 12, 12, 12, 14, 12, 12]);
  sheet.views = [{ state: 'frozen', ySplit: 1, xSplit: 3 }];
}

function addDamageSheet(workbook: ExcelJS.Workbook, hitRows: DamageExcelHitRow[]): void {
  const sheet = workbook.addWorksheet('伤害过程');
  sheet.getRow(1).values = [
    '命中ID',
    '干员名',
    '按钮ID',
    '命中名',
    '属性',
    '技能类型',
    '最终倍率',
    '基础伤害',
    '非暴伤害',
    '暴击伤害',
    '期望伤害',
  ];
  styleHeader(sheet.getRow(1));

  hitRows.forEach((hitRow, index) => {
    const rowNumber = index + 2;
    const hitRowNumber = index + 2;
    const result = hitRow.detail.hitResult;
    const row = sheet.getRow(rowNumber);
    row.values = [
      { formula: `命中!A${hitRowNumber}`, result: hitRow.id },
      { formula: `命中!C${hitRowNumber}`, result: hitRow.detail.characterName },
      { formula: `命中!D${hitRowNumber}`, result: hitRow.buttonId },
      { formula: `命中!E${hitRowNumber}`, result: hitRow.detail.hitLabel },
      { formula: `命中!F${hitRowNumber}`, result: parseElementLabel(hitRow.detail.hit.element) },
      { formula: `命中!G${hitRowNumber}`, result: hitRow.detail.hit.skillType || '' },
      { formula: `命中!L${hitRowNumber}`, result: result.multiplier.afterMultiply },
      { formula: `命中!M${hitRowNumber}*命中!L${hitRowNumber}`, result: result.nonCrit.base ?? 0 },
      { formula: `命中!M${hitRowNumber}*命中!L${hitRowNumber}*命中!S${hitRowNumber}*命中!T${hitRowNumber}*命中!U${hitRowNumber}*命中!V${hitRowNumber}*命中!W${hitRowNumber}*命中!X${hitRowNumber}*命中!Y${hitRowNumber}`, result: result.nonCrit.final },
      { formula: `I${rowNumber}*(1+命中!O${hitRowNumber})`, result: result.crit.final },
      { formula: `I${rowNumber}*(1-命中!N${hitRowNumber})+J${rowNumber}*命中!N${hitRowNumber}`, result: result.expected.final },
    ];
    styleBody(row);
  });

  setColumnWidths(sheet, [24, 18, 24, 18, 10, 10, 16, 14, 14, 14, 14]);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

export function buildDamageExcelWorkbook(input: BuildDamageExcelWorkbookInput): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'dmg-end-field';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const hitRows = getHitRows(input);
  addOperatorSheet(workbook, input);
  addEmptySourceSheet(workbook, '武器');
  addEmptySourceSheet(workbook, '装备');
  const buffRefs = addBuffSheet(workbook, input.allBuffList ?? []);
  addSnapshotSheet(workbook, input.storageSnapshot ?? []);
  addHitSheet(workbook, input, hitRows, buffRefs);
  addDamageSheet(workbook, hitRows);

  return workbook;
}
