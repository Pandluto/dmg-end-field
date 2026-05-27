import { spawn } from 'node:child_process';

const HOST = '127.0.0.1';
const PORT = Number(process.env.AI_CLI_REST_PORT || 17322);
const BASE_URL = `http://${HOST}:${PORT}`;

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20000) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      await delay(250);
    }
  }
  throw new Error('AI CLI REST server did not become healthy');
}

async function request(method, path, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

async function readFirstSseEvent(path) {
  const response = await fetch(`${BASE_URL}${path}`);
  if (!response.ok || !response.body) {
    throw new Error(`SSE request failed: ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const startedAt = Date.now();
  try {
    while (Date.now() - startedAt < 5000) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      text += decoder.decode(value, { stream: true });
      if (text.includes('\n\n')) {
        return text;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  throw new Error('SSE event was not received');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const server = spawn(process.execPath, ['scripts/ai-cli-rest-server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AI_CLI_REST_PORT: String(PORT),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let stderr = '';
server.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

try {
  await waitForHealth();

  const guide = await request('GET', '/api/agent/guide');
  assert(guide.status === 200, `guide status=${guide.status}`);
  assert(guide.payload.ok === true, 'guide should be ok');
  assert(Array.isArray(guide.payload.recommendedFlow), 'guide should include recommended flow');

  const skills = await request('GET', '/api/agent/skills');
  assert(skills.status === 200, `skills status=${skills.status}`);
  assert(skills.payload.ok === true, 'skills should be ok');
  assert(skills.payload.skills?.[0]?.id === 'buff.fill', 'skills should include buff.fill');

  const spec = await request('GET', '/api/ai-cli/spec');
  assert(spec.status === 200, `spec status=${spec.status}`);
  assert(spec.payload.ok === true, 'spec should be ok');
  assert(Array.isArray(spec.payload.endpoints), 'spec should expose endpoints');

  const firstEvent = await readFirstSseEvent('/api/agent/events');
  assert(firstEvent.includes('event: agent.records'), 'SSE should emit agent.records');

  const current = await request('GET', '/api/buff/current');
  assert(current.status === 200, `current status=${current.status}`);
  assert(current.payload.ok === true, 'current should be ok');

  const show = await request('POST', '/api/ai-cli/run', {
    protocolVersion: 1,
    requestId: 'rest-smoke-draft-show',
    command: 'draft.show',
  });
  assert(show.status === 200, `draft.show status=${show.status}`);
  assert(show.payload.ok === true, 'draft.show should be ok');

  const invalidCheck = await request('POST', '/api/buff/fill/check', {
    protocolVersion: 1,
    requestId: 'rest-smoke-invalid',
    draft: {
      id: 'invalid',
      items: [],
    },
  });
  assert(invalidCheck.status === 400, `invalid check status=${invalidCheck.status}`);
  assert(invalidCheck.payload.ok === false, 'invalid check should fail');

  const validDraft = {
    id: 'ai-result',
    name: 'REST smoke result',
    sourceName: 'REST smoke',
    source: 'ai',
    description: 'REST smoke description',
    items: [
      {
        name: '测试 Buff',
        sourceName: '测试来源',
        description: '提高攻击力',
        effects: [
          {
            displayName: '攻击力提升',
            name: '攻击力提升',
            level: '',
            source: 'ai',
            sourceName: '测试来源',
            description: '攻击力+20%',
            condition: '',
            effectKind: 'modifier',
            type: 'atkPercentBoost',
            value: 0.2,
            evidenceText: '攻击力+20%',
            confidence: 0.9,
          },
        ],
      },
    ],
  };

  const validCheck = await request('POST', '/api/buff/fill/check', {
    protocolVersion: 1,
    requestId: 'rest-smoke-valid-check',
    draft: validDraft,
  });
  assert(validCheck.status === 200, `valid check status=${validCheck.status}`);
  assert(validCheck.payload.ok === true, 'valid check should pass');

  const apply = await request('POST', '/api/buff/fill/apply?client=web-cli', {
    protocolVersion: 1,
    requestId: 'rest-smoke-valid-apply',
    draft: validDraft,
  });
  assert(apply.status === 200, `apply status=${apply.status}`);
  assert(apply.payload.ok === true, 'apply should pass for web-cli');
  assert(apply.payload.effects?.writes === true, 'apply should write');

  const logs = await request('GET', '/api/agent/logs');
  assert(logs.status === 200, `agent logs status=${logs.status}`);
  assert(logs.payload.ok === true, 'agent logs should be ok');
  assert(Array.isArray(logs.payload.operationLogs), 'agent logs should be an array');
  assert(logs.payload.operationLogs.length >= 1, 'agent logs should include REST calls');

  const sessions = await request('GET', '/api/agent/sessions');
  assert(sessions.status === 200, `agent sessions status=${sessions.status}`);
  assert(sessions.payload.ok === true, 'agent sessions should be ok');
  assert(Array.isArray(sessions.payload.sessions), 'agent sessions should be an array');

  const records = await request('GET', '/api/agent/records');
  assert(records.status === 200, `agent records status=${records.status}`);
  assert(records.payload.ok === true, 'agent records should be ok');
  assert(Array.isArray(records.payload.operationLogs), 'agent records should include logs');
  assert(Array.isArray(records.payload.sessions), 'agent records should include sessions');

  console.log('[ai-cli-rest-smoke] passed');
} finally {
  server.kill();
  if (stderr.trim()) {
    console.error(stderr.trim());
  }
}
