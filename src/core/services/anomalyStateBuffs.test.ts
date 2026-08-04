import { calculateBuffTotals } from '../calculators/buffCalculator';
import type { PersistedAnomalyCard } from '../../types/storage';
import {
  buildAnomalyStateDerivedBuffs,
  buildAnomalyStateSnapshotBuffs,
} from './anomalyStateBuffs';
import { createAnomalyStateSnapshot } from './anomalyStateSnapshotStorage';

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertClose(actual: number, expected: number, message: string): void {
  if (Math.abs(actual - expected) > 0.000001) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function stateCard(key: 'combo-state' | 'imbalance-state', level: number): PersistedAnomalyCard {
  return {
    id: `${key}-${level}`,
    key,
    label: key,
    kind: 'state',
    category: 'physical',
    level,
    primaryText: `${key} Lv${level}`,
    secondaryText: '完整状态矩阵',
    selectedBuffIds: [],
  };
}

const comboSkillGoldens = [0.3, 0.45, 0.6, 0.75];
const comboUltimateGoldens = [0.2, 0.3, 0.4, 0.5];
comboSkillGoldens.forEach((expected, index) => {
  const level = index + 1;
  const [skillBuff] = buildAnomalyStateDerivedBuffs([stateCard('combo-state', level)], 'B');
  const [ultimateBuff] = buildAnomalyStateDerivedBuffs([stateCard('combo-state', level)], 'Q');
  assertClose(skillBuff?.value ?? 0, expected, `combo B level ${level}`);
  assertClose(ultimateBuff?.value ?? 0, comboUltimateGoldens[index], `combo Q level ${level}`);
  assertEqual(
    buildAnomalyStateDerivedBuffs([stateCard('combo-state', level)], 'A').length,
    0,
    `combo should not affect A at level ${level}`,
  );
});

const [imbalanceBuff] = buildAnomalyStateDerivedBuffs([stateCard('imbalance-state', 1)], 'B');
assertEqual(imbalanceBuff?.type, 'imbalanceDmgBonus', 'imbalance state Buff type');
assertClose(imbalanceBuff?.value ?? 0, 0.3, 'imbalance state should be a fixed 30%');

const baseSnapshotInput = {
  sourceButtonId: 'state-source-button',
  sourceCharacterId: 'state-source-operator',
  sourceCharacterName: '状态矩阵干员',
  sourceSkillStrengthSnapshot: 60,
  effectValue: 0,
  primaryText: '状态快照',
  secondaryText: '待标准化',
};

const conductive = createAnomalyStateSnapshot({
  ...baseSnapshotInput,
  key: 'conductive',
  label: '导电',
  level: 3,
});
assertClose(conductive.effectValue, 0.26666666666666666, 'source skill should enhance conductive snapshot first');

const armorBreak = createAnomalyStateSnapshot({
  ...baseSnapshotInput,
  key: 'armor-break',
  label: '碎甲',
  level: 4,
  durationSeconds: 10,
});
assertClose(armorBreak.effectValue, 0.32, 'source skill should enhance armor-break snapshot first');

const corrosion = createAnomalyStateSnapshot({
  ...baseSnapshotInput,
  key: 'corrosion',
  label: '腐蚀',
  level: 2,
  durationSeconds: 5,
});
assertClose(corrosion.initialCorrosion ?? 0, 6.4, 'corrosion enhanced initial value');
assertClose(corrosion.tickCorrosionPerSecond ?? 0, 1.4933333333333334, 'corrosion enhanced per-second value');
assertClose(corrosion.maxCorrosion ?? 0, 21.333333333333332, 'corrosion enhanced cap');
assertClose(corrosion.currentCorrosion ?? 0, 13.866666666666667, 'corrosion should apply source skill before elapsed time and cap');

const snapshotBuffs = buildAnomalyStateSnapshotBuffs([conductive, armorBreak, corrosion]);
assertEqual(snapshotBuffs.length, 3, 'all three anomaly snapshots should become runtime Buffs');
assertEqual(snapshotBuffs[0]?.type, 'magicFragile', 'conductive snapshot runtime type');
assertEqual(snapshotBuffs[1]?.type, 'physicalFragile', 'armor-break snapshot runtime type');
assertEqual(snapshotBuffs[2]?.type, 'allCorrosion', 'corrosion snapshot runtime type');
const snapshotTotals = calculateBuffTotals(snapshotBuffs);
assertClose(snapshotTotals.magicFragile, conductive.effectValue, 'conductive snapshot runtime value');
assertClose(snapshotTotals.physicalFragile, armorBreak.effectValue, 'armor-break snapshot runtime value');
assertClose(snapshotTotals.allCorrosion, corrosion.currentCorrosion ?? 0, 'corrosion snapshot runtime value');
