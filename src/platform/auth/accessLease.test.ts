import assert from 'node:assert/strict';
import {
  clearAccessLease,
  grantAccessLease,
  readAccessLeaseStatus,
} from './accessLease';

const ACCESS_LEASE_KEY = 'dmg.web.access-lease.v1';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const originalWindow = globalThis.window;
const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { localStorage: storage },
});

try {
  const now = 1_800_000_000_000;
  assert.deepEqual(await grantAccessLease('wrong-password', now), {
    granted: false,
    issuedAt: null,
    expiresAt: null,
  });
  assert.equal(storage.getItem(ACCESS_LEASE_KEY), null);

  const granted = await grantAccessLease('zmd', now);
  assert.deepEqual(granted, {
    granted: true,
    issuedAt: now,
    expiresAt: now + THIRTY_DAYS_MS,
  });
  assert.deepEqual(await readAccessLeaseStatus(now + 1), granted);

  const tampered = JSON.parse(storage.getItem(ACCESS_LEASE_KEY) || '{}') as Record<string, unknown>;
  storage.setItem(ACCESS_LEASE_KEY, JSON.stringify({ ...tampered, proof: 'tampered' }));
  assert.deepEqual(await readAccessLeaseStatus(now + 2), {
    granted: false,
    issuedAt: null,
    expiresAt: null,
  });
  assert.equal(storage.getItem(ACCESS_LEASE_KEY), null);

  await grantAccessLease('zmd', now);
  assert.deepEqual(await readAccessLeaseStatus(now + THIRTY_DAYS_MS), {
    granted: false,
    issuedAt: null,
    expiresAt: null,
  });

  storage.setItem(ACCESS_LEASE_KEY, '{invalid-json');
  assert.deepEqual(await readAccessLeaseStatus(now), {
    granted: false,
    issuedAt: null,
    expiresAt: null,
  });
  clearAccessLease();
  assert.equal(storage.getItem(ACCESS_LEASE_KEY), null);

  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: undefined,
  });
  assert.deepEqual(await grantAccessLease('wrong-password', now), {
    granted: false,
    issuedAt: null,
    expiresAt: null,
  });
  const httpGranted = await grantAccessLease('zmd', now);
  assert.equal(httpGranted.granted, true);
  assert.deepEqual(await readAccessLeaseStatus(now + 1), httpGranted);
} finally {
  if (originalCryptoDescriptor) {
    Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
  } else {
    delete (globalThis as { crypto?: Crypto }).crypto;
  }
  if (originalWindow === undefined) {
    delete (globalThis as { window?: Window }).window;
  } else {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  }
}

console.log('Web access lease contract: PASS');
