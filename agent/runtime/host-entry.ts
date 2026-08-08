import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BrowserConsumerRegistry } from '../host/browser-consumer-registry.ts';
import { DefAgentHost } from '../host/def-agent-host.ts';
import { DefAgentInteropRoute } from '../host/def-agent-interop.ts';
import { DefAgentHostHttpServer } from '../host/http-server.ts';
import { AgentUiGateway, type AgentUiGatewayPort } from '../host/agent-ui-gateway.ts';
import { ConversationProjector } from '../host/conversation-projector.ts';
import { RemoteBrowserProductGateway } from '../host/remote-browser-product-gateway.ts';
import { createFileProductCommandStore } from '../host/product-command-store.ts';
import { createFileDefAgentSessionStore } from '../host/session-store.ts';
import { AgentTokenAuthority } from '../host/token-authority.ts';
import type { AgentUiCapabilityClaims } from '../host/token-authority.ts';
import { PHASE6_INTERACTIVE_HARNESS_CATALOG } from '../core/harness/catalog.ts';
import { DefHarnessManager } from '../core/harness/manager.ts';
import { DefProductToolRegistry } from '../core/tools/interactive-workbench.ts';
import { DefRuntimeEngineAdapter } from '../engines/def-runtime/adapter.ts';
import { FileProviderProfileSource } from '../engines/def-runtime/profile.ts';
import type {
  AgentHostHealth,
  DefSessionId,
  EngineHealth,
} from '../core/contracts/index.ts';

const hostToken = requiredEnv('DEF_AGENT_HOST_TOKEN');
const browserOrigin = requiredEnv('DEF_AGENT_BROWSER_ORIGIN');
const readyFile = requiredEnv('DEF_AGENT_READY_FILE');
const engineStoreRoot = requiredEnv('DEF_AGENT_ENGINE_STORE_ROOT');
const sessionStoreRoot = requiredEnv('DEF_AGENT_SESSION_STORE_ROOT');
const productCommandStoreRoot = requiredEnv('DEF_AGENT_PRODUCT_COMMAND_STORE_ROOT');
const engineProfilePath = requiredEnv('DEF_AGENT_ENGINE_PROFILE_PATH');
const nativeUiRoot = requiredEnv('DEF_AGENT_NATIVE_UI_ROOT');
const engineDefaultProfileRef = process.env.DEF_AGENT_ENGINE_DEFAULT_PROFILE_REF?.trim() || 'default';
const interopEnabled = process.env.DEF_AGENT_INTEROP_ENABLED === '1';
const parentPid = requiredPidEnv('DEF_AGENT_PARENT_PID');
const FORCED_SHUTDOWN_TIMEOUT_MS = 8_000;

const engine = new DefRuntimeEngineAdapter({
  storeRoot: engineStoreRoot,
  profileSource: new FileProviderProfileSource(engineProfilePath),
  probeProfileRef: engineDefaultProfileRef,
});
let engineState: AgentHostHealth['engine'] = {
  kind: 'def-runtime',
  state: 'pending',
  reason: 'DEF Runtime 正在检查模型配置',
};
const tokens = new AgentTokenAuthority();
let host: DefAgentHost;
const consumers = new BrowserConsumerRegistry({
  onConsumerLost: () => {
    const active = host.getActiveIds().defTurnId;
    if (active) void host.abortTurn(active, 'BROWSER_CONSUMER_LOST');
  },
});
const gateway = new RemoteBrowserProductGateway(consumers, {
  commandStore: createFileProductCommandStore(productCommandStoreRoot),
  onTerminalResult: (view) => {
    if (view.deliveryMode !== 'reconcile' || !view.result) return;
    host?.recordReconciledProductCommandResult(view.command, view.result);
  },
});
const toolRegistry = new DefProductToolRegistry();
const harnessManager = new DefHarnessManager({
  catalog: PHASE6_INTERACTIVE_HARNESS_CATALOG,
  resolveToolDescriptor: (name) => toolRegistry.resolveDescriptor(name),
});
const sessionStore = createFileDefAgentSessionStore({ root: sessionStoreRoot });
host = new DefAgentHost({
  engine,
  productGateway: gateway,
  sessionStore,
  harnessManager,
  toolRegistry,
  requireConsumer: () => {
    consumers.requireActive();
  },
});
const conversation = new ConversationProjector({
  runtime: engine.transcriptSource,
  host: sessionStore,
});
const uiPort: AgentUiGatewayPort = {
  listSessions: (binding) => host.listSessions(binding),
  readSession: (defSessionId, binding) => host.readSession(defSessionId, binding),
  createSession: (input) => host.createSession(input),
  startTurn: (input) => host.startHarnessTurn(input),
  stopTurn: async (input) => {
    host.readSession(input.defSessionId, input.binding);
    await host.abortTurn(input.defTurnId, 'USER_STOPPED', input.binding);
  },
  archiveSession: (defSessionId, binding) => host.archiveSession(defSessionId, binding),
  deleteSession: (defSessionId, binding) => host.deleteSession(defSessionId, binding),
  getSnapshot: (defSessionId) => conversation.getSnapshot(defSessionId),
  subscribe: (defSessionId, cursor, signal) => conversation.subscribe(defSessionId, cursor, signal),
  listPendingInteractions: (binding) => host.listPendingInteractions(binding),
  resolveInteraction: (interactionId, input, binding) => host.resolveInteraction(
    interactionId,
    input,
    binding,
  ),
};
const agentUi = new AgentUiGateway({
  uiRoot: nativeUiRoot,
  browserOrigin,
  port: uiPort,
  tokens,
  consumers,
  diagnostic: (message) => console.error(`[def-agent-ui] ${message}`),
});
const nativeUi = {
  listen: (port = 0) => agentUi.listen(port),
  async launch(defSessionId: DefSessionId, claims: AgentUiCapabilityClaims) {
    const consumer = consumers.requireActive(claims);
    host.readSession(defSessionId, consumer.binding);
    const url = new URL('/agent-ui/', agentUi.origin);
    url.searchParams.set('apiOrigin', agentUi.origin);
    url.searchParams.set('browserOrigin', browserOrigin);
    url.searchParams.set('defSessionId', defSessionId);
    return { src: url.toString(), defSessionId };
  },
  async restoreSession(defSessionId: DefSessionId, claims: AgentUiCapabilityClaims) {
    const consumer = consumers.requireActive(claims);
    return host.restoreSession(defSessionId, consumer.binding);
  },
  stop: () => agentUi.stop(),
};
const interop = new DefAgentInteropRoute({
  host,
  consumers,
  gateway,
  engine: () => engineState,
  profile: interopEnabled ? 'development' : 'release',
  enabled: interopEnabled,
  diagnostic: (message) => console.error(`[def-agent-interop] ${message}`),
});

let shuttingDown = false;
const parentWatch = setInterval(() => {
  if (!processAlive(parentPid)) void shutdown(0);
}, 1_000);
parentWatch.unref();
const runtime = new DefAgentHostHttpServer({
  hostToken,
  browserOrigin,
  host,
  tokens,
  consumers,
  gateway,
  interop,
  nativeUi,
  engine: () => engineState,
  diagnostic: (message) => console.error(`[def-agent-host] ${message}`),
  onShutdownRequested: () => {
    setImmediate(() => void shutdown(0));
  },
});

process.once('SIGTERM', () => void shutdown(0));
process.once('SIGINT', () => void shutdown(0));
process.on('uncaughtException', (error) => {
  console.error('[def-agent-host] uncaught exception', error);
  void shutdown(1);
});
process.on('unhandledRejection', (error) => {
  console.error('[def-agent-host] unhandled rejection', error);
  void shutdown(1);
});

void startRuntime().catch((error: unknown) => {
  console.error('[def-agent-host] startup failed', error);
  void shutdown(1);
});

async function startRuntime(): Promise<void> {
  engineState = projectEngineHealth(await engine.probe());
  await host.initialize();
  await nativeUi.listen(0);
  const port = await runtime.listen(0);
  await writeReadyManifest({
    service: 'def-agent-host',
    protocolVersion: 2,
    runtimeSchemaVersion: 1,
    pid: process.pid,
    host: '127.0.0.1',
    port,
    healthPath: '/internal/health',
    startedAt: new Date().toISOString(),
  });
}

function projectEngineHealth(health: EngineHealth): AgentHostHealth['engine'] {
  if (health.status === 'ready') return { kind: health.kind, state: 'ready' };
  return { kind: health.kind, state: 'unavailable', reason: health.message };
}

async function shutdown(exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(parentWatch);
  const forcedExit = setTimeout(() => {
    process.exit(exitCode === 0 ? 1 : exitCode);
  }, FORCED_SHUTDOWN_TIMEOUT_MS);
  forcedExit.unref();
  let stoppedCleanly = false;
  let finalExitCode = exitCode;
  try {
    await runtime.stop();
    stoppedCleanly = true;
  } catch (error) {
    finalExitCode = 1;
    console.error('[def-agent-host] shutdown failed; forcing process exit', error);
  } finally {
    await rm(readyFile, { force: true }).catch(() => undefined);
    process.exitCode = finalExitCode;
    if (stoppedCleanly) clearTimeout(forcedExit);
  }
}

async function writeReadyManifest(value: unknown): Promise<void> {
  await mkdir(dirname(readyFile), { recursive: true });
  const temporary = `${readyFile}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, readyFile);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredPidEnv(name: string): number {
  const value = Number(requiredEnv(name));
  if (!Number.isSafeInteger(value) || value <= 0 || value === process.pid) {
    throw new Error(`${name} must identify the owning parent process`);
  }
  return value;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return true;
    return false;
  }
}
