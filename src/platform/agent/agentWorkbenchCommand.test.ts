import assert from 'node:assert/strict';
import type { JsonObject } from '../../../agent/core/contracts/json.ts';
import {
  AgentWorkbenchCommandError,
  parseAgentWorkbenchCommand,
} from './agentWorkbenchCommand';

function rejected(command: JsonObject): void {
  assert.throws(
    () => parseAgentWorkbenchCommand(command),
    (error: unknown) => error instanceof AgentWorkbenchCommandError,
  );
}

const selection = parseAgentWorkbenchCommand({
  op: 'selectCharacters',
  characterNames: ['洛茜'],
  nodeTitle: '调整阵容：仅保留洛茜',
  nodeDescription: '将当前队伍调整为仅保留洛茜，并记录本次 AI 修改。',
  openCanvas: true,
  approval: {
    mode: 'manual',
    approvedBy: 'user',
    rationale: 'Approved in the embedded DEF AI mode.',
  },
});
assert.equal(selection.op, 'selectCharacters');
assert.equal(selection.nodeTitle, '调整阵容：仅保留洛茜');

rejected({
  op: 'selectCharacters',
  characterNames: ['洛茜'],
  approval: { mode: 'manual', approvedBy: 'user' },
});
rejected({
  op: 'selectCharacters',
  characterNames: ['洛茜'],
  nodeTitle: '[ai] 调整阵容',
  nodeDescription: '错误地使用固定前缀。',
  approval: { mode: 'manual', approvedBy: 'user' },
});

const complexBuff = parseAgentWorkbenchCommand({
  op: 'addBuff',
  buttonId: 'button-a',
  select: true,
  buff: {
    schemaVersion: 2,
    name: 'test-extra-hit',
    displayName: '测试额外伤害',
    sourceName: '测试专用干员',
    type: 'physicalDamageBonus',
    value: 25,
    category: 'countable',
    maxStacks: 3,
    refCount: 0,
    multiplier: { coefficient: 1.25 },
    target: { mode: 'skillType', skillType: 'B' },
    effectKind: 'extraHit',
    extraHitConfig: {
      key: 'extra-hit-a',
      damageType: 'physical',
      skillType: 'B',
      baseMultiplier: 0.8,
      imbalanceValue: 20,
      cooldownSeconds: 2,
      trigger: 'physicalAbnormal',
    },
    valueMode: 'derived',
    derivedValue: { source: 'strength', perPointValue: 0.15 },
  },
});
assert.equal(complexBuff.op, 'addBuff');
assert.equal(complexBuff.buff.displayName, '测试额外伤害');
assert.equal(complexBuff.buff.extraHitConfig?.trigger, 'physicalAbnormal');

rejected({
  op: 'addBuff',
  buttonId: 'button-a',
  buff: { name: 'x', displayName: 'x', sourceName: 'x', hiddenCode: 'execute-me' },
});
rejected({
  op: 'addBuff',
  buttonId: 'button-a',
  buff: { name: 'x', displayName: 'x' },
});
rejected({
  op: 'addBuff',
  buttonId: 'button-a',
  buff: {
    name: 'x',
    displayName: 'x',
    sourceName: 'x',
    effectKind: 'extraHit',
  },
});
rejected({
  op: 'setTargetResistance',
  buttonId: 'button-a',
  targetResistance: { arbitraryResistance: 20 },
});
rejected({
  op: 'setTargetResistance',
  buttonId: 'button-a',
  targetResistance: {},
});
assert.deepEqual(parseAgentWorkbenchCommand({
  op: 'setTargetResistance',
  buttonId: 'button-a',
  targetResistance: {
    physicalResistance: -20,
    fireResistance: 35,
    electricResistance: 10,
    iceResistance: 0,
    natureResistance: 42,
  },
}), {
  op: 'setTargetResistance',
  buttonId: 'button-a',
  targetResistance: {
    physicalResistance: -20,
    fireResistance: 35,
    electricResistance: 10,
    iceResistance: 0,
    natureResistance: 42,
  },
});

console.log('Agent Workbench command schema contract passed');
