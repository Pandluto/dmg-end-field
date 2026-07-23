import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  DEF_NATIVE_TARGETS,
  DEF_TOOL_LOCAL_CONTRACTS,
  getDefToolLocalContract,
} from '../agent/runtime/def-tools/registry.mjs';

const require = createRequire(import.meta.url);
const {
  MINIMAL_WORKBENCH_AGENT_PROMPT,
  buildHostKernelContext,
  renderHostKernelSystem,
} = require('../agent/runtime/def-harness-manager/host-kernel.cjs');

assert.match(MINIMAL_WORKBENCH_AGENT_PROMPT, /Harness Manager/);
assert.match(MINIMAL_WORKBENCH_AGENT_PROMPT, /typed Tool results/);
assert.doesNotMatch(MINIMAL_WORKBENCH_AGENT_PROMPT, /3\+1|潮涌|def_data_|def_node_|guide-first|selectedBuff/i);

const host = buildHostKernelContext({
  binding: { sessionID: 'session-a', timelineId: 'timeline-a', axisBindingId: 'axis-a' },
  axisContext: { document: { id: 'timeline-a' }, projection: { ready: false } },
  checkoutState: {
    phase: 'checkout-changed',
    current: { targetType: 'work-node', targetId: 'node-b' },
    previous: { targetType: 'work-node', targetId: 'node-a' },
  },
  workbenchContext: { id: 'node-b', name: '候选 B', description: '' },
});
assert.deepEqual(host.gates, ['checkout-rebind-required', 'projection-not-converged']);
assert.equal(host.identity.sessionId, 'session-a');
assert.equal(host.checkout.current.targetId, 'node-b');
assert.match(renderHostKernelSystem(host), /HOST FACTS/);
assert.doesNotMatch(renderHostKernelSystem(host), /must be first|下一步|最终回复/i);

assert.equal(Object.keys(DEF_TOOL_LOCAL_CONTRACTS).length, DEF_NATIVE_TARGETS.length);
for (const target of DEF_NATIVE_TARGETS) {
  const contract = getDefToolLocalContract(target.id);
  assert(contract, target.id);
  assert.equal(contract.id, target.id);
  assert.equal(contract.binding, target.nativeBinding);
  assert(contract.input);
  assert(contract.result);
  assert(contract.sideEffect);
  assert(contract.capabilitySource);
  assert(contract.typedErrors.length > 0);
  assert.doesNotMatch(`${contract.purpose}\n${contract.input}\n${contract.result}`, /must be first|call .* next|final answer/i);
}

assert.equal(getDefToolLocalContract('def.operator.config.preview').sideEffect, 'proposal-only');
assert.match(getDefToolLocalContract('def.operator.config.patch').capabilitySource, /proposal token/);
assert.equal(getDefToolLocalContract('def.data.resource.damage').sideEffect, 'read-only');

const serverSource = fs.readFileSync('agent/server/def-agent-server.cjs', 'utf8');
const adapterSource = fs.readFileSync('agent/runtime/def-opencode-adapter/index.cjs', 'utf8');
const bridgeSource = fs.readFileSync('agent/runtime/def-tools/opencode/harness-manager-bridge.mjs', 'utf8');
const electronSource = fs.readFileSync('electron/main.cjs', 'utf8');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.match(serverSource, /message\|prompt_async/);
assert.match(bridgeSource, /HARNESS_RUNTIME_NOT_PREPARED/);
assert.match(bridgeSource, /managedWorkbenchBinding/);
assert.doesNotMatch(adapterSource, /copyFileSync\(defOpenCodeToolSource/);
assert.match(adapterSource, /fs\.rmSync\(path\.join\(toolsDir, 'def\.js'\)/);
assert.match(electronSource, /DEF_HARNESS_STATE_PATH/);
assert.match(electronSource, /DEF_HARNESS_WATCH: isDev \? '1' : '0'/);
assert(packageJson.build.files.includes('agent/harness/business/**'));

console.log('DEF Harness Manager Host/Tool boundary contract: PASS');
