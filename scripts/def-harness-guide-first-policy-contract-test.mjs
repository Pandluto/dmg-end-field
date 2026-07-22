import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const project = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(project, relativePath), 'utf8');
const normalizeNewlines = (value) => value.replace(/\r\n/g, '\n');
const candidateRoot = 'agent/harness/examples/spec9-3plus1-composite-v1';
const candidateFiles = [
  'agent-contract.md',
  'knowledge.md',
  'manifest.json',
  'response-policy.md',
  'role-card.md',
  'routing.md',
  'skills.md',
  'tool-guidance.md',
  'workflow.md',
];
const legacyThreePlusOneTools = [
  'def_data_operator_build_guide',
  'def_data_operator_build_profile',
  'def_data_native_catalog_materialize',
  'def_data_equipment_set_fit_shortlist',
  'def_data_equipment_3plus1_facts',
  'def_data_equipment_3plus1_plan',
];

const adapter = read('agent/runtime/def-opencode-adapter/index.cjs');
const adapterPrompt = adapter.slice(
  adapter.indexOf('function buildAgentPrompt(skillId) {'),
  adapter.indexOf('function buildOpenCodeConfig(config) {'),
);
assert.match(adapterPrompt, /def_data_native_catalog_materialize[\s\S]{0,180}exhaustive matching/);
assert.doesNotMatch(adapterPrompt, /ATTRIBUTE-FIRST 3\+1/);
assert.doesNotMatch(adapterPrompt, /3\+1 fact plan/);
for (const tool of legacyThreePlusOneTools.slice(3)) assert.doesNotMatch(adapterPrompt, new RegExp(tool));

const compositePromptStart = adapterPrompt.indexOf("'- COMPOSITE 3+1 RECOMMENDATION:");
const compositePromptEnd = adapterPrompt.indexOf("',", compositePromptStart);
const guideFirstPromptStart = adapterPrompt.indexOf("'- GUIDE-FIRST OPERATOR FIT:");
assert.ok(compositePromptStart >= 0 && compositePromptEnd > compositePromptStart, 'Base Prompt must define a bounded composite 3+1 exception');
assert.ok(compositePromptStart < guideFirstPromptStart, 'composite 3+1 exception must precede the generic guide-first rule');
const compositePrompt = adapterPrompt.slice(compositePromptStart, compositePromptEnd);
assert.match(compositePrompt, /def\.equipment\.3plus1\.recommend/);
assert.match(compositePrompt, /def_data_equipment_3plus1_recommend/);
assert.match(compositePrompt, /exception to the later GUIDE-FIRST OPERATOR FIT and generic correction routes/);
assert.match(compositePrompt, /operator-specific recommendation/);
assert.match(compositePrompt, /suitability comparison/);
assert.match(compositePrompt, /correction/);
assert.match(compositePrompt, /为什么不用……/);
assert.match(compositePrompt, /exactly once/);
assert.match(compositePrompt, /never enter guide\/profile\/filter discovery/);
assert.match(compositePrompt, /one fresh composite recommend call/);
assert.match(compositePrompt, /rather than restarting the old guide\/profile\/filter flow/);
assert.match(compositePrompt, /read-only and never applies a configuration/);

const skill = read('agent/runtime/def/skills/timeline-workbench/SKILL.md');
const compositeStart = skill.indexOf('## Composite 3+1 recommendation');
const compositeEnd = skill.indexOf('\n`@N-L`', compositeStart);
assert.ok(compositeStart >= 0 && compositeEnd > compositeStart, 'the runtime Skill must own one bounded composite 3+1 section');
const compositeSkill = skill.slice(compositeStart, compositeEnd);
assert.match(compositeSkill, /def_data_equipment_3plus1_recommend/);
assert.match(compositeSkill, /exactly once/);
for (const state of ['READY', 'NEEDS_INPUT', 'UNRESOLVED']) assert.match(compositeSkill, new RegExp('`' + state + '`'));
assert.match(compositeSkill, /read-only recommendation, not a configuration application/);
for (const tool of legacyThreePlusOneTools) assert.doesNotMatch(compositeSkill, new RegExp(tool));
assert.doesNotMatch(compositeSkill, /artifact|revision|topolog|solver|plannerProfile|capability/i);

for (const file of candidateFiles) {
  assert.ok(fs.existsSync(path.join(project, candidateRoot, file)), `candidate must include stable artifact ${file}`);
}
for (const file of ['knowledge.md', 'role-card.md', 'skills.md']) {
  assert.equal(
    normalizeNewlines(read(`${candidateRoot}/${file}`)),
    normalizeNewlines(read(`agent/harness/baseline/stable-v0/${file}`)),
    `non-teaching stable artifact ${file} must be copied without changes`,
  );
}

const candidateManifest = JSON.parse(read(`${candidateRoot}/manifest.json`));
assert.equal(candidateManifest.harnessId, 'def-equipment-3plus1-composite');
assert.equal(candidateManifest.version, '9.1.0-candidate.1');
assert.equal(candidateManifest.sourceCommit, '7c751740f27e1a8af4a2456520677c4e46d6efc5');
assert.match(candidateManifest.description, /one teaching change/i);
assert.deepEqual(Object.keys(candidateManifest.slots).sort(), [
  'agentContract', 'knowledgePacks', 'responsePolicy', 'roleCards',
  'routingPolicy', 'skills', 'toolGuidance', 'workflows',
]);

const candidateTeaching = [
  read(`${candidateRoot}/agent-contract.md`),
  read(`${candidateRoot}/routing.md`),
  read(`${candidateRoot}/tool-guidance.md`),
  read(`${candidateRoot}/response-policy.md`),
  read(`${candidateRoot}/workflow.md`),
].join('\n');
assert.match(candidateTeaching, /def_data_equipment_3plus1_recommend/);
assert.match(candidateTeaching, /READY/);
assert.match(candidateTeaching, /NEEDS_INPUT/);
assert.match(candidateTeaching, /UNRESOLVED/);
assert.match(candidateTeaching, /read-only/);
assert.match(candidateTeaching, /not an application|does not apply/i);
for (const tool of legacyThreePlusOneTools) {
  const threePlusOneLines = candidateTeaching
    .split(/\r?\n/)
    .filter((line) => line.includes('3+1'))
    .join('\n');
  assert.doesNotMatch(threePlusOneLines, new RegExp(tool));
}

const blackbox = read('docs/testing/def-agent-blackbox.md');
const blackboxStart = blackbox.indexOf('## Read-only equipment 3+1 regression');
const blackboxEnd = blackbox.indexOf('## Support weapon convention regression', blackboxStart);
assert.ok(blackboxStart >= 0 && blackboxEnd > blackboxStart, 'blackbox document must retain its scoped 3+1 regression');
const blackboxThreePlusOne = blackbox.slice(blackboxStart, blackboxEnd);
assert.match(blackboxThreePlusOne, /def_data_equipment_3plus1_recommend[\s\S]{0,80}exactly once/);
for (const tool of legacyThreePlusOneTools) assert.doesNotMatch(blackboxThreePlusOne, new RegExp(tool));
for (const state of ['READY', 'NEEDS_INPUT', 'UNRESOLVED']) assert.match(blackboxThreePlusOne, new RegExp('`' + state + '`'));
assert.match(blackbox, /DefCodexInteropProtocol v1/);
assert.match(blackbox, /Computer Use/);

console.log(JSON.stringify({
  ok: true,
  checks: [
    'base-prompt-removes-legacy-3plus1-chain',
    'native-catalog-remains-available-for-other-legal-uses',
    'runtime-skill-composite-recognition-and-typed-explanation',
    'candidate-stable-copy-and-fixed-ref',
    'candidate-single-composite-teaching-change',
    'blackbox-composite-route-and-interop-ui-evidence',
  ],
}));
