import assert from 'node:assert/strict';
import fs from 'node:fs';

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as JsonRecord;
}

function readJson(url: URL): JsonRecord {
  return record(JSON.parse(fs.readFileSync(url, 'utf8')));
}

function latestShareData(): JsonRecord {
  const directory = new URL('../../../data/sharedata/', import.meta.url);
  const candidates = fs.readdirSync(directory)
    .filter((name) => /^share-.*\.json$/i.test(name))
    .map((name) => ({ name, archive: readJson(new URL(name, directory)) }))
    .sort((left, right) => (
      Date.parse(String(right.archive.exportedAt || right.archive.createdAt || ''))
      - Date.parse(String(left.archive.exportedAt || left.archive.createdAt || ''))
    ));
  assert.ok(candidates[0], 'data/sharedata must contain a Share Data JSON');
  return candidates[0].archive;
}

function operator(archive: JsonRecord, operatorId: string): JsonRecord {
  const storage = record(archive.storage);
  const local = record(storage.local);
  const library = record(local['def.operator-editor.library.v1']);
  return record(library[operatorId]);
}

function effect(
  archive: JsonRecord,
  operatorId: string,
  group: string,
  effectId: string,
): JsonRecord {
  const buffs = record(operator(archive, operatorId).buffs);
  const effects = record(record(buffs[group]).effects);
  return record(effects[effectId]);
}

function assertCorrectOperatorPercents(archive: JsonRecord, label: string): void {
  const antalExpected = [0.2, 0.22, 0.2, 0.22, 0.1, 0.14, 0.1, 0.14];
  antalExpected.forEach((expected, index) => {
    assert.equal(
      effect(archive, 'chr_0023_antal', 'skill', `effect${index + 1}`).value,
      expected,
      `${label}: 安塔尔 effect${index + 1}`,
    );
  });

  const baseArc = record(effect(archive, 'chr_0007_ikut', 'talent', 'effect1').derivedValue);
  const potentialArc = record(effect(archive, 'chr_0007_ikut', 'talent', 'effect2').derivedValue);
  assert.equal(baseArc.perPointValue, 0.0008, `${label}: 弧光每点智识 0.08%`);
  assert.equal(potentialArc.perPointValue, 0.00104, `${label}: 弧光三潜每点智识 0.104%`);
  assert.ok(Math.abs(Number(baseArc.perPointValue) * 800 - 0.64) < 1e-12);
  assert.ok(Math.abs(Number(potentialArc.perPointValue) * 800 - 0.832) < 1e-12);
}

assertCorrectOperatorPercents(latestShareData(), 'latest Share Data');
assertCorrectOperatorPercents(
  readJson(new URL('../../../public/data/default-local-data.json', import.meta.url)),
  'materialized web data',
);

console.log('Operator percentage data contract: PASS');
