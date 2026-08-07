import assert from 'node:assert/strict';
import {
  asDatabaseGeneration,
  asEngineTurnId,
  asInteractionId,
  asTimelineId,
  asToolCallId,
  asWorkspaceId,
  type AgentEngine,
  type DefEvent,
  type DefTurnId,
  type EngineToolResultInput,
  type JsonObject,
  type JsonValue,
  type Phase2ProductOperationSchema,
  type ProductBinding,
  type ProductGateway,
  type ProductSnapshotEnvelope,
} from '../core/contracts/index.ts';
import { DefHarnessManager } from '../core/harness/manager.ts';
import { DeterministicFakeAgentEngine, type FakeEngineScriptStep } from '../core/testing/fake-engine.ts';
import { PHASE3_READONLY_PARITY_CASES } from '../core/testing/fixtures/phase3-readonly-parity.ts';
import { DefReadToolRegistry } from '../core/tools/read-only-workbench.ts';
import { BrowserConsumerRegistry } from './browser-consumer-registry.ts';
import { DefAgentHost } from './def-agent-host.ts';
import { DefAgentHostError } from './errors.ts';
import { RemoteBrowserProductGateway } from './remote-browser-product-gateway.ts';
import type { AgentUiCapabilityClaims } from './token-authority.ts';

const capturedAt = '2026-08-07T12:00:00.000Z';

function binding(overrides: Partial<ProductBinding> = {}): ProductBinding {
  return {
    workspaceId: asWorkspaceId('workspace-phase3'),
    databaseGeneration: asDatabaseGeneration('generation-phase3'),
    timelineId: asTimelineId('timeline-phase3'),
    checkoutTargetId: 'node-phase3',
    checkoutUpdatedAt: 30,
    contentRevision: 30,
    snapshotDigest: 'sha256:phase3-snapshot',
    ...overrides,
  };
}

function damageReportFixture(): JsonObject {
  return {
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
  };
}

function snapshot(expectedBinding = binding()): ProductSnapshotEnvelope {
  return {
    protocolVersion: 1,
    binding: expectedBinding,
    capturedAt,
    payload: {
      schemaVersion: 1,
      updatedAt: expectedBinding.contentRevision,
      source: 'app',
      timelineId: expectedBinding.timelineId,
      activeTimelineId: expectedBinding.timelineId,
      currentView: 'canvas',
      damageReportStatus: 'ready',
      checkout: {
        targetType: 'work-node',
        targetId: expectedBinding.checkoutTargetId,
        updatedAt: expectedBinding.checkoutUpdatedAt,
      },
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
      damageReport: damageReportFixture(),
    },
  };
}

function claims(capabilityId: string): AgentUiCapabilityClaims {
  return {
    capabilityId,
    origin: 'http://127.0.0.1:31457',
    audience: 'workbench-ai-mode',
    issuedAt: 1,
    expiresAt: Number.MAX_SAFE_INTEGER,
  };
}

function bindingJson(value = binding()): JsonObject {
  return {
    workspaceId: value.workspaceId,
    databaseGeneration: value.databaseGeneration,
    timelineId: value.timelineId,
    checkoutTargetId: value.checkoutTargetId,
    checkoutUpdatedAt: value.checkoutUpdatedAt,
    contentRevision: value.contentRevision,
    snapshotDigest: value.snapshotDigest,
  };
}

function expectedResult(toolName: string): JsonValue {
  if (toolName === 'def.node.crud.context') {
    return {
      contract: 'DefWorkbenchContextV1',
      binding: bindingJson(),
      capturedAt,
      currentView: 'canvas',
      checkout: { targetType: 'work-node', targetId: 'node-phase3', updatedAt: 30 },
      selectedCharacters: [
        { id: 'char-a', name: '测试甲', element: '火', profession: '近卫', librarySource: 'local' },
        { id: 'char-b', name: '测试乙', element: '冰', profession: '辅助', librarySource: 'local' },
      ],
      counts: { selectedCharacters: 2, skillButtons: 2, operatorConfigs: 1 },
      damageReportAvailable: true,
    };
  }
  if (toolName === 'def.data.resource.team_loadouts') {
    return {
      contract: 'DefTeamLoadoutsV1',
      binding: bindingJson(),
      complete: false,
      missingCharacterIds: ['char-b'],
      operators: [
        {
          character: { id: 'char-a', name: '测试甲', element: '火', profession: '近卫', librarySource: 'local' },
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
          configured: true,
        },
        {
          character: { id: 'char-b', name: '测试乙', element: '冰', profession: '辅助', librarySource: 'local' },
          weapon: null,
          equipment: [],
          setBuffs: [],
          operatorSkillLevels: null,
          configured: false,
        },
      ],
    };
  }
  if (toolName === 'def.node.crud.current') {
    return {
      contract: 'DefCurrentTimelineV1',
      binding: bindingJson(),
      timelineId: 'timeline-phase3',
      checkout: { targetType: 'work-node', targetId: 'node-phase3', updatedAt: 30 },
      contentRevision: 30,
      buttonCount: 2,
      buttons: [
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
          selectedBuffCount: 1,
        },
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
          selectedBuffCount: 0,
        },
      ],
    };
  }
  if (toolName === 'def.data.resource.buff') {
    return {
      contract: 'DefBuffCandidatesV1',
      schemaVersion: 2,
      binding: bindingJson(),
      query: '攻击',
      buttonId: null,
      candidateCount: 2,
      truncated: false,
      candidates: [{
        id: 'buff-attack',
        label: '攻击提升',
        type: 'attackPercent',
        value: 0.2,
        sourceKinds: ['equipment'],
        sourceLabels: ['测试护甲'],
        buttonIds: [],
        characterIds: ['char-a'],
      }, {
        id: 'buff-attack',
        label: '攻击提升',
        type: 'attackPercent',
        value: 0.2,
        sourceKinds: ['button'],
        sourceLabels: ['fixture', '测试来源'],
        buttonIds: ['button-a'],
        characterIds: ['char-a'],
      }],
    };
  }
  if (toolName === 'def.data.resource.damage') {
    return {
      contract: 'DefDamageReportV1',
      binding: bindingJson(),
      formulaVersion: 'damage-report-v1',
      statisticalScope: 'current-workbench-snapshot',
      schemeDigest: 'sha256:phase3-snapshot',
      report: damageReportFixture(),
    };
  }
  throw new Error(`Missing golden result for ${toolName}`);
}

function toolInput(toolName: string): JsonValue {
  return toolName === 'def.data.resource.buff' ? { query: '攻击' } : {};
}

function turnEvents(events: readonly DefEvent[], defTurnId: string): readonly DefEvent[] {
  return events.filter((event) => 'defTurnId' in event && event.defTurnId === defTurnId);
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(message);
}

async function delayedStartingTurnFixture(label: string) {
  const owner = claims(`phase3-${label}-owner`);
  const consumers = new BrowserConsumerRegistry();
  const registration = {
    consumerId: `consumer-${label}`,
    executorLeaseId: `lease-${label}`,
    writer: true as const,
    visible: true as const,
    binding: binding(),
  };
  consumers.register(owner, registration);
  const gateway = new RemoteBrowserProductGateway(consumers);
  gateway.publishSnapshot(owner, {
    consumerId: registration.consumerId,
    executorLeaseId: registration.executorLeaseId,
    snapshot: snapshot(),
  });
  const baseEngine = new DeterministicFakeAgentEngine();
  let markHandleReady!: () => void;
  const handleReady = new Promise<void>((resolve) => { markHandleReady = resolve; });
  let releaseStart!: () => void;
  const startGate = new Promise<void>((resolve) => { releaseStart = resolve; });
  let startingDefTurnId: DefTurnId | null = null;
  const engineAbortCodes: string[] = [];
  const delayedEngine: AgentEngine = {
    kind: baseEngine.kind,
    probe: () => baseEngine.probe(),
    createSession: (input) => baseEngine.createSession(input),
    recoverSession: (ref) => baseEngine.recoverSession(ref),
    startTurn: async (input) => {
      const handle = await baseEngine.startTurn(input);
      startingDefTurnId = input.defTurnId;
      markHandleReady();
      await startGate;
      return {
        ref: handle.ref,
        events: handle.events,
        submitToolResult: (result) => handle.submitToolResult(result),
        submitToolResultAndUpdateProjection: (result, projection) => (
          handle.submitToolResultAndUpdateProjection(result, projection)
        ),
        submitInteractionResult: (result) => handle.submitInteractionResult(result),
        updateToolProjection: (projection) => handle.updateToolProjection(projection),
        abort: async (reason) => {
          engineAbortCodes.push(reason.code);
          return handle.abort(reason);
        },
      };
    },
    compact: (ref) => baseEngine.compact(ref),
    disposeSession: (ref) => baseEngine.disposeSession(ref),
    shutdown: () => baseEngine.shutdown(),
  };
  const tools = new DefReadToolRegistry();
  const harness = new DefHarnessManager({
    resolveToolDescriptor: (name) => tools.resolveDescriptor(name),
  });
  const host = new DefAgentHost({
    engine: delayedEngine,
    productGateway: gateway,
    harnessManager: harness,
    toolRegistry: tools,
    requireConsumer: () => { consumers.requireActive(); },
  });
  const session = await host.createSession({
    binding: binding(),
    providerProfileRef: 'fake-profile',
  });
  baseEngine.enqueueScript([{ type: 'complete' }]);
  return {
    host,
    harness,
    session,
    consumers,
    owner,
    registration,
    handleReady,
    releaseStart,
    engineAbortCodes,
    getStartingDefTurnId: () => startingDefTurnId,
  };
}

const owner = claims('phase3-owner');
const registration = {
  consumerId: 'consumer-phase3',
  executorLeaseId: 'lease-phase3',
  writer: true as const,
  visible: true as const,
  binding: binding(),
};
const consumers = new BrowserConsumerRegistry();
consumers.register(owner, registration);
const gateway = new RemoteBrowserProductGateway(consumers);
gateway.publishSnapshot(owner, {
  consumerId: registration.consumerId,
  executorLeaseId: registration.executorLeaseId,
  snapshot: snapshot(),
});
let gatewaySnapshotReads = 0;
const countedGateway: ProductGateway<Phase2ProductOperationSchema> = {
  async getSnapshot(expected) {
    gatewaySnapshotReads += 1;
    return gateway.getSnapshot(expected);
  },
  dispatch: (command) => gateway.dispatch(command),
  awaitResult: (commandId, options) => gateway.awaitResult(commandId, options),
  reconcile: (commandId) => gateway.reconcile(commandId),
};
const engine = new DeterministicFakeAgentEngine();
const tools = new DefReadToolRegistry();
const harness = new DefHarnessManager({
  resolveToolDescriptor: (name) => tools.resolveDescriptor(name),
});
const host = new DefAgentHost({
  engine,
  productGateway: countedGateway,
  harnessManager: harness,
  toolRegistry: tools,
  requireConsumer: () => { consumers.requireActive(); },
});
const session = await host.createSession({
  binding: binding(),
  providerProfileRef: 'fake-profile',
});
assert.equal(session.harness.revision, harness.catalogRevision);

for (const [caseIndex, parity] of PHASE3_READONLY_PARITY_CASES.entries()) {
  let projectionRevision = 1;
  const steps: FakeEngineScriptStep[] = [
    {
      type: 'tool',
      toolCallId: asToolCallId(`route-${caseIndex}`),
      name: 'def.harness.route',
      input: { businessId: parity.businessId, operation: parity.operation },
    },
    { type: 'projection', revision: ++projectionRevision },
  ];
  for (const [toolIndex, toolName] of parity.toolSequence.entries()) {
    steps.push({
      type: 'tool',
      toolCallId: asToolCallId(`business-${caseIndex}-${toolIndex}`),
      name: toolName,
      input: toolInput(toolName),
    });
    steps.push({ type: 'projection', revision: ++projectionRevision });
  }
  steps.push({ type: 'complete', output: { businessId: parity.businessId } });
  engine.enqueueScript(steps);

  const turn = await host.startHarnessTurn({
    defSessionId: session.defSessionId,
    userMessage: `检查 ${parity.businessId}`,
  });
  const terminal = await host.waitForTurnTerminal(turn.defTurnId);
  assert.equal(terminal.type, 'turn.completed');

  const trace = engine.getTurnTrace({
    session: session.engine,
    turnId: asEngineTurnId(`fake-turn-${caseIndex + 1}`),
  });
  assert.ok(trace);
  assert.deepEqual(trace.input.toolProjection.tools.map((tool) => tool.name), ['def.harness.route']);
  assert.equal(trace.input.systemContext.includes('OpenCode'), false);
  assert.equal(trace.input.systemContext.includes('Pi'), false);
  assert.deepEqual(
    trace.toolProjections.map((projection) => projection.tools.map((tool) => tool.name)),
    [
      [parity.toolSequence[0]],
      ...parity.toolSequence.slice(1).map((toolName) => [toolName]),
      [],
    ],
  );
  assert.equal(trace.toolResults.length, parity.toolSequence.length + 1);
  const routeResult = trace.toolResults[0];
  assert.equal(routeResult?.status, 'succeeded');
  if (routeResult?.status === 'succeeded') {
    assert.deepEqual(routeResult.result, {
      contract: 'DefHarnessRouteResultV1',
      businessId: parity.businessId,
      operation: parity.operation,
      revision: harness.listRevisions().find((entry) => entry.businessId === parity.businessId)?.revision,
      sourceLineage: parity.sourceLineage,
      contentHash: harness.listRevisions().find((entry) => entry.businessId === parity.businessId)?.contentHash,
      phaseId: parity.businessId === 'calculation' ? 'bind-scheme'
        : parity.businessId === 'loadout' ? 'read-loadouts'
          : parity.businessId === 'buff' ? 'resolve-buff'
            : 'read-current',
    });
  }
  for (const [toolIndex, toolName] of parity.toolSequence.entries()) {
    const toolResult: EngineToolResultInput | undefined = trace.toolResults[toolIndex + 1];
    assert.equal(toolResult?.status, 'succeeded');
    if (toolResult?.status === 'succeeded') {
      const expected = expectedResult(toolName);
      if (toolName === 'def.node.crud.current') {
        const actual = toolResult.result as JsonObject;
        const legacyProjection = {
          ...actual,
          buttons: (actual.buttons as JsonObject[]).map((button) => ({
            id: button.id,
            characterId: button.characterId,
            characterName: button.characterName,
            skillType: button.skillType,
            runtimeSkillId: button.runtimeSkillId,
            skillDisplayName: button.skillDisplayName,
            staffIndex: button.staffIndex,
            lineIndex: button.lineIndex,
            persistenceStaffIndex: button.persistenceStaffIndex,
            persistenceNodeIndex: button.persistenceNodeIndex,
            selectedBuffCount: button.selectedBuffCount,
          })),
        };
        assert.deepEqual(legacyProjection, expected);
      } else if (toolName === 'def.data.resource.buff') {
        const actual = toolResult.result as JsonObject;
        const legacyProjection = {
          ...actual,
          candidates: (actual.candidates as JsonObject[]).map((candidate) => ({
            id: candidate.id,
            label: candidate.label,
            type: candidate.type,
            value: candidate.value,
            sourceKinds: candidate.sourceKinds,
            sourceLabels: candidate.sourceLabels,
            buttonIds: candidate.buttonIds,
            characterIds: candidate.characterIds,
          })),
        };
        assert.deepEqual(legacyProjection, expected);
      } else {
        assert.deepEqual(toolResult.result, expected);
      }
    }
  }

  const events = turnEvents(host.readEvents(session.defSessionId), turn.defTurnId);
  assert.deepEqual(
    events.filter((event) => event.type === 'harness.routed').map((event) => event.payload.sourceLineage),
    [parity.sourceLineage],
  );
  assert.deepEqual(
    events.filter((event) => event.type === 'harness.tool.projected').map((event) => event.payload.projectionRevision),
    Array.from({ length: parity.toolSequence.length + 2 }, (_, index) => index + 1),
  );
  const harnessTerminal = [...events].reverse().find((event) => event.type === 'harness.terminal');
  assert.equal(harnessTerminal?.type, 'harness.terminal');
  if (harnessTerminal?.type === 'harness.terminal') {
    assert.equal(harnessTerminal.payload.terminalState, 'completed');
  }
  assert.equal(events.at(-1)?.type, 'turn.completed');
}

// A registered but out-of-phase Tool is rejected before it can read ProductGateway.
const readsBeforeOutOfPhaseTool = gatewaySnapshotReads;
engine.enqueueScript([
  {
    type: 'tool',
    toolCallId: asToolCallId('route-illegal'),
    name: 'def.harness.route',
    input: { businessId: 'selection', operation: 'inspect' },
  },
  { type: 'projection', revision: 2 },
  {
    type: 'tool',
    toolCallId: asToolCallId('tool-illegal'),
    name: 'def.data.resource.damage',
    input: {},
  },
  { type: 'projection', revision: 3 },
  { type: 'complete' },
]);
const illegalTurn = await host.startHarnessTurn({
  defSessionId: session.defSessionId,
  userMessage: '尝试写入',
});
const illegalTerminal = await host.waitForTurnTerminal(illegalTurn.defTurnId);
assert.equal(illegalTerminal.type, 'turn.failed');
if (illegalTerminal.type === 'turn.failed') assert.equal(illegalTerminal.payload.code, 'HARNESS_ABORTED');
const illegalEvents = turnEvents(host.readEvents(session.defSessionId), illegalTurn.defTurnId);
const illegalToolError = illegalEvents.find((event) => event.type === 'tool.error');
assert.equal(illegalToolError?.type, 'tool.error');
if (illegalToolError?.type === 'tool.error') {
  assert.equal(illegalToolError.payload.code, 'HARNESS_TOOL_NOT_PROJECTED');
}
assert.equal(gatewaySnapshotReads, readsBeforeOutOfPhaseTool);

// A Browser snapshot that advanced beyond the Session binding fails closed.
const advancedBinding = binding({
  checkoutUpdatedAt: 31,
  contentRevision: 31,
  snapshotDigest: 'sha256:phase3-snapshot-31',
});
consumers.heartbeat(owner, { ...registration, binding: advancedBinding });
gateway.publishSnapshot(owner, {
  consumerId: registration.consumerId,
  executorLeaseId: registration.executorLeaseId,
  snapshot: snapshot(advancedBinding),
});
engine.enqueueScript([
  {
    type: 'tool',
    toolCallId: asToolCallId('route-stale'),
    name: 'def.harness.route',
    input: { businessId: 'selection', operation: 'inspect' },
  },
  { type: 'projection', revision: 2 },
  {
    type: 'tool',
    toolCallId: asToolCallId('tool-stale'),
    name: 'def.node.crud.context',
    input: {},
  },
  { type: 'projection', revision: 3 },
  { type: 'complete' },
]);
const staleTurn = await host.startHarnessTurn({
  defSessionId: session.defSessionId,
  userMessage: '读取旧绑定',
});
assert.equal((await host.waitForTurnTerminal(staleTurn.defTurnId)).type, 'turn.failed');
const staleError = turnEvents(host.readEvents(session.defSessionId), staleTurn.defTurnId)
  .find((event) => event.type === 'tool.error');
assert.equal(staleError?.type, 'tool.error');
if (staleError?.type === 'tool.error') assert.equal(staleError.payload.code, 'AGENT_BINDING_CONFLICT');
await host.shutdown();

// Consumer loss aborts both the Engine Turn and its pinned Harness transaction.
{
  let lossHost!: DefAgentHost;
  const lossOwner = claims('phase3-loss-owner');
  const lossConsumers = new BrowserConsumerRegistry({
    onConsumerLost: () => {
      const active = lossHost.getActiveIds().defTurnId;
      if (active) void lossHost.abortTurn(active, 'BROWSER_CONSUMER_LOST');
    },
  });
  const lossRegistration = {
    consumerId: 'consumer-loss',
    executorLeaseId: 'lease-loss',
    writer: true as const,
    visible: true as const,
    binding: binding(),
  };
  lossConsumers.register(lossOwner, lossRegistration);
  const lossGateway = new RemoteBrowserProductGateway(lossConsumers);
  lossGateway.publishSnapshot(lossOwner, {
    consumerId: lossRegistration.consumerId,
    executorLeaseId: lossRegistration.executorLeaseId,
    snapshot: snapshot(),
  });
  const lossEngine = new DeterministicFakeAgentEngine();
  const lossTools = new DefReadToolRegistry();
  const lossHarness = new DefHarnessManager({
    resolveToolDescriptor: (name) => lossTools.resolveDescriptor(name),
  });
  lossHost = new DefAgentHost({
    engine: lossEngine,
    productGateway: lossGateway,
    harnessManager: lossHarness,
    toolRegistry: lossTools,
    requireConsumer: () => { lossConsumers.requireActive(); },
  });
  const lossSession = await lossHost.createSession({
    binding: binding(),
    providerProfileRef: 'fake-profile',
  });
  const interactionId = asInteractionId('phase3-loss-wait');
  lossEngine.enqueueScript([
    {
      type: 'tool',
      toolCallId: asToolCallId('route-loss'),
      name: 'def.harness.route',
      input: { businessId: 'timeline', operation: 'current' },
    },
    { type: 'projection', revision: 2 },
    {
      type: 'interaction',
      interactionId,
      interactionKind: 'question',
      prompt: '等待浏览器',
    },
  ]);
  const lossTurn = await lossHost.startHarnessTurn({
    defSessionId: lossSession.defSessionId,
    userMessage: '等待后断开',
  });
  await waitFor(
    () => turnEvents(lossHost.readEvents(lossSession.defSessionId), lossTurn.defTurnId)
      .some((event) => event.type === 'interaction.requested'),
    'Harness Turn did not reach the consumer-loss fixture',
  );
  lossConsumers.close(lossOwner, lossRegistration);
  const lossTerminal = await lossHost.waitForTurnTerminal(lossTurn.defTurnId);
  assert.equal(lossTerminal.type, 'turn.stopped');
  if (lossTerminal.type === 'turn.stopped') {
    assert.equal(lossTerminal.payload.code, 'BROWSER_CONSUMER_LOST');
  }
  const lossEvents = turnEvents(lossHost.readEvents(lossSession.defSessionId), lossTurn.defTurnId);
  const lossHarnessTerminal = lossEvents.find((event) => event.type === 'harness.terminal');
  assert.equal(lossHarnessTerminal?.type, 'harness.terminal');
  if (lossHarnessTerminal?.type === 'harness.terminal') {
    assert.equal(lossHarnessTerminal.payload.terminalState, 'aborted');
    assert.equal(lossHarnessTerminal.payload.code, 'BROWSER_CONSUMER_LOST');
  }
  await lossHost.shutdown();
}

// A slow Engine start reserves the single-Turn slot before an Engine handle exists.
{
  const startOwner = claims('phase3-start-owner');
  let startHost!: DefAgentHost;
  const startConsumers = new BrowserConsumerRegistry({
    onConsumerLost: () => {
      const turnId = startHost.getActiveIds().defTurnId;
      if (turnId) void startHost.abortTurn(turnId, 'BROWSER_CONSUMER_LOST');
    },
  });
  const startRegistration = {
    consumerId: 'consumer-start',
    executorLeaseId: 'lease-start',
    writer: true as const,
    visible: true as const,
    binding: binding(),
  };
  startConsumers.register(startOwner, startRegistration);
  const startGateway = new RemoteBrowserProductGateway(startConsumers);
  startGateway.publishSnapshot(startOwner, {
    consumerId: startRegistration.consumerId,
    executorLeaseId: startRegistration.executorLeaseId,
    snapshot: snapshot(),
  });
  const baseEngine = new DeterministicFakeAgentEngine();
  let releaseStart!: () => void;
  const startGate = new Promise<void>((resolve) => { releaseStart = resolve; });
  let startingDefTurnId: string | null = null;
  const startAbortCodes: string[] = [];
  const delayedEngine: AgentEngine = {
    kind: baseEngine.kind,
    probe: () => baseEngine.probe(),
    createSession: (input) => baseEngine.createSession(input),
    recoverSession: (ref) => baseEngine.recoverSession(ref),
    startTurn: async (input) => {
      startingDefTurnId = input.defTurnId;
      await startGate;
      const handle = await baseEngine.startTurn(input);
      return {
        ref: handle.ref,
        events: handle.events,
        submitToolResult: (result) => handle.submitToolResult(result),
        submitToolResultAndUpdateProjection: (result, projection) => (
          handle.submitToolResultAndUpdateProjection(result, projection)
        ),
        submitInteractionResult: (result) => handle.submitInteractionResult(result),
        updateToolProjection: (projection) => handle.updateToolProjection(projection),
        abort: async (reason) => {
          startAbortCodes.push(reason.code);
          return handle.abort(reason);
        },
      };
    },
    compact: (ref) => baseEngine.compact(ref),
    disposeSession: (ref) => baseEngine.disposeSession(ref),
    shutdown: () => baseEngine.shutdown(),
  };
  const startTools = new DefReadToolRegistry();
  const startHarness = new DefHarnessManager({
    resolveToolDescriptor: (name) => startTools.resolveDescriptor(name),
  });
  startHost = new DefAgentHost({
    engine: delayedEngine,
    productGateway: startGateway,
    harnessManager: startHarness,
    toolRegistry: startTools,
    requireConsumer: () => { startConsumers.requireActive(); },
  });
  const startSession = await startHost.createSession({
    binding: binding(),
    providerProfileRef: 'fake-profile',
  });
  baseEngine.enqueueScript([{ type: 'complete' }]);
  const firstStart = startHost.startHarnessTurn({
    defSessionId: startSession.defSessionId,
    userMessage: '慢启动',
  });
  await assert.rejects(
    () => startHost.startHarnessTurn({
      defSessionId: startSession.defSessionId,
      userMessage: '并发启动',
    }),
    (error: unknown) => error instanceof DefAgentHostError && error.code === 'AGENT_TURN_BUSY',
  );
  startConsumers.close(startOwner, startRegistration);
  releaseStart();
  await assert.rejects(
    firstStart,
    (error: unknown) => (
      error instanceof DefAgentHostError && error.code === 'AGENT_CONSUMER_REQUIRED'
    ),
  );
  assert.equal(
    startHost.readEvents(startSession.defSessionId).some((event) => event.type === 'turn.accepted'),
    false,
    'a Turn cancelled during Engine startup must never be accepted into the Event Journal',
  );
  assert.deepEqual(startAbortCodes, ['BROWSER_CONSUMER_LOST']);
  assert.ok(startingDefTurnId);
  const cancelledTransactionId = `harness:${startingDefTurnId}`;
  const cancelledTransaction = startHarness.getTransaction(cancelledTransactionId);
  assert.equal(cancelledTransaction.status, 'aborted');
  assert.equal(cancelledTransaction.terminalState, 'aborted');
  const cancelledHarnessTerminal = startHarness.getTrace(cancelledTransactionId)
    .find((entry) => entry.type === 'harness.terminal');
  assert.equal(cancelledHarnessTerminal?.type, 'harness.terminal');
  if (cancelledHarnessTerminal?.type === 'harness.terminal') {
    assert.equal(cancelledHarnessTerminal.code, 'BROWSER_CONSUMER_LOST');
  }

  startConsumers.register(startOwner, startRegistration);
  startGateway.publishSnapshot(startOwner, {
    consumerId: startRegistration.consumerId,
    executorLeaseId: startRegistration.executorLeaseId,
    snapshot: snapshot(),
  });
  baseEngine.enqueueScript([{ type: 'complete' }]);
  const startedTurn = await startHost.startHarnessTurn({
    defSessionId: startSession.defSessionId,
    userMessage: '取消后重新启动',
  });
  const earlyTerminal = await startHost.waitForTurnTerminal(startedTurn.defTurnId);
  assert.equal(earlyTerminal.type, 'turn.failed');
  if (earlyTerminal.type === 'turn.failed') assert.equal(earlyTerminal.payload.code, 'HARNESS_INCOMPLETE');
  await startHost.shutdown();
}

// Explicit cancellation during Engine startup is not misreported as consumer loss.
{
  const fixture = await delayedStartingTurnFixture('explicit-start-stop');
  const startingPromise = fixture.host.startHarnessTurn({
    defSessionId: fixture.session.defSessionId,
    userMessage: '启动中手动停止',
  });
  await fixture.handleReady;
  const startingTurnId = fixture.getStartingDefTurnId();
  assert.ok(startingTurnId);
  await fixture.host.abortTurn(startingTurnId, 'USER_STOPPED');
  fixture.releaseStart();
  await assert.rejects(
    startingPromise,
    (error: unknown) => (
      error instanceof DefAgentHostError
      && error.code === 'AGENT_TURN_START_CANCELLED'
      && error.message.includes('USER_STOPPED')
    ),
  );
  assert.deepEqual(fixture.engineAbortCodes, ['USER_STOPPED']);
  const transactionId = `harness:${startingTurnId}`;
  assert.equal(fixture.harness.getTransaction(transactionId).terminalState, 'aborted');
  const terminal = fixture.harness.getTrace(transactionId)
    .find((entry) => entry.type === 'harness.terminal');
  assert.equal(terminal?.type, 'harness.terminal');
  if (terminal?.type === 'harness.terminal') assert.equal(terminal.code, 'USER_STOPPED');
  await fixture.host.shutdown();
}

// The first cancellation reason remains authoritative if the consumer is also lost before Engine start resolves.
{
  const fixture = await delayedStartingTurnFixture('explicit-stop-then-consumer-loss');
  const startingPromise = fixture.host.startHarnessTurn({
    defSessionId: fixture.session.defSessionId,
    userMessage: '先手动停止再关闭 consumer',
  });
  await fixture.handleReady;
  const startingTurnId = fixture.getStartingDefTurnId();
  assert.ok(startingTurnId);
  await fixture.host.abortTurn(startingTurnId, 'USER_STOPPED');
  fixture.consumers.close(fixture.owner, fixture.registration);
  fixture.releaseStart();
  await assert.rejects(
    startingPromise,
    (error: unknown) => (
      error instanceof DefAgentHostError
      && error.code === 'AGENT_TURN_START_CANCELLED'
      && error.message.includes('USER_STOPPED')
    ),
  );
  assert.deepEqual(fixture.engineAbortCodes, ['USER_STOPPED']);
  const transactionId = `harness:${startingTurnId}`;
  const terminal = fixture.harness.getTrace(transactionId)
    .find((entry) => entry.type === 'harness.terminal');
  assert.equal(terminal?.type, 'harness.terminal');
  if (terminal?.type === 'harness.terminal') assert.equal(terminal.code, 'USER_STOPPED');
  await fixture.host.shutdown();
}

// Host shutdown also cancels a Turn whose Engine handle has not reached the Host yet.
{
  const fixture = await delayedStartingTurnFixture('shutdown-during-start');
  const startingPromise = fixture.host.startHarnessTurn({
    defSessionId: fixture.session.defSessionId,
    userMessage: '启动中关闭 Host',
  });
  await fixture.handleReady;
  const startingTurnId = fixture.getStartingDefTurnId();
  assert.ok(startingTurnId);
  await fixture.host.shutdown();
  fixture.releaseStart();
  await assert.rejects(
    startingPromise,
    (error: unknown) => (
      error instanceof DefAgentHostError
      && error.code === 'AGENT_TURN_START_CANCELLED'
      && error.message.includes('HOST_SHUTDOWN')
    ),
  );
  assert.deepEqual(fixture.engineAbortCodes, ['HOST_SHUTDOWN']);
  assert.equal(
    fixture.host.readEvents(fixture.session.defSessionId)
      .some((event) => event.type === 'turn.accepted'),
    false,
  );
  const transactionId = `harness:${startingTurnId}`;
  assert.equal(fixture.harness.getTransaction(transactionId).terminalState, 'aborted');
  const terminal = fixture.harness.getTrace(transactionId)
    .find((entry) => entry.type === 'harness.terminal');
  assert.equal(terminal?.type, 'harness.terminal');
  if (terminal?.type === 'harness.terminal') assert.equal(terminal.code, 'HOST_SHUTDOWN');
}

// Abort waits for an in-flight atomic Tool commit, so the terminal journal event stays last.
{
  const raceOwner = claims('phase3-race-owner');
  const raceConsumers = new BrowserConsumerRegistry();
  const raceRegistration = {
    consumerId: 'consumer-race',
    executorLeaseId: 'lease-race',
    writer: true as const,
    visible: true as const,
    binding: binding(),
  };
  raceConsumers.register(raceOwner, raceRegistration);
  const raceGateway = new RemoteBrowserProductGateway(raceConsumers);
  raceGateway.publishSnapshot(raceOwner, {
    consumerId: raceRegistration.consumerId,
    executorLeaseId: raceRegistration.executorLeaseId,
    snapshot: snapshot(),
  });
  const baseEngine = new DeterministicFakeAgentEngine();
  let markAtomicEntered!: () => void;
  const atomicEntered = new Promise<void>((resolve) => { markAtomicEntered = resolve; });
  let releaseAtomic!: () => void;
  const atomicGate = new Promise<void>((resolve) => { releaseAtomic = resolve; });
  const raceEngine: AgentEngine = {
    kind: baseEngine.kind,
    probe: () => baseEngine.probe(),
    createSession: (input) => baseEngine.createSession(input),
    recoverSession: (ref) => baseEngine.recoverSession(ref),
    startTurn: async (input) => {
      const handle = await baseEngine.startTurn(input);
      return {
        ref: handle.ref,
        events: handle.events,
        submitToolResult: (result) => handle.submitToolResult(result),
        submitToolResultAndUpdateProjection: async (result, projection) => {
          await handle.submitToolResultAndUpdateProjection(result, projection);
          markAtomicEntered();
          await atomicGate;
        },
        submitInteractionResult: (result) => handle.submitInteractionResult(result),
        updateToolProjection: (projection) => handle.updateToolProjection(projection),
        abort: (reason) => handle.abort(reason),
      };
    },
    compact: (ref) => baseEngine.compact(ref),
    disposeSession: (ref) => baseEngine.disposeSession(ref),
    shutdown: () => baseEngine.shutdown(),
  };
  const raceTools = new DefReadToolRegistry();
  const raceHarness = new DefHarnessManager({
    resolveToolDescriptor: (name) => raceTools.resolveDescriptor(name),
  });
  const raceHost = new DefAgentHost({
    engine: raceEngine,
    productGateway: raceGateway,
    harnessManager: raceHarness,
    toolRegistry: raceTools,
    requireConsumer: () => { raceConsumers.requireActive(); },
  });
  const raceSession = await raceHost.createSession({
    binding: binding(),
    providerProfileRef: 'fake-profile',
  });
  baseEngine.enqueueScript([
    {
      type: 'tool',
      toolCallId: asToolCallId('route-abort-race'),
      name: 'def.harness.route',
      input: { businessId: 'selection', operation: 'inspect' },
    },
    { type: 'projection', revision: 2 },
    {
      type: 'interaction',
      interactionId: asInteractionId('abort-race-wait'),
      interactionKind: 'question',
      prompt: 'wait after atomic route',
    },
  ]);
  const raceTurn = await raceHost.startHarnessTurn({
    defSessionId: raceSession.defSessionId,
    userMessage: '原子提交时停止',
  });
  await atomicEntered;
  const abortPromise = raceHost.abortTurn(raceTurn.defTurnId, 'RACE_STOPPED');
  releaseAtomic();
  await abortPromise;
  const raceTerminal = await raceHost.waitForTurnTerminal(raceTurn.defTurnId);
  assert.equal(raceTerminal.type, 'turn.stopped');
  const events = turnEvents(raceHost.readEvents(raceSession.defSessionId), raceTurn.defTurnId);
  assert.equal(events.some((event) => event.type === 'tool.result'), true);
  assert.equal(events.at(-1)?.type, 'turn.stopped');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    turnEvents(raceHost.readEvents(raceSession.defSessionId), raceTurn.defTurnId).at(-1)?.type,
    'turn.stopped',
  );
  await raceHost.shutdown();
}

// Engine rejection leaves a prepared terminal transition uncommitted and aborts the live transaction.
{
  const rejectOwner = claims('phase3-reject-owner');
  const rejectConsumers = new BrowserConsumerRegistry();
  const rejectRegistration = {
    consumerId: 'consumer-reject',
    executorLeaseId: 'lease-reject',
    writer: true as const,
    visible: true as const,
    binding: binding(),
  };
  rejectConsumers.register(rejectOwner, rejectRegistration);
  const rejectGateway = new RemoteBrowserProductGateway(rejectConsumers);
  rejectGateway.publishSnapshot(rejectOwner, {
    consumerId: rejectRegistration.consumerId,
    executorLeaseId: rejectRegistration.executorLeaseId,
    snapshot: snapshot(),
  });
  const baseEngine = new DeterministicFakeAgentEngine();
  const rejectingEngine: AgentEngine = {
    kind: baseEngine.kind,
    probe: () => baseEngine.probe(),
    createSession: (input) => baseEngine.createSession(input),
    recoverSession: (ref) => baseEngine.recoverSession(ref),
    startTurn: async (input) => {
      const handle = await baseEngine.startTurn(input);
      return {
        ref: handle.ref,
        events: handle.events,
        submitToolResult: (result) => handle.submitToolResult(result),
        submitToolResultAndUpdateProjection: async (result, projection) => {
          if (projection.tools.length === 0) {
            throw new Error('fixture rejects terminal atomic projection');
          }
          await handle.submitToolResultAndUpdateProjection(result, projection);
        },
        submitInteractionResult: (result) => handle.submitInteractionResult(result),
        updateToolProjection: (projection) => handle.updateToolProjection(projection),
        abort: (reason) => handle.abort(reason),
      };
    },
    compact: (ref) => baseEngine.compact(ref),
    disposeSession: (ref) => baseEngine.disposeSession(ref),
    shutdown: () => baseEngine.shutdown(),
  };
  const rejectTools = new DefReadToolRegistry();
  const rejectHarness = new DefHarnessManager({
    resolveToolDescriptor: (name) => rejectTools.resolveDescriptor(name),
  });
  const rejectHost = new DefAgentHost({
    engine: rejectingEngine,
    productGateway: rejectGateway,
    harnessManager: rejectHarness,
    toolRegistry: rejectTools,
    requireConsumer: () => { rejectConsumers.requireActive(); },
  });
  const rejectSession = await rejectHost.createSession({
    binding: binding(),
    providerProfileRef: 'fake-profile',
  });
  baseEngine.enqueueScript([
    {
      type: 'tool',
      toolCallId: asToolCallId('route-reject'),
      name: 'def.harness.route',
      input: { businessId: 'selection', operation: 'inspect' },
    },
    { type: 'projection', revision: 2 },
    {
      type: 'tool',
      toolCallId: asToolCallId('tool-reject'),
      name: 'def.node.crud.context',
      input: {},
    },
    { type: 'projection', revision: 3 },
    { type: 'complete' },
  ]);
  const rejectTurn = await rejectHost.startHarnessTurn({
    defSessionId: rejectSession.defSessionId,
    userMessage: '拒绝原子终态',
  });
  const rejectTerminal = await rejectHost.waitForTurnTerminal(rejectTurn.defTurnId);
  assert.equal(rejectTerminal.type, 'turn.failed');
  if (rejectTerminal.type === 'turn.failed') {
    assert.equal(rejectTerminal.payload.code, 'HOST_EVENT_LOOP_FAILED');
  }
  assert.equal(rejectHarness.getTransaction(`harness:${rejectTurn.defTurnId}`).status, 'aborted');
  const events = turnEvents(rejectHost.readEvents(rejectSession.defSessionId), rejectTurn.defTurnId);
  const harnessTerminal = events.find((event) => event.type === 'harness.terminal');
  assert.equal(harnessTerminal?.type, 'harness.terminal');
  if (harnessTerminal?.type === 'harness.terminal') {
    assert.equal(harnessTerminal.payload.terminalState, 'aborted');
    assert.equal(harnessTerminal.payload.code, 'HOST_EVENT_LOOP_FAILED');
  }
  assert.equal(events.at(-1)?.type, 'turn.failed');
  await rejectHost.shutdown();
}

console.log('DEF_AGENT_HARNESS_PHASE3_BLACKBOX_OK');
