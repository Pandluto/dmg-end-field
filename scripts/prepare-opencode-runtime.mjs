import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import {
  EXIT_CODES,
  REPOSITORY_ROOT,
  RuntimeContractError,
  compareArtifactMetadata,
  displayRelative,
  errorExitCode,
  inspectRegularFile,
  isMainModule,
  normalizeVersionOutput,
  parseCliArguments,
  resolveCacheLayout,
  verifyArtifact,
  verifyDarwinCodeSignature,
} from './opencode-runtime-contract.mjs';

const VERSION_TIMEOUT_MS = 30_000;

function usage() {
  console.log('Usage: node scripts/prepare-opencode-runtime.mjs [--source <absolute-or-relative-file>]');
  console.log('       No source is accepted only when the locked cache binary already matches completely.');
  console.log('       Source discovery, PATH lookup, and network access are not used.');
  console.log('Exit codes: 0=ok 2=usage 3=lock/path 4=source-or-cache-mismatch 6=I/O');
}

function versionCheck(filePath, expectedVersion, label) {
  const result = spawnSync(filePath, ['--version'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    timeout: VERSION_TIMEOUT_MS,
    maxBuffer: 64 * 1024,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    throw new RuntimeContractError(`${label.toUpperCase()}_VERSION_EXEC_FAILED`, `${label} --version failed`);
  }
  if (result.status !== 0) {
    throw new RuntimeContractError(`${label.toUpperCase()}_VERSION_EXEC_FAILED`, `${label} --version returned a non-zero status`);
  }
  if (normalizeVersionOutput(result.stdout) !== expectedVersion) {
    throw new RuntimeContractError(`${label.toUpperCase()}_VERSION_MISMATCH`, `${label} --version does not match`);
  }
}

function verifyBinary(filePath, expected, label, target) {
  const actual = inspectRegularFile(filePath, label);
  compareArtifactMetadata(actual, expected, label.toUpperCase());
  versionCheck(filePath, expected.version, label);
  verifyDarwinCodeSignature(filePath, target);
  return actual;
}

function ensureExecutable(filePath) {
  if (process.platform === 'win32') return;
  const mode = fs.statSync(filePath).mode & 0o777;
  if ((mode & 0o111) === 0) {
    throw new RuntimeContractError('BINARY_NOT_EXECUTABLE', 'prepared binary is not executable');
  }
}

function copyAtomically(sourcePath, targetPath) {
  const targetDirectory = path.dirname(targetPath);
  fs.mkdirSync(targetDirectory, { recursive: true });
  const temporaryPath = path.join(
    targetDirectory,
    `.${path.basename(targetPath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    fs.copyFileSync(sourcePath, temporaryPath, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(temporaryPath, 0o755);
    fs.renameSync(temporaryPath, targetPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
  fs.chmodSync(targetPath, 0o755);
}

function prepare() {
  const parsed = parseCliArguments(process.argv.slice(2), ['--source']);
  if (parsed.help) {
    usage();
    return;
  }

  const layout = resolveCacheLayout(REPOSITORY_ROOT);
  verifyArtifact(layout.licensePath, layout.lock.license, 'license');
  const sourceArgument = parsed.values['--source'];

  if (!sourceArgument) {
    try {
      verifyBinary(layout.binaryPath, layout.lock.binary, 'binary', layout.lock.target);
      ensureExecutable(layout.binaryPath);
      console.log(`OPENCODE_RUNTIME_PREPARE_OK target=${layout.lock.target} runtime=${layout.lock.runtimeVersion} state=existing`);
      return;
    } catch {
      throw new RuntimeContractError('SOURCE_REQUIRED', 'locked cache binary does not fully match; explicit --source is required');
    }
  }

  const sourcePath = path.resolve(process.cwd(), sourceArgument);
  verifyBinary(sourcePath, layout.lock.binary, 'source', layout.lock.target);

  if (path.resolve(sourcePath) === path.resolve(layout.binaryPath)) {
    ensureExecutable(layout.binaryPath);
    console.log(`OPENCODE_RUNTIME_PREPARE_OK target=${layout.lock.target} runtime=${layout.lock.runtimeVersion} state=existing`);
    return;
  }

  copyAtomically(sourcePath, layout.binaryPath);
  verifyBinary(layout.binaryPath, layout.lock.binary, 'binary', layout.lock.target);
  ensureExecutable(layout.binaryPath);
  const relativeTarget = displayRelative(REPOSITORY_ROOT, layout.binaryPath);
  console.log(`OPENCODE_RUNTIME_PREPARE_OK target=${layout.lock.target} runtime=${layout.lock.runtimeVersion} state=installed path=${relativeTarget}`);
}

if (isMainModule(import.meta.url)) {
  try {
    prepare();
  } catch (error) {
    const code = error?.code || 'UNEXPECTED';
    console.error(`OPENCODE_RUNTIME_PREPARE_ERROR code=${code}`);
    process.exitCode = errorExitCode(error, EXIT_CODES.source);
  }
}

export { prepare, verifyBinary, versionCheck };
