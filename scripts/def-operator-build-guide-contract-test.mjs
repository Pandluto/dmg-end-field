import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  discoverOperatorBuildGuides,
  extractGuideBuildStrategy,
} from './def-core/operator-build-evidence.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-operator-build-guide-'));
const port = 19700 + Math.floor(Math.random() * 200);
const baseUrl = `http://127.0.0.1:${port}`;
const nowStoragePath = path.join(root, 'now-storage.json');

function skill(displayName, buttonType, peakMultipliers) {
  return {
    displayName,
    buttonType,
    hitMeta: Object.fromEntries(peakMultipliers.map((value, index) => [
      `hit${index + 1}`,
      { displayName: `${displayName}-${index + 1}`, levels: { L1: value / 2, M3: value } },
    ])),
  };
}

const operators = {
  bieli: {
    id: 'bieli',
    name: '别礼',
    element: 'ice',
    profession: '突击',
    mainStat: '力量',
    subStat: '意志',
    skills: {
      'skill-A-1': skill('严霜之舞', 'A', [2]),
      'skill-E-1': skill('噬冬', 'E', [1.6, 1.6]),
      'skill-Q-1': skill('临终别礼', 'Q', [4, 4, 8]),
    },
    buffs: {
      potential: {
        effects: {
          e1: {
            name: '三潜·连携+终结倍率×1.15',
            description: '连携技噬冬和终结技临终别礼伤害倍率提高。',
          },
        },
      },
    },
  },
  mifu: {
    id: 'mifu',
    name: '弭弗',
    element: 'physical',
    profession: '突击',
    mainStat: '力量',
    subStat: '敏捷',
    skills: { 'skill-Q-1': skill('决心', 'Q', [8]) },
  },
  incomplete: {
    id: 'incomplete',
    name: '证据不全干员',
    profession: '突击',
    skills: {},
  },
};

const partialReferenceText = '## 别礼装备\n词条优先力量。\n';
const partialStrategy = extractGuideBuildStrategy(partialReferenceText, {
  evidenceRef: 'guide:synthetic-bieli#bieli-build',
  setQuery: '潮涌',
});
assert.equal(partialStrategy.sufficientForPlanner, false);
assert.deepEqual(partialStrategy.preferenceGroups.map((group) => group.acceptedTypeKeys), [['strengthBoost']]);
const partialDiscovery = discoverOperatorBuildGuides([{
  id: 'synthetic-bieli',
  title: '别礼养成',
  text: partialReferenceText,
  lineOffsets: [0, partialReferenceText.indexOf('\n') + 1, partialReferenceText.length],
  index: {
    headings: [{
      sectionId: 'bieli-build',
      heading: '别礼装备',
      level: 2,
      parentSectionId: null,
      lineStart: 0,
      lineEnd: 2,
    }],
  },
}], { id: 'bieli', name: '别礼' }, { goal: 'damage', setQuery: '潮涌' });
assert.equal(partialDiscovery.state, 'PARTIAL_GUIDE_FOUND');
assert.deepEqual(partialDiscovery.candidates[0].strategy.preferenceGroups.map((group) => group.key), ['primary-strength']);

const negativeContextStrategy = extractGuideBuildStrategy(
  '## 别礼装备\n不推荐力量，终结技伤害收益低。优先意志和寒冷伤害。',
  { evidenceRef: 'guide:synthetic-negative#build', setQuery: '潮涌' },
);
assert.deepEqual(
  negativeContextStrategy.preferenceGroups.map((group) => group.key),
  ['secondary-will', 'ice-damage'],
  'negated and explicitly low-priority matches must not enter the positive planner profile',
);
assert.deepEqual(
  negativeContextStrategy.excludedMatches.map((match) => match.key).sort(),
  ['primary-strength', 'ultimate-damage'],
);
assert.equal(negativeContextStrategy.sufficientForPlanner, true);

const negativeOnlyStrategy = extractGuideBuildStrategy(
  '## 别礼装备\n不推荐力量，也不建议终结技伤害。',
  { evidenceRef: 'guide:synthetic-negative-only#build', setQuery: '潮涌' },
);
assert.deepEqual(negativeOnlyStrategy.preferenceGroups, []);
assert.equal(negativeOnlyStrategy.sufficientForPlanner, false);

fs.writeFileSync(nowStoragePath, `${JSON.stringify({
  type: 'def.localdata.archive.v1',
  schemaVersion: 1,
  id: 'operator-build-guide-contract',
  storage: {
    local: { 'def.operator-editor.library.v1': operators },
    session: {},
  },
}, null, 2)}\n`, 'utf8');

const child = spawn(process.execPath, ['scripts/ai-cli-rest-server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AI_CLI_REST_PORT: String(port),
    AI_CLI_NOW_STORAGE_PATH: nowStoragePath,
    AI_CLI_REST_VITE_CACHE_DIR: path.join(root, 'vite'),
    AI_TIMELINE_WORK_NODE_DB_PATH: path.join(root, 'nodes.sqlite3'),
    AI_TIMELINE_WORK_NODE_LEGACY_PATH: path.join(root, 'nodes.json'),
    TIMELINE_REPOSITORY_DB_PATH: path.join(root, 'timeline.sqlite3'),
    DATA_MANAGEMENT_RUNTIME_ROOT: path.join(root, 'data'),
    DEF_TOOL_GOVERNANCE_PATH: path.join(root, 'governance.json'),
    DEF_INTERNAL_GOVERNANCE_TOKEN: 'operator-build-guide-contract',
  },
  stdio: 'ignore',
});

async function waitForReady() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch {
      // Starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for operator build guide contract server.');
}

async function call(tool, input, { sessionId = 'operator-build-session', authenticated = true } = {}) {
  const response = await fetch(`${baseUrl}/api/def-tools/call`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authenticated ? { 'x-def-internal-token': 'operator-build-guide-contract' } : {}),
    },
    body: JSON.stringify({ tool, input, sessionId }),
  });
  return { response, payload: await response.json() };
}

async function register(sessionId) {
  return call('def.native_catalog.register_session', { sessionId, host: 'ai-cli' }, { sessionId: '', authenticated: true });
}

try {
  await waitForReady();

  const unauthenticated = await call('def.operator.build.guide', {
    operatorQuery: '别礼',
    __defTurnId: 'turn-unauthenticated',
  }, { authenticated: false });
  assert.equal(unauthenticated.response.status, 403);
  assert.equal(unauthenticated.payload.error?.code, 'denied-native-build-evidence-session');

  const registration = await register('operator-build-session');
  assert.equal(registration.response.status, 200, JSON.stringify(registration.payload));
  const otherRegistration = await register('another-operator-build-session');
  assert.equal(otherRegistration.response.status, 200, JSON.stringify(otherRegistration.payload));

  const missingTurn = await call('def.operator.build.guide', { operatorQuery: '别礼' });
  assert.equal(missingTurn.response.status, 409);
  assert.equal(missingTurn.payload.error?.code, 'operator-build-turn-identity-required');

  const guide = await call('def.operator.build.guide', {
    operatorQuery: '别礼',
    goal: '优先伤害',
    setQuery: '潮涌',
    __defTurnId: 'turn-bieli',
  });
  assert.equal(guide.response.status, 200, JSON.stringify(guide.payload));
  assert.equal(guide.payload.result.state, 'GUIDE_NOT_FOUND');
  assert.equal(guide.payload.result.operator.id, 'bieli');
  assert.equal(guide.payload.result.candidates.length, 0, 'generic guides for other operators must not become a Bieli guide hit');
  assert.ok(guide.payload.result.fallbackToken);

  const repeatedGuide = await call('def.operator.build.guide', {
    operatorQuery: '别礼',
    goal: '优先伤害',
    setQuery: '潮涌',
    __defTurnId: 'turn-bieli',
  });
  assert.equal(repeatedGuide.response.status, 200, JSON.stringify(repeatedGuide.payload));
  assert.equal(repeatedGuide.payload.result.reused, true);
  assert.equal(repeatedGuide.payload.result.fallbackToken, guide.payload.result.fallbackToken);

  const crossTurn = await call('def.operator.build.profile', {
    operatorQuery: '别礼',
    fallbackToken: guide.payload.result.fallbackToken,
    __defTurnId: 'turn-other',
  });
  assert.equal(crossTurn.response.status, 409);
  assert.equal(crossTurn.payload.error?.code, 'operator-build-fallback-scope-mismatch');

  const crossSession = await call('def.operator.build.profile', {
    operatorQuery: '别礼',
    fallbackToken: guide.payload.result.fallbackToken,
    __defTurnId: 'turn-bieli',
  }, { sessionId: 'another-operator-build-session' });
  assert.equal(crossSession.response.status, 409);
  assert.equal(crossSession.payload.error?.code, 'operator-build-fallback-scope-mismatch');

  const wrongOperator = await call('def.operator.build.profile', {
    operatorQuery: '弭弗',
    fallbackToken: guide.payload.result.fallbackToken,
    __defTurnId: 'turn-bieli',
  });
  assert.equal(wrongOperator.response.status, 409);
  assert.equal(wrongOperator.payload.error?.code, 'operator-build-fallback-operator-mismatch');

  const profile = await call('def.operator.build.profile', {
    operatorQuery: '别礼',
    fallbackToken: guide.payload.result.fallbackToken,
    __defTurnId: 'turn-bieli',
  });
  assert.equal(profile.response.status, 200, JSON.stringify(profile.payload));
  assert.equal(profile.payload.result.contract, 'DefOperatorBuildProfileV1');
  assert.equal(profile.payload.result.state, 'PROFILE_READY');
  assert.deepEqual(profile.payload.result.skillEvidence.focusSkillTypes, ['Q', 'E']);
  assert.deepEqual(profile.payload.result.keywordLabels, ['终结技伤害', '所有技能伤害', '寒冷伤害', '力量', '意志']);
  assert.deepEqual(profile.payload.result.plannerProfile.preferenceGroups.map((group) => group.kind), [
    'skill-damage',
    'general-damage',
    'elemental-damage',
    'primary-attribute',
    'secondary-attribute',
  ]);
  assert.equal(profile.payload.result.plannerProfile.preferenceGroups.some((group) => group.acceptedTypeKeys.includes('defense')), false);
  assert.match(profile.payload.result.plannerProfileCapability, /^[0-9a-f-]{36}$/);
  assert.match(profile.payload.result.plannerProfileHash, /^[a-f0-9]{64}$/);
  assert.equal(profile.payload.result.authorization.turnBound, true);

  const replay = await call('def.operator.build.profile', {
    operatorQuery: '别礼',
    fallbackToken: guide.payload.result.fallbackToken,
    __defTurnId: 'turn-bieli',
  });
  assert.equal(replay.response.status, 409);
  assert.equal(replay.payload.error?.code, 'operator-build-fallback-token-invalid');

  const knownGuide = await call('def.operator.build.guide', {
    operatorQuery: '弭弗',
    goal: '伤害',
    __defTurnId: 'turn-mifu',
  });
  assert.equal(knownGuide.response.status, 200, JSON.stringify(knownGuide.payload));
  assert.equal(knownGuide.payload.result.state, 'GUIDE_FOUND');
  assert.equal(knownGuide.payload.result.fallbackToken, null);
  assert.match(knownGuide.payload.result.guide.title, /弭弗/);
  assert.match(knownGuide.payload.result.guide.section.heading, /武器装备养成/);
  assert.ok(knownGuide.payload.result.guide.content.length > 0);
  assert.doesNotMatch(knownGuide.payload.result.guide.content, /## 一、定位分析/);
  assert.match(knownGuide.payload.result.guide.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(knownGuide.payload.result.guide.truncated, false);
  assert.equal(knownGuide.payload.result.plannerProfile.derivation, 'guide');
  assert.ok(knownGuide.payload.result.plannerProfile.preferenceGroups.length >= 2);
  assert.equal(knownGuide.payload.result.plannerProfile.evidenceRefs[0], `guide-sha256:${knownGuide.payload.result.guide.contentHash}`);
  assert.match(knownGuide.payload.result.plannerProfileCapability, /^[0-9a-f-]{36}$/);
  assert.match(knownGuide.payload.result.plannerProfileHash, /^[a-f0-9]{64}$/);

  const incompleteGuide = await call('def.operator.build.guide', {
    operatorQuery: '证据不全干员',
    goal: '优先伤害',
    __defTurnId: 'turn-incomplete',
  });
  assert.equal(incompleteGuide.response.status, 200, JSON.stringify(incompleteGuide.payload));
  assert.equal(incompleteGuide.payload.result.state, 'GUIDE_NOT_FOUND');
  const incompleteProfile = await call('def.operator.build.profile', {
    operatorQuery: '证据不全干员',
    fallbackToken: incompleteGuide.payload.result.fallbackToken,
    __defTurnId: 'turn-incomplete',
  });
  assert.equal(incompleteProfile.response.status, 200, JSON.stringify(incompleteProfile.payload));
  assert.equal(incompleteProfile.payload.result.state, 'INSUFFICIENT_OPERATOR_EVIDENCE');
  assert.equal(incompleteProfile.payload.result.plannerProfile, null);
  assert.equal(incompleteProfile.payload.result.plannerProfileCapability, null);
  assert.ok(incompleteProfile.payload.result.missing.length >= 3);

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'guide-first-exact-operator',
      'unrelated-guide-rejected',
      'same-turn-guide-resolution-reused',
      'same-session-turn-token-gate',
      'operator-bound-fallback-token',
      'single-use-fallback-token',
      'bieli-skill-priority-profile',
      'planner-profile-no-fixed-stat-confusion',
      'partial-guide-preserved-as-partial',
      'incomplete-profile-fails-closed',
      'guide-profile-capability-bound',
      'bounded-known-guide-section',
    ],
  }));
} finally {
  child.kill('SIGTERM');
  fs.rmSync(root, { recursive: true, force: true });
}
