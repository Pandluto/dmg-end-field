import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isDirectCurrentNodeQuestion, routeNativeTurnHarness } = require('../agent/runtime/def-opencode-adapter/harness-turn-router.cjs');

const binding = {
  harnessBinding: {
    selector: 'candidate/operator-config-horizontal-metadata',
    harness: { harnessId: 'def-operator-config-atomic-failfast', version: '1.1.0', contentHash: 'hash' },
  },
};

assert.equal(routeNativeTurnHarness(binding, '把赛希配件换成长息加固板').selector, 'candidate/operator-config-horizontal-metadata');
assert.equal(routeNativeTurnHarness(binding, '先开别礼战技，再释放赛希连携，最后放大招').selector, 'stable');
assert.equal(routeNativeTurnHarness(binding, '给别礼换武器，然后重新排轴').selector, 'stable');
assert.equal(routeNativeTurnHarness(binding, '请为刚才已校验的9按钮节点重新发出审核').selector, 'stable');
assert.equal(isDirectCurrentNodeQuestion('当前节点是什么？'), true);
assert.equal(isDirectCurrentNodeQuestion('请基于当前空排轴创建新节点'), false);

const serverSource = fs.readFileSync(new URL('../agent/server/def-agent-server.cjs', import.meta.url), 'utf8');
assert.match(serverSource, /getNativeHarnessSystem\(binding, rawUserText\)/);
assert.match(serverSource, /buildWorkbenchCheckoutSystemPrompt\(checkoutState/);
assert.match(serverSource, /same typed-tool failure code occurs twice/);
assert.match(serverSource, /interop pending is null/);

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
assert.match(pluginSource, /recordDefToolEventFailure/);
assert.match(pluginSource, /event: async/);

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
const defToolSource = fs.readFileSync(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url), 'utf8');
assert.match(defToolSource, /mutationTargetFingerprint/);
assert.match(defToolSource, /def-tool-mutation-not-attempted/);

const viewSource = fs.readFileSync(new URL('../src/components/def-opencode/DefOpenCodeView.tsx', import.meta.url), 'utf8');
assert.match(viewSource, /__defHarnessSelector/);
assert.match(viewSource, /harnessSelector: developmentHarnessSelector/);

console.log('DEF turn-level Harness routing contract: PASS');
