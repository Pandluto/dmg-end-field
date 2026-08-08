import assert from 'node:assert/strict';
import test from 'node:test';
import { SseParser, parseSseChunks } from './sse-parser.ts';

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function oneByteChunks(value: string): Uint8Array[] {
  const encoded = bytes(value);
  return Array.from({ length: encoded.length }, (_, index) => encoded.slice(index, index + 1));
}

test('SseParser handles arbitrary byte boundaries, UTF-8, CRLF, and multiple data lines', () => {
  const parser = new SseParser();
  const events = oneByteChunks(
    'event: message\r\ndata: {"text":"雪"}\r\ndata: second line\r\n\r\n' +
    ': keep-alive\n\n' +
    'id: response-1\nretry: 1500\ndata: [DONE]\n\n',
  ).flatMap((chunk) => parser.push(chunk));

  events.push(...parser.finish());
  assert.deepEqual(events, [
    {
      event: 'message',
      data: '{"text":"雪"}\nsecond line',
    },
    {
      data: '[DONE]',
      id: 'response-1',
      retry: 1500,
    },
  ]);
});

test('SseParser dispatches an unterminated final event at EOF', () => {
  const parser = new SseParser();
  assert.deepEqual(parser.push(bytes('data: final')), []);
  assert.deepEqual(parser.finish(), [{ data: 'final' }]);
});

test('parseSseChunks preserves event order across mixed string and byte chunks', async () => {
  async function* chunks(): AsyncGenerator<Uint8Array | string> {
    yield 'data: first\n\n';
    yield bytes('data: se');
    yield 'cond\n\n';
  }

  const events: string[] = [];
  for await (const event of parseSseChunks(chunks())) events.push(event.data);
  assert.deepEqual(events, ['first', 'second']);
});

test('SseParser enforces a bounded buffered event', () => {
  const parser = new SseParser({ maxBufferChars: 8 });
  assert.throws(() => parser.push(bytes('data: too-long')), /Malformed server-sent event stream/u);
});
