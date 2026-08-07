import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { EngineHealth } from '../../core/contracts/index.ts';
import { OpenCodeEngineError, messageOf } from './errors.ts';
import {
  OPENCODE_PLUGIN_BUILD_ID,
  OPENCODE_PLUGIN_PROTOCOL_VERSION,
  type OpenCodePluginReadyExpectation,
} from './private-bridge.ts';
import type { OpenCodeProviderProfile, OpenCodeProviderProfileSource } from './profile.ts';
import { OPENCODE_TOOL_BINDINGS } from './tool-bindings.ts';

export const OPENCODE_RUNTIME_MANIFEST_SCHEMA_VERSION = 1 as const;
export const OPENCODE_UPSTREAM_VERSION = '1.17.11' as const;
export const OPENCODE_RUNTIME_VERSION = '1.17.11-def.1' as const;
export const OPENCODE_BINARY_VERSION = '0.0.0--202608061828' as const;
export const OPENCODE_SOURCE_REF = 'codex/def-opencode-spec9-2-implementation@bcea5f12' as const;
export const DEF_OPENCODE_AGENT_PROMPT = [
  'You are the embedded DEF main-workbench assistant.',
  'Reply in Chinese by default and describe only outcomes supported by current Host facts and typed Tool results.',
  'Never fabricate current game state, identifiers, approvals, capabilities, mutations, or visible postconditions.',
  'The DEF Harness supplies the active business, operation, phase, instructions, context, and the single Tool allowed for each model step.',
  'Use only that projected DEF Tool. Do not use files, shell, web, subagents, generic OpenCode tools, or an unprojected Tool.',
  'A selected Workbench roster is not the complete local operator catalog. A bounded or incomplete result is not proof of catalog absence.',
  'Preserve typed scope, source, complete, missing, exhaustive, and truncated fields when they are present.',
  'A mutation is complete only when the typed product capability, required approval, version checks, and visible postcondition all succeed.',
  'When the projection contains no Tool, answer from established results only. Never serialize or announce another Tool invocation.',
  'Never emit raw Tool-call markup, DSML, XML/HTML protocol blocks, hidden routing details, service URLs, or adapter details.',
  'Do not expose hidden configuration or session identifiers unless the user explicitly asks for the current session id.',
].join('\n');
const OPENCODE_PROCESS_MANIFEST_SCHEMA_VERSION = 2;
const DEFAULT_STARTUP_TIMEOUT_MS = 60_000;

export interface OpenCodeRuntimeManifest {
  readonly schemaVersion: typeof OPENCODE_RUNTIME_MANIFEST_SCHEMA_VERSION;
  readonly name: 'def-opencode-engine-runtime';
  readonly engineKind: 'opencode';
  readonly upstreamVersion: string;
  readonly runtimeVersion: string;
  readonly storeSchemaVersion: number;
  readonly target: string;
  readonly sourceRef: string;
  readonly binary: string;
  readonly binaryVersion: string;
  readonly binaryCodeBytes: number;
  readonly binaryCodeSha256: string;
  readonly plugin: string;
  readonly pluginSha256: string;
  readonly license: string;
  readonly licenseBytes: number;
  readonly licenseSha256: string;
}

export interface VerifiedOpenCodeRuntime {
  readonly root: string;
  readonly manifest: OpenCodeRuntimeManifest;
  readonly binaryPath: string;
  readonly pluginPath: string;
  readonly licensePath: string;
}

export interface RunningOpenCodeRuntime {
  readonly epoch: number;
  readonly origin: string;
  readonly authorization: string;
  readonly directory: string;
  readonly profileRef: string;
  readonly verified: VerifiedOpenCodeRuntime;
  request(pathname: string, init?: RequestInit): Promise<Response>;
}

export interface OpenCodeRuntimeSupervisorOptions {
  readonly runtimeRoot: string;
  readonly storeRoot: string;
  readonly profileSource: OpenCodeProviderProfileSource;
  readonly bridgeOrigin: () => string;
  readonly bridgeToken: () => string;
  readonly expectPluginReady: (
    expectation: OpenCodePluginReadyExpectation,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly fetch?: typeof fetch;
  readonly onExit?: (error: OpenCodeEngineError) => void;
  readonly startupTimeoutMs?: number;
  readonly stopGraceTimeoutMs?: number;
  readonly stopKillTimeoutMs?: number;
  readonly spawnProcess?: typeof spawn;
}

export class OpenCodeRuntimeSupervisor {
  readonly #runtimeRoot: string;
  readonly #storeRoot: string;
  readonly #profileSource: OpenCodeProviderProfileSource;
  readonly #bridgeOrigin: () => string;
  readonly #bridgeToken: () => string;
  readonly #expectPluginReady: OpenCodeRuntimeSupervisorOptions['expectPluginReady'];
  readonly #fetch: typeof fetch;
  #onExit: (error: OpenCodeEngineError) => void;
  readonly #startupTimeoutMs: number;
  readonly #stopGraceTimeoutMs: number;
  readonly #stopKillTimeoutMs: number;
  readonly #spawnProcess: typeof spawn;
  #verified: VerifiedOpenCodeRuntime | null = null;
  #running: RunningOpenCodeRuntime | null = null;
  #child: ChildProcess | null = null;
  #startPromise: Promise<RunningOpenCodeRuntime> | null = null;
  #shutdownPromise: Promise<void> | null = null;
  #intentionalStop = false;
  #startProfileRef: string | null = null;
  #epoch = 0;
  #processNonce: string | null = null;

  constructor(options: OpenCodeRuntimeSupervisorOptions) {
    this.#runtimeRoot = resolve(options.runtimeRoot);
    this.#storeRoot = resolve(options.storeRoot);
    this.#profileSource = options.profileSource;
    this.#bridgeOrigin = options.bridgeOrigin;
    this.#bridgeToken = options.bridgeToken;
    this.#expectPluginReady = options.expectPluginReady;
    this.#fetch = options.fetch ?? fetch;
    this.#onExit = options.onExit ?? (() => {});
    // A first launch may initialize OpenCode's database and load the DEF
    // plugin under a packaged Electron utility process.  Real desktop cold
    // starts can exceed 30 seconds even though the runtime is healthy.
    this.#startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.#stopGraceTimeoutMs = options.stopGraceTimeoutMs ?? 5_000;
    this.#stopKillTimeoutMs = options.stopKillTimeoutMs ?? 1_000;
    this.#spawnProcess = options.spawnProcess ?? spawn;
  }

  setExitHandler(handler: (error: OpenCodeEngineError) => void): void {
    this.#onExit = handler;
  }

  async probe(profileRef: string): Promise<EngineHealth> {
    if (this.#shutdownPromise) {
      return unavailable('ENGINE_SHUTDOWN', 'OpenCode Engine is shutting down');
    }
    try {
      this.#verified = await verifyOpenCodeRuntime(this.#runtimeRoot);
      const profile = await this.#profileSource.getProfile(profileRef);
      if (!profile) return unavailable('OPENCODE_PROFILE_MISSING', 'OpenCode provider profile is not configured');
      return {
        status: 'ready',
        kind: 'opencode',
        runtimeVersion: this.#verified.manifest.runtimeVersion,
      };
    } catch (error) {
      const code = error instanceof OpenCodeEngineError ? error.code : 'OPENCODE_RUNTIME_INVALID';
      return unavailable(code, publicRuntimeMessage(error));
    }
  }

  async start(profileRef: string): Promise<RunningOpenCodeRuntime> {
    if (this.#shutdownPromise) {
      throw new OpenCodeEngineError('OPENCODE_PROCESS_EXITED', 'OpenCode runtime is shut down');
    }
    if (this.#running) {
      if (this.#running.profileRef !== profileRef) {
        throw new OpenCodeEngineError(
          'OPENCODE_PROFILE_CONFLICT',
          'OpenCode runtime cannot switch provider profile while sessions are active',
        );
      }
      return this.#running;
    }
    if (this.#startPromise) {
      if (this.#startProfileRef !== profileRef) {
        throw new OpenCodeEngineError(
          'OPENCODE_PROFILE_CONFLICT',
          'OpenCode runtime cannot start two provider profiles concurrently',
        );
      }
      return this.#startPromise;
    }
    if (this.#child && !childExited(this.#child)) {
      throw new OpenCodeEngineError(
        'OPENCODE_PROCESS_STOP_FAILED',
        'A previous OpenCode process is still alive and must not be replaced',
      );
    }
    this.#startProfileRef = profileRef;
    this.#startPromise = this.#start(profileRef).finally(() => {
      this.#startPromise = null;
      this.#startProfileRef = null;
    });
    return this.#startPromise;
  }

  async #start(profileRef: string): Promise<RunningOpenCodeRuntime> {
    const verified = this.#verified ?? await verifyOpenCodeRuntime(this.#runtimeRoot);
    this.#verified = verified;
    const profile = await this.#profileSource.getProfile(profileRef);
    if (!profile) {
      throw new OpenCodeEngineError('OPENCODE_PROFILE_MISSING', 'OpenCode provider profile is not configured');
    }
    const bridgeOrigin = this.#bridgeOrigin();
    const bridgeToken = this.#bridgeToken();
    const processNonce = randomBytes(32).toString('base64url');
    const port = await reserveLoopbackPort();
    const runtimeHome = join(this.#storeRoot, 'runtime');
    const directory = join(this.#storeRoot, 'workspace');
    const serverPassword = randomBytes(32).toString('base64url');
    await prepareStore(runtimeHome, directory);
    const canonicalDirectory = await realpath(directory);

    const handshakeAbort = new AbortController();
    const pluginReady = this.#expectPluginReady({
      protocolVersion: OPENCODE_PLUGIN_PROTOCOL_VERSION,
      buildId: OPENCODE_PLUGIN_BUILD_ID,
      processNonce,
      runtimeVersion: verified.manifest.runtimeVersion,
      directory: canonicalDirectory,
    }, handshakeAbort.signal);
    void pluginReady.catch(() => undefined);

    const environment = buildRuntimeEnvironment({
      runtimeHome,
      directory: canonicalDirectory,
      serverPassword,
      bridgeOrigin,
      bridgeToken,
      processNonce,
      runtimeVersion: verified.manifest.runtimeVersion,
      profile,
      pluginPath: verified.pluginPath,
    });
    this.#intentionalStop = false;
    const child = this.#spawnProcess(
      verified.binaryPath,
      ['serve', '--hostname', '127.0.0.1', '--port', String(port)],
      {
        cwd: canonicalDirectory,
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    let spawnError: unknown = null;
    child.once('error', (error) => {
      spawnError = error;
    });
    if (!Number.isSafeInteger(child.pid) || Number(child.pid) <= 0) {
      handshakeAbort.abort(new Error('OpenCode process has no PID'));
      throw new OpenCodeEngineError('OPENCODE_PROCESS_START_FAILED', 'OpenCode process did not start');
    }
    this.#child = child;
    this.#processNonce = processNonce;
    try {
      const hostProcessIdentity = requireProcessIdentity(process.pid, 'Agent Host');
      const engineProcessIdentity = requireProcessIdentity(Number(child.pid), 'OpenCode');
      await writeProcessManifest(this.#storeRoot, {
        schemaVersion: OPENCODE_PROCESS_MANIFEST_SCHEMA_VERSION,
        hostPid: process.pid,
        hostProcessIdentity,
        enginePid: Number(child.pid),
        engineProcessIdentity,
        processNonce,
        runtimeVersion: verified.manifest.runtimeVersion,
      });
    } catch (error) {
      handshakeAbort.abort(error);
      this.#child = null;
      this.#processNonce = null;
      await this.#stopChild(child);
      throw new OpenCodeEngineError(
        'OPENCODE_PROCESS_START_FAILED',
        'OpenCode process ownership manifest could not be written',
        { cause: error },
      );
    }
    child.stdout?.resume();
    child.stderr?.resume();
    child.once('exit', (code, signal) => {
      if (this.#child !== child) return;
      this.#child = null;
      this.#running = null;
      if (this.#processNonce === processNonce) this.#processNonce = null;
      void removeProcessManifest(this.#storeRoot, processNonce);
      if (!this.#intentionalStop) {
        this.#onExit(new OpenCodeEngineError(
          'OPENCODE_PROCESS_EXITED',
          `OpenCode process exited unexpectedly (code=${code ?? '-'}, signal=${signal ?? '-'})`,
        ));
      }
    });

    const origin = `http://127.0.0.1:${port}`;
    const authorization = `Basic ${Buffer.from(`def-engine:${serverPassword}`).toString('base64')}`;
    const runtime: RunningOpenCodeRuntime = {
      epoch: ++this.#epoch,
      origin,
      authorization,
      directory: canonicalDirectory,
      profileRef,
      verified,
      request: (pathname, init = {}) => this.#request(origin, authorization, canonicalDirectory, pathname, init),
    };
    try {
      await this.#waitUntilReady(runtime, child, pluginReady, () => spawnError);
    } catch (error) {
      handshakeAbort.abort(error);
      this.#intentionalStop = true;
      await this.#stopChild(child);
      if (this.#child === child) this.#child = null;
      if (this.#processNonce === processNonce) this.#processNonce = null;
      await removeProcessManifest(this.#storeRoot, processNonce);
      throw new OpenCodeEngineError(
        'OPENCODE_PROCESS_START_FAILED',
        'OpenCode process did not become ready',
        { cause: error },
      );
    }
    this.#running = runtime;
    return runtime;
  }

  async #request(
    origin: string,
    authorization: string,
    directory: string,
    pathname: string,
    init: RequestInit,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', authorization);
    // The WHATWG Headers implementation only accepts ByteString values.  The
    // desktop user-data path can contain Chinese (for example our product
    // name), so follow the OpenCode SDK contract and percent-encode the
    // workspace header; the server decodes it before resolving the instance.
    headers.set('x-opencode-directory', encodeURIComponent(directory));
    headers.set('Accept', headers.get('Accept') ?? 'application/json');
    if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return this.#fetch(new URL(pathname, origin), { ...init, headers });
  }

  async #waitUntilReady(
    runtime: RunningOpenCodeRuntime,
    child: ChildProcess,
    pluginReady: Promise<void>,
    spawnError: () => unknown,
  ): Promise<void> {
    const deadline = Date.now() + this.#startupTimeoutMs;
    let lastError: unknown = null;
    while (Date.now() < deadline) {
      if (spawnError()) throw spawnError();
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error('OpenCode exited before its health endpoint became ready');
      }
      try {
        const response = await runtime.request('/global/health', { signal: AbortSignal.timeout(1_000) });
        if (response.ok) {
          const body = await response.json() as { healthy?: unknown; version?: unknown };
          if (
            body.healthy === true
            && body.version === runtime.verified.manifest.binaryVersion
          ) {
            const toolsResponse = await runtime.request('/experimental/tool/ids', {
              signal: AbortSignal.timeout(2_000),
            });
            if (!toolsResponse.ok) throw new Error('OpenCode Tool registry is unavailable');
            const toolIds = await toolsResponse.json() as unknown;
            if (!Array.isArray(toolIds) || !toolIds.every((value) => typeof value === 'string')) {
              throw new Error('OpenCode Tool registry returned an invalid response');
            }
            for (const [, safeName] of OPENCODE_TOOL_BINDINGS) {
              if (!toolIds.includes(safeName)) throw new Error('OpenCode DEF plugin Tool registry is incomplete');
            }
            await withRuntimeTimeout(pluginReady, 2_000, 'OpenCode DEF plugin handshake timed out');
            return;
          }
        }
        lastError = new Error(`OpenCode health returned HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw lastError ?? new Error('OpenCode health timed out');
  }

  async shutdown(): Promise<void> {
    if (this.#shutdownPromise) return this.#shutdownPromise;
    this.#shutdownPromise = (async () => {
      this.#intentionalStop = true;
      const pending = this.#startPromise;
      if (pending) await pending.catch(() => undefined);
      const child = this.#child;
      const processNonce = this.#processNonce;
      this.#running = null;
      if (child) await this.#stopChild(child);
      if (this.#child === child) this.#child = null;
      if (this.#processNonce === processNonce) this.#processNonce = null;
      if (processNonce) await removeProcessManifest(this.#storeRoot, processNonce);
    })();
    return this.#shutdownPromise;
  }

  async #stopChild(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()));
    child.kill('SIGTERM');
    await Promise.race([
      exited,
      new Promise((resolveDelay) => setTimeout(resolveDelay, this.#stopGraceTimeoutMs)),
    ]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await Promise.race([
        exited,
        new Promise((resolveDelay) => setTimeout(resolveDelay, this.#stopKillTimeoutMs)),
      ]);
    }
    if (!childExited(child)) {
      throw new OpenCodeEngineError(
        'OPENCODE_PROCESS_STOP_FAILED',
        `OpenCode process ${child.pid ?? '-'} did not exit after SIGKILL`,
      );
    }
  }
}

function childExited(child: ChildProcess): boolean {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  const pid = child.pid;
  if (!Number.isSafeInteger(pid) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return false;
  } catch (error) {
    if (isErrno(error, 'ESRCH')) return true;
    if (isErrno(error, 'EPERM')) return false;
    throw error;
  }
}

function requireProcessIdentity(pid: number, label: string): string {
  const identity = inspectProcessIdentity(pid);
  if (identity) return identity;
  throw new OpenCodeEngineError(
    'OPENCODE_PROCESS_START_FAILED',
    `${label} process identity could not be captured`,
  );
}

function inspectProcessIdentity(pid: number): string | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  const result = process.platform === 'win32'
    ? spawnSync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$p = Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\" | Select-Object -First 1 CreationDate,ExecutablePath; if ($null -ne $p) { $p | ConvertTo-Json -Compress }`,
    ], { encoding: 'utf8', timeout: 3_000, windowsHide: true })
    : spawnSync('ps', [
      '-p', String(pid),
      '-o', 'lstart=',
      '-o', 'comm=',
    ], { encoding: 'utf8', timeout: 3_000, windowsHide: true });
  if (result.error) {
    throw new OpenCodeEngineError(
      'OPENCODE_PROCESS_START_FAILED',
      'Process identity inspection failed',
      { cause: result.error },
    );
  }
  const normalized = String(result.stdout ?? '').trim().replace(/\s+/gu, ' ');
  if (!normalized) return null;
  return `sha256:${createHash('sha256').update(normalized).digest('hex')}`;
}

interface OpenCodeProcessManifest {
  readonly schemaVersion: typeof OPENCODE_PROCESS_MANIFEST_SCHEMA_VERSION;
  readonly hostPid: number;
  readonly hostProcessIdentity: string;
  readonly enginePid: number;
  readonly engineProcessIdentity: string;
  readonly processNonce: string;
  readonly runtimeVersion: string;
}

async function writeProcessManifest(storeRoot: string, manifest: OpenCodeProcessManifest): Promise<void> {
  await mkdir(storeRoot, { recursive: true, mode: 0o700 });
  const target = join(storeRoot, 'process.json');
  const temporary = join(storeRoot, `.process-${manifest.processNonce}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(manifest)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function removeProcessManifest(storeRoot: string, processNonce: string): Promise<void> {
  const target = join(storeRoot, 'process.json');
  try {
    const value = JSON.parse(await readFile(target, 'utf8')) as { processNonce?: unknown };
    if (value.processNonce === processNonce) await rm(target, { force: true });
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) return;
  }
}

export async function verifyOpenCodeRuntime(runtimeRoot: string): Promise<VerifiedOpenCodeRuntime> {
  const requestedRoot = resolve(runtimeRoot);
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(await readFile(join(requestedRoot, 'manifest.json'), 'utf8'));
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      throw new OpenCodeEngineError('OPENCODE_RUNTIME_MISSING', 'OpenCode runtime manifest is missing');
    }
    throw new OpenCodeEngineError('OPENCODE_RUNTIME_INVALID', 'OpenCode runtime manifest is invalid');
  }
  const root = await realpath(requestedRoot).catch(() => requestedRoot);
  const manifest = parseManifest(manifestValue);
  if (manifest.target !== runtimeTarget()) {
    throw new OpenCodeEngineError(
      'OPENCODE_RUNTIME_UNSUPPORTED',
      `OpenCode runtime target ${manifest.target} does not match this device`,
    );
  }
  const binaryPath = portableChild(root, manifest.binary, 'binary');
  const pluginPath = portableChild(root, manifest.plugin, 'plugin');
  const licensePath = portableChild(root, manifest.license, 'license');
  await verifyContainedFile(root, binaryPath, 'binary', true);
  const binaryCode = manifest.target.startsWith('darwin-')
    ? await inspectDarwinBinaryCode(binaryPath)
    : await inspectBinaryCode(binaryPath);
  if (
    binaryCode.bytes !== manifest.binaryCodeBytes
    || binaryCode.sha256 !== manifest.binaryCodeSha256
  ) {
    throw new OpenCodeEngineError('OPENCODE_RUNTIME_INVALID', 'OpenCode runtime binary code checksum is invalid');
  }
  await verifyFile(root, pluginPath, undefined, manifest.pluginSha256, 'plugin');
  await verifyFile(root, licensePath, manifest.licenseBytes, manifest.licenseSha256, 'license');
  const actualBinaryVersion = await readBinaryVersion(binaryPath);
  if (actualBinaryVersion !== manifest.binaryVersion) {
    throw new OpenCodeEngineError('OPENCODE_RUNTIME_INVALID', 'OpenCode runtime binary version is invalid');
  }
  return { root, manifest, binaryPath, pluginPath, licensePath };
}

function parseManifest(value: unknown): OpenCodeRuntimeManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidManifest();
  const manifest = value as Record<string, unknown>;
  const expected = [
    'binary', 'binaryCodeBytes', 'binaryCodeSha256', 'binaryVersion', 'license', 'licenseBytes',
    'engineKind', 'licenseSha256', 'name', 'plugin', 'pluginSha256', 'runtimeVersion', 'schemaVersion', 'sourceRef', 'storeSchemaVersion',
    'target', 'upstreamVersion',
  ].sort();
  const keys = Object.keys(manifest).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw invalidManifest();
  }
  if (
    manifest.schemaVersion !== OPENCODE_RUNTIME_MANIFEST_SCHEMA_VERSION
    || manifest.name !== 'def-opencode-engine-runtime'
    || manifest.engineKind !== 'opencode'
    || !positiveInteger(manifest.storeSchemaVersion)
    || !positiveInteger(manifest.binaryCodeBytes)
    || !positiveInteger(manifest.licenseBytes)
    || manifest.upstreamVersion !== OPENCODE_UPSTREAM_VERSION
    || manifest.runtimeVersion !== OPENCODE_RUNTIME_VERSION
    || manifest.binaryVersion !== OPENCODE_BINARY_VERSION
    || manifest.sourceRef !== OPENCODE_SOURCE_REF
    || manifest.storeSchemaVersion !== 1
  ) throw invalidManifest();
  for (const key of [
    'upstreamVersion', 'runtimeVersion', 'target', 'sourceRef', 'binary', 'binaryVersion',
    'binaryCodeSha256', 'plugin', 'pluginSha256', 'license', 'licenseSha256',
  ]) {
    if (typeof manifest[key] !== 'string' || !manifest[key].trim()) throw invalidManifest();
  }
  if (
    !isSha256(manifest.binaryCodeSha256 as string)
    || !isSha256(manifest.pluginSha256 as string)
    || !isSha256(manifest.licenseSha256 as string)
  ) {
    throw invalidManifest();
  }
  return manifest as unknown as OpenCodeRuntimeManifest;
}

function invalidManifest(): OpenCodeEngineError {
  return new OpenCodeEngineError('OPENCODE_RUNTIME_INVALID', 'OpenCode runtime manifest schema is invalid');
}

async function verifyFile(
  root: string,
  filePath: string,
  expectedBytes: number | undefined,
  expectedSha256: string,
  label: string,
  executable = false,
): Promise<void> {
  const info = await verifyContainedFile(root, filePath, label, executable);
  if (expectedBytes !== undefined && info.size !== expectedBytes) {
    throw new OpenCodeEngineError('OPENCODE_RUNTIME_INVALID', `OpenCode runtime ${label} size is invalid`);
  }
  const digest = createHash('sha256').update(await readFile(filePath)).digest('hex');
  if (digest !== expectedSha256) {
    throw new OpenCodeEngineError('OPENCODE_RUNTIME_INVALID', `OpenCode runtime ${label} checksum is invalid`);
  }
}

async function verifyContainedFile(
  root: string,
  filePath: string,
  label: string,
  executable = false,
): Promise<Awaited<ReturnType<typeof lstat>>> {
  const info = await lstat(filePath).catch(() => null);
  if (!info?.isFile()) {
    throw new OpenCodeEngineError('OPENCODE_RUNTIME_INVALID', `OpenCode runtime ${label} size is invalid`);
  }
  const realFile = await realpath(filePath).catch(() => '');
  const relativeFile = relative(root, realFile);
  if (!realFile || !relativeFile || relativeFile === '..' || relativeFile.startsWith(`..${sep}`) || isAbsolute(relativeFile)) {
    throw new OpenCodeEngineError('OPENCODE_RUNTIME_INVALID', `OpenCode runtime ${label} resolves outside its root`);
  }
  if (executable && process.platform !== 'win32' && (info.mode & 0o111) === 0) {
    throw new OpenCodeEngineError('OPENCODE_RUNTIME_INVALID', 'OpenCode runtime binary is not executable');
  }
  return info;
}

async function inspectDarwinBinaryCode(binaryPath: string): Promise<{ readonly bytes: number; readonly sha256: string }> {
  if (process.platform !== 'darwin') {
    throw new OpenCodeEngineError('OPENCODE_RUNTIME_UNSUPPORTED', 'OpenCode darwin runtime requires macOS');
  }
  runCodeSign(['--verify', '--strict', '--verbose=2', binaryPath], 'signature is invalid');
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'def-opencode-code-'));
  const unsignedPath = join(temporaryRoot, 'opencode');
  try {
    await copyFile(binaryPath, unsignedPath);
    runCodeSign(['--remove-signature', unsignedPath], 'signature could not be normalized');
    const info = await lstat(unsignedPath);
    const sha256 = createHash('sha256').update(await readFile(unsignedPath)).digest('hex');
    return { bytes: info.size, sha256 };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function inspectBinaryCode(binaryPath: string): Promise<{ readonly bytes: number; readonly sha256: string }> {
  const info = await lstat(binaryPath);
  return {
    bytes: info.size,
    sha256: createHash('sha256').update(await readFile(binaryPath)).digest('hex'),
  };
}

function runCodeSign(args: readonly string[], message: string): void {
  const result = spawnSync('/usr/bin/codesign', [...args], {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 64 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    throw new OpenCodeEngineError('OPENCODE_RUNTIME_INVALID', `OpenCode runtime binary ${message}`);
  }
}

async function readBinaryVersion(binaryPath: string): Promise<string> {
  return new Promise<string>((resolveVersion, rejectVersion) => {
    const child = spawn(binaryPath, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderrBytes = 0;
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      rejectVersion(new OpenCodeEngineError('OPENCODE_RUNTIME_INVALID', 'OpenCode runtime version check timed out'));
    }, 5_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (Buffer.byteLength(stdout) > 4_096) child.kill('SIGKILL');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 4_096) child.kill('SIGKILL');
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      rejectVersion(new OpenCodeEngineError('OPENCODE_RUNTIME_INVALID', 'OpenCode runtime version check failed', { cause: error }));
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0 || Buffer.byteLength(stdout) > 4_096) {
        rejectVersion(new OpenCodeEngineError('OPENCODE_RUNTIME_INVALID', 'OpenCode runtime version check failed'));
        return;
      }
      resolveVersion(stdout.replace(/\r\n/gu, '\n').replace(/\n+$/gu, ''));
    });
  });
}

function portableChild(root: string, candidate: string, label: string): string {
  if (
    !candidate
    || isAbsolute(candidate)
    || /^[A-Za-z]:[\\/]/u.test(candidate)
    || candidate.split(/[\\/]/u).includes('..')
  ) throw new OpenCodeEngineError('OPENCODE_RUNTIME_INVALID', `OpenCode runtime ${label} path is invalid`);
  const resolved = resolve(root, candidate);
  const child = relative(root, resolved);
  if (!child || child.startsWith(`..${sep}`) || child === '..' || isAbsolute(child)) {
    throw new OpenCodeEngineError('OPENCODE_RUNTIME_INVALID', `OpenCode runtime ${label} escapes its root`);
  }
  return resolved;
}

async function prepareStore(runtimeHome: string, directory: string): Promise<void> {
  await Promise.all([
    mkdir(join(runtimeHome, 'data'), { recursive: true, mode: 0o700 }),
    mkdir(join(runtimeHome, 'state'), { recursive: true, mode: 0o700 }),
    mkdir(join(runtimeHome, 'cache'), { recursive: true, mode: 0o700 }),
    mkdir(join(runtimeHome, 'config'), { recursive: true, mode: 0o700 }),
    mkdir(join(runtimeHome, 'db'), { recursive: true, mode: 0o700 }),
    mkdir(directory, { recursive: true, mode: 0o700 }),
  ]);
}

function buildRuntimeEnvironment(input: {
  readonly runtimeHome: string;
  readonly directory: string;
  readonly serverPassword: string;
  readonly bridgeOrigin: string;
  readonly bridgeToken: string;
  readonly processNonce: string;
  readonly runtimeVersion: string;
  readonly profile: OpenCodeProviderProfile;
  readonly pluginPath: string;
}): NodeJS.ProcessEnv {
  const dataHome = join(input.runtimeHome, 'data');
  const stateHome = join(input.runtimeHome, 'state');
  const cacheHome = join(input.runtimeHome, 'cache');
  const configHome = join(input.runtimeHome, 'config');
  const dbPath = join(input.runtimeHome, 'db', 'opencode.db');
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    TMPDIR: process.env.TMPDIR,
    SSL_CERT_FILE: process.env.SSL_CERT_FILE,
    SSL_CERT_DIR: process.env.SSL_CERT_DIR,
    NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS,
    HOME: input.runtimeHome,
    XDG_DATA_HOME: dataHome,
    XDG_STATE_HOME: stateHome,
    XDG_CACHE_HOME: cacheHome,
    XDG_CONFIG_HOME: configHome,
    OPENCODE_DB: dbPath,
    OPENCODE_SERVER_USERNAME: 'def-engine',
    OPENCODE_SERVER_PASSWORD: input.serverPassword,
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_DISABLE_SHARE: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_MODELS_FETCH: '1',
    OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
    OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
    OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
    OPENCODE_DISABLE_EMBEDDED_WEB_UI: '1',
    OPENCODE_ENABLE_PARALLEL: '0',
    OPENCODE_CLIENT: 'def-engine',
    OPENCODE_CONFIG_CONTENT: JSON.stringify(buildOpenCodeConfig(input.profile, input.pluginPath)),
    DEF_OPENCODE_TOOL_BRIDGE_URL: input.bridgeOrigin,
    DEF_OPENCODE_TOOL_BRIDGE_TOKEN: input.bridgeToken,
    DEF_OPENCODE_PROCESS_NONCE: input.processNonce,
    DEF_OPENCODE_RUNTIME_VERSION: input.runtimeVersion,
  };
}

function buildOpenCodeConfig(profile: OpenCodeProviderProfile, pluginPath: string): Record<string, unknown> {
  // Keep the stable provider identity from the DEF profile. The pinned
  // OpenCode runtime uses it for provider-specific request compatibility
  // (notably DeepSeek thinking-mode tool calls); flattening every profile to
  // an internal OpenAI-compatible id silently bypasses those adapters.
  const modelRef = `${profile.providerId}/${profile.modelId}`;
  const deny = {
    bash: 'deny', edit: 'deny', read: 'deny', write: 'deny', grep: 'deny', glob: 'deny',
    task: 'deny', todowrite: 'deny', webfetch: 'deny', websearch: 'deny', lsp: 'deny',
    question: 'deny', skill: 'deny', external_directory: 'deny', plan_enter: 'deny', plan_exit: 'deny',
    ...Object.fromEntries(OPENCODE_TOOL_BINDINGS.map(([, safeName]) => [safeName, 'allow'])),
  };
  return {
    model: modelRef,
    default_agent: 'def-engine',
    autoupdate: false,
    plugin: [pathToFileURL(pluginPath).href],
    permission: deny,
    provider: {
      [profile.providerId]: {
        name: profile.displayName,
        npm: '@ai-sdk/openai-compatible',
        options: {
          apiKey: profile.apiKey,
          baseURL: profile.baseUrl,
          ...(profile.headers ? { headers: profile.headers } : {}),
        },
        models: {
          [profile.modelId]: {
            id: profile.modelId,
            name: profile.modelId,
            status: 'active',
            tool_call: true,
            temperature: true,
            limit: {
              context: profile.contextLimit ?? 128_000,
              output: profile.outputLimit ?? 4_096,
            },
          },
        },
      },
    },
    agent: {
      'def-engine': {
        mode: 'primary',
        model: modelRef,
        steps: 16,
        prompt: DEF_OPENCODE_AGENT_PROMPT,
        permission: deny,
      },
    },
  };
}

async function reserveLoopbackPort(): Promise<number> {
  return new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Cannot reserve an OpenCode loopback port'));
        return;
      }
      const { port } = address;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

function runtimeTarget(): string {
  const platform = process.platform === 'win32' ? 'win32' : process.platform;
  return `${platform}-${process.arch}`;
}

function unavailable(code: string, message: string): EngineHealth {
  return { status: 'unavailable', kind: 'opencode', code, message };
}

function publicRuntimeMessage(error: unknown): string {
  if (error instanceof OpenCodeEngineError) return error.message;
  return `OpenCode runtime validation failed: ${messageOf(error)}`;
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

function isErrno(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

async function withRuntimeTimeout<Value>(
  promise: Promise<Value>,
  milliseconds: number,
  message: string,
): Promise<Value> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<Value>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
