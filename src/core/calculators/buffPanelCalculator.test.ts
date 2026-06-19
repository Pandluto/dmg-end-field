import type { SkillButtonBuff } from '../../types/storage';
import { calculateBuffedPanel } from './buffCalculator';

function assertClose(actual: number, expected: number, message: string): void {
  if (Math.abs(actual - expected) > 1e-9) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function createBuff(id: string, type: string, value: number): SkillButtonBuff {
  return {
    id,
    name: id,
    displayName: id,
    sourceName: 'test',
    source: 'test',
    level: '',
    type,
    value,
    category: 'condition',
    effectKind: 'modifier',
    refCount: 1,
  };
}

function createMultiplierBuff(id: string, type: string, coefficient: number): SkillButtonBuff {
  return {
    ...createBuff(id, type, 0),
    value: undefined,
    multiplier: { coefficient },
  };
}

const panelBase = {
  baseAtk: 1000,
  characterAtk: 600,
  weaponAtk: 400,
  weaponAtkPercent: 0,
  abilityBonus: 78.1,
  critRate: 0.05,
  critDmg: 0.5,
  strength: 132,
  agility: 60.5,
  intelligence: 30,
  will: 40,
  mainStatFinal: 132,
  subStatFinal: 60.5,
  mainStatField: 'strength' as const,
  subStatField: 'agility' as const,
  mainStatScale: 0.2,
  subStatScale: 0.1,
  allStatScale: 0.1,
};

assertClose(
  calculateBuffedPanel(panelBase, [createBuff('agility', 'agilityBoost', 15)]).atk,
  1817.3,
  'sub ability flat buff should be applied before ability multipliers',
);

assertClose(
  calculateBuffedPanel(panelBase, [createBuff('main', 'mainStatBoost', 0.1)]).atk,
  1836,
  'main ability multiplier buff should recalculate ability attack bonus',
);

assertClose(
  calculateBuffedPanel(panelBase, [createBuff('sub', 'subStatBoost', 0.1)]).atk,
  1792,
  'sub ability multiplier buff should recalculate ability attack bonus',
);

assertClose(
  calculateBuffedPanel(panelBase, [createBuff('all', 'allStatBoost', 0.1)]).atk,
  1852,
  'all ability multiplier buff should recalculate both main and sub ability values',
);

assertClose(
  calculateBuffedPanel(panelBase, [
    createBuff('strength', 'strengthBoost', 10),
    createBuff('agility', 'agilityBoost', 15),
    createBuff('intelligence', 'intelligenceBoost', 20),
    createBuff('will', 'willBoost', 25),
    createBuff('main', 'mainStatBoost', 0.1),
    createBuff('sub', 'subStatBoost', 0.1),
    createBuff('all', 'allStatBoost', 0.1),
  ]).atk,
  2045.2,
  'four abilities and three ability multipliers should use flat-before-multiplier order',
);

assertClose(
  calculateBuffedPanel(panelBase, [createMultiplierBuff('agility-multiplier', 'agilityBoost', 1.5)]).atk,
  1841.5,
  'ability multiplier should multiply the final ability value after other calculations',
);

assertClose(
  calculateBuffedPanel(panelBase, [
    createBuff('agility-flat', 'agilityBoost', 15),
    createBuff('sub-additive', 'subStatBoost', 0.1),
    createMultiplierBuff('agility-multiplier', 'agilityBoost', 1.5),
    createMultiplierBuff('sub-multiplier', 'subStatBoost', 1.2),
    createMultiplierBuff('all-multiplier', 'allStatBoost', 1.1),
  ]).atk,
  2065.768,
  'ability multipliers should run after flat, main/sub, and all-stat additive calculations',
);
