import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const resourceRoot = path.join(root, 'src', 'legacyFillService', 'resources');
const strategyPath = path.join(resourceRoot, 'strategy-v1.json');
const goldenPath = path.join(resourceRoot, 'golden-v1.json');
const runtimePath = path.join(root, 'dist', 'legacy-fill', 'domain-runtime.mjs');
const skillPath = path.join(root, 'agent', 'runtime', 'def', 'skills', 'akedatabase-fill-tool', 'SKILL.md');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const strategy = JSON.parse(fs.readFileSync(strategyPath, 'utf8'));
const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
const runtime = await import(runtimePath);

assert.equal(strategy.version, 'v1');
assert.equal(strategy.kind, 'strategy-not-protocol');
assert.equal(strategy.separation.strategyIsProtocol, false);
assert.equal(golden.version, 'v1');
assert.equal(golden.kind, 'validated-curated-fixtures');

let fixtureCount = 0;
for (const [domain, group] of Object.entries(golden.domains)) {
  assert.equal(group.schemaVersion, 1, `${domain} fixtures bind schema version 1`);
  assert.ok(Array.isArray(group.fixtures) && group.fixtures.length > 0, `${domain} has fixtures`);
  for (const fixture of group.fixtures) {
    const validation = runtime.validateLegacyFillDraft(domain, fixture.draft);
    assert.equal(validation.valid, true, `${domain}/${fixture.id}: ${(validation.errors || []).join('; ')}`);
    fixtureCount += 1;
  }
}

const resourceFiles = fs.readdirSync(resourceRoot).filter((name) => name.endsWith('.json')).sort();
assert.deepEqual(resourceFiles, ['golden-v1.json', 'strategy-v1.json']);
const resourceText = resourceFiles.map((name) => fs.readFileSync(path.join(resourceRoot, name), 'utf8')).join('\n');
const forbiddenResourcePatterns = [
  ['/Users absolute path', /\/Users\//],
  ['Windows absolute path', /[A-Za-z]:\\\\/],
  ['loopback endpoint', /(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i],
  ['bearer credential', /Bearer\s+[A-Za-z0-9._~-]{8,}/i],
  ['DEF session identity', /\bses_[A-Za-z0-9]+\b/],
  ['request/cache artifact', /(?:__pycache__|\.DS_Store|_req_[A-Za-z0-9_-]+)/i],
];
for (const [label, pattern] of forbiddenResourcePatterns) assert.doesNotMatch(resourceText, pattern, label);

const skill = fs.readFileSync(skillPath, 'utf8');
assert.match(skill, /DEF OpenCode does not register, host, proxy, or call that MCP server/);
assert.match(skill, /external Codex workflow/);
assert.doesNotMatch(skill, /\/api\/(?:buff|weapon|operator|equipment|ai-cli)/);
assert.doesNotMatch(skill, /C:\\|\/Users\//);
assert.doesNotMatch(skill, /field whitelist|SUPPORTED_OPERATOR_EFFECT_TYPES|schemaVersion\?:/);

assert.ok(packageJson.build.files.includes('src/**'), 'packaging includes reviewed versioned resources through src/**');
assert.equal(packageJson.build.files.some((entry) => /Desktop|agent填表数据工具|__pycache__|_req_/i.test(entry)), false);

const externalRoot = '/Users/sailstellar/Desktop/agent填表数据工具';
let externalAudit = { present: false };
if (fs.existsSync(externalRoot)) {
  const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const value = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(value) : [value];
  });
  const files = walk(externalRoot).sort();
  const callers = files.filter((file) => /\.(?:py|mjs|js)$/.test(file) && /(?:127\.0\.0\.1|localhost):17321|\/api\/ai-cli/.test(fs.readFileSync(file, 'utf8')));
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(path.relative(externalRoot, file));
    hash.update(fs.readFileSync(file));
  }
  assert.equal(files.length, 78, 'read-only external inventory remains 78 files');
  assert.equal(callers.length, 27, 'read-only external inventory remains 27 hard-coded REST callers');
  externalAudit = { present: true, files: files.length, hardCodedRestCallers: callers.length, treeContentHash: hash.digest('hex') };
}

process.stdout.write(`${JSON.stringify({ ok: true, resources: resourceFiles, fixtureCount, externalAudit }, null, 2)}\n`);
