import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileProviderProfileSource,
  InMemoryProviderProfileSource,
  PROVIDER_PROFILE_LIMITS,
  ProviderProfileError,
  type ProviderProfile,
  toRuntimeModelConnection,
} from './profile.ts';

const API_KEY = 'profile-api-key-for-tests-7f2b';
const HEADER_SECRET = 'header-secret-for-tests-91a4';

function profile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    ref: 'default',
    providerId: 'fixture-provider',
    displayName: 'Fixture Provider',
    baseUrl: 'https://provider.example/v1/',
    modelId: 'fixture-model',
    apiKey: API_KEY,
    contextLimit: 128_000,
    outputLimit: 8_192,
    headers: { 'X-Trace-Secret': HEADER_SECRET },
    ...overrides,
  };
}

function document(profiles: readonly ProviderProfile[]): string {
  return JSON.stringify({ schemaVersion: 1, profiles });
}

function assertNoSecrets(...values: readonly unknown[]): void {
  for (const value of values) {
    const rendered = typeof value === 'string' ? value : String(value);
    assert.equal(rendered.includes(API_KEY), false, `API key leaked: ${rendered}`);
    assert.equal(rendered.includes(HEADER_SECRET), false, `header secret leaked: ${rendered}`);
  }
}

async function rejected(operation: () => Promise<unknown>, message: RegExp): Promise<void> {
  const result = await Promise.allSettled([operation()]);
  assert.equal(result[0]?.status, 'rejected');
  if (result[0]?.status !== 'rejected') return;
  assert.equal(result[0].reason instanceof ProviderProfileError, true);
  assert.match(result[0].reason.message, message);
  assertNoSecrets(result[0].reason.message, JSON.stringify(result[0].reason), inspect(result[0].reason));
}

function rejectedInMemory(input: ProviderProfile, message: RegExp): void {
  assert.throws(
    () => new InMemoryProviderProfileSource([input]),
    (error: unknown) => {
      assert.equal(error instanceof ProviderProfileError, true);
      if (!(error instanceof ProviderProfileError)) return false;
      assert.match(error.message, message);
      assertNoSecrets(error.message, JSON.stringify(error), inspect(error));
      return true;
    },
  );
}

async function testInMemoryAndRedaction(): Promise<void> {
  const source = new InMemoryProviderProfileSource([profile()]);
  const normalized = await source.getProfile('default');
  assert.ok(normalized);
  assert.equal(normalized.ref, 'default');
  assert.equal(normalized.baseUrl, 'https://provider.example/v1');
  assert.equal(normalized.apiKey, API_KEY);
  assert.equal(normalized.headers?.['X-Trace-Secret'], HEADER_SECRET);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.headers), true);
  assert.equal(await source.getProfile('missing'), null);

  const connection = toRuntimeModelConnection(normalized);
  assert.equal(connection.providerId, 'fixture-provider');
  assert.equal(connection.modelId, 'fixture-model');
  assert.equal(connection.baseUrl, 'https://provider.example/v1');
  assert.equal(connection.apiKey, API_KEY);
  assert.equal(connection.headers?.['X-Trace-Secret'], HEADER_SECRET);
  assert.equal('ref' in connection, false);
  assert.equal('displayName' in connection, false);
  assert.equal(Object.isFrozen(connection), true);

  const profileJson = JSON.stringify(normalized);
  const profileInspect = inspect(normalized);
  const headerJson = JSON.stringify(normalized.headers);
  const headerInspect = inspect(normalized.headers);
  const connectionJson = JSON.stringify(connection);
  const connectionInspect = inspect(connection);
  assertNoSecrets(profileJson, profileInspect, headerJson, headerInspect, connectionJson, connectionInspect);
  assert.match(profileJson, /\[redacted\]/u);
  assert.match(connectionJson, /\[redacted\]/u);
  assert.equal(JSON.parse(connectionJson).apiKey, '[redacted]');

  rejectedInMemory({ ...profile(), apiKey: 'k'.repeat(PROVIDER_PROFILE_LIMITS.maxApiKeyCodeUnits + 1) }, /too long/u);
  rejectedInMemory({ ...profile(), displayName: 'd'.repeat(PROVIDER_PROFILE_LIMITS.maxTextCodeUnits + 1) }, /too long/u);
  rejectedInMemory({ ...profile(), modelId: 'm'.repeat(PROVIDER_PROFILE_LIMITS.maxTextCodeUnits + 1) }, /too long/u);
  rejectedInMemory({ ...profile(), providerId: 'p'.repeat(PROVIDER_PROFILE_LIMITS.maxIdentifierCodeUnits + 1) }, /too long|portable/u);
  rejectedInMemory({ ...profile(), apiKey: 'key\nwith-control' }, /control/u);

  assert.throws(
    () => new InMemoryProviderProfileSource([profile(), { ...profile(), ref: 'default' }]),
    /refs must be unique/u,
  );
  assert.throws(
    () => new InMemoryProviderProfileSource([profile(), { ...profile(), ref: ' default ' }]),
    /refs must be unique/u,
  );
}

async function testSchemaAndUrlBoundaries(): Promise<void> {
  const acceptedHttps = new InMemoryProviderProfileSource([profile({ baseUrl: 'https://provider.example/v1/' })]);
  assert.equal((await acceptedHttps.getProfile('default'))?.baseUrl, 'https://provider.example/v1');
  const acceptedIpv4 = new InMemoryProviderProfileSource([profile({ baseUrl: 'http://127.0.0.1:39000/v1' })]);
  assert.equal((await acceptedIpv4.getProfile('default'))?.baseUrl, 'http://127.0.0.1:39000/v1');
  const acceptedIpv6 = new InMemoryProviderProfileSource([profile({ baseUrl: 'http://[::1]:39000/v1' })]);
  assert.equal((await acceptedIpv6.getProfile('default'))?.baseUrl, 'http://[::1]:39000/v1');

  const invalidUrls: readonly [string, RegExp][] = [
    ['http://provider.example/v1', /HTTPS|loopback/u],
    ['http://localhost/v1', /HTTPS|loopback/u],
    ['http://127.0.0.01/v1', /HTTPS|loopback/u],
    ['http://0x7f000001/v1', /HTTPS|loopback/u],
    ['http://[0:0:0:0:0:0:0:1]/v1', /HTTPS|loopback/u],
    ['https://user:password@provider.example/v1', /user or password/u],
    ['https://provider.example/v1?token=query-secret', /query or fragment/u],
    ['https://provider.example/v1#fragment', /query or fragment/u],
    ['https://provider.example/v1/../other', /dot segments/u],
    ['https://provider.example/v1//other', /ambiguous separator/u],
    ['https://provider.example/v1%2Fother', /encoded separator/u],
    ['file:///tmp/provider-profile', /HTTPS|loopback/u],
    ['javascript:alert(1)', /HTTPS|loopback/u],
  ];
  for (const [baseUrl, message] of invalidUrls) rejectedInMemory(profile({ baseUrl }), message);

  rejectedInMemory({ ...profile(), extra: true } as ProviderProfile, /not supported|unsupported field/u);
  rejectedInMemory({ ...profile(), baseUrl: 'https://provider.example/v1?key=\u0061pi-key' }, /query or fragment/u);

  const rootWithExtra = { schemaVersion: 1, profiles: [profile()], extra: true };
  const source = new InMemoryProviderProfileSource([profile()]);
  assert.equal(await source.getProfile('default') !== null, true);
  await assertDocumentRejected(rootWithExtra, /fields are invalid/u);
  await assertDocumentRejected({ schemaVersion: 2, profiles: [profile()] }, /schema must be 1/u);
  await assertDocumentRejected({ schemaVersion: 1, profiles: [{ ...profile(), unsupported: true }] }, /not supported|unsupported field/u);
}

function testUnknownFieldErrorsNeverEchoSecrets(): void {
  for (const secretFieldName of [API_KEY, HEADER_SECRET]) {
    rejectedInMemory({
      ...profile(),
      [secretFieldName]: 'attacker-controlled value',
    } as ProviderProfile, /unsupported field/u);
  }
}

async function assertDocumentRejected(value: unknown, message: RegExp): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'def-runtime-profile-schema-'));
  try {
    const path = join(root, 'profiles.json');
    await writeFile(path, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
    if (process.platform !== 'win32') await chmod(path, 0o600);
    await rejected(() => new FileProviderProfileSource(path).getProfile('default'), message);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testHeaders(): Promise<void> {
  const valid = new InMemoryProviderProfileSource([profile({ headers: { 'X-Trace-Secret': HEADER_SECRET, Accept: 'application/json' } })]);
  assert.equal((await valid.getProfile('default'))?.headers?.Accept, 'application/json');

  const toJsonHeader = new InMemoryProviderProfileSource([profile({
    headers: { toJSON: HEADER_SECRET, 'X-Trace': 'runtime-value' },
  })]);
  const loadedToJsonHeader = await toJsonHeader.getProfile('default');
  assert.equal(loadedToJsonHeader?.headers?.toJSON, HEADER_SECRET);
  const connection = toRuntimeModelConnection(loadedToJsonHeader!);
  assert.equal(connection.headers?.toJSON, HEADER_SECRET);
  assertNoSecrets(JSON.stringify(loadedToJsonHeader), inspect(loadedToJsonHeader), JSON.stringify(connection), inspect(connection));

  for (const name of [
    'Authorization',
    'Cookie',
    'Host',
    'Proxy-Authorization',
    'Proxy-Authenticate',
    'Connection',
    'Keep-Alive',
    'TE',
    'Trailer',
    'Transfer-Encoding',
    'Upgrade',
    'Content-Length',
    'Content-Type',
    'X-Forwarded-For',
  ]) {
    rejectedInMemory(profile({ headers: { [name]: HEADER_SECRET } }), /invalid|unsafe/u);
  }
  rejectedInMemory(profile({ headers: { 'X-Trace': 'one', 'x-trace': 'two' } }), /duplicate/u);
  rejectedInMemory(profile({ headers: { 'Bad Header': 'value' } }), /invalid|unsafe/u);
  rejectedInMemory(profile({ headers: { 'X-Trace': 'line\r\nInjected: true' } }), /invalid|unsafe/u);
  rejectedInMemory(profile({ headers: { 'X-Trace': 'x'.repeat(PROVIDER_PROFILE_LIMITS.maxHeaderValueBytes + 1) } }), /invalid|unsafe/u);

  const tooMany: Record<string, string> = {};
  for (let index = 0; index < PROVIDER_PROFILE_LIMITS.maxHeaderCount + 1; index += 1) {
    tooMany[`X-Header-${index}`] = 'value';
  }
  rejectedInMemory(profile({ headers: tooMany }), /too many/u);

  const tooLarge: Record<string, string> = {};
  for (let index = 0; index < 4; index += 1) tooLarge[`X-Header-${index}`] = 'x'.repeat(4_095);
  rejectedInMemory(profile({ headers: tooLarge }), /byte size/u);
}

async function testFileSecurity(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'def-runtime-profile-file-'));
  try {
    const missingPath = join(root, 'missing.json');
    assert.equal(await new FileProviderProfileSource(missingPath).getProfile('default'), null);

    const profilePath = join(root, 'profiles.json');
    await writeFile(profilePath, document([profile()]), { encoding: 'utf8', mode: 0o600 });
    if (process.platform !== 'win32') {
      await chmod(profilePath, 0o600);
      const info = await lstat(profilePath);
      assert.equal(info.isFile(), true);
      assert.equal(info.isSymbolicLink(), false);
      assert.equal(info.uid, process.getuid?.());
      assert.equal(info.mode & 0o777, 0o600);
    }

    const source = new FileProviderProfileSource(profilePath);
    const loaded = await source.getProfile('default');
    assert.ok(loaded);
    assert.equal(loaded.apiKey, API_KEY);
    assert.equal(await source.getProfile('missing'), null);

    if (process.platform !== 'win32') {
      await chmod(profilePath, 0o640);
      await rejected(() => source.getProfile('default'), /mode 0600/u);
      await chmod(profilePath, 0o400);
      await rejected(() => source.getProfile('default'), /mode 0600/u);
      await chmod(profilePath, 0o600);
    }

    const directoryPath = join(root, 'profile-directory');
    await mkdir(directoryPath);
    await rejected(() => new FileProviderProfileSource(directoryPath).getProfile('default'), /regular file/u);

    if (process.platform !== 'win32') {
      const symlinkPath = join(root, 'profile-link.json');
      await symlink(profilePath, symlinkPath);
      await rejected(() => new FileProviderProfileSource(symlinkPath).getProfile('default'), /symlink/u);
    }

    const oversizedPath = join(root, 'oversized.json');
    await writeFile(oversizedPath, 'x'.repeat(PROVIDER_PROFILE_LIMITS.maxFileBytes + 1), { encoding: 'utf8', mode: 0o600 });
    if (process.platform !== 'win32') await chmod(oversizedPath, 0o600);
    await rejected(() => new FileProviderProfileSource(oversizedPath).getProfile('default'), /bounded size/u);

    await writeFile(profilePath, 'not-json', { encoding: 'utf8', mode: 0o600 });
    if (process.platform !== 'win32') await chmod(profilePath, 0o600);
    await rejected(() => source.getProfile('default'), /valid JSON/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await testInMemoryAndRedaction();
await testSchemaAndUrlBoundaries();
testUnknownFieldErrorsNeverEchoSecrets();
await testHeaders();
await testFileSecurity();
console.log('[def-runtime/profile.test] passed');
