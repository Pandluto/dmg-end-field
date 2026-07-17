import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { buildBuiltinDataCatalog } from './build-data-catalog.mjs';

const require = createRequire(import.meta.url);
const { createDataReleasePackage } = require('../electron/data-management-service.cjs');
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function requiredDirectory(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`缺少 ${label}`);
  const directory = path.resolve(value.trim());
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw new Error(`${label} 不存在：${directory}`);
  return directory;
}

function requiredVersion(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('缺少 dataVersion');
  const version = value.trim().replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-').slice(0, 120);
  if (!version || version === '.' || version === '..') throw new Error('dataVersion 无效');
  return version;
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

export function buildDataReleasePackage(options = {}) {
  const source = requiredDirectory(options.source || path.join(repositoryRoot, 'public', 'data'), '数据源目录');
  const output = requiredDirectory(options.output, '输出目录');
  const dataVersion = requiredVersion(options.dataVersion || options.version);
  const releaseTag = typeof options.releaseTag === 'string' && options.releaseTag.trim() ? options.releaseTag.trim() : dataVersion;
  const minShellVersion = typeof options.minShellVersion === 'string' ? options.minShellVersion.trim() : '';
  const stagingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `dmg-data-release-${dataVersion}-`));
  const catalogPath = path.join(stagingDirectory, 'catalog.sqlite');
  try {
    const catalog = buildBuiltinDataCatalog({ sourceRoot: source, outputPath: catalogPath, dataVersion });
    const release = createDataReleasePackage({
      catalogPath,
      outputDirectory: output,
      manifest: { dataVersion, releaseTag, minShellVersion },
    });
    return {
      mode: 'catalog-full',
      dataVersion,
      releaseTag,
      outputDir: release.outputDir,
      manifestPath: release.manifestPath,
      packagePaths: [release.packagePath],
      catalog: catalog.counts,
      signed: false,
    };
  } finally {
    fs.rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArguments(process.argv.slice(2));
    console.log(JSON.stringify(buildDataReleasePackage({
      source: args.source,
      output: args.output,
      dataVersion: args.dataVersion || args.version,
      releaseTag: args.releaseTag || args.tag,
      minShellVersion: args.minShellVersion || args.minShell,
    }), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
