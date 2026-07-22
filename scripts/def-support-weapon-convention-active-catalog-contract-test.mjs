import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildBuiltinDataCatalog } from './build-data-catalog.mjs';
import {
  createDefActiveGameCatalogSnapshot,
  normalizeDefWeaponCompatibilityMap,
  resolveDefCanonicalWeaponId,
} from './def-core/active-game-catalog-boundary.mjs';
import { loadCombatConventionRules } from './def-core/combat-conventions.mjs';
import { createDefEquipment3Plus1ActiveCatalogReaders } from './def-core/equipment-3plus1-active-catalog-reader.mjs';
import {
  compactTypedFailureDetails,
  expandDefTypedFailureDetails,
  normalizeRequiredDefToolString,
} from '../agent/runtime/def-tools/opencode/typed-failure-details.mjs';

const require = createRequire(import.meta.url);
const { createDataManagementService } = require('../electron/data-management-service.cjs');
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDataRoot = path.join(repositoryRoot, 'public', 'data');
const compatibilityPath = path.join(publicDataRoot, 'catalog-weapon-compatibility.v1.json');
const compatibilityRaw = JSON.parse(fs.readFileSync(compatibilityPath, 'utf8'));
const compatibility = normalizeDefWeaponCompatibilityMap(compatibilityRaw);

// The reviewed mapping must be a complete, one-to-one bridge between public
// catalog identities and the historical weapon ids/types still cited by
// reviewed combat conventions.
const identities = JSON.parse(fs.readFileSync(path.join(publicDataRoot, 'catalog-identities.v1.json'), 'utf8'));
const publicWeapons = fs.readdirSync(path.join(publicDataRoot, 'weapons'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => fs.readdirSync(path.join(publicDataRoot, 'weapons', entry.name), { withFileTypes: true })
    .filter((file) => file.isFile() && file.name.endsWith('.json') && !file.name.endsWith('buff.json'))
    .map((file) => JSON.parse(fs.readFileSync(path.join(publicDataRoot, 'weapons', entry.name, file.name), 'utf8'))));
assert.equal(publicWeapons.length, 27);
assert.equal(compatibility.byStableId.size, publicWeapons.length);
for (const weapon of publicWeapons) {
  const stableId = identities.weapons[weapon.name];
  assert(stableId, `public weapon ${weapon.name} must have a stable id`);
  assert.equal(compatibility.byStableId.get(stableId)?.name, weapon.name);
}

const reviewedArchivePath = path.join(repositoryRoot, compatibilityRaw.reviewedSource.path);
const reviewedArchiveSha256 = crypto.createHash('sha256').update(fs.readFileSync(reviewedArchivePath)).digest('hex');
assert.equal(reviewedArchiveSha256, compatibilityRaw.reviewedSource.sha256);
const reviewedArchive = JSON.parse(fs.readFileSync(reviewedArchivePath, 'utf8'));
const reviewedWeaponLibrary = reviewedArchive.storage.local[compatibilityRaw.reviewedSource.storageKey];
const reviewedByName = new Map();
for (const raw of Object.values(reviewedWeaponLibrary)) {
  const entries = reviewedByName.get(raw.name) || [];
  entries.push(raw);
  reviewedByName.set(raw.name, entries);
}
for (const mapping of compatibility.byStableId.values()) {
  const matches = reviewedByName.get(mapping.name) || [];
  assert.equal(matches.length, 1, `${mapping.name} must resolve once in the reviewed archive`);
  assert(mapping.legacyIds.includes(matches[0].id), `${mapping.name} must preserve reviewed legacy id ${matches[0].id}`);
  assert.equal(mapping.compatibilityType, matches[0].type, `${mapping.name} must preserve reviewed compatibility type`);
}
const conventionRules = loadCombatConventionRules(path.join(repositoryRoot, 'agent', 'runtime', 'def', 'skills', 'game-knowledge', 'conventions')).rules;
for (const matcher of conventionRules.flatMap((rule) => rule.catalogMatchers)) {
  const stableId = resolveDefCanonicalWeaponId(compatibility, matcher.weaponId);
  assert(stableId, `reviewed convention weapon id ${matcher.weaponId} must resolve canonically`);
  const mappedEffects = compatibility.byStableId.get(stableId).skill3EffectAdapters;
  assert(mappedEffects.some((effect) => effect.typeKey === matcher.effectType), `${matcher.weaponId}/${matcher.effectType} must have a reviewed catalog adapter`);
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'def-support-active-catalog-'));
const builtinCatalogPath = path.join(temporaryRoot, 'catalog.sqlite');
const nowStoragePath = path.join(temporaryRoot, 'now-storage.json');
const port = 19900 + Math.floor(Math.random() * 300);
const baseUrl = `http://127.0.0.1:${port}`;

function buildCatalog(dataVersion) {
  return buildBuiltinDataCatalog({
    sourceRoot: publicDataRoot,
    outputPath: builtinCatalogPath,
    dataVersion,
  });
}

buildCatalog('public-support-v1');
fs.writeFileSync(nowStoragePath, `${JSON.stringify({
  type: 'def.localdata.archive.v1',
  schemaVersion: 1,
  id: 'empty-local-product-libraries',
  storage: {
    local: {
      'def.operator-editor.library.v1': {},
      'def.weapon-sheet.library.v1': {},
    },
    session: {},
  },
}, null, 2)}\n`, 'utf8');

const directCatalog = createDataManagementService({
  runtimeDataRoot: path.join(temporaryRoot, 'direct-runtime'),
  builtinCatalogPath,
}).readActiveGameCatalog();
const directSnapshot = createDefActiveGameCatalogSnapshot(directCatalog, {
  weaponCompatibilityMap: compatibility,
  requireWeapons: true,
});
const incompleteCompatibilityRaw = structuredClone(compatibilityRaw);
delete incompleteCompatibilityRaw.weapons['weapon.08bd963603d2022258864354'];
assert.throws(
  () => createDefActiveGameCatalogSnapshot(directCatalog, {
    weaponCompatibilityMap: normalizeDefWeaponCompatibilityMap(incompleteCompatibilityRaw),
    requireWeapons: true,
  }),
  (error) => error?.code === 'BLOCKED_DATA_CONTRACT'
    && error?.retryable === false
    && /compatibility mapping/i.test(error?.message || ''),
);
const saixiStableId = identities.operators['赛希'];
const saixi = directSnapshot.operators[saixiStableId];
assert(saixi);
assert.deepEqual(Object.values(saixi.skills).map((skill) => skill.buttonType), ['A', 'B', 'E', 'Q']);
assert.deepEqual(Object.values(saixi.skills).map((skill) => skill.displayName), ['冷却', '分布式拒绝服务', '压力测试', '栈溢出']);
assert.equal(Object.values(directSnapshot.weapons).filter((weapon) => weapon.compatibilityType === '法术单元').length, 4);
assert.equal(Object.isFrozen(directSnapshot), true);
assert.equal(Object.isFrozen(saixi.skills), true);
const compositeReaders = createDefEquipment3Plus1ActiveCatalogReaders({
  getDataManagementService() {
    return createDataManagementService({
      runtimeDataRoot: path.join(temporaryRoot, 'composite-runtime'),
      builtinCatalogPath,
    });
  },
});
const compositeSaixi = compositeReaders.readOperatorCatalog()[saixiStableId];
assert.deepEqual(Object.values(compositeSaixi.skills).map((skill) => skill.buttonType), ['A', 'B', 'E', 'Q']);
assert.equal(compositeReaders.readEquipmentLibrarySource().source.catalogSha256, directSnapshot.source.catalogSha256);

let childStderr = '';
const child = spawn(process.execPath, ['scripts/ai-cli-rest-server.mjs'], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    AI_CLI_REST_PORT: String(port),
    AI_CLI_NOW_STORAGE_PATH: nowStoragePath,
    AI_CLI_REST_VITE_CACHE_DIR: path.join(temporaryRoot, 'vite'),
    AI_TIMELINE_WORK_NODE_DB_PATH: path.join(temporaryRoot, 'nodes.sqlite3'),
    AI_TIMELINE_WORK_NODE_LEGACY_PATH: path.join(temporaryRoot, 'nodes.json'),
    TIMELINE_REPOSITORY_DB_PATH: path.join(temporaryRoot, 'timeline.sqlite3'),
    DATA_MANAGEMENT_RUNTIME_ROOT: path.join(temporaryRoot, 'runtime'),
    DATA_MANAGEMENT_BUILTIN_CATALOG_PATH: builtinCatalogPath,
    DEF_WEAPON_CATALOG_COMPATIBILITY_PATH: compatibilityPath,
    DEF_TOOL_GOVERNANCE_PATH: path.join(temporaryRoot, 'governance.json'),
    DEF_INTERNAL_GOVERNANCE_TOKEN: 'support-active-catalog-contract',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: true,
});
child.stderr.on('data', (chunk) => { childStderr += chunk.toString('utf8'); });

async function waitForReady() {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Support catalog contract server exited (${child.exitCode}). ${childStderr}`);
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch {
      // Starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for support catalog contract server. ${childStderr}`);
}

async function call(tool, input, sessionId = 'support-active-session') {
  const response = await fetch(`${baseUrl}/api/def-tools/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-def-internal-token': 'support-active-catalog-contract' },
    body: JSON.stringify({ tool, input, sessionId }),
  });
  return { response, payload: await response.json() };
}

async function register() {
  const result = await call('def.native_catalog.register_session', { sessionId: 'support-active-session', host: 'ai-cli' }, '');
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
}

try {
  await waitForReady();
  await register();

  const catalogSearch = await call('def.operator.catalog.search', { query: '赛希', limit: 4 });
  assert.equal(catalogSearch.response.status, 200, JSON.stringify(catalogSearch.payload));
  assert.equal(catalogSearch.payload.result.source, 'active-game-catalog-with-local-overlay');
  assert.equal(catalogSearch.payload.result.officialCount, Object.keys(identities.operators).length);
  assert.equal(catalogSearch.payload.result.localOverlayCount, 0);
  assert.equal(catalogSearch.payload.result.candidates[0].id, saixiStableId);
  assert.equal(catalogSearch.payload.result.candidates[0].provenance, 'active-game-catalog');

  const guide = await call('def.operator.build.guide', {
    operatorQuery: '赛希',
    goal: '武器推荐',
    __defTurnId: 'support-success',
  });
  assert.equal(guide.response.status, 200, JSON.stringify(guide.payload));
  assert.equal(guide.payload.result.operator.id, saixiStableId);
  assert.equal(guide.payload.result.state, 'GUIDE_NOT_FOUND');
  assert.equal(guide.payload.result.catalogSource.dataVersion, 'public-support-v1');
  assert.match(guide.payload.result.catalogSource.catalogSha256, /^[a-f0-9]{64}$/);

  const stableGuide = await call('def.operator.build.guide', {
    operatorQuery: saixiStableId,
    goal: '武器推荐',
    __defTurnId: 'support-success',
  });
  assert.equal(stableGuide.response.status, 200, JSON.stringify(stableGuide.payload));
  assert.equal(stableGuide.payload.result.reused, true);
  assert.equal(stableGuide.payload.result.fallbackToken, guide.payload.result.fallbackToken);

  const conventions = await call('def.knowledge.combat_conventions.resolve', {
    entities: [saixiStableId, '赛希'],
    intents: ['operator-fit', 'weapon-fit'],
    terms: ['武器推荐'],
  });
  assert.equal(conventions.response.status, 200, JSON.stringify(conventions.payload));
  assert.equal(conventions.payload.result.state, 'READY');

  const missingFallback = await call('def.operator.build.profile', {
    operatorQuery: '赛希',
    __defTurnId: 'missing-fallback',
  });
  assert.equal(missingFallback.response.status, 409);
  assert.equal(missingFallback.payload.error.code, 'operator-build-fallback-token-required');
  assert.equal(missingFallback.payload.error.details.retryable, false);
  assert.match(missingFallback.payload.error.details.nextAction, /guide/i);

  const profile = await call('def.operator.build.profile', {
    operatorQuery: saixiStableId,
    fallbackToken: guide.payload.result.fallbackToken,
    conventionBundleHash: conventions.payload.result.bundleHash,
    __defTurnId: 'support-success',
  });
  assert.equal(profile.response.status, 200, JSON.stringify(profile.payload));
  assert.equal(profile.payload.result.state, 'PROFILE_READY');
  assert.deepEqual(profile.payload.result.skillEvidence.skills.map((skill) => skill.skillType), ['A', 'B', 'E', 'Q']);
  assert.deepEqual(profile.payload.result.skillEvidence.focusSkillTypes, ['Q', 'B', 'E']);
  assert.deepEqual(profile.payload.result.catalogSource, guide.payload.result.catalogSource);

  const missingCapability = await call('def.weapon.fit.plan', {
    operatorQuery: '赛希',
    conventionBundleHash: conventions.payload.result.bundleHash,
    characterProfile: profile.payload.result.plannerProfile,
    __defTurnId: 'missing-capability',
  });
  assert.equal(missingCapability.response.status, 409);
  assert.equal(missingCapability.payload.error.code, 'equipment-3plus1-profile-capability-required');
  assert.equal(missingCapability.payload.error.details.retryable, false);
  assert.match(missingCapability.payload.error.details.nextAction, /guide\/profile/i);

  const plan = await call('def.weapon.fit.plan', {
    operatorQuery: '赛希',
    conventionBundleHash: conventions.payload.result.bundleHash,
    characterProfile: profile.payload.result.plannerProfile,
    plannerProfileCapability: profile.payload.result.plannerProfileCapability,
    goal: '武器推荐',
    shortlistLimit: 3,
    __defTurnId: 'support-success',
  });
  assert.equal(plan.response.status, 200, JSON.stringify(plan.payload));
  assert.equal(plan.payload.result.catalogEvidence.compatibleCount, 4);
  assert.equal(plan.payload.result.catalogEvidence.evaluatedCount, 4);
  assert.equal(plan.payload.result.source.dataVersion, 'public-support-v1');
  assert.equal(plan.payload.result.source.catalogSha256, guide.payload.result.catalogSource.catalogSha256);
  assert.deepEqual(plan.payload.result.shortlist.map((candidate) => candidate.id), [
    'weapon.08bd963603d2022258864354',
    'weapon.6beca86909e7732dc7d83b56',
  ]);

  const staleProfileGuide = await call('def.operator.build.guide', {
    operatorQuery: saixiStableId,
    goal: '武器推荐',
    __defTurnId: 'stale-profile',
  });
  assert.equal(staleProfileGuide.response.status, 200, JSON.stringify(staleProfileGuide.payload));
  buildCatalog('public-support-v2');
  const staleProfile = await call('def.operator.build.profile', {
    operatorQuery: saixiStableId,
    fallbackToken: staleProfileGuide.payload.result.fallbackToken,
    conventionBundleHash: conventions.payload.result.bundleHash,
    __defTurnId: 'stale-profile',
  });
  assert.equal(staleProfile.response.status, 409, JSON.stringify(staleProfile.payload));
  assert.equal(staleProfile.payload.error.code, 'operator-build-catalog-revision-stale');
  assert.equal(staleProfile.payload.error.details.retryable, false);
  assert.equal(staleProfile.payload.error.details.expectedSource.dataVersion, 'public-support-v1');
  assert.equal(staleProfile.payload.error.details.actualSource.dataVersion, 'public-support-v2');

  const stalePlannerGuide = await call('def.operator.build.guide', {
    operatorQuery: saixiStableId,
    goal: '武器推荐',
    __defTurnId: 'stale-planner',
  });
  const stalePlannerProfile = await call('def.operator.build.profile', {
    operatorQuery: saixiStableId,
    fallbackToken: stalePlannerGuide.payload.result.fallbackToken,
    conventionBundleHash: conventions.payload.result.bundleHash,
    __defTurnId: 'stale-planner',
  });
  assert.equal(stalePlannerProfile.response.status, 200, JSON.stringify(stalePlannerProfile.payload));
  buildCatalog('public-support-v3');
  const stalePlanner = await call('def.weapon.fit.plan', {
    operatorQuery: saixiStableId,
    conventionBundleHash: conventions.payload.result.bundleHash,
    characterProfile: stalePlannerProfile.payload.result.plannerProfile,
    plannerProfileCapability: stalePlannerProfile.payload.result.plannerProfileCapability,
    __defTurnId: 'stale-planner',
  });
  assert.equal(stalePlanner.response.status, 409, JSON.stringify(stalePlanner.payload));
  assert.equal(stalePlanner.payload.error.code, 'weapon-fit-catalog-revision-stale');
  assert.equal(stalePlanner.payload.error.details.retryable, false);
  assert.equal(stalePlanner.payload.error.details.expectedSource.dataVersion, 'public-support-v2');
  assert.equal(stalePlanner.payload.error.details.actualSource.dataVersion, 'public-support-v3');
} finally {
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
}

// The OpenCode adapter must forward missing-argument requests to the typed
// sidecar boundary and flatten failScript's nested details for model-visible
// recovery instructions. It must never throw a JavaScript `.trim()` TypeError.
try {
  const nestedProfileFailure = {
    code: 'operator-build-fallback-token-required',
    message: 'fallbackToken is required',
    details: { retryable: false, nextAction: 'Restart guide discovery.' },
  };
  assert.deepEqual(compactTypedFailureDetails(nestedProfileFailure), {
    retryable: false,
    failureStage: undefined,
    nextAction: 'Restart guide discovery.',
    catalogIssues: [],
  });
  assert.equal(expandDefTypedFailureDetails(nestedProfileFailure).retryable, false);
  assert.equal(expandDefTypedFailureDetails(nestedProfileFailure).nextAction, 'Restart guide discovery.');
  assert.equal(normalizeRequiredDefToolString(undefined), '');
  assert.equal(normalizeRequiredDefToolString(null), '');
  assert.equal(normalizeRequiredDefToolString('  capability  '), 'capability');
  const adapterSource = fs.readFileSync(path.join(repositoryRoot, 'agent', 'runtime', 'def-tools', 'opencode', 'def.js'), 'utf8');
  assert.match(adapterSource, /fallbackToken:\s*normalizeRequiredDefToolString\(args\.fallbackToken\)/);
  assert.match(adapterSource, /plannerProfileCapability:\s*normalizeRequiredDefToolString\(args\.plannerProfileCapability\)/);
  assert.match(adapterSource, /failureDetails\?\.retryable === false/);
} finally {
  // Windows may release SQLite file handles slightly after child exit. This
  // temporary cleanup cannot turn a passing catalog contract into a product
  // failure.
  try {
    fs.rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (error?.code !== 'EBUSY') throw error;
  }
}

console.log(JSON.stringify({
  ok: true,
  checks: [
    'real-public-data-catalog',
    'empty-local-product-libraries',
    'chinese-and-stable-operator-id',
    'official-four-skill-adapter',
    'composite-shared-official-operator-adapter',
    'reviewed-compatibility-and-legacy-integrity',
    'blocked-data-contract-on-missing-mapping',
    'catalog-revision-stale-fail-closed',
    'missing-token-and-capability-typed-errors',
    'nested-next-action-visible-to-adapter',
    'official-selection-catalog-provenance',
  ],
}));
