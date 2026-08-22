import assert from 'node:assert/strict';
import { fetchCurrentResourceRelease } from './resourceChannel';
import {
  getOfficialResourceTransportId,
  installOfficialResourceTransport,
  resetOfficialResourceTransportForTests,
  resolveOfficialResourcePath,
} from './resourceTransport';

const originalFetch = globalThis.fetch;
resetOfficialResourceTransportForTests();
assert.equal(getOfficialResourceTransportId(), 'web-same-origin');

const requests: string[] = [];
const restore = installOfficialResourceTransport({
  id: 'fixed-loopback-proxy',
  resolve: (path) => `/__official_resources__/${path}`,
  fallbackToBundledOnUnavailable: true,
});

globalThis.fetch = async (input) => {
  const url = String(input);
  requests.push(url);
  if (url.includes('/__official_resources__/resources/stable.json')) {
    throw new TypeError('upstream unavailable');
  }
  if (url.includes('web-data-manifest.json')) {
    return Response.json({ version: 'bundled-data' });
  }
  if (url.includes('web-image-manifest.json')) {
    return Response.json({ version: 'bundled-images' });
  }
  return new Response('Not Found', { status: 404 });
};

try {
  assert.equal(
    resolveOfficialResourcePath('resources/stable.json'),
    '/__official_resources__/resources/stable.json',
  );
  const context = await fetchCurrentResourceRelease({ fresh: true });
  assert.equal(context.legacy, true);
  assert.equal(context.source, 'bundled');
  assert.deepEqual(context.dataManifest, { version: 'bundled-data' });
  assert.deepEqual(context.imageManifest, { version: 'bundled-images' });
  assert.ok(requests.some((url) => url.includes('/__official_resources__/resources/stable.json')));
  assert.ok(requests.some((url) => url.includes('web-data-manifest.json')));
} finally {
  globalThis.fetch = originalFetch;
  restore();
  resetOfficialResourceTransportForTests();
}

assert.equal(getOfficialResourceTransportId(), 'web-same-origin');
console.log('Official resource transport and bundled fallback contract: PASS');
