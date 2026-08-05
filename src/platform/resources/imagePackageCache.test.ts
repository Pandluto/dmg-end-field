import assert from 'node:assert/strict';
import {
  verifyInstalledImagePackageCache,
  type InstalledImagePackage,
} from './imagePackage';

const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

const files = [
  { path: 'assets/images/operator-a.png', sha256: 'a', size: 11 },
  { path: 'assets/images/weapon-b.png', sha256: 'b', size: 17 },
];
const installed: InstalledImagePackage = {
  packageId: 'dmg-end-field-image-pack',
  version: 'test-image-v1',
  installedAt: 1,
  verifiedAt: 1,
  byteSize: 28,
  manifest: {
    schemaVersion: 1,
    packageId: 'dmg-end-field-image-pack',
    version: 'test-image-v1',
    generatedAt: '2026-08-06T00:00:00.000Z',
    releaseTag: 'test',
    files,
    totalBytes: 28,
    archive: {
      path: 'image-pack.zip',
      fileName: 'image-pack.zip',
      sha256: 'archive',
      size: 28,
      sourceUrl: 'https://images.test/image-pack.zip',
    },
  },
};

const entries = new Map<string, Response>();
for (const entry of files) {
  entries.set(
    new URL(entry.path, 'https://images.test/').href,
    new Response('x'.repeat(entry.size), {
      headers: {
        'Content-Length': String(entry.size),
        'X-Dmg-Image-Package': installed.version,
      },
    }),
  );
}

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { location: { href: 'https://images.test/' } },
});
Object.defineProperty(globalThis, 'caches', {
  configurable: true,
  value: {
    async open() {
      return {
        async keys() {
          return [...entries.keys()].map((url) => new Request(url));
        },
        async match(request: Request) {
          return entries.get(request.url);
        },
      };
    },
  },
});

try {
  assert.equal(
    await verifyInstalledImagePackageCache(installed),
    true,
    'every manifest image with the installed package header is usable',
  );

  const removedUrl = new URL(files[1].path, 'https://images.test/').href;
  const removed = entries.get(removedUrl);
  entries.delete(removedUrl);
  assert.equal(
    await verifyInstalledImagePackageCache(installed),
    false,
    'SQLite metadata must not hide a missing image cache entry',
  );

  entries.set(removedUrl, new Response('x'.repeat(files[1].size), {
    headers: {
      'Content-Length': String(files[1].size),
      'X-Dmg-Image-Package': 'stale-image-v0',
    },
  }));
  assert.equal(
    await verifyInstalledImagePackageCache(installed),
    false,
    'a stale image package must be reinstalled instead of shown as complete',
  );

  if (removed) entries.set(removedUrl, removed);
} finally {
  if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches);
  else delete (globalThis as { caches?: CacheStorage }).caches;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete (globalThis as { window?: Window }).window;
}

console.log('Installed image cache integrity contract: PASS');
