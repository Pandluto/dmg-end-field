import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';

const modelId = 'def-ui-e2e-model';
let requestSequence = 0;

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    response.statusCode = 500;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }));
  });
});

async function handleRequest(request, response) {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
    response.statusCode = 404;
    response.end();
    return;
  }

  const body = await readJson(request);
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const toolNames = tools
    .map((tool) => tool?.function?.name)
    .filter((name) => typeof name === 'string');
  const latestUserMessage = [...(Array.isArray(body.messages) ? body.messages : [])]
    .reverse()
    .find((message) => message?.role === 'user')?.content || '';

  response.statusCode = 200;
  response.setHeader('content-type', 'text/event-stream; charset=utf-8');
  response.setHeader('cache-control', 'no-cache');
  response.setHeader('connection', 'keep-alive');

  if (String(latestUserMessage).includes('[STOP_TEST]')) {
    const timer = setTimeout(() => writeText(response, '停止测试的延迟回复不应显示。'), 30_000);
    request.once('close', () => clearTimeout(timer));
    return;
  }

  if (toolNames.includes('def_harness_route')) {
    const operation = String(latestUserMessage).includes('[QUESTION_TEST]')
      ? 'ask'
      : String(latestUserMessage).includes('[MUTATION_TEST]')
        ? 'apply'
        : 'inspect';
    writeToolCall(response, 'def_harness_route', {
      businessId: 'selection',
      operation,
    });
    return;
  }

  const readableTool = toolNames.find((name) => name !== 'def_harness_route');
  if (readableTool) {
    if (readableTool === 'def_user_ask') {
      writeToolCall(response, readableTool, {
        prompt: '请选择 UI 端到端测试答案',
        options: ['甲', '乙'],
      });
    } else if (readableTool === 'def_team_selection_apply') {
      writeToolCall(response, readableTool, {
        characterNames: ['洛茜'],
        nodeTitle: '调整阵容：仅保留洛茜',
        nodeDescription: '将当前队伍调整为仅保留洛茜，并创建经用户批准的水平工作节点。',
        openCanvas: true,
      });
    } else {
      writeToolCall(response, readableTool, {});
    }
    return;
  }

  const finalText = String(latestUserMessage).includes('[QUESTION_TEST]')
    ? 'UI 端到端验证完成：问题回答已返回 DEF Agent。'
    : String(latestUserMessage).includes('[MUTATION_TEST]')
      ? 'UI 端到端验证完成：修改审批流程已经结束。'
      : 'UI 端到端验证完成：已通过 DEF 工具读取当前工作台。';
  writeText(response, finalText);
}

function writeToolCall(response, name, input) {
  const index = requestSequence++;
  writeChunk(response, index, {
    role: 'assistant',
    tool_calls: [{
      index: 0,
      id: `call-ui-e2e-${index}`,
      type: 'function',
      function: { name, arguments: JSON.stringify(input) },
    }],
  }, null);
  writeChunk(response, index, {}, 'tool_calls');
  response.end('data: [DONE]\n\n');
}

function writeText(response, text) {
  const index = requestSequence++;
  writeChunk(response, index, { role: 'assistant', content: text }, null);
  writeChunk(response, index, {}, 'stop');
  response.end('data: [DONE]\n\n');
}

function writeChunk(response, index, delta, finishReason) {
  response.write(`data: ${JSON.stringify({
    id: `chatcmpl-ui-e2e-${index}`,
    object: 'chat.completion.chunk',
    created: 1_786_000_000,
    model: modelId,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 2 * 1024 * 1024) throw new Error('Provider request exceeded test limit');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const requestedPort = Number(process.env.DEF_AGENT_UI_STUB_PORT || 0);
if (!Number.isSafeInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535) {
  throw new Error('DEF_AGENT_UI_STUB_PORT must be a valid TCP port');
}

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(requestedPort, '127.0.0.1', resolve);
});

const address = server.address();
if (!address || typeof address === 'string') throw new Error('Provider stub has no TCP port');
const profilePath = String(process.env.DEF_AGENT_UI_PROFILE_PATH || '').trim();
if (profilePath) await writeTestProfile(resolve(profilePath), address.port);
process.stdout.write(`READY ${address.port}${profilePath ? ` PROFILE ${resolve(profilePath)}` : ''}\n`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(() => {
      void (profilePath ? rm(resolve(profilePath), { force: true }) : Promise.resolve())
        .finally(() => process.exit(0));
    });
    server.closeAllConnections();
  });
}

async function writeTestProfile(filePath, port) {
  const document = {
    schemaVersion: 1,
    profiles: [{
      ref: 'default',
      providerId: 'def-ui-e2e',
      displayName: 'DEF UI E2E',
      baseUrl: `http://127.0.0.1:${port}/v1`,
      modelId,
      apiKey: 'def-ui-e2e-local-only',
    }],
  };
  await mkdir(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
