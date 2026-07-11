import assert from 'node:assert/strict';
import { createTimelineRepositoryClient, TimelineRepositoryRequestError } from './localTimelineClient';

const originalFetch = globalThis.fetch;
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

try {
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith('http://127.0.0.1:31457')) {
      return jsonResponse({ ok: false, error: { code: 'route-not-found', message: 'not found' } }, 404);
    }
    return jsonResponse({ ok: true, documents: [{ id: 'rest-document', label: 'REST', createdAt: 1, updatedAt: 1 }] });
  };

  const client = createTimelineRepositoryClient();
  assert.equal((await client.listDocuments())[0]?.id, 'rest-document');
  assert.deepEqual(calls, [
    'http://127.0.0.1:31457/local-data/timeline-documents',
    'http://127.0.0.1:17321/api/timeline-documents',
  ]);

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith('http://127.0.0.1:31457')) throw new TypeError('Failed to fetch');
    return jsonResponse({ ok: true, documents: [] });
  };
  assert.deepEqual(await client.listDocuments(), []);

  globalThis.fetch = async () => {
    throw new TypeError('service unavailable');
  };
  await assert.rejects(client.listDocuments(), /service unavailable/);

  globalThis.fetch = async () => jsonResponse({ ok: true, documents: [{ id: 'recovered', label: 'Recovered', createdAt: 2, updatedAt: 2 }] });
  assert.equal((await client.listDocuments())[0]?.id, 'recovered');

  let fallbackCalled = false;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith('http://127.0.0.1:17321')) fallbackCalled = true;
    return jsonResponse({ ok: false, error: { code: 'timeline-invalid-request', message: 'invalid request' } }, 409);
  };
  await assert.rejects(
    client.listDocuments(),
    (error: unknown) => error instanceof TimelineRepositoryRequestError && error.code === 'timeline-invalid-request',
  );
  assert.equal(fallbackCalled, false);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('local timeline client resilience smoke passed');
