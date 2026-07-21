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
    tideArmor: equipment('tide-armor', '落潮轻甲', '护甲', { strength: effect('力量', 'strengthBoost') }),
    tideGlove: equipment('tide-glove', '潮涌手甲', '护手', { strength: effect('力量', 'strengthBoost') }),
    tideAccessoryOne: equipment('tide-accessory-1', '悬河供氧栓', '配件', { strength: effect('力量', 'strengthBoost') }),
    tideAccessoryTwo: equipment('tide-accessory-2', '浊流切割炬', '配件', { intelligence: effect('智识', 'intelligenceBoost') }),
  },
  threePieceBuffs: {
    tideThree: { effectId: 'tide-three', name: '潮涌·所有技能伤害+20%', typeKey: 'allSkillDmgBonus', value: 0.2, unit: 'percent' },
  },
};
const frostSet = {
  gearSetId: 'gear-set-han-liu',
  name: '寒流',
  equipments: {
    frostAccessory: equipment('frost-accessory', '冻原供氧栓', '配件', { strength: effect('力量', 'strengthBoost') }),
  },
};
const equipmentLibrary = { updatedAt: 1, gearSets: { tide: tideSet, frost: frostSet } };
const weaponLibrary = {
  thunder: {
    id: 'weapon-thunder', name: '雷霆', type: '手铳', rarity: 6, description: '完整武器业务资料', imgUrl: 'asset://weapon-thunder',
    attackGrowth: { 1: 50, 90: 500 },
    skills: { skill1: { name: '力量提升', statType: 'strengthBoost', levels: { 1: { value: 20 } } } },
  },
  wind: { id: 'weapon-wind', name: '长风', type: '手铳', rarity: 5, skills: {} },
};

function writeArchive({ equipment = equipmentLibrary, weapon = weaponLibrary } = {}) {
  fs.writeFileSync(nowStoragePath, `${JSON.stringify({
    type: 'def.localdata.archive.v1', schemaVersion: 1, id: 'native-catalog-contract',
    storage: {
      local: {
        'def.equipment-sheet.library.v1': equipment,
        'def.equipment-sheet.draft.v1': {},
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

async function registerNativeSession(sessionId = 'native-catalog-contract-session', { authenticated = true } = {}) {
  const response = await fetch(`${baseUrl}/api/def-tools/call`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authenticated ? { 'x-def-internal-token': 'native-catalog-contract' } : {}),
    },
    body: JSON.stringify({ tool: 'def.native_catalog.register_session', input: { sessionId, host: 'ai-cli' } }),
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
  const registration = await registerNativeSession();
  assert.equal(registration.response.status, 200, JSON.stringify(registration.payload));
  assert.equal(registration.payload.result?.host, 'ai-cli');

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
  assert.equal(threePlusOne.contract, 'DefEquipmentThreePlusOneFactsV1');
  assert.equal(threePlusOne.state, 'REQUIRES_ATTRIBUTE_PREFERENCE');
  assert.equal(threePlusOne.targetSetPieceCount, 3);
  assert.equal(threePlusOne.structuresExhaustive, true);
  assert.equal(threePlusOne.structures.length, 2, 'two target-set accessories produce two evidence structures');
  const firstStructure = threePlusOne.structures[0];
  assert.deepEqual(firstStructure.setPieces.map((item) => item.slot), ['armor', 'glove', 'accessory1']);
  assert.ok(firstStructure.setPieces.every((item) => item.stableId && item.fixedStat?.typeKey === 'defense' && item.effects && item.selectionReason));
  assert.equal(firstStructure.plusOne.slot, 'accessory2');
  assert.equal(firstStructure.plusOne.candidatesExhaustive, true);
  assert.equal(firstStructure.plusOne.candidates.length, 1);
  assert.equal(firstStructure.plusOne.candidates[0].stableId, 'frost-accessory');
  assert.match(firstStructure.plusOne.selectionReason, /unranked/i);
  assert.equal(threePlusOne.missingReasons[0].code, 'attribute-preference-required');
  assert.match(threePlusOne.nextAction, /do not recommend or apply/i);

  const aliasSet = await call({ domain: 'equipment', query: 'ｔｉｄｅ　ｓｕｒｇｅ套' });
  assert.equal(aliasSet.selectionMode, 'entity-full');
  assert.equal(JSON.parse(aliasSet.files[0].content).id, 'gear-set-chao-yong', 'NFKC-normalized safe alias must resolve the exact set');

  const strength = await call({ domain: 'equipment', query: '力量' });
  assert.equal(strength.selectionMode, 'substring-minimal');
  const strengthRecords = strength.files[0].content.trim().split('\n').map((line) => JSON.parse(line));
  const expectedStrengthIds = ['frost-accessory', 'tide-accessory-1', 'tide-armor', 'tide-glove'];
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
  assert.equal(fallback.files[0].records, 2);

  const sameValueDifferentKeyOrder = {
    gearSets: { frost: frostSet, tide: tideSet },
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

  console.log(JSON.stringify({
    ok: true,
    checks: ['native-session-registration-required', 'workbench-session-registration-recovery', 'exact-set-full', '3plus1-full-facts-unranked', 'safe-alias-nfkc', 'two-accessories', 'substring-oracle', 'weapon-full', 'fallback', 'key-order-revision', 'changed-revision', '3plus1-stale-revision'],
  }));
} finally {
  child.kill('SIGTERM');
  fs.rmSync(root, { recursive: true, force: true });
}
