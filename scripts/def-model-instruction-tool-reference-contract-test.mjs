import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DEF_NATIVE_TARGETS } from '../agent/runtime/def-tools/registry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { buildAgentPrompt } = require('../agent/runtime/def-opencode-adapter/index.cjs');
const toolReferencePattern = /\bdef_[a-z0-9_]+\b/g;
const callableTools = new Set(
  DEF_NATIVE_TARGETS
    .map((target) => target.nativeBinding)
    .filter((binding) => typeof binding === 'string' && binding.startsWith('def_')),
);
const serverSource = fs.readFileSync(path.join(root, 'agent/server/def-agent-server.cjs'), 'utf8');
const dynamicPromptStart = serverSource.indexOf('function buildWorkbenchCheckoutSystemPrompt');
const dynamicPromptEnd = serverSource.indexOf('async function syncNativeWorkbenchAxisBinding', dynamicPromptStart);
assert(dynamicPromptStart >= 0 && dynamicPromptEnd > dynamicPromptStart, 'dynamic Workbench prompt builders must remain discoverable');

function markdownFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(target);
    return entry.isFile() && entry.name.endsWith('.md') ? [target] : [];
  });
}

const instructionSources = [
  ...['operator', 'weapon', 'equipment', 'workbench', 'search', 'repair', 'audit']
    .map((skillId) => ({ name: `base-prompt:${skillId}`, text: buildAgentPrompt(skillId) })),
  ...markdownFiles(path.join(root, 'agent/runtime/def/skills'))
    .map((file) => ({ name: path.relative(root, file), text: fs.readFileSync(file, 'utf8') })),
  ...markdownFiles(path.join(root, 'agent/harness/baseline'))
    .map((file) => ({ name: path.relative(root, file), text: fs.readFileSync(file, 'utf8') })),
  ...markdownFiles(path.join(root, 'agent/harness/examples'))
    .map((file) => ({ name: path.relative(root, file), text: fs.readFileSync(file, 'utf8') })),
  {
    name: 'agent/server/def-agent-server.cjs:dynamic-workbench-prompts',
    text: serverSource.slice(dynamicPromptStart, dynamicPromptEnd),
  },
  {
    name: 'agent/runtime/def-tools/opencode/def.js',
    text: fs.readFileSync(path.join(root, 'agent/runtime/def-tools/opencode/def.js'), 'utf8'),
  },
];

const unknown = [];
for (const source of instructionSources) {
  for (const reference of new Set(source.text.match(toolReferencePattern) || [])) {
    // Names ending in an underscore document a family such as def_data_*;
    // they are not presented as callable identifiers.
    if (reference.endsWith('_') || callableTools.has(reference)) continue;
    unknown.push({ source: source.name, reference });
  }
}

assert.equal(
  unknown.length,
  0,
  `Model-visible instructions reference unknown DEF tools:\n${unknown.map((entry) => `- ${entry.reference} in ${entry.source}`).join('\n')}`,
);
assert(callableTools.has('def_data_team_loadout_plan'));
assert(!callableTools.has('def_team_loadout_plan'));

console.log(JSON.stringify({
  ok: true,
  instructionSources: instructionSources.length,
  callableDefTools: callableTools.size,
  checks: ['base-prompts', 'runtime-skills', 'harness-packages', 'dynamic-prompts', 'tool-descriptions'],
}));
