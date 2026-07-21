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

async function call(input) {
  const response = await fetch(`${baseUrl}/api/def-tools/call`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool: 'def.native_catalog.materialize', input }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.ok, true, JSON.stringify(payload));
  return payload.result;
}

try {
  await waitForReady();

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

  console.log(JSON.stringify({
    ok: true,
    checks: ['exact-set-full', 'two-accessories', 'substring-oracle', 'weapon-full', 'fallback', 'key-order-revision', 'changed-revision'],
  }));
} finally {
  child.kill('SIGTERM');
  fs.rmSync(root, { recursive: true, force: true });
}
