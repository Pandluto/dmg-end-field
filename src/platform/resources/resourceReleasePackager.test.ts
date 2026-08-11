import assert from 'node:assert/strict';
import { buildResourceRelease } from './resourceReleasePackager.ts';
import { verifyResourceReleaseBundle } from './resourceReleaseVerifier.ts';

function records(prefix: string, count: number): Record<string, { id: string; name: string }> {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [
    `${prefix}-${index + 1}`,
    { id: `${prefix}-${index + 1}`, name: `${prefix} ${index + 1}` },
  ]));
}

const source = {
  type: 'def.localdata.archive.v1',
  schemaVersion: 1,
  id: 'share-packager-test',
  createdAt: '2026-08-09T03:06:12.585Z',
  exportedAt: '2026-08-09T03:06:12.585Z',
  storage: {
    local: {
      'def.operator-editor.library.v1': records('operator', 30),
      'def.weapon-sheet.library.v1': records('weapon', 75),
      'def.equipment-sheet.library.v1': { test: { id: 'test' } },
      'def.buff-editor.library.v1': { test: { id: 'test' } },
      'def.operator-editor.draft.v1': { ignored: true },
    },
    session: {},
  },
  timelineArchives: [],
};
const input = {
  shareData: source,
  shareDataFileName: 'share-test.json',
  images: [{
    relativePath: 'img-operator/test.png',
    bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  }],
};

const first = await buildResourceRelease(input);
const second = await buildResourceRelease(input);
assert.equal(first.manifest.releaseVersion, second.manifest.releaseVersion);
assert.deepEqual(first.bytes, second.bytes, 'same input must produce the same release ZIP');
const verified = await verifyResourceReleaseBundle(first.bytes);
assert.equal(verified.manifest.data.summary.operators, 30);
assert.equal(verified.manifest.data.summary.weapons, 75);
assert.equal(verified.manifest.images.files.length, 1);

const corrupted = first.bytes.slice();
corrupted[Math.floor(corrupted.byteLength / 2)] ^= 0xff;
await assert.rejects(() => verifyResourceReleaseBundle(corrupted));

console.log('Deterministic resource release builder and verifier contract: PASS');
