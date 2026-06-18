import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const IMAGE_EXT_RE = /\.(png|jpg|jpeg|webp|gif|svg)$/i;
const MANIFEST_NAME = 'assets-release-manifest.json';

function assertString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`缺少 ${label}`);
  }
  return value.trim();
}

function sanitizeVersion(value) {
  return assertString(value, 'assetVersion')
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-')
    .slice(0, 120);
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function ensureInside(rootDir, filePath) {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(filePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`越权路径: ${filePath}`);
  }
  return resolved;
}

function toPosix(value) {
  return value.replace(/\\/g, '/');
}

function detectSourceLayout(sourceDir) {
  const assetsImagesDir = path.join(sourceDir, 'assets', 'images');
  if (fs.existsSync(assetsImagesDir) && fs.statSync(assetsImagesDir).isDirectory()) {
    return {
      scanRoot: assetsImagesDir,
      releasePrefix: 'assets/images',
      packagePrefix: 'images',
    };
  }

  const imagesDir = path.join(sourceDir, 'images');
  if (fs.existsSync(imagesDir) && fs.statSync(imagesDir).isDirectory()) {
    return {
      scanRoot: imagesDir,
      releasePrefix: 'assets/images',
      packagePrefix: 'images',
    };
  }

  return {
    scanRoot: sourceDir,
    releasePrefix: 'assets/images',
    packagePrefix: 'images',
  };
}

function walkImageFiles(rootDir) {
  const results = [];

  function walk(dirPath) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && IMAGE_EXT_RE.test(entry.name)) {
        results.push(fullPath);
      }
    }
  }

  walk(rootDir);
  return results.sort((left, right) => toPosix(left).localeCompare(toPosix(right), 'zh-CN', { numeric: true }));
}

function copyFileForPackage({ sourceFile, sourceRoot, packageRoot, packagePrefix }) {
  const rel = toPosix(path.relative(sourceRoot, sourceFile));
  if (!rel || rel.startsWith('../') || rel.includes('/../')) {
    throw new Error(`非法图片路径: ${sourceFile}`);
  }
  const packageRel = `${packagePrefix}/${rel}`;
  const target = ensureInside(packageRoot, path.join(packageRoot, packageRel));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(sourceFile, target);
  return { rel, packageRel };
}

function compressDirectoryToZip(sourceDir, zipPath) {
  fs.rmSync(zipPath, { force: true });
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });

  if (process.platform === 'win32') {
    const command = [
      '$ErrorActionPreference = "Stop";',
      'Compress-Archive',
      '-Path', `${JSON.stringify(path.join(sourceDir, '*'))}`,
      '-DestinationPath', `${JSON.stringify(zipPath)}`,
      '-Force',
    ].join(' ');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
      encoding: 'utf-8',
      windowsHide: true,
    });
    if (result.status !== 0) {
      throw new Error(`压缩发布包失败: ${result.stderr || result.stdout || `exit ${result.status}`}`);
    }
    return;
  }

  const result = spawnSync('zip', ['-qr', zipPath, '.'], {
    cwd: sourceDir,
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    throw new Error(`压缩发布包失败: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
}

export function buildImageReleasePackage(options = {}) {
  const sourceDir = path.resolve(assertString(options.source, 'source'));
  const outputRoot = path.resolve(assertString(options.output, 'output'));
  const assetVersion = sanitizeVersion(options.assetVersion);
  const releaseTag = typeof options.releaseTag === 'string' && options.releaseTag.trim()
    ? options.releaseTag.trim()
    : assetVersion;
  const minShellVersion = typeof options.minShellVersion === 'string' ? options.minShellVersion.trim() : '';

  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`图片源目录不存在: ${sourceDir}`);
  }

  const layout = detectSourceLayout(sourceDir);
  const imageFiles = walkImageFiles(layout.scanRoot);
  if (imageFiles.length === 0) {
    throw new Error(`图片源目录没有可发布图片: ${layout.scanRoot}`);
  }

  const outputDir = path.join(outputRoot, assetVersion);
  const packageFileName = `assets-${assetVersion}-full.zip`;
  const packagePath = path.join(outputDir, packageFileName);
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), `dmg-assets-${assetVersion}-`));
  const packageRoot = path.join(stagingDir, 'package');

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(packageRoot, { recursive: true });

  const files = imageFiles.map((sourceFile) => {
    const { rel } = copyFileForPackage({
      sourceFile,
      sourceRoot: layout.scanRoot,
      packageRoot,
      packagePrefix: layout.packagePrefix,
    });
    return {
      relativePath: `${layout.releasePrefix}/${rel}`,
      sha256: sha256File(sourceFile),
      sizeBytes: fs.statSync(sourceFile).size,
      source: 'release',
    };
  });

  compressDirectoryToZip(packageRoot, packagePath);

  const manifest = {
    manifestVersion: 1,
    releaseTag,
    generatedAt: new Date().toISOString(),
    minShellVersion,
    assetVersion,
    delivery: 'archive',
    files,
    deletedFiles: [],
    package: {
      format: 'zip',
      fileName: packageFileName,
      packagePath: packageFileName,
      sha256: sha256File(packagePath),
      sizeBytes: fs.statSync(packagePath).size,
    },
  };

  const manifestPath = path.join(outputDir, MANIFEST_NAME);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  fs.rmSync(stagingDir, { recursive: true, force: true });

  return {
    mode: 'archive',
    assetVersion,
    releaseTag,
    outputDir,
    manifestPath,
    packagePaths: [packagePath],
    totalFiles: files.length,
  };
}

function parseCliArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    parsed[key] = value;
  }
  return {
    source: parsed.source || parsed.src,
    output: parsed.output || parsed.out,
    assetVersion: parsed.assetVersion || parsed.version,
    releaseTag: parsed.releaseTag || parsed.tag,
    minShellVersion: parsed.minShellVersion || parsed.minShell,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = buildImageReleasePackage(parseCliArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
