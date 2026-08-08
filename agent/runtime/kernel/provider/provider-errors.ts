import type { ProviderFailure } from '../stream-events.ts';

const AUTHENTICATION_FAILURE: ProviderFailure = {
  kind: 'authentication',
  code: 'PROVIDER_AUTHENTICATION',
  message: 'Provider authentication failed. Check the API key or access permissions.',
  retryable: false,
};

const BAD_REQUEST_FAILURE: ProviderFailure = {
  kind: 'bad-request',
  code: 'PROVIDER_BAD_REQUEST',
  message: 'Provider rejected the request.',
  retryable: false,
};

const RATE_LIMIT_FAILURE: ProviderFailure = {
  kind: 'rate-limit',
  code: 'PROVIDER_RATE_LIMIT',
  message: 'Provider rate limit reached.',
  retryable: true,
};

const SERVER_FAILURE: ProviderFailure = {
  kind: 'server',
  code: 'PROVIDER_SERVER_ERROR',
  message: 'Provider server error.',
  retryable: true,
};

const NETWORK_FAILURE: ProviderFailure = {
  kind: 'network',
  code: 'PROVIDER_NETWORK_ERROR',
  message: 'Provider network request failed.',
  retryable: true,
};

const MALFORMED_RESPONSE_FAILURE: ProviderFailure = {
  kind: 'malformed-response',
  code: 'PROVIDER_MALFORMED_RESPONSE',
  message: 'Provider returned a malformed stream.',
  retryable: false,
};

const ABORTED_FAILURE: ProviderFailure = {
  kind: 'aborted',
  code: 'PROVIDER_ABORTED',
  message: 'Provider request aborted.',
  retryable: false,
};

const UNKNOWN_FAILURE: ProviderFailure = {
  kind: 'unknown',
  code: 'PROVIDER_UNKNOWN',
  message: 'Provider request failed.',
  retryable: false,
};

export class ProviderFailureError extends Error {
  readonly failure: ProviderFailure;
  readonly retryAfterMs?: number;

  constructor(failure: ProviderFailure, retryAfterMs?: number) {
    super(failure.message);
    this.name = 'ProviderFailureError';
    this.failure = failure;
    this.retryAfterMs = retryAfterMs;
  }
}

export class ProviderHttpError extends ProviderFailureError {
  constructor(statusCode: number, headers?: Headers) {
    super(providerFailureForStatus(statusCode), retryAfterMsFromHeaders(headers));
    this.name = 'ProviderHttpError';
  }
}

export class ProviderMalformedResponseError extends ProviderFailureError {
  constructor() {
    super(malformedProviderFailure());
    this.name = 'ProviderMalformedResponseError';
  }
}

export function authenticationProviderFailure(statusCode?: number): ProviderFailure {
  return withStatusCode(AUTHENTICATION_FAILURE, statusCode);
}

export function badRequestProviderFailure(statusCode?: number): ProviderFailure {
  return withStatusCode(BAD_REQUEST_FAILURE, statusCode);
}

export function malformedProviderFailure(): ProviderFailure {
  return { ...MALFORMED_RESPONSE_FAILURE };
}

export function abortedProviderFailure(): ProviderFailure {
  return { ...ABORTED_FAILURE };
}

export function providerFailureForStatus(statusCode: number): ProviderFailure {
  if (statusCode === 401 || statusCode === 403) return authenticationProviderFailure(statusCode);
  if (statusCode === 408) return withStatusCode(NETWORK_FAILURE, statusCode);
  if (statusCode === 429) return withStatusCode(RATE_LIMIT_FAILURE, statusCode);
  if (statusCode >= 400 && statusCode < 500) return badRequestProviderFailure(statusCode);
  if (statusCode >= 500 && statusCode <= 599) return withStatusCode(SERVER_FAILURE, statusCode);
  return withStatusCode(UNKNOWN_FAILURE, statusCode);
}

export function providerFailureFromUnknown(error: unknown): ProviderFailure {
  if (error instanceof ProviderFailureError) return error.failure;
  if (isAbortError(error)) return abortedProviderFailure();

  // The original error is deliberately not copied into the public diagnostic.
  // Fetch implementations can include URLs, headers, proxy details, or other
  // credential-shaped material in their messages.
  if (error instanceof Error) {
    const errorCode = readErrorCode(error);
    if (errorCode === 'ABORT_ERR' || errorCode === 'ERR_ABORTED') {
      return abortedProviderFailure();
    }

    const lowerMessage = error.message.toLowerCase();
    if (
      lowerMessage.includes('timeout') ||
      lowerMessage.includes('timed out') ||
      lowerMessage.includes('network') ||
      lowerMessage.includes('fetch failed') ||
      lowerMessage.includes('failed to fetch') ||
      lowerMessage.includes('connection') ||
      lowerMessage.includes('socket') ||
      lowerMessage.includes('terminated') ||
      lowerMessage.includes('econnreset') ||
      lowerMessage.includes('econnrefused') ||
      lowerMessage.includes('etimedout') ||
      lowerMessage.includes('enotfound') ||
      lowerMessage.includes('eai_again') ||
      lowerMessage.includes('und_err_')
    ) {
      return { ...NETWORK_FAILURE };
    }
  }

  return { ...UNKNOWN_FAILURE };
}

export function retryAfterMsFromHeaders(headers?: Headers, now = Date.now()): number | undefined {
  if (!headers) return undefined;

  const retryAfterMilliseconds = parseFiniteNonNegative(headers.get('retry-after-ms'));
  if (retryAfterMilliseconds !== undefined) return retryAfterMilliseconds;

  const retryAfter = headers.get('retry-after');
  if (!retryAfter) return undefined;

  const seconds = Number.parseFloat(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const dateMs = Date.parse(retryAfter) - now;
  return Number.isFinite(dateMs) && dateMs >= 0 ? dateMs : undefined;
}

export function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'AbortError' || error.name === 'CanceledError' || error.name === 'CancellationError';
}

function withStatusCode(failure: ProviderFailure, statusCode?: number): ProviderFailure {
  return statusCode === undefined ? { ...failure } : { ...failure, statusCode };
}

function parseFiniteNonNegative(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function readErrorCode(error: Error): string | undefined {
  const candidate = error as Error & { code?: unknown };
  return typeof candidate.code === 'string' ? candidate.code : undefined;
}
