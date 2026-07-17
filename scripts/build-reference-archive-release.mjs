import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createReferenceArchiveReleasePackage } = require('../electron/data-management-service.cjs');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readOption(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} requires a value`);
  return value;
}

function requiredDirectory(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`缺少${label}`);
  const directory = path.resolve(value.trim());
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw new Error(`${label}不存在：${directory}`);
  return directory;
}

export function buildReferenceArchiveReleasePackage(options = {}) {
  const sourceDirectory = requiredDirectory(options.source || path.join(projectRoot, 'data', 'reference-archive-outbox'), '参考存档源目录');
  const outputDirectory = requiredDirectory(options.output || path.join(projectRoot, 'release'), '发布输出目录');
  const releaseId = typeof (options.releaseId || options.version) === 'string' ? String(options.releaseId || options.version).trim() : '';
  if (!releaseId) throw new Error('缺少 releaseId');
  const release = createReferenceArchiveReleasePackage({
    sourceDirectory,
    outputDirectory,
    manifest: {
      releaseId,
      minShellVersion: typeof options.minShellVersion === 'string' ? options.minShellVersion.trim() : '',
      generatedAt: typeof options.generatedAt === 'string' && options.generatedAt.trim() ? options.generatedAt : new Date().toISOString(),
    },
  });
  return {
    mode: 'reference-archive-full',
    releaseId: release.manifest.releaseId,
    outputDir: release.outputDir,
    manifestPath: release.manifestPath,
    packagePaths: [release.packagePath],
    archives: release.manifest.archives.map((archive) => ({ archiveId: archive.archiveId, nodeCount: archive.nodeCount })),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = buildReferenceArchiveReleasePackage({
      source: readOption('source', path.join(projectRoot, 'data', 'reference-archive-outbox')),
      output: readOption('output', path.join(projectRoot, 'release')),
      releaseId: readOption('release-id'),
      minShellVersion: readOption('min-shell-version', ''),
      generatedAt: readOption('generated-at', new Date().toISOString()),
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
