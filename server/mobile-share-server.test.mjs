import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MOBILE_SHARE_TTL_MS,
  MobileShareServiceError,
  createMobileShareStore,
} from './mobile-share-server.mjs';

function createPayload(label = '测试') {
  return {
    schemaVersion: 1,
    dataVersion: 'v1.8.4',
    imageVersion: 'v1.8.3',
    draft: {
      schemaVersion: 1,
      selectedOperatorIds: ['operator-1'],
      operatorConfigs: {},
      slots: [{ id: 'slot-1', action: null }],
      reportNotes: { 'slot-1::lane-0': label },
      activePage: 'report',
      activeOperatorId: 'operator-1',
      updatedAt: 1,
    },
  };
}

test('keeps only the latest three active shares per IP and expires them after 24 hours', () => {
  let timestamp = 1_800_000_000_000;
  const store = createMobileShareStore({
    dbPath: ':memory:',
    now: () => timestamp,
  });
  try {
    const shares = [];
    for (let index = 0; index < 4; index += 1) {
      shares.push(store.create(createPayload(`批注 ${index + 1}`), '203.0.113.8'));
      timestamp += 1;
    }
    assert.equal(store.get(shares[0].id), null);
    assert.equal(store.get(shares[1].id)?.payload.draft.reportNotes['slot-1::lane-0'], '批注 2');
    assert.equal(store.stats().active, 3);
    assert.equal(store.stats().createdLastHour, 4);

    timestamp += MOBILE_SHARE_TTL_MS + 1;
    assert.equal(store.get(shares[3].id), null);
    assert.equal(store.stats().active, 0);
  } finally {
    store.close();
  }
});

test('enforces the global hourly creation limit without deleting valid shares', () => {
  const store = createMobileShareStore({
    dbPath: ':memory:',
    now: () => 1_800_000_000_000,
    hourlyLimit: 2,
  });
  try {
    const first = store.create(createPayload('第一份'), '203.0.113.1');
    const second = store.create(createPayload('第二份'), '203.0.113.2');
    assert.throws(
      () => store.create(createPayload('第三份'), '203.0.113.3'),
      (error) => error instanceof MobileShareServiceError
        && error.status === 429
        && error.code === 'HOURLY_LIMIT',
    );
    assert.ok(store.get(first.id));
    assert.ok(store.get(second.id));
    assert.equal(store.stats().active, 2);
  } finally {
    store.close();
  }
});
