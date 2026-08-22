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
  generatedAt: '2026-08-11T16:05:06.789Z',
  images: [{
    relativePath: 'img-operator/test.png',
    bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  }],
};

const first = await buildResourceRelease(input);
const second = await buildResourceRelease(input);
assert.equal(first.manifest.releaseVersion, second.manifest.releaseVersion);
assert.deepEqual(first.bytes, second.bytes, 'same input must produce the same release ZIP');
assert.match(first.manifest.releaseVersion, /^20260812\.000506\.[a-f0-9]{12}$/);
assert.match(first.manifest.data.version, /^20260812\.000506\.[a-f0-9]{8}$/);
assert.match(first.manifest.images.version, /^20260812\.000506\.[a-f0-9]{12}$/);
assert.equal(first.manifest.generatedAt, input.generatedAt);
assert.equal(first.manifest.source.exportedAt, source.exportedAt);

const later = await buildResourceRelease({
  ...input,
  generatedAt: '2026-08-12T06:07:08.789Z',
});
assert.match(later.manifest.releaseVersion, /^20260812\.140708\.[a-f0-9]{12}$/);
assert.notEqual(later.manifest.releaseVersion, first.manifest.releaseVersion);
assert.equal(later.manifest.rootSha256, first.manifest.rootSha256);
const verified = await verifyResourceReleaseBundle(first.bytes);
assert.equal(verified.manifest.data.summary.operators, 30);
assert.equal(verified.manifest.data.summary.weapons, 75);
assert.equal(verified.manifest.images.files.length, 1);

const corrupted = first.bytes.slice();
corrupted[Math.floor(corrupted.byteLength / 2)] ^= 0xff;
await assert.rejects(() => verifyResourceReleaseBundle(corrupted));

console.log('Timestamped resource release builder and verifier contract: PASS');
