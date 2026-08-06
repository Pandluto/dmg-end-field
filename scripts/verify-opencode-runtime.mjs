import fs from 'node:fs';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import {
  EXIT_CODES,
  REPOSITORY_ROOT,
  RuntimeContractError,
  compareArtifactMetadata,
  errorExitCode,
  inspectRegularFile,
  isMainModule,
  normalizeVersionOutput,
  parseCliArguments,
  resolveCacheLayout,
  resolveRootLayout,
  verifyDarwinCodeSignature,
} from './opencode-runtime-contract.mjs';

const VERSION_TIMEOUT_MS = 30_000;

function usage() {
  console.log('Usage: node scripts/verify-opencode-runtime.mjs [--root <runtime-root>]');
  console.log('       Default mode verifies the repository cache selected by runtime-lock.json.');
  console.log('       Root mode reads <root>/runtime-lock.json and verifies runtimePath layout.');
  console.log('       A package root containing agent/engines/opencode/runtime-lock.json is also supported.');
  console.log('Exit codes: 0=ok 2=usage 3=lock/path 5=verification mismatch 6=I/O');
}

function versionCheck(filePath, expectedVersion) {
  const result = spawnSync(filePath, ['--version'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    timeout: VERSION_TIMEOUT_MS,
    maxBuffer: 64 * 1024,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    throw new RuntimeContractError('BINARY_VERSION_EXEC_FAILED', 'binary --version failed');
  }
  if (normalizeVersionOutput(result.stdout) !== expectedVersion) {
    throw new RuntimeContractError('BINARY_VERSION_MISMATCH', 'binary --version does not match the lock');
  }
}

function verifyBinary(filePath, expected, target) {
  const actual = inspectRegularFile(filePath, 'binary');
  compareArtifactMetadata(actual, expected, 'BINARY');
  versionCheck(filePath, expected.version);
  verifyDarwinCodeSignature(filePath, target);
  if (process.platform !== 'win32' && (fs.statSync(filePath).mode & 0o111) === 0) {
    throw new RuntimeContractError('BINARY_NOT_EXECUTABLE', 'binary is not executable');
  }
  return actual;
}

function verifyLicense(layout) {
  if (!layout.licenseRequired && !fs.existsSync(layout.licensePath)) return { skipped: true };
  const stat = inspectRegularFile(layout.licensePath, 'license');
  compareArtifactMetadata(stat, layout.lock.license, 'LICENSE');
  return { skipped: false, ...stat };
}

function verify() {
  const parsed = parseCliArguments(process.argv.slice(2), ['--root']);
  if (parsed.help) {
    usage();
    return;
  }

  const rootArgument = parsed.values['--root'];
  const layout = rootArgument
    ? resolveRootLayout(rootArgument)
    : resolveCacheLayout(REPOSITORY_ROOT);
  verifyBinary(layout.binaryPath, layout.lock.binary, layout.lock.target);
  verifyLicense(layout);

  console.log(
    `OPENCODE_RUNTIME_VERIFY_OK mode=${layout.mode} target=${layout.lock.target} runtime=${layout.lock.runtimeVersion}`
      + ` binary=${layout.lock.binary.runtimePath}`,
  );
}

if (isMainModule(import.meta.url)) {
  try {
    verify();
  } catch (error) {
    const code = error?.code || 'UNEXPECTED';
    console.error(`OPENCODE_RUNTIME_VERIFY_ERROR code=${code}`);
    process.exitCode = errorExitCode(error, EXIT_CODES.verify);
  }
}

export { verify, verifyBinary, verifyLicense, versionCheck };
