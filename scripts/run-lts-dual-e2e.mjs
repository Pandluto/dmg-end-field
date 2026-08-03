import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const ltsBaseUrl = process.env.LTS_DUAL_BASE_URL || 'http://127.0.0.1:3030';
const slimBaseUrl = process.env.SLIM_DUAL_BASE_URL || 'http://127.0.0.1:3040';
const ltsExpectedBranch = process.env.LTS_DUAL_LTS_BRANCH || 'v1.8-LTS';
const slimExpectedBranch = process.env.LTS_DUAL_SLIM_BRANCH || 'codex/v1.8-lts-slimming';

function command(commandName, args, cwd = repoRoot) {
  return execFileSync(commandName, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function readGitIdentity(cwd) {
  return {
    root: path.resolve(command('git', ['rev-parse', '--show-toplevel'], cwd)),
    branch: command('git', ['branch', '--show-current'], cwd),
    head: command('git', ['rev-parse', 'HEAD'], cwd),
    dirty: command('git', ['status', '--porcelain'], cwd).length > 0,
  };
}

function findLtsWorktree() {
  if (process.env.LTS_DUAL_WORKTREE) {
    return path.resolve(process.env.LTS_DUAL_WORKTREE);
  }
  const output = command('git', ['worktree', 'list', '--porcelain']);
  for (const block of output.trim().split(/\n\n+/)) {
    const lines = block.split('\n');
    const worktree = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length);
    const branch = lines.find((line) => line.startsWith('branch '))?.slice('branch '.length);
    if (worktree && branch === `refs/heads/${ltsExpectedBranch}`) return worktree;
  }
  return null;
}

function readServerIdentity(baseUrl, label) {
  const target = new URL(baseUrl);
  const hostname = target.hostname.replace(/^\[|\]$/g, '');
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
    throw new Error(`${label} identity check requires a local URL, received ${baseUrl}.`);
  }
  const port = target.port || (target.protocol === 'https:' ? '443' : '80');
  let processIds = [];
  try {
    processIds = [...new Set(
      command('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
        .split('\n')
        .filter(Boolean),
    )];
  } catch {
    throw new Error(
      `${label} is reachable at ${baseUrl}, but its listener could not be inspected with lsof.`,
    );
  }
  if (processIds.length !== 1) {
    throw new Error(`${label} expected one listener at ${baseUrl}, received ${processIds.length}.`);
  }
  const processId = processIds[0];
  const cwd = command('lsof', ['-a', '-p', processId, '-d', 'cwd', '-Fn'])
    .split('\n')
    .find((line) => line.startsWith('n'))
    ?.slice(1);
  if (!cwd) {
    throw new Error(`${label} listener PID ${processId} did not expose a cwd.`);
  }
  return { processId, ...readGitIdentity(cwd) };
}

function assertServerIdentity({ label, baseUrl, expectedWorktree, expectedBranch }) {
  const expected = readGitIdentity(expectedWorktree);
  if (expected.branch !== expectedBranch) {
    throw new Error(`${label} expected ${expectedBranch}, but worktree is on ${expected.branch}.`);
  }
  const actual = readServerIdentity(baseUrl, label);
  if (
    actual.root !== expected.root
    || actual.branch !== expected.branch
    || actual.head !== expected.head
  ) {
    throw new Error(
      [
        `${label} identity mismatch at ${baseUrl} (PID ${actual.processId}).`,
        `Expected ${expected.root} [${expected.branch}@${expected.head.slice(0, 8)}].`,
        `Received ${actual.root} [${actual.branch || 'detached HEAD'}@${actual.head.slice(0, 8)}].`,
      ].join(' '),
    );
  }
  const dirtySuffix = expected.dirty ? ' dirty' : ' clean';
  console.log(
    `[dual-run identity] ${label}: ${baseUrl} -> ${expected.root} [${expected.branch}@${expected.head.slice(0, 8)},${dirtySuffix}]`,
  );
}

async function isReachable(url) {
  try {
    const response = await fetch(url, { redirect: 'manual' });
    return response.ok || response.status === 304;
  } catch {
    return false;
  }
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`v1.8-LTS server exited before becoming ready (code ${child.exitCode}).`);
    }
    if (await isReachable(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for v1.8-LTS server at ${url}.`);
}

function runPreparation(cwd, script) {
  execFileSync('npm', ['run', script], {
    cwd,
    stdio: 'inherit',
  });
}

async function run() {
  let ltsServer = null;
  try {
    const ltsWorktree = findLtsWorktree();
    if (!ltsWorktree) {
      throw new Error(
        `No ${ltsExpectedBranch} worktree was found. Set LTS_DUAL_WORKTREE to its local path.`,
      );
    }
    if (!(await isReachable(ltsBaseUrl))) {
      runPreparation(ltsWorktree, 'assets:web-prepare');
      runPreparation(ltsWorktree, 'data:web-manifest');

      const target = new URL(ltsBaseUrl);
      const vitePath = path.join(ltsWorktree, 'node_modules', '.bin', 'vite');
      ltsServer = spawn(vitePath, [
        '--host',
        target.hostname,
        '--port',
        target.port || '80',
        '--strictPort',
      ], {
        cwd: ltsWorktree,
        stdio: 'inherit',
      });
      await waitForServer(ltsBaseUrl, ltsServer);
    }
    if (!(await isReachable(slimBaseUrl))) {
      throw new Error(
        `v1.8 slim server is not reachable at ${slimBaseUrl}. Start ${slimExpectedBranch} on that URL first.`,
      );
    }

    assertServerIdentity({
      label: 'v1.8-LTS',
      baseUrl: ltsBaseUrl,
      expectedWorktree: ltsWorktree,
      expectedBranch: ltsExpectedBranch,
    });
    assertServerIdentity({
      label: 'v1.8-slim',
      baseUrl: slimBaseUrl,
      expectedWorktree: repoRoot,
      expectedBranch: slimExpectedBranch,
    });

    const playwrightPath = path.join(repoRoot, 'node_modules', '.bin', 'playwright');
    const runner = spawn(playwrightPath, [
      'test',
      'tests/e2e/lts-dual-run.spec.ts',
    ], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        LTS_DUAL_BASE_URL: ltsBaseUrl,
        SLIM_DUAL_BASE_URL: slimBaseUrl,
      },
    });

    return await new Promise((resolve, reject) => {
      runner.once('error', reject);
      runner.once('exit', (code) => resolve(code ?? 1));
    });
  } finally {
    if (ltsServer && ltsServer.exitCode === null) {
      ltsServer.kill('SIGTERM');
    }
  }
}

run()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
