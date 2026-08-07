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
  workspaceId: asWorkspaceId('workspace-damage-read'),
  databaseGeneration: asDatabaseGeneration('generation-damage-read'),
  timelineId: asTimelineId('timeline-damage-read'),
  checkoutTargetId: 'node-damage-read',
  checkoutUpdatedAt: 10,
  contentRevision: 10,
  snapshotDigest: 'sha256:damage-read',
};

function report(expected = 120, nonCrit = 100): JsonObject {
  return {
    generatedAt: 1_700_000_000_000,
    totalDamage: expected,
    totalExpected: expected,
    totalNonCrit: nonCrit,
    buttonCount: 1,
    buttons: [{
      id: 'button-a',
      characterId: 'operator-a',
      groupLabel: '第1组',
      orderLabel: '01',
      characterName: '测试干员',
      skillName: '测试技能',
      skillType: 'A',
      damage: expected,
      expected,
      nonCrit,
      share: 1,
      hits: [{
        id: 'hit-a',
        title: '主伤害',
        sourceKind: 'normal',
        damageSourceLabel: '主伤害',
        skillTypeLabel: 'A',
        elementLabel: '物理',
        damage: expected,
        expected,
        nonCrit,
        resistanceZone: 0.9,
        resistance: {
          baseResistance: 10,
          corrosion: 0,
          resistanceIgnore: 0,
          effectiveResistance: 10,
          resistanceZone: 0.9,
          formulaText: '产品生成的抗性说明',
        },
        buffs: [{
          id: 'buff-a',
          traceId: 'operator-a / buff-a',
          name: '测试增益',
          effect: '产品生成的增益说明',
          type: 'allDmgBonus',
          effectiveValue: 0.2,
        }],
        zones: [{
          key: 'damageBonus',
          additiveTotal: 0.2,
          multiplierProduct: 1,
          finalValue: 1.2,
        }],
      }],
    }],
    characters: [{
      characterId: 'operator-a',
      characterName: '测试干员',
      weaponName: '测试武器',
      weaponPotentialMode: '默认',
      level: 90,
      skillLevels: ['A M3'],
      attributeLines: ['攻击 100'],
      equipmentLines: ['测试装备'],
      skills: [{
        id: 'skill-a',
        title: 'A / 测试技能',
        meta: '等级 M3 Hit 1',
        hitLines: ['hit-a / 主伤害'],
      }],
    }],
  };
}

function snapshot(damageReport: JsonObject | null = report()): ProductSnapshotEnvelope {
  return {
    protocolVersion: 1,
    binding,
    capturedAt: '2026-08-08T00:00:00.000Z',
    payload: {
      schemaVersion: 1,
      currentView: 'canvas',
      damageReportStatus: damageReport ? 'ready' : 'idle',
      damageReport,
      selectedCharacters: [{
        id: 'operator-a',
        name: '测试干员',
        element: 'physical',
        profession: 'guard',
        librarySource: 'test',
      }],
      skillButtons: [{
        id: 'button-a',
        characterId: 'operator-a',
        characterName: '测试干员',
        skillType: 'A',
        staffIndex: 0,
        lineIndex: 0,
        persistenceStaffIndex: 0,
        persistenceNodeIndex: 0,
      }],
      operatorConfigs: [],
    },
  };
}

let currentSnapshot = snapshot();
const context: DefToolExecutionContext = {
  defSessionId: asDefSessionId('session-damage-read'),
  defTurnId: asDefTurnId('turn-damage-read'),
  toolCallId: asToolCallId('tool-damage-read'),
  binding,
  product: {
    async getSnapshot(expected) {
      assert.deepEqual(expected, binding);
      return JSON.parse(JSON.stringify(currentSnapshot)) as ProductSnapshotEnvelope;
    },
  },
  abortSignal: new AbortController().signal,
};

const registry = new DefReadToolRegistry();
const damageDescriptor = registry.resolveDescriptor('def.data.resource.damage');
assert.ok(damageDescriptor);
assert.deepEqual(
  ((damageDescriptor.inputSchema.properties as JsonObject).action as JsonObject).enum,
  ['current', 'aggregate', 'compare', 'attribute', 'diagnose', 'export', 'explain'],
);

const capsule = await registry.execute('def.data.resource.damage', {}, context) as JsonObject;
assert.equal(capsule.contract, 'DefDamageReportV1');
assert.equal((capsule.report as JsonObject).totalExpected, 120);

const current = await registry.execute(
  'def.data.resource.damage',
  { action: 'current' },
  context,
) as JsonObject;
assert.equal(current.contract, 'DefDamageCurrentV1');
assert.equal(current.totalExpected, 120);

const aggregate = await registry.execute(
  'def.data.resource.damage',
  { action: 'aggregate' },
  context,
) as JsonObject;
assert.equal(aggregate.contract, 'DefDamageAggregateV1');
assert.deepEqual(aggregate.total, { damage: 120, expected: 120, nonCrit: 100 });

const attribute = await registry.execute(
  'def.data.resource.damage',
  { action: 'attribute', buttonId: 'button-a', hitId: 'hit-a' },
  context,
) as JsonObject;
assert.equal(attribute.contract, 'DefDamageAttributeV1');
assert.equal(((attribute.facts as JsonObject[])[0]!.resistance as JsonObject).effectiveResistance, 10);

const explanation = await registry.execute(
  'def.data.resource.damage',
  { action: 'explain', hitId: 'hit-a' },
  context,
) as JsonObject;
assert.equal(explanation.contract, 'DefDamageExplanationV1');

const exported = await registry.execute(
  'def.data.resource.damage',
  { action: 'export', format: 'json', maxRows: 1, includeCharacters: false },
  context,
) as JsonObject;
assert.equal(exported.contract, 'DefDamageExportV1');
assert.equal(exported.rowCount, 1);
assert.equal(exported.truncated, true);

const baseline = {
  ...capsule,
  schemeDigest: 'sha256:baseline',
  report: report(100, 80),
};
const comparison = await registry.execute(
  'def.data.resource.damage',
  { action: 'compare', baseline },
  context,
) as JsonObject;
assert.equal(comparison.contract, 'DefDamageCompareV1');
assert.deepEqual((comparison.total as JsonObject).expected, { current: 120, baseline: 100, delta: 20 });

const capability = await registry.execute(
  'def.capability.status',
  { businessId: 'loadout', operation: 'restore' },
  context,
) as JsonObject;
assert.equal(capability.status, 'retired');
assert.equal(capability.mutatesProduct, false);

currentSnapshot = snapshot(null);
const missing = await registry.execute(
  'def.data.resource.damage',
  { action: 'diagnose' },
  context,
) as JsonObject;
assert.equal(missing.status, 'missing');

const malformedReport = report();
malformedReport.totalExpected = 121;
currentSnapshot = snapshot(malformedReport);
const malformed = await registry.execute(
  'def.data.resource.damage',
  { action: 'diagnose' },
  context,
) as JsonObject;
assert.equal(malformed.status, 'malformed');
const malformedContext = await registry.execute(
  'def.node.crud.context',
  {},
  context,
) as JsonObject;
assert.equal(malformedContext.damageReportAvailable, false);

await assert.rejects(
  registry.execute('def.data.resource.damage', { action: 'aggregate' }, context),
  (error: unknown) => error instanceof DefToolExecutionError
    && error.code === 'DEF_TOOL_PRODUCT_SNAPSHOT_INVALID',
);

console.log('DEF_READ_ONLY_DAMAGE_CONTRACT_OK');
