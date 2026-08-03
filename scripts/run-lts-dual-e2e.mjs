import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const ltsBaseUrl = process.env.LTS_DUAL_BASE_URL || 'http://127.0.0.1:3030';
const slimBaseUrl = process.env.SLIM_DUAL_BASE_URL || 'http://127.0.0.1:3040';

function findLtsWorktree() {
  if (process.env.LTS_DUAL_WORKTREE) {
    return path.resolve(process.env.LTS_DUAL_WORKTREE);
  }
  const output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  for (const block of output.trim().split(/\n\n+/)) {
    const lines = block.split('\n');
    const worktree = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length);
    const branch = lines.find((line) => line.startsWith('branch '))?.slice('branch '.length);
    if (worktree && branch === 'refs/heads/v1.8-LTS') return worktree;
  }
  return null;
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
  if (!(await isReachable(ltsBaseUrl))) {
    const ltsWorktree = findLtsWorktree();
    if (!ltsWorktree) {
      throw new Error(
        'No v1.8-LTS worktree was found. Set LTS_DUAL_WORKTREE or start LTS_DUAL_BASE_URL manually.',
      );
    }
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

  const exitCode = await new Promise((resolve, reject) => {
    runner.once('error', reject);
    runner.once('exit', (code) => resolve(code ?? 1));
  });

  if (ltsServer && ltsServer.exitCode === null) {
    ltsServer.kill('SIGTERM');
  }
  process.exitCode = exitCode;
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
