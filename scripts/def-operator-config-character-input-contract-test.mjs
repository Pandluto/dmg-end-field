import assert from 'node:assert/strict';
import { buildPersistedCharacterInput } from '../src/agentKernel/timelineWorktree/operatorConfigCharacterInput.ts';

function snapshot({ operatorPotential = '5潜', operatorPotentialCount = 6, weaponName = '典范' } = {}) {
  return {
    operator: {
      potential: operatorPotential,
      potentialCount: operatorPotentialCount,
      skillConfig: { A: 'M3', B: 'M3', E: 'M3', Q: 'M3', Dot: 'M3' },
    },
    weapon: {
      name: weaponName,
      config: { potential: '0潜', potentialCount: 1 },
    },
  };
}

const exact = buildPersistedCharacterInput(snapshot(), null);
assert.equal(exact.potential, '满潜');
assert.equal(exact.weapon.name, '典范');
assert.equal(exact.weapon.potentialMode, 'P0');
assert.deepEqual(exact.skillLevels, { A: 'M3', B: 'M3', E: 'M3', Q: 'M3', Dot: 'M3' });
assert.deepEqual(exact.equipment, {});

const preservedEmpty = buildPersistedCharacterInput(
  snapshot({ operatorPotential: '0潜', operatorPotentialCount: 1, weaponName: '' }),
  { weapon: { name: '', potentialMode: 'P0' }, equipment: { strength: 12 } },
);
assert.equal(preservedEmpty.potential, '0潜');
assert.equal(preservedEmpty.weapon.name, '无');
assert.deepEqual(preservedEmpty.equipment, { strength: 12 });

console.log('DEF operator-config character input persistence contract: PASS');
