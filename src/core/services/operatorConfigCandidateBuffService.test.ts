import type { ConfigSnapshot } from '../calculators/operatorPanelCalculator';
import { buildSnapshotOperatorCandidateBuffs } from './operatorConfigCandidateBuffService';

const snapshot = {
  operator: {
    id: 'operator-1',
    name: 'Operator',
    buffs: {
      talent: { effects: {} },
      potential: {
        effects: {
          passiveMultiplier: {
            effectId: 'passive-multiplier',
            name: 'Passive multiplier',
            type: 'multiplierBonus',
            category: 'passive',
            value: 1.2,
            multiplier: { coefficient: 1.2 },
          },
          passiveAdditive: {
            effectId: 'passive-additive',
            name: 'Passive additive',
            type: 'atkPercentBoost',
            category: 'passive',
            value: 0.2,
          },
        },
      },
      skill: { effects: {} },
    },
  },
} as unknown as ConfigSnapshot;

const candidates = buildSnapshotOperatorCandidateBuffs(snapshot);

if (candidates.length !== 1) {
  throw new Error(`expected one runtime candidate, got ${candidates.length}`);
}
if (candidates[0].name !== 'operator-studio:operator-1:potential:passive-multiplier') {
  throw new Error(`unexpected passive multiplier candidate: ${candidates[0].name}`);
}
if (candidates[0].multiplier?.coefficient !== 1.2) {
  throw new Error('passive multiplier coefficient was not preserved');
}
