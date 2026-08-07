import assert from 'node:assert/strict';
import {
  DEF_AGENT_IN_MEMORY_LIMITS,
  DEF_HARNESS_PERSISTENCE_LIMITS,
  asDatabaseGeneration,
  asDefSessionId,
  asDefTurnId,
  asTimelineId,
  asToolCallId,
  asWorkspaceId,
  canonicalJson,
  DefToolExecutionError,
  type DefHarnessPlanTraceEvent,
  type DefHarnessRevisionDefinition,
  type DefToolDescriptor,
  type DefToolExecutionContext,
  type JsonObject,
  type ProductBinding,
  type ProductSnapshotEnvelope,
} from '../contracts/index.ts';
import { PHASE3_READONLY_PARITY_CASES } from '../testing/fixtures/phase3-readonly-parity.ts';
import { DefReadToolRegistry } from '../tools/read-only-workbench.ts';
import {
  DEF_HARNESS_CANONICAL_TOOL_NAMES,
  DEF_HARNESS_ADMIN_EXTENSION_OPERATIONS,
  DEF_HARNESS_FULL_OPERATION_MATRIX,
  DEF_HARNESS_ROUTE_TOOL_NAME,
  PHASE3_READONLY_HARNESS_CATALOG,
  PHASE7_FULL_HARNESS_CATALOG,
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
        totalDamage: 1234.5,
        totalExpected: 1234.5,
        totalNonCrit: 1000,
        buttonCount: 1,
        buttons: [{
          id: 'button-a',
          characterId: 'char-a',
          groupLabel: '第1组',
          orderLabel: '01',
          characterName: '测试甲',
          skillName: '测试甲技能',
          skillType: 'A',
          damage: 1234.5,
          expected: 1234.5,
          nonCrit: 1000,
          share: 1,
          hits: [{
            id: 'button-a-hit-1',
            title: '主伤害',
            sourceKind: 'normal',
            damageSourceLabel: '主伤害',
            skillTypeLabel: 'A',
            elementLabel: '火',
            damage: 1234.5,
            expected: 1234.5,
            nonCrit: 1000,
            resistanceZone: 0.9,
            resistance: {
              baseResistance: 10,
              corrosion: 0,
              resistanceIgnore: 0,
              effectiveResistance: 10,
              resistanceZone: 0.9,
              formulaText: '产品生成的抗性说明',
            },
            buffs: [],
          }],
        }],
        characters: [{
          characterId: 'char-a',
          characterName: '测试甲',
          weaponName: '测试武器',
          weaponPotentialMode: '满潜',
          level: 90,
          skillLevels: ['A M3'],
          attributeLines: ['攻击 500'],
          equipmentLines: ['测试护甲'],
          skills: [{
            id: 'skill-a-a',
            title: 'A / 测试甲技能',
            meta: '等级 M3 Hit 1',
            hitLines: ['button-a-hit-1 / 主伤害'],
          }],
        }],
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

const expectedFullOperationMatrix = {
  selection: ['inspect', 'search', 'add', 'remove', 'replace', 'reorder', 'analyze', 'apply'],
  loadout: ['inspect', 'evaluate', 'resolve', 'recommend', 'recommend_named_set', 'recommend_discovered_set', 'recommend_weapon', 'recommend_equipment', 'compare', 'preview', 'apply', 'restore'],
  timeline: ['current', 'inspect', 'add', 'remove', 'move', 'replace', 'copy', 'validate', 'preview', 'apply', 'restore'],
  buff: ['inspect', 'resolve', 'source', 'add', 'remove', 'replace', 'batch', 'stack', 'coverage', 'apply', 'restore'],
  calculation: ['calculate', 'aggregate', 'compare', 'attribute', 'diagnose', 'export', 'explain', 'skill_fact'],
} as const;

// The full matrix intentionally uses a resolver stub here. The product
// registry is wired in a later phase, but the Harness contract must already
// prove that no operation disappears while that wiring is in progress.
const fullMutationTools = new Set([
  'def.team.selection.apply',
  'def.workbench.add_skill_button',
  'def.workbench.remove_skill_button',
  'def.buff.add_to_button',
  'def.buff.remove_from_button',
  'def.target.set_resistance',
  'def.worknode.patch_and_validate',
  'def.worknode.delete',
  'def.worknode.use',
  'def.worknode.restore',
  'def.loadout.apply_prepared',
  'def.timeline.apply_prepared',
  'def.timeline.reject_preview',
  'def.timeline.revise_preview',
]);
const fullStubResolver = (name: string): DefToolDescriptor | null => {
  if (name === DEF_HARNESS_ROUTE_TOOL_NAME) {
    return {
      name,
      description: 'Harness route contract stub',
      risk: 'read',
      inputSchema: { type: 'object', additionalProperties: false },
    };
  }
  if (!(DEF_HARNESS_CANONICAL_TOOL_NAMES as readonly string[]).includes(name)) return null;
  return {
    name,
    description: `Harness contract stub for ${name}`,
    risk: fullMutationTools.has(name) ? 'mutate' : name === 'def.user.ask' ? 'propose' : 'read',
    inputSchema: { type: 'object', additionalProperties: false },
  };
};

const fullHarnessManager = new DefHarnessManager({
  catalog: PHASE7_FULL_HARNESS_CATALOG,
  resolveToolDescriptor: fullStubResolver,
});

function createFullHarnessManager(): DefHarnessManager {
  return new DefHarnessManager({
    catalog: PHASE7_FULL_HARNESS_CATALOG,
    resolveToolDescriptor: fullStubResolver,
  });
}

function readPlanEvents(
  harness: DefHarnessManager,
  transactionId: string,
): readonly DefHarnessPlanTraceEvent[] {
  return harness.getTrace(transactionId).flatMap((entry) => (
    'planEvents' in entry ? entry.planEvents ?? [] : []
  ));
}

// Persisted Harness snapshots are a strict, executable-free boundary. A new
// Manager must rebuild definitions from its catalog and reject the whole
// batch if any transaction or plan step is stale.
{
  const source = createFullHarnessManager();
  const started = source.beginTurn({
    defSessionId: asDefSessionId('session-persisted-harness'),
    defTurnId: asDefTurnId('turn-persisted-harness'),
  });
  const routed = source.route(started.transaction.transactionId, {
    steps: [
      { businessId: 'selection', operation: 'inspect' },
      { businessId: 'timeline', operation: 'preview' },
    ],
  });
  const persisted = source.exportPersistedTransactions(routed.transaction.defSessionId);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0]?.schemaVersion, 1);
  assert.equal(persisted[0]?.catalogRevision, source.catalogRevision);
  assert.equal(persisted[0]?.plan?.currentIndex, 0);
  assert.ok((persisted[0]?.trace.length ?? 0) > 0);
  assert.ok(Object.isFrozen(persisted));
  assert.ok(Object.isFrozen(persisted[0]));
  assert.ok(Object.isFrozen(persisted[0]?.trace));
  assert.equal(JSON.stringify(persisted).includes('operationDefinition'), false);
  assert.equal(JSON.stringify(persisted).includes('function'), false);

  const restored = createFullHarnessManager();
  restored.restorePersistedTransactions(JSON.parse(JSON.stringify(persisted)));
  assert.deepEqual(restored.exportPersistedTransactions(), persisted);
  assert.deepEqual(
    restored.getTransaction(routed.transaction.transactionId).projection.tools.map((tool) => tool.name),
    ['def.node.crud.context'],
  );

  const badCatalog = structuredClone(persisted) as unknown as Array<{
    catalogRevision: string;
    transactionId: string;
    defTurnId: string;
  }>;
  badCatalog[0]!.catalogRevision = 'def-harness:stale';
  badCatalog[0]!.transactionId = 'harness:turn-persisted-harness-other';
  badCatalog[0]!.defTurnId = 'turn-persisted-harness-other';
  const atomicRestore = createFullHarnessManager();
  assert.throws(
    () => atomicRestore.restorePersistedTransactions([...persisted, badCatalog[0]! as never]),
    (error: unknown) => error instanceof DefHarnessError && error.code === 'HARNESS_PERSISTED_CATALOG_MISMATCH',
  );
  await expectHarnessError(
    () => atomicRestore.getTransaction(routed.transaction.transactionId),
    'HARNESS_TRANSACTION_NOT_FOUND',
  );

  const staleStep = structuredClone(persisted) as unknown as Array<{
    plan: { steps: Array<{ revision: { sourceLineage: string } }> };
  }>;
  staleStep[0]!.plan.steps[0]!.revision.sourceLineage = 'old-stable:stale';
  await expectHarnessError(
    () => createFullHarnessManager().restorePersistedTransactions(staleStep as never),
    'HARNESS_PERSISTED_CATALOG_MISMATCH',
  );

  const oversized = structuredClone(persisted) as unknown as Array<{ trace: unknown[] }>;
  oversized[0]!.trace = Array.from(
    { length: DEF_HARNESS_PERSISTENCE_LIMITS.maxTraceEntriesPerTransaction + 1 },
    () => persisted[0]!.trace[0],
  );
  await expectHarnessError(
    () => createFullHarnessManager().restorePersistedTransactions(oversized as never),
    'HARNESS_PERSISTED_LIMIT',
  );

  let terminal = routed.transaction;
  while (terminal.status === 'active') {
    terminal = source.completeTool(terminal.transactionId, {
      toolName: terminal.projection.tools[0]!.name,
      status: 'succeeded',
    }).transaction;
  }
  assert.equal(terminal.status, 'completed');
  const terminalPersisted = source.exportPersistedTransactions()[0]!;
  const terminalRestored = createFullHarnessManager();
  terminalRestored.restorePersistedTransaction(JSON.parse(JSON.stringify(terminalPersisted)));
  assert.equal(terminalRestored.getTransaction(terminal.transactionId).status, 'completed');
  assert.deepEqual(terminalRestored.exportPersistedTransactions(), [terminalPersisted]);
}

// Interrupted cross-business plans are only resumable through an explicit
// new Turn. The source evidence stays terminal, completed steps remain
// attached to the new transaction, and the current step starts from its
// catalog entry phase so proposal/mutation approval is requested again.
{
  const resumeManager = createFullHarnessManager();
  const sessionId = asDefSessionId('session-explicit-resume');
  const sourceStarted = resumeManager.beginTurn({
    defSessionId: sessionId,
    defTurnId: asDefTurnId('turn-explicit-resume-source'),
    bindingSnapshotDigest: 'sha256:resume-binding',
  });
  const sourceRouted = resumeManager.route(sourceStarted.transaction.transactionId, {
    steps: [
      { businessId: 'selection', operation: 'inspect' },
      { businessId: 'timeline', operation: 'preview' },
      { businessId: 'calculation', operation: 'calculate' },
    ],
  });
  const firstStepDone = resumeManager.completeTool(sourceRouted.transaction.transactionId, {
    toolName: sourceRouted.transaction.projection.tools[0]!.name,
    status: 'succeeded',
  });
  const interrupted = resumeManager.interrupt(firstStepDone.transaction.transactionId, {
    code: 'HOST_RESTARTED',
    message: 'test interruption',
    occurredAt: '2026-08-08T00:00:00.000Z',
  });
  const sourcePersisted = resumeManager.exportPersistedTransactions(sessionId)
    .find((transaction) => transaction.transactionId === interrupted.transaction.transactionId)!;
  assert.equal(sourcePersisted.status, 'interrupted');
  assert.deepEqual(sourcePersisted.plan?.completedSteps.map((step) => step.index), [0]);
  assert.equal(sourcePersisted.plan?.currentIndex, 1);

  await expectHarnessError(
    () => resumeManager.resumeFromInterrupted({
      sourceTransactionId: sourcePersisted.transactionId,
      defSessionId: sessionId,
      defTurnId: asDefTurnId('turn-explicit-resume-catalog-mismatch'),
      expectedCatalogRevision: 'def-harness:stale',
      expectedBindingSnapshotDigest: 'sha256:resume-binding',
    }),
    'HARNESS_PERSISTED_CATALOG_MISMATCH',
  );
  await expectHarnessError(
    () => resumeManager.resumeFromInterrupted({
      sourceTransactionId: sourcePersisted.transactionId,
      defSessionId: sessionId,
      defTurnId: asDefTurnId('turn-explicit-resume-binding-mismatch'),
      expectedCatalogRevision: resumeManager.catalogRevision,
      expectedBindingSnapshotDigest: 'sha256:changed-binding',
    }),
    'HARNESS_RESUME_BINDING_MISMATCH',
  );

  const resumed = resumeManager.resumeFromInterrupted({
    sourceTransactionId: sourcePersisted.transactionId,
    defSessionId: sessionId,
    defTurnId: asDefTurnId('turn-explicit-resume-new'),
    expectedCatalogRevision: resumeManager.catalogRevision,
    expectedBindingSnapshotDigest: 'sha256:resume-binding',
  });
  assert.equal(resumed.transaction.transactionId, 'harness:turn-explicit-resume-new');
  assert.equal(resumed.transaction.status, 'active');
  assert.equal(resumed.transaction.plan?.currentIndex, 1);
  assert.deepEqual(resumed.transaction.plan?.completedSteps.map((step) => step.index), [0]);
  assert.equal(resumed.transaction.businessId, 'timeline');
  assert.equal(resumed.transaction.operation, 'preview');
  assert.deepEqual(
    resumed.trace.map((entry) => entry.type),
    ['harness.resumed', 'harness.routed', 'harness.phase.entered', 'harness.tool.projected'],
  );
  const resumedPersisted = resumeManager.exportPersistedTransactions(sessionId)
    .find((transaction) => transaction.transactionId === resumed.transaction.transactionId)!;
  assert.equal(resumedPersisted.resumedFromTransactionId, sourcePersisted.transactionId);
  assert.equal(resumedPersisted.bindingSnapshotDigest, 'sha256:resume-binding');
  assert.deepEqual(
    readPlanEvents(resumeManager, resumed.transaction.transactionId)
      .filter((event) => event.type === 'step.completed')
      .map((event) => event.step.index),
    [0],
  );

  let resumedCurrent = resumed.transaction;
  while (resumedCurrent.status === 'active') {
    resumedCurrent = resumeManager.completeTool(resumedCurrent.transactionId, {
      toolName: resumedCurrent.projection.tools[0]!.name,
      status: 'succeeded',
    }).transaction;
  }
  assert.equal(resumedCurrent.status, 'completed');
  assert.deepEqual(resumedCurrent.plan?.completedSteps.map((step) => step.index), [0, 1, 2]);

  await expectHarnessError(
    () => resumeManager.resumeFromInterrupted({
      sourceTransactionId: sourcePersisted.transactionId,
      defSessionId: sessionId,
      defTurnId: asDefTurnId('turn-explicit-resume-new'),
      expectedCatalogRevision: resumeManager.catalogRevision,
      expectedBindingSnapshotDigest: 'sha256:resume-binding',
    }),
    'HARNESS_RESUME_INVALID',
  );

  const activeSourceManager = createFullHarnessManager();
  const activeSource = activeSourceManager.beginTurn({
    defSessionId: sessionId,
    defTurnId: asDefTurnId('turn-explicit-resume-active-source'),
    bindingSnapshotDigest: 'sha256:resume-binding',
  });
  await expectHarnessError(
    () => activeSourceManager.resumeFromInterrupted({
      sourceTransactionId: activeSource.transaction.transactionId,
      defSessionId: sessionId,
      defTurnId: asDefTurnId('turn-explicit-resume-active-target'),
      expectedCatalogRevision: activeSourceManager.catalogRevision,
      expectedBindingSnapshotDigest: 'sha256:resume-binding',
    }),
    'HARNESS_RESUME_INVALID',
  );
}

// A cross-business mutation advances the persisted binding exactly once. A
// restart therefore resumes the next plan step against the post-mutation
// binding, while an external binding change or a read-only attempt to forge a
// new digest is rejected before the transaction moves.
{
  const sessionId = asDefSessionId('session-mutation-binding-resume');
  const beforeDigest = 'sha256:mutation-binding-before';
  const afterDigest = 'sha256:mutation-binding-after';
  const sourceManager = createFullHarnessManager();
  const started = sourceManager.beginTurn({
    defSessionId: sessionId,
    defTurnId: asDefTurnId('turn-mutation-binding-source'),
    bindingSnapshotDigest: beforeDigest,
  });
  const routed = sourceManager.route(started.transaction.transactionId, {
    steps: [
      { businessId: 'selection', operation: 'add' },
      { businessId: 'timeline', operation: 'current' },
    ],
  });
  const mutationContext = sourceManager.completeTool(routed.transaction.transactionId, {
    toolName: 'def.node.crud.context',
    status: 'succeeded',
  });
  assert.equal(
    sourceManager.exportPersistedTransactions(sessionId)[0]?.bindingSnapshotDigest,
    beforeDigest,
    'a read-only context step must not advance the binding',
  );
  const mutationDone = sourceManager.completeTool(mutationContext.transaction.transactionId, {
    toolName: 'def.team.selection.apply',
    status: 'succeeded',
    bindingSnapshotDigest: afterDigest,
  });
  const afterMutationPersisted = sourceManager.exportPersistedTransactions(sessionId)[0]!;
  assert.equal(afterMutationPersisted.bindingSnapshotDigest, afterDigest);
  assert.equal(mutationDone.transaction.plan?.currentIndex, 1);
  assert.deepEqual(mutationDone.transaction.plan?.completedSteps.map((step) => step.index), [0]);

  const interrupted = sourceManager.interrupt(mutationDone.transaction.transactionId, {
    code: 'HOST_RESTARTED',
    message: 'restart after first mutation',
    occurredAt: '2026-08-08T00:10:00.000Z',
  });
  const persisted = sourceManager.exportPersistedTransactions(sessionId)
    .find((transaction) => transaction.transactionId === interrupted.transaction.transactionId)!;
  assert.equal(persisted.bindingSnapshotDigest, afterDigest);

  const restartedManager = createFullHarnessManager();
  restartedManager.restorePersistedTransaction(JSON.parse(JSON.stringify(persisted)));
  await expectHarnessError(
    () => restartedManager.resumeFromInterrupted({
      sourceTransactionId: persisted.transactionId,
      defSessionId: sessionId,
      defTurnId: asDefTurnId('turn-mutation-binding-external-change'),
      expectedCatalogRevision: restartedManager.catalogRevision,
      expectedBindingSnapshotDigest: 'sha256:external-change',
    }),
    'HARNESS_RESUME_BINDING_MISMATCH',
  );
  const resumed = restartedManager.resumeFromInterrupted({
    sourceTransactionId: persisted.transactionId,
    defSessionId: sessionId,
    defTurnId: asDefTurnId('turn-mutation-binding-resumed'),
    expectedCatalogRevision: restartedManager.catalogRevision,
    expectedBindingSnapshotDigest: afterDigest,
  });
  assert.equal(resumed.transaction.businessId, 'timeline');
  assert.equal(resumed.transaction.operation, 'current');
  assert.equal(resumed.transaction.plan?.currentIndex, 1);
  assert.deepEqual(resumed.transaction.plan?.completedSteps.map((step) => step.index), [0]);
  assert.equal(
    restartedManager.exportPersistedTransactions(sessionId)
      .find((transaction) => transaction.transactionId === resumed.transaction.transactionId)
      ?.bindingSnapshotDigest,
    afterDigest,
  );

  await expectHarnessError(
    () => restartedManager.completeTool(resumed.transaction.transactionId, {
      toolName: 'def.node.crud.current',
      status: 'succeeded',
      bindingSnapshotDigest: 'sha256:read-only-forgery',
    }),
    'HARNESS_TOOL_INPUT_INVALID',
  );
  const resumedCompleted = restartedManager.completeTool(resumed.transaction.transactionId, {
    toolName: 'def.node.crud.current',
    status: 'succeeded',
  });
  assert.equal(resumedCompleted.transaction.status, 'completed');
  assert.equal(
    restartedManager.exportPersistedTransactions(sessionId)
      .find((transaction) => transaction.transactionId === resumed.transaction.transactionId)
      ?.bindingSnapshotDigest,
    afterDigest,
    'a read-only completion must retain the authoritative post-mutation digest',
  );
}

// Schema-v1 journals written before the completion digest input existed do
// not contain any new field. They remain readable and resume with their
// original transaction-level binding identity.
{
  const legacyManager = createFullHarnessManager();
  const started = legacyManager.beginTurn({
    defSessionId: asDefSessionId('session-legacy-binding-journal'),
    defTurnId: asDefTurnId('turn-legacy-binding-journal'),
    bindingSnapshotDigest: 'sha256:legacy-binding',
  });
  const routed = legacyManager.route(started.transaction.transactionId, {
    businessId: 'timeline',
    operation: 'current',
  });
  const legacyJournal = structuredClone(legacyManager.exportPersistedTransactions()[0]) as unknown as Record<string, unknown>;
  delete legacyJournal.clarificationPlan;
  const restored = createFullHarnessManager();
  restored.restorePersistedTransaction(legacyJournal as never);
  assert.equal(
    restored.getTransaction(routed.transaction.transactionId).projection.tools[0]?.name,
    'def.node.crud.current',
  );
  const interrupted = restored.interrupt(routed.transaction.transactionId, {
    code: 'HOST_RESTARTED',
    message: 'legacy journal restart',
    occurredAt: '2026-08-08T00:11:00.000Z',
  });
  const resumed = restored.resumeFromInterrupted({
    sourceTransactionId: interrupted.transaction.transactionId,
    defSessionId: asDefSessionId('session-legacy-binding-journal'),
    defTurnId: asDefTurnId('turn-legacy-binding-resumed'),
    expectedCatalogRevision: restored.catalogRevision,
    expectedBindingSnapshotDigest: 'sha256:legacy-binding',
  });
  assert.equal(resumed.transaction.operation, 'current');
}

// The 50 old stable operations remain exact. Work Node deletion and the
// Timeline preview lifecycle are explicit administration extensions and are
// checked separately below; clarification remains the only other addition.
assert.deepEqual(DEF_HARNESS_FULL_OPERATION_MATRIX, expectedFullOperationMatrix);
assert.equal(
  Object.values(expectedFullOperationMatrix).flat().length,
  50,
  'the audited matrix must contain exactly the 50 parity operations',
);
const adminExtensionSet = new Set<string>(DEF_HARNESS_ADMIN_EXTENSION_OPERATIONS);
for (const businessId of Object.keys(expectedFullOperationMatrix) as Array<keyof typeof expectedFullOperationMatrix>) {
  const definition = PHASE7_FULL_HARNESS_CATALOG.find((entry) => entry.businessId === businessId)!;
  const expectedOperations = expectedFullOperationMatrix[businessId];
  const actualOperations = definition.operations
    .filter((operation) => operation.operation !== 'ask')
    .filter((operation) => !adminExtensionSet.has(`${businessId}.${operation.operation}`))
    .map((operation) => operation.operation);
  assert.deepEqual(actualOperations, expectedOperations, `${businessId} must not silently drop an old operation`);
  assert.equal(
    definition.operations.filter((operation) => operation.operation === 'ask').length,
    1,
    `${businessId} must retain one clarification route`,
  );
  assert.equal(new Set(actualOperations).size, expectedOperations.length, `${businessId} contains a duplicate operation`);
  assert.match(definition.revision, /-v18-full-matrix$/u);
  assert.match(definition.sourceLineage, /old-stable:bcea5f12a3148737e7a9b799d2fa4e0170ffe0bb/u);
  for (const operation of definition.operations) {
    assert.equal(
      new Set(operation.phases.map((phase) => phase.id)).size,
      operation.phases.length,
      `${businessId}.${operation.operation} contains a duplicate phase id`,
    );
    for (const phase of operation.phases) {
      if (phase.terminalState) {
        assert.equal(phase.tools.length, 0);
        continue;
      }
      assert.equal(phase.tools.length, 1, `${businessId}.${operation.operation}.${phase.id} must expose one active Tool`);
      const descriptor = fullStubResolver(phase.tools[0]!);
      assert.ok(descriptor);
      if (descriptor.risk === 'mutate') {
        assert.ok(phase.writes.length > 0, `${businessId}.${operation.operation}.${phase.id} mutation must declare scope`);
      } else {
        assert.deepEqual(phase.writes, [], `${businessId}.${operation.operation}.${phase.id} read/proposal cannot declare writes`);
      }
      for (const write of phase.writes) {
        assert.ok((definition.writeScope as readonly string[]).includes(write), `${businessId}.${operation.operation} writes outside its scope: ${write}`);
      }
      if ((businessId === 'timeline' || businessId === 'buff') && descriptor.risk === 'mutate') {
        assert.ok(phase.writes.includes('timeline.work-node'), `${businessId}.${operation.operation} must write through a Work Node`);
      }
    }
  }
}
for (const extension of DEF_HARNESS_ADMIN_EXTENSION_OPERATIONS) {
  const [businessId, operation] = extension.split('.') as [keyof typeof expectedFullOperationMatrix, string];
  assert.ok(
    PHASE7_FULL_HARNESS_CATALOG
      .find((entry) => entry.businessId === businessId)
      ?.operations.some((candidate) => candidate.operation === operation),
    `${extension} must be explicitly present as an admin extension`,
  );
}
const fullOperation = (businessId: string, operation: string) => PHASE7_FULL_HARNESS_CATALOG
  .find((entry) => entry.businessId === businessId)!
  .operations.find((entry) => entry.operation === operation)!;
const timelineInspect = fullOperation('timeline', 'inspect');
assert.equal(
  timelineInspect.phases.filter((currentPhase) => currentPhase.kind !== 'response').length,
  1,
);
assert.deepEqual(
  timelineInspect.phases.flatMap((currentPhase) => currentPhase.tools),
  ['def.node.crud.current'],
);
assert.match(
  timelineInspect.phases[0]?.instructions ?? '',
  /Historical Work Nodes require a separate explicit def\.worknode\.read request with nodeId/u,
);
assert.deepEqual(
  fullOperation('loadout', 'restore').phases.flatMap((phase) => phase.tools),
  ['def.capability.status'],
  'retired loadout-only restore must not expose whole-Work-Node mutation',
);
assert.deepEqual(
  fullOperation('loadout', 'recommend_equipment').phases.flatMap((phase) => phase.tools),
  ['def.capability.status'],
);
assert.deepEqual(
  PHASE7_FULL_HARNESS_CATALOG.find((entry) => entry.businessId === 'selection')?.writeScope,
  [
    'selection.roster',
    'timeline.buttons',
    'timeline.buffs',
    'timeline.resistance',
    'loadout.config',
    'timeline.work-node',
    'timeline.checkout',
  ],
);
for (const operation of ['add', 'remove', 'replace', 'reorder', 'apply']) {
  const phaseDefinition = fullOperation('selection', operation).phases.find((phase) => phase.kind === 'mutation');
  assert.deepEqual(phaseDefinition?.writes, [
    'selection.roster',
    'timeline.buttons',
    'timeline.buffs',
    'timeline.resistance',
    'loadout.config',
    'timeline.work-node',
    'timeline.checkout',
  ]);
}
assert.deepEqual(
  fullOperation('timeline', 'restore').phases.find((phase) => phase.kind === 'mutation')?.writes,
  ['timeline.buttons', 'timeline.buffs', 'timeline.resistance', 'timeline.work-node', 'timeline.checkout'],
);
assert.deepEqual(
  fullOperation('buff', 'restore').phases.find((phase) => phase.kind === 'mutation')?.writes,
  ['timeline.buffs', 'timeline.resistance', 'timeline.work-node', 'timeline.checkout'],
);
assert.match(
  fullOperation('loadout', 'recommend_discovered_set').phases[1]!.instructions,
  /recommendDiscoveredSets/u,
);
assert.match(fullOperation('loadout', 'recommend').phases[1]!.instructions, /recommendLoadout/u);
assert.match(fullOperation('loadout', 'evaluate').phases[1]!.instructions, /evaluateLoadout/u);
assert.match(fullOperation('loadout', 'recommend_named_set').phases[1]!.instructions, /recommendNamedSet/u);
assert.match(fullOperation('loadout', 'recommend_weapon').phases[1]!.instructions, /recommendWeapons/u);
assert.match(fullOperation('loadout', 'compare').phases[1]!.instructions, /compareLoadoutCandidates/u);
assert.match(fullOperation('loadout', 'preview').phases[1]!.instructions, /compareLoadoutCandidate/u);
for (const operation of ['evaluate', 'recommend', 'recommend_named_set', 'recommend_discovered_set', 'recommend_weapon', 'compare']) {
  assert.equal(
    fullOperation('loadout', operation).phases.some((phase) => (
      (phase.tools as readonly string[]).includes('def.data.catalog.query')
    )),
    true,
    `${operation} must route through the deterministic browser 1.8 loadout service`,
  );
}
assert.deepEqual(
  fullOperation('timeline', 'add').phases.flatMap((phase) => phase.tools),
  ['def.node.crud.current', 'def.data.catalog.query', 'def.workbench.add_skill_button'],
);
assert.deepEqual(
  fullOperation('timeline', 'replace').phases.flatMap((phase) => phase.tools),
  ['def.node.crud.current', 'def.data.catalog.query', 'def.worknode.patch_and_validate'],
);
assert.deepEqual(
  fullOperation('calculation', 'diagnose').phases.flatMap((phase) => phase.tools),
  ['def.node.crud.context', 'def.data.resource.damage'],
);
const conversation = PHASE7_FULL_HARNESS_CATALOG.find((entry) => entry.businessId === 'conversation')!;
assert.deepEqual(conversation.operations.map((operation) => operation.operation), ['respond']);
assert.equal(fullHarnessManager.listRevisions().length, 6);

// Every listed operation has a success path to a terminal state. This catches
// a newly added phase whose success transition accidentally ends in a dead
// branch, while the manager's failure path is checked by its existing tests.
for (const businessId of Object.keys(expectedFullOperationMatrix) as Array<keyof typeof expectedFullOperationMatrix>) {
  const definition = PHASE7_FULL_HARNESS_CATALOG.find((entry) => entry.businessId === businessId)!;
  for (const operation of definition.operations) {
    const started = fullHarnessManager.beginTurn({
      defSessionId: asDefSessionId(`session-full-${businessId}-${operation.operation}`),
      defTurnId: asDefTurnId(`turn-full-${businessId}-${operation.operation}`),
    });
    const routeInput: JsonObject = operation.operation === 'ask'
      ? {
          businessId,
          operation: 'ask' as const,
          resume: { steps: [{ businessId, operation: expectedFullOperationMatrix[businessId][0]! }] },
        }
      : { businessId, operation: operation.operation };
    let current = fullHarnessManager.route(started.transaction.transactionId, routeInput).transaction;
    while (current.status === 'active') {
      const toolName = current.projection.tools[0]?.name;
      assert.ok(toolName, `${businessId}.${operation.operation} lost its active Tool`);
      current = fullHarnessManager.completeTool(current.transactionId, {
        toolName,
        status: 'succeeded',
      }).transaction;
    }
    assert.equal(current.status, 'completed', `${businessId}.${operation.operation} must reach completed`);
    assert.equal(current.terminalState, 'completed');
  }
}

// A clarification answer follows the exact bound resume plan and never
// projects an arbitrary second route.
{
  const started = fullHarnessManager.beginTurn({
    defSessionId: asDefSessionId('session-full-ask-reroute'),
    defTurnId: asDefTurnId('turn-full-ask-reroute'),
  });
  const asked = fullHarnessManager.route(started.transaction.transactionId, {
    businessId: 'selection',
    operation: 'ask',
    resume: {
      steps: [
        { businessId: 'timeline', operation: 'preview' },
        { businessId: 'calculation', operation: 'calculate' },
      ],
    },
  });
  assert.deepEqual(asked.transaction.projection.tools.map((tool) => tool.name), ['def.user.ask']);
  assert.deepEqual(
    asked.transaction.clarificationPlan?.map(({ businessId, operation }) => ({ businessId, operation })),
    [
      { businessId: 'timeline', operation: 'preview' },
      { businessId: 'calculation', operation: 'calculate' },
    ],
  );
  const rerouteReady = fullHarnessManager.completeTool(asked.transaction.transactionId, {
    toolName: 'def.user.ask',
    status: 'succeeded',
  });
  assert.deepEqual(rerouteReady.transaction.projection.tools.map((tool) => tool.name), ['def.node.crud.current']);
  assert.equal(rerouteReady.transaction.clarificationPlan, null);
  const rerouted = rerouteReady;
  assert.equal(rerouted.transaction.businessId, 'timeline');
  assert.equal(rerouted.transaction.operation, 'preview');
  assert.deepEqual(rerouted.transaction.plan?.steps.map(({ businessId, operation }) => ({ businessId, operation })), [
    { businessId: 'selection', operation: 'ask' },
    { businessId: 'timeline', operation: 'preview' },
    { businessId: 'calculation', operation: 'calculate' },
  ]);
  assert.deepEqual(rerouted.transaction.plan?.completedSteps.map((step) => step.index), [0]);
  assert.deepEqual(rerouted.transaction.projection.tools.map((tool) => tool.name), ['def.node.crud.current']);
  await expectHarnessError(
    () => fullHarnessManager.route(rerouted.transaction.transactionId, {
      businessId: 'conversation',
      operation: 'respond',
    }),
    'HARNESS_ROUTE_INVALID',
  );
  let completed = rerouted.transaction;
  while (completed.status === 'active') {
    const toolName = completed.projection.tools[0]?.name;
    assert.ok(toolName);
    completed = fullHarnessManager.completeTool(completed.transactionId, {
      toolName,
      status: 'succeeded',
    }).transaction;
  }
  assert.equal(completed.status, 'completed');
  assert.equal(completed.plan?.currentIndex, 3);
  assert.deepEqual(completed.plan?.completedSteps.map((step) => step.index), [0, 1, 2]);
  assert.deepEqual(
    readPlanEvents(fullHarnessManager, completed.transactionId).map((event) => event.type),
    ['plan.created', 'step.completed', 'plan.created', 'step.completed', 'step.completed'],
  );
}

// A question that is interrupted is restart-safe: its original resume edge is
// restored with the transaction, and a fresh Turn re-asks before entering the
// bound business operation. No arbitrary route is projected after the answer.
{
  const sourceManager = createFullHarnessManager();
  const sessionId = asDefSessionId('session-ask-restart');
  const started = sourceManager.beginTurn({
    defSessionId: sessionId,
    defTurnId: asDefTurnId('turn-ask-restart-source'),
    bindingSnapshotDigest: 'sha256:ask-restart',
  });
  const asked = sourceManager.route(started.transaction.transactionId, {
    businessId: 'selection',
    operation: 'ask',
    resume: {
      steps: [
        { businessId: 'selection', operation: 'inspect' },
        { businessId: 'timeline', operation: 'current' },
      ],
    },
  });
  const interrupted = sourceManager.interrupt(asked.transaction.transactionId, {
    code: 'HOST_RESTARTED',
    message: 'question was open during restart',
    occurredAt: '2026-08-08T00:00:00.000Z',
  });
  const persisted = sourceManager.exportPersistedTransactions(sessionId)[0]!;
  const restartedManager = createFullHarnessManager();
  restartedManager.restorePersistedTransaction(JSON.parse(JSON.stringify(persisted)));
  const resumed = restartedManager.resumeFromInterrupted({
    sourceTransactionId: interrupted.transaction.transactionId,
    defSessionId: sessionId,
    defTurnId: asDefTurnId('turn-ask-restart-resumed'),
    expectedCatalogRevision: restartedManager.catalogRevision,
    expectedBindingSnapshotDigest: 'sha256:ask-restart',
  });
  assert.equal(resumed.transaction.operation, 'ask');
  assert.deepEqual(
    resumed.transaction.clarificationPlan?.map(({ businessId, operation }) => ({ businessId, operation })),
    [
      { businessId: 'selection', operation: 'inspect' },
      { businessId: 'timeline', operation: 'current' },
    ],
  );
  const afterAnswer = restartedManager.completeTool(resumed.transaction.transactionId, {
    toolName: 'def.user.ask',
    status: 'succeeded',
  });
  assert.equal(afterAnswer.transaction.businessId, 'selection');
  assert.equal(afterAnswer.transaction.operation, 'inspect');
  assert.deepEqual(afterAnswer.transaction.projection.tools.map((tool) => tool.name), ['def.node.crud.context']);
  assert.equal(afterAnswer.transaction.projection.tools.some((tool) => tool.name === DEF_HARNESS_ROUTE_TOOL_NAME), false);
}

// Three businesses execute in one deterministic Turn. An operation terminal
// projects the next operation immediately instead of exposing an empty Tool
// projection or asking the Engine to route again.
{
  const planManager = createFullHarnessManager();
  const started = planManager.beginTurn({
    defSessionId: asDefSessionId('session-cross-business-plan'),
    defTurnId: asDefTurnId('turn-cross-business-plan'),
  });
  assert.equal(started.transaction.plan, null);
  const routeSchema = started.transaction.projection.tools[0]!.inputSchema;
  assert.equal(routeSchema.type, 'object');
  assert.equal(routeSchema.additionalProperties, false);
  assert.ok(routeSchema.properties && typeof routeSchema.properties === 'object');
  assert.ok(Array.isArray(routeSchema.oneOf));
  assert.match(planManager.buildRoutingSystemContext(), /steps:\[\.\.\.\].*1-8/su);

  const routed = planManager.route(started.transaction.transactionId, {
    steps: [
      { businessId: 'selection', operation: 'inspect' },
      { businessId: 'timeline', operation: 'preview' },
      { businessId: 'calculation', operation: 'calculate' },
    ],
  });
  assert.equal(routed.transaction.projection.revision, 2);
  assert.deepEqual(routed.transaction.projection.tools.map((tool) => tool.name), ['def.node.crud.context']);
  assert.deepEqual(
    routed.transaction.plan?.steps.map(({ businessId, operation }) => ({ businessId, operation })),
    [
      { businessId: 'selection', operation: 'inspect' },
      { businessId: 'timeline', operation: 'preview' },
      { businessId: 'calculation', operation: 'calculate' },
    ],
  );
  assert.equal(routed.transaction.plan?.currentIndex, 0);
  assert.deepEqual(routed.transaction.plan?.completedSteps, []);
  assert.deepEqual(routed.transaction.plan?.steps.map((step) => step.index), [0, 1, 2]);
  assert.equal(routed.transaction.plan?.steps.every((step) => step.revision.contentHash.startsWith('sha256:')), true);
  assert.ok(Object.isFrozen(routed.transaction.plan));
  assert.ok(Object.isFrozen(routed.transaction.plan?.steps));
  assert.throws(() => {
    (routed.transaction.plan!.steps as unknown as Array<{ businessId: string; operation: string }>).push({
      businessId: 'buff',
      operation: 'inspect',
    });
  }, TypeError);
  const serialized = JSON.stringify(routed.transaction);
  assert.deepEqual(JSON.parse(serialized).plan.steps, routed.transaction.plan?.steps);
  assert.equal(serialized.includes('operationDefinition'), false);

  const timelineStarted = planManager.completeTool(routed.transaction.transactionId, {
    toolName: 'def.node.crud.context',
    status: 'succeeded',
  });
  assert.equal(timelineStarted.transaction.projection.revision, 3);
  assert.equal(timelineStarted.transaction.businessId, 'timeline');
  assert.deepEqual(timelineStarted.transaction.projection.tools.map((tool) => tool.name), ['def.node.crud.current']);
  assert.equal(timelineStarted.transaction.plan?.currentIndex, 1);
  assert.deepEqual(timelineStarted.transaction.plan?.completedSteps.map((step) => step.operation), ['inspect']);

  const timelineDiff = planManager.completeTool(timelineStarted.transaction.transactionId, {
    toolName: 'def.node.crud.current',
    status: 'succeeded',
  });
  assert.equal(timelineDiff.transaction.projection.revision, 4);
  assert.deepEqual(timelineDiff.transaction.projection.tools.map((tool) => tool.name), ['def.timeline.preview']);

  const calculationStarted = planManager.completeTool(timelineDiff.transaction.transactionId, {
    toolName: 'def.timeline.preview',
    status: 'succeeded',
  });
  assert.equal(calculationStarted.transaction.projection.revision, 5);
  assert.equal(calculationStarted.transaction.businessId, 'calculation');
  assert.deepEqual(calculationStarted.transaction.projection.tools.map((tool) => tool.name), ['def.node.crud.context']);

  const damageProjected = planManager.completeTool(calculationStarted.transaction.transactionId, {
    toolName: 'def.node.crud.context',
    status: 'succeeded',
  });
  assert.equal(damageProjected.transaction.projection.revision, 6);
  assert.deepEqual(damageProjected.transaction.projection.tools.map((tool) => tool.name), ['def.data.resource.damage']);

  const completed = planManager.completeTool(damageProjected.transaction.transactionId, {
    toolName: 'def.data.resource.damage',
    status: 'succeeded',
  });
  assert.equal(completed.transaction.status, 'completed');
  assert.equal(completed.transaction.projection.revision, 7);
  assert.deepEqual(completed.transaction.projection.tools, []);
  assert.equal(completed.transaction.plan?.currentIndex, 3);
  assert.deepEqual(completed.transaction.plan?.completedSteps.map((step) => step.index), [0, 1, 2]);

  const trace = planManager.getTrace(completed.transaction.transactionId);
  assert.deepEqual(trace.map((entry) => entry.sequence), Array.from({ length: trace.length }, (_, index) => index + 1));
  assert.deepEqual(
    trace.filter((entry) => entry.type === 'harness.tool.projected').map((entry) => entry.projectionRevision),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.deepEqual(
    trace.filter((entry) => entry.type === 'harness.tool.projected').map((entry) => entry.tools),
    [
      [DEF_HARNESS_ROUTE_TOOL_NAME],
      ['def.node.crud.context'],
      ['def.node.crud.current'],
      ['def.timeline.preview'],
      ['def.node.crud.context'],
      ['def.data.resource.damage'],
      [],
    ],
  );
  assert.deepEqual(
    trace.filter((entry) => entry.type === 'harness.routed').map((entry) => `${entry.businessId}.${entry.operation}`),
    ['selection.inspect', 'timeline.preview', 'calculation.calculate'],
  );
  assert.deepEqual(
    readPlanEvents(planManager, completed.transaction.transactionId).map((event) => event.type),
    ['plan.created', 'step.completed', 'step.completed', 'step.completed'],
  );
}

// A failed step closes the whole plan and never projects a later business.
{
  const planManager = createFullHarnessManager();
  const started = planManager.beginTurn({
    defSessionId: asDefSessionId('session-plan-failure'),
    defTurnId: asDefTurnId('turn-plan-failure'),
  });
  const routed = planManager.route(started.transaction.transactionId, {
    steps: [
      { businessId: 'selection', operation: 'inspect' },
      { businessId: 'timeline', operation: 'preview' },
      { businessId: 'calculation', operation: 'calculate' },
    ],
  });
  const timelineStarted = planManager.completeTool(routed.transaction.transactionId, {
    toolName: 'def.node.crud.context',
    status: 'succeeded',
  });
  const failed = planManager.completeTool(timelineStarted.transaction.transactionId, {
    toolName: 'def.node.crud.current',
    status: 'failed',
  });
  assert.equal(failed.transaction.status, 'aborted');
  assert.equal(failed.transaction.terminalState, 'aborted');
  assert.deepEqual(failed.transaction.projection.tools, []);
  assert.equal(failed.transaction.plan?.currentIndex, 1);
  assert.deepEqual(failed.transaction.plan?.completedSteps.map((step) => step.index), [0]);
  assert.deepEqual(
    planManager.getTrace(failed.transaction.transactionId)
      .filter((entry) => entry.type === 'harness.routed')
      .map((entry) => entry.businessId),
    ['selection', 'timeline'],
  );
  const events = readPlanEvents(planManager, failed.transaction.transactionId);
  assert.deepEqual(events.map((event) => event.type), ['plan.created', 'step.completed', 'step.failed']);
  const failure = events.at(-1)!;
  assert.equal(failure.type, 'step.failed');
  if (failure.type === 'step.failed') assert.equal(failure.stepIndex, 1);
  await expectHarnessError(
    () => planManager.completeTool(failed.transaction.transactionId, {
      toolName: 'def.worknode.diff',
      status: 'succeeded',
    }),
    'HARNESS_TRANSACTION_TERMINAL',
  );
}

// Invalid plans are rejected before staging: a bad eighth/later route cannot
// alter the current projection, plan, trace or prepared-transition slot.
{
  const planManager = createFullHarnessManager();
  const started = planManager.beginTurn({
    defSessionId: asDefSessionId('session-plan-atomic-reject'),
    defTurnId: asDefTurnId('turn-plan-atomic-reject'),
  });
  const transactionId = started.transaction.transactionId;
  const baselineSnapshot = JSON.stringify(planManager.getTransaction(transactionId));
  const baselineTrace = JSON.stringify(planManager.getTrace(transactionId));
  const invalidCases: readonly { readonly input: JsonObject; readonly code: string }[] = [
    { input: { steps: [] }, code: 'HARNESS_ROUTE_INVALID' },
    {
      input: {
        steps: Array.from({ length: 9 }, (_, index) => ({
          businessId: 'selection',
          operation: index % 2 === 0 ? 'inspect' : 'search',
        })),
      },
      code: 'HARNESS_ROUTE_INVALID',
    },
    {
      input: {
        businessId: 'selection',
        operation: 'ask',
      },
      code: 'HARNESS_ROUTE_INVALID',
    },
    {
      input: {
        businessId: 'selection',
        operation: 'ask',
        resume: { steps: [{ businessId: 'conversation', operation: 'respond' }] },
      },
      code: 'HARNESS_ROUTE_INVALID',
    },
    {
      input: {
        steps: [
          { businessId: 'selection', operation: 'inspect' },
          { businessId: 'selection', operation: 'inspect' },
        ],
      },
      code: 'HARNESS_ROUTE_INVALID',
    },
    {
      input: {
        steps: [
          { businessId: 'selection', operation: 'inspect', unexpected: true },
        ],
      },
      code: 'HARNESS_ROUTE_INVALID',
    },
    {
      input: {
        steps: [
          { businessId: 'conversation', operation: 'respond' },
          { businessId: 'selection', operation: 'inspect' },
        ],
      },
      code: 'HARNESS_ROUTE_INVALID',
    },
    {
      input: {
        steps: [
          { businessId: 'selection', operation: 'ask' },
          { businessId: 'timeline', operation: 'current' },
        ],
      },
      code: 'HARNESS_ROUTE_INVALID',
    },
    {
      input: {
        steps: [
          { businessId: 'selection', operation: 'inspect' },
          { businessId: 'timeline', operation: 'calculate' },
        ],
      },
      code: 'HARNESS_ROUTE_UNSUPPORTED',
    },
    {
      input: {
        steps: [{ businessId: 'selection', operation: 'inspect' }],
        unexpected: true,
      },
      code: 'HARNESS_ROUTE_INVALID',
    },
  ];
  for (const invalid of invalidCases) {
    await expectHarnessError(
      () => planManager.prepareRoute(transactionId, invalid.input),
      invalid.code,
    );
    assert.equal(JSON.stringify(planManager.getTransaction(transactionId)), baselineSnapshot);
    assert.equal(JSON.stringify(planManager.getTrace(transactionId)), baselineTrace);
  }
  const valid = planManager.route(transactionId, {
    steps: [{ businessId: 'selection', operation: 'inspect' }],
  });
  assert.equal(valid.transaction.status, 'active');
  assert.deepEqual(
    valid.transaction.plan?.steps.map(({ businessId, operation }) => ({ businessId, operation })),
    [{ businessId: 'selection', operation: 'inspect' }],
  );
}

assert.equal(registry.listDescriptors().length, 6);
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
    operations: Array<{ phases: Array<{ writes: string[] }> }>;
  }>;
  writingCatalog[0]!.writeScope = ['selection.roster'];
  writingCatalog[0]!.operations[0]!.phases[0]!.writes = ['selection.roster'];
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
  assert.deepEqual(routed.transaction.plan?.steps.map(({ businessId, operation }) => ({ businessId, operation })), [{
    businessId: parity.businessId,
    operation: parity.operation,
  }]);
  assert.equal(routed.transaction.plan?.currentIndex, 0);
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
  assert.equal(current.plan?.currentIndex, 1);
  assert.deepEqual(current.plan?.completedSteps.map((step) => step.index), [0]);
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

// Terminal Harness transactions are retained for recent diagnostics but pruned at a hard ceiling.
{
  const boundedManager = new DefHarnessManager({
    resolveToolDescriptor: (name) => registry.resolveDescriptor(name),
  });
  let oldestTransactionId = '';
  for (let index = 0; index < DEF_AGENT_IN_MEMORY_LIMITS.maxHarnessTransactionsPerHost; index += 1) {
    const started = boundedManager.beginTurn({
      defSessionId: asDefSessionId('session-harness-retention'),
      defTurnId: asDefTurnId(`turn-harness-retention-${index}`),
    });
    if (index === 0) oldestTransactionId = started.transaction.transactionId;
    boundedManager.abort(started.transaction.transactionId, 'RETENTION_FIXTURE');
  }
  const newest = boundedManager.beginTurn({
    defSessionId: asDefSessionId('session-harness-retention'),
    defTurnId: asDefTurnId('turn-harness-retention-newest'),
  });
  assert.equal(boundedManager.getTransaction(newest.transaction.transactionId).status, 'routing');
  assert.deepEqual(boundedManager.consumePrunedSessionIds(), ['session-harness-retention']);
  assert.deepEqual(boundedManager.consumePrunedSessionIds(), []);
  await expectHarnessError(
    () => boundedManager.getTransaction(oldestTransactionId),
    'HARNESS_TRANSACTION_NOT_FOUND',
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
assert.equal(buffResult.candidateCount, 2);
assert.deepEqual(
  (buffResult.candidates as JsonObject[]).flatMap((candidate) => candidate.sourceKinds as string[]).sort(),
  ['button', 'equipment'],
);

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
