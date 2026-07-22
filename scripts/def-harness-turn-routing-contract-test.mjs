import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { classifyDefExecutableTurnPolicy, isDirectCurrentNodeQuestion, routeNativeTurnHarness } = require('../agent/runtime/def-opencode-adapter/harness-turn-router.cjs');

function spawnBunEval(source, options = {}) {
  if (process.platform === 'win32') {
    return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'bun.cmd', '-e', source], {
      encoding: 'utf8',
      ...options,
    });
  }
  return spawnSync('bun', ['-e', source], { encoding: 'utf8', ...options });
}

const binding = {
  harnessBinding: {
    selector: 'candidate/operator-config-horizontal-metadata',
    harness: { harnessId: 'def-operator-config-atomic-failfast', version: '1.1.0', contentHash: 'hash' },
  },
};

assert.equal(routeNativeTurnHarness(binding, '把赛希配件换成长息加固板').selector, 'candidate/operator-config-horizontal-metadata');
assert.equal(routeNativeTurnHarness(binding, '先开别礼战技，再释放赛希连携，最后放大招').selector, 'stable');
assert.equal(routeNativeTurnHarness(binding, '给别礼换武器，然后重新排轴').selector, 'stable');
assert.equal(routeNativeTurnHarness(binding, '查一下潮涌套的力量词条').selector, 'candidate/operator-config-horizontal-metadata');
assert.equal(routeNativeTurnHarness(binding, '查一下潮涌套的力量词条').task, 'operator-config');
assert.equal(routeNativeTurnHarness(binding, '为别礼挑选一套装备，3 潮涌+1，需要主副属性都对').selector, 'candidate/operator-config-horizontal-metadata');
assert.equal(routeNativeTurnHarness(binding, '为别礼挑选一套装备，3 潮涌+1，需要主副属性都对').task, 'operator-config');
assert.equal(routeNativeTurnHarness(binding, '给别礼换上潮涌套').selector, 'candidate/operator-config-horizontal-metadata');
assert.equal(routeNativeTurnHarness(binding, '请为刚才已校验的9按钮节点重新发出审核').selector, 'stable');
assert.equal(routeNativeTurnHarness(binding, '图腾下落-2层里的水龙卷算什么伤害').task, 'exact-skill-facts');
assert.equal(classifyDefExecutableTurnPolicy('图腾下落-2层里的水龙卷算什么伤害')?.kind, 'exact-skill-facts');
assert.equal(classifyDefExecutableTurnPolicy('这把武器的伤害倍率是多少'), null);
assert.equal(isDirectCurrentNodeQuestion('当前节点是什么？'), true);
assert.equal(isDirectCurrentNodeQuestion('请基于当前空排轴创建新节点'), false);

const serverSource = fs.readFileSync(new URL('../agent/server/def-agent-server.cjs', import.meta.url), 'utf8');
assert.match(serverSource, /getNativeHarnessSystem\(binding, rawUserText\)/);
assert.match(serverSource, /buildWorkbenchCheckoutSystemPrompt\(checkoutState/);

const workbenchPromptSource = fs.readFileSync(new URL('../agent/server/workbench-system-prompts.cjs', import.meta.url), 'utf8');
assert.match(workbenchPromptSource, /same typed-tool failure code occurs twice/);
assert.match(workbenchPromptSource, /interop pending is null/);
assert.match(workbenchPromptSource, /EXACT SKILL FACT CONTRACT/);
assert.match(workbenchPromptSource, /Call def_data_skill as the first and only tool/);

const skillSource = fs.readFileSync(new URL('../agent/runtime/def/skills/timeline-workbench/SKILL.md', import.meta.url), 'utf8');
assert.match(skillSource, /approvalPolicy=manual/);
assert.match(skillSource, /skillKey.*never a substitute/);
assert.match(skillSource, /same failure code occurs twice/);
assert.match(skillSource, /call `def_node_use` in the same turn/);

const pluginSource = fs.readFileSync(new URL('../agent/runtime/def-tools/opencode/plugin.js', import.meta.url), 'utf8');
assert.match(pluginSource, /'chat\.message'/);
assert.match(pluginSource, /beginDefToolTurn/);
assert.match(pluginSource, /'tool\.execute\.before'/);
assert.match(pluginSource, /assertDefToolTurnNotBlocked/);
assert.match(pluginSource, /assertDefNativeArtifactToolScope/);
assert.match(pluginSource, /recordDefToolEventFailure/);
assert.match(pluginSource, /event: async/);

const retryFuseProbe = spawnBunEval(`
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  mod.beginDefToolTurn('contract-session', 'contract-turn');
  const failure = (callID, tool) => ({ type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'contract-session', callID, tool, state: { status: 'error', error: 'The user has specified a rule which prevents you from using this specific tool call. external_directory' } } } });
  mod.recordDefToolEventFailure(failure('call-1', 'glob'));
  mod.assertDefToolTurnNotBlocked('contract-session', 'def_data_skill');
  mod.recordDefToolEventFailure(failure('call-2', 'read'));
  try { mod.assertDefToolTurnNotBlocked('contract-session', 'def_node_sync_validate'); process.exit(2); }
  catch (error) { if (error?.code !== 'def-tool-retry-limit-reached') process.exit(3); }
`);
assert.equal(retryFuseProbe.status, 0, retryFuseProbe.stderr || retryFuseProbe.stdout);

const mutationTargetBudgetProbe = spawnBunEval(`
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  const failure = (callID, input) => ({ type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'target-session', callID, tool: 'operator_config_patch', input, state: { status: 'error', error: 'operator-config-preview-failed: temporary renderer response' } } } });
  mod.beginDefToolTurn('target-session', 'target-turn');
  mod.recordDefToolEventFailure(failure('bieli-1', { characterId: 'bieli', weaponName: '赫拉芬格' }));
  mod.recordDefToolEventFailure(failure('saixi-1', { characterId: 'saixi', weaponName: '骑士精神' }));
  mod.assertDefToolTurnNotBlocked('target-session', 'operator_config_patch');
  mod.recordDefToolEventFailure(failure('bieli-2', { characterId: 'bieli', weaponName: '赫拉芬格' }));
  try { mod.assertDefToolTurnNotBlocked('target-session', 'operator_config_patch'); process.exit(2); }
  catch (error) { if (error?.code !== 'def-tool-retry-limit-reached') process.exit(3); }
`);
assert.equal(mutationTargetBudgetProbe.status, 0, mutationTargetBudgetProbe.stderr || mutationTargetBudgetProbe.stdout);

const explicitApplyIntentProbe = spawnBunEval(`
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  mod.beginDefToolTurnFromChatMessage('intent-session', 'comparison-turn', [{ type: 'text', text: '配件二为什么不用第二个悬河供氧栓？' }]);
  if (mod.getDefOperatorConfigTurnIdentity({ sessionID: 'intent-session' }).applyIntent) process.exit(2);
  mod.beginDefToolTurnFromChatMessage('intent-session', 'apply-turn', [{ type: 'text', text: '确认。' }]);
  const intent = mod.getDefOperatorConfigTurnIdentity({ sessionID: 'intent-session' });
  if (intent.turnID !== 'apply-turn' || !intent.applyIntent) process.exit(3);
`, { env: { ...process.env, DEF_INTERNAL_GOVERNANCE_TOKEN: 'turn-intent-contract' } });
assert.equal(explicitApplyIntentProbe.status, 0, explicitApplyIntentProbe.stderr || explicitApplyIntentProbe.stdout);

const nonRetryableMutationProbe = spawnBunEval(`
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  mod.beginDefToolTurn('mutation-session', 'mutation-turn');
  mod.recordDefToolEventFailure({ type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'mutation-session', callID: 'call-1', tool: 'operator_config_patch', state: { status: 'error', error: 'operator-config-timeline-invariant-failed: typed canonical invariant rejected the preview' } } } });
  try { mod.assertDefToolTurnNotBlocked('mutation-session', 'operator_config_patch'); process.exit(2); }
  catch (error) {
    if (error?.code !== 'def-tool-mutation-not-attempted' || error?.details?.attempted !== false) process.exit(3);
  }
`);
assert.equal(nonRetryableMutationProbe.status, 0, nonRetryableMutationProbe.stderr || nonRetryableMutationProbe.stdout);

const terminalEvidenceProbe = spawnBunEval(`
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  mod.beginDefToolTurn('evidence-session', 'evidence-turn');
  mod.recordDefToolEventFailure({ type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'evidence-session', callID: 'planner-1', tool: 'def_data_weapon_fit_plan', state: { status: 'error', error: 'weapon-fit-combat-convention-incomplete: reviewed evidence is incomplete' } } } });
  try { mod.assertDefToolTurnNotBlocked('evidence-session', 'def_data_weapon'); process.exit(2); }
  catch (error) {
    if (error?.code !== 'def-tool-evidence-not-attempted' || error?.details?.attempted !== false || error?.details?.originalTool !== 'def_data_weapon_fit_plan') process.exit(3);
  }
`);
assert.equal(terminalEvidenceProbe.status, 0, terminalEvidenceProbe.stderr || terminalEvidenceProbe.stdout);

const terminalEquipmentFactsProbe = spawnBunEval(`
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  mod.beginDefToolTurn('equipment-evidence-session', 'equipment-evidence-turn');
  mod.recordDefToolEventFailure({ type: 'message.part.updated', properties: { part: { type: 'tool', sessionID: 'equipment-evidence-session', callID: 'facts-1', tool: 'def_data_equipment_3plus1_facts', state: { status: 'error', error: 'equipment-3plus1-catalog-invalid: duplicate typed identities' } } } });
  try { mod.assertDefToolTurnNotBlocked('equipment-evidence-session', 'def_data_equipment'); process.exit(2); }
  catch (error) {
    if (error?.code !== 'def-tool-evidence-not-attempted' || error?.details?.attempted !== false || error?.details?.originalTool !== 'def_data_equipment_3plus1_facts') process.exit(3);
  }
`);
assert.equal(terminalEquipmentFactsProbe.status, 0, terminalEquipmentFactsProbe.stderr || terminalEquipmentFactsProbe.stdout);

const exactSkillFactsPolicyProbe = spawnBunEval(`
  const mod = await import(${JSON.stringify(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url).href)});
  mod.beginDefToolTurnFromChatMessage('skill-session', 'skill-turn', [{ type: 'text', text: '图腾下落-2层里的水龙卷算什么伤害' }]);
  try { mod.assertDefToolTurnNotBlocked('skill-session', 'def_workbench_context', {}); process.exit(2); }
  catch (error) { if (error?.code !== 'def-tool-turn-policy-blocked' || error?.details?.attempted !== false) process.exit(3); }
  try { mod.assertDefToolTurnNotBlocked('skill-session', 'def_data_skill', { query: '图腾下落' }); process.exit(4); }
  catch (error) { if (error?.code !== 'def-tool-turn-policy-blocked') process.exit(5); }
  mod.assertDefToolTurnNotBlocked('skill-session', 'def_data_skill', { characterQuery: '汤汤', query: '图腾下落-2层' });
  try { mod.assertDefToolTurnNotBlocked('skill-session', 'def_data_skill', { characterQuery: '汤汤', query: 'skill-Q-4' }); process.exit(6); }
  catch (error) { if (error?.code !== 'def-tool-turn-policy-blocked' || error?.details?.attempts !== 1) process.exit(7); }
`);
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
assert.match(adapterSource, /EQUIPMENT EVIDENCE/);
assert.match(adapterSource, /DEF_EMPTY_ASSISTANT_RESPONSE/);
assert.match(adapterSource, /if \(!visibleContent\) throw new Error\(DEF_EMPTY_ASSISTANT_RESPONSE\)/);
assert.doesNotMatch(adapterSource, /CURRENT TURN — EXECUTABLE READ-ONLY CATALOG CONTRACT/);

const viewSource = fs.readFileSync(new URL('../src/components/def-opencode/DefOpenCodeView.tsx', import.meta.url), 'utf8');
assert.match(viewSource, /__defHarnessSelector/);
assert.match(viewSource, /harnessSelector: developmentHarnessSelector/);
assert.match(viewSource, /SIDECAR_BOOTSTRAP_URL = 'http:\/\/127\.0\.0\.1:31457\/open-def-agent'/,
  'the DEF host must start its local sidecar before calling the sidecar origin');
assert.match(viewSource, /await ensureNativeSidecar\(\);\s*const ensureResponse = await fetch\(`\$\{origin\}\/api\/runtime\/ensure`/,
  'the DEF host must await sidecar readiness before ensuring the OpenCode runtime');

console.log('DEF turn-level Harness routing contract: PASS');
