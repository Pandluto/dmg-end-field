import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function countMatches(relativePath, pattern) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  return [...source.matchAll(pattern)].length;
}

const browserStorageWrites = [
  'src/utils/timelineSnapshotStorage.ts',
  'src/core/repositories/buffRepository.ts',
  'src/core/repositories/operatorConfigRepository.ts',
].reduce((count, filePath) => count + countMatches(filePath, /(?:localStorage|sessionStorage|safeSessionStorage)\.(?:setItem|removeItem)/g), 0);

const localShareUiReferences = [
  'public/shell/index.html',
  'public/shell/shell.js',
].reduce((count, filePath) => count + countMatches(filePath, /本机存档|共享存档|now-storage/g), 0);

const dataReleaseRuntimeReferences = [
  'electron/main.cjs',
  'public/shell/shell.js',
].reduce((count, filePath) => count + countMatches(filePath, /data-release-manifest|catalog\.sqlite|user\.sqlite/g), 0);

const results = [
  { id: 'AC-01', status: 'pass-demo', evidence: 'data-management-sqlite-demo: active catalog missing -> builtin catalog fallback' },
  { id: 'AC-02', status: dataReleaseRuntimeReferences ? 'partial' : 'gap', evidence: `runtime data-release references: ${dataReleaseRuntimeReferences}; demo validates staged full SQLite, hash, integrity, compatibility, and rollback only` },
  { id: 'AC-03', status: 'pass-demo', evidence: 'data-management-sqlite-demo: catalog replacement leaves user.sqlite SHA-256 unchanged' },
  { id: 'AC-04', status: browserStorageWrites === 0 ? 'pass' : 'gap', evidence: `formal browser-storage writes in target repositories: ${browserStorageWrites}` },
  { id: 'AC-05', status: 'partial', evidence: 'demo proves checkout + audit rollback in one SQLite transaction; current Renderer still owns a browser-storage working copy' },
  { id: 'AC-06', status: 'partial', evidence: 'demo clones a catalog template into a user document; no production catalog/template Repository exists yet' },
  { id: 'AC-07', status: 'partial', evidence: 'demo proves idempotent legacy archive import while retaining source; production local/share migration and backup flow is absent' },
  { id: 'AC-08', status: localShareUiReferences === 0 ? 'pass' : 'gap', evidence: `active Shell local/share/now-storage references: ${localShareUiReferences}` },
  { id: 'AC-09', status: 'pass-existing', evidence: 'scripts/timeline-bundle-v2-smoke.mjs passed against the current main worktree' },
  { id: 'AC-10', status: 'unverified', evidence: 'Spec ownership is a documentation/governance boundary; it has no runtime assertion yet' },
];

console.table(results);
const gaps = results.filter((result) => ['gap', 'partial', 'unverified'].includes(result.status));
console.log(JSON.stringify({ ok: gaps.length === 0, gaps: gaps.map((result) => result.id) }, null, 2));

if (process.argv.includes('--strict') && gaps.length > 0) {
  process.exitCode = 1;
}
