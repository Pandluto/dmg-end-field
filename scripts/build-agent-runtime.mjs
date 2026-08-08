import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const entryPoint = path.join(projectRoot, 'agent', 'runtime', 'host-entry.ts');
const uiConfigFile = path.join(projectRoot, 'vite.agent-session-surface.config.ts');
const noticeFile = path.join(projectRoot, 'agent', 'runtime', 'NOTICE.md');
const provenanceFile = path.join(projectRoot, 'agent', 'runtime', 'source-provenance.json');
const outputDirectory = path.join(projectRoot, 'dist', 'agent');
const outputFile = path.join(outputDirectory, 'host-entry.cjs');
const engineOutputDirectory = path.join(outputDirectory, 'engine', 'def-runtime');
const manifestFile = path.join(engineOutputDirectory, 'manifest.json');
const uiOutputDirectory = path.join(outputDirectory, 'ui');
const evidenceOutputDirectory = path.join(outputDirectory, 'runtime-evidence');
const runtimeVersion = 'def-runtime-v1';
const runtimeSchemaVersion = 1;

for (const [label, filePath] of [
  ['DEF Agent Host runtime entry', entryPoint],
  ['P8 Session Surface Vite config', uiConfigFile],
  ['runtime NOTICE', noticeFile],
  ['runtime source provenance', provenanceFile],
]) {
  if (!fs.existsSync(filePath)) throw new Error(`缺少 ${label}：${filePath}`);
}

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.mkdirSync(outputDirectory, { recursive: true });

await esbuild({
  entryPoints: [entryPoint],
  outfile: outputFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  sourcemap: false,
  logLevel: 'warning',
});

await viteBuild({
  configFile: uiConfigFile,
  mode: 'production',
  logLevel: 'warn',
});

if (!fs.existsSync(outputFile)) throw new Error(`Host bundle 未生成：${outputFile}`);
if (!fs.existsSync(path.join(uiOutputDirectory, 'index.html'))) {
  throw new Error(`Session Surface UI 未生成：${uiOutputDirectory}`);
}

const manifest = {
  schemaVersion: 1,
  engineKind: 'def-runtime',
  runtimeVersion,
  runtimeSchemaVersion,
  hostBundleSha256: sha256(outputFile),
};
fs.mkdirSync(engineOutputDirectory, { recursive: true });
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o644,
});

fs.mkdirSync(evidenceOutputDirectory, { recursive: true });
fs.copyFileSync(noticeFile, path.join(evidenceOutputDirectory, 'NOTICE.md'));
fs.copyFileSync(provenanceFile, path.join(evidenceOutputDirectory, 'source-provenance.json'));

process.stdout.write(`[build-agent-runtime] host ${path.relative(projectRoot, outputFile)}\n`);
process.stdout.write(`[build-agent-runtime] ui ${path.relative(projectRoot, uiOutputDirectory)}\n`);
process.stdout.write(
  `[build-agent-runtime] ${manifest.engineKind} ${manifest.runtimeVersion} `
  + `host=${manifest.hostBundleSha256.slice(0, 12)}…\n`,
);

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
