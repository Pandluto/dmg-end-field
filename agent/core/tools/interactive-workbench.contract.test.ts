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

async function prepare(name: string, input: JsonValue) {
  const plan = await registry.prepareInteractive(name, input, context);
  assert.equal(plan.kind, 'mutation', `${name} must be an approved mutation`);
  return plan as Extract<DefInteractiveToolPlan, { kind: 'mutation' }>;
}

function assertWorkNodePlan(
  plan: Extract<DefInteractiveToolPlan, { kind: 'mutation' }>,
  expectedPatch: readonly unknown[],
  expectedScope: readonly string[],
): void {
  assert.deepEqual(plan.scope, expectedScope);
  assert.equal(plan.command.op, 'applyApprovedWorkNodePatch');
  assert.deepEqual(plan.command.patch, expectedPatch);
  assert.deepEqual(plan.proposal, { command: plan.command, scope: plan.scope });
}

assertWorkNodePlan(
  await prepare('def.workbench.add_skill_button', {
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
  ['timeline.buttons', 'timeline.work-node', 'timeline.checkout'],
);

assertWorkNodePlan(
  await prepare('def.workbench.remove_skill_button', { buttonId: 'button-test' }),
  [{ op: 'removeButton', target: { buttonId: 'button-test' } }],
  ['timeline.buttons', 'timeline.work-node', 'timeline.checkout'],
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
assertWorkNodePlan(
  await prepare('def.buff.add_to_button', { buttonId: 'button-test', buff }),
  [{ op: 'attachBuff', target: { buttonId: 'button-test' }, buffId: 'buff-new', buff }],
  ['timeline.buffs', 'timeline.work-node', 'timeline.checkout'],
);

assertWorkNodePlan(
  await prepare('def.buff.remove_from_button', {
    buttonId: 'button-test',
    displayName: '叠层 Buff',
    count: 1,
  }),
  [{ op: 'removeBuff', target: { buttonId: 'button-test' }, buffId: 'buff-stack', count: 1 }],
  ['timeline.buffs', 'timeline.work-node', 'timeline.checkout'],
);

assertWorkNodePlan(
  await prepare('def.buff.remove_from_button', { buttonId: 'button-test', all: true }),
  [
    { op: 'removeBuff', target: { buttonId: 'button-test' }, buffId: 'buff-stack' },
    { op: 'removeBuff', target: { buttonId: 'button-test' }, buffId: 'buff-passive' },
  ],
  ['timeline.buffs', 'timeline.work-node', 'timeline.checkout'],
);

assertWorkNodePlan(
  await prepare('def.target.set_resistance', {
    buttonId: 'button-test',
    targetResistance: { physicalResistance: 20, fireResistance: -10 },
  }),
  [{
    op: 'setTargetResistance',
    target: { buttonId: 'button-test' },
    targetResistance: { physicalResistance: 20, fireResistance: -10 },
  }],
  ['timeline.resistance', 'timeline.work-node', 'timeline.checkout'],
);

console.log('DEF_INTERACTIVE_WORKBENCH_TOOL_CONTRACT_OK');
