/**
 * DEF-owned bounded event-stream decoder.
 * Behaviorally derived from pi-mono packages/ai/src/utils/event-stream.ts at
 * e47b8e37a6211ebd0b2942fa87059d64f81eec02.
 */
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
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private readonly maxBufferChars: number;
  private buffer = '';
  private dataLines: string[] = [];
  private dataChars = 0;
  private dataLineCount = 0;
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
      : this.decode(chunk, true);
    this.assertBounded();
    return this.consumeCompleteLines(false);
  }

  finish(): SseEvent[] {
    this.buffer += this.decode(undefined, false);
    this.assertBounded();

    const events = this.consumeCompleteLines(true);
    if (this.buffer.length > 0) {
      const line = this.buffer;
      this.buffer = '';
      const event = this.consumeLine(line);
      if (event) events.push(event);
      this.assertBounded();
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
        this.dataChars += value.length;
        this.dataLineCount += 1;
        break;
      case 'event':
        this.eventName = value;
        break;
      case 'id':
        if (!value.includes('\u0000')) {
          this.lastEventId = value;
        }
        break;
      case 'retry': {
        const parsed = Number.parseInt(value, 10);
        if (/^\d+$/u.test(value) && Number.isSafeInteger(parsed)) {
          this.retry = parsed;
        }
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
    this.dataChars = 0;
    this.dataLineCount = 0;
    this.eventName = undefined;
    this.retry = undefined;
    return event;
  }

  private assertBounded(): void {
    // `buffer` contains the not-yet-dispatched source text.  The other
    // counters cover retained event state after complete lines have been
    // consumed: data values, one unit per data line (so empty data lines
    // cannot bypass the limit), joined data separators, and metadata values.
    // Keep these totals incrementally so a many-line event stays O(1) per
    // input line rather than repeatedly reducing the complete data array.
    const joinedDataSeparators = Math.max(0, this.dataLineCount - 1);
    const metadataChars = (
      (this.eventName?.length ?? 0)
      + (this.lastEventId?.length ?? 0)
      + (this.retry === undefined ? 0 : String(this.retry).length)
    );
    const retainedChars = (
      this.buffer.length
      + this.dataChars
      + this.dataLineCount
      + joinedDataSeparators
      + metadataChars
    );
    if (retainedChars > this.maxBufferChars) throw new SseParseError();
  }

  private decode(chunk: Uint8Array | undefined, stream: boolean): string {
    try {
      return chunk === undefined
        ? this.decoder.decode()
        : this.decoder.decode(chunk, { stream });
    } catch {
      throw new SseParseError();
    }
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
