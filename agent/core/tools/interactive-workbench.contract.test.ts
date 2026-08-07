import assert from 'node:assert/strict';
import {
  asDatabaseGeneration,
  asDefSessionId,
  asDefTurnId,
  asTimelineId,
  asToolCallId,
  asWorkspaceId,
  type DefInteractiveToolPlan,
  type DefToolExecutionContext,
  type JsonValue,
  type ProductBinding,
  type ProductSnapshotEnvelope,
} from '../contracts/index.ts';
import { DefProductToolRegistry } from './interactive-workbench.ts';

const binding: ProductBinding = {
  workspaceId: asWorkspaceId('workspace-interactive-tools'),
  databaseGeneration: asDatabaseGeneration('generation-interactive-tools'),
  timelineId: asTimelineId('timeline-interactive-tools'),
  checkoutTargetId: 'node-interactive-tools',
  checkoutUpdatedAt: 10,
  contentRevision: 10,
  snapshotDigest: 'sha256:interactive-tools',
};

const snapshot: ProductSnapshotEnvelope = {
  protocolVersion: 1,
  binding,
  capturedAt: '2026-08-08T00:00:00.000Z',
  payload: {
    schemaVersion: 1,
    selectedCharacters: [{ id: 'operator-test', name: '测试干员' }],
    skillButtons: [{
      id: 'button-test',
      characterId: 'operator-test',
      characterName: '测试干员',
      skillType: 'A',
      staffIndex: 0,
      lineIndex: 0,
      persistenceStaffIndex: 0,
      persistenceNodeIndex: 0,
      selectedBuffIds: ['buff-stack', 'buff-passive'],
      selectedBuffs: [
        { id: 'buff-stack', name: 'stack', displayName: '叠层 Buff' },
        { id: 'buff-passive', name: 'passive', displayName: '常驻 Buff' },
      ],
    }],
  },
};

const context: DefToolExecutionContext = {
  defSessionId: asDefSessionId('session-interactive-tools'),
  defTurnId: asDefTurnId('turn-interactive-tools'),
  toolCallId: asToolCallId('tool-interactive-tools'),
  binding,
  product: {
    async getSnapshot(expected) {
      assert.deepEqual(expected, binding);
      return structuredClone(snapshot);
    },
  },
  abortSignal: new AbortController().signal,
};

const registry = new DefProductToolRegistry();

async function prepareAny(name: string, input: JsonValue) {
  return registry.prepareInteractive(name, input, context);
}

async function prepare(name: string, input: JsonValue) {
  const plan = await prepareAny(name, input);
  assert.equal(plan.kind, 'mutation', `${name} must be an approved mutation`);
  return plan as Extract<DefInteractiveToolPlan, { kind: 'mutation' }>;
}

async function preparePrepared(name: string, input: JsonValue) {
  const plan = await prepareAny(name, input);
  assert.equal(plan.kind, 'prepared-mutation', `${name} must use Host-prepared candidate approval`);
  return plan as Extract<DefInteractiveToolPlan, { kind: 'prepared-mutation' }>;
}

function assertPreparedPlan(
  plan: Extract<DefInteractiveToolPlan, { kind: 'prepared-mutation' }>,
  expectedPatch: readonly unknown[],
  expectedScope: readonly string[],
  expectedOperation: string,
  expectedIntent: 'timeline' | 'buff',
): void {
  assert.deepEqual(plan.scope, expectedScope);
  assert.equal(plan.prepareCommand.op, 'prepareReviewedWorkNodeProposal');
  assert.equal(plan.prepareCommand.operation, expectedOperation);
  assert.equal(plan.prepareCommand.intent, expectedIntent);
  assert.deepEqual(plan.prepareCommand.scope, expectedScope);
  assert.deepEqual(plan.prepareCommand.patch, expectedPatch);
  assert.equal(plan.applyOperation, 'applyReviewedWorkNodeProposal');
  assert.equal(plan.cleanupOperation, 'abandonPreparedWorkNodeProposal');
  assert.equal(Object.prototype.hasOwnProperty.call(plan, 'candidate'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(plan, 'proposal'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(plan, 'command'), false);
}

assertPreparedPlan(
  await preparePrepared('def.workbench.add_skill_button', {
    buttonId: 'button-new',
    characterId: 'operator-test',
    characterName: '测试干员',
    skillType: 'E',
    staffIndex: 0,
    nodeIndex: 1,
  }),
  [{
    op: 'addButton',
    buttonId: 'button-new',
    characterId: 'operator-test',
    characterName: '测试干员',
    skillType: 'E',
    staffIndex: 0,
    nodeIndex: 1,
  }],
  ['timeline.structure'],
  'timeline.add',
  'timeline',
);

assertPreparedPlan(
  await preparePrepared('def.workbench.remove_skill_button', { buttonId: 'button-test' }),
  [{ op: 'removeButton', target: { buttonId: 'button-test' } }],
  ['timeline.structure'],
  'timeline.remove',
  'timeline',
);

const buff = {
  schemaVersion: 2,
  id: 'buff-new',
  name: 'buff-new',
  displayName: '新 Buff',
  sourceName: '测试来源',
  category: 'countable',
  maxStacks: 3,
  type: 'attackPercent',
  value: 0.2,
};
assertPreparedPlan(
  await preparePrepared('def.buff.add_to_button', { buttonId: 'button-test', buff }),
  [{ op: 'attachBuff', target: { buttonId: 'button-test' }, buffId: 'buff-new', buff }],
  ['buff.attachments'],
  'buff.add',
  'buff',
);

assertPreparedPlan(
  await preparePrepared('def.buff.remove_from_button', {
    buttonId: 'button-test',
    displayName: '叠层 Buff',
    count: 1,
  }),
  [{ op: 'removeBuff', target: { buttonId: 'button-test' }, buffId: 'buff-stack', count: 1 }],
  ['buff.attachments'],
  'buff.remove',
  'buff',
);

assertPreparedPlan(
  await preparePrepared('def.buff.remove_from_button', { buttonId: 'button-test', all: true }),
  [
    { op: 'removeBuff', target: { buttonId: 'button-test' }, buffId: 'buff-stack' },
    { op: 'removeBuff', target: { buttonId: 'button-test' }, buffId: 'buff-passive' },
  ],
  ['buff.attachments'],
  'buff.remove',
  'buff',
);

assertPreparedPlan(
  await preparePrepared('def.target.set_resistance', {
    buttonId: 'button-test',
    targetResistance: { physicalResistance: 20, fireResistance: -10 },
  }),
  [{
    op: 'setTargetResistance',
    target: { buttonId: 'button-test' },
    targetResistance: { physicalResistance: 20, fireResistance: -10 },
  }],
  ['buff.resistance'],
  'buff.resistance',
  'buff',
);

assertPreparedPlan(
  await preparePrepared('def.worknode.patch_and_validate', {
    patch: [
      {
        op: 'copyButton',
        target: { buttonId: 'button-test' },
        buttonId: 'button-copy',
        nodeIndex: 2,
      },
      {
        op: 'replaceButton',
        target: { buttonId: 'button-copy' },
        skillType: 'E',
        runtimeSkillId: 'operator-test-skill-e',
      },
    ],
    label: '复制并替换技能',
  }),
  [
    {
      op: 'copyButton',
      target: { buttonId: 'button-test' },
      buttonId: 'button-copy',
      nodeIndex: 2,
    },
    {
      op: 'replaceButton',
      target: { buttonId: 'button-copy' },
      skillType: 'E',
      runtimeSkillId: 'operator-test-skill-e',
    },
  ],
  ['timeline.structure'],
  'timeline.patch',
  'timeline',
);

assertPreparedPlan(
  await preparePrepared('def.worknode.patch_and_validate', {
    patch: [
      {
        op: 'setBuffStack',
        target: { buttonId: 'button-test' },
        buffId: 'buff-stack',
        stackCount: 2,
        segmentKey: 'phase-1',
      },
      {
        op: 'replaceBuff',
        target: { buttonId: 'button-test' },
        buffId: 'buff-stack',
        replacementBuffId: 'buff-passive',
        preserveStack: true,
        preserveDisabled: false,
      },
    ],
  }),
  [
    {
      op: 'setBuffStack',
      target: { buttonId: 'button-test' },
      buffId: 'buff-stack',
      stackCount: 2,
      segmentKey: 'phase-1',
    },
    {
      op: 'replaceBuff',
      target: { buttonId: 'button-test' },
      buffId: 'buff-stack',
      replacementBuffId: 'buff-passive',
      preserveStack: true,
      preserveDisabled: false,
    },
  ],
  ['buff.attachments'],
  'timeline.patch',
  'buff',
);

const replacementBuff = {
  name: 'buff-replacement',
  displayName: '替换 Buff',
  sourceName: '测试来源',
  category: 'countable',
  maxStacks: 4,
};
assertPreparedPlan(
  await preparePrepared('def.worknode.patch_and_validate', {
    patch: [{
      op: 'replaceBuff',
      target: { buttonId: 'button-test' },
      buffId: 'buff-stack',
      buff: replacementBuff,
      stackCount: 1,
    }],
  }),
  [{
    op: 'replaceBuff',
    target: { buttonId: 'button-test' },
    buffId: 'buff-stack',
    buff: replacementBuff,
    stackCount: 1,
  }],
  ['buff.attachments'],
  'timeline.patch',
  'buff',
);

await assert.rejects(
  () => prepareAny('def.worknode.patch_and_validate', {
    patch: [{
      op: 'setBuffStack',
      target: { buttonId: 'button-test' },
      buffId: 'buff-stack',
      stackCount: 0,
    }],
  }),
  /stackCount must be an integer between 1 and 10000/u,
);
await assert.rejects(
  () => prepareAny('def.worknode.patch_and_validate', {
    patch: [{
      op: 'setBuffStack',
      target: { buttonId: 'button-test' },
      buffId: 'buff-stack',
      stackCount: 1,
      segmentKey: 'x'.repeat(201),
    }],
  }),
  /segmentKey must be a non-empty string of at most 200 characters/u,
);
await assert.rejects(
  () => prepareAny('def.worknode.patch_and_validate', {
    patch: [{
      op: 'setBuffStack',
      target: { buttonId: 'button-test' },
      buffId: 'buff-stack',
      stackCount: 1,
      unexpected: true,
    }],
  }),
  /unexpected fields: unexpected/u,
);
await assert.rejects(
  () => prepareAny('def.worknode.patch_and_validate', {
    patch: [{
      op: 'replaceBuff',
      target: { buttonId: 'button-test' },
      buffId: 'buff-stack',
      replacementBuffId: 'buff-passive',
      buff: replacementBuff,
    }],
  }),
  /requires exactly one of replacementBuffId or buff/u,
);
await assert.rejects(
  () => prepareAny('def.worknode.patch_and_validate', {
    patch: [{
      op: 'replaceBuff',
      target: { buttonId: 'button-test' },
      buffId: 'buff-stack',
      hidden: true,
    }],
  }),
  /unexpected fields: hidden/u,
);

await assert.rejects(
  () => prepareAny('def.worknode.patch_and_validate', {
    patch: [{ op: 'copyButton', target: {}, nodeIndex: 2 }],
  }),
  /requires buttonId, characterId, or characterName/u,
);
await assert.rejects(
  () => prepareAny('def.worknode.patch_and_validate', {
    patch: [{ op: 'replaceButton', target: { buttonId: 'button-test' }, hidden: true }],
  }),
  /unexpected fields: hidden/u,
);

assert.deepEqual(
  await prepareAny('def.data.catalog.query', {
    action: 'compatibleWeapons',
    operatorQuery: '测试干员',
    limit: 8,
  }),
  {
    kind: 'command',
    command: {
      op: 'queryAgentProductCatalog',
      action: 'compatibleWeapons',
      operatorQuery: '测试干员',
      limit: 8,
    },
  },
);

assert.deepEqual(
  await prepareAny('def.data.catalog.query', {
    action: 'discoverGearTopologies',
    limit: 12,
    combinationsPerSet: 4,
  }),
  {
    kind: 'command',
    command: {
      op: 'queryAgentProductCatalog',
      action: 'discoverGearTopologies',
      limit: 12,
      combinationsPerSet: 4,
    },
  },
);

assert.deepEqual(
  await prepareAny('def.data.catalog.query', {
    action: 'skillFact',
    operatorQuery: '测试干员',
    skillQuery: 'A',
    hitQuery: '主伤害',
  }),
  {
    kind: 'command',
    command: {
      op: 'queryAgentProductCatalog',
      action: 'skillFact',
      operatorQuery: '测试干员',
      skillQuery: 'A',
      hitQuery: '主伤害',
    },
  },
);

await assert.rejects(
  () => prepareAny('def.data.catalog.query', {
    action: 'skillFact',
    operatorQuery: '测试干员',
  }),
  /skillFact requires operatorQuery and skillQuery/u,
);

assert.deepEqual(
  await prepareAny('def.worknode.validate', { nodeId: 'node-review' }),
  {
    kind: 'command',
    command: {
      op: 'validateAiTimelineWorkNode',
      nodeId: 'node-review',
      repairStatus: false,
    },
  },
);

const deletePlan = await prepare('def.worknode.delete', { nodeId: 'node-obsolete' });
assert.deepEqual(deletePlan.scope, ['timeline.work-node']);
assert.deepEqual(deletePlan.command, { op: 'deleteAiTimelineWorkNode', nodeId: 'node-obsolete' });

const usePlan = await prepare('def.worknode.use', { nodeId: 'node-ready', commitId: 'commit-ready' });
assert.deepEqual(usePlan.scope, ['timeline.work-node', 'timeline.checkout']);
assert.deepEqual(usePlan.command, {
  op: 'checkoutAiTimelineWorkNode',
  nodeId: 'node-ready',
  commitId: 'commit-ready',
  reload: false,
  approval: {
    mode: 'manual',
    approvedBy: 'user',
    rationale: 'Approved in the embedded DEF AI mode.',
  },
});

const previewPlan = await prepareAny('def.worknode.diff', { candidateNodeId: 'node-candidate' });
assert.deepEqual(previewPlan, {
  kind: 'command',
  command: { op: 'diffAiTimelineWorkNode', nodeId: 'node-candidate' },
});
await assert.rejects(
  () => prepareAny('def.worknode.diff', { nodeId: 'node-candidate' }),
  /unexpected fields: nodeId/u,
);

const selectionPlan = await preparePrepared('def.team.selection.apply', {
  characterNames: ['测试干员'],
  nodeTitle: '调整阵容',
  nodeDescription: '仅保留测试干员',
  openCanvas: true,
});
assert.deepEqual(selectionPlan.scope, [
  'selection.roster',
  'timeline.structure',
  'buff.attachments',
  'buff.resistance',
  'loadout.config',
]);
assert.deepEqual(selectionPlan.prepareCommand, {
  op: 'prepareReviewedWorkNodeProposal',
  operation: 'selection.apply',
  intent: 'selection',
  scope: [
    'selection.roster',
    'timeline.structure',
    'buff.attachments',
    'buff.resistance',
    'loadout.config',
  ],
  roster: {
    characterNames: ['测试干员'],
    nodeTitle: '调整阵容',
    nodeDescription: '仅保留测试干员',
    openCanvas: true,
  },
  label: '调整阵容',
  description: '仅保留测试干员',
});
assert.equal(Object.prototype.hasOwnProperty.call(selectionPlan.prepareCommand, 'patch'), false);
assert.equal(selectionPlan.applyOperation, 'applyReviewedWorkNodeProposal');
assert.equal(selectionPlan.cleanupOperation, 'abandonPreparedWorkNodeProposal');

const scopedRestore = await preparePrepared('def.worknode.restore', {
  nodeId: 'node-baseline',
  scope: 'timeline.structure',
});
assert.deepEqual(scopedRestore.scope, [
  'timeline.structure',
  'buff.attachments',
  'buff.resistance',
]);
assert.deepEqual(scopedRestore.prepareCommand, {
  op: 'prepareReviewedWorkNodeProposal',
  operation: 'timeline.restore',
  intent: 'timeline',
  scope: ['timeline.structure', 'buff.attachments', 'buff.resistance'],
  restore: {
    nodeId: 'node-baseline',
    scope: 'timeline.structure',
  },
  label: '恢复 timeline.structure 范围',
  description: '仅恢复 Work Node node-baseline 的 timeline.structure 数据，不覆盖其他范围。',
});
assert.equal(Object.prototype.hasOwnProperty.call(scopedRestore.prepareCommand, 'patch'), false);
const buffRestore = await preparePrepared('def.worknode.restore', {
  nodeId: 'node-buff-baseline',
  scope: 'buff.attachments',
});
assert.deepEqual(buffRestore.scope, ['buff.attachments']);
assert.equal(buffRestore.prepareCommand.operation, 'buff.restore');
assert.equal(buffRestore.prepareCommand.intent, 'buff');
assert.deepEqual(buffRestore.prepareCommand.restore, {
  nodeId: 'node-buff-baseline',
  scope: 'buff.attachments',
});
await assert.rejects(
  () => prepareAny('def.worknode.restore', { nodeId: 'node-baseline' }),
  /unexpected fields|scope must contain|scope must be one of/u,
);
await assert.rejects(
  () => prepareAny('def.worknode.restore', { nodeId: 'node-baseline', scope: ['timeline.structure'] }),
  /schema|scope|invalid/u,
);

const loadoutPreview = await prepareAny('def.loadout.preview', {
  characterId: 'operator-test',
  weaponName: '测试武器',
  weaponLevel: 90,
  weaponSkillLevels: { skill1: 5, skill2: 5, skill3: 5 },
  operatorSkillLevels: { A: 'M3', B: 'L9' },
  equipments: [{ slotKey: 'armor', equipmentId: 'equipment-test' }],
  label: '测试配装',
});
assert.equal(loadoutPreview.kind, 'command');
if (loadoutPreview.kind !== 'command') throw new Error('loadout preview must be a command');
assert.equal(loadoutPreview.command.op, 'prepareOperatorConfigProposal');
assert.equal((loadoutPreview.command.request as { op?: string }).op, 'setOperatorConfig');

const finalConfig = {
  characterId: 'operator-test',
  characterName: '测试干员',
  weapon: { id: 'weapon-test', name: '测试武器', level: 90, potential: '0潜' },
  equipment: [],
  operatorSkillLevels: { A: 'M3', B: 'L9', E: 'L9', Q: 'L9' },
};
const loadoutApply = await prepare('def.loadout.apply_prepared', {
  parentNodeId: 'node-parent',
  parentRevision: 10,
  nodeId: 'node-candidate',
  nodeRevision: 11,
  proposalDigest: 'sha256:0123456789abcdef',
});
assert.deepEqual(loadoutApply.scope, [
  'loadout.config',
  'timeline.work-node',
  'timeline.checkout',
]);
assert.deepEqual(loadoutApply.proposal, { command: loadoutApply.command, scope: loadoutApply.scope });
await assert.rejects(
  () => prepareAny('def.loadout.apply_prepared', {
    parentNodeId: 'node-parent',
    parentRevision: 10,
    nodeId: 'node-candidate',
    nodeRevision: 11,
    proposalDigest: 'sha256:0123456789abcdef',
    finalConfig,
  }),
  /unexpected fields: finalConfig/u,
);

console.log('DEF_INTERACTIVE_WORKBENCH_TOOL_CONTRACT_OK');
