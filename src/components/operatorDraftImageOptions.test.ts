import assert from 'node:assert/strict';
import { buildOperatorDraftImagePathOptions } from './operatorDraftImageOptions';
import type { ImageAssetEntry } from './ImageManager/types';

function asset(overrides: Partial<ImageAssetEntry>): ImageAssetEntry {
  return {
    kind: 'file',
    fileName: 'image.png',
    baseName: 'image',
    ext: '.png',
    relativePath: 'assets/images/image.png',
    source: 'builtin',
    writable: false,
    sizeBytes: 1,
    updatedAt: 0,
    ...overrides,
  };
}

const options = buildOperatorDraftImagePathOptions([
  asset({
    relativePath: 'assets/images/图标10.png',
    source: 'release',
    publicUrl: 'blob:https://example.test/release',
    canonicalPath: 'user-images/图标10.png',
  }),
  asset({
    relativePath: 'assets/images/图标2.png',
    source: 'user',
    publicUrl: 'blob:https://example.test/user',
  }),
  asset({
    relativePath: 'assets/images/图标2.png',
    source: 'builtin',
    publicUrl: 'blob:https://example.test/duplicate',
  }),
  asset({ kind: 'dir', relativePath: 'assets/images/目录/' }),
  asset({ relativePath: '' }),
]);

assert.deepEqual(options, [
  'assets/images/图标2.png',
  'assets/images/图标10.png',
]);
assert.equal(options.some((path) => path.startsWith('user-images/')), false);
assert.equal(options.some((path) => path.startsWith('blob:')), false);

console.log('Operator image path option canonicalization contract: PASS');
