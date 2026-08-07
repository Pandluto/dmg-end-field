import assert from 'node:assert/strict';
import {
  DefToolExecutionError,
  asDatabaseGeneration,
  asDefSessionId,
  asDefTurnId,
  asTimelineId,
  asToolCallId,
  asWorkspaceId,
  type DefToolExecutionContext,
  type JsonObject,
  type ProductBinding,
  type ProductSnapshotEnvelope,
} from '../contracts/index.ts';
import { DefReadToolRegistry } from './read-only-workbench.ts';

const binding: ProductBinding = {
  workspaceId: asWorkspaceId('workspace-loadout-read'),
  databaseGeneration: asDatabaseGeneration('generation-loadout-read'),
  timelineId: asTimelineId('timeline-loadout-read'),
  checkoutTargetId: 'node-loadout-read',
  checkoutUpdatedAt: 7,
  contentRevision: 7,
  snapshotDigest: 'sha256:loadout-read',
};

const slots = ['armor', 'glove', 'accessory1', 'accessory2'];
const productSnapshot: ProductSnapshotEnvelope = {
  protocolVersion: 1,
  binding,
  capturedAt: '2026-08-08T00:00:00.000Z',
  payload: {
    schemaVersion: 1,
    currentView: 'canvas',
    selectedCharacters: [{
      id: 'operator-a',
      name: '测试干员',
      element: 'physical',
      profession: 'guard',
      librarySource: '1.8',
    }],
    skillButtons: [],
    operatorConfigs: [{
      characterId: 'operator-a',
      characterName: '测试干员',
      weapon: {
        id: 'weapon-a',
        name: '测试武器',
        level: 90,
        potential: 'P5',
        skillLevels: { skill1: 9, skill2: 9, skill3: 3 },
        attack: 500,
      },
      equipment: slots.map((slotKey, index) => ({
        slotKey,
        equipmentId: `equipment-${index}`,
        name: `测试装备 ${index}`,
        part: index === 0 ? '护甲' : index === 1 ? '护手' : '配件',
        effects: [{
          effectId: `effect-${index}`,
          label: `效果 ${index}`,
          typeKey: 'attackPercent',
          level: 3,
          value: 0.1,
        }],
      })),
      setBuffs: [{
        gearSetId: 'set-a',
        gearSetName: '测试套装',
        effectId: 'set-effect-a',
        label: '三件套',
        typeKey: 'damagePercent',
        value: 0.12,
      }],
      operatorSkillLevels: { A: 'M3', B: 'L9', E: 'M3', Q: 'L9', Dot: 'L9' },
    }],
  },
};

const context: DefToolExecutionContext = {
  defSessionId: asDefSessionId('session-loadout-read'),
  defTurnId: asDefTurnId('turn-loadout-read'),
  toolCallId: asToolCallId('tool-loadout-read'),
  binding,
  product: {
    async getSnapshot(expected) {
      assert.deepEqual(expected, binding);
      return JSON.parse(JSON.stringify(productSnapshot)) as ProductSnapshotEnvelope;
    },
  },
  abortSignal: new AbortController().signal,
};

const registry = new DefReadToolRegistry();
const capsule = await registry.execute(
  'def.data.resource.team_loadouts',
  {},
  context,
) as JsonObject;
assert.equal(capsule.contract, 'DefTeamLoadoutsV1');
assert.equal(capsule.complete, true);

const current = await registry.execute(
  'def.data.resource.team_loadouts',
  { action: 'current' },
  context,
) as JsonObject;
assert.deepEqual(
  ((current.operators as JsonObject[])[0]!.equipment as JsonObject[]).map((piece) => piece.slotKey),
  slots,
);

const evaluation = await registry.execute(
  'def.data.resource.team_loadouts',
  {
    action: 'evaluate',
    operatorId: 'operator-a',
    directoryCompatibilityEvidence: { source: 'browser-1.8' },
  },
  context,
) as JsonObject;
assert.equal(evaluation.contract, 'DefLoadoutEvaluateFactsV1');
assert.deepEqual(evaluation.completeness, { complete: true, configured: true });
assert.equal(evaluation.subjectiveEvaluation, 'evidenceUnavailable');
assert.deepEqual(evaluation.compatibilityEvidence, { inputPresent: true });

const baseline = JSON.parse(JSON.stringify(current)) as JsonObject;
const baselineOperator = (baseline.operators as JsonObject[])[0]!;
baselineOperator.weapon = {
  ...(baselineOperator.weapon as JsonObject),
  attack: 450,
};
const comparison = await registry.execute(
  'def.data.resource.team_loadouts',
  { action: 'compare', operatorId: 'operator-a', baseline },
  context,
) as JsonObject;
assert.equal(comparison.contract, 'DefLoadoutCompareFactsV1');
assert.equal((comparison.weapon as JsonObject).changed, true);
assert.equal(comparison.subjectiveEvaluation, 'evidenceUnavailable');
assert.equal('winner' in comparison, false);
assert.equal('score' in comparison, false);

await assert.rejects(
  registry.execute(
    'def.data.resource.team_loadouts',
    { action: 'current', operatorId: 'operator-a' },
    context,
  ),
  (error: unknown) => error instanceof DefToolExecutionError
    && error.code === 'DEF_TOOL_INPUT_INVALID',
);

await assert.rejects(
  registry.execute(
    'def.data.resource.team_loadouts',
    { action: 'compare', baseline: { contract: 'DefTeamLoadoutsV1' } },
    context,
  ),
  (error: unknown) => error instanceof DefToolExecutionError
    && error.code === 'DEF_TOOL_INPUT_INVALID',
);

console.log('DEF_READ_ONLY_LOADOUT_CONTRACT_OK');
