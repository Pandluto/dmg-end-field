const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { EventEmitter } = require('events');
const { spawn, spawnSync } = require('child_process');

const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-pro';
const OPENCODE_HOST = '127.0.0.1';
const OPENCODE_PORT_BASE = Number(process.env.DEF_OPENCODE_PORT || 17445);
const OPENCODE_PORT_MAX_ATTEMPTS = 20;

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
let opencodeReadyPort = 0;
let activeRun = null;
const streamSessions = new Map();

function normalizeDeepSeekModel(model) {
  const value = typeof model === 'string' ? model.trim() : '';
  if (!value || value === 'deepseek-chat') return DEFAULT_DEEPSEEK_MODEL;
  return value;
}

function sanitizeDeepSeekConfig(config = {}) {
  return {
    apiKey: typeof config.apiKey === 'string' ? config.apiKey.trim() : '',
    baseUrl: typeof config.baseUrl === 'string' && config.baseUrl.trim()
      ? config.baseUrl.trim().replace(/\/+$/, '')
      : DEFAULT_DEEPSEEK_BASE_URL,
    model: normalizeDeepSeekModel(config.model),
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
    return 'Use a quick pass. Prefer concise Chinese answers and ask for missing critical inputs.';
  }
  if (effort === 'high') {
    return 'Use a careful pass. Check assumptions, missing conditions, tool results, and repair options before answering. Reply in Chinese unless the user asks otherwise. Do not reveal hidden chain-of-thought.';
  }
  return 'Use a balanced pass. Be concise, reply in Chinese unless the user asks otherwise, and reason through incomplete conditions before answering.';
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
    'Reply in Chinese by default. Use another language only when the user explicitly asks for it or quotes text that must remain unchanged.',
    'The user is a shallow AI user. Keep replies practical, short, and action-oriented.',
    'Do not expose API keys, hidden configuration, or internal protocol noise.',
    'Do not describe OpenCode, sessions, events, adapters, providers, or runtime details unless the user explicitly asks.',
    'Do not use the task tool or subagents. Complete the work in the current agent with direct read, grep, glob, skill, or allowed REST access.',
    'For normal chat, answer in 1-4 short paragraphs. For data-entry work, prefer compact checklists and the smallest useful next step.',
    'When the task lacks required information, ask for the smallest missing input or explain the safe next action.',
    'Do not write application storage directly. Produce proposals or instructions unless a DEF tool explicitly handles the write.',
    '',
    '## DEF REST API',
    'All business data access goes through the local REST API. Use the webfetch tool to call these endpoints.',
    'Base URL: http://127.0.0.1:17321',
    'For write endpoints, call webfetch with method: "POST", format: "text", and a JSON body object.',
    '',
    '### Read endpoints (use any time)',
    '- GET /api/agent/guide - system overview, safety rules, storage keys, recommended flow',
    '- GET /api/ai-cli/spec - full endpoint list, command reference, schemas, examples',
    '- GET /api/agent/skills - skill definitions with procedures and hard rules',
    '- GET /api/buff/library - all Buff entries (object-map format)',
    '- GET /api/buff/library/<id> - single Buff entry',
    '- GET /api/buff/current - current editor Buff draft',
    '- GET /api/buff/fill/template - BuffFillAiDraft schema and template',
    '- GET /api/weapon/library - all Weapon entries',
    '- GET /api/weapon/library/<id-or-name> - single Weapon entry',
    '- GET /api/weapon/current - current Weapon draft',
    '- GET /api/weapon/fill/template - WeaponFillAiDraft schema',
    '- GET /api/operator/library - all Operator entries',
    '- GET /api/operator/library/<id-or-name> - single Operator entry',
    '- GET /api/operator/current - current Operator draft',
    '- GET /api/operator/fill/template - OperatorFillAiDraft schema',
    '- GET /api/equipment/library - all Equipment entries',
    '- GET /api/equipment/library/<id-or-name> - single Equipment entry',
    '- GET /api/equipment/current - current Equipment draft',
    '- GET /api/equipment/fill/template - EquipmentFillAiDraft schema',
    '- GET /api/agent/sessions - active sessions',
    '- GET /api/agent/logs - operation logs',
    '- GET /api/agent/records - agent records snapshot',
    '',
    '### Write endpoints (creates proposals only, never writes library directly)',
    '- POST /api/buff/fill/check - validate Buff draft (body: { protocolVersion:1, requestId, draft })',
    '- POST /api/buff/fill/apply - create Buff proposal (body: { protocolVersion:1, requestId, draft })',
    '- POST /api/weapon/fill/check - validate Weapon draft',
    '- POST /api/weapon/fill/apply - create Weapon proposal',
    '- POST /api/operator/fill/check - validate Operator draft',
    '- POST /api/operator/fill/apply - create Operator proposal',
    '- POST /api/equipment/fill/check - validate Equipment draft',
    '- POST /api/equipment/fill/apply - create Equipment proposal',
    '- POST /api/ai-cli/run - execute CLI command (body: { protocolVersion:1, requestId, command, client })',
    '',
    '### Safety rules (must follow)',
    '- fill.check only validates; fill.apply only creates a proposal. Neither writes the library.',
    '- After fill.apply succeeds, tell the user to go to /ai-cli (Web CLI) to approve (Y) then save (Y).',
    '- Never re-run fill.apply for the same proposal.',
    '- proposal.approve / proposal.save / Y / N are FORBIDDEN via REST. They return 403.',
    '- If a pending proposal blocks fill.apply (409), call proposal.clear via POST /api/ai-cli/run first.',
    '- Read endpoints return object-map format; fill.check/apply expect array format. Always call /fill/template before constructing a draft.',
    '- Always call /api/agent/guide first when unsure about a procedure.',
    '- Do not invent modifier types, buff categories, or field values. Read the template/schema first.',
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
        task: 'deny',
        skill: 'allow',
        webfetch: {
          '*': 'deny',
          'http://127.0.0.1:17321/*': 'allow',
        },
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
    opencodeReadyPort = 0;
    return;
  }
  killProcessTree(opencodeProcess.pid);
  opencodeProcess = null;
  opencodeReadyUrl = '';
  opencodeReadyPort = 0;
}

function killProcessTree(pid) {
  if (!pid) return false;
  try {
    if (process.platform === 'win32') {
      const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      return result.status === 0;
    }
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

function cleanupStaleOpenCodeProcesses() {
  if (process.platform !== 'win32') return;
  const script = `
$hostName = '${OPENCODE_HOST.replace(/'/g, "''")}'
$processes = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and
  $_.CommandLine -like '*packages/opencode/src/index.ts*' -and
  $_.CommandLine -like '* serve *' -and
  $_.CommandLine -like ('*--hostname=' + $hostName + '*')
}
foreach ($process in $processes) {
  taskkill.exe /PID $process.ProcessId /T /F | Out-Null
}
`.trim();
  spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

function canListenOnPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, OPENCODE_HOST);
  });
}

async function findOpenCodePort() {
  for (let offset = 0; offset < OPENCODE_PORT_MAX_ATTEMPTS; offset += 1) {
    const port = OPENCODE_PORT_BASE + offset;
    if (await canListenOnPort(port)) return port;
  }
  throw new Error(`No available OpenCode port from ${OPENCODE_PORT_BASE} to ${OPENCODE_PORT_BASE + OPENCODE_PORT_MAX_ATTEMPTS - 1}`);
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
  cleanupStaleOpenCodeProcesses();
  fs.mkdirSync(runtimeLogDir, { recursive: true });
  opencodeConfigHash = nextHash;
  opencodeReadyPort = await findOpenCodePort();
  opencodeProcess = spawn('bun', [
    'run',
    '--conditions=browser',
    'packages/opencode/src/index.ts',
    'serve',
    `--hostname=${OPENCODE_HOST}`,
    `--port=${opencodeReadyPort}`,
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
    opencodeReadyPort = 0;
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

function normalizeTokens(tokens) {
  if (!tokens || typeof tokens !== 'object') return undefined;
  const prompt = Number(tokens.prompt ?? tokens.input ?? 0) || 0;
  const completion = Number(tokens.completion ?? tokens.output ?? 0) || 0;
  const reasoning = Number(tokens.reasoning ?? 0) || 0;
  const total = Number(tokens.total ?? prompt + completion + reasoning) || 0;
  return { total, prompt, completion, reasoning };
}

function compactValue(value, limit = 1200) {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function makeStreamState({ baseUrl, directory, sessionID, agent, model, skillId, thinkingEffort }) {
  const state = {
    id: sessionID,
    sessionID,
    baseUrl,
    directory,
    agent,
    model,
    skillId,
    thinkingEffort,
    eventEmitter: new EventEmitter(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    active: false,
    stopped: false,
    nextSeq: 1,
    buffer: [],
    partText: new Map(),
    partTypes: new Map(),
    toolStatus: new Map(),
    assistantMessages: new Set(),
    tokens: undefined,
    currentTurnId: null,
    controller: null,
    eventController: null,
    eventPromise: null,
  };
  streamSessions.set(sessionID, state);
  return state;
}

function emitStreamEvent(state, type, payload = {}) {
  if (!state) return null;
  const event = {
    seq: state.nextSeq++,
    type,
    at: Date.now(),
    sessionId: state.sessionID,
    turnId: payload.turnId || state.currentTurnId || undefined,
    ...payload,
  };
  state.updatedAt = event.at;
  state.buffer.push(event);
  if (state.buffer.length > 800) {
    state.buffer.splice(0, state.buffer.length - 800);
  }
  state.eventEmitter.emit('event', event);
  return event;
}

function emitPartTextDelta(state, part, eventType) {
  if (!part?.id || typeof part.text !== 'string' || !part.text) return;
  const previous = state.partText.get(part.id) || '';
  const next = part.text;
  const delta = next.startsWith(previous) ? next.slice(previous.length) : next;
  state.partText.set(part.id, next);
  if (!delta) return;
  emitStreamEvent(state, eventType, {
    partId: part.id,
    messageId: part.messageID,
    text: delta,
  });
}

function emitToolPart(state, part) {
  if (!part?.id) return;
  const toolName = part.tool || part.name || 'tool';
  if (toolName === 'task') {
    if (!state.toolStatus.has(part.id)) {
      emitStreamEvent(state, 'tool.start', {
        id: part.id,
        partId: part.id,
        callId: part.callID,
        messageId: part.messageID,
        toolName,
        status: 'running',
        input: part.state?.input,
        title: part.state?.title,
      });
    }
    state.toolStatus.set(part.id, 'error');
    const error = 'DEF 面板不使用 task 子代理；请在当前会话内直接完成。';
    emitStreamEvent(state, 'tool.error', {
      id: part.id,
      partId: part.id,
      callId: part.callID,
      messageId: part.messageID,
      toolName,
      status: 'error',
      input: part.state?.input,
      result: compactValue(part.state?.output ?? part.state?.metadata),
      error,
      title: part.state?.title || '子代理已拦截',
    });
    if (state.controller && !state.controller.signal.aborted) {
      state.controller.abort(new Error(error));
    }
    return;
  }
  const status = part.state?.status || 'running';
  const previousStatus = state.toolStatus.get(part.id);
  if (!previousStatus) {
    emitStreamEvent(state, 'tool.start', {
      id: part.id,
      partId: part.id,
      callId: part.callID,
      messageId: part.messageID,
      toolName,
      status: 'running',
      input: part.state?.input,
      title: part.state?.title,
    });
  }
  state.toolStatus.set(part.id, status);
  emitStreamEvent(state, status === 'error' ? 'tool.error' : 'tool.content', {
    id: part.id,
    partId: part.id,
    callId: part.callID,
    messageId: part.messageID,
    toolName,
    status: status === 'completed' ? 'done' : status === 'error' ? 'error' : 'running',
    input: part.state?.input,
    result: compactValue(part.state?.output ?? part.state?.metadata ?? part.state?.error),
    error: compactValue(part.state?.error),
    title: part.state?.title,
  });
}

function emitStepFinishPart(state, part) {
  const tokens = normalizeTokens(part?.tokens);
  if (tokens) state.tokens = tokens;
  emitStreamEvent(state, 'step.finish', {
    partId: part?.id,
    messageId: part?.messageID,
    tokens,
    finish: part?.finish,
  });
}

function normalizeOpenCodeEventForStream(state, event) {
  if (!event || !state) return;
  const type = String(event.type || '');
  const properties = event.properties || {};
  const eventSessionID = properties.sessionID || properties.info?.sessionID || properties.part?.sessionID;
  if (eventSessionID && eventSessionID !== state.sessionID) return;

  if (type === 'session.error') {
    emitStreamEvent(state, 'error', {
      error: compactValue(properties.error || properties),
    });
    return;
  }

  if (type === 'message.updated') {
    const info = properties.info || {};
    if (info.role === 'assistant' && info.id && !state.assistantMessages.has(info.id)) {
      state.assistantMessages.add(info.id);
      emitStreamEvent(state, 'step.start', {
        messageId: info.id,
        agent: info.agent || info.mode || state.agent,
        model: info.modelID || state.model,
      });
    }
    if (info.error) {
      emitStreamEvent(state, 'error', {
        messageId: info.id,
        error: compactValue(info.error),
      });
    }
    return;
  }

  if (type === 'message.part.updated') {
    const part = properties.part || {};
    if (part.sessionID && part.sessionID !== state.sessionID) return;
    if (part.messageID && !state.assistantMessages.has(part.messageID)) return;
    if (part.id && part.type) state.partTypes.set(part.id, part.type);
    if (part.type === 'text' && part.ignored !== true) {
      emitPartTextDelta(state, part, 'text');
    } else if (part.type === 'reasoning') {
      emitPartTextDelta(state, part, 'reasoning');
    } else if (part.type === 'tool') {
      emitToolPart(state, part);
    } else if (part.type === 'step-finish') {
      emitStepFinishPart(state, part);
    }
    return;
  }

  if (type === 'message.part.delta') {
    if (properties.sessionID && properties.sessionID !== state.sessionID) return;
    if (properties.messageID && !state.assistantMessages.has(properties.messageID)) return;
    if (properties.field !== 'text' || typeof properties.delta !== 'string' || !properties.delta) return;
    const partId = properties.partID;
    const partType = state.partTypes.get(partId);
    if (partType !== 'text' && partType !== 'reasoning') return;
    const previous = state.partText.get(partId) || '';
    state.partText.set(partId, `${previous}${properties.delta}`);
    emitStreamEvent(state, partType === 'reasoning' ? 'reasoning' : 'text', {
      partId,
      messageId: properties.messageID,
      text: properties.delta,
    });
  }
}

function emitReplyRemainder(state, reply) {
  const parts = Array.isArray(reply?.parts) ? reply.parts : [];
  for (const part of parts) {
    if (!part?.id) continue;
    if (part.type === 'text' && part.ignored !== true) emitPartTextDelta(state, part, 'text');
    if (part.type === 'reasoning') emitPartTextDelta(state, part, 'reasoning');
    if (part.type === 'tool') emitToolPart(state, part);
    if (part.type === 'step-finish') emitStepFinishPart(state, part);
  }
}

function listChatSessions() {
  return Array.from(streamSessions.values())
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((session) => ({
      id: session.sessionID,
      sessionID: session.sessionID,
      agent: session.agent,
      model: session.model,
      skillId: session.skillId,
      active: session.active,
      stopped: session.stopped,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      tokens: session.tokens,
      lastSeq: session.nextSeq - 1,
    }));
}

function getChatSessionStream(sessionID) {
  const state = streamSessions.get(sessionID);
  if (!state) return null;
  return {
    id: state.sessionID,
    sessionID: state.sessionID,
    active: state.active,
    buffer: state.buffer,
    eventEmitter: state.eventEmitter,
    lastSeq: state.nextSeq - 1,
  };
}

async function sendMessageOnStreamSession(state, message, clientTurnId) {
  if (!state) throw new Error('stream session not found');
  if (state.active) throw new Error('stream session is already running');

  const userMessage = typeof message === 'string' && message.trim() ? message.trim() : 'hi';
  const turnId = typeof clientTurnId === 'string' && clientTurnId.trim() ? clientTurnId.trim() : crypto.randomUUID();
  const runController = new AbortController();
  const eventController = new AbortController();
  state.currentTurnId = turnId;
  state.controller = runController;
  state.eventController = eventController;
  state.active = true;
  state.stopped = false;
  emitStreamEvent(state, 'message.start', { turnId, text: userMessage });

  try {
    const eventPromise = subscribeEvents(state.baseUrl, state.directory, (event) => {
      normalizeOpenCodeEventForStream(state, event);
    }, eventController.signal).catch((error) => {
      if (!eventController.signal.aborted) {
        appendLog(`[stream-event-error] ${error instanceof Error ? error.message : String(error)}`);
        emitStreamEvent(state, 'error', { error: error instanceof Error ? error.message : String(error) });
      }
    });
    state.eventPromise = eventPromise;
    await new Promise((resolve) => setTimeout(resolve, 80));

    const query = `directory=${encodeURIComponent(state.directory)}`;
    const payload = {
      agent: state.agent,
      model: {
        providerID: 'deepseek',
        modelID: state.model,
      },
      system: describeThinkingEffort(state.thinkingEffort),
      parts: [{ type: 'text', text: userMessage }],
    };
    const reply = await requestJson(
      'POST',
      `${state.baseUrl}/session/${encodeURIComponent(state.sessionID)}/message?${query}`,
      payload,
      runController.signal,
      120000,
    );
    emitReplyRemainder(state, reply);
    emitStreamEvent(state, 'done', {
      turnId,
      ok: true,
      content: extractText(reply.parts),
      tokens: state.tokens || normalizeTokens(reply.parts?.find((part) => part.type === 'step-finish')?.tokens),
    });
  } catch (error) {
    const stopped = runController.signal.aborted;
    state.stopped = stopped;
    emitStreamEvent(state, stopped ? 'stopped' : 'error', {
      turnId,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    eventController.abort();
    state.active = false;
    state.controller = null;
    state.eventController = null;
    const closingEventPromise = state.eventPromise;
    state.eventPromise = null;
    if (closingEventPromise) {
      void closingEventPromise.catch(() => {
        // ignored
      });
    }
  }
}

async function runChatStream({ config, message, thinkingEffort, skillId = 'operator', clientTurnId }) {
  const deepseek = sanitizeDeepSeekConfig(config);
  if (!deepseek.apiKey) {
    throw new Error('DeepSeek API key is not configured in DEF Shell 05 Agent.');
  }

  const selected = skillMap[skillId] || skillMap.operator;
  const directory = projectRoot;
  const baseUrl = await ensureOpenCodeServer(deepseek, skillId, thinkingEffort);
  const query = `directory=${encodeURIComponent(directory)}`;
  const session = await requestJson('POST', `${baseUrl}/session?${query}`, {}, undefined, 15000);
  const state = makeStreamState({
    baseUrl,
    directory,
    sessionID: session.id,
    agent: selected.agent,
    model: deepseek.model,
    skillId,
    thinkingEffort,
  });
  emitStreamEvent(state, 'session.created', {
    turnId: clientTurnId,
    sessionId: session.id,
    agent: selected.agent,
    skillId,
    model: deepseek.model,
  });
  void sendMessageOnStreamSession(state, message, clientTurnId);
  return {
    sessionId: session.id,
    sessionID: session.id,
    eventEmitter: state.eventEmitter,
  };
}

async function continueChat(sessionID, message, clientTurnId) {
  const state = streamSessions.get(sessionID);
  if (!state) throw new Error('stream session not found');
  void sendMessageOnStreamSession(state, message, clientTurnId);
  return {
    sessionId: state.sessionID,
    sessionID: state.sessionID,
    eventEmitter: state.eventEmitter,
  };
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

async function stopChat(sessionID) {
  if (sessionID) {
    const state = streamSessions.get(sessionID);
    if (!state) {
      return { ok: true, stopped: false, sessionID, reason: 'session-not-found' };
    }
    state.stopped = true;
    state.controller?.abort(new Error('stopped by user'));
    state.eventController?.abort();
    if (state.sessionID && state.baseUrl) {
      const query = `directory=${encodeURIComponent(state.directory)}`;
      try {
        await requestJson('POST', `${state.baseUrl}/session/${encodeURIComponent(state.sessionID)}/abort?${query}`, {}, undefined, 15000);
      } catch (error) {
        emitStreamEvent(state, 'error', { error: error instanceof Error ? error.message : String(error) });
        return {
          ok: false,
          stopped: true,
          sessionID: state.sessionID,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }
    emitStreamEvent(state, 'stopped', { reason: 'stopped by user' });
    return { ok: true, stopped: true, sessionID: state.sessionID };
  }

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
  const actualPort = opencodeReadyPort || OPENCODE_PORT_BASE;
  return {
    kind: 'embedded-opencode-upstream-source',
    vendorRoot: path.relative(projectRoot, vendorRoot).replace(/\\/g, '/'),
    serverUrl: opencodeReadyUrl || `http://${OPENCODE_HOST}:${actualPort}`,
    portBase: OPENCODE_PORT_BASE,
    port: actualPort,
    running: processRunning(opencodeProcess),
    deepseek: summarizeConfig(config),
  };
}

function shutdownRuntime() {
  stopOpenCodeProcess();
  cleanupStaleOpenCodeProcesses();
}

module.exports = {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  OPENCODE_PORT_BASE,
  sanitizeDeepSeekConfig,
  summarizeConfig,
  runtimeSummary,
  runChat,
  runChatStream,
  continueChat,
  stopChat,
  listChatSessions,
  getChatSessionStream,
  shutdownRuntime,
};
