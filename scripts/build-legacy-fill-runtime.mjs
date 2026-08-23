import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const outputDirectory = path.resolve('dist', 'legacy-fill');
fs.mkdirSync(outputDirectory, { recursive: true });
const shared = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  logLevel: 'warning',
};

await Promise.all([
  build({
    ...shared,
    entryPoints: [path.resolve('src', 'legacyFillService', 'domain-runtime-entry.ts')],
    outfile: path.join(outputDirectory, 'domain-runtime.mjs'),
  }),
  build({
    ...shared,
    entryPoints: [path.resolve('scripts', 'legacy-fill-service.mjs')],
    outfile: path.join(outputDirectory, 'service.mjs'),
  }),
  build({
    ...shared,
    entryPoints: [path.resolve('scripts', 'legacy-fill-mcp-stdio.mjs')],
    outfile: path.join(outputDirectory, 'stdio.mjs'),
  }),
]);

const resourceOutput = path.join(outputDirectory, 'resources');
fs.mkdirSync(resourceOutput, { recursive: true });
const resourceSource = path.resolve('src', 'legacyFillService', 'resources');
const resourceFiles = fs.readdirSync(resourceSource)
  .filter((fileName) => /^(?:strategy|golden)-v\d+\.json$/u.test(fileName))
  .sort();
for (const fileName of resourceFiles) {
  fs.copyFileSync(
    path.join(resourceSource, fileName),
    path.join(resourceOutput, fileName),
  );
}

process.stdout.write('[build-legacy-fill-runtime] built bundled service, stdio facade, domain runtime, and resources\n');
