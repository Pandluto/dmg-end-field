import assert from 'node:assert/strict';
import { createDefCoreRequestRouter, DEF_CORE_ROUTE_FAMILIES } from './def-core/request-router.mjs';
import { createDefCoreRuntimeState, createDefRawTransportPolicy } from './def-core/runtime-state.mjs';
import { createDefCoreToolRegistry } from './def-core/tool-registry.mjs';

const calls = [];
const miss = (name) => async (...args) => { calls.push([name, ...args]); return null; };
const route = createDefCoreRequestRouter({
  handleAiTimelineWorkNodeRequest: miss('worknode'),
  handleTimelineRepositoryRequest: miss('timeline'),
  handleDefToolRequest: async (...args) => {
    calls.push(['tools', ...args]);
    return args[1] === '/api/def-tools/list' ? { status: 200, body: { ok: true } } : null;
  },
  handleMainWorkbenchRequest: miss('workbench'),
});

const query = new URLSearchParams('name=fixture');
const rawInvocation = { internalToken: 'opaque-test-token' };
const response = await route({
  method: 'GET',
  pathname: '/api/def-tools/list',
  searchParams: query,
  body: undefined,
  rawInvocation,
});

assert.deepEqual(response, { status: 200, body: { ok: true } });
assert.deepEqual(calls.map(([name]) => name), ['worknode', 'timeline', 'tools']);
assert.equal(calls[0][4], rawInvocation, 'raw invocation identity must be preserved');
assert.deepEqual(DEF_CORE_ROUTE_FAMILIES, [
  '/api/ai-timeline-worknodes*',
  '/api/timeline-*',
  '/api/def-tools/*',
  '/api/main-workbench/*',
]);

calls.length = 0;
const legacyMiss = await route({
  method: 'GET',
  pathname: '/api/buff/current',
  searchParams: new URLSearchParams(),
  body: undefined,
  rawInvocation,
});
assert.equal(legacyMiss, null, 'legacy fill routes must remain outside DEF core router');
assert.deepEqual(calls.map(([name]) => name), ['worknode', 'timeline', 'tools', 'workbench']);

const stateA = createDefCoreRuntimeState({ governanceToken: ' native-token ' });
const stateB = createDefCoreRuntimeState({ governanceToken: 'other-token' });
assert.equal(stateA.governanceToken, 'native-token');
assert.notEqual(stateA.approvedApplyCapabilities, stateB.approvedApplyCapabilities);
assert.equal(Object.isFrozen(stateA.internalRawTransport), true);
const rawPolicy = createDefRawTransportPolicy({
  governanceToken: stateA.governanceToken,
  fail: (status, code, message) => ({ status, body: { code, message } }),
});
assert.equal(rawPolicy.authorized(stateA.internalRawTransport), true);
assert.equal(rawPolicy.authorized({ internalToken: 'native-token' }), true);
assert.equal(rawPolicy.authorized({ internalToken: 'wrong-token' }), false);
assert.equal(rawPolicy.deny('/api/timeline-documents').status, 403);

const toolRegistry = createDefCoreToolRegistry({
  buildDefinitions: () => [{ name: 'def.fixture.read' }],
  createRegistry: (definitions) => Object.freeze([...definitions]),
});
assert.deepEqual(toolRegistry.get('def.fixture.read'), { name: 'def.fixture.read' });
assert.equal(toolRegistry.get('legacy.fill.apply'), null);
process.stdout.write('[def-core-router-contract-test] passed\n');
