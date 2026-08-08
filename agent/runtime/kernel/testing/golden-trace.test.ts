import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { AgentTrace, AgentTraceContextItem } from './trace-schema.ts';
import { parseAgentTrace } from './trace-schema.ts';
import {
  PI_REFERENCE_COMMIT,
  PI_REFERENCE_VERSION,
  hashNormalizedTrace,
  normalizeTimestamp,
  serializeNormalizedTrace,
} from './trace-normalizer.ts';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIRECTORY = path.join(TEST_DIRECTORY, 'fixtures');
const RUNNER = path.resolve(TEST_DIRECTORY, '../../../../scripts/agent-runtime-pi-reference.mjs');
const SCENARIOS = ['text', 'reasoning', 'tool', 'error', 'abort', 'compaction'] as const;
const REFERENCE_ROOT = process.env.PI_REFERENCE_ROOT;
const REFERENCE_SOURCE_PATHS = [
  'packages/agent/package.json',
  'packages/agent/src/agent-loop.ts',
  'packages/agent/src/agent.ts',
  'packages/agent/src/stream-fn.ts',
  'packages/agent/src/types.ts',
  'packages/ai/src/types.ts',
  'packages/ai/src/utils/event-stream.ts',
  'packages/ai/src/utils/validation.ts',
  'packages/ai/src/utils/uuid.ts',
  'packages/coding-agent/src/config.ts',
  'packages/coding-agent/src/core/messages.ts',
  'packages/coding-agent/src/core/session-manager.ts',
  'packages/coding-agent/src/utils/child-process.ts',
  'packages/coding-agent/src/utils/paths.ts',
] as const;
const PI_LOCKFILE_SHA256 = 'b96c0fcb6e21425451e3d22aa93cedb817c2a959597aa5bb41f269da56da94c1';
const EXPECTED_EXTERNAL_PACKAGES = [
  ['typebox', '1.3.7', '5bcd99370c3d97530949b9623b365b1b3d5bd0993deec31da016974144d55f63'],
  ['cross-spawn', '7.0.6', '9d3e5318cef8fc568a7a42983b226cf54622da99da0b051f43fedf73f563d5f3'],
  ['path-key', '3.1.1', 'e6d371124a12c3c15e6f80a1ab69fe3ab95a428f8ad8dc716def4b6144d0f3c9'],
  ['shebang-command', '2.0.0', 'dad4abb3650d89edae1d2b19dab727c8ee3cf88d283fba91581471e962ee8575'],
  ['shebang-regex', '3.0.0', 'd1997488a68d31cf2bf6893fade748f8716b41d497913e3c30e3066ee82be78e'],
  ['which', '2.0.2', 'e3d53524a4415c74f1f922506e585c0a21572b853274ad075482fa718c1de3a5'],
  ['isexe', '2.0.0', '10bfabbefc99095e1380dd45497d72a1b3fd810b6f1f8a9b90ae5a2db21c9a33'],
] as const;

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
    readonly nodeVersionPolicy: string;
    readonly piLockfile: { readonly path: string; readonly sha256: string };
    readonly seed: string;
    readonly systemPrompt: string;
    readonly model: string;
    readonly transport: string;
    readonly toolExecution: string;
    readonly compactionProjection: string;
    readonly referenceSourcePaths: readonly string[];
    readonly externalPackages: readonly {
      readonly name: string;
      readonly version: string;
      readonly integrity: string;
      readonly fileCount: number;
      readonly treeSha256: string;
      readonly entrypoints: readonly {
        readonly specifier: string;
        readonly path: string;
        readonly sha256: string;
      }[];
    }[];
    readonly idNormalization: string;
    readonly timestampNormalization: string;
    readonly streamingDeltaCapture: string;
  };
  readonly fixtures: readonly FixtureManifestEntry[];
}

test('Pi golden fixture manifest pins the upstream and every fixture hash', () => {
  const manifestPath = path.join(FIXTURE_DIRECTORY, 'manifest.json');
  const manifestBytes = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestBytes) as FixtureManifest;
  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.upstream.commit, PI_REFERENCE_COMMIT);
  assert.equal(manifest.upstream.version, PI_REFERENCE_VERSION);
  assert.equal(manifest.generation.runner, 'scripts/agent-runtime-pi-reference.mjs');
  assert.equal(manifest.generation.runnerVersion, 4);
  assert.equal(manifest.generation.nodeVersionPolicy, '>=22.19.0 <25.0.0');
  assert.deepEqual(manifest.generation.piLockfile, {
    path: 'package-lock.json',
    sha256: PI_LOCKFILE_SHA256,
  });
  assert.equal(
    manifest.generation.compactionProjection,
    'Pi coding-agent buildContextEntries + buildSessionContext',
  );
  assert.deepEqual(manifest.generation.referenceSourcePaths, REFERENCE_SOURCE_PATHS);
  assert.deepEqual(
    manifest.generation.externalPackages.map((externalPackage) => [
      externalPackage.name,
      externalPackage.version,
      externalPackage.treeSha256,
    ]),
    EXPECTED_EXTERNAL_PACKAGES,
  );
  for (const externalPackage of manifest.generation.externalPackages) {
    assert.match(externalPackage.integrity, /^sha512-[A-Za-z0-9+/=]+$/u);
    assert.equal(Number.isSafeInteger(externalPackage.fileCount) && externalPackage.fileCount > 0, true);
    assert.equal(externalPackage.entrypoints.length > 0, true);
    for (const entrypoint of externalPackage.entrypoints) {
      assert.match(entrypoint.specifier, /^[A-Za-z0-9@/._-]+$/u);
      assert.match(entrypoint.path, /^(?!\/)(?!.*\.\.)(?!.*[?#])[A-Za-z0-9/._-]+$/u);
      assert.match(entrypoint.sha256, /^[0-9a-f]{64}$/u);
    }
  }
  assert.equal(manifest.generation.timestampNormalization, 'discard raw Pi event timestamps');
  assert.equal(
    manifest.generation.streamingDeltaCapture,
    'Pi Agent message_update assistantMessageEvent deltas',
  );
  assert.doesNotMatch(manifestBytes, /(?:\/Users\/|\/(?:private\/)?tmp\/|file:|\bsk-|api[_-]?key|authorization)/iu);
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
  const textContent = text.events.find((event) => event.type === 'content.text');
  assert.ok(textContent?.type === 'content.text');
  assert.deepEqual(textContent.data.deltas, ['确定性文本响', '', '应：你好，终', '末地 🧪。']);
  assert.equal(textContent.data.deltas.join(''), textContent.data.text);
  assertUnicodeSafeChunks(textContent.data.deltas);
  assert.equal(textContent.data.deltas.includes(''), true, 'Pi-forwarded empty text delta must be preserved');

  const reasoning = readTrace('reasoning');
  assert.equal(reasoning.events.some((event) => event.type === 'content.reasoning'), true);
  const reasoningContent = reasoning.events.find((event) => event.type === 'content.reasoning');
  assert.ok(reasoningContent?.type === 'content.reasoning');
  assert.deepEqual(reasoningContent.data.deltas, ['检查确定性输入', '', '：中文与 em', 'oji 🧭。']);
  assert.equal(reasoningContent.data.deltas.join(''), reasoningContent.data.text);
  assertUnicodeSafeChunks(reasoningContent.data.deltas);
  assert.equal(reasoningContent.data.deltas.includes(''), true);
  const reasoningText = reasoning.events.find((event) => event.type === 'content.text');
  assert.ok(reasoningText?.type === 'content.text');
  assert.deepEqual(reasoningText.data.deltas, ['确定性推', '', '理完成', ' ✅。']);
  assertUnicodeSafeChunks(reasoningText.data.deltas);

  const tool = readTrace('tool');
  const toolCall = tool.events.find((event) => event.type === 'tool.call');
  assert.ok(toolCall?.type === 'tool.call');
  assert.deepEqual(toolCall.data.argumentDeltas, [
    '{"left":2,"right":40,"context":{"l',
    '',
    'abels":["中文","emoji 🧪"],"note":"es',
    'caped \\"quote\\" \\\\ slash\\nline"}}',
  ]);
  assert.deepEqual(JSON.parse(toolCall.data.argumentDeltas.join('')), toolCall.data.arguments);
  assert.deepEqual(toolCall.data.arguments, {
    left: 2,
    right: 40,
    context: {
      labels: ['中文', 'emoji 🧪'],
      note: 'escaped "quote" \\ slash\nline',
    },
  });
  assertUnicodeSafeChunks(toolCall.data.argumentDeltas);
  assert.equal(toolCall.data.argumentDeltas.includes(''), true, 'empty Tool argument delta must be preserved');
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
  assert.equal(abort.events.some((event) => event.type === 'response.start'), true);
  const abortContent = abort.events.find((event) => event.type === 'content.text');
  assert.ok(abortContent?.type === 'content.text');
  assert.deepEqual(abortContent.data.deltas, ['首个流式']);
  assert.equal(abortContent.data.text, '首个流式');
  assertUnicodeSafeChunks(abortContent.data.deltas);
  assert.equal(abort.events.filter((event) => event.type === 'content.text').length, 1);
  assert.equal(abort.events.some((event) => event.type === 'content.reasoning'), false);
  assert.equal(abort.events.some((event) => event.type === 'tool.call'), false);
  assert.equal(abort.events.some((event) => event.type === 'tool.result'), false);
  assert.equal(
    abort.events.some((event) => event.type === 'message.assistant' && event.data.stopReason === 'stop'),
    false,
  );
  assert.deepEqual(eventTypes(abort), [
    'run.start', 'turn.start', 'message.user', 'context.snapshot', 'response.start',
    'content.text', 'message.assistant', 'turn.end', 'run.end',
  ]);

  const compaction = readTrace('compaction');
  const compactionEvent = compaction.events.find((event) => event.type === 'compaction');
  const contextSnapshot = compaction.events.find((event) => event.type === 'context.snapshot');
  assert.ok(compactionEvent?.type === 'compaction');
  assert.ok(contextSnapshot?.type === 'context.snapshot');
  if (compactionEvent.data.status !== 'completed') {
    assert.fail('compaction fixture must contain a completed compaction event');
  }
  assert.equal(compactionEvent.data.firstKeptItemIndex, 3);
  assert.deepEqual(contextSnapshot.data.items.map(contextItemSignature), [
    'compaction:The obsolete opening exchange was summarized deterministically.',
    'user-text:Retained tail user message.',
    'assistant-text:Retained tail assistant response.',
    'user-text:Post-compaction session user entry.',
    'assistant-text:Post-compaction session assistant entry.',
    'user-text:New prompt after compacted session.',
  ]);
  const firstContextItem = contextSnapshot.data.items[0];
  assert.ok(firstContextItem?.kind === 'compaction');
  assert.equal(firstContextItem.messageId, compactionEvent.messageId);
  assert.equal(
    JSON.stringify(contextSnapshot.data.items).includes('Summarized-away old user message.'),
    false,
  );
  assert.equal(
    JSON.stringify(contextSnapshot.data.items).includes('Summarized-away old assistant response.'),
    false,
  );
  assert.equal(
    JSON.stringify(contextSnapshot.data.items).includes('Superseded earlier compaction summary.'),
    false,
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
  test('explicit Pi root repeatedly regenerates byte-identical normalized fixtures and hashes', () => {
    for (const scenario of SCENARIOS) {
      const generated = runReferenceScenario(REFERENCE_ROOT, scenario);
      const repeated = runReferenceScenario(REFERENCE_ROOT, scenario);
      const checkedIn = readFileSync(path.join(FIXTURE_DIRECTORY, `${scenario}.json`), 'utf8');
      assert.equal(generated, checkedIn, `${scenario} normalized fixture bytes`);
      assert.equal(repeated, generated, `${scenario} repeated normalized fixture bytes`);
      assert.equal(sha256(Buffer.from(repeated, 'utf8')), sha256(Buffer.from(checkedIn, 'utf8')));
      parseAgentTrace(JSON.parse(generated));
      parseAgentTrace(JSON.parse(repeated));
    }
  });

  test('reference runner rejects tracked dirty source and lockfiles in an isolated Pi clone', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'pi-golden-dirty-'));
    try {
      execFileSync('git', ['clone', '--shared', '--no-checkout', '--quiet', REFERENCE_ROOT, temporaryRoot]);
      execFileSync('git', ['-C', temporaryRoot, 'sparse-checkout', 'init', '--no-cone']);
      execFileSync('git', [
        '-C',
        temporaryRoot,
        'sparse-checkout',
        'set',
        '--no-cone',
        '/package.json',
        '/package-lock.json',
        '/packages/agent/package.json',
        '/packages/agent/src/agent.ts',
      ]);
      execFileSync('git', ['-C', temporaryRoot, 'checkout', '--detach', PI_REFERENCE_COMMIT], {
        stdio: 'ignore',
      });
      appendFileSync(
        path.join(temporaryRoot, 'packages/agent/src/agent.ts'),
        '\n// controlled tracked-dirty rejection test\n',
        'utf8',
      );

      assertTrackedDirtyRejected(temporaryRoot, 'source');

      execFileSync('git', ['-C', temporaryRoot, 'restore', 'packages/agent/src/agent.ts']);
      appendFileSync(
        path.join(temporaryRoot, 'package-lock.json'),
        '\n',
        'utf8',
      );
      assertTrackedDirtyRejected(temporaryRoot, 'lockfile');
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  test('canonical /tmp aliases execute the real runner main and produce identical non-empty bytes', () => {
    const aliasedReferenceRoot = macOsTmpAlias(REFERENCE_ROOT);
    assert.ok(aliasedReferenceRoot, 'fixture root must be below /tmp or /private/tmp for alias coverage');
    const temporaryDirectory = mkdtempSync(path.join('/tmp', 'pi-runner-main-alias-'));
    const runnerAlias = path.join(temporaryDirectory, 'agent-runtime-pi-reference.mjs');
    try {
      symlinkSync(RUNNER, runnerAlias);
      const canonical = runReferenceScenario(REFERENCE_ROOT, 'text');
      const aliased = runReferenceScenario(aliasedReferenceRoot, 'text', runnerAlias);
      assert.ok(aliased.length > 0, 'canonical main detection must not exit successfully with zero bytes');
      assert.equal(aliased, canonical);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('reference runner rejects drift in an installed transitive package tree', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'pi-golden-external-drift-'));
    try {
      execFileSync('git', ['clone', '--shared', '--no-checkout', '--quiet', REFERENCE_ROOT, temporaryRoot]);
      execFileSync('git', ['-C', temporaryRoot, 'sparse-checkout', 'init', '--no-cone']);
      execFileSync('git', [
        '-C',
        temporaryRoot,
        'sparse-checkout',
        'set',
        '--no-cone',
        '/package.json',
        '/package-lock.json',
        ...REFERENCE_SOURCE_PATHS.map((sourcePath) => `/${sourcePath}`),
      ]);
      execFileSync('git', ['-C', temporaryRoot, 'checkout', '--detach', PI_REFERENCE_COMMIT], {
        stdio: 'ignore',
      });
      const nodeModules = path.join(temporaryRoot, 'node_modules');
      mkdirSync(nodeModules, { recursive: true });
      for (const [packageName] of EXPECTED_EXTERNAL_PACKAGES) {
        cpSync(
          path.join(REFERENCE_ROOT, 'node_modules', packageName),
          path.join(nodeModules, packageName),
          { recursive: true },
        );
      }
      appendFileSync(
        path.join(nodeModules, 'typebox/build/compile/index.mjs'),
        '\n// controlled external package drift\n',
        'utf8',
      );

      const result = spawnSync(process.execPath, [RUNNER, '--scenario', 'text'], {
        env: { ...process.env, PI_REFERENCE_ROOT: temporaryRoot },
        encoding: 'utf8',
      });
      assert.notEqual(result.status, 0);
      assert.match(`${result.stdout}\n${result.stderr}`, /external package bytes drifted/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
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

function contextItemSignature(item: AgentTraceContextItem): string {
  if (item.kind === 'compaction') return `${item.kind}:${item.summary}`;
  if ('text' in item) return `${item.kind}:${item.text}`;
  return item.kind;
}

function assertUnicodeSafeChunks(chunks: readonly string[]): void {
  for (const [index, chunk] of chunks.entries()) {
    if (!chunk) continue;
    const first = chunk.charCodeAt(0);
    const last = chunk.charCodeAt(chunk.length - 1);
    assert.equal(first >= 0xdc00 && first <= 0xdfff, false, `chunk ${index} starts with a low surrogate`);
    assert.equal(last >= 0xd800 && last <= 0xdbff, false, `chunk ${index} ends with a high surrogate`);
  }
}

function runReferenceScenario(
  referenceRoot: string,
  scenario: typeof SCENARIOS[number],
  runner = RUNNER,
): string {
  return execFileSync(
    process.execPath,
    [runner, '--scenario', scenario],
    { env: { ...process.env, PI_REFERENCE_ROOT: referenceRoot }, encoding: 'utf8' },
  ) as string;
}

function macOsTmpAlias(value: string): string | null {
  if (value.startsWith('/private/tmp/')) return value.replace(/^\/private\/tmp\//u, '/tmp/');
  if (value.startsWith('/tmp/')) return `/private${value}`;
  return null;
}

function assertTrackedDirtyRejected(referenceRoot: string, label: string): void {
  const result = spawnSync(process.execPath, [RUNNER, '--scenario', 'text'], {
    env: { ...process.env, PI_REFERENCE_ROOT: referenceRoot },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0, `${label} dirty clone must fail`);
  assert.match(`${result.stdout}\n${result.stderr}`, /tracked modifications/u);
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
