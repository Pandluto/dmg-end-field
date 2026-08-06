import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PACKAGE_ID = 'dmg-end-field-core-data';
const MANIFEST_FILE_NAME = 'web-data-manifest.json';
const VERSION_MAX_LENGTH = 120;

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`缺少 ${label}`);
  }
  return value.trim();
}

function sanitizeVersion(value) {
  const version = requireString(value, 'version')
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-')
    .replace(/[. ]+$/g, '')
    .slice(0, VERSION_MAX_LENGTH);
  if (!version || version === '.' || version === '..') {
    throw new Error('version 无效');
  }
  return version;
}

function toPosix(value) {
  return value.replace(/\\/g, '/');
}

function comparePath(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function assertDirectory(value, label) {
  const directory = path.resolve(requireString(value, label));
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`${label} 不存在或不是目录：${directory}`);
  }
  return fs.realpathSync(directory);
}

function resolveDataRoot(source) {
  const sourceDirectory = assertDirectory(source, 'source');
  const nestedDataDirectory = path.join(sourceDirectory, 'data');

  if (path.basename(sourceDirectory).toLowerCase() === 'data') {
    return sourceDirectory;
  }
  if (fs.existsSync(nestedDataDirectory) && fs.statSync(nestedDataDirectory).isDirectory()) {
    return nestedDataDirectory;
  }

  throw new Error(`source 必须是完整 data/ 目录或包含 data/ 的 public 根目录：${sourceDirectory}`);
}

function walkJsonFiles(dataRoot) {
  const files = [];

  function walk(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => comparePath(left.name, right.name));

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        files.push(absolutePath);
      }
    }
  }

  walk(dataRoot);
  return files;
}

function manifestPathFor(dataRoot, sourceFile) {
  const relativePath = toPosix(path.relative(dataRoot, sourceFile));
  if (
    !relativePath
    || relativePath === '..'
    || relativePath.startsWith('../')
    || relativePath.includes('/../')
    || relativePath.startsWith('/')
  ) {
    throw new Error(`数据文件越过 data/ 根目录：${sourceFile}`);
  }
  return `data/${relativePath}`;
}

function collectDataFiles(dataRoot) {
  const files = walkJsonFiles(dataRoot).map((sourceFile) => {
    const bytes = fs.readFileSync(sourceFile);
    const manifestPath = manifestPathFor(dataRoot, sourceFile);

    try {
      JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`数据文件不是有效 JSON：${manifestPath}：${detail}`, { cause: error });
    }

    return {
      sourceFile,
      entry: {
        path: manifestPath,
        sha256: sha256(bytes),
        size: bytes.byteLength,
      },
    };
  });

  files.sort((left, right) => comparePath(left.entry.path, right.entry.path));
  if (files.length === 0) {
    throw new Error(`data/ 目录中没有 JSON 文件：${dataRoot}`);
  }
  return files;
}

function ensureInside(rootDirectory, candidatePath) {
  const root = path.resolve(rootDirectory);
  const candidate = path.resolve(candidatePath);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error(`路径越过工作目录：${candidatePath}`);
  }
  return candidate;
}

function writeManifest(filePath, manifest) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function copyDataFiles(files, stagingRoot) {
  for (const file of files) {
    const target = ensureInside(stagingRoot, path.join(stagingRoot, file.entry.path));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file.sourceFile, target);
  }
}

function powershellLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function compressDirectoryToZip(sourceDirectory, zipPath) {
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  fs.rmSync(zipPath, { force: true });

  if (process.platform === 'win32') {
    const command = [
      '$ErrorActionPreference = "Stop";',
      `Compress-Archive -Path ${powershellLiteral(path.join(sourceDirectory, '*'))}`,
      `-DestinationPath ${powershellLiteral(zipPath)} -Force;`,
    ].join(' ');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      throw new Error(
        `压缩数据发布包失败：${result.stderr || result.stdout || result.error?.message || `exit ${result.status}`}`,
        { cause: result.error },
      );
    }
    return;
  }

  const result = spawnSync('zip', ['-qr', zipPath, '.'], {
    cwd: sourceDirectory,
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `压缩数据发布包失败：${result.stderr || result.stdout || result.error?.message || `exit ${result.status}`}`,
      { cause: result.error },
    );
  }
}

export function buildDesktopDataRelease(options = {}) {
  const dataRoot = resolveDataRoot(options.source || options.src);
  const outputRoot = assertDirectory(options.output || options.out, 'output');
  const version = sanitizeVersion(options.version || options.dataVersion);
  const outputDirectory = path.join(outputRoot, version);

  if (
    outputDirectory === dataRoot
    || outputDirectory.startsWith(`${dataRoot}${path.sep}`)
    || dataRoot.startsWith(`${outputDirectory}${path.sep}`)
  ) {
    throw new Error(`output 不能与 source 的 data/ 目录重叠：${outputDirectory}`);
  }

  const files = collectDataFiles(dataRoot);
  const manifest = {
    schemaVersion: 1,
    packageId: PACKAGE_ID,
    version,
    generatedAt: new Date().toISOString(),
    files: files.map(({ entry }) => entry),
    totalBytes: files.reduce((total, file) => total + file.entry.size, 0),
  };
  const packageFileName = `data-${version}-full.zip`;
  const manifestPath = path.join(outputDirectory, MANIFEST_FILE_NAME);
  const packagePath = path.join(outputDirectory, packageFileName);
  const stagingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-end-field-data-'));

  try {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
    fs.mkdirSync(outputDirectory, { recursive: true });
    copyDataFiles(files, stagingDirectory);
    writeManifest(path.join(stagingDirectory, MANIFEST_FILE_NAME), manifest);
    compressDirectoryToZip(stagingDirectory, packagePath);
    writeManifest(manifestPath, manifest);

    return {
      mode: 'desktop-data-full',
      packageId: PACKAGE_ID,
      version,
      outputDir: outputDirectory,
      manifestPath,
      packagePath,
      packagePaths: [packagePath],
      totalFiles: files.length,
      totalBytes: manifest.totalBytes,
    };
  } catch (error) {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

function parseCliArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) continue;
    const key = argument.slice(2);
    values[key] = argv[index + 1] && !argv[index + 1].startsWith('--')
      ? argv[++index]
      : 'true';
  }
  return values;
}

function printUsage() {
  console.log([
    'Usage:',
    '  node scripts/build-desktop-data-release.mjs --source <data-or-public> --output <dir> --version <version>',
    '',
    'Options:',
    '  --source, --src   完整 data/ 目录，或包含 data/ 的 public 根目录',
    '  --output, --out   发布产物根目录；产物写入 <output>/<sanitized-version>/',
    '  --version         数据包版本；同时用于 manifest 和 ZIP 文件名',
    '  --help            显示帮助',
  ].join('\n'));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseCliArguments(process.argv.slice(2));
  if (args.help === 'true') {
    printUsage();
  } else {
    try {
      console.log(JSON.stringify(buildDesktopDataRelease({
        source: args.source || args.src,
        output: args.output || args.out,
        version: args.version || args.dataVersion,
      }), null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
