import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-equipment-resource-'));
const port = 19050 + Math.floor(Math.random() * 300);
const nowStoragePath = path.join(root, 'now-storage.json');

function equipment(equipmentId, name, part = '配件') {
  return { equipmentId, name, part, effects: {} };
}

const longSet = {
  gearSetId: 'gear-set-chang-xi',
  name: '长息',
  equipments: Object.fromEntries([
    equipment('chang-xi-1', '长息装甲', '护甲'),
    equipment('chang-xi-2', '长息护手', '护手'),
    equipment('chang-xi-3', '长息护手·壹型', '护手'),
    equipment('chang-xi-4', '长息蓄电核'),
    equipment('chang-xi-5', '长息辅助臂'),
    equipment('chang-xi-6', '长息裹手', '护手'),
    equipment('chang-xi-7', '长息手套', '护手'),
    equipment('equipment-c-h-a-n-g-x-i-2', '长息轻护甲·壹型', '护甲'),
    equipment('chang-xi-9', '长息蓄电核·壹型'),
  ].map((item) => [item.equipmentId, item])),
};
const frontierSet = {
  gearSetId: 'gear-set-tuo-huang',
  name: '拓荒',
  equipments: Object.fromEntries([
    ...Array.from({ length: 9 }, (_, index) => equipment(`tuo-huang-${index + 1}`, `拓荒占位装备${index + 1}`)),
    equipment('equipment-g-6-1', '拓荒增量供氧栓·壹型'),
  ].map((item) => [item.equipmentId, item])),
};
const equipmentLibrary = { gearSets: { changXi: longSet, tuoHuang: frontierSet } };
const weaponLibrary = {
  lianjiedian: { id: 'lianjiedian', name: '联结点', type: '法术单元', rarity: 6, skills: {} },
};

function writeArchive({ saved = equipmentLibrary, draft = equipmentLibrary } = {}) {
  fs.writeFileSync(nowStoragePath, `${JSON.stringify({
    type: 'def.localdata.archive.v1',
    schemaVersion: 1,
    id: 'equipment-resource-contract',
    exportedAt: new Date().toISOString(),
    storage: {
      local: {
        'def.equipment-sheet.library.v1': saved,
        'def.equipment-sheet.draft.v1': draft,
        'def.weapon-sheet.library.v1': weaponLibrary,
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
    DEF_INTERNAL_GOVERNANCE_TOKEN: 'equipment-resource-contract',
  },
  stdio: 'ignore',
});
const baseUrl = `http://127.0.0.1:${port}`;

async function waitForReady() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch {
      // Starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for equipment-resource contract server.');
}

async function call(tool, input) {
  const response = await fetch(`${baseUrl}/api/def-tools/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool, input }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.ok, true, JSON.stringify(payload));
  return payload.result;
}

try {
  await waitForReady();

  const lateExact = await call('def.equipment.resolve', { query: '拓荒增量供氧栓·壹型' });
  assert.equal(lateExact.contract, 'DefEquipmentResolutionV2');
  assert.equal(lateExact.catalogCount, 19);
  assert.equal(lateExact.candidates[0]?.equipmentId, 'equipment-g-6-1');
  assert.equal(lateExact.candidates[0]?.matchMethod, 'exact');
  assert.equal(lateExact.exhaustive, true);
  assert.equal(lateExact.truncated, false);

  const fuzzy = await call('def.equipment.resolve', { query: '长息轻护甲板·壹型' });
  assert.equal(fuzzy.candidates[0]?.equipmentId, 'equipment-c-h-a-n-g-x-i-2');
  assert.equal(fuzzy.candidates[0]?.matchMethod, 'fuzzy');
  assert.equal(fuzzy.ambiguity, true, 'fuzzy resolution must remain reviewable');

  const batch = await call('def.equipment.resolve', {
    queries: ['长息蓄电核', '拓荒增量供氧栓一型', '长息护手一型'],
  });
  assert.equal(batch.contract, 'DefEquipmentBatchResolutionV2');
  assert.equal(batch.queryCount, 3);
  assert.deepEqual(batch.results.map((result) => result.candidates[0]?.equipmentId), [
    'chang-xi-4',
    'equipment-g-6-1',
    'chang-xi-3',
  ]);
  assert.equal(batch.results[1].candidates[0].matchMethod, 'phonetic');

  const weapon = await call('def.weapon.resolve', { query: '链结点' });
  assert.equal(weapon.candidates[0]?.id, 'lianjiedian');
  assert.equal(weapon.candidates[0]?.matchMethod, 'phonetic');

  const catalog = await call('def.equipment.resolve', { query: '' });
  assert.equal(catalog.catalogCount, 19);
  assert.equal(catalog.exhaustive, false);
  assert.equal(catalog.truncated, true);

  writeArchive({ saved: { gearSets: {} }, draft: equipmentLibrary });
  const draftFallback = await call('def.equipment.resolve', { query: '拓荒增量供氧栓·壹型' });
  assert.equal(draftFallback.candidates[0]?.equipmentId, 'equipment-g-6-1');

  console.log(JSON.stringify({
    ok: true,
    checks: ['full-index', 'stable-id', 'fuzzy-review', 'batch', 'phonetic-weapon', 'truthful-truncation', 'draft-fallback'],
  }));
} finally {
  child.kill('SIGTERM');
  fs.rmSync(root, { recursive: true, force: true });
}
