import { calculateBuffTotals, calculateResistanceZone } from './buffCalculator';
import type { SkillButtonBuff } from '../../types/storage';

function assertClose(actual: number, expected: number, message: string): void {
  if (Math.abs(actual - expected) > 0.000001) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function buff(type: string, value: number): SkillButtonBuff {
  return {
    id: `${type}-${value}`,
    name: type,
    displayName: type,
    sourceName: 'test',
    type,
    value,
    source: 'test',
    refCount: 1,
  };
}

assertClose(
  calculateResistanceZone('nature', undefined, calculateBuffTotals([])).resistanceZone,
  1,
  'missing resistance input should keep resistance zone neutral'
);

assertClose(
  calculateResistanceZone('nature', { natureResistance: 20 }, calculateBuffTotals([])).resistanceZone,
  0.8,
  'nature resistance should reduce nature hit'
);

assertClose(
  calculateResistanceZone('nature', { natureResistance: 20 }, calculateBuffTotals([buff('allCorrosion', 12)])).resistanceZone,
  0.92,
  'all corrosion should reduce effective resistance'
);

assertClose(
  calculateResistanceZone('nature', { natureResistance: 20 }, calculateBuffTotals([buff('natureResistanceIgnore', 10)])).resistanceZone,
  0.9,
  'specific resistance ignore should add back to resistance zone'
);

assertClose(
  calculateResistanceZone('nature', { natureResistance: 20 }, calculateBuffTotals([buff('allCorrosion', 12), buff('natureResistanceIgnore', 10)])).resistanceZone,
  1.02,
  'corrosion and resistance ignore should stack additively in resistance zone'
);

assertClose(
  calculateResistanceZone('physical', { physicalResistance: 20 }, calculateBuffTotals([buff('allCorrosion', 5), buff('magicCorrosion', 7), buff('physicalCorrosion', 3)])).corrosion,
  8,
  'physical hit should consume all and physical corrosion only'
);

assertClose(
  calculateResistanceZone('fire', { fireResistance: 20 }, calculateBuffTotals([buff('allCorrosion', 5), buff('magicCorrosion', 7), buff('fireCorrosion', 3), buff('physicalCorrosion', 11)])).corrosion,
  15,
  'element hit should consume all, magic, and specific corrosion'
);

assertClose(
  calculateResistanceZone('ice', { iceResistance: 20 }, calculateBuffTotals([buff('allResistanceIgnore', 5), buff('magicResistanceIgnore', 7), buff('iceResistanceIgnore', 3), buff('physicalResistanceIgnore', 11)])).resistanceIgnore,
  15,
  'element hit should consume all, magic, and specific resistance ignore'
);
