import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateMainWorkbenchCommand } from '../src/agentKernel/mainWorkbench/commandSchemaRuntime.mjs';

const projectRoot = process.cwd();
const fixtureRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'def-opencode-host-retirement-')));
const port = 19900 + Math.floor(Math.random() * 300);
const baseUrl = `http://127.0.0.1:${port}`;
const workspaceRoot = path.join(fixtureRoot, 'dmg-end-field', 'def-agent-workspace');

const child = spawn(process.execPath, ['agent/server/def-agent-server.cjs'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    TMPDIR: fixtureRoot,
    DEF_AGENT_PORT: String(port),
    DEF_REST_BASE_URL: `http://127.0.0.1:${port + 1000}`,
    DEF_OPENCODE_PORT: String(port + 2000),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let childOutput = '';
child.stdout.on('data', (chunk) => { childOutput += chunk.toString(); });
child.stderr.on('data', (chunk) => { childOutput += chunk.toString(); });

async function waitForReady() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch {
      // Starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for host-retirement sidecar.\n${childOutput}`);
}

async function request(pathname, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { payload = text; }
  return { response, payload };
}

function source(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

try {
  assert.equal(fs.existsSync(path.join(projectRoot, 'src/components/AiCliPage.tsx')), false);
  assert.doesNotMatch(source('src/App.tsx'), /AiCliPage|isAiCliPath/);
  assert.doesNotMatch(source('src/utils/appRoute.ts'), /aiCli:\s*['"]\/ai-cli/);
  assert.doesNotMatch(source('src/components/WorkbenchFrame/WorkbenchFrame.tsx'), />AI CLI</);
  assert.doesNotMatch(source('electron/main.cjs'), /\/def-agent\/chat/);
  assert.doesNotMatch(source('agent/dev-agent.cjs'), /\/def-agent\/chat/);
  assert.doesNotMatch(source('agent/server/def-agent-server.cjs'), /\/api\/chat/);
  assert.doesNotMatch(source('public/shell/index.html'), /测试 hi/);
  assert.match(source('src/aiCli/aiCliRestAdapter.ts'), /\/api\/ai-cli\/run/);

  assert.equal(validateMainWorkbenchCommand({ op: 'openWorkbenchPage', page: 'aiCli' }).ok, false);
  assert.equal(validateMainWorkbenchCommand({ op: 'openWorkbenchPage', page: 'unknown-page' }).ok, false);
  assert.equal(validateMainWorkbenchCommand({ op: 'openWorkbenchPage', page: 'canvas' }).ok, true);

  await waitForReady();

  for (const [host, status, code] of [
    ['ai-cli', 410, 'DEF_OPENCODE_HOST_DISABLED'],
    [undefined, 400, 'DEF_OPENCODE_HOST_INVALID'],
    ['unknown', 400, 'DEF_OPENCODE_HOST_INVALID'],
  ]) {
    const body = host === undefined ? {} : { host };
    const result = await request('/api/native/session', { method: 'POST', body });
    assert.equal(result.response.status, status, JSON.stringify(result.payload));
    assert.equal(result.payload.code, code, JSON.stringify(result.payload));
  }
  const legacyChat = await request('/api/chat', { method: 'POST', body: { message: 'hi' } });
  assert.equal(legacyChat.response.status, 404, JSON.stringify(legacyChat.payload));
  assert.equal(fs.existsSync(path.join(workspaceRoot, 'sessions')), false, 'rejected hosts must not create a managed session directory');

  const sessionID = 'ses_retired_ai_cli_contract';
  const aiCliDirectory = path.join(workspaceRoot, 'sessions', 'ai-cli', 'historical-session');
  fs.mkdirSync(aiCliDirectory, { recursive: true });
  fs.writeFileSync(path.join(aiCliDirectory, '.def-session.json'), `${JSON.stringify({
    schemaVersion: 4,
    sessionID,
    directory: aiCliDirectory,
    agent: 'def-operator',
    skillId: 'operator',
    host: 'ai-cli',
    createdAt: Date.now(),
  }, null, 2)}\n`, 'utf8');

  const recover = await request(`/api/native/session/${encodeURIComponent(sessionID)}/recover`, {
    method: 'POST',
    body: { directory: aiCliDirectory },
  });
  assert.equal(recover.response.status, 410, JSON.stringify(recover.payload));
  assert.equal(recover.payload.code, 'DEF_OPENCODE_HOST_DISABLED');

  const bootstrap = await request(`/api/native/bootstrap?sessionID=${encodeURIComponent(sessionID)}&directory=${encodeURIComponent(aiCliDirectory)}`);
  assert.equal(bootstrap.response.status, 410, JSON.stringify(bootstrap.payload));
  assert.equal(bootstrap.payload.code, 'DEF_OPENCODE_HOST_DISABLED');

  const prompt = await request(`/api/native/session/${encodeURIComponent(sessionID)}/interop-prompt`, {
    method: 'POST',
    body: { correlation: { sessionId: sessionID, clientTurnId: 'retired-host-turn' }, text: 'hi' },
  });
  assert.equal(prompt.response.status, 410, JSON.stringify(prompt.payload));
  assert.equal(prompt.payload.code, 'DEF_OPENCODE_HOST_DISABLED');

  const proxy = await request(`/session/${encodeURIComponent(sessionID)}/message?directory=${encodeURIComponent(aiCliDirectory)}`);
  assert.equal(proxy.response.status, 410, JSON.stringify(proxy.payload));
  assert.equal(proxy.payload.code, 'DEF_OPENCODE_HOST_DISABLED');

  const directorySlug = Buffer.from(aiCliDirectory).toString('base64url');
  const ui = await request(`/${directorySlug}/session/${encodeURIComponent(sessionID)}`, {
    headers: { accept: 'text/html' },
  });
  assert.equal(ui.response.status, 410, JSON.stringify(ui.payload));
  assert.equal(ui.payload.code, 'DEF_OPENCODE_HOST_DISABLED');

  const bareUi = await request('/', { headers: { accept: 'text/html' } });
  assert.equal(bareUi.response.status, 404, JSON.stringify(bareUi.payload));

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'frontend-route-retired',
      'legacy-chat-ingress-retired',
      'programmatic-route-allowlist',
      'invalid-host-zero-side-effect',
      'historical-ai-cli-recover-denied',
      'historical-ai-cli-bootstrap-denied',
      'historical-ai-cli-prompt-denied',
      'historical-ai-cli-proxy-denied',
      'historical-ai-cli-ui-denied',
      'bare-ui-denied',
      'shared-ai-rest-retained',
    ],
  }));
} finally {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
