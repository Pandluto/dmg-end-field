import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildResourceReleaseFromPaths } from './resource-release-file-builder.mjs';

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

const args = parseArguments(process.argv.slice(2));
const outputRoot = path.resolve(
  args.get('output') || path.join(repositoryRoot, '.runtime', 'resource-releases'),
);
fs.mkdirSync(outputRoot, { recursive: true });

const result = await buildResourceReleaseFromPaths({
  shareData: args.get('share-data'),
  images: args.get('images'),
  output: outputRoot,
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

console.log(`RESOURCE_RELEASE_BUILT version=${result.releaseVersion}`);
console.log(`RESOURCE_RELEASE_BUNDLE ${result.bundlePath}`);
console.log(`RESOURCE_RELEASE_MANIFEST ${result.manifestPath}`);
console.log(
  `RESOURCE_RELEASE_SUMMARY operators=${result.operators} weapons=${result.weapons} `
  + `images=${result.images} bundleBytes=${result.bundleBytes}`,
);
