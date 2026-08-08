export interface SseEvent {
  readonly event?: string;
  readonly data: string;
  readonly id?: string;
  readonly retry?: number;
}

export interface SseParserOptions {
  /** Maximum buffered UTF-16 code units before a line/event is dispatched. */
  readonly maxBufferChars?: number;
}

export class SseParseError extends Error {
  constructor() {
    super('Malformed server-sent event stream.');
    this.name = 'SseParseError';
  }
}

const DEFAULT_MAX_BUFFER_CHARS = 4 * 1024 * 1024;

/**
 * Incremental SSE decoder. Bytes are decoded with a streaming TextDecoder so
 * a multi-byte UTF-8 code point split across ReadableStream chunks survives.
 */
export class SseParser {
  private readonly decoder = new TextDecoder('utf-8');
  private readonly maxBufferChars: number;
  private buffer = '';
  private dataLines: string[] = [];
  private eventName: string | undefined;
  private lastEventId: string | undefined;
  private retry: number | undefined;

  constructor(options: SseParserOptions = {}) {
    const configuredLimit = options.maxBufferChars;
    this.maxBufferChars = configuredLimit !== undefined && Number.isFinite(configuredLimit)
      ? Math.max(1, Math.floor(configuredLimit))
      : DEFAULT_MAX_BUFFER_CHARS;
  }

  push(chunk: Uint8Array | string): SseEvent[] {
    this.buffer += typeof chunk === 'string'
      ? chunk
      : this.decoder.decode(chunk, { stream: true });
    this.assertBounded();
    return this.consumeCompleteLines(false);
  }

  finish(): SseEvent[] {
    this.buffer += this.decoder.decode();
    this.assertBounded();

    const events = this.consumeCompleteLines(true);
    if (this.buffer.length > 0) {
      const line = this.buffer;
      this.buffer = '';
      const event = this.consumeLine(line);
      if (event) events.push(event);
    }

    const finalEvent = this.dispatchEvent();
    if (finalEvent) events.push(finalEvent);
    return events;
  }

  private consumeCompleteLines(atEnd: boolean): SseEvent[] {
    const events: SseEvent[] = [];
    let cursor = 0;

    while (cursor < this.buffer.length) {
      const lineBreakIndex = findLineBreak(this.buffer, cursor);
      if (lineBreakIndex === -1) break;

      const lineBreak = this.buffer[lineBreakIndex];
      if (lineBreak === '\r' && lineBreakIndex === this.buffer.length - 1 && !atEnd) break;

      const line = this.buffer.slice(cursor, lineBreakIndex);
      cursor = lineBreakIndex + 1;
      if (lineBreak === '\r' && this.buffer[cursor] === '\n') cursor += 1;

      const event = this.consumeLine(line);
      if (event) events.push(event);
    }

    this.buffer = this.buffer.slice(cursor);
    this.assertBounded();
    return events;
  }

  private consumeLine(line: string): SseEvent | undefined {
    if (line.startsWith(':')) return undefined;
    if (line === '') return this.dispatchEvent();

    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
      case 'data':
        this.dataLines.push(value);
        this.assertBounded();
        break;
      case 'event':
        this.eventName = value;
        break;
      case 'id':
        if (!value.includes('\u0000')) this.lastEventId = value;
        break;
      case 'retry': {
        const parsed = Number.parseInt(value, 10);
        if (/^\d+$/u.test(value) && Number.isSafeInteger(parsed)) this.retry = parsed;
        break;
      }
      default:
        break;
    }

    return undefined;
  }

  private dispatchEvent(): SseEvent | undefined {
    if (this.dataLines.length === 0) return undefined;

    const event: SseEvent = {
      data: this.dataLines.join('\n'),
      ...(this.eventName !== undefined && this.eventName !== '' ? { event: this.eventName } : {}),
      ...(this.lastEventId !== undefined ? { id: this.lastEventId } : {}),
      ...(this.retry !== undefined ? { retry: this.retry } : {}),
    };
    this.dataLines = [];
    this.eventName = undefined;
    this.retry = undefined;
    return event;
  }

  private assertBounded(): void {
    const dataChars = this.dataLines.reduce((total, line) => total + line.length, 0);
    if (this.buffer.length + dataChars > this.maxBufferChars) throw new SseParseError();
  }
}

export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
  options?: SseParserOptions,
): AsyncGenerator<SseEvent> {
  const parser = new SseParser(options);
  const reader = body.getReader();
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    for (;;) {
      if (signal?.aborted) throw abortError();
      const result = await reader.read();
      if (result.done) break;
      for (const event of parser.push(result.value)) yield event;
    }
    if (signal?.aborted) throw abortError();
    for (const event of parser.finish()) yield event;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    void reader.cancel().catch(() => undefined);
  }
}

export async function* parseSseChunks(
  chunks: AsyncIterable<Uint8Array | string>,
  signal?: AbortSignal,
  options?: SseParserOptions,
): AsyncGenerator<SseEvent> {
  const parser = new SseParser(options);
  for await (const chunk of chunks) {
    if (signal?.aborted) throw abortError();
    for (const event of parser.push(chunk)) yield event;
  }
  if (signal?.aborted) throw abortError();
  for (const event of parser.finish()) yield event;
}

export const parseServerSentEvents = parseSseStream;

function findLineBreak(value: string, start: number): number {
  const lineFeed = value.indexOf('\n', start);
  const carriageReturn = value.indexOf('\r', start);
  if (lineFeed === -1) return carriageReturn;
  if (carriageReturn === -1) return lineFeed;
  return Math.min(lineFeed, carriageReturn);
}

function abortError(): Error {
  const error = new Error('SSE stream aborted.');
  error.name = 'AbortError';
  return error;
}
