import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const resourceRoot = path.join(root, 'src', 'legacyFillService', 'resources');
const runtimePath = path.join(root, 'dist', 'legacy-fill', 'domain-runtime.mjs');
const bundledResourceRoot = path.join(root, 'dist', 'legacy-fill', 'resources');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const runtime = await import(runtimePath);
const readResource = (fileName) => JSON.parse(fs.readFileSync(path.join(resourceRoot, fileName), 'utf8'));
const strategies = ['strategy-v1.json', 'strategy-v2.json'].map(readResource);
const goldenSets = ['golden-v1.json', 'golden-v2.json'].map(readResource);

for (const [index, strategy] of strategies.entries()) {
  assert.equal(strategy.version, `v${index + 1}`);
  assert.equal(strategy.kind, 'strategy-not-protocol');
  assert.equal(strategy.separation.strategyIsProtocol, false);
}
assert.match(strategies[1].rules.join('\n'), /庄方宜|Zhuang Fangyi/u);
assert.match(strategies[1].rules.join('\n'), /multiplier\.coefficient=1\.15/u);
assert.match(strategies[1].rules.join('\n'), /sourceSkill/u);
assert.match(strategies[1].rules.join('\n'), /corrosion/u);

let fixtureCount = 0;
for (const [index, golden] of goldenSets.entries()) {
  assert.equal(golden.version, `v${index + 1}`);
  assert.equal(golden.kind, 'validated-curated-fixtures');
  for (const [domain, group] of Object.entries(golden.domains)) {
    assert.equal(group.schemaVersion, 1, `${golden.version}/${domain} fixtures bind schema version 1`);
    assert.ok(Array.isArray(group.fixtures) && group.fixtures.length > 0, `${golden.version}/${domain} has fixtures`);
    for (const fixture of group.fixtures) {
      const validation = runtime.validateLegacyFillDraft(domain, fixture.draft);
      assert.equal(validation.valid, true, `${golden.version}/${domain}/${fixture.id}: ${(validation.errors || []).join('; ')}`);
      fixtureCount += 1;
    }
  }
}
assert.deepEqual(Object.keys(goldenSets[1].domains).sort(), ['buff', 'equipment', 'operator', 'weapon']);

const resourceFiles = fs.readdirSync(resourceRoot).filter((name) => name.endsWith('.json')).sort();
assert.deepEqual(resourceFiles, ['golden-v1.json', 'golden-v2.json', 'strategy-v1.json', 'strategy-v2.json']);
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

for (const fileName of resourceFiles) {
  assert.equal(
    fs.readFileSync(path.join(bundledResourceRoot, fileName), 'utf8'),
    fs.readFileSync(path.join(resourceRoot, fileName), 'utf8'),
    `${fileName} is copied unchanged into the bundled desktop runtime`,
  );
}

assert.ok(packageJson.build.files.includes('dist/**'), 'packaging includes the bundled MCP runtime and resources');
assert.equal(packageJson.build.files.includes('src/**'), false, 'the desktop package does not ship application source');
assert.equal(packageJson.build.files.some((entry) => /agent填表数据工具|__pycache__|_req_/i.test(entry)), false);

process.stdout.write(`${JSON.stringify({ ok: true, resources: resourceFiles, fixtureCount, bundled: true }, null, 2)}\n`);
