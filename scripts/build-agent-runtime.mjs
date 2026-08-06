import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const entryPoint = path.join(projectRoot, 'agent', 'runtime', 'host-entry.ts');
const outputDirectory = path.join(projectRoot, 'dist', 'agent');
const outputFile = path.join(outputDirectory, 'host-entry.cjs');

if (!fs.existsSync(entryPoint)) {
  throw new Error(`缺少 DEF Agent Host runtime entry：${entryPoint}`);
}

fs.mkdirSync(outputDirectory, { recursive: true });
await build({
  entryPoints: [entryPoint],
  outfile: outputFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  sourcemap: false,
  logLevel: 'warning',
});

process.stdout.write(`[build-agent-runtime] built ${path.relative(projectRoot, outputFile)}\n`);
