import ExcelJS from 'exceljs';
import type {
  BuildDamageExcelWorkbookInput,
  DamageExcelHitRow,
} from './damageExcelModel.ts';
import { STORAGE_KEYS } from '../../constants/storage-keys.ts';
import type { ConfigSnapshot, PanelCalcSnapshot } from '../../core/calculators/operatorPanelCalculator.ts';
import type { SkillButtonBuff } from '../../types/storage.ts';

type BuffCellRefMap = Map<string, { type: string; cellRef: string; value: number }>;
type BuffCellRef = NonNullable<ReturnType<BuffCellRefMap['get']>>;
type RuntimeBuff = SkillButtonBuff & Record<string, unknown>;
type CalcCellRefMap = Map<string, Map<string, string>>;
type SourceCellRefMap = Map<string, Map<string, string>>;

const CALC_FIELD_LABELS: Record<string, string> = {
  strength: '力量',
  agility: '敏捷',
  intelligence: '智识',
  will: '意志',
  operatorAtk: '干员攻击',
  weaponAtk: '武器攻击',
  operatorHp: '干员生命',
  mainStatFlatBonus: '主能力固定加值',
  subStatFlatBonus: '副能力固定加值',
  mainStatBoost: '主能力百分比',
  subStatBoost: '副能力百分比',
  allStatBoost: '全能力百分比',
  atkPercentBoost: '攻击百分比',
  flatAtk: '固定攻击',
  hpPercent: '生命百分比',
  critRateBoost: '暴击率加成',
  critDmgBonusBoost: '暴击伤害加成',
  sourceSkillBoost: '源石技艺强度',
  healingBonus: '治疗效率',
  receivedHealingBonus: '受治疗效率',
  chainCooldownReduction: '连携技冷却缩减',
  ultimateChargeEfficiency: '终结技充能效率',
  imbalanceEfficiency: '失衡效率',
  damageReduction: '伤害减免',
};

const DAMAGE_BONUS_LABELS: Record<string, string> = {
  physicalDmgBonus: '物理伤害加成',
  fireDmgBonus: '灼热伤害加成',
  electricDmgBonus: '电磁伤害加成',
  iceDmgBonus: '寒冷伤害加成',
  natureDmgBonus: '自然伤害加成',
  magicDmgBonus: '法术伤害加成',
  normalAttackDmgBonus: '普通攻击伤害加成',
  skillDmgBonus: '战技伤害加成',
  chainSkillDmgBonus: '连携技伤害加成',
  ultimateDmgBonus: '终结技伤害加成',
  allSkillDmgBonus: '全技能伤害加成',
  imbalanceDmgBonus: '对失衡目标伤害加成',
  allDmgBonus: '全伤害加成',
};

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

function addOperatorSheet(workbook: ExcelJS.Workbook, input: BuildDamageExcelWorkbookInput, sourceRefs: SourceCellRefMap): void {
  const sheet = workbook.addWorksheet('干员');
  sheet.getRow(1).values = ['干员ID', '干员名', '字段', '数值', '说明'];
  styleHeader(sheet.getRow(1));

  let rowNumber = 2;
  getOperatorConfigSnapshots(input).forEach(([characterId, snapshot]) => {
    const characterName = snapshot.operator.name || characterId;
    const rows: Array<[string, number | string, string]> = [
      ['等级', snapshot.operator.level, 'operator.level'],
      ['潜能', snapshot.operator.potential, 'operator.potential'],
      ['基础生命', snapshot.operator.baseAttributes.hp, 'operator.baseAttributes.hp'],
      ['基础攻击', snapshot.operator.baseAttributes.atk, 'operator.baseAttributes.atk'],
      ['力量', snapshot.operator.baseAttributes.strength, 'operator.baseAttributes.strength'],
      ['敏捷', snapshot.operator.baseAttributes.agility, 'operator.baseAttributes.agility'],
      ['智识', snapshot.operator.baseAttributes.intelligence, 'operator.baseAttributes.intelligence'],
      ['意志', snapshot.operator.baseAttributes.will, 'operator.baseAttributes.will'],
      ['主能力固定加值', snapshot.operator.mainStatFlatBonus, 'operator.mainStatFlatBonus'],
      ['副能力固定加值', snapshot.operator.subStatFlatBonus, 'operator.subStatFlatBonus'],
    ];
    rows.forEach(([field, value, note]) => {
      const excelRow = sheet.getRow(rowNumber);
      excelRow.values = [characterId, characterName, field, value, note];
      styleBody(excelRow);
      if (typeof value === 'number') {
        addSourceCellRef(sourceRefs, characterId, note, '干员', rowNumber);
      }
      rowNumber += 1;
    });
  });

  if (rowNumber === 2) {
    getCharacterRows(input).forEach((row) => {
      const excelRow = sheet.getRow(rowNumber);
      excelRow.values = [row.characterId, row.characterName, '技能等级', row.subtitle, row.meta];
      styleBody(excelRow);
      rowNumber += 1;
    });
  }

  setColumnWidths(sheet, [18, 18, 24, 16, 42]);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function addSourceCellRef(refs: SourceCellRefMap, characterId: string, path: string, sheetName: '干员' | '武器' | '装备', rowNumber: number): void {
  const characterRefs = refs.get(characterId) ?? new Map<string, string>();
  characterRefs.set(path, q(sheetName, `D${rowNumber}`));
  refs.set(characterId, characterRefs);
}

function addSourceRow(
  sheet: ExcelJS.Worksheet,
  refs: SourceCellRefMap,
  sheetName: '武器' | '装备',
  rowNumber: number,
  characterId: string,
  characterName: string,
  path: string,
  field: string,
  value: number | string,
  note: string,
): void {
  const row = sheet.getRow(rowNumber);
  row.values = [characterId, characterName, field, value, note];
  styleBody(row);
  if (typeof value === 'number') {
    addSourceCellRef(refs, characterId, path, sheetName, rowNumber);
  }
}

function addWeaponSourceSheet(workbook: ExcelJS.Workbook, snapshots: Array<[string, ConfigSnapshot]>, refs: SourceCellRefMap): void {
  const sheet = workbook.addWorksheet('武器');
  sheet.getRow(1).values = ['干员ID', '干员名', '字段', '数值', '说明'];
  styleHeader(sheet.getRow(1));

  let rowNumber = 2;
  snapshots.forEach(([characterId, snapshot]) => {
    const characterName = snapshot.operator.name || characterId;
    addSourceRow(sheet, refs, '武器', rowNumber, characterId, characterName, 'weapon.attack', '武器攻击', snapshot.weapon.attack, snapshot.weapon.name || snapshot.weapon.id);
    rowNumber += 1;
    Object.entries(snapshot.weapon.totals ?? {}).forEach(([field, value]) => {
      if (typeof value !== 'number') return;
      addSourceRow(sheet, refs, '武器', rowNumber, characterId, characterName, `weapon.totals.${field}`, field, value, 'weapon.totals');
      rowNumber += 1;
    });
  });

  if (rowNumber === 2) {
    const row = sheet.getRow(2);
    row.values = ['', '', '未捕获武器来源', 0, ''];
    styleBody(row);
  }

  setColumnWidths(sheet, [18, 18, 28, 16, 42]);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function addEquipmentSourceSheet(workbook: ExcelJS.Workbook, snapshots: Array<[string, ConfigSnapshot]>, refs: SourceCellRefMap): void {
  const sheet = workbook.addWorksheet('装备');
  sheet.getRow(1).values = ['干员ID', '干员名', '字段', '数值', '说明'];
  styleHeader(sheet.getRow(1));

  let rowNumber = 2;
  snapshots.forEach(([characterId, snapshot]) => {
    const characterName = snapshot.operator.name || characterId;
    Object.entries(snapshot.equipment.totals ?? {}).forEach(([field, value]) => {
      if (typeof value !== 'number') return;
      addSourceRow(sheet, refs, '装备', rowNumber, characterId, characterName, `equipment.totals.${field}`, field, value, 'equipment.totals');
      rowNumber += 1;
    });
  });

  if (rowNumber === 2) {
    const row = sheet.getRow(2);
    row.values = ['', '', '未捕获装备来源', 0, ''];
    styleBody(row);
  }

  setColumnWidths(sheet, [18, 18, 28, 16, 42]);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function getOperatorConfigSnapshots(input: BuildDamageExcelWorkbookInput): Array<[string, ConfigSnapshot]> {
  return Object.entries(input.operatorConfigPageCache ?? {}).filter(([, snapshot]) => Boolean(snapshot?.panel?.calc && snapshot?.panel?.display));
}

function getCalcRef(refs: CalcCellRefMap, characterId: string, path: string): string {
  return refs.get(characterId)?.get(path) ?? '0';
}

function getSourceRef(refs: SourceCellRefMap, characterId: string, path: string): string {
  return refs.get(characterId)?.get(path) ?? '0';
}

function joinAdditiveRefs(refs: string[]): string {
  return refs.length > 0 ? refs.join('+') : '0';
}

function getCalcFormula(path: string, snapshot: ConfigSnapshot, sourceRefs: SourceCellRefMap, characterId: string): string {
  const source = (sourcePath: string) => getSourceRef(sourceRefs, characterId, sourcePath);
  const mainField = getAbilityField(snapshot.operator.mainStat);
  const subField = getAbilityField(snapshot.operator.subStat);
  switch (path) {
    case 'strength':
    case 'agility':
    case 'intelligence':
    case 'will': {
      const refs = [
        source(`operator.baseAttributes.${path}`),
        source(`weapon.totals.${path}Boost`),
        source(`equipment.totals.${path}Boost`),
      ];
      if (mainField === path) {
        refs.push(source('operator.mainStatFlatBonus'), source('weapon.totals.mainStat'));
      }
      if (subField === path) {
        refs.push(source('operator.subStatFlatBonus'), source('weapon.totals.subStat'));
      }
      return joinAdditiveRefs(refs);
    }
    case 'operatorAtk':
      return source('operator.baseAttributes.atk');
    case 'weaponAtk':
      return source('weapon.attack');
    case 'operatorHp':
      return source('operator.baseAttributes.hp');
    case 'mainStatFlatBonus':
      return source('operator.mainStatFlatBonus');
    case 'subStatFlatBonus':
      return source('operator.subStatFlatBonus');
    case 'mainStatBoost':
      return source('equipment.totals.mainStatBoost');
    case 'subStatBoost':
      return source('equipment.totals.subStatBoost');
    case 'allStatBoost':
      return source('weapon.totals.allStatBoost');
    case 'atkPercentBoost':
    case 'hpPercent':
    case 'critRateBoost':
    case 'critDmgBonusBoost':
    case 'sourceSkillBoost':
    case 'healingBonus':
    case 'ultimateChargeEfficiency':
      return `${source(`weapon.totals.${path}`)}+${source(`equipment.totals.${path}`)}`;
    case 'flatAtk':
      return source('weapon.totals.atk');
    case 'damageReduction':
      return source('equipment.totals.damageReduction');
    case 'receivedHealingBonus':
    case 'chainCooldownReduction':
    case 'imbalanceEfficiency':
      return '0';
    default:
      if (path.startsWith('damageBonus.')) {
        const field = path.slice('damageBonus.'.length);
        return `${source(`weapon.totals.${field}`)}+${source(`equipment.totals.${field}`)}`;
      }
      return '0';
  }
}

function getAbilityField(name: string | undefined): 'strength' | 'agility' | 'intelligence' | 'will' | null {
  switch (name) {
    case '力量':
    case 'strength':
      return 'strength';
    case '敏捷':
    case 'agility':
      return 'agility';
    case '智识':
    case 'intelligence':
      return 'intelligence';
    case '意志':
    case 'will':
      return 'will';
    default:
      return null;
  }
}

function q(sheetName: string, cell: string): string {
  return `'${sheetName}'!${cell}`;
}

function addCalcRef(refs: CalcCellRefMap, characterId: string, path: string, rowNumber: number): void {
  const characterRefs = refs.get(characterId) ?? new Map<string, string>();
  characterRefs.set(path, q('快照', `D${rowNumber}`));
  refs.set(characterId, characterRefs);
}

function addCalcRow(
  sheet: ExcelJS.Worksheet,
  rowNumber: number,
  characterId: string,
  characterName: string,
  label: string,
  formula: string,
  value: number,
): void {
  const row = sheet.getRow(rowNumber);
  row.values = [
    characterId,
    characterName,
    label,
    { formula, result: value },
    'panel.calc',
  ];
  styleBody(row);
}

function addPanelCalcSnapshotSheet(workbook: ExcelJS.Workbook, snapshots: Array<[string, ConfigSnapshot]>, sourceRefs: SourceCellRefMap): CalcCellRefMap {
  const sheet = workbook.addWorksheet('快照');
  const refs: CalcCellRefMap = new Map();
  sheet.getRow(1).values = ['干员ID', '干员名', '字段', '数值', '说明'];
  styleHeader(sheet.getRow(1));

  let rowNumber = 2;
  snapshots.forEach(([characterId, snapshot]) => {
    const characterName = snapshot.operator.name || characterId;
    const calc = snapshot.panel.calc;
    Object.entries(CALC_FIELD_LABELS).forEach(([field, label]) => {
      addCalcRow(sheet, rowNumber, characterId, characterName, label, getCalcFormula(field, snapshot, sourceRefs, characterId), calc[field as keyof PanelCalcSnapshot] as number);
      addCalcRef(refs, characterId, field, rowNumber);
      rowNumber += 1;
    });

    Object.entries(DAMAGE_BONUS_LABELS).forEach(([field, label]) => {
      const path = `damageBonus.${field}`;
      addCalcRow(sheet, rowNumber, characterId, characterName, label, getCalcFormula(path, snapshot, sourceRefs, characterId), calc.damageBonus[field as keyof PanelCalcSnapshot['damageBonus']]);
      addCalcRef(refs, characterId, path, rowNumber);
      rowNumber += 1;
    });
  });

  if (rowNumber === 2) {
    const row = sheet.getRow(2);
    row.values = ['', '', '未捕获 operator-config 面板计算快照', 0, 'panel.calc'];
    styleBody(row);
  }

  setColumnWidths(sheet, [18, 18, 24, 18, 18]);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return refs;
}

function addPanelDisplayRow(
  sheet: ExcelJS.Worksheet,
  rowNumber: number,
  characterId: string,
  characterName: string,
  path: string,
  label: string,
  formula: string,
  cachedValue: number,
  dependency: string,
): void {
  const row = sheet.getRow(rowNumber);
  row.values = [
    characterId,
    characterName,
    `${STORAGE_KEYS.OPERATOR_CONFIG_PAGE_CACHE}.panel.display.${path}`,
    label,
    { formula, result: cachedValue },
    cachedValue,
    dependency,
  ];
  styleBody(row);
}

function addPanelDisplaySheet(workbook: ExcelJS.Workbook, snapshots: Array<[string, ConfigSnapshot]>, calcRefs: CalcCellRefMap): void {
  const sheet = workbook.addWorksheet('面板展示');
  sheet.getRow(1).values = ['干员ID', '干员名', '来源路径', '字段', '公式值', '缓存值', '依赖'];
  styleHeader(sheet.getRow(1));

  let rowNumber = 2;
  snapshots.forEach(([characterId, snapshot]) => {
    const characterName = snapshot.operator.name || characterId;
    const display = snapshot.panel.display;
    const mainField = getAbilityField(snapshot.operator.mainStat);
    const subField = getAbilityField(snapshot.operator.subStat);
    const mainRaw = mainField ? getCalcRef(calcRefs, characterId, mainField) : '0';
    const subRaw = subField ? getCalcRef(calcRefs, characterId, subField) : '0';
    const mainStatFinalFormula = `${mainRaw}*(1+${getCalcRef(calcRefs, characterId, 'mainStatBoost')})*(1+${getCalcRef(calcRefs, characterId, 'allStatBoost')})`;
    const subStatFinalFormula = `${subRaw}*(1+${getCalcRef(calcRefs, characterId, 'subStatBoost')})*(1+${getCalcRef(calcRefs, characterId, 'allStatBoost')})`;
    const abilityBonusFormula = `E${rowNumber + 1}*0.005+E${rowNumber + 2}*0.002`;
    const baseAtkFormula = `(${getCalcRef(calcRefs, characterId, 'operatorAtk')}+${getCalcRef(calcRefs, characterId, 'weaponAtk')})*(1+${getCalcRef(calcRefs, characterId, 'atkPercentBoost')})+${getCalcRef(calcRefs, characterId, 'flatAtk')}`;
    const rows = [
      ['hp', '生命值', `${getCalcRef(calcRefs, characterId, 'operatorHp')}*(1+${getCalcRef(calcRefs, characterId, 'hpPercent')})`, display.hp, 'operatorHp,hpPercent'],
      ['mainStatFinal', '主能力最终值', mainStatFinalFormula, display.mainStatFinal, 'mainStat,mainStatBoost,allStatBoost'],
      ['subStatFinal', '副能力最终值', subStatFinalFormula, display.subStatFinal, 'subStat,subStatBoost,allStatBoost'],
      ['abilityBonus', '能力攻击加成', abilityBonusFormula, display.abilityBonus, 'mainStatFinal,subStatFinal'],
      ['baseAtk', '基础攻击', baseAtkFormula, display.baseAtk, 'operatorAtk,weaponAtk,atkPercentBoost,flatAtk'],
      ['atk', '面板攻击', `E${rowNumber + 4}*(1+E${rowNumber + 3})`, display.atk, 'baseAtk,abilityBonus'],
      ['weaponAtkPercent', '武器攻击百分比', `${getCalcRef(calcRefs, characterId, 'atkPercentBoost')}*100`, display.weaponAtkPercent, 'atkPercentBoost'],
      ['critRate', '暴击率', `0.05+${getCalcRef(calcRefs, characterId, 'critRateBoost')}`, display.critRate, 'critRateBoost'],
      ['critDmg', '暴击伤害', `0.5+${getCalcRef(calcRefs, characterId, 'critDmgBonusBoost')}`, display.critDmg, 'critDmgBonusBoost'],
      ['sourceSkill', '源石技艺强度', getCalcRef(calcRefs, characterId, 'sourceSkillBoost'), display.sourceSkill, 'sourceSkillBoost'],
    ] as const;

    rows.forEach(([path, label, formula, cachedValue, dependency]) => {
      addPanelDisplayRow(sheet, rowNumber, characterId, characterName, path, label, formula, cachedValue, dependency);
      rowNumber += 1;
    });
  });

  if (rowNumber === 2) {
    const row = sheet.getRow(2);
    row.values = ['', '', `${STORAGE_KEYS.OPERATOR_CONFIG_PAGE_CACHE}.panel.display`, '未捕获 operator-config 展示面板', 0, 0, ''];
    styleBody(row);
  }

  setColumnWidths(sheet, [18, 18, 76, 22, 18, 14, 42]);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function addPanelDamageBonusSheet(workbook: ExcelJS.Workbook, snapshots: Array<[string, ConfigSnapshot]>, calcRefs: CalcCellRefMap): void {
  const sheet = workbook.addWorksheet('面板伤害加成');
  sheet.getRow(1).values = ['干员ID', '干员名', '来源路径', '字段', '公式值', '缓存值', '依赖'];
  styleHeader(sheet.getRow(1));

  let rowNumber = 2;
  snapshots.forEach(([characterId, snapshot]) => {
    const characterName = snapshot.operator.name || characterId;
    const displayDamageBonus = snapshot.panel.display.damageBonus;
    const calc = (path: string) => getCalcRef(calcRefs, characterId, `damageBonus.${path}`);
    const rows = [
      ['physicalDmgBonus', '物理伤害加成', `${calc('physicalDmgBonus')}+${calc('allDmgBonus')}`, displayDamageBonus.physicalDmgBonus, 'physicalDmgBonus,allDmgBonus'],
      ['fireDmgBonus', '灼热伤害加成', `${calc('fireDmgBonus')}+${calc('magicDmgBonus')}+${calc('allDmgBonus')}`, displayDamageBonus.fireDmgBonus, 'fireDmgBonus,magicDmgBonus,allDmgBonus'],
      ['electricDmgBonus', '电磁伤害加成', `${calc('electricDmgBonus')}+${calc('magicDmgBonus')}+${calc('allDmgBonus')}`, displayDamageBonus.electricDmgBonus, 'electricDmgBonus,magicDmgBonus,allDmgBonus'],
      ['iceDmgBonus', '寒冷伤害加成', `${calc('iceDmgBonus')}+${calc('magicDmgBonus')}+${calc('allDmgBonus')}`, displayDamageBonus.iceDmgBonus, 'iceDmgBonus,magicDmgBonus,allDmgBonus'],
      ['natureDmgBonus', '自然伤害加成', `${calc('natureDmgBonus')}+${calc('magicDmgBonus')}+${calc('allDmgBonus')}`, displayDamageBonus.natureDmgBonus, 'natureDmgBonus,magicDmgBonus,allDmgBonus'],
      ['normalAttackDmgBonus', '普通攻击伤害加成', calc('normalAttackDmgBonus'), displayDamageBonus.normalAttackDmgBonus, 'normalAttackDmgBonus'],
      ['skillDmgBonus', '战技伤害加成', `${calc('skillDmgBonus')}+${calc('allSkillDmgBonus')}`, displayDamageBonus.skillDmgBonus, 'skillDmgBonus,allSkillDmgBonus'],
      ['chainSkillDmgBonus', '连携技伤害加成', `${calc('chainSkillDmgBonus')}+${calc('allSkillDmgBonus')}`, displayDamageBonus.chainSkillDmgBonus, 'chainSkillDmgBonus,allSkillDmgBonus'],
      ['ultimateDmgBonus', '终结技伤害加成', `${calc('ultimateDmgBonus')}+${calc('allSkillDmgBonus')}`, displayDamageBonus.ultimateDmgBonus, 'ultimateDmgBonus,allSkillDmgBonus'],
      ['imbalanceDmgBonus', '对失衡目标伤害加成', calc('imbalanceDmgBonus'), displayDamageBonus.imbalanceDmgBonus, 'imbalanceDmgBonus'],
    ] as const;

    rows.forEach(([path, label, formula, cachedValue, dependency]) => {
      addPanelDisplayRow(sheet, rowNumber, characterId, characterName, `damageBonus.${path}`, label, formula, cachedValue, dependency);
      rowNumber += 1;
    });
  });

  if (rowNumber === 2) {
    const row = sheet.getRow(2);
    row.values = ['', '', `${STORAGE_KEYS.OPERATOR_CONFIG_PAGE_CACHE}.panel.display.damageBonus`, '未捕获 operator-config 伤害加成面板', 0, 0, ''];
    styleBody(row);
  }

  setColumnWidths(sheet, [18, 18, 88, 24, 18, 14, 48]);
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
  const operatorConfigSnapshots = getOperatorConfigSnapshots(input);
  const sourceRefs: SourceCellRefMap = new Map();
  addOperatorSheet(workbook, input, sourceRefs);
  addWeaponSourceSheet(workbook, operatorConfigSnapshots, sourceRefs);
  addEquipmentSourceSheet(workbook, operatorConfigSnapshots, sourceRefs);
  const calcRefs = addPanelCalcSnapshotSheet(workbook, operatorConfigSnapshots, sourceRefs);
  addPanelDisplaySheet(workbook, operatorConfigSnapshots, calcRefs);
  addPanelDamageBonusSheet(workbook, operatorConfigSnapshots, calcRefs);
  const buffRefs = addBuffSheet(workbook, input.allBuffList ?? []);
  addHitSheet(workbook, input, hitRows, buffRefs);
  addDamageSheet(workbook, hitRows);

  return workbook;
}
