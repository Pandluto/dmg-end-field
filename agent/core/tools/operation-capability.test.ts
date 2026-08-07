import assert from 'node:assert/strict';
import {
  DEF_OPERATION_CAPABILITY_COUNT,
  DEF_OPERATION_CAPABILITY_STATUS_COUNTS,
  listDefOperationCapabilities,
  operationCapabilityJson,
  readDefOperationCapability,
  type DefOperationCapability,
} from './operation-capability.ts';

const expectedOperations = {
  selection: ['inspect', 'search', 'add', 'remove', 'replace', 'reorder', 'analyze', 'apply'],
  loadout: [
    'inspect', 'evaluate', 'resolve', 'recommend', 'recommend_named_set',
    'recommend_discovered_set', 'recommend_weapon', 'recommend_equipment',
    'compare', 'preview', 'apply', 'restore',
  ],
  timeline: ['current', 'inspect', 'add', 'remove', 'move', 'replace', 'copy', 'validate', 'delete_node', 'preview', 'apply', 'restore'],
  buff: ['inspect', 'resolve', 'source', 'add', 'remove', 'replace', 'batch', 'stack', 'coverage', 'apply', 'restore'],
  calculation: ['calculate', 'aggregate', 'compare', 'attribute', 'diagnose', 'export', 'explain', 'skill_fact'],
} as const;

const entries = listDefOperationCapabilities();
const keyOf = (entry: Pick<DefOperationCapability, 'businessId' | 'operation'>) => (
  `${entry.businessId}.${entry.operation}`
);

assert.equal(DEF_OPERATION_CAPABILITY_COUNT, 51);
assert.equal(entries.length, 51);
assert.equal(new Set(entries.map(keyOf)).size, 51, 'the matrix must contain 51 unique business.operation keys');

for (const [businessId, operations] of Object.entries(expectedOperations)) {
  const actual = entries
    .filter((entry) => entry.businessId === businessId)
    .map((entry) => entry.operation);
  assert.deepEqual(actual, operations, `${businessId} operation order must be stable and complete`);
}

assert.deepEqual(DEF_OPERATION_CAPABILITY_STATUS_COUNTS, {
  available: 48,
  'fact-only': 1,
  'evidence-unavailable': 0,
  retired: 2,
});
assert.equal(
  Object.values(DEF_OPERATION_CAPABILITY_STATUS_COUNTS).reduce((sum, count) => sum + count, 0),
  51,
);

assert.equal(readDefOperationCapability('loadout', 'recommend')?.status, 'available');
assert.equal(readDefOperationCapability('loadout', 'recommend_discovered_set')?.status, 'available');
assert.equal(readDefOperationCapability('timeline', 'restore')?.status, 'available');
assert.equal(readDefOperationCapability('timeline', 'delete_node')?.status, 'available');
assert.equal(readDefOperationCapability('buff', 'restore')?.status, 'available');
assert.equal(readDefOperationCapability('calculation', 'compare')?.status, 'available');
assert.equal(readDefOperationCapability('conversation', 'respond'), null);

// These are the canonical names audited from the current Harness catalog and
// Product Tool registry. A generic operation label is not an implementation.
const canonicalMutationTools = new Set([
  'def.team.selection.apply',
  'def.loadout.apply_prepared',
  'def.workbench.add_skill_button',
  'def.workbench.remove_skill_button',
  'def.worknode.patch_and_validate',
  'def.worknode.use',
  'def.worknode.delete',
  'def.worknode.restore',
  'def.buff.add_to_button',
  'def.buff.remove_from_button',
]);
const canonicalMutationCommands = new Set([
  'applyPreparedOperatorConfigProposal',
  'prepareReviewedWorkNodeProposal',
  'checkoutAiTimelineWorkNode',
  'deleteAiTimelineWorkNode',
]);

const mutatingAvailable = entries.filter((entry) => entry.status === 'available' && entry.mutatesProduct);
assert.equal(mutatingAvailable.length, 21);
for (const entry of mutatingAvailable) {
  assert.equal(
    entry.implementationRoute.some((route) => route.kind === 'tool' && canonicalMutationTools.has(route.name)),
    true,
    `${keyOf(entry)} must point to a canonical mutating Tool`,
  );
  assert.equal(
    entry.implementationRoute.some((route) => route.kind === 'command' && canonicalMutationCommands.has(route.name)),
    true,
    `${keyOf(entry)} must point to a canonical mutating command`,
  );
}

for (const entry of entries) {
  assert.equal(entry.contract, 'DefOperationCapabilityV1');
  assert.equal(entry.evidencePolicy, 'browser-1.8-facts-only');
  assert.equal(entry.legacyGuidePolicy, 'legacy-1.2-guide-not-treated-as-1.8-fact');
  assert.ok(entry.reason.trim().length >= 12, `${keyOf(entry)} must explain a concrete boundary`);
  assert.equal(entry.reason.trim(), entry.reason, `${keyOf(entry)} reason must not contain padding`);
  for (const route of [...entry.implementationRoute, ...entry.replacementRoute]) {
    assert.ok(route.name.trim().length > 0, `${keyOf(entry)} has an empty route name`);
    assert.equal(route.name.trim(), route.name, `${keyOf(entry)} route name must be stable`);
    if (route.action !== undefined) {
      assert.ok(route.action.trim().length > 0, `${keyOf(entry)} has an empty route action`);
      assert.equal(route.action.trim(), route.action, `${keyOf(entry)} route action must be stable`);
    }
  }

  if (entry.status === 'available') {
    assert.equal(entry.implementationRoute.length > 0, true, `${keyOf(entry)} has no implementation route`);
    assert.equal(entry.replacement, null);
    assert.equal(entry.replacementRoute.length, 0);
  } else {
    assert.equal(entry.mutatesProduct, false, `${keyOf(entry)} must not expose a write`);
    assert.ok(entry.replacement, `${keyOf(entry)} must have a non-empty replacement id`);
    assert.equal(entry.replacement?.trim(), entry.replacement, `${keyOf(entry)} replacement must be stable`);
    assert.equal(entry.replacementRoute.length > 0, true, `${keyOf(entry)} has no replacement route`);
    assert.equal(
      entry.implementationRoute.every((route) => route.kind === 'tool'),
      true,
      `${keyOf(entry)} limited implementation may only expose read/evidence Tools`,
    );
    assert.equal(
      entry.implementationRoute.some((route) => route.kind === 'command'),
      false,
      `${keyOf(entry)} limited capability must not expose a command write`,
    );
  }

  if (entry.status === 'retired') {
    assert.equal(entry.implementationRoute.length, 0, `${keyOf(entry)} retired capability cannot have an implementation`);
  }
  assert.equal(JSON.parse(JSON.stringify(entry)).contract, 'DefOperationCapabilityV1');
}

const unknown = operationCapabilityJson('conversation', 'respond');
assert.equal(unknown.status, 'retired');
assert.equal(unknown.mutatesProduct, false);
assert.equal(unknown.replacement, 'capability.status');
assert.deepEqual(unknown.implementationRoute, []);
assert.equal((unknown.replacementRoute as Array<{ kind: string; name: string }>)[0]?.name, 'def.capability.status');

console.log('DEF operation capability audit contract: PASS');
