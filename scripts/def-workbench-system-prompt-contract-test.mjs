import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildWorkbenchCheckoutSystemPrompt,
  buildWorkbenchContextSystemPrompt,
} = require('../agent/server/workbench-system-prompts.cjs');

function checkoutState(phase = 'ready') {
  return {
    phase,
    current: { targetId: 'node-current' },
    axisContext: {
      nodes: [{ id: 'node-current', label: 'Current draft' }],
    },
  };
}

function promptFor(userText, phase = 'ready') {
  return buildWorkbenchCheckoutSystemPrompt(
    checkoutState(phase),
    'EXISTING SYSTEM',
    [{ type: 'text', text: userText }],
  );
}

const directCurrentNodePrompt = promptFor('当前节点是什么？');
assert.match(directCurrentNodePrompt, /DIRECT CURRENT-NODE CONTRACT/);
assert.match(directCurrentNodePrompt, /def_workbench_current_node as the only discovery tool/);
assert.doesNotMatch(directCurrentNodePrompt, /Before answering a current-canvas or current-node question/);
assert.doesNotMatch(directCurrentNodePrompt, /Before answering a current-canvas question/);
assert.match(directCurrentNodePrompt, /EXISTING SYSTEM$/);

const currentCanvasPrompt = promptFor('请基于当前空排轴创建一个新节点');
assert.match(currentCanvasPrompt, /Before answering a current-canvas question, call def_workbench_context/);
assert.doesNotMatch(currentCanvasPrompt, /DIRECT CURRENT-NODE CONTRACT/);

const changedDirectPrompt = promptFor('当前节点是什么？', 'checkout-changed');
const bindIndex = changedDirectPrompt.indexOf('HARD GATE:');
const contextIndex = changedDirectPrompt.indexOf('call def_workbench_context again', bindIndex);
const currentNodeIndex = changedDirectPrompt.indexOf('call def_workbench_current_node before replying', contextIndex);
assert(bindIndex >= 0 && contextIndex > bindIndex && currentNodeIndex > contextIndex);
assert.doesNotMatch(changedDirectPrompt, /DIRECT CURRENT-NODE CONTRACT/);

const exactSkillPrompt = promptFor('图腾下落-2层里的水龙卷算什么伤害？');
assert.match(exactSkillPrompt, /EXACT SKILL FACT CONTRACT/);
assert.match(exactSkillPrompt, /Call def_data_skill as the first and only tool/);
assert.doesNotMatch(exactSkillPrompt, /DIRECT CURRENT-NODE CONTRACT/);

const selectedContextPrompt = buildWorkbenchContextSystemPrompt({
  id: 'node-selected',
  name: 'Selected draft',
  description: 'UI selection',
}, 'HARNESS SYSTEM');
assert.match(selectedContextPrompt, /LIVE SELECTION \(supplementary system context/);
assert.match(selectedContextPrompt, /not the authoritative checkout/);
assert.match(selectedContextPrompt, /use def_workbench_current_node/);
assert.match(selectedContextPrompt, /Do not answer solely from these selection fields/);
assert.doesNotMatch(selectedContextPrompt, /answer directly from these three fields/);
assert.doesNotMatch(selectedContextPrompt, /do not call a tool merely to rediscover them/);
assert.match(selectedContextPrompt, /HARNESS SYSTEM$/);

const emptySelectionPrompt = buildWorkbenchContextSystemPrompt(null, '');
assert.match(emptySelectionPrompt, /does not prove that the authoritative checkout has no current Work Node/);
assert.doesNotMatch(emptySelectionPrompt, /State that fact plainly if the user asks for the current node/);

console.log('DEF Workbench system prompt contract: PASS');
