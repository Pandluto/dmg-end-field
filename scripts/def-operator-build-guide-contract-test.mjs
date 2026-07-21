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
  saixi: {
    id: 'saixi',
    name: '赛希',
    element: 'ice',
    profession: '辅助',
    weapon: '法术单元',
    mainStat: '意志',
    subStat: '智识',
    skills: {
      'skill-A-1': skill('冷却', 'A', [0.34, 0.36, 0.47, 0.74, 1.24]),
      'skill-B-1': skill('分布式拒绝服务', 'B', [0]),
      'skill-E-1': skill('压力测试', 'E', [4.5]),
      'skill-Q-1': skill('栈溢出', 'Q', [0]),
      'skill-A-2': skill('处决', 'A', [9]),
    },
    buffs: {
      skill: {
        effects: {
          q1: { name: '终结技·每点智识寒冷增幅', typeKey: 'iceAmplify' },
          b1: { name: '战技·法术增幅', typeKey: 'magicAmplify' },
          e1: { name: '连携技·治疗主控并施加冰附着', typeKey: 'healingBonus' },
        },
      },
    },
  },
};

function weaponSkill(name, statType, description) {
  return { name, statType, effects: {}, levels: { 9: { value: 1, description } } };
}

function weaponEffect(name, type, category) {
  return { name, type, category, levels: { 9: 0.28 } };
}

const weapons = {
  knight: {
    id: 'wpn_funnel_0010', name: '骑士精神', type: '法术单元', rarity: 6,
    skills: {
      skill1: weaponSkill('意志提升·大', '意志提升', '意志+156'),
      skill2: weaponSkill('生命提升·大', '生命提升', '最大生命值+78%'),
      skill3: {
        name: '医疗·侵蚀性狂热', statType: 'special',
        effects: {
          heal: weaponEffect('治疗效率提升', 'healingBonus', 'passive'),
          team: weaponEffect('自身技能治疗后·全队攻击力', 'atkPercentBoost', 'condition'),
        },
        levels: { 9: { description: '治疗效率+28%。自身技能治疗后，全队攻击力+25.2%。' } },
      },
    },
  },
  explosive: {
    id: 'wpn_funnel_0008', name: '爆破单元', type: '法术单元', rarity: 6,
    skills: {
      skill1: weaponSkill('主能力提升·大', '主能力提升', '主能力值+132'),
      skill2: weaponSkill('源石技艺强度提升·大', '源石技艺强度提升', '源石技艺强度+78'),
      skill3: {
        name: '迸发·冠军威赫', statType: 'special',
        effects: {
          sub: weaponEffect('副能力提升', 'subStatBoost', 'passive'),
          burst: weaponEffect('法术爆发·目标法术易伤', 'magicVulnerability', 'condition'),
        },
        levels: { 9: { description: '副能力+28%。造成法术爆发时，使目标法术易伤+25.2%。' } },
      },
    },
  },
  mission: {
    id: 'wpn_funnel_0009', name: '使命必达', type: '法术单元', rarity: 6,
    skills: {
      skill1: weaponSkill('意志提升·大', '意志提升', '意志+156'),
      skill2: weaponSkill('终结技充能效率提升·大', '终结技充能效率提升', '终结技充能效率+46.4%'),
      skill3: { name: '个人输出', statType: 'special', effects: {}, levels: { 9: { description: '仅个人输出。' } } },
    },
  },
  lone: {
    id: 'wpn_funnel_0007', name: '孤舟', type: '法术单元', rarity: 6,
    skills: {
      skill1: weaponSkill('意志提升·大', '意志提升', '意志+156'),
      skill2: weaponSkill('攻击力提升·大', '攻击力提升', '攻击力+39%'),
      skill3: { name: '个人输出', statType: 'special', effects: {}, levels: { 9: { description: '仅个人输出。' } } },
    },
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
    local: {
      'def.operator-editor.library.v1': operators,
      'def.weapon-sheet.library.v1': weapons,
    },
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

  const saixiGuide = await call('def.operator.build.guide', {
    operatorQuery: '赛希',
    goal: '武器推荐',
    __defTurnId: 'turn-saixi',
  });
  assert.equal(saixiGuide.response.status, 200, JSON.stringify(saixiGuide.payload));
  assert.equal(saixiGuide.payload.result.state, 'GUIDE_NOT_FOUND');
  assert.equal(saixiGuide.payload.result.evidenceRequirements.combatConvention, 'required-before-role-aware-profile-and-weapon-fit');

  const saixiMissingConvention = await call('def.operator.build.profile', {
    operatorQuery: '赛希',
    fallbackToken: saixiGuide.payload.result.fallbackToken,
    __defTurnId: 'turn-saixi',
  });
  assert.equal(saixiMissingConvention.response.status, 409, JSON.stringify(saixiMissingConvention.payload));
  assert.equal(saixiMissingConvention.payload.error?.code, 'operator-build-convention-bundle-required');

  const saixiConvention = await call('def.knowledge.combat_conventions.resolve', {
    entities: ['saixi', '赛希'],
    intents: ['weapon-fit', 'operator-fit'],
    terms: ['武器推荐'],
  });
  assert.equal(saixiConvention.response.status, 200, JSON.stringify(saixiConvention.payload));
  assert.equal(saixiConvention.payload.result.state, 'READY');
  assert.match(saixiConvention.payload.result.bundleHash, /^[a-f0-9]{64}$/);
  assert.ok(saixiConvention.payload.result.rules.some((rule) => rule.ruleId === 'saixi.knights-spirit-heal-trigger'));
  assert.ok(saixiConvention.payload.result.rules.some((rule) => rule.certainty === 'high-probability'));
  assert.ok(saixiConvention.payload.result.rules.some((rule) => rule.certainty === 'low-probability'));

  const saixiProfile = await call('def.operator.build.profile', {
    operatorQuery: '赛希',
    fallbackToken: saixiGuide.payload.result.fallbackToken,
    conventionBundleHash: saixiConvention.payload.result.bundleHash,
    __defTurnId: 'turn-saixi',
  });
  assert.equal(saixiProfile.response.status, 200, JSON.stringify(saixiProfile.payload));
  assert.equal(saixiProfile.payload.result.state, 'PROFILE_READY');
  assert.equal(saixiProfile.payload.result.plannerProfile.derivation, 'combat-convention-and-skill-analysis');
  assert.deepEqual(saixiProfile.payload.result.keywordLabels, ['可触发的全队增益', '终结技充能效率', '智识']);
  assert.deepEqual(saixiProfile.payload.result.skillEvidence.focusSkillTypes, ['Q', 'B', 'E']);
  assert.equal(saixiProfile.payload.result.preferenceGroups.some((group) => group.key === 'normal-attack-damage'), false);
  assert.equal(saixiProfile.payload.result.preferenceGroups.some((group) => group.key === 'ice-damage'), false);
  assert.equal(saixiProfile.payload.result.preferenceGroups.some((group) => group.acceptedTypeKeys.includes('willBoost')), false);

  const saixiWeaponPlan = await call('def.weapon.fit.plan', {
    operatorQuery: '赛希',
    conventionBundleHash: saixiConvention.payload.result.bundleHash,
    characterProfile: saixiProfile.payload.result.plannerProfile,
    plannerProfileCapability: saixiProfile.payload.result.plannerProfileCapability,
    goal: '武器推荐',
    shortlistLimit: 3,
    __defTurnId: 'turn-saixi',
  });
  assert.equal(saixiWeaponPlan.response.status, 200, JSON.stringify(saixiWeaponPlan.payload));
  const weaponPlan = saixiWeaponPlan.payload.result;
  assert.equal(weaponPlan.contract, 'DefWeaponFitPlanV1');
  assert.equal(weaponPlan.state, 'READY_WITH_TRADEOFFS');
  assert.equal(weaponPlan.catalogEvidence.compatibleCount, 4);
  assert.equal(weaponPlan.catalogEvidence.evaluatedCount, 4);
  assert.equal(weaponPlan.catalogEvidence.exhaustive, true);
  assert.equal(weaponPlan.catalogEvidence.truncated, false);
  assert.equal(weaponPlan.rankingBasis.uniqueOptimalClaimAllowed, false);
  assert.equal(weaponPlan.rankingBasis.crossCandidateTotalOrderAllowed, false);
  assert.equal(weaponPlan.responseConstraints.presentation, 'unordered-tradeoff-matrix');
  assert.equal(weaponPlan.responseConstraints.presentOnly, 'shortlist');
  assert.ok(weaponPlan.responseConstraints.forbiddenUnsourcedClaims.includes('稀有乘区'));
  assert.deepEqual(weaponPlan.shortlist.map((candidate) => candidate.id), ['wpn_funnel_0008', 'wpn_funnel_0010']);
  assert.ok(weaponPlan.shortlist.every((candidate) => candidate.weightedScore === undefined));
  const explosivePlan = weaponPlan.shortlist.find((candidate) => candidate.id === 'wpn_funnel_0008');
  const knightPlan = weaponPlan.shortlist.find((candidate) => candidate.id === 'wpn_funnel_0010');
  assert.match(explosivePlan.fullFacts.skills.skill3.description, /法术爆发/);
  assert.match(knightPlan.fullFacts.skills.skill3.description, /自身技能治疗后/);
  assert.ok(explosivePlan.verifiedReasons.some((reason) => reason.matchedGroupKey === 'secondary-intelligence'));
  assert.ok(explosivePlan.verifiedReasons.some((reason) => reason.certainty === 'high-probability' && reason.triggerActor === 'equipped-operator' && reason.externalActorsMaySatisfy === false));
  assert.ok(knightPlan.verifiedReasons.some((reason) => reason.matchedGroupKey === 'reachable-team-buff'));
  assert.ok(knightPlan.excludedOrUnverifiedReasons.some((reason) => reason.typeKey === 'willBoost'));
  const loneScore = weaponPlan.catalogEvidence.allCandidateEvidence.find((candidate) => candidate.id === 'wpn_funnel_0007');
  assert.equal(loneScore.matchedGroupKeys.includes('reachable-team-buff'), false, 'personal attack must not satisfy a team-buff preference');

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
      'support-convention-required',
      'support-role-aware-profile',
      'complete-compatible-weapon-plan',
      'qualitative-trigger-certainty',
    ],
  }));
} finally {
  child.kill('SIGTERM');
  fs.rmSync(root, { recursive: true, force: true });
}
