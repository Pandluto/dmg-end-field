import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(repositoryRoot, 'public');
const dataRoot = path.join(publicRoot, 'data');
const outputPath = path.join(publicRoot, 'web-data-manifest.json');
const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return walk(absolutePath);
      if (!entry.isFile() || !entry.name.endsWith('.json')) return [];
      return [absolutePath];
    });
}

const files = walk(dataRoot).map((absolutePath) => {
  const bytes = fs.readFileSync(absolutePath);
  return {
    path: path.relative(publicRoot, absolutePath).split(path.sep).join('/'),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    size: bytes.byteLength,
  };
});

const comparableManifest = {
  schemaVersion: 1,
  packageId: 'dmg-end-field-core-data',
  version: packageJson.version,
  files,
  totalBytes: files.reduce((sum, file) => sum + file.size, 0),
};

let generatedAt = new Date().toISOString();
try {
  const previous = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  const { generatedAt: previousGeneratedAt, ...previousComparable } = previous;
  if (JSON.stringify(previousComparable) === JSON.stringify(comparableManifest)) {
    generatedAt = previousGeneratedAt;
  }
} catch {
  // A missing or invalid previous manifest represents a new package build.
}

const manifest = {
  ...comparableManifest,
  generatedAt,
};

fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Web data manifest: ${files.length} files, ${manifest.totalBytes} bytes.`);
