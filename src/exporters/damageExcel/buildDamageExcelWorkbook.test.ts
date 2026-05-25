import ExcelJS from 'exceljs';
import { buildDamageExcelWorkbook } from './buildDamageExcelWorkbook.ts';
import type { DamageExcelColumn, DamageExcelRow } from './damageExcelModel.ts';

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertTruthy(value: unknown, message: string): void {
  if (!value) {
    throw new Error(message);
  }
}

function getFormula(value: unknown): string {
  if (value && typeof value === 'object' && 'formula' in value) {
    return String((value as { formula: string }).formula);
  }
  return '';
}

const columns: DamageExcelColumn[] = [
  { key: 'characterName', title: '干员', width: 112, group: '索引', sticky: true },
  { key: 'hitLabel', title: '命中', width: 64, group: '索引', align: 'center' },
  { key: 'skillType', title: '类型', width: 32, group: '索引', align: 'center' },
  { key: 'element', title: '属性', width: 32, group: '索引', align: 'center' },
  { key: 'baseMultiplier', title: '基础倍率', width: 76, group: '倍率区', align: 'right' },
  { key: 'bonusMultiplier', title: '加算倍率', width: 76, group: '倍率区', align: 'right' },
  { key: 'finalMultiplier', title: '最终倍率', width: 76, group: '倍率区', align: 'right' },
  { key: 'atk', title: '实时攻击', width: 82, group: '面板区', align: 'right' },
  { key: 'critRate', title: '暴击率', width: 64, group: '面板区', align: 'right' },
  { key: 'critDmg', title: '暴伤', width: 64, group: '面板区', align: 'right' },
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

const rows: DamageExcelRow[] = [
  {
    kind: 'character',
    id: 'character-op1',
    characterId: 'op1',
    characterName: '测试干员',
    title: '测试干员',
    subtitle: 'A 1 / B 1 / E 1 / Q 1',
    meta: '测试快照',
  },
  {
    kind: 'button',
    id: 'button-skill1',
    buttonId: 'skill1',
    characterId: 'op1',
    characterName: '测试干员',
    title: 'A / 测试技能',
    subtitle: '按钮 1',
    meta: '1 段命中',
  },
  {
    kind: 'hit',
    id: 'skill1-hit1',
    characterId: 'op1',
    buttonId: 'skill1',
    rowIndex: 1,
    values: {
      characterName: '测试干员',
      hitLabel: '第一段',
      skillType: 'A',
      element: '物理',
      baseMultiplier: '100.0%',
      bonusMultiplier: '20.0%',
      finalMultiplier: '120.0%',
      atk: '1000',
      critRate: '50.0%',
      critDmg: '100.0%',
      damageBonusRate: '1.500',
      defenseZone: '0.500',
      amplifyRate: '1.100',
      fragileRate: '1.200',
      vulnerabilityRate: '1.300',
      comboDamageBonus: '1.000',
      imbalanceDamageBonus: '1.000',
      baseDamage: '900',
      nonCrit: '1544',
      crit: '3089',
      expected: '2316',
    },
    detail: {
      characterName: '测试干员',
      buttonName: '测试技能',
      hitLabel: '第一段',
      hit: { key: 'hit1', displayName: '第一段', multiplier: 1, element: 'physical', skillType: 'A' },
      hitResult: {
        panel: { atk: 1000, critRate: 0.5, critDmg: 1 },
        multiplier: { base: 1, afterBonus: 1.2, afterMultiply: 1.2 },
        zones: {
          damageBonusRate: 1.5,
          defenseZone: 0.5,
          amplifyRate: 0.1,
          fragileRate: 0.2,
          vulnerabilityRate: 0.3,
          comboDamageBonus: 0,
          imbalanceDamageBonus: 0,
          elementBonus: 0.2,
          skillBonus: 0.1,
          allDamageBonus: 0.2,
        },
        nonCrit: { base: 900, final: 1544.4 },
        crit: { final: 3088.8 },
        expected: { final: 2316.6 },
        appliedBuffs: [
          {
            id: 'buff1',
            name: '测试全伤',
            displayName: '测试全伤',
            sourceName: '测试来源',
            refCount: 1,
            type: 'allDmgBonus',
            value: 0.2,
          },
          {
            id: 'buff2',
            name: '测试增幅',
            displayName: '测试增幅',
            sourceName: '测试来源',
            refCount: 1,
            type: 'physicalAmplify',
            value: 0.1,
          },
          {
            id: 'buff3',
            name: '测试易伤',
            displayName: '测试易伤',
            sourceName: '测试来源',
            refCount: 1,
            type: 'physicalFragile',
            value: 0.2,
          },
          {
            id: 'buff4',
            name: '测试脆弱',
            displayName: '测试脆弱',
            sourceName: '测试来源',
            refCount: 1,
            type: 'physicalVulnerability',
            value: 0.3,
          },
        ],
      },
    },
  },
];

const workbook = buildDamageExcelWorkbook({
  rows,
  columns,
  storageSnapshot: [{ key: 'def.timeline', value: '{"ok":true}' }],
});

assertEqual(
  workbook.worksheets.map((sheet) => sheet.name).join('|'),
  '干员|武器|装备|Buff|快照|命中|伤害过程',
  'workbook follows damage lineage sheets',
);

const hitSheet = workbook.getWorksheet('命中');
assertTruthy(hitSheet, 'hit sheet exists');
assertEqual(getFormula(hitSheet!.getCell('K2').value), 'H2+I2', 'hit multiplier after bonus comes from base multiplier and buff bonus');
assertEqual(getFormula(hitSheet!.getCell('L2').value), 'K2*J2', 'hit final multiplier comes from multiplier inputs');
assertEqual(getFormula(hitSheet!.getCell('S2').value), '1+P2+Q2+R2+Buff!H2', 'hit damage bonus rate uses direct buff cell');
assertEqual(getFormula(hitSheet!.getCell('U2').value), '1+Buff!H3', 'hit amplify zone consumes direct buff cell');

const damageSheet = workbook.getWorksheet('伤害过程');
assertTruthy(damageSheet, 'damage sheet exists');
assertEqual(getFormula(damageSheet!.getCell('H2').value), '命中!M2*命中!L2', 'damage base damage consumes hit sheet');
assertEqual(getFormula(damageSheet!.getCell('I2').value), '命中!M2*命中!L2*命中!S2*命中!T2*命中!U2*命中!V2*命中!W2*命中!X2*命中!Y2', 'damage non-crit consumes hit sheet');
assertEqual(getFormula(damageSheet!.getCell('J2').value), 'I2*(1+命中!O2)', 'damage crit uses hit crit damage');
assertEqual(getFormula(damageSheet!.getCell('K2').value), 'I2*(1-命中!N2)+J2*命中!N2', 'damage expected uses hit crit rate');

const buffSheet = workbook.getWorksheet('Buff');
assertTruthy(buffSheet, 'buff sheet exists');
assertEqual(buffSheet!.getCell('A2').value, 'skill1-hit1', 'buff rows are scoped to hit');
assertEqual(buffSheet!.getCell('G2').value, 'allDmgBonus', 'buff keeps normalized type');
assertEqual(buffSheet!.getCell('H2').value, 0.2, 'buff keeps normalized value');

const exported = await workbook.xlsx.writeBuffer();
const reloaded = new ExcelJS.Workbook();
await reloaded.xlsx.load(exported);
const reloadedDamageSheet = reloaded.getWorksheet('伤害过程');
const reloadedHitSheet = reloaded.getWorksheet('命中');
assertTruthy(reloadedDamageSheet, 'reloaded damage sheet exists');
assertTruthy(reloadedHitSheet, 'reloaded hit sheet exists');
assertEqual(getFormula(reloadedDamageSheet!.getCell('I2').value), '命中!M2*命中!L2*命中!S2*命中!T2*命中!U2*命中!V2*命中!W2*命中!X2*命中!Y2', 'exported xlsx keeps damage formula');
assertEqual(getFormula(reloadedHitSheet!.getCell('U2').value), '1+Buff!H3', 'exported xlsx keeps hit buff formula');
