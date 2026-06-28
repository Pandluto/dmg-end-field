const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-pro';
const OPENCODE_HOST = '127.0.0.1';
const OPENCODE_PORT = Number(process.env.DEF_OPENCODE_PORT || 17445);

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const vendorRoot = path.join(projectRoot, 'agent', 'vendor', 'opencode');
const skillsRoot = path.join(projectRoot, 'agent', 'runtime', 'def', 'skills');
const runtimeLogDir = path.join(projectRoot, '.runtime', 'def-agent');

const skillMap = {
  operator: { agent: 'def-operator', skill: 'operator-fill', label: '填干员' },
  weapon: { agent: 'def-weapon', skill: 'weapon-fill', label: '填武器' },
  equipment: { agent: 'def-equipment', skill: 'equipment-fill', label: '填装备' },
  search: { agent: 'def-search', skill: 'rest-search', label: '查库' },
  repair: { agent: 'def-repair', skill: 'check-error-repair', label: '修复错误' },
  audit: { agent: 'def-audit', skill: 'akedatabase-fill-tool', label: '审计数据' },
};

let opencodeProcess = null;
let opencodeConfigHash = '';
let opencodeReadyUrl = '';
let activeRun = null;

function sanitizeDeepSeekConfig(config = {}) {
  return {
    apiKey: typeof config.apiKey === 'string' ? config.apiKey.trim() : '',
    baseUrl: typeof config.baseUrl === 'string' && config.baseUrl.trim()
      ? config.baseUrl.trim().replace(/\/+$/, '')
      : DEFAULT_DEEPSEEK_BASE_URL,
    model: typeof config.model === 'string' && config.model.trim()
      ? config.model.trim()
      : DEFAULT_DEEPSEEK_MODEL,
  };
}

function summarizeConfig(config = {}) {
  const next = sanitizeDeepSeekConfig(config);
  return {
    provider: 'deepseek',
    baseUrl: next.baseUrl,
    model: next.model,
    apiKeyConfigured: Boolean(next.apiKey),
  };
}

function normalizeThinkingEffort(value) {
  return ['low', 'medium', 'high'].includes(value) ? value : 'medium';
}

function describeThinkingEffort(value) {
  const effort = normalizeThinkingEffort(value);
  if (effort === 'low') {
    return 'Use a quick pass. Prefer concise answers and ask for missing critical inputs.';
  }
  if (effort === 'high') {
    return 'Use a careful pass. Check assumptions, missing conditions, tool results, and repair options before answering. Do not reveal hidden chain-of-thought.';
  }
  return 'Use a balanced pass. Be concise, but reason through incomplete conditions before answering.';
}

function deepSeekReasoningEffort(value) {
  const effort = normalizeThinkingEffort(value);
  if (effort === 'high') return 'max';
  return 'high';
}

function deepSeekRequestOptions(model, thinkingEffort) {
  const normalizedModel = String(model || '').toLowerCase();
  const supportsThinking = normalizedModel.includes('v4') || normalizedModel.includes('reasoner') || normalizedModel.includes('r1');
  if (!supportsThinking) return {};
  return {
    thinking: { type: 'enabled' },
    reasoningEffort: deepSeekReasoningEffort(thinkingEffort),
  };
}

function buildAgentPrompt(skillId) {
  const info = skillMap[skillId] || skillMap.operator;
  return [
    'You are the embedded OpenCode agent inside DEF Shell.',
    'The user is a shallow AI user. Keep replies practical, short, and action-oriented.',
    'Do not expose API keys, hidden configuration, or internal protocol noise.',
    'Do not describe OpenCode, sessions, events, adapters, providers, or runtime details unless the user explicitly asks.',
    'For normal chat, answer in 1-4 short paragraphs. For data-entry work, prefer compact checklists and the smallest useful next step.',
    'When the task lacks required information, ask for the smallest missing input or explain the safe next action.',
    'Do not write application storage directly. Produce proposals or instructions unless a DEF tool explicitly handles the write.',
    `Current DEF capability: ${info.label}.`,
    `For this capability, use OpenCode's native skill tool to load "${info.skill}" when the user asks for data fill, search, audit, repair, or workflow guidance.`,
    'If AKEDatabase historical examples are relevant, load "akedatabase-fill-tool" with the skill tool.',
  ].join('\n');
}

function buildOpenCodeConfig(config, skillId, thinkingEffort) {
  const deepseek = sanitizeDeepSeekConfig(config);
  const modelRef = `deepseek/${deepseek.model}`;
  const requestOptions = deepSeekRequestOptions(deepseek.model, thinkingEffort);
  const agents = {};
  for (const id of Object.keys(skillMap)) {
    const info = skillMap[id];
    agents[info.agent] = {
      model: modelRef,
      mode: 'primary',
      prompt: buildAgentPrompt(id),
      options: requestOptions,
      permission: {
        read: 'allow',
        bash: 'deny',
        edit: 'deny',
        skill: 'allow',
        webfetch: id === 'search' ? 'allow' : 'deny',
      },
      steps: 8,
    };
  }

  return {
    model: modelRef,
    default_agent: (skillMap[skillId] || skillMap.operator).agent,
    disabled_providers: ['opencode'],
    skills: {
      paths: [skillsRoot],
    },
    provider: {
      deepseek: {
        name: 'DeepSeek',
        npm: '@ai-sdk/openai-compatible',
        options: {
          apiKey: deepseek.apiKey,
          baseURL: deepseek.baseUrl,
        },
        models: {
          [deepseek.model]: {
            id: deepseek.model,
            name: deepseek.model,
            status: 'active',
            temperature: true,
            reasoning: deepseek.model.includes('reasoner'),
            tool_call: true,
            limit: {
              context: 64000,
              output: 4096,
            },
          },
        },
      },
    },
    agent: agents,
  };
}

function hashConfig(config) {
  return crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

function appendLog(line) {
  try {
    fs.mkdirSync(runtimeLogDir, { recursive: true });
    fs.appendFileSync(path.join(runtimeLogDir, 'opencode-adapter.log'), `${new Date().toISOString()} ${line}\n`);
  } catch {
    // Logging must not break chat.
  }
}

function processRunning(child) {
  return Boolean(child && child.exitCode === null && !child.killed);
}

function stopOpenCodeProcess() {
  if (!processRunning(opencodeProcess)) {
    opencodeProcess = null;
    opencodeReadyUrl = '';
    return;
  }
  opencodeProcess.kill();
  opencodeProcess = null;
  opencodeReadyUrl = '';
}

function waitForOpenCodeReady(child, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`OpenCode source server startup timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off('data', onStdout);
      child.stderr?.off('data', onStderr);
      child.off('exit', onExit);
      child.off('error', onError);
    };
    const parse = () => {
      for (const line of output.split(/\r?\n/)) {
        if (!line.startsWith('opencode server listening')) continue;
        const match = /on\s+(https?:\/\/[^\s]+)/.exec(line);
        if (match) {
          cleanup();
          resolve(match[1]);
        }
      }
    };
    const onStdout = (chunk) => {
      const text = chunk.toString();
      output += text;
      appendLog(`[stdout] ${text.trim()}`);
      parse();
    };
    const onStderr = (chunk) => {
      const text = chunk.toString();
      output += text;
      appendLog(`[stderr] ${text.trim()}`);
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`OpenCode source server exited before ready: code=${code} signal=${signal}`));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

async function ensureOpenCodeServer(config, skillId, thinkingEffort) {
  const openCodeConfig = buildOpenCodeConfig(config, skillId, thinkingEffort);
  const nextHash = hashConfig(openCodeConfig);
  if (processRunning(opencodeProcess) && opencodeConfigHash === nextHash && opencodeReadyUrl) {
    return opencodeReadyUrl;
  }

  stopOpenCodeProcess();
  fs.mkdirSync(runtimeLogDir, { recursive: true });
  opencodeConfigHash = nextHash;
  opencodeProcess = spawn('bun', [
    'run',
    '--conditions=browser',
    'packages/opencode/src/index.ts',
    'serve',
    `--hostname=${OPENCODE_HOST}`,
    `--port=${OPENCODE_PORT}`,
  ], {
    cwd: vendorRoot,
    env: {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(openCodeConfig),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  opencodeProcess.once('exit', (code, signal) => {
    appendLog(`[exit] code=${code} signal=${signal}`);
    opencodeProcess = null;
    opencodeReadyUrl = '';
  });

  opencodeReadyUrl = await waitForOpenCodeReady(opencodeProcess);
  return opencodeReadyUrl;
}

function requestJson(method, url, body, signal, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const target = new URL(url);
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method,
      headers: {
        Accept: 'application/json',
        ...(payload ? {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(payload),
        } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let parsed = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {
          parsed = raw;
        }
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          const message = typeof parsed?.message === 'string'
            ? parsed.message
            : typeof parsed?.name === 'string'
              ? parsed.name
              : `OpenCode HTTP ${response.statusCode}`;
          reject(new Error(`${message}${typeof parsed === 'string' ? `: ${parsed.slice(0, 300)}` : ''}`));
          return;
        }
        resolve(parsed);
      });
    });
    const timer = setTimeout(() => request.destroy(new Error('OpenCode request timeout')), timeoutMs);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
    if (signal) {
      if (signal.aborted) request.destroy(signal.reason || new Error('aborted'));
      signal.addEventListener('abort', () => request.destroy(signal.reason || new Error('aborted')), { once: true });
    }
    if (payload) request.write(payload);
    request.end();
  });
}

async function subscribeEvents(baseUrl, directory, sink, signal) {
  const url = `${baseUrl}/event?directory=${encodeURIComponent(directory)}`;
  const response = await fetch(url, { signal, headers: { Accept: 'text/event-stream' } });
  if (!response.ok || !response.body) {
    throw new Error(`OpenCode event stream failed: HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame.split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) {
        try {
          sink(JSON.parse(data));
        } catch {
          sink({ type: 'event.parse.failed', properties: { raw: data.slice(0, 500) } });
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}

function extractText(parts = []) {
  return parts
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function collectEventTypes(events) {
  return Array.from(new Set(events.map((event) => event.type).filter(Boolean)));
}

function mapOpenCodeActivity(reply, events) {
  const parts = Array.isArray(reply?.parts) ? reply.parts : [];
  const activity = [{
    id: 'opencode-start',
    kind: 'step',
    title: '接入 OpenCode',
    detail: events.some((event) => event?.type === 'session.created') ? '会话已创建' : '运行时已启动',
    status: 'done',
  }];

  const reasoningParts = parts.filter((part) => part?.type === 'reasoning');
  if (reasoningParts.length) {
    activity.push({
      id: 'opencode-reasoning',
      kind: 'reasoning',
      title: '思考',
      detail: '已完成隐藏推理',
      status: reasoningParts.some((part) => !part.time?.end) ? 'running' : 'done',
    });
  }

  const toolParts = parts.filter((part) => part?.type === 'tool').slice(0, 3);
  for (const part of toolParts) {
    const toolName = part.tool || part.name || '工具调用';
    activity.push({
      id: part.id || `tool-${activity.length}`,
      kind: 'tool',
      title: String(toolName),
      detail: part.state?.status === 'error' ? '执行异常' : '已处理',
      status: part.state?.status === 'error' ? 'error' : part.state?.status === 'running' ? 'running' : 'done',
    });
  }

  const errorEvent = events.find((event) => String(event?.type || '').includes('error') || String(event?.type || '').includes('failed'));
  if (errorEvent) {
    activity.push({
      id: 'opencode-error',
      kind: 'event',
      title: '运行异常',
      detail: '后台已返回错误信息',
      status: 'error',
    });
  }

  const text = extractText(parts);
  if (text) {
    activity.push({
      id: 'opencode-answer',
      kind: 'message',
      title: '回复',
      detail: '已整理为可读结果',
      status: 'done',
    });
  }

  const result = [];
  const seen = new Set();
  for (const item of activity) {
    const key = `${item.kind}:${item.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result.slice(0, 6);
}

function mapOpenCodeLoopSteps(reply, events, ok) {
  const parts = Array.isArray(reply?.parts) ? reply.parts : [];
  const partTypes = parts.map((part) => part.type).filter(Boolean);
  const eventTypes = collectEventTypes(events);
  const finish = parts.find((part) => part.type === 'step-finish');
  const text = extractText(parts);
  const status = ok ? 'done' : 'error';
  return [
    {
      phase: 'think',
      label: '思考',
      detail: eventTypes.some((type) => String(type).includes('reasoning'))
        ? 'OpenCode reasoning event received'
        : 'OpenCode step-start event/part received',
      status,
    },
    {
      phase: 'act',
      label: '执行',
      detail: partTypes.includes('tool')
        ? 'OpenCode tool part executed'
        : 'OpenCode LLM step executed',
      status,
    },
    {
      phase: 'observe',
      label: '观察',
      detail: finish?.tokens
        ? `OpenCode step-finish tokens total=${finish.tokens.total ?? 0}`
        : `OpenCode events=${events.length}`,
      status,
    },
    {
      phase: 'answer',
      label: '回复',
      detail: text ? 'OpenCode text part completed' : 'OpenCode returned no text part',
      status,
    },
  ];
}

function buildErrorSteps(error) {
  const detail = error instanceof Error ? error.message : String(error);
  return [
    { phase: 'think', label: '思考', detail: 'OpenCode request started', status: 'done' },
    { phase: 'act', label: '执行', detail: 'OpenCode runtime returned an error', status: 'error' },
    { phase: 'observe', label: '观察', detail, status: 'error' },
    { phase: 'answer', label: '回复', detail: 'Error surfaced to GUI', status: 'error' },
  ];
}

async function runChat({ config, message, thinkingEffort, skillId = 'operator' }) {
  const deepseek = sanitizeDeepSeekConfig(config);
  if (!deepseek.apiKey) {
    return {
      ok: false,
      provider: 'embedded-opencode-source',
      model: deepseek.model,
      error: 'DeepSeek API key is not configured in DEF Shell 05 Agent.',
      usedRemoteModel: false,
      realOpenCode: true,
      steps: buildErrorSteps(new Error('DeepSeek API key is not configured')),
    };
  }

  const selected = skillMap[skillId] || skillMap.operator;
  const directory = projectRoot;
  const events = [];
  const eventController = new AbortController();
  const runController = new AbortController();
  const userMessage = typeof message === 'string' && message.trim() ? message.trim() : 'hi';

  activeRun = {
    baseUrl: '',
    directory,
    sessionID: null,
    controller: runController,
    eventController,
  };

  try {
    const baseUrl = await ensureOpenCodeServer(deepseek, skillId, thinkingEffort);
    if (runController.signal.aborted) throw runController.signal.reason || new Error('stopped by user');
    activeRun.baseUrl = baseUrl;
    const eventPromise = subscribeEvents(baseUrl, directory, (event) => events.push(event), eventController.signal)
      .catch((error) => {
        if (!eventController.signal.aborted) appendLog(`[event-error] ${error instanceof Error ? error.message : String(error)}`);
      });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const query = `directory=${encodeURIComponent(directory)}`;
    const session = await requestJson('POST', `${baseUrl}/session?${query}`, {}, runController.signal, 15000);
    activeRun.sessionID = session.id;
    const payload = {
      agent: selected.agent,
      model: {
        providerID: 'deepseek',
        modelID: deepseek.model,
      },
      system: describeThinkingEffort(thinkingEffort),
      parts: [
        {
          type: 'text',
          text: userMessage,
        },
      ],
    };
    const reply = await requestJson(
      'POST',
      `${baseUrl}/session/${encodeURIComponent(session.id)}/message?${query}`,
      payload,
      runController.signal,
      120000,
    );
    eventController.abort();
    await eventPromise;
    const content = extractText(reply.parts);
    return {
      ok: true,
      provider: 'embedded-opencode-source',
      model: deepseek.model,
      content,
      usedRemoteModel: true,
      realOpenCode: true,
      sessionID: session.id,
      agent: selected.agent,
      eventTypes: collectEventTypes(events),
      activity: mapOpenCodeActivity(reply, events),
      openCodeParts: Array.isArray(reply.parts) ? reply.parts.map((part) => part.type).filter(Boolean) : [],
      rawUsage: reply.parts?.find((part) => part.type === 'step-finish')?.tokens,
      steps: mapOpenCodeLoopSteps(reply, events, true),
    };
  } catch (error) {
    eventController.abort();
    return {
      ok: false,
      provider: 'embedded-opencode-source',
      model: deepseek.model,
      error: error instanceof Error ? error.message : String(error),
      usedRemoteModel: true,
      realOpenCode: true,
      eventTypes: collectEventTypes(events),
      activity: mapOpenCodeActivity(undefined, events),
      steps: buildErrorSteps(error),
    };
  } finally {
    if (activeRun?.controller === runController) activeRun = null;
  }
}

async function stopChat() {
  const run = activeRun;
  if (!run) {
    return { ok: true, stopped: false, reason: 'no-active-run' };
  }
  run.controller.abort(new Error('stopped by user'));
  run.eventController.abort();
  if (run.sessionID && run.baseUrl) {
    const query = `directory=${encodeURIComponent(run.directory)}`;
    try {
      await requestJson('POST', `${run.baseUrl}/session/${encodeURIComponent(run.sessionID)}/abort?${query}`, {}, undefined, 15000);
    } catch (error) {
      return {
        ok: false,
        stopped: true,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { ok: true, stopped: true, sessionID: run.sessionID, reason: run.sessionID ? undefined : 'session-not-created' };
}

function runtimeSummary(config = {}) {
  return {
    kind: 'embedded-opencode-upstream-source',
    vendorRoot: path.relative(projectRoot, vendorRoot).replace(/\\/g, '/'),
    serverUrl: opencodeReadyUrl || `http://${OPENCODE_HOST}:${OPENCODE_PORT}`,
    running: processRunning(opencodeProcess),
    deepseek: summarizeConfig(config),
  };
}

module.exports = {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  OPENCODE_PORT,
  sanitizeDeepSeekConfig,
  summarizeConfig,
  runtimeSummary,
  runChat,
  stopChat,
};
