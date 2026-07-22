import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDefGuideSourceStore } from './def-core/guide-source-store.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-guide-source-'));
const filePath = path.join(root, 'guide-sources.json');
let clock = 1_000_000;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const options = { filePath, ttlMs: 4 * 60 * 60 * 1000, maxEntries: 2, maxContentChars: 12000, hash, now: () => clock };

try {
  const firstMap = new Map();
  const firstStore = createDefGuideSourceStore(options);
  const remembered = firstStore.remember(firstMap, {
    sessionId: 'session-one', referenceId: 'guide.md', sectionId: 'section-1', content: 'exact guide text',
  });
  assert.equal(remembered.expiresAt, clock + options.ttlMs);
  assert.equal(fs.existsSync(filePath), true);

  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  persisted.sources[0].sourceContentHash = 'attacker-controlled-hash';
  fs.writeFileSync(filePath, JSON.stringify(persisted), 'utf8');

  const restartedMap = new Map();
  const restartedStore = createDefGuideSourceStore(options);
  restartedStore.hydrate(restartedMap);
  assert.equal(restartedMap.get('session-one')?.content, 'exact guide text');
  assert.equal(restartedMap.get('session-one')?.sourceContentHash, hash('exact guide text'));

  clock += options.ttlMs + 1;
  restartedStore.prune(restartedMap);
  assert.equal(restartedMap.size, 0, 'expired guide source must be removed');
  assert.equal(JSON.parse(fs.readFileSync(filePath, 'utf8')).sources.length, 0);

  console.log('DEF guide source store contract tests passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
