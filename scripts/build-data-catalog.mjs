import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCatalogDatabase } = require('../electron/data-management-service.cjs');
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    values[key.slice(2)] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : 'true';
  }
  return values;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildEquipmentCatalogInput(equipmentLibrary) {
  const rawGearSets = equipmentLibrary?.gearSets;
  if (!isRecord(rawGearSets)) throw new Error('Equipment catalog is missing a gearSets object.');

  const gearSetIds = new Set();
  const equipmentIds = new Set();
  const equipmentSets = [];
  const equipments = [];

  for (const [entryKey, gearSet] of Object.entries(rawGearSets)) {
    if (!isRecord(gearSet)) throw new Error(`Invalid equipment set entry: ${entryKey}.`);
    const gearSetId = typeof gearSet.gearSetId === 'string' ? gearSet.gearSetId.trim() : '';
    const name = typeof gearSet.name === 'string' ? gearSet.name.trim() : '';
    if (!gearSetId || !name) throw new Error(`Equipment set is missing a stable id or name: ${entryKey}.`);
    if (gearSetIds.has(gearSetId)) throw new Error(`Duplicate equipment set id: ${gearSetId}.`);
    gearSetIds.add(gearSetId);

    if (gearSet.threePieceBuff !== undefined && !isRecord(gearSet.threePieceBuff)) {
      throw new Error(`Invalid threePieceBuff for equipment set: ${gearSetId}.`);
    }
    if (gearSet.threePieceBuffs !== undefined && !isRecord(gearSet.threePieceBuffs)) {
      throw new Error(`Invalid threePieceBuffs for equipment set: ${gearSetId}.`);
    }
    if (!isRecord(gearSet.equipments)) throw new Error(`Equipment set is missing an equipments object: ${gearSetId}.`);

    // Keep the complete source payload: a flattened equipment row cannot
    // reconstruct the set's three-piece effects or original membership.
    equipmentSets.push({ id: gearSetId, name, payload: gearSet });

    for (const [equipmentKey, equipment] of Object.entries(gearSet.equipments)) {
      if (!isRecord(equipment)) throw new Error(`Invalid equipment entry: ${gearSetId}/${equipmentKey}.`);
      const equipmentId = typeof equipment.equipmentId === 'string' ? equipment.equipmentId.trim() : '';
      if (!equipmentId) throw new Error(`Equipment is missing a stable id: ${gearSetId}/${equipmentKey}.`);
      if (equipmentIds.has(equipmentId)) throw new Error(`Duplicate equipment id: ${equipmentId}.`);
      equipmentIds.add(equipmentId);
      const equipmentName = typeof equipment.name === 'string' && equipment.name.trim() ? equipment.name.trim() : equipmentId;
      equipments.push({
        id: equipmentId,
        name: equipmentName,
        payload: { ...equipment, gearSetId },
      });
    }
  }

  if (!equipmentSets.length) throw new Error('Equipment catalog does not contain any gear sets.');
  return { equipmentSets, equipments };
}

function buildCatalogInput({ sourceRoot, outputPath, dataVersion }) {
  const identities = readJson(path.join(sourceRoot, 'catalog-identities.v1.json'));
  if (identities?.schemaVersion !== 1) throw new Error('catalog identity map schemaVersion 无效。');
  const operators = readJson(path.join(sourceRoot, 'characters', 'operators-list.json')).map(({ name }) => {
    const id = identities.operators?.[name];
    if (!id) throw new Error(`干员缺少固定 catalog ID：${name}`);
    return { id, name, payload: readJson(path.join(sourceRoot, 'characters', name, `${name}.json`)) };
  });
  const weaponsRoot = path.join(sourceRoot, 'weapons');
  const weapons = fs.readdirSync(weaponsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((directory) => fs.readdirSync(path.join(weaponsRoot, directory.name), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && !entry.name.endsWith('buff.json'))
      .map((entry) => readJson(path.join(weaponsRoot, directory.name, entry.name))))
    .map((payload) => {
      const name = payload?.name;
      const id = identities.weapons?.[name];
      if (!id) throw new Error(`武器缺少固定 catalog ID：${name || '-'}`);
      return { id, name, payload };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const equipmentLibrary = readJson(path.join(sourceRoot, 'equipments', 'equipments.json'));
  const { equipmentSets, equipments } = buildEquipmentCatalogInput(equipmentLibrary);
  const buffs = readJson(path.join(sourceRoot, 'akedb-raw-index', 'buffs.json')).map((buff) => {
    if (typeof buff.id !== 'string' || !buff.id) throw new Error('系统 Buff 缺少固定 ID。');
    return { id: buff.id, name: buff.id, payload: buff };
  });
  return { databasePath: outputPath, dataVersion, operators, weapons, equipments, equipmentSets, buffs, templates: [] };
}

export function buildBuiltinDataCatalog({ sourceRoot = path.join(repositoryRoot, 'public', 'data'), outputPath = path.join(repositoryRoot, 'public', 'data', 'catalog.sqlite'), dataVersion = `builtin-${require('../package.json').version}` } = {}) {
  const destination = path.resolve(outputPath);
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-builtin-catalog-'));
  const temporaryPath = path.join(temporaryDir, 'catalog.sqlite');
  try {
    const result = createCatalogDatabase(buildCatalogInput({ sourceRoot: path.resolve(sourceRoot), outputPath: temporaryPath, dataVersion }));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(temporaryPath, destination);
    return { ...result, databasePath: destination, outputPath: destination };
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArguments(process.argv.slice(2));
    console.log(JSON.stringify(buildBuiltinDataCatalog({
      sourceRoot: args.source,
      outputPath: args.output,
      dataVersion: args.dataVersion,
    }), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
