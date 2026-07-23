import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-native-catalog-'));
const port = 19380 + Math.floor(Math.random() * 300);
const nowStoragePath = path.join(root, 'now-storage.json');
const baseUrl = `http://127.0.0.1:${port}`;

function effect(label, typeKey, levels = { 0: 1, 3: 4 }) {
  return { effectId: `effect-${typeKey}`, label, typeKey, unit: 'flat', levels };
}

function equipment(id, name, part, effects) {
  return {
    equipmentId: id,
    name,
    part,
    imgUrl: `asset://${id}`,
    fixedStat: { label: '防御力', typeKey: 'defense', value: 42, unit: 'flat' },
    effects,
  };
}

const tideSet = {
  gearSetId: 'gear-set-chao-yong',
  name: '潮涌',
  equipments: {
    tideArmor: equipment('tide-armor', '落潮轻甲', '护甲', {
      intelligence: effect('智识', 'intelligenceBoost'),
      strength: effect('力量', 'strengthBoost'),
      ultimateCharge: effect('终结技充能效率', 'ultimateChargeEfficiency'),
    }),
    tideGlove: equipment('tide-glove', '潮涌手甲', '护手', {
      strength: effect('力量', 'strengthBoost'),
      will: effect('意志', 'willBoost'),
      cold: effect('寒冷和电磁伤害', 'iceElectricDmgBonus'),
    }),
    tideAccessoryOne: equipment('tide-accessory-1', '悬河供氧栓', '配件', {
      strength: effect('力量', 'strengthBoost'),
      will: effect('意志', 'willBoost'),
      cold: effect('寒冷和电磁伤害', 'iceElectricDmgBonus'),
    }),
    tideAccessoryTwo: equipment('tide-accessory-2', '浊流切割炬', '配件', {
      intelligence: effect('智识', 'intelligenceBoost'),
      strength: effect('力量', 'strengthBoost'),
      normal: effect('普攻伤害', 'normalAttackDmgBonus'),
    }),
  },
  threePieceBuffs: {
    tideThree: { effectId: 'tide-three', name: '潮涌·所有技能伤害+20%', typeKey: 'allSkillDmgBonus', value: 0.2, unit: 'percent' },
  },
};
tideSet.equipments.tideArmor.fixedStat = {
  label: '意志（固定栏诱饵）',
  typeKey: 'willBoost',
  value: 999,
  unit: 'flat',
};
const frostSet = {
  gearSetId: 'gear-set-han-liu',
  name: '寒流',
  equipments: {
    frostArmor: equipment('frost-armor', '冻原轻甲', '护甲', {
      strength: effect('力量', 'strengthBoost'),
      will: effect('意志', 'willBoost'),
      ultimate: effect('终结技伤害加成', 'ultimateDmgBonus'),
    }),
    frostGlove: equipment('frost-glove', '冻原护手', '护手', { agility: effect('灵巧', 'agilityBoost') }),
    frostAccessory: equipment('frost-accessory', '冻原供氧栓', '配件', { strength: effect('力量', 'strengthBoost') }),
  },
};
const bulkEquipments = {};
for (let index = 0; index < 47; index += 1) {
  bulkEquipments[`armor${index}`] = equipment(`bulk-armor-${String(index).padStart(2, '0')}`, `批量护甲${index}`, '护甲', { agility: effect('灵巧', 'agilityBoost') });
}
for (let index = 0; index < 42; index += 1) {
  bulkEquipments[`glove${index}`] = equipment(`bulk-glove-${String(index).padStart(2, '0')}`, `批量护手${index}`, '护手', { agility: effect('灵巧', 'agilityBoost') });
}
for (let index = 0; index < 64; index += 1) {
  bulkEquipments[`accessory${index}`] = equipment(`bulk-accessory-${String(index).padStart(2, '0')}`, `批量配件${index}`, '配件', { agility: effect('灵巧', 'agilityBoost') });
}
const bulkSet = { gearSetId: 'gear-set-bulk', name: '批量测试', equipments: bulkEquipments };
const equipmentLibrary = { updatedAt: 1, gearSets: { tide: tideSet, frost: frostSet, bulk: bulkSet } };
const operatorLibrary = {
  bieli: {
    id: 'bieli',
    name: '别礼',
    element: 'ice',
    profession: '突击',
    mainStat: '力量',
    subStat: '意志',
    skills: {
      q: {
        displayName: '临终别礼',
        buttonType: 'Q',
        hitMeta: {
          q1: { levels: { M3: 4 } },
          q2: { levels: { M3: 4 } },
          q3: { levels: { M3: 8 } },
        },
      },
      e: {
        displayName: '噬冬',
        buttonType: 'E',
        hitMeta: {
          e1: { levels: { M3: 1.6 } },
          e2: { levels: { M3: 1.6 } },
        },
      },
    },
    buffs: {
      skill: {
        effects: {
          e1: { name: '连携技噬冬额外伤害', description: '连携技伤害提高。' },
        },
      },
    },
  },
};
const weaponLibrary = {
  thunder: {
    id: 'weapon-thunder', name: '雷霆', type: '手铳', rarity: 6, description: '完整武器业务资料', imgUrl: 'asset://weapon-thunder',
    attackGrowth: { 1: 50, 90: 500 },
    skills: { skill1: { name: '力量提升', statType: 'strengthBoost', levels: { 1: { value: 20 } } } },
  },
  wind: { id: 'weapon-wind', name: '长风', type: '手铳', rarity: 5, skills: {} },
};

function writeArchive({ equipment = equipmentLibrary, weapon = weaponLibrary, operator = operatorLibrary } = {}) {
  fs.writeFileSync(nowStoragePath, `${JSON.stringify({
    type: 'def.localdata.archive.v1', schemaVersion: 1, id: 'native-catalog-contract',
    storage: {
      local: {
        'def.equipment-sheet.library.v1': equipment,
        'def.equipment-sheet.draft.v1': {},
        'def.operator-editor.library.v1': operator,
        'def.weapon-sheet.library.v1': weapon,
      },
      session: {},
    },
  }, null, 2)}\n`, 'utf8');
}

writeArchive();
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
    DEF_INTERNAL_GOVERNANCE_TOKEN: 'native-catalog-contract',
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
  throw new Error('Timed out waiting for native catalog bridge server.');
}

async function requestNativeTool(tool, input, { authenticated = true, sessionId = 'native-catalog-contract-session' } = {}) {
  const response = await fetch(`${baseUrl}/api/def-tools/call`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authenticated ? { 'x-def-internal-token': 'native-catalog-contract' } : {}),
    },
    body: JSON.stringify({ tool, input, ...(sessionId ? { sessionId } : {}) }),
  });
  const payload = await response.json();
  return { response, payload };
}

async function requestNativeCatalog(input, options = {}) {
  return requestNativeTool('def.native_catalog.materialize', input, options);
}

async function requestInternalRest(pathname, method, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-def-internal-token': 'native-catalog-contract' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

async function registerNativeSession(sessionId = 'native-catalog-contract-session', { authenticated = true, host = 'workbench' } = {}) {
  const response = await fetch(`${baseUrl}/api/def-tools/call`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authenticated ? { 'x-def-internal-token': 'native-catalog-contract' } : {}),
    },
    body: JSON.stringify({ tool: 'def.native_catalog.register_session', input: { sessionId, host } }),
  });
  const payload = await response.json();
  return { response, payload };
}

async function call(input) {
  const { response, payload } = await requestNativeCatalog(input);
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.ok, true, JSON.stringify(payload));
  return payload.result;
}

async function callThreePlusOneFacts(input) {
  const { response, payload } = await requestNativeTool('def.equipment.3plus1.facts', input);
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.ok, true, JSON.stringify(payload));
  return payload.result;
}

async function callEquipmentSetFitShortlist(input) {
  const { response, payload } = await requestNativeTool('def.equipment.set_fit.shortlist', input);
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.ok, true, JSON.stringify(payload));
  return payload.result;
}

async function callThreePlusOnePlan(input) {
  const { response, payload } = await requestNativeTool('def.equipment.3plus1.plan', input);
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.ok, true, JSON.stringify(payload));
  return payload.result;
}

async function expectThreePlusOnePlanFailure(input, expectedCode) {
  const { response, payload } = await requestNativeTool('def.equipment.3plus1.plan', input);
  assert.equal(response.status, 409, JSON.stringify(payload));
  assert.equal(payload.ok, false, JSON.stringify(payload));
  assert.equal(payload.error?.code, expectedCode, JSON.stringify(payload));
  return payload.error;
}

async function issueBieliPlannerEvidence(turnId) {
  const guideCall = await requestNativeTool('def.operator.build.guide', {
    operatorQuery: '别礼',
    goal: 'damage',
    setQuery: '潮涌套',
    __defTurnId: turnId,
  });
  assert.equal(guideCall.response.status, 200, JSON.stringify(guideCall.payload));
  assert.equal(guideCall.payload.ok, true, JSON.stringify(guideCall.payload));
  const guide = guideCall.payload.result;
  assert.equal(guide.operator?.id, 'bieli');
  assert.ok(
    guide.state === 'GUIDE_NOT_FOUND' || guide.state === 'PARTIAL_GUIDE_FOUND',
    `the fixture operator has no complete allowlisted guide and must authorize fallback: ${JSON.stringify(guide)}`,
  );
  assert.equal(typeof guide.fallbackToken, 'string');
  assert.ok(guide.fallbackToken.length >= 20);

  const profileCall = await requestNativeTool('def.operator.build.profile', {
    operatorQuery: '别礼',
    fallbackToken: guide.fallbackToken,
    __defTurnId: turnId,
  });
  assert.equal(profileCall.response.status, 200, JSON.stringify(profileCall.payload));
  assert.equal(profileCall.payload.ok, true, JSON.stringify(profileCall.payload));
  const profile = profileCall.payload.result;
  assert.equal(profile.state, 'PROFILE_READY', JSON.stringify(profile));
  assert.equal(profile.plannerProfile?.characterId, 'bieli');
  assert.deepEqual(profile.plannerProfile?.keywords, ['终结技伤害', '所有技能伤害', '寒冷伤害', '力量', '意志']);
  assert.equal(typeof profile.plannerProfileCapability, 'string');
  assert.ok(profile.plannerProfileCapability.length >= 20);
  assert.equal(profile.authorization?.sessionBound, true);
  assert.equal(profile.authorization?.turnBound, true);
  return {
    guide,
    profile: profile.plannerProfile,
    capability: profile.plannerProfileCapability,
    turnId,
  };
}

try {
  await waitForReady();

  const noNativeAuthority = await requestNativeCatalog({ domain: 'equipment', query: '潮涌套' }, { authenticated: false });
  assert.equal(noNativeAuthority.response.status, 403);
  assert.equal(noNativeAuthority.payload.error?.code, 'denied-native-catalog-session');
  const noSessionIdentity = await requestNativeCatalog({ domain: 'equipment', query: '潮涌套' }, { sessionId: '' });
  assert.equal(noSessionIdentity.response.status, 403);
  assert.equal(noSessionIdentity.payload.error?.code, 'denied-native-catalog-session');
  const unregisteredSession = await requestNativeCatalog({ domain: 'equipment', query: '潮涌套' }, { sessionId: 'unregistered-native-session' });
  assert.equal(unregisteredSession.response.status, 403);
  assert.equal(unregisteredSession.payload.error?.code, 'denied-native-catalog-session');
  const untrustedRegistration = await registerNativeSession('untrusted-native-session', { authenticated: false });
  assert.equal(untrustedRegistration.response.status, 403);
  assert.equal(untrustedRegistration.payload.error?.code, 'denied-internal-governance');
  const disabledHostRegistration = await registerNativeSession('disabled-ai-cli-session', { host: 'ai-cli' });
  assert.equal(disabledHostRegistration.response.status, 410, JSON.stringify(disabledHostRegistration.payload));
  assert.equal(disabledHostRegistration.payload.error?.code, 'DEF_OPENCODE_HOST_DISABLED');
  const registration = await registerNativeSession();
  assert.equal(registration.response.status, 200, JSON.stringify(registration.payload));
  assert.equal(registration.payload.result?.host, 'workbench');

  // A sidecar restart clears the ephemeral registration map, but it must not
  // leave an authenticated native Workbench session locked out when its formal
  // SQLite binding is still live.  Recovery is intentionally unavailable to
  // the unbound session asserted above.
  const recoveryTimeline = await requestInternalRest('/api/timeline-documents', 'POST', {
    id: 'native-catalog-recovery-workbench', label: 'Native catalog recovery',
  });
  assert.equal(recoveryTimeline.response.status, 200, JSON.stringify(recoveryTimeline.payload));
  const recoveryBinding = await requestNativeTool('def.workbench.bind_session_axis', {
    sessionBindingId: 'native-catalog-recovery-axis',
    sessionID: 'native-catalog-recovery-session',
    host: 'workbench',
    timelineId: 'native-catalog-recovery-workbench',
  }, { sessionId: '' });
  assert.equal(recoveryBinding.response.status, 200, JSON.stringify(recoveryBinding.payload));
  const recoveredMaterialize = await requestNativeCatalog(
    { domain: 'equipment', query: '潮涌套' },
    { sessionId: 'native-catalog-recovery-session' },
  );
  assert.equal(recoveredMaterialize.response.status, 200, JSON.stringify(recoveredMaterialize.payload));
  assert.equal(recoveredMaterialize.payload.result?.contract, 'DefNativeCatalogArtifactV1');

  const set = await call({ domain: 'equipment', query: '潮涌套' });
  assert.equal(set.contract, 'DefNativeCatalogArtifactV1');
  assert.equal(set.selectionMode, 'entity-full');
  assert.equal(set.files[0].path, 'entity.full.json');
  const fullSet = JSON.parse(set.files[0].content);
  assert.equal(fullSet.id, 'gear-set-chao-yong');
  assert.equal(fullSet.equipments.length, 4);
  assert.equal(fullSet.equipments.filter((item) => item.part === '配件').length, 2);
  assert.equal(fullSet.threePieceBuffs.tideThree.name, '潮涌·所有技能伤害+20%');
  assert.equal(JSON.stringify(fullSet).includes('寒流'), false, 'exact set must not leak another set');

  const threePlusOne = await callThreePlusOneFacts({
    sourceRevision: set.source.revision,
    setQuery: '潮涌套',
    characterId: 'bieli',
  });
  assert.equal(threePlusOne.contract, 'DefEquipmentThreePlusOneFactsV2');
  assert.equal(threePlusOne.state, 'READY_FOR_CHARACTER_PROFILE');
  assert.equal(threePlusOne.minimumSupportedSetPieces, 3);
  assert.equal(threePlusOne.topologiesExhaustive, true);
  assert.equal(Object.hasOwn(threePlusOne, 'structures'), false, 'the compatibility alias must not duplicate every topology');
  assert.equal(threePlusOne.outputShape.candidatePoolsEmbedded, false);
  assert.equal(threePlusOne.topologies.length, 5, 'four possible off-set slots plus the all-target topology satisfy minimum-three semantics');
  assert.ok(threePlusOne.topologies.every((topology) => topology.status === 'AVAILABLE'));
  const offSetArmor = threePlusOne.topologies.find((topology) => topology.id === 'off-set-armor');
  assert.deepEqual(offSetArmor.targetSlots.map((item) => item.slot), ['glove', 'accessory1', 'accessory2']);
  assert.equal(offSetArmor.offSetSlot.slot, 'armor');
  assert.equal(offSetArmor.candidateCounts.offSet, 48, 'the summary proves the full realistic armor pool without embedding it');
  assert.equal(threePlusOne.duplicatePolicy.allowedAcrossDistinctCompatibleAccessorySlots, true);
  assert.ok(threePlusOne.targetSetCandidateIdsBySlot.accessory1.includes('tide-accessory-1'));
  assert.ok(threePlusOne.targetSetCandidateIdsBySlot.accessory2.includes('tide-accessory-1'), 'the same compatible accessory can be selected once in each real accessory slot');
  const offSetAccessoryTwo = threePlusOne.topologies.find((topology) => topology.id === 'off-set-accessory2');
  assert.deepEqual(offSetAccessoryTwo.targetSlots.map((item) => item.slot), ['armor', 'glove', 'accessory1']);
  assert.equal(offSetAccessoryTwo.candidateCounts.offSet, 65);
  assert.equal(threePlusOne.missingReasons[0].code, 'character-profile-required');
  assert.ok(Buffer.byteLength(JSON.stringify(threePlusOne)) < 24 * 1024, 'realistic 161-piece catalog facts must remain below the bounded output budget');

  const primaryEvidence = await issueBieliPlannerEvidence('native-catalog-bieli-plan-turn-1');
  const primaryPlanInput = {
    sourceRevision: set.source.revision,
    setQuery: '潮涌套',
    characterProfile: primaryEvidence.profile,
    plannerProfileCapability: primaryEvidence.capability,
    __defTurnId: primaryEvidence.turnId,
    minimumSetPieces: 3,
    minimumMatchesPerPiece: 2,
    allowDuplicateCompatibleAccessories: true,
    shortlistLimit: 3,
  };

  const setFit = await callEquipmentSetFitShortlist({
    sourceRevision: set.source.revision,
    characterProfile: primaryEvidence.profile,
    plannerProfileCapability: primaryEvidence.capability,
    __defTurnId: primaryEvidence.turnId,
    shortlistLimit: 3,
  });
  assert.equal(setFit.contract, 'DefEquipmentSetFitShortlistV1');
  assert.equal(setFit.profileEvidence.consumed, false);
  assert.equal(setFit.rankingBasis.reviewedCompleteCatalog, true);
  assert.equal(setFit.shortlist[0].id, 'gear-set-chao-yong');
  assert.ok(setFit.reviewedSets.find((gearSet) => gearSet.id === 'gear-set-han-liu').reasons.some((reason) => reason.code === 'typed-three-piece-buff-unavailable'));

  await expectThreePlusOnePlanFailure({
    ...primaryPlanInput,
    plannerProfileCapability: `${primaryEvidence.capability}-tampered`,
  }, 'equipment-3plus1-profile-capability-invalid');

  const tamperedProfile = structuredClone(primaryEvidence.profile);
  tamperedProfile.keywords.push('模型擅自添加的词条');
  await expectThreePlusOnePlanFailure({
    ...primaryPlanInput,
    characterProfile: tamperedProfile,
  }, 'equipment-3plus1-profile-capability-profile-mismatch');

  await expectThreePlusOnePlanFailure({
    ...primaryPlanInput,
    minimumMatchesPerPiece: 1,
  }, 'equipment-3plus1-plan-constraint-invalid');

  await expectThreePlusOnePlanFailure({
    ...primaryPlanInput,
    shortlistLimit: 4,
  }, 'equipment-3plus1-plan-constraint-invalid');

  const overlappingProfile = structuredClone(primaryEvidence.profile);
  overlappingProfile.preferenceGroups.push({
    key: 'duplicate-strength',
    label: '重复力量',
    kind: 'other',
    acceptedTypeKeys: ['strengthBoost'],
  });
  overlappingProfile.keywords.push('重复力量');
  await expectThreePlusOnePlanFailure({
    ...primaryPlanInput,
    characterProfile: overlappingProfile,
  }, 'equipment-3plus1-preference-type-key-overlap');

  const threePlusOnePlan = await callThreePlusOnePlan({
    ...primaryPlanInput,
  });
  assert.equal(threePlusOnePlan.contract, 'DefEquipmentThreePlusOnePlanV1');
  assert.equal(threePlusOnePlan.state, 'READY');
  assert.equal(threePlusOnePlan.profileEvidence.sessionBound, true);
  assert.equal(threePlusOnePlan.profileEvidence.turnBound, true);
  assert.equal(threePlusOnePlan.searchSpace.exhaustive, true);
  assert.ok(threePlusOnePlan.searchSpace.candidateCombinationCount > 500, 'the planner must score the complete realistic search space internally');
  assert.ok(threePlusOnePlan.shortlist.length <= 3, 'only the requested bounded shortlist may enter model context');
  const bestPlan = threePlusOnePlan.shortlist[0];
  assert.deepEqual(threePlusOnePlan.rankingBasis.closeAlternativeRule, {
    sameQualifiedPieceCount: true,
    sameCoveredPreferenceCount: true,
    maximumWeightedScoreDeficit: 1,
  });
  assert.equal(threePlusOnePlan.searchSpace.outputCandidateCount, threePlusOnePlan.shortlist.length);
  assert.ok(threePlusOnePlan.shortlist.slice(1).every((candidate) => (
    candidate.qualifiedPieceCount === bestPlan.qualifiedPieceCount
    && candidate.coveredPreferenceCount === bestPlan.coveredPreferenceCount
    && bestPlan.weightedScore - candidate.weightedScore <= 1
  )), 'the planner may emit only genuinely close alternatives after the leading plan');
  assert.equal(bestPlan.topologyId, 'off-set-armor');
  assert.equal(bestPlan.setMembershipCount, 3);
  assert.deepEqual(bestPlan.pieces.map((piece) => piece.slot), ['armor', 'glove', 'accessory1', 'accessory2']);
  assert.equal(bestPlan.pieces.find((piece) => piece.slot === 'accessory1').stableId, 'tide-accessory-1');
  assert.equal(bestPlan.pieces.find((piece) => piece.slot === 'accessory2').stableId, 'tide-accessory-1', 'the strongest compatible target accessory is intentionally used in both physical slots');
  assert.deepEqual(bestPlan.duplicateAssignments, [{ stableId: 'tide-accessory-1', name: '悬河供氧栓', slots: ['accessory1', 'accessory2'] }]);
  assert.ok(bestPlan.pieces.every((piece) => piece.matchCount >= 2));
  assert.ok(bestPlan.pieces.every((piece) => Array.isArray(piece.missing) && Array.isArray(piece.ambiguity)));
  assert.ok(bestPlan.pieces.every((piece) => typeof piece.selectionReason === 'string' && piece.selectionReason.length > 0));
  assert.ok(bestPlan.pieces.every((piece) => piece.rankingBasis.every((basis) => basis.facts.every((fact) => fact.path.includes('.effects')))), 'character preferences may match only equipment effects, never fixedStat');
  assert.equal(threePlusOnePlan.rankingBasis.equipmentFixedStatExcluded, true);
  assert.ok(Buffer.byteLength(JSON.stringify(threePlusOnePlan)) < 64 * 1024, 'realistic exhaustive planning must emit a bounded shortlist under 64 KiB');

  await expectThreePlusOnePlanFailure(primaryPlanInput, 'equipment-3plus1-profile-capability-invalid');

  const noDuplicateEvidence = await issueBieliPlannerEvidence('native-catalog-bieli-plan-turn-2');
  const withoutDuplicatePlan = await callThreePlusOnePlan({
    sourceRevision: set.source.revision,
    setQuery: '潮涌套',
    characterProfile: noDuplicateEvidence.profile,
    plannerProfileCapability: noDuplicateEvidence.capability,
    __defTurnId: noDuplicateEvidence.turnId,
    minimumSetPieces: 3,
    minimumMatchesPerPiece: 2,
    allowDuplicateCompatibleAccessories: false,
    shortlistLimit: 1,
  });
  assert.equal(withoutDuplicatePlan.shortlist[0].duplicateAssignments.length, 0, 'the same stable accessory must not be selected twice when the caller disables the compatibility rule');
  assert.notEqual(
    withoutDuplicatePlan.shortlist[0].pieces.find((piece) => piece.slot === 'accessory1').stableId,
    withoutDuplicatePlan.shortlist[0].pieces.find((piece) => piece.slot === 'accessory2').stableId,
  );

  const fourSetEvidence = await issueBieliPlannerEvidence('native-catalog-bieli-plan-turn-3');
  const fourSetPlan = await callThreePlusOnePlan({
    sourceRevision: set.source.revision,
    setQuery: '潮涌套',
    characterProfile: fourSetEvidence.profile,
    plannerProfileCapability: fourSetEvidence.capability,
    __defTurnId: fourSetEvidence.turnId,
    minimumSetPieces: 4,
    minimumMatchesPerPiece: 2,
    allowDuplicateCompatibleAccessories: true,
    shortlistLimit: 1,
  });
  assert.equal(fourSetPlan.shortlist[0].topologyId, 'all-target-set');
  assert.equal(fourSetPlan.shortlist[0].setMembershipCount, 4);
  const tideArmorPlanPiece = fourSetPlan.shortlist[0].pieces.find((piece) => piece.stableId === 'tide-armor');
  assert.equal(tideArmorPlanPiece.fixedStat.typeKey, 'willBoost', 'the fixture fixedStat intentionally looks like a preferred operator attribute');
  assert.equal(tideArmorPlanPiece.matchKeys.includes('secondary-attribute'), false, 'fixedStat must not create a profile match');
  assert.deepEqual(tideArmorPlanPiece.matchKeys, ['primary-attribute']);
  assert.ok(tideArmorPlanPiece.missing.some((entry) => entry.code === 'piece-below-minimum-effect-match'));
  assert.ok(fourSetPlan.shortlist[0].pieces.every((piece) => Array.isArray(piece.missing) && Array.isArray(piece.ambiguity)));

  const tiedEquipmentLibrary = structuredClone(equipmentLibrary);
  tiedEquipmentLibrary.gearSets.frost.equipments.frostArmor.effects = {
    strength: effect('力量', 'strengthBoost'),
  };
  writeArchive({ equipment: tiedEquipmentLibrary });
  const tiedSet = await call({ domain: 'equipment', query: '潮涌套' });
  const tiedEvidence = await issueBieliPlannerEvidence('native-catalog-bieli-plan-turn-4');
  const tiedPlan = await callThreePlusOnePlan({
    sourceRevision: tiedSet.source.revision,
    setQuery: '潮涌套',
    characterProfile: tiedEvidence.profile,
    plannerProfileCapability: tiedEvidence.capability,
    __defTurnId: tiedEvidence.turnId,
    minimumSetPieces: 3,
    minimumMatchesPerPiece: 2,
    allowDuplicateCompatibleAccessories: true,
    shortlistLimit: 1,
  });
  assert.equal(tiedPlan.shortlist[0].topologyId, 'all-target-set', 'four target-set memberships must win when the off-set is only tied, not strictly better');
  assert.equal(tiedPlan.shortlist[0].setMembershipCount, 4);
  writeArchive();

  const aliasSet = await call({ domain: 'equipment', query: 'ｔｉｄｅ　ｓｕｒｇｅ套' });
  assert.equal(aliasSet.selectionMode, 'entity-full');
  assert.equal(JSON.parse(aliasSet.files[0].content).id, 'gear-set-chao-yong', 'NFKC-normalized safe alias must resolve the exact set');

  const strength = await call({ domain: 'equipment', query: '力量' });
  assert.equal(strength.selectionMode, 'substring-minimal');
  const strengthRecords = strength.files[0].content.trim().split('\n').map((line) => JSON.parse(line));
  const expectedStrengthIds = ['frost-accessory', 'frost-armor', 'tide-accessory-1', 'tide-accessory-2', 'tide-armor', 'tide-glove'];
  assert.deepEqual(strengthRecords.map((record) => record.id).sort(), expectedStrengthIds);
  assert.ok(strengthRecords.every((record) => record.matchedFields.some((field) => field.value === '力量')));
  assert.ok(strengthRecords.every((record) => !Object.hasOwn(record, 'effects')), 'minimal records may not carry unrelated full effects');

  const weapon = await call({ domain: 'weapon', query: '雷霆' });
  assert.equal(weapon.selectionMode, 'entity-full');
  const fullWeapon = JSON.parse(weapon.files[0].content);
  assert.equal(fullWeapon.id, 'weapon-thunder');
  assert.equal(fullWeapon.skills.skill1.name, '力量提升');

  const fallback = await call({ domain: 'equipment', query: '完全不存在的词' });
  assert.equal(fallback.selectionMode, 'domain-full-fallback');
  assert.equal(fallback.files[0].records, 3);
  assert.equal(fallback.files[1].path, 'equipment-items.full.jsonl');
  assert.equal(fallback.files[1].records, 160);

  const duplicateAcrossSets = structuredClone(equipmentLibrary);
  duplicateAcrossSets.gearSets.frost.equipments.frostAccessory.equipmentId = 'tide-accessory-1';
  writeArchive({ equipment: duplicateAcrossSets });
  const duplicateAcrossSetsArtifact = await call({ domain: 'equipment', query: '潮涌套' });
  const duplicateAcrossSetsFull = JSON.parse(duplicateAcrossSetsArtifact.files[0].content);
  assert.equal(
    duplicateAcrossSetsFull.equipments.find((item) => item.equipmentId === 'tide-accessory-1').id,
    'gear-set-chao-yong:tide-accessory-1',
    'raw ids reused by another set must receive a composite catalog-stable identity',
  );
  const duplicateAcrossSetsFacts = await callThreePlusOneFacts({
    sourceRevision: duplicateAcrossSetsArtifact.source.revision,
    setQuery: '潮涌套',
  });
  assert.equal(duplicateAcrossSetsFacts.state, 'READY_FOR_CHARACTER_PROFILE');
  writeArchive();

  const sameValueDifferentKeyOrder = {
    gearSets: { bulk: bulkSet, frost: frostSet, tide: tideSet },
    updatedAt: 1,
  };
  writeArchive({ equipment: sameValueDifferentKeyOrder });
  const stable = await call({ domain: 'equipment', query: '潮涌套' });
  assert.equal(stable.source.revision, set.source.revision, 'source revision must ignore object key order');

  const changed = structuredClone(sameValueDifferentKeyOrder);
  changed.gearSets.tide.equipments.tideArmor.effects.strength.levels[3] = 99;
  writeArchive({ equipment: changed });
  const revised = await call({ domain: 'equipment', query: '潮涌套' });
  assert.notEqual(revised.source.revision, set.source.revision, 'changed catalog business data requires a new source revision');

  const staleFacts = await requestNativeTool('def.equipment.3plus1.facts', {
    sourceRevision: set.source.revision,
    setQuery: '潮涌套',
  });
  assert.equal(staleFacts.response.status, 409);
  assert.equal(staleFacts.payload.error?.code, 'equipment-3plus1-source-revision-stale');

  const invalidIdentityCatalog = structuredClone(changed);
  invalidIdentityCatalog.gearSets.bulk.equipments.armor0.equipmentId = '';
  writeArchive({ equipment: invalidIdentityCatalog });
  const invalidIdentityArtifact = await call({ domain: 'equipment', query: '潮涌套' });
  const invalidIdentityFacts = await requestNativeTool('def.equipment.3plus1.facts', {
    sourceRevision: invalidIdentityArtifact.source.revision,
    setQuery: '潮涌套',
  });
  assert.equal(invalidIdentityFacts.response.status, 409, JSON.stringify(invalidIdentityFacts.payload));
  assert.equal(invalidIdentityFacts.payload.error?.code, 'equipment-3plus1-catalog-invalid');
  assert.ok(invalidIdentityFacts.payload.error?.details?.catalogIssues?.some((issue) => (
    issue.code === 'equipment-catalog-identity-invalid' && issue.stableId === null
  )));

  console.log(JSON.stringify({
    ok: true,
    checks: ['native-session-registration-required', 'workbench-session-registration-recovery', 'exact-set-full', 'guide-profile-capability', 'equipment-set-fit-full-catalog', '3plus1-capability-tamper-replay', '3plus1-minimum-two-matches', '3plus1-maximum-three-shortlist', '3plus1-overlap-fail-closed', '3plus1-bounded-facts', '3plus1-exhaustive-bounded-plan', '3plus1-duplicate-accessory', '3plus1-four-set-tie-preference', '3plus1-fixed-stat-excluded', '3plus1-per-piece-evidence-shape', '3plus1-cross-set-raw-id-canonicalized', '3plus1-stable-id-fail-closed', 'safe-alias-nfkc', 'two-accessories', 'substring-oracle', 'weapon-full', 'fallback', 'key-order-revision', 'changed-revision', '3plus1-stale-revision'],
  }));
} finally {
  child.kill('SIGTERM');
  fs.rmSync(root, { recursive: true, force: true });
}
