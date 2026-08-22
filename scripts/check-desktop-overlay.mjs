import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractPath = path.join(repositoryRoot, 'desktop-overlay.json');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

function git(args) {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

function gitPaths(args) {
  const separator = args.indexOf('--');
  const commandArgs = separator >= 0
    ? [...args.slice(0, separator), '-z', ...args.slice(separator)]
    : [...args, '-z'];
  return git(commandArgs).split('\0').filter(Boolean);
}

function matchesAny(relativePath, patterns) {
  return patterns.some((pattern) => pattern.test(relativePath));
}

if (
  contract.schemaVersion !== 1
  || typeof contract.slimmingBranch !== 'string'
  || !/^[0-9a-f]{40}$/u.test(contract.slimmingCommit)
  || !Array.isArray(contract.desktopOverrides)
  || contract.desktopOverrides.length === 0
) {
  throw new Error('desktop-overlay.json is invalid.');
}

const baseline = contract.slimmingCommit;
git(['cat-file', '-e', `${baseline}^{commit}`]);
const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', baseline, 'HEAD'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
});
if (ancestry.status !== 0) {
  throw new Error(`Slimming baseline ${baseline.slice(0, 8)} is not an ancestor of HEAD.`);
}

const allowedModifiedExisting = [
  /^\.gitignore$/u,
  /^AGENTS\.md$/u,
  /^README\.md$/u,
  /^docs\//u,
  /^index\.html$/u,
  /^package(?:-lock)?\.json$/u,
  /^scripts\/(?:build-resource-release|repository-check|run-ts-test)\.mjs$/u,
  /^tsconfig\.json$/u,
  /^vite\.config\.ts$/u,
];

const allowedAdded = [
  /^agent\//u,
  /^desktop-overlay\.json$/u,
  /^docs\//u,
  /^electron\//u,
  /^public\/sw-desktop\.js$/u,
  /^scripts\/check-desktop-overlay\.mjs$/u,
  /^scripts\/(?:agent-|build-(?:agent|desktop|image|legacy)|check-(?:desktop|packaged)|desktop-|legacy-fill-|notarize|opencode-|prepare-opencode-|resource-release-file-builder|verify-opencode-)/u,
  /^scripts\/testing\/agent-/u,
  /^src\/agentSessionSurface\//u,
  /^src\/components\/AgentMode\//u,
  /^src\/components\/(?:McpFillPage|mcpFillReviewModel)(?:\.|$)/u,
  /^src\/components\/mcpFillResults\//u,
  /^src\/components\/CanvasBoard\/preparedWorkNodeTrust\.test\.ts$/u,
  /^src\/legacyFill(?:Core|Host|Service)\//u,
  /^src\/platform\/(?:agent|desktop)\//u,
  /^src\/platform\/runtime\/desktop[A-Z][A-Za-z0-9]*\.ts$/u,
  /^src\/desktop-entry\.ts$/u,
  /^src\/(?:components|context|core|utils)\/.*\.desktop(?:\.test)?\.(?:css|ts|tsx)$/u,
  /^tsconfig\.agent\.json$/u,
  /^vite\.agent-session-surface\.config\.ts$/u,
];

const changedPaths = new Set([
  ...gitPaths(['diff', '--name-only', baseline, '--']),
  ...gitPaths(['ls-files', '--others', '--exclude-standard']),
]);
const deletedPaths = new Set(gitPaths(['diff', '--name-only', '--diff-filter=D', baseline, '--']));
const violations = [];
let inheritedCount = 0;
let overlayCount = 0;

for (const relativePath of [...changedPaths].sort()) {
  const existedInBaseline = spawnSync('git', ['cat-file', '-e', `${baseline}:${relativePath}`], {
    cwd: repositoryRoot,
    stdio: 'ignore',
  }).status === 0;
  if (existedInBaseline) {
    if (deletedPaths.has(relativePath)) {
      violations.push(`shared baseline path was deleted: ${relativePath}`);
    } else if (!matchesAny(relativePath, allowedModifiedExisting)) {
      violations.push(`shared baseline path changed outside an assembly/document seam: ${relativePath}`);
    } else {
      inheritedCount += 1;
    }
    continue;
  }
  if (!matchesAny(relativePath, allowedAdded)) {
    violations.push(`new path is outside the Desktop overlay boundary: ${relativePath}`);
  } else {
    overlayCount += 1;
  }
}

for (const pair of contract.desktopOverrides) {
  if (
    !pair
    || typeof pair.base !== 'string'
    || typeof pair.overlay !== 'string'
    || !fs.existsSync(path.join(repositoryRoot, pair.overlay))
  ) {
    violations.push(`invalid Desktop override pair: ${JSON.stringify(pair)}`);
    continue;
  }
  if (spawnSync('git', ['diff', '--quiet', baseline, '--', pair.base], { cwd: repositoryRoot }).status !== 0) {
    violations.push(`Desktop override modified its Slimming base file: ${pair.base}`);
  }
}

const tsconfigSource = fs.readFileSync(path.join(repositoryRoot, 'tsconfig.json'), 'utf8');
const viteSource = fs.readFileSync(path.join(repositoryRoot, 'vite.config.ts'), 'utf8');
const indexSource = fs.readFileSync(path.join(repositoryRoot, 'index.html'), 'utf8');
if (!/"moduleSuffixes"\s*:\s*\[\s*"\.desktop"\s*,\s*""\s*\]/u.test(tsconfigSource)) {
  violations.push('tsconfig.json no longer resolves .desktop modules before shared modules.');
}
if (!viteSource.includes("'.desktop.tsx'") || !viteSource.includes("'.desktop.ts'")) {
  violations.push('vite.config.ts no longer resolves the Desktop overlay suffix.');
}
if (!indexSource.includes('/src/desktop-entry.ts')) {
  violations.push('index.html no longer enters through the Desktop host adapter.');
}

if (violations.length > 0) {
  console.error(`DESKTOP_OVERLAY_CHECK_FAILED (${violations.length})`);
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    `DESKTOP_OVERLAY_CHECK_OK baseline=${baseline.slice(0, 8)} `
    + `assembly=${inheritedCount} overlay=${overlayCount} overrides=${contract.desktopOverrides.length}`,
  );
}
