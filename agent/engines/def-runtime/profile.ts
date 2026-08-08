import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import type { RuntimeModelConnection } from '../../runtime/kernel/provider/model-driver.ts';

/** The on-disk provider profile format is deliberately independent of any engine. */
export const PROVIDER_PROFILE_SCHEMA_VERSION = 1 as const;
export const DEF_RUNTIME_PROVIDER_PROFILE_SCHEMA_VERSION = PROVIDER_PROFILE_SCHEMA_VERSION;

export const PROVIDER_PROFILE_LIMITS = Object.freeze({
  maxFileBytes: 256 * 1_024,
  maxProfiles: 1_024,
  maxIdentifierCodeUnits: 128,
  maxTextCodeUnits: 4_096,
  maxApiKeyCodeUnits: 4_096,
  maxHeaderCount: 16,
  maxHeaderBytes: 16_384,
  maxHeaderValueCodeUnits: 4_096,
  maxHeaderValueBytes: 4_096,
  maxModelLimit: 100_000_000,
});

const REDACTED = '[redacted]';
const INSPECT_CUSTOM = Symbol.for('nodejs.util.inspect.custom');
const PROFILE_FILE_FLAGS = constants.O_RDONLY | ((constants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0);
const FORBIDDEN_HEADERS = new Set([
  'authorization',
  'connection',
  'content-length',
  'content-type',
  'cookie',
  'cookie2',
  'expect',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
  'x-real-ip',
]);

export type ProviderProfileErrorCode = 'PROVIDER_PROFILE_INVALID';

/**
 * Profile errors intentionally have no cause or input echo.  Filesystem and
 * parse failures use this same public error so callers cannot distinguish a
 * sensitive path/OS error by inspecting an unsafe nested exception.
 */
export class ProviderProfileError extends Error {
  readonly code: ProviderProfileErrorCode = 'PROVIDER_PROFILE_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'ProviderProfileError';
  }

  toJSON(): { readonly name: string; readonly code: ProviderProfileErrorCode; readonly message: string } {
    return { name: this.name, code: this.code, message: this.message };
  }
}

/** Compatibility name for the DEF runtime package without introducing an engine dependency. */
export { ProviderProfileError as DefRuntimeProfileError };

export interface ProviderProfile {
  readonly ref: string;
  readonly providerId: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly modelId: string;
  /** Ephemeral secret. It is never included in the profile's JSON/inspect view. */
  readonly apiKey: string;
  readonly contextLimit?: number;
  readonly outputLimit?: number;
  /** Header values are runtime-only secrets and are redacted when observed. */
  readonly headers?: Readonly<Record<string, string>>;
}

export interface ProviderProfileSource {
  getProfile(ref: string): Promise<ProviderProfile | null>;
}

export class FileProviderProfileSource implements ProviderProfileSource {
  readonly #filePath: string;

  constructor(filePath: string) {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw invalid('Provider profile file path is invalid');
    }
    this.#filePath = filePath;
  }

  async getProfile(ref: string): Promise<ProviderProfile | null> {
    const text = await readBoundedProfileFile(this.#filePath);
    if (text === null) return null;

    let document: unknown;
    try {
      document = JSON.parse(text);
    } catch {
      throw invalid('Provider profile file is not valid JSON');
    }

    const profiles = parseProfileDocumentSafely(document);
    return typeof ref === 'string'
      ? profiles.find((profile) => profile.ref === ref) ?? null
      : null;
  }
}

export class InMemoryProviderProfileSource implements ProviderProfileSource {
  readonly #profiles: ReadonlyMap<string, ProviderProfile>;

  constructor(profiles: readonly ProviderProfile[]) {
    if (!Array.isArray(profiles)) throw invalid('Provider profiles must be an array');
    if (profiles.length > PROVIDER_PROFILE_LIMITS.maxProfiles) {
      throw invalid('Provider profile list is too large');
    }

    const normalized = profiles.map((profile, index) => (
      parseProfileSafely(profile, `profiles[${index}]`)
    ));
    if (new Set(normalized.map((profile) => profile.ref)).size !== normalized.length) {
      throw invalid('Provider profile refs must be unique');
    }
    this.#profiles = new Map(normalized.map((profile) => [profile.ref, profile]));
  }

  async getProfile(ref: string): Promise<ProviderProfile | null> {
    return typeof ref === 'string' ? this.#profiles.get(ref) ?? null : null;
  }
}

/** Normalize an untrusted profile object into an immutable, secret-safe view. */
export function normalizeProviderProfile(value: unknown): ProviderProfile {
  return parseProfileSafely(value, 'profile');
}

/**
 * Convert a profile into the F0 connection port.  `ref` and `displayName` are
 * profile metadata, not transport fields, while the secret-bearing fields are
 * retained only for the driver and have redacted JSON/inspect views.
 */
export function toRuntimeModelConnection(value: ProviderProfile): RuntimeModelConnection {
  const profile = parseProfileSafely(value, 'profile');
  const connection: RuntimeModelConnection = {
    providerId: profile.providerId,
    modelId: profile.modelId,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    ...(profile.headers === undefined ? {} : { headers: profile.headers }),
    ...(profile.contextLimit === undefined ? {} : { contextLimit: profile.contextLimit }),
    ...(profile.outputLimit === undefined ? {} : { outputLimit: profile.outputLimit }),
  };
  return freezeWithRedaction(connection, () => redactedConnectionView(connection));
}

export const providerProfileToRuntimeModelConnection = toRuntimeModelConnection;
export const profileToRuntimeModelConnection = toRuntimeModelConnection;

async function readBoundedProfileFile(filePath: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const pathInfo = await lstat(filePath);
    assertSafeProfileFile(pathInfo);

    handle = await open(filePath, PROFILE_FILE_FLAGS);
    const openedInfo = await handle.stat();
    assertSafeProfileFile(openedInfo);
    if (pathInfo.dev !== openedInfo.dev || pathInfo.ino !== openedInfo.ino) {
      throw invalid('Provider profile file changed while it was opened');
    }

    const bytes = await readAtMost(handle, PROVIDER_PROFILE_LIMITS.maxFileBytes);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw invalid('Provider profile file is not valid UTF-8');
    }
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return null;
    if (error instanceof ProviderProfileError) throw error;
    throw invalid('Provider profile file cannot be read');
  } finally {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        // The descriptor is private and the public error must remain generic.
      }
    }
  }
}

function assertSafeProfileFile(info: { isFile(): boolean; isSymbolicLink(): boolean; size: number; mode: number; uid?: number; dev: number; ino: number }): void {
  if (!info.isFile() || info.isSymbolicLink()) {
    throw invalid('Provider profile must be a bounded regular file, not a symlink');
  }
  if (info.size > PROVIDER_PROFILE_LIMITS.maxFileBytes) {
    throw invalid('Provider profile file exceeds its bounded size');
  }

  if (process.platform !== 'win32') {
    const currentUid = process.getuid?.();
    if (
      currentUid === undefined
      || info.uid !== currentUid
      || (info.mode & 0o777) !== 0o600
    ) {
      throw invalid('Provider profile must be owned by the current user with mode 0600');
    }
  }
}

async function readAtMost(handle: Awaited<ReturnType<typeof open>>, maxBytes: number): Promise<Uint8Array> {
  const buffer = Buffer.alloc(maxBytes + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const result = await handle.read(buffer, offset, buffer.length - offset, null);
    if (result.bytesRead === 0) break;
    offset += result.bytesRead;
  }
  if (offset > maxBytes) throw invalid('Provider profile file exceeds its bounded size');
  return buffer.subarray(0, offset);
}

function parseProfileDocumentSafely(value: unknown): readonly ProviderProfile[] {
  try {
    return parseProfileDocument(value);
  } catch (error) {
    if (error instanceof ProviderProfileError) throw error;
    throw invalid('Provider profile document is invalid');
  }
}

function parseProfileDocument(value: unknown): readonly ProviderProfile[] {
  const document = expectRecord(value, 'profile document');
  assertExactKeys(document, ['profiles', 'schemaVersion'], 'profile document');
  if (document.schemaVersion !== PROVIDER_PROFILE_SCHEMA_VERSION) {
    throw invalid(`Provider profile schema must be ${PROVIDER_PROFILE_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(document.profiles)) {
    throw invalid('Provider profiles must be an array');
  }
  if (document.profiles.length > PROVIDER_PROFILE_LIMITS.maxProfiles) {
    throw invalid('Provider profile list is too large');
  }

  const profiles = document.profiles.map((profile, index) => (
    parseProfileSafely(profile, `profiles[${index}]`)
  ));
  if (new Set(profiles.map((profile) => profile.ref)).size !== profiles.length) {
    throw invalid('Provider profile refs must be unique');
  }
  return Object.freeze(profiles);
}

function parseProfileSafely(value: unknown, label: string): ProviderProfile {
  try {
    return parseProfile(value, label);
  } catch (error) {
    if (error instanceof ProviderProfileError) throw error;
    throw invalid(`${label} is invalid`);
  }
}

function parseProfile(value: unknown, label: string): ProviderProfile {
  const profile = expectRecord(value, label);
  const known = new Set([
    'ref', 'providerId', 'displayName', 'baseUrl', 'modelId', 'apiKey',
    'contextLimit', 'outputLimit', 'headers',
  ]);
  for (const key of Object.keys(profile)) {
    if (!known.has(key)) throw invalid(`${label}.${key} is not supported`);
  }

  const contextLimitValue = optionalOwnValue(profile, 'contextLimit', label);
  const outputLimitValue = optionalOwnValue(profile, 'outputLimit', label);
  const headersValue = optionalOwnValue(profile, 'headers', label);
  const normalized = {
    ref: requiredIdentifier(requiredOwnValue(profile, 'ref', label), `${label}.ref`),
    providerId: requiredIdentifier(requiredOwnValue(profile, 'providerId', label), `${label}.providerId`),
    displayName: boundedString(requiredOwnValue(profile, 'displayName', label), `${label}.displayName`, PROVIDER_PROFILE_LIMITS.maxTextCodeUnits),
    baseUrl: normalizeBaseUrl(requiredOwnValue(profile, 'baseUrl', label), `${label}.baseUrl`),
    modelId: boundedString(requiredOwnValue(profile, 'modelId', label), `${label}.modelId`, PROVIDER_PROFILE_LIMITS.maxTextCodeUnits),
    apiKey: boundedString(requiredOwnValue(profile, 'apiKey', label), `${label}.apiKey`, PROVIDER_PROFILE_LIMITS.maxApiKeyCodeUnits),
    ...(contextLimitValue === undefined
      ? {}
      : { contextLimit: positiveInteger(contextLimitValue, `${label}.contextLimit`) }),
    ...(outputLimitValue === undefined
      ? {}
      : { outputLimit: positiveInteger(outputLimitValue, `${label}.outputLimit`) }),
    ...(headersValue === undefined
      ? {}
      : { headers: normalizeHeaders(headersValue, `${label}.headers`) }),
  } satisfies ProviderProfile;

  return freezeWithRedaction(normalized, () => redactedProfileView(normalized));
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length
    || actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw invalid(`${label} fields are invalid`);
  }
}

function requiredOwnValue(record: Record<string, unknown>, key: string, label: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    throw invalid(`${label}.${key} is required`);
  }
  return readOwnValue(record, key, `${label}.${key}`);
}

function optionalOwnValue(record: Record<string, unknown>, key: string, label: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined;
  return readOwnValue(record, key, `${label}.${key}`);
}

function readOwnValue(record: Record<string, unknown>, key: string, label: string): unknown {
  try {
    return record[key];
  } catch {
    throw invalid(`${label} is invalid`);
  }
}

function requiredIdentifier(value: unknown, label: string): string {
  const parsed = boundedString(value, label, PROVIDER_PROFILE_LIMITS.maxIdentifierCodeUnits);
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(parsed)) {
    throw invalid(`${label} is not a portable identifier`);
  }
  return parsed;
}

function boundedString(value: unknown, label: string, maxCodeUnits: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw invalid(`${label} must be a non-empty string`);
  }
  if (value.length > maxCodeUnits) throw invalid(`${label} is too long`);
  if (/[\u0000-\u001F\u007F]/u.test(value)) {
    throw invalid(`${label} contains control characters`);
  }
  return value.trim();
}

function positiveInteger(value: unknown, label: string): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) <= 0
    || (value as number) > PROVIDER_PROFILE_LIMITS.maxModelLimit
  ) {
    throw invalid(`${label} must be a bounded positive integer`);
  }
  return value as number;
}

function normalizeBaseUrl(value: unknown, label: string): string {
  const input = boundedString(value, label, PROVIDER_PROFILE_LIMITS.maxTextCodeUnits);
  if (/\\/u.test(input)) throw invalid(`${label} contains an invalid path separator`);

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input);
  } catch {
    throw invalid(`${label} is not a valid URL`);
  }

  if (parsedUrl.username || parsedUrl.password || hasUrlUserInfo(input)) {
    throw invalid(`${label} must not contain user or password information`);
  }
  if (parsedUrl.search || parsedUrl.hash || hasUrlQueryOrFragmentMarker(input)) {
    throw invalid(`${label} must not contain a query or fragment`);
  }
  if (parsedUrl.protocol !== 'https:') {
    if (parsedUrl.protocol !== 'http:' || !isExactLoopbackHost(parsedUrl, input)) {
      throw invalid(`${label} must use HTTPS or exact loopback HTTP`);
    }
  }
  validateUrlPath(input, parsedUrl.pathname, label);
  return input.replace(/\/+$/u, '');
}

function isExactLoopbackHost(url: URL, input: string): boolean {
  if (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') return false;
  const rawHost = rawAuthorityHost(input);
  return rawHost === '127.0.0.1' || rawHost === '[::1]';
}

function hasUrlUserInfo(input: string): boolean {
  return rawAuthority(input)?.includes('@') ?? false;
}

function hasUrlQueryOrFragmentMarker(input: string): boolean {
  const authority = rawAuthority(input);
  if (authority === null) return false;
  const authorityStart = input.indexOf(`://${authority}`) + authority.length + 3;
  const remainder = input.slice(authorityStart);
  return remainder.includes('?') || remainder.includes('#');
}

function rawAuthorityHost(input: string): string | null {
  const authority = rawAuthority(input);
  if (authority === null || authority.includes('@')) return null;
  if (authority.startsWith('[')) {
    const closing = authority.indexOf(']');
    return closing >= 0 ? authority.slice(0, closing + 1) : null;
  }
  const portSeparator = authority.lastIndexOf(':');
  return portSeparator >= 0 ? authority.slice(0, portSeparator) : authority;
}

function rawAuthority(input: string): string | null {
  const match = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/u.exec(input);
  return match?.[1] ?? null;
}

function validateUrlPath(input: string, parsedPath: string, label: string): void {
  const authorityMatch = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*/u.exec(input);
  const rawPath = authorityMatch === null ? '' : input.slice(authorityMatch[0].length).split(/[?#]/u, 1)[0];
  if (rawPath && !rawPath.startsWith('/')) throw invalid(`${label} path must be rooted`);
  if (/%(?:2f|5c)/iu.test(rawPath)) throw invalid(`${label} path contains an encoded separator`);

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath || parsedPath);
  } catch {
    throw invalid(`${label} path is not valid`);
  }
  const pathForSegments = decodedPath.replace(/\/+$/u, '');
  if (pathForSegments.includes('\\') || pathForSegments.includes('//')) {
    throw invalid(`${label} path contains an ambiguous separator`);
  }
  if (pathForSegments.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw invalid(`${label} path contains dot segments`);
  }
}

function normalizeHeaders(value: unknown, label: string): Readonly<Record<string, string>> {
  const record = expectRecord(value, label);
  const entries = Object.entries(record);
  if (entries.length > PROVIDER_PROFILE_LIMITS.maxHeaderCount) {
    throw invalid(`${label} contains too many headers`);
  }

  const output: Record<string, string> = {};
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const [name, headerValue] of entries) {
    const normalizedName = name.toLowerCase();
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/u.test(name)
      || isForbiddenHeader(normalizedName)
      || seen.has(normalizedName)
      || typeof headerValue !== 'string'
      || headerValue.length > PROVIDER_PROFILE_LIMITS.maxHeaderValueCodeUnits
      || Buffer.byteLength(headerValue, 'utf8') > PROVIDER_PROFILE_LIMITS.maxHeaderValueBytes
      || /[\r\n]/u.test(headerValue)
      || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(headerValue)
    ) {
      throw invalid(`${label} contains an invalid, duplicate, or unsafe header`);
    }
    seen.add(normalizedName);
    totalBytes += Buffer.byteLength(name, 'utf8') + Buffer.byteLength(headerValue, 'utf8');
    if (totalBytes > PROVIDER_PROFILE_LIMITS.maxHeaderBytes) {
      throw invalid(`${label} exceeds its bounded byte size`);
    }
    Object.defineProperty(output, name, {
      value: headerValue,
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }

  return freezeWithRedaction(output, () => redactedHeadersView(output, []));
}

function isForbiddenHeader(name: string): boolean {
  return FORBIDDEN_HEADERS.has(name) || name.startsWith('proxy-');
}

function freezeWithRedaction<T extends object>(value: T, view: () => unknown): T {
  Object.defineProperty(value, 'toJSON', {
    value: view,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  Object.defineProperty(value, INSPECT_CUSTOM, {
    value: view,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(value);
}

function redactedProfileView(profile: ProviderProfile): Record<string, unknown> {
  const secrets = secretValues(profile.apiKey, profile.headers);
  return {
    ref: redactText(profile.ref, secrets),
    providerId: redactText(profile.providerId, secrets),
    displayName: redactText(profile.displayName, secrets),
    baseUrl: redactText(profile.baseUrl, secrets),
    modelId: redactText(profile.modelId, secrets),
    apiKey: REDACTED,
    ...(profile.contextLimit === undefined ? {} : { contextLimit: profile.contextLimit }),
    ...(profile.outputLimit === undefined ? {} : { outputLimit: profile.outputLimit }),
    ...(profile.headers === undefined ? {} : { headers: redactedHeadersView(profile.headers, secrets) }),
  };
}

function redactedConnectionView(connection: RuntimeModelConnection): Record<string, unknown> {
  const secrets = secretValues(connection.apiKey, connection.headers);
  return {
    providerId: redactText(connection.providerId, secrets),
    modelId: redactText(connection.modelId, secrets),
    baseUrl: redactText(connection.baseUrl, secrets),
    apiKey: REDACTED,
    ...(connection.headers === undefined ? {} : { headers: redactedHeadersView(connection.headers, secrets) }),
    ...(connection.contextLimit === undefined ? {} : { contextLimit: connection.contextLimit }),
    ...(connection.outputLimit === undefined ? {} : { outputLimit: connection.outputLimit }),
  };
}

function redactedHeadersView(
  headers: Readonly<Record<string, string>>,
  secrets: readonly string[],
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const name of Object.keys(headers)) {
    Object.defineProperty(output, redactText(name, secrets), {
      value: REDACTED,
      enumerable: true,
      writable: false,
      configurable: true,
    });
  }
  return output;
}

function secretValues(apiKey: string, headers: Readonly<Record<string, string>> | undefined): readonly string[] {
  return [...new Set([
    apiKey,
    ...(headers === undefined ? [] : Object.values(headers)),
  ].filter((value) => value.length > 0))].sort((left, right) => right.length - left.length);
}

function redactText(value: string, secrets: readonly string[]): string {
  let redacted = value;
  for (const secret of secrets) redacted = redacted.split(secret).join(REDACTED);
  return redacted;
}

function invalid(message: string): ProviderProfileError {
  return new ProviderProfileError(message);
}

function isErrno(error: unknown, code: string): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === code,
  );
}
