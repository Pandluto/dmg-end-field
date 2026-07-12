const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const {
  runChat,
  runChatStream,
  continueChat,
  stopChat,
  listChatSessions,
  listPersistedDefSessions,
  getPersistedDefSession,
  hydrateDefSession,
  getChatSessionStream,
  getLiveDefTranscript,
  shutdownRuntime,
  sanitizeDeepSeekConfig,
  summarizeConfig,
  runtimeSummary,
  ensureRuntime,
  createNativeHostSession,
  recoverNativeHostSession,
  buildNativeHostProfile,
  readNativeSessionBinding,
  ensureNativeSessionAxisBinding,
  findNativeSessionBinding,
  writeNativeWorkbenchContext,
} = require('../runtime/def-opencode-adapter/index.cjs');

const HOST = '127.0.0.1';
const PORT = Number(process.env.DEF_AGENT_PORT || 17322);
const projectRoot = path.resolve(__dirname, '..', '..');
const runtimeRoot = path.join(projectRoot, 'agent', 'runtime');
const defRuntimeRoot = path.join(runtimeRoot, 'def');
const openCodeUiRoot = path.join(runtimeRoot, 'opencode-ui');
const configPath = path.join(projectRoot, '.runtime', 'def-agent', 'config.json');
const questionStorePath = path.join(projectRoot, '.runtime', 'def-agent', 'questions.sqlite3');
const OPENCODE_ACTION_TIMEOUT_MS = 5000;
const startedAt = Date.now();
const defRestUrl = process.env.DEF_REST_BASE_URL || 'http://127.0.0.1:17321';
let defRestProcess = null;
let questionStore = null;

async function defRestReady() {
  try {
    const response = await fetch(`${defRestUrl}/health`, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureDefRestService() {
  if (await defRestReady()) return { running: true, owned: false, url: defRestUrl };
  if (!defRestProcess || defRestProcess.exitCode !== null) {
    defRestProcess = spawn(process.execPath, [path.join(projectRoot, 'scripts', 'ai-cli-rest-server.mjs')], {
      cwd: projectRoot,
      env: { ...process.env, DEF_REST_BASE_URL: defRestUrl },
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
    });
    defRestProcess.once('exit', () => { defRestProcess = null; });
  }
  for (let attempt = 0; attempt < 75; attempt += 1) {
    if (await defRestReady()) return { running: true, owned: true, url: defRestUrl };
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`DEF tool service did not become ready at ${defRestUrl}`);
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function buildJsonHeaders() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, buildJsonHeaders());
  response.end(JSON.stringify(payload));
}

function buildEmbeddedProviderCatalog(config) {
  const deepseek = sanitizeDeepSeekConfig(config || {});
  const modelId = deepseek.model;
  return {
    all: [{
      id: 'deepseek',
      name: 'DeepSeek',
      source: 'config',
      env: [],
      options: {},
      models: {
        [modelId]: {
          id: modelId,
          providerID: 'deepseek',
          api: { id: modelId, url: deepseek.baseUrl, npm: '@ai-sdk/openai-compatible' },
          name: modelId,
          family: 'deepseek',
          capabilities: {
            temperature: true,
            reasoning: true,
            attachment: true,
            toolcall: true,
            input: { text: true, audio: false, image: false, video: false, pdf: false },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: false,
          },
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limit: { context: 128000, output: 8192 },
          status: 'active',
          options: {},
          headers: {},
          variants: {},
        },
      },
    }],
    default: { deepseek: modelId },
    connected: ['deepseek'],
  };
}

function writeSse(response, event) {
  response.write(`id: ${event.seq ?? Date.now()}\n`);
  response.write(`event: ${event.type || 'message'}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function writeSseHeaders(response) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });
  response.write(': connected\n\n');
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function readConfig() {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      deepseek: sanitizeDeepSeekConfig(parsed.deepseek || {}),
    };
  } catch {
    return {
      deepseek: sanitizeDeepSeekConfig({}),
    };
  }
}

function writeConfig(patch) {
  const current = readConfig();
  const next = {
    ...current,
    ...patch,
    deepseek: sanitizeDeepSeekConfig({
      ...current.deepseek,
      ...(patch.deepseek || {}),
    }),
  };
  ensureParent(configPath);
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2));
  return next;
}

function listSkills() {
  const skillsDir = path.join(defRuntimeRoot, 'skills');
  try {
    return fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        id: entry.name,
        path: path.relative(projectRoot, path.join(skillsDir, entry.name, 'SKILL.md')).replace(/\\/g, '/'),
      }));
  } catch {
    return [];
  }
}

function healthPayload() {
  const config = readConfig();
  return {
    ok: true,
    service: 'def-agent-sidecar',
    host: HOST,
    port: PORT,
    pid: process.pid,
    startedAt,
    runtime: {
      ...runtimeSummary(config.deepseek),
      root: path.relative(projectRoot, runtimeRoot).replace(/\\/g, '/'),
    },
    skills: listSkills(),
  };
}

function getQuestionStore() {
  if (questionStore) return questionStore;
  ensureParent(questionStorePath);
  questionStore = new DatabaseSync(questionStorePath);
  questionStore.exec(`
    CREATE TABLE IF NOT EXISTS def_native_question (
      request_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      directory TEXT NOT NULL,
      questions_json TEXT NOT NULL,
      status TEXT NOT NULL,
      answers_json TEXT,
      runtime_status TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS def_native_question_session_idx ON def_native_question(session_id);
  `);
  return questionStore;
}

function saveNativeQuestion(input) {
  const now = Date.now();
  const store = getQuestionStore();
  store.prepare(`
    INSERT INTO def_native_question (request_id, session_id, directory, questions_json, status, answers_json, runtime_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(request_id) DO UPDATE SET
      session_id = excluded.session_id,
      directory = excluded.directory,
      questions_json = excluded.questions_json,
      status = excluded.status,
      answers_json = excluded.answers_json,
      runtime_status = excluded.runtime_status,
      updated_at = excluded.updated_at
  `).run(
    input.requestID,
    input.sessionID,
    input.directory,
    JSON.stringify(Array.isArray(input.questions) ? input.questions : []),
    input.status,
    input.answers === undefined ? null : JSON.stringify(input.answers),
    input.runtimeStatus || null,
    now,
    now,
  );
}

function deleteNativeQuestionRecords(sessionID) {
  getQuestionStore().prepare('DELETE FROM def_native_question WHERE session_id = ?').run(sessionID);
}

function readJsonFileIfPresent(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function countChangedLines(before, after) {
  const left = String(before).split('\n');
  const right = String(after).split('\n');
  const shared = Math.min(left.length, right.length);
  let changed = 0;
  for (let index = 0; index < shared; index += 1) if (left[index] !== right[index]) changed += 1;
  return {
    additions: changed + Math.max(0, right.length - left.length),
    deletions: changed + Math.max(0, left.length - right.length),
  };
}

async function migrateNativeSessionTitle(binding) {
  const runtime = runtimeSummary(readConfig().deepseek);
  if (!runtime.serverUrl || !binding?.sessionID || !binding.directory) return;
  const query = `directory=${encodeURIComponent(binding.directory)}`;
  try {
    const current = await fetch(`${runtime.serverUrl}/session/${encodeURIComponent(binding.sessionID)}?${query}`).then((r) => r.json());
    const title = String(current?.title || '');
    if (!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(title)) return;
    const nextTitle = binding.host === 'workbench' ? '排轴会话' : 'DEF 数据会话';
    await fetch(`${runtime.serverUrl}/session/${encodeURIComponent(binding.sessionID)}?${query}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: nextTitle }),
    });
  } catch {
    // Title migration is cosmetic and must not block session recovery.
  }
}

const staticMimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
};

function serveOpenCodeUi(request, response, requestUrl) {
  if (!['GET', 'HEAD'].includes(request.method || 'GET')) return false;
  if (!fs.existsSync(path.join(openCodeUiRoot, 'index.html'))) return false;

  let requestedPath;
  try {
    requestedPath = decodeURIComponent(requestUrl.pathname);
  } catch {
    return false;
  }
  const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.replace(/^\/+/, '');
  const resolved = path.resolve(openCodeUiRoot, relativePath);
  const insideRoot = resolved === openCodeUiRoot || resolved.startsWith(`${openCodeUiRoot}${path.sep}`);
  const hasAsset = insideRoot && fs.existsSync(resolved) && fs.statSync(resolved).isFile();
  const acceptsHtml = String(request.headers.accept || '').includes('text/html');
  if (!hasAsset && !acceptsHtml) return false;
  const assetPath = hasAsset ? resolved : path.join(openCodeUiRoot, 'index.html');
  const extension = path.extname(assetPath).toLowerCase();
  const isIndex = assetPath === path.join(openCodeUiRoot, 'index.html');
  const fileBody = fs.readFileSync(assetPath);
  const routeParts = requestUrl.pathname.split('/').filter(Boolean);
  let embeddedProfile = null;
  let embeddedSession = null;
  if (routeParts.length >= 3 && routeParts[1] === 'session') {
    try {
      const directory = Buffer.from(routeParts[0], 'base64url').toString('utf8');
      const sessionID = decodeURIComponent(routeParts[2]);
      const binding = readNativeSessionBinding(directory, sessionID);
      embeddedProfile = binding?.profile || null;
      if (binding) embeddedSession = { sessionID, directory: binding.directory };
    } catch {
      embeddedProfile = null;
      embeddedSession = null;
    }
  }
  if (!embeddedProfile) {
    const requestedHost = requestUrl.searchParams.get('def_host') === 'workbench' ? 'workbench' : 'ai-cli';
    embeddedProfile = buildNativeHostProfile(requestedHost);
  }
  const body = isIndex
    ? Buffer.from(fileBody.toString('utf8').replace(
      '</head>',
      `<script>window.__DEF_EMBEDDED_PROFILE__=${JSON.stringify(embeddedProfile)};window.__DEF_NATIVE_SESSION__=${JSON.stringify(embeddedSession)};try{localStorage.setItem("opencode.settings.dat:defaultServerUrl",location.origin)}catch{}</script></head>`,
    ), 'utf8')
    : fileBody;
  response.writeHead(200, {
    'Content-Type': staticMimeTypes[extension] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': isIndex ? 'no-store' : 'public, max-age=31536000, immutable',
    'Access-Control-Allow-Origin': '*',
  });
  response.end(request.method === 'HEAD' ? undefined : body);
  return true;
}

async function proxyOpenCodeRequest(request, response) {
  const runtime = runtimeSummary(readConfig().deepseek);
  if (!runtime.running || !runtime.serverUrl) return Promise.resolve(false);
  const target = new URL(request.url || '/', runtime.serverUrl);
  await rejectPendingQuestionsForSessionAbort(runtime, request, target);
  const sessionMessageMatch = /^\/session\/([^/]+)\/message$/.exec(target.pathname);
  let rewrittenBody = null;
  let binding = null;
  if (request.method === 'POST' && sessionMessageMatch) {
    const sessionID = decodeURIComponent(sessionMessageMatch[1]);
    const directory = target.searchParams.get('directory') || '';
    binding = readNativeSessionBinding(directory, sessionID);
    if (binding) {
      const incoming = await readJsonBody(request);
      const workbenchContext = binding.host === 'workbench'
        ? readNativeWorkbenchContext(binding)
        : null;
      rewrittenBody = Buffer.from(JSON.stringify({
        ...incoming,
        agent: binding.agent,
        ...(binding.host === 'workbench' ? { system: buildWorkbenchContextSystemPrompt(workbenchContext, incoming.system) } : {}),
      }), 'utf8');
    }
  }
  return new Promise((resolve, reject) => {
    const headers = { ...request.headers, host: target.host };
    if (rewrittenBody) {
      delete headers['transfer-encoding'];
      headers['content-type'] = 'application/json; charset=utf-8';
      headers['content-length'] = String(rewrittenBody.length);
      headers['x-def-host'] = binding.host;
      headers['x-def-agent'] = binding.agent;
    }
    const upstream = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: request.method,
      headers,
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, {
        ...upstreamResponse.headers,
        'access-control-allow-origin': '*',
      });
      upstreamResponse.pipe(response);
      upstreamResponse.on('end', () => resolve(true));
    });
    upstream.on('error', reject);
    if (rewrittenBody) {
      upstream.end(rewrittenBody);
      return;
    }
    request.pipe(upstream);
  });
}

function readRequestDirectory(request, requestUrl) {
  const queryDirectory = requestUrl.searchParams.get('directory');
  if (queryDirectory) return queryDirectory;
  const header = request.headers['x-opencode-directory'];
  const rawDirectory = Array.isArray(header) ? header[0] : header;
  if (!rawDirectory) return '';
  try {
    return decodeURIComponent(rawDirectory);
  } catch {
    return rawDirectory;
  }
}

function readRequestHeader(request, name) {
  const header = request.headers[name];
  return Array.isArray(header) ? header[0] || '' : header || '';
}

async function rejectPendingQuestions(runtime, directory, sessionID) {
  if (!directory || !sessionID) return [];
  const query = `directory=${encodeURIComponent(directory)}`;

  try {
    const pendingResponse = await fetch(`${runtime.serverUrl}/question?${query}`, {
      signal: AbortSignal.timeout(OPENCODE_ACTION_TIMEOUT_MS),
    });
    if (!pendingResponse.ok) return;
    const pending = await pendingResponse.json();
    if (!Array.isArray(pending)) return [];

    const rejected = [];
    for (const question of pending) {
      if (question?.sessionID !== sessionID || !question?.id) continue;
      await fetch(`${runtime.serverUrl}/question/${encodeURIComponent(question.id)}/reject?${query}`, {
        method: 'POST',
        headers: { 'x-opencode-directory': encodeURIComponent(directory) },
        signal: AbortSignal.timeout(OPENCODE_ACTION_TIMEOUT_MS),
      }).catch(() => undefined);
      rejected.push(question.id);
    }
    return rejected;
  } catch {
    return [];
  }
}

async function rejectPendingQuestionsForSessionAbort(runtime, request, target) {
  if (request.method !== 'POST') return;
  const abortMatch = /^\/session\/([^/]+)\/abort$/.exec(target.pathname);
  if (!abortMatch) return;
  const sessionID = decodeURIComponent(abortMatch[1]);
  const nativeBinding = findNativeSessionBinding(sessionID);
  const directory = nativeBinding?.directory || readRequestDirectory(request, target);
  await rejectPendingQuestions(runtime, directory, sessionID);
}

async function submitNativeQuestionDecision(runtime, input) {
  const query = `directory=${encodeURIComponent(input.binding.directory)}`;
  const endpoint = `${runtime.serverUrl}/question/${encodeURIComponent(input.requestID)}/${input.action === 'reply' ? 'reply' : 'reject'}?${query}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-opencode-directory': encodeURIComponent(input.binding.directory),
    },
    body: input.action === 'reply' ? JSON.stringify({ answers: input.answers || [] }) : undefined,
    signal: AbortSignal.timeout(OPENCODE_ACTION_TIMEOUT_MS),
  });
  return { ok: response.ok, status: response.status, body: await response.text() };
}

function normalizeWorkbenchCheckout(axisContext) {
  const checkout = axisContext?.checkout;
  if (!checkout || typeof checkout.targetId !== 'string' || !checkout.targetId.trim()) return null;
  return { targetType: checkout.targetType || '', targetId: checkout.targetId.trim() };
}

function updateNativeWorkbenchCheckoutState(binding, axisContext) {
  if (!binding?.directory) return null;
  const target = path.join(binding.directory, '.def-session.json');
  const session = readJsonFileIfPresent(target);
  if (!session || session.sessionID !== binding.sessionID) return null;
  const current = normalizeWorkbenchCheckout(axisContext);
  const previous = session.workbenchCheckout || null;
  const changed = Boolean(previous && (previous.targetType !== current?.targetType || previous.targetId !== current?.targetId));
  const existing = session.workbenchCheckoutState && typeof session.workbenchCheckoutState === 'object'
    ? session.workbenchCheckoutState
    : {};
  const phase = changed ? 'checkout-changed' : (existing.phase === 'checkout-changed' ? 'checkout-changed' : 'ready');
  session.workbenchCheckout = current;
  session.workbenchCheckoutState = {
    phase,
    current,
    previous: changed ? previous : (existing.previous || null),
    observedAt: Date.now(),
  };
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, target);
  return {
    phase,
    current,
    previous: session.workbenchCheckoutState.previous,
    axisContext,
  };
}

function buildWorkbenchCheckoutSystemPrompt(state, existingSystem, parts) {
  const currentNode = Array.isArray(state.axisContext?.nodes)
    ? state.axisContext.nodes.find((node) => node?.id === state.current?.targetId)
    : null;
  const lines = [
    'DEF WORKBENCH AUTHORITATIVE STATE (system instruction, not user text):',
    'This conversation is bound to the timeline document and its Work Node tree. A Work Node is never the conversation identity.',
    `Current checkout: ${currentNode?.label || 'unnamed node'} (${state.current?.targetId || 'none'}).`,
    `Checkout state: ${state.phase}.`,
    'Do not use, repeat, or reconcile any older transcript claim about a bound node or latest applied node.',
  ];
  if (state.phase === 'checkout-changed') {
    lines.push(
      'HARD GATE: before answering the user request or calling any other DEF node tool, call def_node_bind with nodeId="".',
      'After that succeeds, call def_workbench_context again, reason at high effort from the returned checkout only, then answer or continue.',
      'Do not report a current-node result, mutate a draft, or infer timeline content until the gate is cleared.',
    );
  } else {
    lines.push('Before answering a current-canvas or current-node question, call def_workbench_context and use its checkout as the only source of truth.');
  }
  const userText = Array.isArray(parts)
    ? parts.filter((part) => part?.type === 'text').map((part) => String(part.text || '')).join('\n')
    : '';
  if (/当前节点|当前.*节点|现在.*节点/.test(userText)) {
    lines.push(
      'DIRECT CURRENT-NODE CONTRACT: call def_workbench_current_node before replying.',
      'Reply with exactly its label and nodeId. Do not mention axis bindings, node cursors, parents, latest-applied nodes, summaries, or any earlier answer.',
    );
  }
  if (typeof existingSystem === 'string' && existingSystem.trim()) lines.push(existingSystem.trim());
  return lines.join('\n');
}

function readNativeWorkbenchContext(binding) {
  if (!binding?.directory) return null;
  const attached = readJsonFileIfPresent(path.join(binding.directory, '.def-workbench-context.json'));
  const context = attached?.context;
  if (!context || typeof context !== 'object') return null;
  const selected = context.selectedWorkbenchNode;
  if (!selected || typeof selected !== 'object' || typeof selected.id !== 'string' || !selected.id.trim()) return null;
  return {
    id: selected.id.trim(),
    name: typeof selected.name === 'string' && selected.name.trim() ? selected.name.trim() : '未命名节点',
    description: typeof selected.description === 'string' ? selected.description.trim() : '',
  };
}

function buildWorkbenchContextSystemPrompt(selectedNode, existingSystem) {
  const lines = [
    'DEF WORKBENCH LIVE SELECTION (authoritative system context; not user text):',
    'This value is refreshed from the Work Node tree before every user message. Treat every older transcript claim about the current node as stale.',
  ];
  if (selectedNode) {
    lines.push(
      `Selected node ID: ${selectedNode.id}`,
      `Selected node name: ${selectedNode.name}`,
      `Selected node description: ${selectedNode.description || '（无描述）'}`,
      'When asked for the current node, answer directly from these three fields. Do not ask the user to confirm and do not call a tool merely to rediscover them.',
    );
  } else {
    lines.push('No Work Node has been selected in this UI session. State that fact plainly if the user asks for the current node.');
  }
  if (typeof existingSystem === 'string' && existingSystem.trim()) lines.push(existingSystem.trim());
  return lines.join('\n');
}

async function syncNativeWorkbenchAxisBinding(binding) {
  if (!binding || binding.host !== 'workbench') return null;
  const current = binding.axisBindingId ? binding : ensureNativeSessionAxisBinding(binding.directory, binding.sessionID);
  if (!current?.axisBindingId) return null;
  await ensureDefRestService();
  const response = await fetch(`${defRestUrl}/api/def-tools/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tool: 'def.workbench.bind_session_axis',
      input: {
        sessionBindingId: current.axisBindingId,
        sessionID: current.sessionID,
        host: 'workbench',
        timelineId: 'current-main-workbench',
      },
    }),
    signal: AbortSignal.timeout(5000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true || payload?.result?.ok === false) {
    throw new Error(payload?.result?.message || payload?.message || 'native-session-axis-binding-failed');
  }
  return payload.result.context || null;
}

async function removeNativeWorkbenchAxisBinding(binding) {
  if (!binding?.axisBindingId || binding.host !== 'workbench') return;
  await ensureDefRestService();
  await fetch(`${defRestUrl}/api/def-tools/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool: 'def.workbench.unbind_session_axis', input: { sessionBindingId: binding.axisBindingId } }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined);
}

const server = http.createServer(async (request, response) => {
  const method = request.method || 'GET';
  const requestUrl = new URL(request.url || '/', `http://${HOST}:${PORT}`);

  if (method === 'OPTIONS') {
    response.writeHead(204, buildJsonHeaders());
    response.end();
    return;
  }

  try {
    if (method === 'GET' && requestUrl.pathname === '/health') {
      writeJson(response, 200, healthPayload());
      return;
    }

    if (method === 'POST' && requestUrl.pathname === '/api/runtime/ensure') {
      const defTools = await ensureDefRestService();
      writeJson(response, 200, {
        ok: true,
        runtime: await ensureRuntime(readConfig().deepseek),
        defTools,
      });
      return;
    }

    if (method === 'POST' && requestUrl.pathname === '/api/native/session') {
      await ensureDefRestService();
      const body = await readJsonBody(request);
      const host = body.host === 'workbench' ? 'workbench' : 'ai-cli';
      const session = await createNativeHostSession({
        config: readConfig().deepseek,
        host,
        skillId: typeof body.skillId === 'string' ? body.skillId : undefined,
        thinkingEffort: body.thinkingEffort,
      });
      const binding = ensureNativeSessionAxisBinding(session.directory, session.sessionID);
      const axisContext = await syncNativeWorkbenchAxisBinding(binding);
      writeJson(response, 200, { ok: true, session: { ...session, axisContext } });
      return;
    }

    const nativeSessionRecovery = /^\/api\/native\/session\/([^/]+)\/recover$/.exec(requestUrl.pathname);
    if (method === 'POST' && nativeSessionRecovery) {
      const sessionID = decodeURIComponent(nativeSessionRecovery[1]);
      const body = await readJsonBody(request);
      const session = await recoverNativeHostSession({
        config: readConfig().deepseek,
        directory: typeof body.directory === 'string' ? body.directory : '',
        sessionID,
      });
      const binding = ensureNativeSessionAxisBinding(session.directory, session.sessionID);
      const axisContext = await syncNativeWorkbenchAxisBinding(binding);
      writeJson(response, 200, { ok: true, session: { ...session, axisContext } });
      return;
    }

    const nativeQuestionAction = /^\/api\/native\/question\/([^/]+)\/(reply|ignore|stop)$/.exec(requestUrl.pathname);
    if (method === 'POST' && nativeQuestionAction) {
      const requestID = decodeURIComponent(nativeQuestionAction[1]);
      const action = nativeQuestionAction[2];
      const body = await readJsonBody(request);
      const sessionID = typeof body.sessionID === 'string' ? body.sessionID : '';
      const binding = findNativeSessionBinding(sessionID);
      if (!binding) {
        writeJson(response, 404, { ok: false, error: 'native-session-binding-not-found' });
        return;
      }

      const runtime = runtimeSummary(readConfig().deepseek);
      const answers = Array.isArray(body.answers) ? body.answers : [];
      saveNativeQuestion({
        requestID,
        sessionID,
        directory: binding.directory,
        questions: body.questions,
        status: 'open',
      });

      if (action === 'stop') {
        await rejectPendingQuestions(runtime, binding.directory, sessionID);
        await fetch(`${runtime.serverUrl}/session/${encodeURIComponent(sessionID)}/abort?directory=${encodeURIComponent(binding.directory)}`, {
          method: 'POST',
          headers: { 'x-opencode-directory': encodeURIComponent(binding.directory) },
          signal: AbortSignal.timeout(OPENCODE_ACTION_TIMEOUT_MS),
        }).catch(() => undefined);
        saveNativeQuestion({ requestID, sessionID, directory: binding.directory, questions: body.questions, status: 'stopped' });
        writeJson(response, 200, { ok: true, status: 'stopped' });
        return;
      }

      const decision = await submitNativeQuestionDecision(runtime, {
        requestID,
        action: action === 'reply' ? 'reply' : 'reject',
        answers,
        binding,
      }).catch((error) => ({ ok: false, status: 0, body: error instanceof Error ? error.message : String(error) }));
      const status = action === 'reply' ? (decision.ok ? 'answered' : 'answered-stale') : 'ignored';
      saveNativeQuestion({
        requestID,
        sessionID,
        directory: binding.directory,
        questions: body.questions,
        answers,
        status,
        runtimeStatus: decision.ok ? 'resolved' : `runtime-${decision.status || 'unavailable'}`,
      });
      // Ignore is terminal from the user's perspective. A stale runtime Map must never re-open the card or throw a toast.
      writeJson(response, 200, { ok: true, status, runtimeResolved: decision.ok });
      return;
    }

    const nativeSessionDelete = /^\/api\/native\/session\/([^/]+)$/.exec(requestUrl.pathname);
    if (method === 'DELETE' && nativeSessionDelete) {
      const sessionID = decodeURIComponent(nativeSessionDelete[1]);
      const binding = findNativeSessionBinding(sessionID);
      if (!binding) {
        writeJson(response, 200, { ok: true, status: 'already-deleted' });
        return;
      }
      const runtime = runtimeSummary(readConfig().deepseek);
      await rejectPendingQuestions(runtime, binding.directory, sessionID);
      const upstream = await fetch(`${runtime.serverUrl}/session/${encodeURIComponent(sessionID)}?directory=${encodeURIComponent(binding.directory)}`, {
        method: 'DELETE',
        headers: { 'x-opencode-directory': encodeURIComponent(binding.directory) },
        signal: AbortSignal.timeout(OPENCODE_ACTION_TIMEOUT_MS),
      }).catch(() => undefined);
      if (upstream && !upstream.ok && upstream.status !== 404) {
        writeJson(response, upstream.status, { ok: false, error: 'native-session-delete-failed' });
        return;
      }
      deleteNativeQuestionRecords(sessionID);
      await removeNativeWorkbenchAxisBinding(binding);
      fs.rmSync(binding.directory, { recursive: true, force: true });
      writeJson(response, 200, { ok: true, status: 'deleted' });
      return;
    }

    if (method === 'GET' && requestUrl.pathname === '/api/native/bootstrap') {
      const sessionID = requestUrl.searchParams.get('sessionID') || '';
      const directory = requestUrl.searchParams.get('directory') || '';
      const binding = ensureNativeSessionAxisBinding(directory, sessionID);
      if (!binding) {
        writeJson(response, 404, { ok: false, error: 'native-session-binding-not-found' });
        return;
      }
      await migrateNativeSessionTitle(binding);
      const axisContext = await syncNativeWorkbenchAxisBinding(binding);
      writeJson(response, 200, { ok: true, binding, profile: binding.profile, axisContext });
      return;
    }

    if (method === 'GET' && requestUrl.pathname === '/api/native/node-review') {
      const sessionID = requestUrl.searchParams.get('sessionID') || '';
      const directory = requestUrl.searchParams.get('directory') || '';
      const binding = readNativeSessionBinding(directory, sessionID);
      if (!binding || binding.profile?.features?.nodeReview !== true) {
        writeJson(response, 403, { ok: false, error: 'node-review-not-permitted' });
        return;
      }
      const manifest = readJsonFileIfPresent(path.join(directory, 'node', 'manifest.json'));
      if (!manifest) {
        writeJson(response, 200, { ok: true, bound: false, diffs: [], report: null });
        return;
      }
      const files = ['selection.json', 'timeline.json', 'buffs.json', 'inputs.json'];
      const diffs = files.flatMap((name) => {
        const beforeValue = readJsonFileIfPresent(path.join(directory, 'node', 'base', name));
        const afterValue = readJsonFileIfPresent(path.join(directory, 'node', 'working', name));
        if (beforeValue === null || afterValue === null) return [];
        const before = `${JSON.stringify(beforeValue, null, 2)}\n`;
        const after = `${JSON.stringify(afterValue, null, 2)}\n`;
        if (before === after) return [];
        return [{ file: `node/working/${name}`, before, after, ...countChangedLines(before, after) }];
      });
      writeJson(response, 200, {
        ok: true,
        bound: true,
        diffs,
        report: {
          manifest,
          validation: readJsonFileIfPresent(path.join(directory, 'node', 'generated', 'validation.json')),
          semanticDiff: readJsonFileIfPresent(path.join(directory, 'node', 'generated', 'diff.json')),
          risk: readJsonFileIfPresent(path.join(directory, 'node', 'generated', 'risk.json')),
        },
      });
      return;
    }

    if (method === 'POST' && requestUrl.pathname === '/api/native/context') {
      const body = await readJsonBody(request);
      const saved = writeNativeWorkbenchContext(body.directory, body.sessionID, body.context);
      if (!saved) {
        writeJson(response, 403, { ok: false, error: 'invalid-workbench-session-binding' });
        return;
      }
      const binding = ensureNativeSessionAxisBinding(body.directory, body.sessionID);
      const axisContext = await syncNativeWorkbenchAxisBinding(binding);
      const checkoutState = updateNativeWorkbenchCheckoutState(binding, axisContext);
      writeJson(response, 200, { ok: true, context: saved, axisContext, checkoutState });
      return;
    }

    if (method === 'GET' && requestUrl.pathname === '/api/config/deepseek') {
      writeJson(response, 200, {
        ok: true,
        deepseek: summarizeConfig(readConfig().deepseek),
      });
      return;
    }

    if (method === 'POST' && requestUrl.pathname === '/api/config/deepseek') {
      const body = await readJsonBody(request);
      const config = writeConfig({
        deepseek: {
          apiKey: body.apiKey,
          baseUrl: body.baseUrl,
          model: body.model,
        },
      });
      writeJson(response, 200, {
        ok: true,
        deepseek: summarizeConfig(config.deepseek),
      });
      return;
    }

    if (method === 'GET' && requestUrl.pathname === '/api/skills') {
      writeJson(response, 200, {
        ok: true,
        skills: listSkills(),
      });
      return;
    }

    if (method === 'GET' && requestUrl.pathname === '/api/chat/sessions') {
      writeJson(response, 200, {
        ok: true,
        sessions: listChatSessions(),
      });
      return;
    }

    if (method === 'GET' && requestUrl.pathname === '/api/chat/persisted-sessions') {
      const sessions = await listPersistedDefSessions({
        config: readConfig().deepseek,
        limit: Number(requestUrl.searchParams.get('limit') || 100) || 100,
      });
      writeJson(response, 200, {
        ok: true,
        sessions,
      });
      return;
    }

    if (method === 'POST' && requestUrl.pathname === '/api/chat') {
      await ensureDefRestService();
      const body = await readJsonBody(request);
      const result = await runChat({
        config: readConfig().deepseek,
        message: body.message,
        thinkingEffort: body.thinkingEffort,
        skillId: body.skillId,
        workbenchContext: body.workbenchContext,
      });
      writeJson(response, result.ok ? 200 : 502, {
        ok: result.ok,
        result,
      });
      return;
    }

    if (method === 'POST' && requestUrl.pathname === '/api/chat/stream') {
      await ensureDefRestService();
      const body = await readJsonBody(request);
      let workbenchContext = body.workbenchContext;
      if (body.skillId === 'workbench' && (!workbenchContext || typeof workbenchContext !== 'object')) {
        try {
          const snapshotResponse = await fetch(`${defRestUrl}/api/main-workbench/snapshot`, { signal: AbortSignal.timeout(4000) });
          const snapshotBody = await snapshotResponse.json();
          const snapshot = snapshotBody?.snapshot || snapshotBody?.data || snapshotBody;
          if (snapshotResponse.ok && snapshotBody?.ok !== false) {
            workbenchContext = { schemaVersion: 1, source: 'sidecar-workbench-snapshot', updatedAt: Date.now(), snapshot };
          }
        } catch {
          workbenchContext = null;
        }
      }
      const result = await runChatStream({
        config: readConfig().deepseek,
        message: body.message,
        thinkingEffort: body.thinkingEffort,
        skillId: body.skillId,
        clientTurnId: body.clientTurnId,
        workbenchContext,
      });
      const binding = body.skillId === 'workbench'
        ? ensureNativeSessionAxisBinding(result.directory, result.sessionID)
        : null;
      const axisContext = await syncNativeWorkbenchAxisBinding(binding);
      writeJson(response, 200, {
        ok: true,
        sessionId: result.sessionId,
        sessionID: result.sessionID,
        axisContext,
      });
      return;
    }

    const eventsMatch = /^\/api\/chat\/([^/]+)\/events$/.exec(requestUrl.pathname);
    if (method === 'GET' && eventsMatch) {
      const sessionID = decodeURIComponent(eventsMatch[1]);
      const stream = getChatSessionStream(sessionID);
      if (!stream) {
        writeJson(response, 404, {
          ok: false,
          error: 'session-not-found',
        });
        return;
      }
      const fromSeq = Number(requestUrl.searchParams.get('from') || 0) || 0;
      writeSseHeaders(response);
      for (const event of stream.buffer) {
        if ((event.seq || 0) > fromSeq) writeSse(response, event);
      }
      const onEvent = (event) => writeSse(response, event);
      stream.eventEmitter.on('event', onEvent);
      const heartbeat = setInterval(() => {
        response.write(`event: heartbeat\ndata: ${JSON.stringify({ ok: true, sessionId: sessionID, at: Date.now() })}\n\n`);
      }, 15000);
      request.on('close', () => {
        clearInterval(heartbeat);
        stream.eventEmitter.off('event', onEvent);
      });
      return;
    }

    const persistedMatch = /^\/api\/chat\/([^/]+)\/persisted$/.exec(requestUrl.pathname);
    if (method === 'GET' && persistedMatch) {
      const sessionID = decodeURIComponent(persistedMatch[1]);
      const persisted = await getPersistedDefSession(sessionID, { config: readConfig().deepseek });
      writeJson(response, 200, {
        ok: true,
        session: persisted.summary,
      });
      return;
    }

    const transcriptMatch = /^\/api\/chat\/([^/]+)\/transcript$/.exec(requestUrl.pathname);
    if (method === 'GET' && transcriptMatch) {
      const sessionID = decodeURIComponent(transcriptMatch[1]);
      const transcript = getLiveDefTranscript(sessionID) || await hydrateDefSession(sessionID, { config: readConfig().deepseek });
      writeJson(response, 200, {
        ok: true,
        ...transcript,
      });
      return;
    }

    const messageMatch = /^\/api\/chat\/([^/]+)\/message$/.exec(requestUrl.pathname);
    if (method === 'POST' && messageMatch) {
      await ensureDefRestService();
      const sessionID = decodeURIComponent(messageMatch[1]);
      const body = await readJsonBody(request);
      const result = await continueChat(sessionID, body.message, body.clientTurnId, {
        config: readConfig().deepseek,
        thinkingEffort: body.thinkingEffort,
        skillId: body.skillId,
        workbenchContext: body.workbenchContext,
      });
      const binding = body.skillId === 'workbench'
        ? ensureNativeSessionAxisBinding(result.directory, result.sessionID)
        : null;
      const axisContext = await syncNativeWorkbenchAxisBinding(binding);
      writeJson(response, 200, {
        ok: true,
        sessionId: result.sessionId,
        sessionID: result.sessionID,
        axisContext,
      });
      return;
    }

    const stopMatch = /^\/api\/chat\/([^/]+)\/stop$/.exec(requestUrl.pathname);
    if (method === 'POST' && stopMatch) {
      const sessionID = decodeURIComponent(stopMatch[1]);
      writeJson(response, 200, {
        ok: true,
        result: await stopChat(sessionID),
      });
      return;
    }

    if (method === 'POST' && requestUrl.pathname === '/api/chat/stop') {
      writeJson(response, 200, {
        ok: true,
        result: await stopChat(),
      });
      return;
    }

    const nativeQuestionDecision = /^\/question\/([^/]+)\/(reply|reject)$/.exec(requestUrl.pathname);
    if (method === 'POST' && nativeQuestionDecision) {
      const runtime = runtimeSummary(readConfig().deepseek);
      const requestedDirectory = readRequestDirectory(request, requestUrl);
      const requestID = decodeURIComponent(nativeQuestionDecision[1]);
      const action = nativeQuestionDecision[2];
      const nativeSessionID = decodeURIComponent(readRequestHeader(request, 'x-def-question-session'));
      const nativeBinding = findNativeSessionBinding(nativeSessionID);
      const directory = nativeBinding?.directory || requestedDirectory;
      const pending = await fetch(`${runtime.serverUrl}/question?directory=${encodeURIComponent(directory)}`).then((item) => item.json());
      const requestRecord = Array.isArray(pending) ? pending.find((item) => item?.id === requestID) : null;
      const decisionBody = action === 'reply' ? await readJsonBody(request) : {};
      const upstreamUrl = new URL(`${requestUrl.pathname}?directory=${encodeURIComponent(directory)}`, runtime.serverUrl);
      const upstreamHeaders = Object.fromEntries(
        Object.entries(request.headers)
          .filter(([name, value]) => name !== 'host' && name !== 'content-length' && name !== 'transfer-encoding' && value !== undefined)
          .map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : value]),
      );
      upstreamHeaders['x-opencode-directory'] = encodeURIComponent(directory);
      if (action === 'reply') upstreamHeaders['content-type'] = 'application/json';
      const upstream = await fetch(upstreamUrl, {
        method: 'POST',
        headers: upstreamHeaders,
        body: action === 'reply' ? JSON.stringify(decisionBody) : undefined,
      });
      const upstreamText = await upstream.text();
      if (upstream.ok && requestRecord) {
        const nodeBinding = readJsonFileIfPresent(path.join(directory, '.def-node.json'));
        await fetch(`${defRestUrl}/api/def-tools/call`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tool: 'def.user.record_answer',
            input: {
              nativeRequestId: requestID,
              sessionId: requestRecord.sessionID || '',
              workNodeId: nodeBinding?.nodeId || '',
              createdAt: requestRecord.time?.created,
              status: action === 'reply' ? 'answered' : 'rejected',
              questions: requestRecord.questions || [],
              answers: decisionBody.answers || [],
            },
          }),
        }).catch(() => undefined);
      }
      response.writeHead(upstream.status, buildJsonHeaders());
      response.end(upstreamText);
      return;
    }

    const deniedNativeRoute = /\/pty(\/|$)/.test(requestUrl.pathname)
      || (method !== 'GET' && /\/(vcs|share|unshare|project|worktree|config|provider|auth)(\/|$)/.test(requestUrl.pathname));
    if (deniedNativeRoute) {
      writeJson(response, 403, { ok: false, error: 'disabled-by-def-feature-matrix', path: requestUrl.pathname });
      return;
    }

    // The embedded UI asks OpenCode for every registry provider on startup.
    // DEF locks the model to its configured DeepSeek provider, so proxying that
    // multi-megabyte registry only delays the first paint and exposes irrelevant
    // provider metadata to the renderer.
    if (method === 'GET' && requestUrl.pathname === '/provider') {
      writeJson(response, 200, buildEmbeddedProviderCatalog(readConfig().deepseek));
      return;
    }

    if (serveOpenCodeUi(request, response, requestUrl)) return;
    if (await proxyOpenCodeRequest(request, response)) return;

    writeJson(response, 404, {
      ok: false,
      error: 'not-found',
      path: requestUrl.pathname,
    });
  } catch (error) {
    const errorCode = error && typeof error === 'object' && typeof error.code === 'string' ? error.code : undefined;
    writeJson(response, errorCode === 'DEF_SESSION_SKILL_MISMATCH' ? 409 : 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      ...(errorCode ? { code: errorCode } : {}),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[def-agent-sidecar] listening on http://${HOST}:${PORT}`);
});

function shutdownAndExit(signal) {
  try {
    shutdownRuntime();
    if (defRestProcess && defRestProcess.exitCode === null) defRestProcess.kill('SIGTERM');
  } finally {
    server.close(() => process.exit(signal === 'SIGINT' ? 130 : 0));
    setTimeout(() => process.exit(signal === 'SIGINT' ? 130 : 0), 1500).unref();
  }
}

process.once('SIGTERM', () => shutdownAndExit('SIGTERM'));
process.once('SIGINT', () => shutdownAndExit('SIGINT'));
process.once('exit', () => {
  shutdownRuntime();
});
