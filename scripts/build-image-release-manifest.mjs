#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico']);
const MANIFEST_NAME = 'assets-release-manifest.json';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function sanitizeVersion(value) {
  const raw = String(value || '').trim();
  return raw.replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-').slice(0, 120);
}

function ensureDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function removeIfExists(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function hashFileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function walkFiles(rootDir) {
  const result = [];
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        result.push(fullPath);
      }
    }
  }
  return result.sort((left, right) => left.localeCompare(right));
}

function findAssetsSegment(sourceDir) {
  const parts = path.resolve(sourceDir).split(path.sep);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index] === 'assets') {
      return parts.slice(0, index + 1).join(path.sep) || path.sep;
    }
  }
  return null;
}

function normalizeRelativePath(value) {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0') || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`非法资源路径: ${value}`);
  }
  return normalized;
}

function toReleaseRelativePath(sourceDir, filePath) {
  const assetsRoot = findAssetsSegment(sourceDir);
  if (assetsRoot && path.resolve(filePath).startsWith(path.resolve(assetsRoot) + path.sep)) {
    return normalizeRelativePath(`assets/${path.relative(assetsRoot, filePath)}`);
  }
  return normalizeRelativePath(`assets/images/${path.relative(sourceDir, filePath)}`);
}

function toPackagePath(relativePath) {
  return relativePath.replace(/^assets\/?/, '');
}

function copyFileForPackage(sourceFile, packageRoot, relativePath) {
  const target = path.join(packageRoot, toPackagePath(relativePath));
  ensureDirectory(path.dirname(target));
  fs.copyFileSync(sourceFile, target);
}

function readJsonIfExists(filePath) {
  if (!filePath) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function buildFileEntries(sourceDir) {
  return walkFiles(sourceDir)
    .filter((filePath) => {
      const name = path.basename(filePath);
      if (name === MANIFEST_NAME || name === '_manifest.json') return false;
      return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
    })
    .map((filePath) => {
      const relativePath = toReleaseRelativePath(sourceDir, filePath);
      const stat = fs.statSync(filePath);
      return {
        relativePath,
        sha256: hashFileSha256(filePath),
        sizeBytes: stat.size,
        source: 'release',
        _sourceFile: filePath,
      };
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function computeDelta(nextFiles, baseManifest) {
  const baseFiles = new Map((baseManifest?.files || []).map((entry) => [entry.relativePath, entry]));
  const nextPaths = new Set(nextFiles.map((entry) => entry.relativePath));
  const changedFiles = nextFiles.filter((entry) => {
    const previous = baseFiles.get(entry.relativePath);
    return !previous || previous.sha256 !== entry.sha256;
  });
  const deletedFiles = [...baseFiles.keys()]
    .filter((relativePath) => !nextPaths.has(relativePath))
    .sort((left, right) => left.localeCompare(right));
  return { changedFiles, deletedFiles };
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'pipe',
    encoding: 'utf-8',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} 失败${detail ? `: ${detail}` : ''}`);
  }
}

function createZipFromDirectory(sourceDir, zipPath) {
  removeIfExists(zipPath);
  if (walkFiles(sourceDir).length === 0) {
    fs.writeFileSync(path.join(sourceDir, '.release-empty'), '', 'utf-8');
  }
  if (process.platform === 'win32') {
    runChecked('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$ErrorActionPreference='Stop'; Compress-Archive -Path (Join-Path '${sourceDir.replace(/'/g, "''")}' '*') -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
    ]);
    return;
  }
  runChecked('zip', ['-qr', zipPath, '.'], { cwd: sourceDir });
}

function packageDescriptor(zipPath, fileName) {
  const stat = fs.statSync(zipPath);
  return {
    format: 'zip',
    fileName,
    packagePath: fileName,
    sha256: hashFileSha256(zipPath),
    sizeBytes: stat.size,
  };
}

function makePackage({ label, outputDir, files }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `def-assets-${label}-`));
  const zipName = `${label}.zip`;
  const zipPath = path.join(outputDir, zipName);
  try {
    for (const entry of files) {
      copyFileForPackage(entry._sourceFile, tempDir, entry.relativePath);
    }
    createZipFromDirectory(tempDir, zipPath);
  } finally {
    removeIfExists(tempDir);
  }
  return {
    path: zipPath,
    descriptor: packageDescriptor(zipPath, zipName),
  };
}

export function buildImageReleasePackage(options = {}) {
  const rawSource = String(options.source || '').trim();
  const rawOutput = String(options.output || '').trim();
  const source = rawSource ? path.resolve(rawSource) : '';
  const outputRoot = rawOutput ? path.resolve(rawOutput) : '';
  const assetVersion = sanitizeVersion(options.assetVersion);
  if (!source || !fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new Error('图片资源源目录无效');
  }
  if (!outputRoot) {
    throw new Error('发布包输出目录无效');
  }
  if (!assetVersion) {
    throw new Error('图片资源版本无效');
  }
  const mode = ['full', 'delta', 'both'].includes(options.mode) ? options.mode : 'both';
  if (mode === 'delta' && !options.baseManifest) {
    throw new Error('增量模式需要提供 baseManifest');
  }

  const baseManifest = readJsonIfExists(options.baseManifest);
  const filesWithSource = buildFileEntries(source);
  const { changedFiles, deletedFiles } = computeDelta(filesWithSource, baseManifest);
  const outputDir = path.join(outputRoot, assetVersion);
  removeIfExists(outputDir);
  ensureDirectory(outputDir);

  const manifestFiles = filesWithSource.map(({ _sourceFile, ...entry }) => entry);
  const manifest = {
    manifestVersion: 1,
    releaseTag: String(options.releaseTag || assetVersion),
    generatedAt: new Date().toISOString(),
    minShellVersion: String(options.minShellVersion || ''),
    assetVersion,
    baseVersion: baseManifest?.assetVersion || '',
    delivery: baseManifest && mode !== 'full' ? 'delta-archive' : 'archive',
    files: manifestFiles,
    deletedFiles,
  };

  const packagePaths = [];
  if (manifest.delivery === 'delta-archive') {
    const deltaPackage = makePackage({
      label: `assets-${assetVersion}-delta`,
      outputDir,
      files: changedFiles,
    });
    manifest.package = deltaPackage.descriptor;
    packagePaths.push(deltaPackage.path);
    if (mode === 'both') {
      const fullPackage = makePackage({
        label: `assets-${assetVersion}-full`,
        outputDir,
        files: filesWithSource,
      });
      manifest.fullPackage = fullPackage.descriptor;
      packagePaths.push(fullPackage.path);
    }
  } else {
    const fullPackage = makePackage({
      label: `assets-${assetVersion}-full`,
      outputDir,
      files: filesWithSource,
    });
    manifest.package = fullPackage.descriptor;
    packagePaths.push(fullPackage.path);
  }

  const manifestPath = path.join(outputDir, MANIFEST_NAME);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

  return {
    mode: manifest.delivery,
    assetVersion,
    outputDir,
    manifestPath,
    packagePaths,
    totalFiles: filesWithSource.length,
    changedFiles: changedFiles.length,
    deletedFiles: deletedFiles.length,
  };
}

function printUsage() {
  console.log([
    'Usage:',
    '  node scripts/build-image-release-manifest.mjs --source <dir> --output <dir> --asset-version <version> [options]',
    '',
    'Options:',
    '  --release-tag <tag>',
    '  --min-shell-version <version>',
    '  --base-manifest <path>',
    '  --mode full|delta|both',
  ].join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printUsage();
    process.exit(0);
  }
  try {
    const result = buildImageReleasePackage({
      source: args.source,
      output: args.output,
      assetVersion: args['asset-version'] || args.assetVersion,
      releaseTag: args['release-tag'] || args.releaseTag,
      minShellVersion: args['min-shell-version'] || args.minShellVersion,
      baseManifest: args['base-manifest'] || args.baseManifest,
      mode: args.mode,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
