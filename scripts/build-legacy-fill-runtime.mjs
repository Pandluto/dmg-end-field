import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const outputDirectory = path.resolve('dist', 'legacy-fill');
fs.mkdirSync(outputDirectory, { recursive: true });
await build({
  entryPoints: [path.resolve('src', 'legacyFillService', 'domain-runtime-entry.ts')],
  outfile: path.join(outputDirectory, 'domain-runtime.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: false,
  logLevel: 'warning',
});
process.stdout.write('[build-legacy-fill-runtime] built dist/legacy-fill/domain-runtime.mjs\n');
