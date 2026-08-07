import assert from 'node:assert/strict';
import {
  type DefDamageReportCapsule,
  type DefDamageReportButton,
  type DamageReportOperationResult,
  aggregateDamageReport,
  attributeDamageReport,
  compareDamageReports,
  currentDamageReportProjection,
  diagnoseDamageReport,
  exportDamageReport,
  explainDamageReport,
  validateDamageReportCapsule,
} from './damage-report-operations.ts';

function expectOk<Value>(result: DamageReportOperationResult<Value>): Value {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

function hit(id: string, expected: number, nonCrit: number) {
  return {
    id,
    title: `${id} 命中`,
    sourceKind: 'normal' as const,
    damageSourceLabel: '主伤害',
    skillTypeLabel: 'A',
    elementLabel: '物理',
    damage: expected,
    expected,
    nonCrit,
    resistanceZone: 0.91,
    resistance: {
      baseResistance: 10,
      corrosion: 2,
      resistanceIgnore: 1,
      effectiveResistance: 8,
      resistanceZone: 0.91,
      formulaText: '产品返回的抗性区说明',
    },
    buffs: [{
      id: `buff-${id}`,
      traceId: `source / buff-${id}`,
      name: '测试 Buff',
      effect: '产品返回的 Buff 说明',
      type: 'allDmgBonus',
      zone: 'damageBonus',
      rawValue: 0.1,
      runtimeCoefficient: 2,
      effectiveValue: 0.2,
      multiplier: false,
    }],
    zones: [{
      key: 'damageBonus',
      additiveTotal: 0.1,
      multiplierProduct: 1,
      // Deliberately not derived by this module. It is an existing product fact.
      finalValue: 7.25,
    }],
  };
}

function button(
  id: string,
  characterId: string,
  characterName: string,
  skillName: string,
  hits: readonly { readonly expected: number; readonly nonCrit: number }[],
): DefDamageReportButton {
  const parsedHits = hits.map((values, index) => hit(`${id}-hit-${index + 1}`, values.expected, values.nonCrit));
  const expected = parsedHits.reduce((sum, item) => sum + item.expected, 0);
  const nonCrit = parsedHits.reduce((sum, item) => sum + item.nonCrit, 0);
  return {
    id,
    characterId,
    groupLabel: '第1组',
    orderLabel: id === 'button-a' ? '01' : '02',
    characterName,
    skillName,
    skillType: 'A',
    damage: expected,
    expected,
    nonCrit,
    share: 0,
    hits: parsedHits,
  };
}

function capsule(options: {
  readonly aHits?: readonly { readonly expected: number; readonly nonCrit: number }[];
  readonly bHits?: readonly { readonly expected: number; readonly nonCrit: number }[];
  readonly includeB?: boolean;
} = {}): DefDamageReportCapsule {
  const buttons: DefDamageReportButton[] = [button(
    'button-a',
    'char-a',
    '洛茜',
    '基础斩击',
    options.aHits ?? [{ expected: 10, nonCrit: 8 }, { expected: 5, nonCrit: 4 }],
  )];
  if (options.includeB !== false) {
    buttons.push(button(
      'button-b',
      'char-b',
      '测试干员',
      '雷鸣',
      options.bHits ?? [{ expected: 20, nonCrit: 16 }],
    ));
  }
  const totalExpected = buttons.reduce((sum, item) => sum + item.expected, 0);
  const totalNonCrit = buttons.reduce((sum, item) => sum + item.nonCrit, 0);
  const normalizedButtons = buttons.map((item) => ({
    ...item,
    share: totalExpected === 0 ? 0 : item.expected / totalExpected,
  }));
  return {
    contract: 'DefDamageReportV1',
    binding: {
      workspaceId: 'workspace-test',
      databaseGeneration: 'generation-damage-fixture',
      timelineId: 'timeline-test',
      checkoutTargetId: 'node-test',
      checkoutUpdatedAt: 100,
      contentRevision: 7,
      snapshotDigest: 'sha256:binding-test',
    },
    formulaVersion: 'damage-report-v1',
    statisticalScope: 'current-workbench-snapshot',
    schemeDigest: 'sha256:scheme-test',
    report: {
      generatedAt: 1_700_000_000_000,
      totalDamage: totalExpected,
      totalExpected,
      totalNonCrit,
      buttonCount: normalizedButtons.length,
      buttons: normalizedButtons,
      characters: normalizedButtons.map((item) => ({
        characterId: item.characterId,
        characterName: item.characterName,
        weaponName: '测试武器',
        weaponPotentialMode: '默认',
        level: 90,
        skillLevels: ['A M3', 'B M3'],
        attributeLines: ['攻击 100'],
        equipmentLines: ['测试装备'],
        skills: [{
          id: `${item.characterId}-skill-a`,
          title: 'A / 基础斩击',
          meta: '等级 M3 Hit 1',
          hitLines: ['hit-1 / 主伤害 / 100.0% / 物理 / A'],
        }],
      })),
    },
  };
}

const baseline = capsule();
const current = capsule({
  aHits: [{ expected: 12, nonCrit: 9 }, { expected: 6, nonCrit: 5 }],
  bHits: [{ expected: 22, nonCrit: 17 }],
});

const validated = expectOk(validateDamageReportCapsule(current));
assert.deepEqual(validated, current);
const currentProjection = expectOk(currentDamageReportProjection(current));
assert.deepEqual(currentProjection.buttonScope, ['button-a', 'button-b']);
assert.equal(currentProjection.totalExpected, 40);
assert.equal(currentProjection.totalNonCrit, 31);

const aggregate = expectOk(aggregateDamageReport(baseline));
assert.deepEqual(aggregate.total, { damage: 35, expected: 35, nonCrit: 28 });
assert.deepEqual(aggregate.buttons.map((item) => [item.id, item.expected, item.nonCrit]), [
  ['button-a', 15, 12],
  ['button-b', 20, 16],
]);
assert.deepEqual(aggregate.characters.map((item) => [item.characterId, item.expected, item.nonCrit]), [
  ['char-a', 15, 12],
  ['char-b', 20, 16],
]);

const comparison = expectOk(compareDamageReports(current, baseline));
assert.deepEqual(comparison.total.expected, { current: 40, baseline: 35, delta: 5 });
assert.deepEqual(comparison.total.nonCrit, { current: 31, baseline: 28, delta: 3 });
assert.deepEqual(comparison.buttons[0]?.expected, { current: 18, baseline: 15, delta: 3 });
assert.deepEqual(comparison.buttons[1]?.nonCrit, { current: 17, baseline: 16, delta: 1 });
assert.deepEqual(comparison.characters[0]?.expected, { current: 18, baseline: 15, delta: 3 });
assert.deepEqual(comparison.characters[1]?.nonCrit, { current: 17, baseline: 16, delta: 1 });

const formulaMismatch = compareDamageReports(
  current,
  { ...baseline, formulaVersion: 'damage-report-v2' },
);
assert.equal(formulaMismatch.ok, false);
if (!formulaMismatch.ok) assert.equal(formulaMismatch.error.code, 'INCOMPATIBLE_FORMULA_VERSION');

const statisticalScopeMismatch = compareDamageReports(
  current,
  { ...baseline, statisticalScope: 'selected-buttons-only' },
);
assert.equal(statisticalScopeMismatch.ok, false);
if (!statisticalScopeMismatch.ok) assert.equal(statisticalScopeMismatch.error.code, 'INCOMPATIBLE_STATISTICAL_SCOPE');

const buttonScopeMismatch = compareDamageReports(current, capsule({ includeB: false }));
assert.equal(buttonScopeMismatch.ok, false);
if (!buttonScopeMismatch.ok) assert.equal(buttonScopeMismatch.error.code, 'INCOMPATIBLE_BUTTON_SCOPE');

const attribute = expectOk(attributeDamageReport(baseline, { buttonId: 'button-a', hitId: 'button-a-hit-1' }));
assert.equal(attribute.facts.length, 1);
assert.equal(attribute.facts[0]?.expected, 10);
assert.equal(attribute.facts[0]?.resistanceZone, 0.91);
assert.equal(attribute.facts[0]?.resistance.resistanceZone, 0.91);
assert.equal(attribute.facts[0]?.zones?.[0]?.finalValue, 7.25);
assert.equal(attribute.facts[0]?.buffs[0]?.effectiveValue, 0.2);

const explanation = expectOk(explainDamageReport(baseline, { hitId: 'button-a-hit-1' }));
assert.deepEqual(explanation.facts, attribute.facts);

const tableExport = expectOk(exportDamageReport(baseline, { format: 'table', maxRows: 1 }));
assert.equal(tableExport.format, 'table');
assert.equal(tableExport.rowCount, 1);
assert.equal(tableExport.truncated, true);
assert.deepEqual(tableExport.headers, ['kind', 'id', 'label', 'characterId', 'expected', 'nonCrit']);

const jsonExport = expectOk(exportDamageReport(baseline, { format: 'json', maxRows: 2 }));
const jsonExportAgain = expectOk(exportDamageReport(baseline, { format: 'json', maxRows: 2 }));
assert.equal(jsonExport.format, 'json');
if (jsonExport.format !== 'json' || jsonExportAgain.format !== 'json') throw new Error('Expected JSON export');
assert.equal(jsonExport.json, jsonExportAgain.json);
assert.equal(jsonExport.rowCount, 2);
assert.equal(jsonExport.truncated, true);
assert.deepEqual(Object.keys(JSON.parse(jsonExport.json)), [
  'contract',
  'format',
  'formulaVersion',
  'statisticalScope',
  'schemeDigest',
  'generatedAt',
  'rows',
  'rowCount',
  'truncated',
]);

assert.equal(expectOk(diagnoseDamageReport(null)).status, 'missing');
assert.equal(expectOk(diagnoseDamageReport({ status: 'stale' })).status, 'stale');
assert.equal(expectOk(diagnoseDamageReport({ status: 'malformed' })).status, 'malformed');
assert.equal(expectOk(diagnoseDamageReport({ error: { code: 'DEF_DAMAGE_REPORT_FORMULA_ERROR', message: '公式失败' } })).status, 'formula-error');
assert.deepEqual(
  expectOk(diagnoseDamageReport({
    status: 'missing',
    code: 'DAMAGE_REPORT_NO_SKILL_BUTTONS',
    message: '没有技能按钮',
  })),
  {
    contract: 'DefDamageDiagnosticV1',
    status: 'missing',
    code: 'DAMAGE_REPORT_NO_SKILL_BUTTONS',
    message: '没有技能按钮',
  },
);
assert.equal(
  expectOk(diagnoseDamageReport({ status: 'missing', code: 'UNTRUSTED_CODE' })).code,
  'DAMAGE_REPORT_MISSING',
);
assert.equal(expectOk(diagnoseDamageReport(current)).status, 'ready');
assert.equal(expectOk(diagnoseDamageReport({ contract: 'DefDamageReportV1' })).status, 'malformed');

const duplicateButton = clone(current);
const duplicateButtonInput: DefDamageReportCapsule = {
  ...duplicateButton,
  report: {
    ...duplicateButton.report,
    buttons: [duplicateButton.report.buttons[0]!, { ...duplicateButton.report.buttons[1]!, id: duplicateButton.report.buttons[0]!.id }],
  },
};
assert.equal(validateDamageReportCapsule(duplicateButtonInput).ok, false);

const inconsistentTotals = clone(current);
const inconsistentTotalsInput: DefDamageReportCapsule = {
  ...inconsistentTotals,
  report: { ...inconsistentTotals.report, totalExpected: inconsistentTotals.report.totalExpected + 1 },
};
assert.equal(validateDamageReportCapsule(inconsistentTotalsInput).ok, false);

const nonFinite = clone(current);
const nonFiniteInput: DefDamageReportCapsule = {
  ...nonFinite,
  report: { ...nonFinite.report, totalNonCrit: Number.NaN },
};
assert.equal(validateDamageReportCapsule(nonFiniteInput).ok, false);

assert.equal(validateDamageReportCapsule({ ...current, report: { ...current.report, buttons: [] } }).ok, false);

console.log('DEF_DAMAGE_REPORT_OPERATIONS_OK');
