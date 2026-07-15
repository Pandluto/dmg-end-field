import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const rawTag = process.argv[2] || process.env.GITHUB_REF_NAME || '';
const tagVersion = rawTag.startsWith('v') ? rawTag.slice(1) : rawTag;
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

if (!semver.test(tagVersion)) {
  console.error(`RELEASE_VERSION_INVALID tag=${rawTag || '<missing>'}`);
  process.exit(1);
}

if (tagVersion !== packageJson.version) {
  console.error(`RELEASE_VERSION_MISMATCH tag=${tagVersion} package=${packageJson.version}`);
  process.exit(1);
}

console.log(`RELEASE_VERSION_OK version=${tagVersion}`);
