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
  summary: { operators: 31, weapons: 76, images: 559 },
  files: [{ path: 'data/default-local-data.json', sha256: 'a'.repeat(64), size: 3 }],
  totalBytes: 3,
};

const imageManifest: ImagePackageManifest = {
  schemaVersion: 1,
  packageId: 'dmg-end-field-image-pack',
  version: '1.8.3',
  generatedAt: '2026-08-02T00:00:00.000Z',
  releaseTag: 'v1.8.3',
  files: [{ path: 'assets/images/example.png', sha256: 'b'.repeat(64), size: 4 }],
  totalBytes: 4,
  archive: {
    path: 'packages/images.zip',
    fileName: 'images.zip',
    sha256: 'c'.repeat(64),
    size: 4,
    parts: [{
      path: 'packages/images.zip.part-001',
      fileName: 'images.zip.part-001',
      sha256: 'd'.repeat(64),
      size: 4,
    }],
  },
};

const originalFetch = globalThis.fetch;

function legacyFetch(
  data: unknown = resourceManifest,
  images: unknown = imageManifest,
  calls: string[] = [],
): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('resources/stable.json')) return new Response('missing', { status: 404 });
    if (url.includes('web-data-manifest.json')) {
      return new Response(JSON.stringify(data), { status: 200 });
    }
    if (url.includes('web-image-manifest.json')) {
      return new Response(JSON.stringify(images), { status: 200 });
    }
    return new Response('missing', { status: 404 });
  }) as typeof fetch;
}

try {
  const resourceCalls: string[] = [];
  globalThis.fetch = legacyFetch(resourceManifest, imageManifest, resourceCalls);
  assert.deepEqual(await fetchResourcePackageManifest({ fresh: true }), resourceManifest);
  assert.ok(resourceCalls.some((url) => /resources\/stable\.json\?channel=/.test(url)));
  assert.ok(resourceCalls.some((url) => /web-data-manifest\.json$/.test(url)));

  let stableCalls = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('resources/stable.json')) {
      stableCalls += 1;
      throw new Error('offline');
    }
    if (url.includes('web-data-manifest.json')) {
      return new Response(JSON.stringify(resourceManifest), { status: 200 });
    }
    if (url.includes('web-image-manifest.json')) {
      return new Response(JSON.stringify(imageManifest), { status: 200 });
    }
    return new Response('missing', { status: 404 });
  }) as typeof fetch;
  await assert.rejects(
    () => fetchResourcePackageManifest({ fresh: true }),
    /服务器资源通道网络请求失败/,
  );
  assert.equal(stableCalls, 1);

  globalThis.fetch = legacyFetch({ ...resourceManifest, packageId: 'wrong-package' });
  await assert.rejects(
    () => fetchResourcePackageManifest({ fresh: true }),
    /资源清单格式无效/,
  );

  globalThis.fetch = legacyFetch();
  assert.deepEqual(await fetchImagePackageManifest({ fresh: true }), imageManifest);

  globalThis.fetch = legacyFetch(resourceManifest, {
    ...imageManifest,
    archive: { ...imageManifest.archive, parts: [] },
  });
  await assert.rejects(
    () => fetchImagePackageManifest({ fresh: true }),
    /图片包清单格式无效/,
  );

  globalThis.fetch = (async () => new Response('missing', { status: 404 })) as typeof fetch;
  await assert.rejects(
    () => fetchImagePackageManifest({ fresh: true }),
    /本地数据清单加载失败：HTTP 404/,
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Server resource channel and legacy manifest contracts: PASS');
