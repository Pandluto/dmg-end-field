import ExcelJS from 'exceljs';
import type {
  BuildDamageExcelWorkbookInput,
  DamageExcelHitRow,
  DamageExcelStorageEntry,
} from './damageExcelModel.ts';

type BuffCellRefMap = Map<string, Map<string, string[]>>;

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

function getBuffTargetKey(buff: NonNullable<DamageExcelHitRow['detail']['hitResult']['appliedBuffs']>[number]): string {
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

function addBuffCellRef(refs: BuffCellRefMap, hitId: string, type: string, cellRef: string): void {
  const hitRefs = refs.get(hitId) ?? new Map<string, string[]>();
  const typeRefs = hitRefs.get(type) ?? [];
  typeRefs.push(cellRef);
  hitRefs.set(type, typeRefs);
  refs.set(hitId, hitRefs);
}

function getBuffCellRefs(refs: BuffCellRefMap, hitId: string, type: string): string[] {
  return refs.get(hitId)?.get(type) ?? [];
}

function sumFormula(refs: string[]): string {
  return refs.length > 0 ? refs.join('+') : '0';
}

function productFormula(refs: string[]): string {
  return refs.length > 0 ? refs.join('*') : '1';
}

function addBuffSheet(workbook: ExcelJS.Workbook, hitRows: DamageExcelHitRow[]): BuffCellRefMap {
  const sheet = workbook.addWorksheet('Buff');
  const refs: BuffCellRefMap = new Map();
  sheet.getRow(1).values = [
    '命中ID',
    'Buff ID',
    '来源名称',
    '显示名称',
    '目标模式',
    '目标键',
    '类型',
    '数值',
    '启用',
    '说明',
  ];
  styleHeader(sheet.getRow(1));

  let rowNumber = 2;
  hitRows.forEach((hitRow) => {
    const buffs = hitRow.detail.hitResult.appliedBuffs ?? [];
    buffs.forEach((buff) => {
      const row = sheet.getRow(rowNumber);
      row.values = [
        hitRow.id,
        buff.id,
        buff.sourceName || buff.source || '',
        buff.displayName || buff.name || buff.id,
        buff.target?.mode ?? 'all',
        getBuffTargetKey(buff),
        buff.type || '',
        buff.value ?? 0,
        true,
        buff.condition || buff.description || '',
      ];
      styleBody(row);
      if (buff.type) {
        addBuffCellRef(refs, hitRow.id, buff.type, `Buff!H${rowNumber}`);
      }
      rowNumber += 1;
    });
  });

  setColumnWidths(sheet, [24, 24, 22, 24, 14, 18, 24, 12, 10, 42]);
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

function addHitSheet(workbook: ExcelJS.Workbook, hitRows: DamageExcelHitRow[], buffRefs: BuffCellRefMap): void {
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
    const hitId = hitRow.id;
    const element = hitRow.detail.hit.element;
    const row = sheet.getRow(rowNumber);
    const multiplierBonusFormula = sumFormula(getBuffCellRefs(buffRefs, hitId, 'multiplierBonus'));
    const multiplierMultiplierFormula = productFormula(getBuffCellRefs(buffRefs, hitId, 'multiplierMultiplier'));
    const allDmgFormula = sumFormula(getBuffCellRefs(buffRefs, hitId, 'allDmgBonus'));
    const amplifyType = element === 'physical' ? 'physicalAmplify' : `${element}Amplify`;
    const fragileType = element === 'physical' ? 'physicalFragile' : `${element}Fragile`;
    const vulnerabilityType = element === 'physical' ? 'physicalVulnerability' : `${element}Vulnerability`;
    const amplifyFormula = sumFormula(getBuffCellRefs(buffRefs, hitId, amplifyType));
    const fragileFormula = sumFormula(getBuffCellRefs(buffRefs, hitId, fragileType));
    const vulnerabilityFormula = sumFormula(getBuffCellRefs(buffRefs, hitId, vulnerabilityType));
    const comboFormula = sumFormula(getBuffCellRefs(buffRefs, hitId, 'comboDamageBonus'));
    const imbalanceFormula = sumFormula(getBuffCellRefs(buffRefs, hitId, 'imbalanceDmgBonus'));
    row.values = [
      hitRow.id,
      hitRow.characterId,
      hitRow.detail.characterName,
      hitRow.buttonId,
      hitRow.detail.hitLabel,
      parseElementLabel(hitRow.detail.hit.element),
      hitRow.detail.hit.skillType || '',
      result.multiplier.base,
      { formula: multiplierBonusFormula, result: result.multiplier.afterBonus - result.multiplier.base },
      { formula: multiplierMultiplierFormula, result: result.multiplier.afterMultiply / Math.max(result.multiplier.afterBonus, 0.000001) },
      { formula: `H${rowNumber}+I${rowNumber}`, result: result.multiplier.afterBonus },
      { formula: `K${rowNumber}*J${rowNumber}`, result: result.multiplier.afterMultiply },
      result.panel.atk,
      result.panel.critRate,
      result.panel.critDmg,
      result.zones.elementBonus ?? 0,
      result.zones.skillBonus ?? 0,
      result.zones.allDamageBonus ?? 0,
      {
        formula: `1+P${rowNumber}+Q${rowNumber}+R${rowNumber}${allDmgFormula === '0' ? '' : `+${allDmgFormula}`}`,
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
  const buffRefs = addBuffSheet(workbook, hitRows);
  addSnapshotSheet(workbook, input.storageSnapshot ?? []);
  addHitSheet(workbook, hitRows, buffRefs);
  addDamageSheet(workbook, hitRows);

  return workbook;
}
