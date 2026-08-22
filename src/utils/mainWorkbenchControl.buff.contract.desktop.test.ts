import assert from 'node:assert/strict';
import {
  projectMainWorkbenchCandidateBuff,
  projectMainWorkbenchBuff,
  projectMainWorkbenchButtonState,
} from './mainWorkbenchControl';
import type { SkillButtonBuff } from '../types/storage';
import type { CandidateBuff } from '../core/domain/buff';

const buff: SkillButtonBuff = {
  schemaVersion: 2,
  id: 'buff-countable',
  name: 'countable',
  displayName: '叠层增伤',
  sourceName: '测试干员',
  level: 'M3',
  type: 'attackPercent',
  value: 0.1,
  description: '满足条件时叠加',
  source: 'operator-talent',
  condition: '命中后',
  category: 'countable',
  effectKind: 'modifier',
  ownerBuffDomain: 'operator',
  ownerCharacterId: 'operator-a',
  ownerBuffGroup: 'talent',
  maxStacks: 4,
  refCount: 2,
  multiplier: { coefficient: 1.1 },
  target: { mode: 'skillType', skillType: 'E' },
  valueMode: 'derived',
  derivedValue: { source: 'agility', perPointValue: 0.01 },
  extraHitConfig: {
    key: 'extra-hit',
    damageType: 'fire',
    skillType: 'E',
    baseMultiplier: 0.5,
    imbalanceValue: 2,
    cooldownSeconds: 3,
    trigger: 'physicalAbnormal',
  },
};

const projected = projectMainWorkbenchBuff(buff);
assert.equal(projected.condition, '命中后');
assert.equal(projected.maxStacks, 4);
assert.equal(projected.refCount, 2);
assert.deepEqual(projected.multiplier, { coefficient: 1.1 });
assert.deepEqual(projected.target, {
  mode: 'skillType',
  key: null,
  skillType: 'E',
  element: null,
});
assert.deepEqual(projected.extraHitConfig, buff.extraHitConfig);
assert.doesNotThrow(() => JSON.stringify(projected));

const candidateBuff: CandidateBuff = {
  schemaVersion: 2,
  name: 'unattached-candidate',
  displayName: '未附加候选 Buff',
  sourceName: '可信天赋',
  level: 'M3',
  type: 'attackPercent',
  value: 0.25,
  description: '来自浏览器候选目录的完整定义',
  source: '可信干员',
  condition: '技能命中后',
  category: 'countable',
  effectKind: 'modifier',
  ownerBuffDomain: 'operator',
  ownerCharacterId: 'operator-a',
  ownerBuffGroup: 'talent',
  maxStacks: 3,
  multiplier: { coefficient: 1.1 },
  valueMode: 'fixed',
  derivedValue: undefined,
  extraHitConfig: undefined,
};
const candidateProjected = projectMainWorkbenchCandidateBuff(candidateBuff);
assert.deepEqual(candidateProjected, {
  schemaVersion: 2,
  id: null,
  name: 'unattached-candidate',
  displayName: '未附加候选 Buff',
  sourceName: '可信天赋',
  level: 'M3',
  type: 'attackPercent',
  value: 0.25,
  description: '来自浏览器候选目录的完整定义',
  source: '可信干员',
  condition: '技能命中后',
  category: 'countable',
  effectKind: 'modifier',
  ownerBuffDomain: 'operator',
  ownerCharacterId: 'operator-a',
  ownerBuffGroup: 'talent',
  maxStacks: 3,
  refCount: null,
  multiplier: { coefficient: 1.1 },
  target: null,
  valueMode: 'fixed',
  derivedValue: null,
  extraHitConfig: null,
});
assert.doesNotThrow(() => JSON.stringify(candidateProjected));

const state = projectMainWorkbenchButtonState({
  selectedBuffIds: [buff.id, 'missing-buff'],
  selectedBuffs: [buff],
  buffStackCounts: { [buff.id]: 3 },
  panelConfig: {
    selectedBuff: [buff.id, 'missing-buff'],
    globallyDisabledBuffIds: ['missing-buff'],
    manualDisabledBuffIdsBySegmentKey: { 'normal-hit-1': [buff.id] },
    manualBuffStackCountsBySegmentKey: { 'normal-hit-1': { [buff.id]: 2 } },
    manualDisabledHitKeys: ['hit-2'],
  },
  targetResistance: { physicalResistance: 25 },
});
assert.deepEqual(state.currentStackCounts, {
  [buff.id]: 3,
  'missing-buff': null,
});
assert.deepEqual(state.currentStackCountSources, {
  [buff.id]: 'persisted',
  'missing-buff': 'unavailable',
});
assert.deepEqual(state.targetResistance, {
  electricResistance: null,
  fireResistance: null,
  iceResistance: null,
  natureResistance: null,
  physicalResistance: 25,
});
assert.deepEqual(state.globallyDisabledBuffIds, ['missing-buff']);
assert.deepEqual(state.manualDisabledBuffIdsBySegmentKey, {
  'normal-hit-1': [buff.id],
});
assert.deepEqual(state.manualBuffStackCountsBySegmentKey, {
  'normal-hit-1': { [buff.id]: 2 },
});
assert.deepEqual(state.manualDisabledHitKeys, ['hit-2']);
assert.doesNotThrow(() => JSON.stringify(state));

// The product calculator's persistence rule is explicit: a countable Buff
// without an override uses maxStacks, while a non-countable Buff uses one.
// Keep the source marker so the Agent cannot mistake that default for a
// persisted user-selected count.
const countableDefault = { ...buff, id: 'buff-countable-default' };
const passiveDefault = {
  ...buff,
  id: 'buff-passive-default',
  category: 'passive' as const,
  maxStacks: null,
};
const defaults = projectMainWorkbenchButtonState({
  selectedBuffIds: [countableDefault.id, passiveDefault.id],
  selectedBuffs: [countableDefault, passiveDefault],
  buffStackCounts: {},
});
assert.deepEqual(defaults.currentStackCounts, {
  [countableDefault.id]: 4,
  [passiveDefault.id]: 1,
});
assert.deepEqual(defaults.currentStackCountSources, {
  [countableDefault.id]: 'default-max-stacks',
  [passiveDefault.id]: 'default-one',
});

console.log('MAIN_WORKBENCH_BUFF_PROJECTION_CONTRACT_OK');
