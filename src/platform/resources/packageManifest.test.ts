import assert from 'node:assert/strict';
import {
  fetchResourcePackageManifest,
  type ResourcePackageManifest,
} from './resourcePackage';
import {
  fetchImagePackageManifest,
  type ImagePackageManifest,
} from './imagePackage';

const resourceManifest: ResourcePackageManifest = {
  schemaVersion: 1,
  packageId: 'dmg-end-field-core-data',
  version: 'v1.8-LTS-slim',
  generatedAt: '2026-08-02T00:00:00.000Z',
  files: [{ path: 'data/default-local-data.json', sha256: 'abc', size: 3 }],
  totalBytes: 3,
};

const imageManifest: ImagePackageManifest = {
  schemaVersion: 1,
  packageId: 'dmg-end-field-image-pack',
  version: '1.7.3',
  generatedAt: '2026-08-02T00:00:00.000Z',
  releaseTag: 'v1.7.3',
  files: [{ path: 'assets/images/example.png', sha256: 'def', size: 4 }],
  totalBytes: 4,
  archive: {
    path: 'packages/images.zip',
    fileName: 'images.zip',
    sha256: 'ghi',
    size: 4,
    sourceUrl: 'https://example.invalid/images.zip',
    parts: [{
      path: 'packages/images.zip.part-001',
      fileName: 'images.zip.part-001',
      sha256: 'jkl',
      size: 4,
    }],
  },
};

const originalFetch = globalThis.fetch;

try {
  const resourceCalls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    resourceCalls.push(String(input));
    return new Response(JSON.stringify(resourceManifest), { status: 200 });
  }) as typeof fetch;
  assert.deepEqual(await fetchResourcePackageManifest(), resourceManifest);
  assert.equal(resourceCalls.length, 1);
  assert.match(resourceCalls[0], /web-data-manifest\.json\?install=\d+$/);

  let fallbackCall = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    fallbackCall += 1;
    if (fallbackCall === 1) throw new Error('offline');
    assert.match(String(input), /web-data-manifest\.json$/);
    return new Response(JSON.stringify(resourceManifest), { status: 200 });
  }) as typeof fetch;
  assert.deepEqual(await fetchResourcePackageManifest(), resourceManifest);
  assert.equal(fallbackCall, 2);

  globalThis.fetch = (async () => new Response(JSON.stringify({
    ...resourceManifest,
    packageId: 'wrong-package',
  }), { status: 200 })) as typeof fetch;
  await assert.rejects(fetchResourcePackageManifest, /资源清单格式无效/);

  globalThis.fetch = (async () => new Response(JSON.stringify(imageManifest), {
    status: 200,
  })) as typeof fetch;
  assert.deepEqual(await fetchImagePackageManifest(), imageManifest);

  globalThis.fetch = (async () => new Response(JSON.stringify({
    ...imageManifest,
    archive: { ...imageManifest.archive, parts: [] },
  }), { status: 200 })) as typeof fetch;
  await assert.rejects(fetchImagePackageManifest, /图片包清单格式无效/);

  globalThis.fetch = (async () => new Response('missing', { status: 404 })) as typeof fetch;
  await assert.rejects(fetchImagePackageManifest, /HTTP 404/);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Web data and image package manifest contracts: PASS');
