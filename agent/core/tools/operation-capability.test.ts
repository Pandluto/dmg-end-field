import assert from 'node:assert/strict';
import {
  DEF_OPERATION_CAPABILITY_COUNT,
  listDefOperationCapabilities,
  operationCapabilityJson,
  readDefOperationCapability,
} from './operation-capability.ts';

assert.equal(DEF_OPERATION_CAPABILITY_COUNT, 50);
const entries = listDefOperationCapabilities();
assert.equal(entries.length, 50);
assert.equal(new Set(entries.map((entry) => `${entry.businessId}.${entry.operation}`)).size, 50);

const retired = entries.filter((entry) => entry.status === 'retired');
assert.deepEqual(
  retired.map((entry) => `${entry.businessId}.${entry.operation}`).sort(),
  ['loadout.recommend_equipment', 'loadout.restore'],
);
assert.equal(retired.every((entry) => entry.mutatesProduct === false), true);

assert.equal(readDefOperationCapability('loadout', 'recommend')?.status, 'evidence-unavailable');
assert.equal(readDefOperationCapability('loadout', 'recommend_discovered_set')?.status, 'fact-only');
assert.equal(readDefOperationCapability('timeline', 'apply')?.mutatesProduct, true);
assert.equal(readDefOperationCapability('calculation', 'compare')?.status, 'available');
assert.equal(readDefOperationCapability('conversation', 'respond'), null);

const unknown = operationCapabilityJson('conversation', 'respond');
assert.equal(unknown.status, 'retired');
assert.equal(unknown.mutatesProduct, false);

for (const entry of entries) {
  assert.equal(entry.evidencePolicy, 'browser-1.8-facts-only');
  assert.equal(entry.legacyGuidePolicy, 'legacy-1.2-guide-not-treated-as-1.8-fact');
  assert.equal(JSON.parse(JSON.stringify(entry)).contract, 'DefOperationCapabilityV1');
}

console.log('DEF operation capability contract: PASS');
