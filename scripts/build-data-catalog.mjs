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
  const equipments = Object.values(equipmentLibrary.gearSets || {}).flatMap((gearSet) => Object.values(gearSet.equipments || {}).map((equipment) => {
    if (typeof equipment.equipmentId !== 'string' || !equipment.equipmentId) {
      throw new Error(`装备缺少固定 ID：${equipment.name || '-'}`);
    }
    return {
      id: equipment.equipmentId,
      name: equipment.name || equipment.equipmentId,
      payload: { ...equipment, gearSetId: gearSet.gearSetId || '' },
    };
  }));
  const buffs = readJson(path.join(sourceRoot, 'akedb-raw-index', 'buffs.json')).map((buff) => {
    if (typeof buff.id !== 'string' || !buff.id) throw new Error('系统 Buff 缺少固定 ID。');
    return { id: buff.id, name: buff.id, payload: buff };
  });
  return { databasePath: outputPath, dataVersion, operators, weapons, equipments, buffs, templates: [] };
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
