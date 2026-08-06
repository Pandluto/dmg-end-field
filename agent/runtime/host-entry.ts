import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BrowserConsumerRegistry } from '../host/browser-consumer-registry.ts';
import { DefAgentHost } from '../host/def-agent-host.ts';
import { DefAgentHostHttpServer } from '../host/http-server.ts';
import { RemoteBrowserProductGateway } from '../host/remote-browser-product-gateway.ts';
import { AgentTokenAuthority } from '../host/token-authority.ts';
import { DefHarnessManager } from '../core/harness/manager.ts';
import { DefReadToolRegistry } from '../core/tools/read-only-workbench.ts';
import { PendingAgentEngine } from './pending-agent-engine.ts';

const hostToken = requiredEnv('DEF_AGENT_HOST_TOKEN');
const browserOrigin = requiredEnv('DEF_AGENT_BROWSER_ORIGIN');
const readyFile = requiredEnv('DEF_AGENT_READY_FILE');

const engine = new PendingAgentEngine();
const tokens = new AgentTokenAuthority();
let host: DefAgentHost;
const consumers = new BrowserConsumerRegistry({
  onConsumerLost: () => {
    const active = host.getActiveIds().defTurnId;
    if (active) void host.abortTurn(active, 'BROWSER_CONSUMER_LOST');
  },
});
const gateway = new RemoteBrowserProductGateway(consumers);
const toolRegistry = new DefReadToolRegistry();
const harnessManager = new DefHarnessManager({
  resolveToolDescriptor: (name) => toolRegistry.resolveDescriptor(name),
});
host = new DefAgentHost({
  engine,
  productGateway: gateway,
  harnessManager,
  toolRegistry,
  requireConsumer: () => {
    consumers.requireActive();
  },
});

let shuttingDown = false;
const runtime = new DefAgentHostHttpServer({
  hostToken,
  browserOrigin,
  host,
  tokens,
  consumers,
  gateway,
  engine: {
    kind: 'pending',
    state: 'pending',
    reason: 'OpenCode/Pi engine adapter is intentionally deferred to the next phase',
  },
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

async function shutdown(exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await runtime.stop();
    await rm(readyFile, { force: true });
  } finally {
    process.exitCode = exitCode;
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
