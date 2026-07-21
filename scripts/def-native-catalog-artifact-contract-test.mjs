import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { materializeNativeCatalogArtifact } from '../agent/runtime/def-tools/opencode/def.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-native-catalog-artifact-'));
const context = { directory: root, sessionID: 'native-catalog-contract' };
const source = { storageKey: 'def.equipment-sheet.library.v1', revision: 'sha256:fixture', capturedAt: 1 };
const snapshot = {
  ok: true,
  contract: 'DefNativeCatalogArtifactV1',
  domain: 'equipment',
  query: '潮涌套',
  selectionMode: 'entity-full',
  source,
  files: [{ path: 'entity.full.json', records: 1, content: '{"id":"gear-set-chao-yong"}\n' }],
};

try {
  const first = materializeNativeCatalogArtifact(context, snapshot, 1_000);
  assert.match(first.root, /^retrieval\/catalog-/);
  assert.equal(first.reused, false);
  assert.equal(first.readOnly, true);
  assert.equal(fs.existsSync(path.join(root, first.manifestPath)), true);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, first.manifestPath), 'utf8'));
  assert.equal(manifest.contract, 'DefNativeCatalogArtifactV1');
  assert.equal(manifest.files[0].path, 'entity.full.json');
  assert.ok(manifest.files[0].sha256.length === 64);

  const reused = materializeNativeCatalogArtifact(context, snapshot, 1_001);
  assert.equal(reused.artifactId, first.artifactId);
  assert.equal(reused.reused, true);

  const expired = materializeNativeCatalogArtifact(context, snapshot, first.expiresAt + 1);
  assert.notEqual(expired.artifactId, first.artifactId);
  assert.equal(expired.reused, false);
  assert.equal(fs.existsSync(path.join(root, first.root)), false, 'TTL cleanup may only remove the expired bridge artifact');

  assert.throws(() => materializeNativeCatalogArtifact(context, {
    ...snapshot,
    files: [{ path: '../outside.json', records: 1, content: '{}' }],
  }), /native-catalog-artifact-invalid-file/);
  const adapterSource = fs.readFileSync(new URL('../agent/runtime/def-opencode-adapter/index.cjs', import.meta.url), 'utf8');
  assert.match(adapterSource, /'retrieval\/\*\*': 'allow'/);
  assert.match(adapterSource, /external_directory: 'deny'/);
  assert.match(adapterSource, /edit: nodeCode \? \{ '\*': 'deny', 'node\/working\/\*\*': 'allow'/);
  const toolSource = fs.readFileSync(new URL('../agent/runtime/def-tools/opencode/def.js', import.meta.url), 'utf8');
  assert.match(toolSource, /nativeAccessRoot/);
  console.log(JSON.stringify({ ok: true, checks: ['atomic-manifest', 'hash', 'reuse', 'ttl-cleanup', 'path-rejection', 'read-only-session-permission'] }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
