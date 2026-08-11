import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildResourceRelease } from '../src/platform/resources/resourceReleasePackager.ts';
import { detectImageRoot, SUPPORTED_IMAGE_EXTENSIONS } from '../src/platform/resources/resourceReleaseCore.ts';
import { verifyResourceReleaseBundle } from '../src/platform/resources/resourceReleaseVerifier.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) throw new Error(`未知参数：${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} 缺少值。`);
    values.set(argument.slice(2), value);
    index += 1;
  }
  return values;
}

function walkFiles(root, current = root, files = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) walkFiles(root, absolutePath, files);
    else if (entry.isFile()) files.push(path.relative(root, absolutePath).split(path.sep).join('/'));
  }
  return files;
}

function extension(filePath) {
  return path.extname(filePath).toLowerCase();
}

const args = parseArguments(process.argv.slice(2));
const shareDataPath = path.resolve(args.get('share-data') || '');
const imageSourcePath = path.resolve(args.get('images') || '');
const outputArgument = args.get('output') || path.join(repositoryRoot, '.runtime', 'resource-releases');

if (!args.get('share-data') || !fs.statSync(shareDataPath, { throwIfNoEntry: false })?.isFile()) {
  throw new Error('请通过 --share-data 指定一个 Share Data JSON。');
}
if (!args.get('images') || !fs.statSync(imageSourcePath, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error('请通过 --images 指定图片目录。');
}

const walkedPaths = walkFiles(imageSourcePath);
const detected = detectImageRoot(walkedPaths);
const selectedBySource = new Map(detected.files.map((entry) => [entry.sourcePath, entry.relativePath]));
const images = walkedPaths.flatMap((sourcePath) => {
  const relativePath = selectedBySource.get(sourcePath);
  if (!relativePath || !SUPPORTED_IMAGE_EXTENSIONS.has(extension(relativePath))) return [];
  return [{
    relativePath,
    bytes: new Uint8Array(fs.readFileSync(path.join(imageSourcePath, sourcePath))),
  }];
});
const shareData = JSON.parse(fs.readFileSync(shareDataPath, 'utf8').replace(/^\uFEFF/, ''));
const built = await buildResourceRelease({
  shareData,
  shareDataFileName: path.basename(shareDataPath),
  images,
  onProgress(progress) {
    if (
      progress.stage !== 'hashing-images'
      || progress.completed === progress.total
      || progress.completed % 50 === 0
    ) {
      console.log(`[${progress.stage}] ${progress.completed}/${progress.total} ${progress.label}`);
    }
  },
});
await verifyResourceReleaseBundle(built.bytes);

const requestedOutput = path.resolve(outputArgument);
const outputPath = requestedOutput.toLowerCase().endsWith('.zip')
  ? requestedOutput
  : path.join(requestedOutput, built.fileName);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, built.bytes);
const manifestOutputPath = outputPath.replace(/\.zip$/i, '.manifest.json');
fs.writeFileSync(manifestOutputPath, `${JSON.stringify(built.manifest, null, 2)}\n`);

console.log(`RESOURCE_RELEASE_BUILT version=${built.manifest.releaseVersion}`);
console.log(`RESOURCE_RELEASE_BUNDLE ${outputPath}`);
console.log(`RESOURCE_RELEASE_MANIFEST ${manifestOutputPath}`);
console.log(
  `RESOURCE_RELEASE_SUMMARY operators=${built.manifest.data.summary.operators} `
  + `weapons=${built.manifest.data.summary.weapons} images=${built.manifest.images.files.length} `
  + `bundleBytes=${built.bytes.byteLength}`,
);
