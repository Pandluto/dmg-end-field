import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildDesktopDataRelease } from './build-desktop-data-release.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const builderSourcePath = path.join(scriptDirectory, 'build-desktop-data-release.mjs');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

function powershellLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function zipEntries(zipPath) {
  if (process.platform === 'win32') {
    const extractedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-end-field-data-zip-list-'));
    try {
      extractZip(zipPath, extractedRoot);
      return walkFiles(extractedRoot).map((filePath) => (
        path.relative(extractedRoot, filePath).split(path.sep).join('/')
      ));
    } finally {
      fs.rmSync(extractedRoot, { recursive: true, force: true });
    }
  }

  let result = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
  if (result.status !== 0) {
    result = spawnSync('zipinfo', ['-1', zipPath], { encoding: 'utf8' });
  }
  assert.equal(result.status, 0, result.stderr || result.stdout || '无法读取 ZIP 清单');
  return result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.replace(/^\.\//, '').trim())
    .filter((entry) => entry && !entry.endsWith('/'));
}

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const absolutePath = path.join(directory, entry.name);
      return entry.isDirectory() ? walkFiles(absolutePath) : [absolutePath];
    });
}

function extractZip(zipPath, destination) {
  fs.mkdirSync(destination, { recursive: true });
  if (process.platform === 'win32') {
    const command = [
      '$ErrorActionPreference = "Stop";',
      `Expand-Archive -LiteralPath ${powershellLiteral(zipPath)}`,
      `-DestinationPath ${powershellLiteral(destination)} -Force;`,
    ].join(' ');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout || '无法解压 ZIP');
    return;
  }

  const result = spawnSync('unzip', ['-q', zipPath, '-d', destination], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout || '无法解压 ZIP');
}

function assertManifestFiles(manifest, dataRoot) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.packageId, 'dmg-end-field-core-data');
  assert.equal(typeof manifest.version, 'string');
  assert.match(manifest.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Array.isArray(manifest.files));
  assert.deepEqual(
    manifest.files.map((file) => file.path),
    [...manifest.files].map((file) => file.path).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
  );

  let totalBytes = 0;
  for (const entry of manifest.files) {
    assert.match(entry.path, /^data\/.+\.json$/i);
    const relativePath = entry.path.slice('data/'.length);
    const sourcePath = path.join(dataRoot, ...relativePath.split('/'));
    assert.equal(fs.existsSync(sourcePath), true, `缺少源文件：${relativePath}`);
    assert.equal(entry.sha256, sha256(sourcePath));
    assert.equal(entry.size, fs.statSync(sourcePath).size);
    totalBytes += entry.size;
  }
  assert.equal(manifest.totalBytes, totalBytes);
}

function assertPackage(result, dataRoot, temporaryRoot) {
  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
  assertManifestFiles(manifest, dataRoot);
  assert.equal(result.packagePath, path.join(result.outputDir, `data-${result.version}-full.zip`));
  assert.deepEqual(new Set(fs.readdirSync(result.outputDir)), new Set([
    'web-data-manifest.json',
    `data-${result.version}-full.zip`,
  ]));

  const entries = zipEntries(result.packagePath);
  const expectedEntries = [...manifest.files.map((file) => file.path), 'web-data-manifest.json'];
  for (const entry of expectedEntries) assert.ok(entries.includes(entry), `ZIP 缺少：${entry}`);
  assert.equal(entries.some((entry) => entry === 'ignored.txt'), false);
  assert.equal(entries.some((entry) => entry.startsWith('data/') === false && entry !== MANIFEST_FILE_NAME), false);

  const extractedRoot = path.join(temporaryRoot, `extracted-${result.version}`);
  extractZip(result.packagePath, extractedRoot);
  const zippedManifest = JSON.parse(fs.readFileSync(path.join(extractedRoot, 'web-data-manifest.json'), 'utf8'));
  assert.deepEqual(zippedManifest, manifest);
  for (const entry of manifest.files) {
    const extractedFile = path.join(extractedRoot, ...entry.path.split('/'));
    assert.equal(fs.statSync(extractedFile).size, entry.size);
    assert.equal(sha256(extractedFile), entry.sha256);
  }
}

const MANIFEST_FILE_NAME = 'web-data-manifest.json';
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-end-field-data-smoke-'));

try {
  const publicRoot = path.join(temporaryRoot, 'public');
  const dataRoot = path.join(publicRoot, 'data');
  writeJson(path.join(dataRoot, 'characters', 'operator.json'), { id: 'operator', skills: [1, 2] });
  writeJson(path.join(dataRoot, 'nested', 'buff.json'), { id: 'buff', enabled: true });
  fs.mkdirSync(path.join(dataRoot, 'characters'), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, 'ignored.txt'), 'not part of the data package\n');

  const outputRoot = path.join(temporaryRoot, 'releases');
  fs.mkdirSync(outputRoot, { recursive: true });
  const publicResult = buildDesktopDataRelease({
    source: publicRoot,
    output: outputRoot,
    version: 'smoke/1.0',
  });
  assert.equal(publicResult.version, 'smoke-1.0');
  assertPackage(publicResult, dataRoot, temporaryRoot);

  const directResult = buildDesktopDataRelease({
    source: dataRoot,
    output: outputRoot,
    version: 'smoke-direct',
  });
  assertPackage(directResult, dataRoot, temporaryRoot);

  assert.throws(
    () => buildDesktopDataRelease({
      source: publicRoot,
      output: temporaryRoot,
      version: 'public',
    }),
    /不能与 source 的 data\/ 目录重叠/,
  );
  assert.throws(
    () => buildDesktopDataRelease({
      source: publicRoot,
      output: outputRoot,
      version: '..',
    }),
    /version 无效/,
  );
  assert.ok(fs.existsSync(path.join(dataRoot, 'characters', 'operator.json')));

  const invalidDataRoot = path.join(temporaryRoot, 'invalid-public', 'data');
  fs.mkdirSync(invalidDataRoot, { recursive: true });
  fs.writeFileSync(path.join(invalidDataRoot, 'broken.json'), '{broken\n', 'utf8');
  assert.throws(
    () => buildDesktopDataRelease({
      source: path.dirname(invalidDataRoot),
      output: outputRoot,
      version: 'invalid',
    }),
    /不是有效 JSON/,
  );

  const builderSource = fs.readFileSync(builderSourcePath, 'utf8');
  for (const forbidden of [
    /electron[\\/]data-management-service/,
    /node:sqlite/,
    /createLocalDataReleasePackage/,
    /\.\.\/?electron[\\/]/,
  ]) {
    assert.equal(forbidden.test(builderSource), false, `源码包含禁用依赖：${forbidden}`);
  }

  console.log('Desktop data release builder smoke passed.');
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
