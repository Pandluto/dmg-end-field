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

assert.deepEqual(parseAgentWorkbenchCommand({
  op: 'queryAgentProductCatalog',
  action: 'query',
  domain: 'operators',
  query: '洛茜',
  limit: 8,
}), {
  op: 'queryAgentProductCatalog',
  action: 'query',
  domain: 'operators',
  query: '洛茜',
  limit: 8,
});
assert.deepEqual(parseAgentWorkbenchCommand({
  op: 'queryAgentProductCatalog',
  action: 'compatibleWeapons',
  operatorQuery: '洛茜',
  weaponQuery: '单手剑',
  limit: 4,
}), {
  op: 'queryAgentProductCatalog',
  action: 'compatibleWeapons',
  operatorQuery: '洛茜',
  weaponQuery: '单手剑',
  limit: 4,
});
assert.deepEqual(parseAgentWorkbenchCommand({
  op: 'queryAgentProductCatalog',
  action: 'gearTopologyFacts',
  setQuery: '测试套装',
  allowDuplicateCompatibleAccessories: true,
}), {
  op: 'queryAgentProductCatalog',
  action: 'gearTopologyFacts',
  setQuery: '测试套装',
  allowDuplicateCompatibleAccessories: true,
});
assert.deepEqual(parseAgentWorkbenchCommand({
  op: 'queryAgentProductCatalog',
  action: 'gearTopologyPlan',
  setQuery: '测试套装',
  limit: 16,
}), {
  op: 'queryAgentProductCatalog',
  action: 'gearTopologyPlan',
  setQuery: '测试套装',
  limit: 16,
});
assert.deepEqual(parseAgentWorkbenchCommand({
  op: 'queryAgentProductCatalog',
  action: 'discoverGearTopologies',
  limit: 32,
  combinationsPerSet: 8,
  allowDuplicateCompatibleAccessories: true,
}), {
  op: 'queryAgentProductCatalog',
  action: 'discoverGearTopologies',
  limit: 32,
  combinationsPerSet: 8,
  allowDuplicateCompatibleAccessories: true,
});
assert.deepEqual(parseAgentWorkbenchCommand({
  op: 'queryAgentProductCatalog',
  action: 'skillFact',
  operatorQuery: '洛茜',
  skillQuery: '沸腾狼血',
  hitQuery: '第一段',
}), {
  op: 'queryAgentProductCatalog',
  action: 'skillFact',
  operatorQuery: '洛茜',
  skillQuery: '沸腾狼血',
  hitQuery: '第一段',
});
assert.deepEqual(parseAgentWorkbenchCommand({
  op: 'queryAgentProductCatalog',
  action: 'buildGuide',
  operatorQuery: '洛茜',
}), {
  op: 'queryAgentProductCatalog',
  action: 'buildGuide',
  operatorQuery: '洛茜',
});
rejected({
  op: 'queryAgentProductCatalog',
  action: 'query',
  domain: 'operators',
  approval: { mode: 'manual' },
});
rejected({
  op: 'queryAgentProductCatalog',
  action: 'compatibleWeapons',
  operatorQuery: '洛茜',
  limit: 0,
});
rejected({
  op: 'queryAgentProductCatalog',
  action: 'buildGuide',
  operatorQuery: '洛茜',
  limit: 4,
});
rejected({
  op: 'queryAgentProductCatalog',
  action: 'discoverGearTopologies',
  combinationsPerSet: 0,
});
rejected({
  op: 'queryAgentProductCatalog',
  action: 'skillFact',
  operatorQuery: '洛茜',
});

const proposal = parseAgentWorkbenchCommand({
  op: 'prepareOperatorConfigProposal',
  request: {
    op: 'setOperatorConfig',
    characterId: 'operator-test',
    weaponName: '测试武器',
    weaponLevel: 90,
    weaponSkillLevels: { skill1: 5, skill2: 5, skill3: 5 },
    operatorSkillLevels: { A: 'M3', B: 'L9' },
    equipments: [{ slotKey: 'armor', equipmentId: 'equipment-test', entryLevel: 3 }],
  },
  label: '测试配装提案',
  description: '在隔离 Work Node 中测试配装。',
});
assert.equal(proposal.op, 'prepareOperatorConfigProposal');
assert.equal(proposal.request.op, 'setOperatorConfig');
assert.equal(proposal.request.equipments?.[0]?.slotKey, 'armor');
rejected({
  op: 'prepareOperatorConfigProposal',
  request: {
    op: 'setOperatorConfig',
    characterId: 'operator-test',
    hiddenMutation: true,
  },
  label: 'bad',
  description: 'bad',
});
rejected({
  op: 'setOperatorConfig',
  characterId: 'operator-test',
  weaponName: '不允许直接写入',
});

const proposalFinalConfig = {
  characterId: 'operator-test',
  characterName: '测试干员',
  weapon: {
    id: 'weapon-test',
    name: '测试武器',
    level: 90,
    potential: '0潜',
    skillLevels: { skill1: 5, skill2: 5, skill3: 5 },
  },
  equipment: [],
  operatorSkillLevels: { A: 'M3', B: 'L9', E: 'L9', Q: 'L9', Dot: 'L9' },
};
const applyProposal = parseAgentWorkbenchCommand({
  op: 'applyPreparedOperatorConfigProposal',
  parentNodeId: 'node-parent',
  parentRevision: 10,
  nodeId: 'node-candidate',
  nodeRevision: 11,
  proposalDigest: `sha256:${'a'.repeat(64)}`,
  finalConfig: proposalFinalConfig,
  approval: { mode: 'manual', approvedBy: 'user', rationale: '测试批准' },
});
assert.equal(applyProposal.op, 'applyPreparedOperatorConfigProposal');
assert.equal(applyProposal.approval.approvedBy, 'user');
rejected({
  op: 'applyPreparedOperatorConfigProposal',
  parentNodeId: 'node-parent',
  parentRevision: 10,
  nodeId: 'node-candidate',
  nodeRevision: 11,
  proposalDigest: 'not-a-digest',
  finalConfig: proposalFinalConfig,
  approval: { mode: 'manual', approvedBy: 'user' },
});

assert.deepEqual(parseAgentWorkbenchCommand({
  op: 'listAiTimelineWorkNodes',
  timelineId: 'timeline-test',
}), { op: 'listAiTimelineWorkNodes', timelineId: 'timeline-test' });
assert.deepEqual(parseAgentWorkbenchCommand({
  op: 'readAiTimelineWorkNode',
  nodeId: 'node-test',
  includePayload: false,
}), { op: 'readAiTimelineWorkNode', nodeId: 'node-test', includePayload: false });
assert.deepEqual(parseAgentWorkbenchCommand({
  op: 'diffAiTimelineWorkNode',
  nodeId: 'node-test',
}), { op: 'diffAiTimelineWorkNode', nodeId: 'node-test' });
assert.deepEqual(parseAgentWorkbenchCommand({
  op: 'validateAiTimelineWorkNode',
  nodeId: 'node-test',
}), { op: 'validateAiTimelineWorkNode', nodeId: 'node-test', repairStatus: false });
rejected({ op: 'validateAiTimelineWorkNode', nodeId: 'node-test', repairStatus: true });
assert.deepEqual(parseAgentWorkbenchCommand({
  op: 'deleteAiTimelineWorkNode',
  nodeId: 'node-test',
}), { op: 'deleteAiTimelineWorkNode', nodeId: 'node-test' });
assert.equal(parseAgentWorkbenchCommand({
  op: 'checkoutAiTimelineWorkNode',
  nodeId: 'node-test',
  reload: false,
  approval: { mode: 'manual', approvedBy: 'user' },
}).op, 'checkoutAiTimelineWorkNode');
assert.equal(parseAgentWorkbenchCommand({
  op: 'restoreAiTimelineWorkNodeBase',
  nodeId: 'node-test',
  reload: false,
  approval: { mode: 'manual', approvedBy: 'user' },
}).op, 'restoreAiTimelineWorkNodeBase');
rejected({
  op: 'checkoutAiTimelineWorkNode',
  nodeId: 'node-test',
  reload: true,
  approval: { mode: 'manual', approvedBy: 'user' },
});
rejected({
  op: 'restoreAiTimelineWorkNodeBase',
  nodeId: 'node-test',
  reload: false,
  approval: { mode: 'manual', approvedBy: 'ai' },
});

console.log('Agent Workbench command schema contract passed');
