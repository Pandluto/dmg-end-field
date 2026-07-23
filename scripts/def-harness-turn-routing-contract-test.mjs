import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  beginRoutePhase,
  classifyDefExecutableTurnPolicy,
  isDirectCurrentNodeQuestion,
} = require('../agent/runtime/def-harness-manager/router.cjs');

assert.equal(classifyDefExecutableTurnPolicy('图腾下落-2层里的水龙卷算什么伤害')?.kind, 'exact-skill-facts');
assert.equal(classifyDefExecutableTurnPolicy('这把武器的伤害倍率是多少'), null);
assert.equal(isDirectCurrentNodeQuestion('当前节点是什么？'), true);
assert.equal(isDirectCurrentNodeQuestion('请基于当前空排轴创建新节点'), false);
assert.deepEqual(
  {
    businessId: beginRoutePhase({ userText: '图腾下落-2层里的水龙卷算什么伤害' }).businessId,
    operation: beginRoutePhase({ userText: '图腾下落-2层里的水龙卷算什么伤害' }).operation,
  },
  { businessId: 'calculation', operation: 'skill_fact' },
);
assert.equal(beginRoutePhase({ userText: '给别礼换武器，然后重新排轴' }).kind, 'route-phase');
assert.equal(beginRoutePhase({ userText: '莱万汀这个配装好吗' }).operation, 'evaluate');
assert.equal(beginRoutePhase({ userText: '现在队伍里有谁' }).operation, 'inspect');
assert.equal(beginRoutePhase({ userText: '本地角色库有谁' }).operation, 'search');
assert.equal(beginRoutePhase({ userText: '工具返回给你的原始 json 是什么' }).kind, 'conversation');
assert.equal(beginRoutePhase({ userText: '会话 id 给我' }).intent, 'session-id');

const serverSource = fs.readFileSync(new URL('../agent/server/def-agent-server.cjs', import.meta.url), 'utf8');
assert.equal((serverSource.match(/prepareWorkbenchTurn\(\{/g) || []).length, 2);
assert.doesNotMatch(serverSource, /getNativeHarnessSystem/);
assert.doesNotMatch(serverSource, /buildWorkbenchCheckoutSystemPrompt/);

const managerSource = fs.readFileSync(new URL('../agent/runtime/def-harness-manager/index.cjs', import.meta.url), 'utf8');
assert.match(managerSource, /HarnessTransactionRuntime/);
assert.match(managerSource, /runtime\.prepareRoute/);
assert.match(managerSource, /runtime\.transactions\.recover/);
assert.doesNotMatch(managerSource, /getNativeHarnessSystem|composeLegacyWorkbenchSystem|legacy-compatibility/);

const pluginSource = fs.readFileSync(new URL('../agent/runtime/def-tools/opencode/plugin.js', import.meta.url), 'utf8');
assert.match(pluginSource, /'chat\.message'/);
assert.match(pluginSource, /beginDefToolTurn/);
assert.match(pluginSource, /'tool\.execute\.before'/);
assert.match(pluginSource, /assertDefToolTurnNotBlocked/);
assert.match(pluginSource, /assertDefNativeArtifactToolScope/);
assert.match(pluginSource, /recordDefToolEventFailure/);
assert.match(pluginSource, /event: async/);
assert.match(pluginSource, /'experimental\.text\.complete'/);
assert.match(pluginSource, /transformHarnessCompletedText/);

const retryFuseProbe = spawnSync('bun', ['-e', `
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  mod.beginDefToolTurn('contract-session', 'contract-turn');
  const failure = (callID, tool) => ({ type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'contract-session', callID, tool, state: { status: 'error', error: 'The user has specified a rule which prevents you from using this specific tool call. external_directory' } } } });
  mod.recordDefToolEventFailure(failure('call-1', 'glob'));
  mod.assertDefToolTurnNotBlocked('contract-session', 'def_data_skill');
  mod.recordDefToolEventFailure(failure('call-2', 'read'));
  try { mod.assertDefToolTurnNotBlocked('contract-session', 'def_node_sync_validate'); process.exit(2); }
  catch (error) { if (error?.code !== 'def-tool-retry-limit-reached') process.exit(3); }
`], { encoding: 'utf8' });
assert.equal(retryFuseProbe.status, 0, retryFuseProbe.stderr || retryFuseProbe.stdout);

const unavailableToolBudgetProbe = spawnSync('bun', ['-e', `
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  mod.beginDefToolTurn('projection-session', 'projection-turn');
  const failure = (callID, tool, available) => ({ type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'projection-session', callID, tool, state: { status: 'error', error: "Model tried to call unavailable tool 'invalid'. Available tools: " + available + "." } } } });
  mod.recordDefToolEventFailure(failure('stale-1', 'def_workbench_buttons', 'def_workbench_context'));
  mod.recordDefToolEventFailure(failure('stale-2', 'def_workbench_context', 'def_workbench_buttons'));
  mod.assertDefToolTurnNotBlocked('projection-session', 'def_workbench_buttons');
`], { encoding: 'utf8' });
assert.equal(unavailableToolBudgetProbe.status, 0, unavailableToolBudgetProbe.stderr || unavailableToolBudgetProbe.stdout);

const buttonCoordinateProbe = spawnSync('bun', ['-e', `
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  const inferred = mod.sanitizeWorkbenchButtonArgs({ nodeIndex: 1, lineIndex: 3, characterName: '赛希', skillName: '普攻' }, '请数一下当前节点上的技能按钮');
  if ('nodeIndex' in inferred || 'lineIndex' in inferred || 'characterName' in inferred || 'skillName' in inferred) process.exit(2);
  const explicit = mod.sanitizeWorkbenchButtonArgs({ nodeIndex: 99, lineIndex: 99, characterName: '赛希', skillName: '普攻' }, '查看赛希普攻 @2-4 的 BUFF');
  if (explicit.nodeIndex !== 1 || explicit.lineIndex !== 3) process.exit(3);
  if (explicit.characterName !== '赛希' || explicit.skillName !== '普攻') process.exit(4);
`], { encoding: 'utf8' });
assert.equal(buttonCoordinateProbe.status, 0, buttonCoordinateProbe.stderr || buttonCoordinateProbe.stdout);

const contextProjectionProbe = spawnSync('bun', ['-e', `
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  const value = {
    attached: { context: { axisContext: { binding: { id: 'binding' }, document: { id: 'timeline' }, checkout: { targetId: 'node' }, nodes: [{ id: 'other' }] } } },
    snapshot: {
      snapshot: {
        schemaVersion: 1,
        selectedCharacters: [{ id: 'saixi' }],
        skillCatalog: [{ id: 'skill' }],
        skillButtons: [{ id: 'button' }],
        damageReport: { totalExpected: 42 },
        operatorConfigs: [{ id: 'config' }],
      },
      axisContext: { binding: { id: 'binding' }, document: { id: 'timeline' }, checkout: { targetId: 'node' }, nodes: [{ id: 'other' }] },
    },
    checkoutTransition: { changed: false },
  };
  const timeline = mod.projectWorkbenchContextForHarness(value, 'timeline');
  if (!timeline.snapshot.snapshot.selectedCharacters || !timeline.snapshot.snapshot.skillButtons) process.exit(2);
  if ('skillCatalog' in timeline.snapshot.snapshot || 'damageReport' in timeline.snapshot.snapshot || 'operatorConfigs' in timeline.snapshot.snapshot) process.exit(3);
  if ('nodes' in timeline.snapshot.axisContext || 'nodes' in timeline.attached.context.axisContext) process.exit(4);
  const calculation = mod.projectWorkbenchContextForHarness(value, 'calculation');
  if ('selectedCharacters' in calculation.snapshot.snapshot || 'skillButtons' in calculation.snapshot.snapshot || 'damageReport' in calculation.snapshot.snapshot) process.exit(5);
`], { encoding: 'utf8' });
assert.equal(contextProjectionProbe.status, 0, contextProjectionProbe.stderr || contextProjectionProbe.stdout);

const mutationTargetBudgetProbe = spawnSync('bun', ['-e', `
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  const failure = (callID, input) => ({ type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'target-session', callID, tool: 'operator_config_patch', input, state: { status: 'error', error: 'operator-config-preview-failed: temporary renderer response' } } } });
  mod.beginDefToolTurn('target-session', 'target-turn');
  mod.recordDefToolEventFailure(failure('bieli-1', { characterId: 'bieli', weaponName: '赫拉芬格' }));
  mod.recordDefToolEventFailure(failure('saixi-1', { characterId: 'saixi', weaponName: '骑士精神' }));
  mod.assertDefToolTurnNotBlocked('target-session', 'operator_config_patch');
  mod.recordDefToolEventFailure(failure('bieli-2', { characterId: 'bieli', weaponName: '赫拉芬格' }));
  try { mod.assertDefToolTurnNotBlocked('target-session', 'operator_config_patch'); process.exit(2); }
  catch (error) { if (error?.code !== 'def-tool-retry-limit-reached') process.exit(3); }
`], { encoding: 'utf8' });
assert.equal(mutationTargetBudgetProbe.status, 0, mutationTargetBudgetProbe.stderr || mutationTargetBudgetProbe.stdout);

const explicitApplyIntentProbe = spawnSync('bun', ['-e', `
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  mod.beginDefToolTurnFromChatMessage('intent-session', 'comparison-turn', [{ type: 'text', text: '配件二为什么不用第二个悬河供氧栓？' }]);
  if (mod.getDefOperatorConfigTurnIdentity({ sessionID: 'intent-session' }).applyIntent) process.exit(2);
  mod.beginDefToolTurnFromChatMessage('intent-session', 'apply-turn', [{ type: 'text', text: '确认。' }]);
  const intent = mod.getDefOperatorConfigTurnIdentity({ sessionID: 'intent-session' });
  if (intent.turnID !== 'apply-turn' || !intent.applyIntent) process.exit(3);
`], { encoding: 'utf8', env: { ...process.env, DEF_INTERNAL_GOVERNANCE_TOKEN: 'turn-intent-contract' } });
assert.equal(explicitApplyIntentProbe.status, 0, explicitApplyIntentProbe.stderr || explicitApplyIntentProbe.stdout);

const nonRetryableMutationProbe = spawnSync('bun', ['-e', `
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  mod.beginDefToolTurn('mutation-session', 'mutation-turn');
  mod.recordDefToolEventFailure({ type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'mutation-session', callID: 'call-1', tool: 'operator_config_patch', state: { status: 'error', error: 'operator-config-timeline-invariant-failed: typed canonical invariant rejected the preview' } } } });
  try { mod.assertDefToolTurnNotBlocked('mutation-session', 'operator_config_patch'); process.exit(2); }
  catch (error) {
    if (error?.code !== 'def-tool-mutation-not-attempted' || error?.details?.attempted !== false) process.exit(3);
  }
`], { encoding: 'utf8' });
assert.equal(nonRetryableMutationProbe.status, 0, nonRetryableMutationProbe.stderr || nonRetryableMutationProbe.stdout);

const terminalEvidenceProbe = spawnSync('bun', ['-e', `
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  mod.beginDefToolTurn('evidence-session', 'evidence-turn');
  mod.recordDefToolEventFailure({ type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'evidence-session', callID: 'planner-1', tool: 'def_data_weapon_fit_plan', state: { status: 'error', error: 'weapon-fit-combat-convention-incomplete: reviewed evidence is incomplete' } } } });
  try { mod.assertDefToolTurnNotBlocked('evidence-session', 'def_data_weapon'); process.exit(2); }
  catch (error) {
    if (error?.code !== 'def-tool-evidence-not-attempted' || error?.details?.attempted !== false || error?.details?.originalTool !== 'def_data_weapon_fit_plan') process.exit(3);
  }
`], { encoding: 'utf8' });
assert.equal(terminalEvidenceProbe.status, 0, terminalEvidenceProbe.stderr || terminalEvidenceProbe.stdout);

const terminalEquipmentFactsProbe = spawnSync('bun', ['-e', `
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  mod.beginDefToolTurn('equipment-evidence-session', 'equipment-evidence-turn');
  mod.recordDefToolEventFailure({ type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'equipment-evidence-session', callID: 'facts-1', tool: 'def_data_equipment_3plus1_facts', state: { status: 'error', error: 'equipment-3plus1-catalog-invalid: duplicate typed identities' } } } });
  try { mod.assertDefToolTurnNotBlocked('equipment-evidence-session', 'def_data_equipment'); process.exit(2); }
  catch (error) {
    if (error?.code !== 'def-tool-evidence-not-attempted' || error?.details?.attempted !== false || error?.details?.originalTool !== 'def_data_equipment_3plus1_facts') process.exit(3);
  }
`], { encoding: 'utf8' });
assert.equal(terminalEquipmentFactsProbe.status, 0, terminalEquipmentFactsProbe.stderr || terminalEquipmentFactsProbe.stdout);

const exactSkillFactsPolicyProbe = spawnSync('bun', ['-e', `
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  mod.beginDefToolTurnFromChatMessage('skill-session', 'skill-turn', [{ type: 'text', text: '图腾下落-2层里的水龙卷算什么伤害' }]);
  try { mod.assertDefToolTurnNotBlocked('skill-session', 'def_workbench_context', {}); process.exit(2); }
  catch (error) { if (error?.code !== 'def-tool-turn-policy-blocked' || error?.details?.attempted !== false) process.exit(3); }
  try { mod.assertDefToolTurnNotBlocked('skill-session', 'def_data_skill', { query: '图腾下落' }); process.exit(4); }
  catch (error) { if (error?.code !== 'def-tool-turn-policy-blocked') process.exit(5); }
  mod.assertDefToolTurnNotBlocked('skill-session', 'def_data_skill', { characterQuery: '汤汤', query: '图腾下落-2层' });
  try { mod.assertDefToolTurnNotBlocked('skill-session', 'def_data_skill', { characterQuery: '汤汤', query: 'skill-Q-4' }); process.exit(6); }
  catch (error) { if (error?.code !== 'def-tool-turn-policy-blocked' || error?.details?.attempts !== 1) process.exit(7); }
`], { encoding: 'utf8' });
assert.equal(exactSkillFactsPolicyProbe.status, 0, exactSkillFactsPolicyProbe.stderr || exactSkillFactsPolicyProbe.stdout);
const defToolSource = fs.readFileSync(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url), 'utf8');
assert.match(defToolSource, /mutationTargetFingerprint/);
assert.match(defToolSource, /def-tool-mutation-not-attempted/);
assert.match(defToolSource, /def-tool-evidence-not-attempted/);
assert.match(defToolSource, /exact-skill-facts/);
assert.match(defToolSource, /denied-native-catalog-artifact-scope/);
assert.match(defToolSource, /hasExplicitOperatorConfigApplyIntent/);
assert.doesNotMatch(defToolSource, /catalog-readonly-/);

const nativeServerSource = fs.readFileSync(new URL('../agent/server/def-agent-server.cjs', import.meta.url), 'utf8');
assert.match(nativeServerSource, /registerNativeCatalogSession/);
assert.match(nativeServerSource, /def\.native_catalog\.register_session/);

const restServerSource = fs.readFileSync(new URL('../scripts/ai-cli-rest-server.mjs', import.meta.url), 'utf8');
assert.match(restServerSource, /restoreRegisteredDefNativeCatalogSession/);
assert.match(restServerSource, /getSessionAxisBindingBySession\('workbench', sessionId\)/);

const adapterSource = fs.readFileSync(new URL('../agent/runtime/def-opencode-adapter/index.cjs', import.meta.url), 'utf8');
assert.match(adapterSource, /return MINIMAL_WORKBENCH_AGENT_PROMPT/);
assert.doesNotMatch(
  adapterSource,
  /timeline-workbench|resolveNativeHarness|composeHarnessSystem|retired-workbench-legacy-prompt|Tree-bound execution/,
);
assert.match(adapterSource, /DEF_EMPTY_ASSISTANT_RESPONSE/);
assert.match(adapterSource, /if \(!visibleContent\) throw new Error\(DEF_EMPTY_ASSISTANT_RESPONSE\)/);
assert.doesNotMatch(adapterSource, /CURRENT TURN — EXECUTABLE READ-ONLY CATALOG CONTRACT/);

const viewSource = fs.readFileSync(new URL('../src/components/def-opencode/DefOpenCodeView.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(viewSource, /__defHarnessSelector|harnessSelector/);
assert.match(viewSource, /SIDECAR_BOOTSTRAP_URL = 'http:\/\/127\.0\.0\.1:31457\/open-def-agent'/,
  'the DEF host must start its local sidecar before calling the sidecar origin');
assert.match(viewSource, /await ensureNativeSidecar\(\);\s*const ensureResponse = await fetch\(`\$\{origin\}\/api\/runtime\/ensure`/,
  'the DEF host must await sidecar readiness before ensuring the OpenCode runtime');

console.log('DEF turn-level Harness routing contract: PASS');
