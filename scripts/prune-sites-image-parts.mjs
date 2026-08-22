import fs from 'node:fs';
import path from 'node:path';

const clientRoot = path.resolve(process.argv[2] || 'dist/client');
const manifestPath = path.join(clientRoot, 'web-image-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const parts = manifest.archive?.parts;
if (!Array.isArray(parts) || parts.length === 0) {
  throw new Error('Sites image fallback requires archive parts in the shared manifest.');
}

let removedBytes = 0;
let removedParts = 0;
for (const part of parts) {
  const outputPath = path.resolve(clientRoot, part.path);
  if (!outputPath.startsWith(`${clientRoot}${path.sep}`)) {
    throw new Error(`Refusing to prune outside Sites client output: ${part.path}`);
  }
  if (!fs.existsSync(outputPath)) {
    throw new Error(`Sites image archive part was not materialized: ${part.path}`);
  }
  const byteSize = fs.statSync(outputPath).size;
  if (byteSize !== part.size) {
    throw new Error(`Sites image archive part size mismatch: ${part.path}`);
  }
  removedBytes += byteSize;
  removedParts += 1;
  fs.rmSync(outputPath, { force: true });
}
for (const entry of manifest.files) {
  const outputPath = path.resolve(clientRoot, entry.path);
  if (!outputPath.startsWith(`${clientRoot}${path.sep}`)) {
    throw new Error(`Refusing to verify outside Sites client output: ${entry.path}`);
  }
  if (!fs.existsSync(outputPath)) {
    throw new Error(`Sites individual image fallback is missing: ${entry.path}`);
  }
}

console.log(
  `Sites image delivery: pruned ${removedParts} archive parts (${removedBytes} bytes); `
  + `kept ${manifest.files.length} individually verified image files.`,
);
