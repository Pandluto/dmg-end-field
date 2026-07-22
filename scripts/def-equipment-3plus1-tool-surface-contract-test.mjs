import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { z } from 'zod';
import {
  countDefEquipment3Plus1DistinctConstraintQueries,
  DEF_EQUIPMENT_3PLUS1_RECOMMEND_ERROR_SCHEMA,
  DEF_EQUIPMENT_3PLUS1_RECOMMEND_INPUT_SCHEMA,
  DEF_EQUIPMENT_3PLUS1_RECOMMEND_OUTPUT_SCHEMA,
  DEF_EQUIPMENT_3PLUS1_MAX_DISTINCT_CONSTRAINT_QUERIES,
  DEF_TOOL_DEFINITION_BASE,
  normalizeDefEquipment3Plus1Query,
} from '../agent/runtime/def-tools/definitions.mjs';
import {
  DEF_NATIVE_TARGETS,
  DEF_PROJECTION_ACCESS,
  DEF_TOOL_FAMILY,
  DEF_WORKSPACE_SCOPE,
  createDefToolRegistry,
  resolveDefToolAccessPolicy,
} from '../agent/runtime/def-tools/registry.mjs';
import {
  data_equipment_3plus1_facts,
  data_equipment_3plus1_plan,
  data_equipment_3plus1_recommend,
  data_equipment_set_fit_shortlist,
} from '../agent/runtime/def-tools/opencode/def.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const recommendName = 'def.equipment.3plus1.recommend';
const recommendTarget = 'def.data.resource.equipment_3plus1_recommend';
const recommendBinding = 'def_data_equipment_3plus1_recommend';
const legacyTools = [
  ['def.equipment.set_fit.shortlist', 'def.data.resource.equipment_set_fit_shortlist', 'def_data_equipment_set_fit_shortlist', data_equipment_set_fit_shortlist],
  ['def.equipment.3plus1.facts', 'def.data.resource.equipment_3plus1_facts', 'def_data_equipment_3plus1_facts', data_equipment_3plus1_facts],
  ['def.equipment.3plus1.plan', 'def.data.resource.equipment_3plus1_plan', 'def_data_equipment_3plus1_plan', data_equipment_3plus1_plan],
];

const definitions = createDefToolRegistry(DEF_TOOL_DEFINITION_BASE);
const recommendDefinition = DEF_TOOL_DEFINITION_BASE.find((tool) => tool.name === recommendName);
const recommendRecord = definitions.find((tool) => tool.id === recommendName);
const recommendNativeTarget = DEF_NATIVE_TARGETS.find((target) => target.id === recommendTarget);

assert(recommendDefinition, 'recommend sidecar definition is required');
assert.equal(recommendDefinition.scope, 'session-private');
assert.equal(recommendDefinition.riskLevel, 'read');
assert.equal(recommendDefinition.approval, 'none');
assert.equal(recommendDefinition.inputSchema, DEF_EQUIPMENT_3PLUS1_RECOMMEND_INPUT_SCHEMA);
assert.equal(recommendDefinition.outputSchema, DEF_EQUIPMENT_3PLUS1_RECOMMEND_OUTPUT_SCHEMA);
assert.equal(recommendDefinition.errorSchema, DEF_EQUIPMENT_3PLUS1_RECOMMEND_ERROR_SCHEMA);
assert.match(recommendDefinition.description, /read-only/i);
assert.doesNotMatch(recommendDefinition.description, /\b(?:first|then|after|before|guide|profile|catalog|facts)\b/i);

assert.equal(DEF_EQUIPMENT_3PLUS1_RECOMMEND_INPUT_SCHEMA.additionalProperties, false);
assert.deepEqual(DEF_EQUIPMENT_3PLUS1_RECOMMEND_INPUT_SCHEMA.required, ['operatorQuery']);
assert.equal(DEF_EQUIPMENT_3PLUS1_RECOMMEND_INPUT_SCHEMA.properties.constraints.additionalProperties, false);
assert.equal(DEF_EQUIPMENT_3PLUS1_RECOMMEND_INPUT_SCHEMA.properties.constraints.properties.requiredEquipmentQueries.maxItems, 4);
assert.equal(DEF_EQUIPMENT_3PLUS1_RECOMMEND_INPUT_SCHEMA.properties.constraints.properties.excludedEquipmentQueries.maxItems, 8);
assert.equal(DEF_EQUIPMENT_3PLUS1_RECOMMEND_INPUT_SCHEMA.properties.constraints.properties.compareEquipmentQueries.maxItems, 8);
assert.equal(DEF_EQUIPMENT_3PLUS1_RECOMMEND_INPUT_SCHEMA.properties.constraints.properties.compareEquipmentQueries.items.additionalProperties, false);
assert.deepEqual(DEF_EQUIPMENT_3PLUS1_RECOMMEND_INPUT_SCHEMA.properties.constraints.properties.duplicateAccessoryPolicy.enum, ['catalog-default', 'allow', 'forbid']);
assert.deepEqual(DEF_EQUIPMENT_3PLUS1_RECOMMEND_INPUT_SCHEMA.properties.constraints.properties.minimumSetPieces.enum, [3, 4]);
assert.deepEqual(DEF_EQUIPMENT_3PLUS1_RECOMMEND_INPUT_SCHEMA.properties.shortlistLimit.enum, [1, 2, 3]);
assert.equal(DEF_EQUIPMENT_3PLUS1_RECOMMEND_INPUT_SCHEMA.properties.priorPlanDigest.pattern, '^sha256:[0-9a-f]{64}$');
assert.match(DEF_EQUIPMENT_3PLUS1_RECOMMEND_INPUT_SCHEMA.properties.operatorQuery.description, /NFKC/i);
assert.match(DEF_EQUIPMENT_3PLUS1_RECOMMEND_INPUT_SCHEMA.properties.constraints.description, /at most 16 distinct normalized queries/i);

const modelVisibleRecommendSchema = z.toJSONSchema(
  z.object(data_equipment_3plus1_recommend.args),
  { io: 'input' },
);
assert.deepEqual(
  Object.keys(modelVisibleRecommendSchema.properties || {}),
  ['operatorQuery', 'setQuery', 'constraints', 'shortlistLimit', 'priorPlanDigest'],
  'the OpenCode plugin boundary must advertise the flat recommendation input',
);
assert.deepEqual(modelVisibleRecommendSchema.required, ['operatorQuery']);
assert.equal(Object.hasOwn(modelVisibleRecommendSchema.properties || {}, 'def'), false, 'Zod internals must never become a model-visible argument');
assert.match(modelVisibleRecommendSchema.properties.constraints.description, /minimumSetPieces belongs here/i);
assert.match(data_equipment_3plus1_recommend.description, /do not add top-level minimumSetPieces/i);

assert.equal(DEF_EQUIPMENT_3PLUS1_RECOMMEND_OUTPUT_SCHEMA.properties.contract.const, 'DefEquipmentThreePlusOneRecommendationV1');
assert.deepEqual(DEF_EQUIPMENT_3PLUS1_RECOMMEND_OUTPUT_SCHEMA.properties.state.enum, ['READY', 'NEEDS_INPUT', 'UNRESOLVED']);
assert.equal(DEF_EQUIPMENT_3PLUS1_RECOMMEND_OUTPUT_SCHEMA.properties.result.anyOf[1].properties.catalogEvidence.properties.exhaustive.const, true);
assert.equal(DEF_EQUIPMENT_3PLUS1_RECOMMEND_ERROR_SCHEMA.properties.contract.const, 'DefEquipmentThreePlusOneRecommendationErrorV1');
assert.deepEqual(DEF_EQUIPMENT_3PLUS1_RECOMMEND_ERROR_SCHEMA.properties.failureStage.enum, [
  'validate-input',
  'authorize-session',
  'resolve-operator',
  'resolve-profile',
  'capture-catalog',
  'resolve-constraints',
  'resolve-set',
  'validate-facts',
  'solve-plan',
  'build-evidence',
]);
assert.deepEqual(DEF_EQUIPMENT_3PLUS1_RECOMMEND_ERROR_SCHEMA.properties.nextAction.enum, ['FIX_INPUT', 'RETRY_FRESH_TURN', 'REPORT_AND_STOP']);

assert(recommendRecord, 'recommend registry record is required');
assert.equal(recommendRecord.family, DEF_TOOL_FAMILY.DATA_RESOURCE);
assert.equal(recommendRecord.canonicalTarget, recommendTarget);
assert.equal(recommendRecord.schema, DEF_EQUIPMENT_3PLUS1_RECOMMEND_INPUT_SCHEMA);
assert.equal(recommendRecord.workspaceScope, DEF_WORKSPACE_SCOPE.SESSION_PRIVATE);
assert.equal(recommendRecord.projectionAccess, DEF_PROJECTION_ACCESS.NONE);
assert.deepEqual(recommendRecord.allowedHosts, ['workbench', 'ai-cli']);
assert.deepEqual(recommendRecord.exposure, ['workbench', 'ai-cli']);
assert.equal(recommendRecord.requiresCheckout, false);
assert.equal(resolveDefToolAccessPolicy(recommendName).workspaceScope, DEF_WORKSPACE_SCOPE.SESSION_PRIVATE);
assert(recommendNativeTarget, 'recommend native target is required');
assert.equal(recommendNativeTarget.nativeBinding, recommendBinding);
assert.equal(recommendNativeTarget.family, DEF_TOOL_FAMILY.DATA_RESOURCE);
assert.equal(recommendNativeTarget.workspaceScope, 'session-private');

const mappingProbe = createDefToolRegistry([{
  name: recommendName,
  scope: 'session-private',
  riskLevel: 'read',
  approval: 'none',
  status: 'implemented',
  description: 'probe',
  inputSchema: DEF_EQUIPMENT_3PLUS1_RECOMMEND_INPUT_SCHEMA,
}]);
assert.equal(mappingProbe[0].canonicalTarget, recommendTarget, 'recommend must win before the broad legacy 3plus1 matcher');

for (const [name, targetId, nativeBinding, implementation] of legacyTools) {
  const definition = DEF_TOOL_DEFINITION_BASE.find((tool) => tool.name === name);
  const record = definitions.find((tool) => tool.id === name);
  const target = DEF_NATIVE_TARGETS.find((entry) => entry.id === targetId);
  assert(definition, `${name} definition is retained`);
  assert(record, `${name} registry record is retained`);
  assert(target, `${name} native target is retained`);
  assert.equal(record.canonicalTarget, targetId);
  assert.equal(target.nativeBinding, nativeBinding);
  assert.equal(resolveDefToolAccessPolicy(name).workspaceScope, DEF_WORKSPACE_SCOPE.SESSION_PRIVATE);
  assert.match(definition.description, /^Legacy compatibility:/);
  assert.match(implementation.description, /^Legacy compatibility:/);
  assert.equal(typeof implementation.execute, 'function');
}

const queryAtContractLimit = 'q'.repeat(160);
const queryAboveContractLimit = `${queryAtContractLimit}q`;
const createInputWithQuery = (query) => ({
  operatorQuery: query,
  setQuery: query,
  constraints: {
    requiredEquipmentQueries: [query],
    excludedEquipmentQueries: [query],
    compareEquipmentQueries: [{ query, slot: 'glove' }],
    duplicateAccessoryPolicy: 'forbid',
    minimumSetPieces: 4,
  },
  shortlistLimit: 2,
  priorPlanDigest: `sha256:${'a'.repeat(64)}`,
});
const validInput = createInputWithQuery(queryAtContractLimit);
const validateRecommendInput = new Ajv({ allErrors: true }).compile(DEF_EQUIPMENT_3PLUS1_RECOMMEND_INPUT_SCHEMA);
assert.equal(validateRecommendInput(validInput), true, 'the shared input schema must accept every 160-character query field');
const parsedInput = data_equipment_3plus1_recommend.inputSchema.parse(validInput);
assert.deepEqual(parsedInput, validInput, 'OpenCode mapping must not rewrite V1 input');
const tooLongQueryInputs = [
  ['operatorQuery', { ...validInput, operatorQuery: queryAboveContractLimit }],
  ['setQuery', { ...validInput, setQuery: queryAboveContractLimit }],
  ['requiredEquipmentQueries', { ...validInput, constraints: { ...validInput.constraints, requiredEquipmentQueries: [queryAboveContractLimit] } }],
  ['excludedEquipmentQueries', { ...validInput, constraints: { ...validInput.constraints, excludedEquipmentQueries: [queryAboveContractLimit] } }],
  ['compareEquipmentQueries.query', { ...validInput, constraints: { ...validInput.constraints, compareEquipmentQueries: [{ query: queryAboveContractLimit, slot: 'glove' }] } }],
];
for (const [field, input] of tooLongQueryInputs) {
  assert.equal(validateRecommendInput(input), false, `the shared input schema must reject a 161-character ${field}`);
  assert.equal(data_equipment_3plus1_recommend.inputSchema.safeParse(input).success, false, `the OpenCode wrapper must reject a 161-character ${field}`);
}

const normalizedQueryInput = (query) => createInputWithQuery(normalizeDefEquipment3Plus1Query(query));
const trailingWhitespaceInput = createInputWithQuery(`  ${queryAtContractLimit}   `);
const fullWidthInput = createInputWithQuery('\uff22\uff49\uff45\uff4c\uff49\u3000\u3000\u51b0\u3000\u3000\u5957');
const normalizedTrailingWhitespace = data_equipment_3plus1_recommend.inputSchema.parse(trailingWhitespaceInput);
const normalizedFullWidth = data_equipment_3plus1_recommend.inputSchema.parse(fullWidthInput);
assert.equal(normalizedTrailingWhitespace.operatorQuery, queryAtContractLimit, 'the wrapper trims query values before dispatch');
assert.equal(normalizedTrailingWhitespace.constraints.compareEquipmentQueries[0].query, queryAtContractLimit);
assert.equal(normalizedFullWidth.operatorQuery, 'Bieli \u51b0 \u5957', 'the wrapper performs NFKC plus whitespace folding');
assert.equal(normalizedFullWidth.constraints.requiredEquipmentQueries[0], 'Bieli \u51b0 \u5957');
assert.equal(validateRecommendInput(normalizedTrailingWhitespace), true, 'the actual JSON Schema accepts the normalized 160-character transport value');
assert.equal(validateRecommendInput(normalizedQueryInput(` ${queryAboveContractLimit} `)), false, 'the actual JSON Schema rejects a normalized 161-character transport value');
assert.equal(data_equipment_3plus1_recommend.inputSchema.safeParse(normalizedQueryInput(` ${queryAboveContractLimit} `)).success, false, 'the wrapper rejects a normalized 161-character query');
for (const field of [
  ['operatorQuery', { operatorQuery: '   \u3000  ' }],
  ['setQuery', { operatorQuery: 'Bieli', setQuery: '   \u3000  ' }],
  ['requiredEquipmentQueries', { operatorQuery: 'Bieli', constraints: { requiredEquipmentQueries: ['   \u3000  '] } }],
  ['excludedEquipmentQueries', { operatorQuery: 'Bieli', constraints: { excludedEquipmentQueries: ['   \u3000  '] } }],
  ['compareEquipmentQueries.query', { operatorQuery: 'Bieli', constraints: { compareEquipmentQueries: [{ query: '   \u3000  ' }] } }],
]) {
  assert.equal(data_equipment_3plus1_recommend.inputSchema.safeParse(field[1]).success, false, `the wrapper rejects a normalized-empty ${field[0]}`);
}

const crossGroupDuplicateInput = {
  operatorQuery: 'Bieli',
  constraints: {
    requiredEquipmentQueries: [' \uff21 ', 'B'],
    excludedEquipmentQueries: ['A', ' C '],
    compareEquipmentQueries: [{ query: ' \uff22 ' }, { query: 'C' }, { query: ' D ' }],
  },
};
const crossGroupDuplicateParsed = data_equipment_3plus1_recommend.inputSchema.parse(crossGroupDuplicateInput);
assert.equal(countDefEquipment3Plus1DistinctConstraintQueries(crossGroupDuplicateParsed.constraints), 4, 'cross-group duplicates are counted by normalized query identity');
assert.equal(crossGroupDuplicateParsed.constraints.requiredEquipmentQueries[0], 'A');
assert.equal(crossGroupDuplicateParsed.constraints.compareEquipmentQueries[0].query, 'B');
assert.equal(data_equipment_3plus1_recommend.inputSchema.safeParse(crossGroupDuplicateInput).success, true, 'cross-group duplicates below the distinct limit remain Service-legal');

const distinctQueries = Array.from({ length: DEF_EQUIPMENT_3PLUS1_MAX_DISTINCT_CONSTRAINT_QUERIES + 4 }, (_, index) => `piece-${index + 1}`);
const overLimitInput = {
  operatorQuery: 'Bieli',
  constraints: {
    requiredEquipmentQueries: distinctQueries.slice(0, 4),
    excludedEquipmentQueries: distinctQueries.slice(4, 12),
    compareEquipmentQueries: distinctQueries.slice(12).map((query) => ({ query })),
  },
};
assert.equal(countDefEquipment3Plus1DistinctConstraintQueries(overLimitInput.constraints), 20);
assert.equal(data_equipment_3plus1_recommend.inputSchema.safeParse(overLimitInput).success, false, 'the wrapper rejects 20 distinct cross-group queries');
assert.equal(data_equipment_3plus1_recommend.inputSchema.safeParse({
  ...overLimitInput,
  constraints: {
    ...overLimitInput.constraints,
    compareEquipmentQueries: distinctQueries.slice(0, 8).map((query) => ({ query: `  ${query}  ` })),
  },
}).success, true, 'cross-group duplicates that normalize to at most 16 are accepted');
assert.equal(data_equipment_3plus1_recommend.inputSchema.safeParse({ operatorQuery: 'Bieli', unknown: true }).success, false);
assert.equal(data_equipment_3plus1_recommend.inputSchema.safeParse({ operatorQuery: 'Bieli', constraints: { unknown: true } }).success, false);
assert.equal(data_equipment_3plus1_recommend.inputSchema.safeParse({ operatorQuery: 'Bieli', constraints: { compareEquipmentQueries: [{ query: 'piece', unknown: true }] } }).success, false);
assert.equal(data_equipment_3plus1_recommend.inputSchema.safeParse({ operatorQuery: 'Bieli', shortlistLimit: 1.5 }).success, false);
assert.equal(data_equipment_3plus1_recommend.inputSchema.safeParse({ operatorQuery: 'Bieli', priorPlanDigest: 'sha256:ABC' }).success, false);

const originalFetch = globalThis.fetch;
const requests = [];
const typedResult = Object.freeze({
  protocolVersion: 1,
  contract: 'DefEquipmentThreePlusOneRecommendationV1',
  state: 'NEEDS_INPUT',
  requestDigest: `sha256:${'b'.repeat(64)}`,
  sourceRefs: [],
  completeness: 'partial',
  missing: [],
  ambiguities: [],
  result: null,
  nextQuestion: { field: 'operatorQuery', prompt: 'Which operator?' },
});
const typedError = Object.freeze({
  contract: 'DefEquipmentThreePlusOneRecommendationErrorV1',
  code: 'invalid-recommendation-input',
  failureStage: 'validate-input',
  retryable: false,
  nextAction: 'FIX_INPUT',
  message: 'operatorQuery is invalid',
});

try {
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return { ok: true, status: 200, json: async () => ({ ok: true, result: typedResult }) };
  };
  const result = await data_equipment_3plus1_recommend.execute(parsedInput, {
    sessionID: 'surface-session',
    messageID: 'surface-turn',
  });
  assert.equal(typeof result.output, 'string', 'OpenCode plugin success must provide truncatable text output');
  assert.deepEqual(JSON.parse(result.output), typedResult, 'the OpenCode envelope must preserve the typed business result');
  assert.equal(result.metadata.contract, typedResult.contract);
  assert.equal(result.metadata.state, typedResult.state);
  assert.equal(result.metadata.family, 'def-data-resource');
  assert.deepEqual(requests[0].body, {
    tool: recommendName,
    input: { ...validInput, __defTurnId: 'surface-turn' },
    sessionId: 'surface-session',
  });

  requests.length = 0;
  await data_equipment_3plus1_recommend.execute(trailingWhitespaceInput, {
    sessionID: 'surface-normalized-session',
    messageID: 'surface-normalized-turn',
  });
  assert.equal(requests[0].body.input.operatorQuery, queryAtContractLimit, 'direct execute must normalize before the sidecar dispatcher');
  assert.equal(requests[0].body.input.constraints.requiredEquipmentQueries[0], queryAtContractLimit);

  globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ ok: false, error: typedError }) });
  await assert.rejects(
    () => data_equipment_3plus1_recommend.execute({ operatorQuery: 'Bieli' }, {
      sessionID: 'surface-error-session',
      messageID: 'surface-error-turn',
    }),
    (error) => {
      assert.equal(error.code, typedError.code);
      assert.deepEqual(error.details, typedError, 'typed error details must survive the OpenCode adapter unchanged');
      return true;
    },
  );
} finally {
  globalThis.fetch = originalFetch;
}

const implementationSource = fs.readFileSync(path.join(root, 'agent/runtime/def-tools/opencode/def.js'), 'utf8');
assert(implementationSource.includes('3plus1\\.(?:facts|plan|recommend)'), 'recommend must join terminal evidence classification');

console.log(JSON.stringify({
  ok: true,
  checks: [
    'authority-schemas',
    'session-private-policy',
    'recommend-target-precedence',
    'legacy-compatibility-retention',
    'query-boundary-contract',
    'query-normalization-and-distinct-limit',
    'model-visible-flat-required-schema',
    'opencode-input-identity',
    'opencode-display-envelope-and-error-preservation',
    'static-no-rest-service',
  ],
}));
