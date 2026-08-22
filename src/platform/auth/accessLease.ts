const ACCESS_LEASE_KEY = 'dmg.web.access-lease.v1';
const ACCESS_LEASE_VERSION = 1;
const ACCESS_LEASE_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const ACCESS_PASSWORD = 'zmd';
const ACCESS_PASSWORD_SHA256 = '70bf6599462aab4b1415d79b1bcbf9565734b6f22d3a087dd2589506c7db5c50';
const ACCESS_PROOF_NAMESPACE = 'dmg-end-field:web-lts-1.8';

type StoredAccessLease = {
  version: number;
  issuedAt: number;
  expiresAt: number;
  proof: string;
};

export type AccessLeaseStatus = {
  granted: boolean;
  issuedAt: number | null;
  expiresAt: number | null;
};

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256(value: string): Promise<string> {
  return bytesToHex(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

function supportsWebCrypto(): boolean {
  return typeof globalThis.crypto?.subtle?.digest === 'function';
}

async function buildLeaseProof(issuedAt: number, expiresAt: number): Promise<string> {
  const payload = `${ACCESS_PROOF_NAMESPACE}:${issuedAt}:${expiresAt}:${ACCESS_PASSWORD_SHA256}`;
  return supportsWebCrypto() ? sha256(payload) : `http:${payload}`;
}

async function matchesAccessPassword(password: string): Promise<boolean> {
  if (!supportsWebCrypto()) return password === ACCESS_PASSWORD;
  return (await sha256(password)) === ACCESS_PASSWORD_SHA256;
}

function readStoredLease(): StoredAccessLease | null {
  try {
    const raw = window.localStorage.getItem(ACCESS_LEASE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAccessLease>;
    if (
      parsed.version !== ACCESS_LEASE_VERSION
      || typeof parsed.issuedAt !== 'number'
      || typeof parsed.expiresAt !== 'number'
      || typeof parsed.proof !== 'string'
    ) {
      return null;
    }
    return parsed as StoredAccessLease;
  } catch {
    return null;
  }
}

export async function readAccessLeaseStatus(now = Date.now()): Promise<AccessLeaseStatus> {
  if (typeof window === 'undefined') {
    return { granted: false, issuedAt: null, expiresAt: null };
  }
  const lease = readStoredLease();
  if (!lease || lease.expiresAt <= now || lease.issuedAt > now) {
    clearAccessLease();
    return { granted: false, issuedAt: null, expiresAt: null };
  }
  const expectedProof = await buildLeaseProof(lease.issuedAt, lease.expiresAt);
  if (expectedProof !== lease.proof) {
    clearAccessLease();
    return { granted: false, issuedAt: null, expiresAt: null };
  }
  return {
    granted: true,
    issuedAt: lease.issuedAt,
    expiresAt: lease.expiresAt,
  };
}

export async function grantAccessLease(password: string, now = Date.now()): Promise<AccessLeaseStatus> {
  if (!(await matchesAccessPassword(password))) {
    return { granted: false, issuedAt: null, expiresAt: null };
  }
  const issuedAt = now;
  const expiresAt = now + ACCESS_LEASE_DURATION_MS;
  const lease: StoredAccessLease = {
    version: ACCESS_LEASE_VERSION,
    issuedAt,
    expiresAt,
    proof: await buildLeaseProof(issuedAt, expiresAt),
  };
  window.localStorage.setItem(ACCESS_LEASE_KEY, JSON.stringify(lease));
  return { granted: true, issuedAt, expiresAt };
}

export function clearAccessLease(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(ACCESS_LEASE_KEY);
  } catch {
    // The access page will remain locked when browser storage is unavailable.
  }
}
