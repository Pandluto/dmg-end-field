import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMobileShareUrl,
  createMobileShare,
  fetchMobileShare,
  isMobileSnapshotSharePayload,
  parseMobileShareId,
} from './mobileShare';

const SHARE_ID = 'AbCdEfGhIjKlMn01';

function mobileRecord() {
  return {
    id: SHARE_ID,
    createdAt: 1_800_000_000_000,
    expiresAt: null,
    permanent: true,
    reused: false,
    payload: {
      schemaVersion: 2,
      source: 'mobile',
      dataVersion: 'data-v2',
      imageVersion: 'image-v2',
      draft: {
        schemaVersion: 1,
        selectedOperatorIds: [],
        operatorConfigs: {},
        slots: [],
        reportNotes: {},
        activePage: 'report',
        activeOperatorId: '',
        updatedAt: 123,
      },
    },
  };
}

test('publishes an explicit domestic mobile route while retaining legacy QR parsing', () => {
  const url = buildMobileShareUrl(SHARE_ID);
  assert.equal(url, `https://dmgendfield.cloud/mobile?share=${SHARE_ID}`);
  assert.equal(parseMobileShareId(url), SHARE_ID);
  assert.equal(parseMobileShareId(`https://dmgendfield.cloud/share/${SHARE_ID}`), SHARE_ID);
  assert.equal(parseMobileShareId(`https://dmgendfield.online/mobile?share=${SHARE_ID}`), SHARE_ID);
  assert.equal(parseMobileShareId(`https://dmgendfield.online/#/share/${SHARE_ID}`), SHARE_ID);
  assert.equal(parseMobileShareId(`DEFMS1:${SHARE_ID}`), SHARE_ID);
});

test('creates shares on the domestic node so locally authored QR codes remain scannable', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = (async (input) => {
    requestedUrl = String(input);
    return Response.json({
      id: SHARE_ID,
      createdAt: 1_800_000_000_000,
      expiresAt: null,
      permanent: true,
      reused: false,
    }, { status: 201 });
  }) as typeof fetch;
  try {
    await createMobileShare(
      mobileRecord().payload.draft,
      'data-v2',
      'image-v2',
    );
    assert.equal(requestedUrl, 'https://dmgendfield.cloud/api/mobile-shares');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('keeps waiting after a fast 404 and accepts the first valid fixed-node response', async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.startsWith('https://cn.example.test')) {
      return Response.json({ code: 'SHARE_NOT_FOUND', message: '分享不存在。' }, { status: 404 });
    }
    return Response.json(mobileRecord());
  }) as typeof fetch;
  try {
    const share = await fetchMobileShare(SHARE_ID, [
      'https://cn.example.test',
      'https://global.example.test',
    ]);
    assert.equal(share.id, SHARE_ID);
    assert.equal(isMobileSnapshotSharePayload(share.payload), true);
    assert.equal(requested.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reports a missing share only after every configured node returns 404', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json(
    { code: 'SHARE_NOT_FOUND', message: '分享不存在。' },
    { status: 404 },
  )) as typeof fetch;
  try {
    await assert.rejects(
      fetchMobileShare(SHARE_ID, ['https://cn.example.test', 'https://global.example.test']),
      /国内、海外分享节点均未找到/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
