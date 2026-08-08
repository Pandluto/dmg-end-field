import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeGeneratedFile } from './write-generated-file.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageMetadata = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
);
const outputPath = path.join(root, 'public', 'version.json');
const manifest = `${JSON.stringify({
  schemaVersion: 1,
  releaseVersion: packageMetadata.version,
  shellVersion: 'development',
}, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
  if (current !== manifest) {
    throw new Error('public/version.json is not synchronized with package.json.');
  }
  console.log(`WEB_VERSION_MANIFEST_OK version=${packageMetadata.version}`);
} else {
  writeGeneratedFile(outputPath, manifest);
  console.log(`Web version manifest: ${packageMetadata.version}.`);
}
