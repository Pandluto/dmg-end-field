import fs from 'node:fs';
import path from 'node:path';
import {
  detectImageRoot,
  SUPPORTED_IMAGE_EXTENSIONS,
} from '../src/platform/resources/resourceReleaseCore.ts';
import { buildResourceRelease } from '../src/platform/resources/resourceReleasePackager.ts';
import { verifyResourceReleaseBundle } from '../src/platform/resources/resourceReleaseVerifier.ts';

function requirePath(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`缺少${label}。`);
  }
  return path.resolve(value.trim());
}

function assertFile(value, label) {
  const filePath = requirePath(value, label);
  if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`${label}不存在或不是文件：${filePath}`);
  }
  return fs.realpathSync(filePath);
}

function assertDirectory(value, label) {
  const directory = requirePath(value, label);
  if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`${label}不存在或不是目录：${directory}`);
  }
  return fs.realpathSync(directory);
}

function pathsOverlap(leftPath, rightPath) {
  const left = path.resolve(leftPath);
  const right = path.resolve(rightPath);
  return left === right
    || left.startsWith(`${right}${path.sep}`)
    || right.startsWith(`${left}${path.sep}`);
}

function walkFiles(root, current = root, files = []) {
  const entries = fs.readdirSync(current, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      walkFiles(root, absolutePath, files);
    } else if (entry.isFile()) {
      files.push(path.relative(root, absolutePath).split(path.sep).join('/'));
    }
  }
  return files;
}

function collectImages(imageSourcePath) {
  const walkedPaths = walkFiles(imageSourcePath);
  const detected = detectImageRoot(walkedPaths);
  const selectedBySource = new Map(
    detected.files.map((entry) => [entry.sourcePath, entry.relativePath]),
  );
  return walkedPaths.flatMap((sourcePath) => {
    const relativePath = selectedBySource.get(sourcePath);
    if (!relativePath || !SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) {
      return [];
    }
    return [{
      relativePath,
      bytes: new Uint8Array(fs.readFileSync(path.join(imageSourcePath, sourcePath))),
    }];
  });
}

function readShareData(shareDataPath) {
  try {
    return JSON.parse(fs.readFileSync(shareDataPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Share Data 不是有效 JSON：${detail}`, { cause: error });
  }
}

export async function buildResourceReleaseFromPaths(options = {}) {
  const shareDataPath = assertFile(options.shareData || options.shareDataPath, 'Share Data');
  const imageSourcePath = assertDirectory(options.images || options.imageSource, '图片目录');
  const outputRoot = assertDirectory(options.output || options.outputRoot, '输出目录');
  if (pathsOverlap(imageSourcePath, outputRoot)) {
    throw new Error('输出目录不能与图片目录重叠。');
  }

  const built = await buildResourceRelease({
    shareData: readShareData(shareDataPath),
    shareDataFileName: path.basename(shareDataPath),
    images: collectImages(imageSourcePath),
    ...(options.generatedAt ? { generatedAt: options.generatedAt } : {}),
    ...(typeof options.onProgress === 'function' ? { onProgress: options.onProgress } : {}),
  });
  await verifyResourceReleaseBundle(built.bytes);

  const outputDir = path.join(outputRoot, built.manifest.releaseVersion);
  if (fs.existsSync(outputDir)) {
    throw new Error(`同版本资源目录已存在，未覆盖：${outputDir}`);
  }
  const bundlePath = path.join(outputDir, built.fileName);
  const manifestPath = path.join(
    outputDir,
    built.fileName.replace(/\.zip$/i, '.manifest.json'),
  );

  try {
    fs.mkdirSync(outputDir, { recursive: false });
    fs.writeFileSync(bundlePath, built.bytes);
    fs.writeFileSync(manifestPath, `${JSON.stringify(built.manifest, null, 2)}\n`, 'utf8');
  } catch (error) {
    fs.rmSync(outputDir, { recursive: true, force: true });
    throw error;
  }

  return {
    mode: 'domestic-resource-release',
    releaseVersion: built.manifest.releaseVersion,
    outputDir,
    bundlePath,
    manifestPath,
    dataVersion: built.manifest.data.version,
    imageVersion: built.manifest.images.version,
    operators: built.manifest.data.summary.operators,
    weapons: built.manifest.data.summary.weapons,
    images: built.manifest.images.files.length,
    bundleBytes: built.bytes.byteLength,
  };
}
