import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEF_TOOL_DEFINITION_BASE } from '../agent/runtime/def-tools/definitions.mjs';
import { buildDefToolRouteMap, createDefToolRegistry } from '../agent/runtime/def-tools/registry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(root, 'docs', 'specs', 'legacy-ai-cli-mcp-extraction', 'fixtures', 'def-core-baseline-v2.json');
const baseline = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

const registry = createDefToolRegistry(DEF_TOOL_DEFINITION_BASE);
const routeMap = buildDefToolRouteMap(registry);
const schemas = registry.map(({ id, schema }) => ({ id, schema }));
const actual = {
  definitionCount: DEF_TOOL_DEFINITION_BASE.length,
  registryCount: registry.length,
  registrySha256: sha256(registry),
  toolSchemaSha256: sha256(schemas),
  routeMapSha256: sha256(routeMap),
  diagnostics: {
    legacyToolCount: routeMap.diagnostics.legacyToolCount,
    modelExposedLegacyToolCount: routeMap.diagnostics.modelExposedLegacyToolCount,
    internalToolCount: routeMap.diagnostics.internalToolCount,
    nativeTargetCount: routeMap.diagnostics.nativeTargetCount,
    unclassified: routeMap.diagnostics.unclassified,
  },
};

for (const key of ['definitionCount', 'registryCount', 'registrySha256', 'toolSchemaSha256', 'routeMapSha256']) {
  assert.deepEqual(actual[key], baseline[key], `DEF baseline mismatch: ${key}`);
}
assert.deepEqual(actual.diagnostics, baseline.diagnostics, 'DEF route diagnostics mismatch');
process.stdout.write(`${JSON.stringify(actual, null, 2)}\n`);
process.stdout.write('[def-core-baseline-check] passed\n');
