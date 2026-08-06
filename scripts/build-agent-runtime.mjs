import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import {
  resolveCacheLayout,
  inspectRuntimeCode,
  verifyArtifact,
  verifyDarwinCodeSignature,
} from './opencode-runtime-contract.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const entryPoint = path.join(projectRoot, 'agent', 'runtime', 'host-entry.ts');
const pluginEntryPoint = path.join(projectRoot, 'agent', 'engines', 'opencode', 'plugin-entry.ts');
const outputDirectory = path.join(projectRoot, 'dist', 'agent');
const outputFile = path.join(outputDirectory, 'host-entry.cjs');
const engineOutputDirectory = path.join(outputDirectory, 'engine', 'opencode');
const pluginOutputFile = path.join(engineOutputDirectory, 'plugin.mjs');

if (!fs.existsSync(entryPoint)) {
  throw new Error(`缺少 DEF Agent Host runtime entry：${entryPoint}`);
}
if (!fs.existsSync(pluginEntryPoint)) {
  throw new Error(`缺少 DEF OpenCode plugin entry：${pluginEntryPoint}`);
}

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.mkdirSync(outputDirectory, { recursive: true });
fs.mkdirSync(engineOutputDirectory, { recursive: true });
await Promise.all([
  build({
    entryPoints: [entryPoint],
    outfile: outputFile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    sourcemap: false,
    logLevel: 'warning',
  }),
  build({
    entryPoints: [pluginEntryPoint],
    outfile: pluginOutputFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'warning',
  }),
]);

const layout = resolveCacheLayout(projectRoot);
verifyArtifact(layout.binaryPath, layout.lock.binary, 'binary');
verifyDarwinCodeSignature(layout.binaryPath, layout.lock.target);
verifyArtifact(layout.licensePath, layout.lock.license, 'license');
const binaryOutputFile = path.join(
  engineOutputDirectory,
  ...layout.lock.binary.runtimePath.split('/'),
);
const licenseOutputFile = path.join(
  engineOutputDirectory,
  ...layout.lock.license.runtimePath.split('/'),
);
fs.mkdirSync(path.dirname(binaryOutputFile), { recursive: true });
fs.copyFileSync(layout.binaryPath, binaryOutputFile);
fs.chmodSync(binaryOutputFile, 0o755);
verifyDarwinCodeSignature(binaryOutputFile, layout.lock.target);
fs.copyFileSync(layout.licensePath, licenseOutputFile);
fs.copyFileSync(layout.lockPath, path.join(engineOutputDirectory, 'runtime-lock.json'));

const binaryCode = inspectRuntimeCode(binaryOutputFile, layout.lock.target);
const manifest = {
  schemaVersion: 1,
  name: 'def-opencode-engine-runtime',
  engineKind: 'opencode',
  upstreamVersion: layout.lock.upstreamVersion,
  runtimeVersion: layout.lock.runtimeVersion,
  storeSchemaVersion: layout.lock.storeSchemaVersion,
  target: layout.lock.target,
  sourceRef: layout.lock.sourceRef,
  binary: layout.lock.binary.runtimePath,
  binaryVersion: layout.lock.binary.version,
  binaryCodeBytes: binaryCode.bytes,
  binaryCodeSha256: binaryCode.sha256,
  plugin: 'plugin.mjs',
  pluginSha256: sha256(pluginOutputFile),
  license: layout.lock.license.runtimePath,
  licenseBytes: layout.lock.license.bytes,
  licenseSha256: layout.lock.license.sha256,
};
fs.writeFileSync(
  path.join(engineOutputDirectory, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { encoding: 'utf8', mode: 0o644 },
);

process.stdout.write(`[build-agent-runtime] built ${path.relative(projectRoot, outputFile)}\n`);
process.stdout.write(
  `[build-agent-runtime] bundled OpenCode ${manifest.runtimeVersion} for ${manifest.target}\n`,
);

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
