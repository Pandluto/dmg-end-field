import assert from 'node:assert/strict';
import {
  asDatabaseGeneration,
  asDefSessionId,
  asDefTurnId,
  asTimelineId,
  asToolCallId,
  asWorkspaceId,
  canonicalJson,
  DefToolExecutionError,
  type DefHarnessRevisionDefinition,
  type DefToolExecutionContext,
  type JsonObject,
  type ProductBinding,
  type ProductSnapshotEnvelope,
} from '../contracts/index.ts';
import { PHASE3_READONLY_PARITY_CASES } from '../testing/fixtures/phase3-readonly-parity.ts';
import { DefReadToolRegistry } from '../tools/read-only-workbench.ts';
import {
  DEF_HARNESS_ROUTE_TOOL_NAME,
  PHASE3_READONLY_HARNESS_CATALOG,
} from './catalog.ts';
import { DefHarnessError, DefHarnessManager } from './manager.ts';

function binding(): ProductBinding {
  return {
    workspaceId: asWorkspaceId('workspace-phase3'),
    databaseGeneration: asDatabaseGeneration('generation-phase3'),
    timelineId: asTimelineId('timeline-phase3'),
    checkoutTargetId: 'node-phase3',
    checkoutUpdatedAt: 30,
    contentRevision: 30,
    snapshotDigest: 'sha256:phase3-snapshot',
  };
}

function snapshot(payloadOverrides: Partial<JsonObject> = {}): ProductSnapshotEnvelope {
  return {
    protocolVersion: 1,
    binding: binding(),
    capturedAt: '2026-08-07T12:00:00.000Z',
    payload: {
      schemaVersion: 1,
      updatedAt: 30,
      source: 'app',
      timelineId: 'timeline-phase3',
      activeTimelineId: 'timeline-phase3',
      currentView: 'canvas',
      damageReportStatus: 'ready',
      checkout: { targetType: 'work-node', targetId: 'node-phase3', updatedAt: 30 },
      selectedCharacters: [
        { id: 'char-a', name: '测试甲', element: '火', profession: '近卫', librarySource: 'local' },
        { id: 'char-b', name: '测试乙', element: '冰', profession: '辅助', librarySource: 'local' },
      ],
      skillButtons: [
        {
          id: 'button-b',
          characterId: 'char-b',
          characterName: '测试乙',
          skillType: 'E',
          runtimeSkillId: 'skill-b-e',
          skillDisplayName: '测试乙技能',
          staffIndex: 1,
          lineIndex: 0,
          persistenceStaffIndex: 1,
          persistenceNodeIndex: 0,
          selectedBuffIds: [],
          selectedBuffs: [],
        },
        {
          id: 'button-a',
          characterId: 'char-a',
          characterName: '测试甲',
          skillType: 'A',
          runtimeSkillId: 'skill-a-a',
          skillDisplayName: '测试甲技能',
          staffIndex: 0,
          lineIndex: 0,
          persistenceStaffIndex: 0,
          persistenceNodeIndex: 2,
          selectedBuffIds: ['buff-attack'],
          selectedBuffs: [{
            id: 'buff-attack',
            displayName: '攻击提升',
            type: 'attackPercent',
            value: 0.2,
            sourceName: '测试来源',
            source: 'fixture',
          }],
        },
      ],
      operatorConfigs: [{
        characterId: 'char-a',
        characterName: '测试甲',
        weapon: { id: 'weapon-a', name: '测试武器', level: 90, potential: '满潜', attack: 500 },
        equipment: [{
          slotKey: 'armor',
          equipmentId: 'equipment-a',
          name: '测试护甲',
          part: '护甲',
          effects: [{
            effectId: 'buff-attack',
            label: '攻击提升',
            typeKey: 'attackPercent',
            level: 3,
            value: 0.2,
          }],
        }],
        setBuffs: [{
          gearSetId: 'set-a',
          gearSetName: '测试套装',
          effectId: 'buff-set',
          label: '套装增伤',
          typeKey: 'allDmgBonus',
          value: 0.1,
        }],
        operatorSkillLevels: { A: 'M3', E: 'L9' },
      }],
      damageReport: {
        generatedAt: 30,
        totalExpected: 1234.5,
        totalNonCrit: 1000,
        buttonCount: 1,
        buttons: [{ id: 'button-a', characterId: 'char-a', expected: 1234.5, nonCrit: 1000 }],
      },
      ...payloadOverrides,
    },
  };
}

async function expectHarnessError(action: () => unknown, code: string): Promise<void> {
  await assert.rejects(
    async () => action(),
    (error: unknown) => error instanceof DefHarnessError && error.code === code,
  );
}

async function expectToolError(action: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(
    action,
    (error: unknown) => error instanceof DefToolExecutionError && error.code === code,
  );
}

function expectCatalogInvalid(catalog: readonly DefHarnessRevisionDefinition[]): void {
  assert.throws(
    () => new DefHarnessManager({
      catalog,
      resolveToolDescriptor: (name) => registry.resolveDescriptor(name),
    }),
    (error: unknown) => error instanceof DefHarnessError && error.code === 'HARNESS_CATALOG_INVALID',
  );
}

const registry = new DefReadToolRegistry();
const manager = new DefHarnessManager({
  resolveToolDescriptor: (name) => registry.resolveDescriptor(name),
});
const managerAgain = new DefHarnessManager({
  resolveToolDescriptor: (name) => registry.resolveDescriptor(name),
});

assert.equal(registry.listDescriptors().length, 5);
assert.deepEqual(manager.listRevisions(), managerAgain.listRevisions());
assert.equal(manager.catalogRevision, managerAgain.catalogRevision);
assert.equal(manager.listRevisions().every((revision) => revision.contentHash.startsWith('sha256:')), true);
{
  const revision = manager.listRevisions()[0]! as { revision: string };
  revision.revision = 'tampered';
  assert.notEqual(manager.listRevisions()[0]!.revision, 'tampered');
  const descriptor = registry.resolveDescriptor('def.node.crud.context')!;
  descriptor.inputSchema.additionalProperties = true;
  assert.equal(registry.resolveDescriptor('def.node.crud.context')!.inputSchema.additionalProperties, false);
}

{
  const unknownToolCatalog = structuredClone(PHASE3_READONLY_HARNESS_CATALOG) as unknown as Array<{
    operations: Array<{ phases: Array<{ tools: string[] }> }>;
  }>;
  unknownToolCatalog[0]!.operations[0]!.phases[0]!.tools = ['def.unknown.read'];
  expectCatalogInvalid(unknownToolCatalog as unknown as readonly DefHarnessRevisionDefinition[]);

  const cyclicCatalog = structuredClone(PHASE3_READONLY_HARNESS_CATALOG) as unknown as Array<{
    operations: Array<{ phases: Array<{ id: string; onSuccess?: string }> }>;
  }>;
  const cyclicEntry = cyclicCatalog[0]!.operations[0]!.phases[0]!;
  cyclicEntry.onSuccess = cyclicEntry.id;
  expectCatalogInvalid(cyclicCatalog as unknown as readonly DefHarnessRevisionDefinition[]);

  const writingCatalog = structuredClone(PHASE3_READONLY_HARNESS_CATALOG) as unknown as Array<{
    writeScope: string[];
  }>;
  writingCatalog[0]!.writeScope = ['selection'];
  expectCatalogInvalid(writingCatalog as unknown as readonly DefHarnessRevisionDefinition[]);
}

for (const [index, parity] of PHASE3_READONLY_PARITY_CASES.entries()) {
  const started = manager.beginTurn({
    defSessionId: asDefSessionId(`session-parity-${index}`),
    defTurnId: asDefTurnId(`turn-parity-${index}`),
  });
  assert.deepEqual(started.transaction.projection.tools.map((tool) => tool.name), [DEF_HARNESS_ROUTE_TOOL_NAME]);
  const routed = manager.route(started.transaction.transactionId, {
    businessId: parity.businessId,
    operation: parity.operation,
  });
  assert.equal(routed.transaction.revision?.sourceLineage, parity.sourceLineage);
  const observed: string[] = [];
  let current = routed.transaction;
  for (const toolName of parity.toolSequence) {
    assert.deepEqual(current.projection.tools.map((tool) => tool.name), [toolName]);
    observed.push(toolName);
    current = manager.completeTool(current.transactionId, {
      toolName,
      status: 'succeeded',
    }).transaction;
  }
  assert.deepEqual(observed, parity.toolSequence);
  assert.equal(current.status, 'completed');
  assert.equal(current.terminalState, 'completed');
  assert.deepEqual(current.projection.tools, []);
  await expectHarnessError(
    () => manager.completeTool(current.transactionId, {
      toolName: parity.toolSequence.at(-1)!,
      status: 'succeeded',
    }),
    'HARNESS_TRANSACTION_TERMINAL',
  );
}

{
  const started = manager.beginTurn({
    defSessionId: asDefSessionId('session-unsupported'),
    defTurnId: asDefTurnId('turn-unsupported'),
  });
  await expectHarnessError(() => manager.route(started.transaction.transactionId, {
    businessId: 'selection',
    operation: 'calculate',
  }), 'HARNESS_ROUTE_UNSUPPORTED');
  const aborted = manager.abort(started.transaction.transactionId, 'HARNESS_ROUTE_UNSUPPORTED');
  assert.equal(aborted.transaction.status, 'aborted');
  assert.deepEqual(aborted.transaction.projection.tools, []);
}

{
  const started = manager.beginTurn({
    defSessionId: asDefSessionId('session-projection'),
    defTurnId: asDefTurnId('turn-projection'),
  });
  const routed = manager.route(started.transaction.transactionId, {
    businessId: 'timeline',
    operation: 'current',
  });
  await expectHarnessError(
    () => manager.route(routed.transaction.transactionId, {
      businessId: 'selection',
      operation: 'inspect',
    }),
    'HARNESS_ROUTE_INVALID',
  );
  await expectHarnessError(
    () => manager.assertToolProjected(routed.transaction.transactionId, 'def.node.crud.use'),
    'HARNESS_TOOL_NOT_PROJECTED',
  );
}

{
  const started = manager.beginTurn({
    defSessionId: asDefSessionId('session-prepare-commit'),
    defTurnId: asDefTurnId('turn-prepare-commit'),
  });
  const preparedRoute = manager.prepareRoute(started.transaction.transactionId, {
    businessId: 'selection',
    operation: 'inspect',
  });
  assert.equal(manager.getTransaction(started.transaction.transactionId).status, 'routing');
  assert.equal(preparedRoute.transition.transaction.status, 'active');
  const routed = manager.commitPrepared(preparedRoute).transaction;
  const preparedCompletion = manager.prepareToolCompletion(routed.transactionId, {
    toolName: 'def.node.crud.context',
    status: 'succeeded',
  });
  assert.equal(manager.getTransaction(routed.transactionId).status, 'active');
  assert.equal(preparedCompletion.transition.transaction.status, 'completed');

  const aborted = manager.abort(routed.transactionId, 'ENGINE_ATOMIC_SUBMISSION_FAILED');
  assert.equal(aborted.transaction.status, 'aborted');
  await expectHarnessError(
    () => manager.commitPrepared(preparedCompletion),
    'HARNESS_TRANSITION_CONFLICT',
  );
}

let snapshotReads = 0;
const abortController = new AbortController();
const executionContext: DefToolExecutionContext = {
  defSessionId: asDefSessionId('session-tools'),
  defTurnId: asDefTurnId('turn-tools'),
  toolCallId: asToolCallId('tool-tools'),
  binding: binding(),
  product: {
    async getSnapshot(expected) {
      assert.equal(canonicalJson(expected as unknown as JsonObject), canonicalJson(binding() as unknown as JsonObject));
      snapshotReads += 1;
      return snapshot();
    },
  },
  abortSignal: abortController.signal,
};

const contextResult = await registry.execute('def.node.crud.context', {}, executionContext) as JsonObject;
assert.equal((contextResult.counts as JsonObject).selectedCharacters, 2);
assert.equal(contextResult.damageReportAvailable, true);

const loadoutResult = await registry.execute(
  'def.data.resource.team_loadouts',
  {},
  executionContext,
) as JsonObject;
assert.equal(loadoutResult.complete, false);
assert.deepEqual(loadoutResult.missingCharacterIds, ['char-b']);

const immutableSnapshot = snapshot();
const immutableConfig = (immutableSnapshot.payload.operatorConfigs as JsonObject[])[0]!;
(immutableConfig.equipment as JsonObject[]).unshift({
  slotKey: 'zeta',
  equipmentId: 'equipment-z',
  name: '末位装备',
  part: '护甲',
  effects: [],
});
(immutableConfig.setBuffs as JsonObject[]).unshift({
  gearSetId: 'zeta-set',
  gearSetName: '末位套装',
  effectId: 'zeta-effect',
  label: '末位效果',
  typeKey: 'allDmgBonus',
  value: 0.01,
});
const immutablePayloadBefore = canonicalJson(immutableSnapshot.payload);
await registry.execute('def.data.resource.team_loadouts', {}, {
  ...executionContext,
  product: { async getSnapshot() { return immutableSnapshot; } },
});
assert.equal(canonicalJson(immutableSnapshot.payload), immutablePayloadBefore);

const timelineResult = await registry.execute('def.node.crud.current', {}, executionContext) as JsonObject;
assert.deepEqual(
  (timelineResult.buttons as JsonObject[]).map((button) => button.id),
  ['button-a', 'button-b'],
);

const buffResult = await registry.execute(
  'def.data.resource.buff',
  { query: '攻击' },
  executionContext,
) as JsonObject;
assert.equal(buffResult.candidateCount, 1);
assert.deepEqual((buffResult.candidates as JsonObject[])[0]?.sourceKinds, ['button', 'equipment']);

const damageResult = await registry.execute('def.data.resource.damage', {}, executionContext) as JsonObject;
assert.equal(damageResult.formulaVersion, 'damage-report-v1');
assert.equal((damageResult.report as JsonObject).totalExpected, 1234.5);
assert.equal(snapshotReads, 5);

await expectToolError(
  () => registry.execute('def.data.resource.buff', { unknown: true }, executionContext),
  'DEF_TOOL_INPUT_INVALID',
);
await expectToolError(
  () => registry.execute('def.node.crud.context', {}, {
    ...executionContext,
    product: { async getSnapshot() { return snapshot({ selectedCharacters: null }); } },
  }),
  'DEF_TOOL_PRODUCT_SNAPSHOT_INVALID',
);
await expectToolError(
  () => registry.execute('def.node.crud.context', {}, {
    ...executionContext,
    product: {
      async getSnapshot() {
        return { ...snapshot(), binding: { ...binding(), contentRevision: 31 } };
      },
    },
  }),
  'DEF_TOOL_PRODUCT_SNAPSHOT_INVALID',
);
await expectToolError(
  () => registry.execute('def.data.resource.damage', {}, {
    ...executionContext,
    product: { async getSnapshot() { return snapshot({ damageReport: null }); } },
  }),
  'DEF_DAMAGE_REPORT_UNAVAILABLE',
);
await expectToolError(
  () => registry.execute('def.data.resource.damage', {}, {
    ...executionContext,
    product: {
      async getSnapshot() {
        return snapshot({
          currentView: 'selection',
          damageReportStatus: 'placeholder',
          damageReport: {
            generatedAt: 0,
            totalExpected: 0,
            totalNonCrit: 0,
            buttonCount: 0,
            buttons: [],
          },
        });
      },
    },
  }),
  'DEF_DAMAGE_REPORT_UNAVAILABLE',
);
await expectToolError(
  () => registry.execute('def.data.resource.damage', {}, {
    ...executionContext,
    product: { async getSnapshot() { return snapshot({ damageReport: {} }); } },
  }),
  'DEF_TOOL_PRODUCT_SNAPSHOT_INVALID',
);

abortController.abort();
await expectToolError(
  () => registry.execute('def.node.crud.context', {}, executionContext),
  'DEF_TOOL_ABORTED',
);

console.log('DEF_AGENT_HARNESS_PHASE3_CONTRACT_OK');
