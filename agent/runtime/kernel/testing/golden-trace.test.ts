import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { AgentTrace } from './trace-schema.ts';
import { parseAgentTrace } from './trace-schema.ts';
import {
  PI_REFERENCE_COMMIT,
  PI_REFERENCE_VERSION,
  hashNormalizedTrace,
  normalizeTimestamp,
  serializeNormalizedTrace,
} from './trace-normalizer.ts';

const TEST_DIRECTORY = path.dirname(new URL(import.meta.url).pathname);
const FIXTURE_DIRECTORY = path.join(TEST_DIRECTORY, 'fixtures');
const RUNNER = path.resolve(TEST_DIRECTORY, '../../../../scripts/agent-runtime-pi-reference.mjs');
const SCENARIOS = ['text', 'reasoning', 'tool', 'error', 'abort', 'compaction'] as const;
const REFERENCE_ROOT = process.env.PI_REFERENCE_ROOT;

interface FixtureManifestEntry {
  readonly scenario: string;
  readonly file: string;
  readonly sha256: string;
  readonly byteLength: number;
}

interface FixtureManifest {
  readonly manifestVersion: 1;
  readonly upstream: {
    readonly repository: string;
    readonly commit: string;
    readonly version: string;
  };
  readonly generation: {
    readonly runner: string;
    readonly runnerVersion: number;
    readonly seed: string;
    readonly systemPrompt: string;
    readonly model: string;
    readonly transport: string;
    readonly toolExecution: string;
    readonly idNormalization: string;
    readonly timestampNormalization: string;
  };
  readonly fixtures: readonly FixtureManifestEntry[];
}

test('Pi golden fixture manifest pins the upstream and every fixture hash', () => {
  const manifest = readJson(path.join(FIXTURE_DIRECTORY, 'manifest.json')) as FixtureManifest;
  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.upstream.commit, PI_REFERENCE_COMMIT);
  assert.equal(manifest.upstream.version, PI_REFERENCE_VERSION);
  assert.equal(manifest.generation.runner, 'scripts/agent-runtime-pi-reference.mjs');
  assert.equal(manifest.generation.timestampNormalization, 'discard raw Pi event timestamps');
  assert.deepEqual(
    manifest.fixtures.map((fixture) => fixture.scenario),
    SCENARIOS,
  );

  for (const fixture of manifest.fixtures) {
    const bytes = readFileSync(path.join(FIXTURE_DIRECTORY, fixture.file));
    assert.equal(bytes.byteLength, fixture.byteLength, `${fixture.scenario} byte length`);
    assert.equal(sha256(bytes), fixture.sha256, `${fixture.scenario} sha256`);
  }
});

test('all Pi golden fixtures are accepted by the F0 trace parser', () => {
  for (const scenario of SCENARIOS) {
    const trace = readTrace(scenario);
    assert.equal(trace.source.commit, PI_REFERENCE_COMMIT);
    assert.equal(trace.source.version, PI_REFERENCE_VERSION);
    assert.equal(trace.events[0]?.type, 'run.start');
    assert.equal(trace.events.at(-1)?.type, 'run.end');
    assert.equal(trace.events.some((event) => event.type === 'context.snapshot'), true);
    assert.equal(trace.events.some((event) => event.type === 'message.assistant'), true);
    assert.equal(JSON.stringify(trace).includes('timestamp'), false);
  }
});

test('golden fixtures preserve the required observable scenario branches', () => {
  const text = readTrace('text');
  assert.deepEqual(eventTypes(text), [
    'run.start', 'turn.start', 'message.user', 'context.snapshot', 'response.start',
    'content.text', 'message.assistant', 'turn.end', 'run.end',
  ]);

  const reasoning = readTrace('reasoning');
  assert.equal(reasoning.events.some((event) => event.type === 'content.reasoning'), true);

  const tool = readTrace('tool');
  assert.equal(tool.events.filter((event) => event.type === 'tool.call').length, 1);
  assert.equal(tool.events.filter((event) => event.type === 'tool.result').length, 1);
  assert.equal(
    tool.events.some((event) => event.type === 'context.snapshot'
      && event.data.items.some((item) => item.kind === 'assistant-tool-call')),
    true,
  );
  assert.equal(
    tool.events.some((event) => event.type === 'context.snapshot'
      && event.data.items.some((item) => item.kind === 'tool-result')),
    true,
  );

  const error = readTrace('error');
  assert.equal(runStatus(error), 'failed');
  assert.equal(error.events.some((event) => event.type === 'response.start'), false);

  const abort = readTrace('abort');
  assert.equal(runStatus(abort), 'aborted');
  assert.equal(abort.events.some((event) => event.type === 'response.start'), false);

  const compaction = readTrace('compaction');
  assert.equal(compaction.events.some((event) => event.type === 'compaction'), true);
  assert.equal(
    compaction.events.some((event) => event.type === 'context.snapshot'
      && event.data.items.some((item) => item.kind === 'compaction')),
    true,
  );
});

test('normalization removes timestamps and maps ids by first appearance', () => {
  assert.equal(normalizeTimestamp(1_725_000_000_000), 0);
  const tool = readTrace('tool');
  const ids = new Set<string>();
  const toolCallIds = new Set<string>();
  for (const event of tool.events) {
    if (event.messageId) ids.add(event.messageId);
    if (event.toolCallId) toolCallIds.add(event.toolCallId);
  }
  assert.deepEqual([...ids], ['message-1', 'message-2', 'message-3', 'message-4']);
  assert.deepEqual([...toolCallIds], ['tool-call-1']);
  assert.equal(hashNormalizedTrace(tool), sha256(Buffer.from(serializeNormalizedTrace(tool), 'utf8')));
});

test('reference runner refuses to use an implicit Pi root', () => {
  const result = spawnSync(process.execPath, [RUNNER, '--scenario', 'text'], {
    env: withoutReferenceRoot(),
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /PI_REFERENCE_ROOT/u);
});

if (REFERENCE_ROOT) {
  test('explicit Pi root regenerates byte-identical normalized fixtures', () => {
    for (const scenario of SCENARIOS) {
      const generated: string = execFileSync(
        process.execPath,
        [RUNNER, '--scenario', scenario],
        { env: { ...process.env, PI_REFERENCE_ROOT: REFERENCE_ROOT }, encoding: 'utf8' },
      ) as string;
      const checkedIn = readFileSync(path.join(FIXTURE_DIRECTORY, `${scenario}.json`), 'utf8');
      assert.equal(generated, checkedIn, `${scenario} normalized fixture bytes`);
      parseAgentTrace(JSON.parse(generated));
    }
  });
} else {
  test('explicit Pi root regeneration (set PI_REFERENCE_ROOT to run)', { skip: true }, () => {});
}

function readTrace(scenario: string): AgentTrace {
  return parseAgentTrace(readJson(path.join(FIXTURE_DIRECTORY, `${scenario}.json`)));
}

function eventTypes(trace: AgentTrace): string[] {
  return trace.events.map((event) => event.type);
}

function runStatus(trace: AgentTrace): string {
  const terminal = trace.events.at(-1);
  if (!terminal || terminal.type !== 'run.end') throw new Error('trace is missing run.end');
  return terminal.data.status;
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function withoutReferenceRoot(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.PI_REFERENCE_ROOT;
  return env;
}
