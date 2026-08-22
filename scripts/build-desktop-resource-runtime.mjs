import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(repositoryRoot, 'dist', 'resource-release');
const outputFile = path.join(outputRoot, 'builder.mjs');

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

await build({
  entryPoints: [path.join(repositoryRoot, 'scripts', 'resource-release-file-builder.mjs')],
  outfile: outputFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'bundle',
  legalComments: 'none',
  logLevel: 'warning',
});

console.log(`Desktop resource release runtime built: ${outputFile}`);
