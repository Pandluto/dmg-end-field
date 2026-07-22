const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
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
  getNativeHarnessSystem,
  recoverNativeHostSession,
  buildNativeHostProfile,
  readNativeSessionBinding,
  ensureNativeSessionAxisBinding,
  findNativeSessionBinding,
  writeNativeWorkbenchContext,
} = require('../runtime/def-opencode-adapter/index.cjs');
const {
  buildWorkbenchCheckoutSystemPrompt,
  buildWorkbenchContextSystemPrompt,
} = require('./workbench-system-prompts.cjs');
const { isAuthorizedNativeSessionCleanupRequest } = require('./native-session-cleanup-auth.cjs');
const {
  createNativeSessionAdmissionGate,
  evaluateNativeSessionAdmissionObservation,
  nativeMessageID,
} = require('./native-session-admission.cjs');

const HOST = '127.0.0.1';
const PORT = Number(process.env.DEF_AGENT_PORT || 17322);
const projectRoot = path.resolve(__dirname, '..', '..');
const runtimeRoot = path.join(projectRoot, 'agent', 'runtime');
const defRuntimeRoot = path.join(runtimeRoot, 'def');
const openCodeUiRoot = path.join(runtimeRoot, 'opencode-ui');
const configPath = path.join(projectRoot, '.runtime', 'def-agent', 'config.json');
const questionStorePath = path.join(projectRoot, '.runtime', 'def-agent', 'questions.sqlite3');
const nativeAiCliSessionsRoot = path.resolve(os.tmpdir(), 'dmg-end-field', 'def-agent-workspace', 'sessions', 'ai-cli');
const OPENCODE_ACTION_TIMEOUT_MS = 5000;
const NATIVE_SESSION_ADMISSION_POLL_MS = 250;
const NATIVE_SESSION_ADMISSION_START_TIMEOUT_MS = 15000;
const startedAt = Date.now();
const defRestUrl = process.env.DEF_REST_BASE_URL || 'http://127.0.0.1:17321';
const defInternalGovernanceToken = typeof process.env.DEF_INTERNAL_GOVERNANCE_TOKEN === 'string' && process.env.DEF_INTERNAL_GOVERNANCE_TOKEN.trim()
  ? process.env.DEF_INTERNAL_GOVERNANCE_TOKEN.trim()
  : crypto.randomUUID();
const DEF_WORKBENCH_MARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="4" y="4" width="24" height="24" fill="none" stroke="#111" stroke-width="1.5"/><path d="M10 10h12M10 16h8M10 22h12M20 13v6l3-3z" fill="none" stroke="#111" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"/></svg>';
const DEF_WORKBENCH_MARK_DATA_URL = `data:image/svg+xml,${encodeURIComponent(DEF_WORKBENCH_MARK_SVG)}`;
let defRestProcess = null;
let questionStore = null;
// Bridge requests can lose their HTTP response after prompt_async accepted the
// turn. Keep the sidecar's acceptance keyed by the caller correlation so a
// retry joins the original operation instead of issuing another prompt.
const nativeInteropPromptRequests = new Map();
const nativeSessionCleanupInFlight = new Map();
// OpenCode only single-flights its LLM loop. A second prompt can otherwise
// create another user message before that loop gate is reached, so admission
// belongs at this sidecar boundary shared by UI and interop ingress.
const nativeSessionAdmission = createNativeSessionAdmissionGate();

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
      env: { ...process.env, DEF_REST_BASE_URL: defRestUrl, DEF_INTERNAL_GOVERNANCE_TOKEN: defInternalGovernanceToken },
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

async function registerNativeCatalogSession(session) {
  const sessionId = typeof session?.sessionID === 'string' ? session.sessionID.trim() : '';
  const host = session?.host === 'workbench' ? 'workbench' : session?.host === 'ai-cli' ? 'ai-cli' : '';
  if (!sessionId || !host) throw new Error('Native catalog session registration requires a native session id and host.');
  const response = await fetch(`${defRestUrl}/api/def-tools/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-def-internal-token': defInternalGovernanceToken },
    body: JSON.stringify({ tool: 'def.native_catalog.register_session', input: { sessionId, host } }),
    signal: AbortSignal.timeout(5000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true || payload?.result?.ok !== true) {
    throw new Error(payload?.error?.message || `Native catalog session registration failed: HTTP ${response.status}`);
  }
  return payload.result;
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

// This is intentionally not CORS-enabled.  Only Electron's native loopback
// bridge is allowed to call the destructive cleanup endpoint.
function writeNativeSessionCleanupJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
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

function buildEmbeddedWorkbenchProject() {
  return [{
    id: 'global',
    name: 'DEF 排轴工作台',
    worktree: '/',
    time: { created: 0, updated: Date.now() },
    sandboxes: [],
    icon: { override: DEF_WORKBENCH_MARK_DATA_URL },
  }];
}

function buildEmbeddedBrandingScript(profile, session) {
  const title = profile?.host === 'workbench' ? 'DEF · 排轴助手' : 'DEF · 数据助手';
  const mark = JSON.stringify(DEF_WORKBENCH_MARK_DATA_URL);
  return `<link rel="icon" type="image/svg+xml" href="/def-workbench-mark.svg"/><script>window.__DEF_EMBEDDED_PROFILE__=${JSON.stringify(profile)};window.__DEF_NATIVE_SESSION__=${JSON.stringify(session)};try{localStorage.setItem("opencode.settings.dat:defaultServerUrl",location.origin)}catch{};(()=>{const mark=${mark};const apply=()=>{document.querySelectorAll('[data-slot="project-avatar-surface"]').forEach((element)=>{if(element.dataset.defWorkbenchMark||element.querySelector('img'))return;element.dataset.defWorkbenchMark='';element.textContent='';element.setAttribute('aria-label','DEF 工作台');element.style.backgroundImage='url("'+mark+'")';element.style.backgroundPosition='center';element.style.backgroundRepeat='no-repeat';element.style.backgroundSize='78%';element.style.backgroundColor='#fff';})};const watch=()=>{apply();new MutationObserver(apply).observe(document.documentElement,{childList:true,subtree:true})};document.readyState==='loading'?document.addEventListener('DOMContentLoaded',watch,{once:true}):watch();document.title=${JSON.stringify(title)};})();</script>`;
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

function compactInteropValue(value, limit = 600) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function readStoredJson(value) {
  if (typeof value !== 'string' || !value) return [];
  try { return JSON.parse(value); } catch { return []; }
}

function safeInteropQuestions(value) {
  return Array.isArray(value)
    ? value.slice(0, 8).map((question) => ({
      header: compactInteropValue(question?.header || question?.title || '', 240),
      question: compactInteropValue(question?.question || question?.text || '', 600),
      options: Array.isArray(question?.options)
        ? question.options.slice(0, 12).map((option) => ({
          label: compactInteropValue(option?.label || option?.title || option || '', 240),
          description: compactInteropValue(option?.description || option?.detail || '', 400),
        }))
        : [],
    }))
    : [];
}

function safeInteropAnswers(value) {
  return Array.isArray(value)
    ? value.slice(0, 16).map((answer) => {
      if (typeof answer === 'string' || typeof answer === 'number' || typeof answer === 'boolean') return compactInteropValue(answer, 400);
      if (Array.isArray(answer)) return answer.slice(0, 12).map((item) => compactInteropValue(item, 400));
      if (answer && typeof answer === 'object') {
        return Object.fromEntries(Object.entries(answer).slice(0, 16).map(([key, item]) => [key, compactInteropValue(item, 400)]));
      }
      return null;
    })
    : [];
}

function readStoredNativeQuestions(sessionID) {
  return getQuestionStore().prepare(`
    SELECT request_id, session_id, questions_json, status, answers_json, runtime_status, created_at, updated_at
    FROM def_native_question WHERE session_id = ? ORDER BY updated_at DESC LIMIT 32
  `).all(sessionID).map((row) => ({
    requestId: row.request_id,
    sessionId: row.session_id,
    questions: safeInteropQuestions(readStoredJson(row.questions_json)),
    status: row.status,
    answers: safeInteropAnswers(readStoredJson(row.answers_json)),
    runtimeStatus: row.runtime_status || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
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
    const legacyDefault = binding.host === 'workbench'
      ? title === '新建排轴会话' || title === '排轴会话'
      : /^新建 .+ 会话$/.test(title) || title === 'DEF 数据会话';
    if (!legacyDefault && !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(title)) return;
    const nextTitle = binding.host === 'workbench' ? '排轴助手' : 'DEF 数据助手';
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
  if (requestedPath === '/def-workbench-mark.svg') {
    response.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    response.end(request.method === 'HEAD' ? undefined : DEF_WORKBENCH_MARK_SVG);
    return true;
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
  // The local OpenCode UI normalizes an embedded native session to either
  // `/{directorySlug}/session/{sessionId}` or
  // `/server/{directorySlug}/session/{sessionId}`. Both are client-document
  // routes served from this static UI.
  const sessionRouteIndex = routeParts.lastIndexOf('session');
  const directorySlug = sessionRouteIndex > 0 ? routeParts[sessionRouteIndex - 1] : '';
  const sessionID = sessionRouteIndex >= 0 ? routeParts[sessionRouteIndex + 1] : '';
  const isNativeSessionRoute = Boolean(
    directorySlug
    && sessionID
    && (sessionRouteIndex === 1 || (sessionRouteIndex === 2 && routeParts[0] === 'server')),
  );
  if (isNativeSessionRoute) {
    try {
      const decodedSessionID = decodeURIComponent(sessionID);
      // `/server/<key>/session/<id>` stores the OpenCode server key rather
      // than a DEF workspace directory.  The stable session id is therefore
      // the authority for the active binding; retain the direct-directory
      // lookup only for the older local route shape.
      const directory = Buffer.from(directorySlug, 'base64url').toString('utf8');
      const binding = findNativeSessionBinding(decodedSessionID)
        || readNativeSessionBinding(directory, decodedSessionID);
      embeddedProfile = binding?.profile || null;
      if (binding) {
        embeddedSession = { sessionID: decodedSessionID, directory: binding.directory };
      }
    } catch {
      embeddedProfile = null;
      embeddedSession = null;
    }
  }
  if (!embeddedProfile) {
    const requestedHost = requestUrl.searchParams.get('def_host') === 'workbench' ? 'workbench' : 'ai-cli';
    embeddedProfile = buildNativeHostProfile(requestedHost);
  }
  const embeddedTitle = embeddedProfile.host === 'workbench' ? 'DEF · 排轴助手' : 'DEF · 数据助手';
  const body = isIndex
    ? Buffer.from(fileBody.toString('utf8').replace('<title>OpenCode</title>', `<title>${embeddedTitle}</title>`).replace(
      '</head>',
      `${buildEmbeddedBrandingScript(embeddedProfile, embeddedSession)}</head>`,
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

async function fetchNativeSessionMessages(runtime, binding, sessionID) {
  const response = await fetch(
    `${runtime.serverUrl}/session/${encodeURIComponent(sessionID)}/message?directory=${encodeURIComponent(binding.directory)}`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok) {
    const error = new Error(`native-session-transcript-failed-${response.status}`);
    error.status = response.status;
    throw error;
  }
  const messages = await response.json();
  return Array.isArray(messages) ? messages : [];
}

async function fetchNativeSessionStatus(runtime, binding) {
  const response = await fetch(
    `${runtime.serverUrl}/session/status?directory=${encodeURIComponent(binding.directory)}`,
    { signal: AbortSignal.timeout(OPENCODE_ACTION_TIMEOUT_MS) },
  );
  if (!response.ok) {
    const error = new Error(`native-session-status-failed-${response.status}`);
    error.status = response.status;
    throw error;
  }
  const status = await response.json();
  return status && typeof status === 'object' ? status : {};
}

async function captureNativeSessionAdmissionBaseline(admission, runtime, binding) {
  if (!admission) return;
  try {
    const messages = await fetchNativeSessionMessages(runtime, binding, admission.sessionID);
    admission.baselineMessageIds = new Set(messages.map(nativeMessageID).filter(Boolean));
    admission.baselineKnown = true;
  } catch {
    admission.baselineKnown = false;
  }
}

async function observeNativeSessionAdmission(admission, runtime, binding) {
  const [statusResult, transcriptResult] = await Promise.allSettled([
    fetchNativeSessionStatus(runtime, binding),
    fetchNativeSessionMessages(runtime, binding, admission.sessionID),
  ]);
  const statuses = statusResult.status === 'fulfilled' ? statusResult.value : null;
  const messages = transcriptResult.status === 'fulfilled' ? transcriptResult.value : null;
  return evaluateNativeSessionAdmissionObservation(admission, {
    statuses,
    messages,
    now: Date.now(),
    startTimeoutMs: NATIVE_SESSION_ADMISSION_START_TIMEOUT_MS,
  });
}

function scheduleNativeSessionAdmissionWatch(admission, runtime, binding) {
  if (!admission || admission.watchStarted) return;
  admission.watchStarted = true;
  void nativeSessionAdmission.watch(
    admission,
    (entry) => observeNativeSessionAdmission(entry, runtime, binding),
    { intervalMs: NATIVE_SESSION_ADMISSION_POLL_MS },
  );
}

function retainNativePromptAdmissionForReconciliation(admission, runtime, binding) {
  if (!admission) return;
  admission.submissionState = 'unknown';
  scheduleNativeSessionAdmissionWatch(admission, runtime, binding);
}

async function proxyOpenCodeRequest(request, response) {
  const runtime = runtimeSummary(readConfig().deepseek);
  if (!runtime.running || !runtime.serverUrl) return Promise.resolve(false);
  const target = new URL(request.url || '/', runtime.serverUrl);
  // Native DEF sessions are served under an encoded workspace-directory prefix:
  // `/{directorySlug}/session/{sessionId}`.  Keep accepting the unprefixed
  // OpenCode route as well, but do not assume the prefix is literally `server`.
  await rejectPendingQuestionsForSessionAbort(runtime, request, target);
  // These six endpoints create a user message or enter the native prompt
  // runner. Do not let command, shell, compaction, or initialization bypass
  // the same session-level admission used by a UI message and interop.
  const sessionActionMatch = /^\/session\/([^/]+)\/(message|prompt_async|command|shell|summarize|init|abort)$/.exec(target.pathname);
  let rewrittenBody = null;
  let binding = null;
  let admission = null;
  let sessionAction = '';
  let nativeSessionID = '';
  try {
    if (request.method === 'POST' && sessionActionMatch) {
      nativeSessionID = decodeURIComponent(sessionActionMatch[1]);
      sessionAction = sessionActionMatch[2];
      const directory = target.searchParams.get('directory') || '';
      binding = findNativeSessionBinding(nativeSessionID) || readNativeSessionBinding(directory, nativeSessionID);
      if (binding && sessionAction !== 'abort') {
        const admissionSource = {
          message: 'ui',
          prompt_async: 'proxy-prompt-async',
          command: 'proxy-command',
          shell: 'proxy-shell',
          summarize: 'proxy-summarize',
          init: 'proxy-init',
        }[sessionAction] || 'proxy-native-turn';
        admission = nativeSessionAdmission.admit({ sessionID: nativeSessionID, source: admissionSource }).entry;
        await captureNativeSessionAdmissionBaseline(admission, runtime, binding);
      }
    }
    if (request.method === 'POST' && sessionAction === 'message' && binding) {
      const sessionID = nativeSessionID;
      const axisContext = binding.host === 'workbench' ? await syncNativeWorkbenchAxisBinding(binding) : null;
      const incoming = await readJsonBody(request);
      const userText = Array.isArray(incoming.parts)
        ? incoming.parts.filter((part) => part?.type === 'text').map((part) => String(part.text || '')).join('\n').trim()
        : '';
      const workbenchContext = binding.host === 'workbench'
        ? readNativeWorkbenchContext(binding)
        : null;
      const harness = getNativeHarnessSystem(binding, userText);
      const checkoutState = binding.host === 'workbench' ? updateNativeWorkbenchCheckoutState(binding, axisContext) : null;
      const selectedSystem = binding.host === 'workbench'
        ? buildWorkbenchContextSystemPrompt(workbenchContext, [harness.system, incoming.system].filter(Boolean).join('\n\n'))
        : incoming.system;
      rewrittenBody = Buffer.from(JSON.stringify({
        ...incoming,
        agent: binding.agent,
        ...(binding.host === 'workbench' ? {
          system: checkoutState
            ? buildWorkbenchCheckoutSystemPrompt(checkoutState, selectedSystem, incoming.parts, harness.turnRoute?.task)
            : selectedSystem,
        } : {}),
      }), 'utf8');
    }
  } catch (error) {
    if (admission) nativeSessionAdmission.release(admission, 'submission-failed');
    throw error;
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
      upstreamResponse.on('end', () => {
        const succeeded = (upstreamResponse.statusCode || 502) >= 200 && (upstreamResponse.statusCode || 502) < 300;
        const abortConfirmed = sessionAction === 'abort' && (succeeded || upstreamResponse.statusCode === 404);
        if (abortConfirmed) nativeSessionAdmission.releaseSession(nativeSessionID, 'native-abort');
        if (admission) {
          if (!succeeded) nativeSessionAdmission.release(admission, 'submission-failed');
          // Vendor semantics differ here: `prompt_async` acknowledges before
          // the runner completes, so preserve the reservation for the
          // status/transcript watcher. `message`, `command`, `shell`,
          // `summarize`, and `init` return only after their native work has
          // completed; their finished 2xx response is terminal evidence for
          // that ingress.
          else if (sessionAction === 'prompt_async') scheduleNativeSessionAdmissionWatch(admission, runtime, binding);
          else nativeSessionAdmission.release(admission, `native-${sessionAction}-terminal`);
        }
        resolve(true);
      });
      upstreamResponse.on('error', (error) => {
        const explicitRejection = (upstreamResponse.statusCode || 0) < 200 || (upstreamResponse.statusCode || 0) >= 300;
        if (admission && !explicitRejection) retainNativePromptAdmissionForReconciliation(admission, runtime, binding);
        else if (admission) nativeSessionAdmission.release(admission, 'submission-failed');
        reject(error);
      });
    });
    upstream.on('error', (error) => {
      if (admission) retainNativePromptAdmissionForReconciliation(admission, runtime, binding);
      reject(error);
    });
    if (rewrittenBody) {
      upstream.end(rewrittenBody);
      return;
    }
    request.pipe(upstream);
  });
}

async function readNativeInteropTranscript(sessionID) {
  const binding = findNativeSessionBinding(sessionID);
  if (!binding) {
    const error = new Error('native-session-binding-not-found');
    error.status = 404;
    throw error;
  }
  const runtime = await ensureRuntime(readConfig().deepseek);
  return { binding, messages: await fetchNativeSessionMessages(runtime, binding, sessionID) };
}

async function readNativeInteropQuestions(sessionID) {
  const binding = findNativeSessionBinding(sessionID);
  if (!binding || binding.host !== 'workbench') {
    const error = new Error('native-workbench-session-binding-not-found');
    error.status = 404;
    throw error;
  }
  const runtime = await ensureRuntime(readConfig().deepseek);
  const response = await fetch(`${runtime.serverUrl}/question?directory=${encodeURIComponent(binding.directory)}`, {
    signal: AbortSignal.timeout(OPENCODE_ACTION_TIMEOUT_MS),
  });
  if (!response.ok) {
    const error = new Error(`native-question-list-failed-${response.status}`);
    error.status = response.status;
    throw error;
  }
  const payload = await response.json();
  const liveQuestions = Array.isArray(payload) ? payload : [];
  const stored = new Map(readStoredNativeQuestions(sessionID).map((item) => [item.requestId, item]));
  for (const question of liveQuestions) {
    if (question?.sessionID !== sessionID || !question?.id) continue;
    if (stored.get(question.id)?.status === 'open') continue;
    saveNativeQuestion({
      requestID: question.id,
      sessionID,
      directory: binding.directory,
      questions: question.questions,
      status: 'open',
    });
  }
  const records = new Map(readStoredNativeQuestions(sessionID).map((item) => [item.requestId, item]));
  for (const question of liveQuestions) {
    if (question?.sessionID !== sessionID || !question?.id) continue;
    records.set(question.id, {
      requestId: question.id,
      sessionId: sessionID,
      questions: safeInteropQuestions(question.questions),
      status: 'open',
      answers: records.get(question.id)?.answers || [],
      runtimeStatus: 'pending',
      createdAt: question?.time?.created || records.get(question.id)?.createdAt || Date.now(),
      updatedAt: records.get(question.id)?.updatedAt || question?.time?.created || Date.now(),
    });
  }
  return { binding, questions: [...records.values()].sort((left, right) => right.updatedAt - left.updatedAt) };
}

function nativeInteropCorrelationKey(sessionID, correlation) {
  const clientTurnId = typeof correlation?.clientTurnId === 'string' ? correlation.clientTurnId.trim() : '';
  if (!clientTurnId || correlation?.sessionId !== sessionID) return '';
  return `${sessionID}:${clientTurnId}`;
}

async function sendNativeInteropPrompt(sessionID, body) {
  const key = nativeInteropCorrelationKey(sessionID, body?.correlation);
  if (key) {
    const existing = nativeInteropPromptRequests.get(key);
    if (existing) return { ...(await existing.promise), idempotent: true };
  }

  const admissionResult = nativeSessionAdmission.admit({ sessionID, idempotencyKey: key, source: 'interop' });
  if (admissionResult.kind === 'idempotent') {
    const result = admissionResult.entry.result || await admissionResult.entry.promise;
    return { ...(result || {}), idempotent: true };
  }
  const admission = admissionResult.entry;
  const entry = { createdAt: Date.now(), admission, promise: null };
  entry.promise = sendNativeInteropPromptOnce(sessionID, body, admission);
  admission.promise = entry.promise;
  if (key) {
    nativeInteropPromptRequests.set(key, entry);
    if (nativeInteropPromptRequests.size > 512) {
      const oldest = nativeInteropPromptRequests.keys().next().value;
      if (oldest && oldest !== key) nativeInteropPromptRequests.delete(oldest);
    }
  }
  try {
    const result = await entry.promise;
    admission.result = result;
    return result;
  } catch (error) {
    // A rejected request was not accepted by prompt_async, so a later caller
    // may safely start a fresh operation after diagnosing the failure.
    nativeSessionAdmission.release(admission, 'submission-failed');
    if (key) nativeInteropPromptRequests.delete(key);
    throw error;
  }
}

async function sendNativeInteropPromptOnce(sessionID, body, admission) {
  const binding = findNativeSessionBinding(sessionID);
  if (!binding || binding.host !== 'workbench') {
    const error = new Error('native-workbench-session-binding-not-found');
    error.status = 404;
    throw error;
  }
  const requestedHarness = typeof body?.harnessSelector === 'string' ? body.harnessSelector.trim() : '';
  if (requestedHarness) {
    const pinned = binding.harnessBinding?.harness;
    const matches = requestedHarness === binding.harnessBinding?.selector
      || requestedHarness === `${pinned?.harnessId || ''}@${pinned?.version || ''}`;
    if (!matches) {
      const error = new Error('BLOCKED_HARNESS_LOAD: native session is pinned to a different Harness.');
      error.code = 'BLOCKED_HARNESS_LOAD';
      error.status = 409;
      throw error;
    }
  }
  const rawUserText = typeof body?.rawUserText === 'string' ? body.rawUserText.trim() : '';
  const providerVisibleUserText = typeof body?.providerVisibleUserText === 'string'
    ? body.providerVisibleUserText.trim()
    : '';
  if (!rawUserText || rawUserText !== providerVisibleUserText) {
    const error = new Error('pure-blackbox-user-text-mismatch');
    error.status = 400;
    throw error;
  }
  const ingressMode = body?.ingressMode === 'diagnostic' ? 'diagnostic' : 'pure-blackbox';
  const diagnostic = ingressMode === 'diagnostic' && body?.diagnostic && typeof body.diagnostic === 'object'
    ? body.diagnostic
    : null;
  const runtime = await ensureRuntime(readConfig().deepseek);
  await captureNativeSessionAdmissionBaseline(admission, runtime, binding);
  const axisContext = await syncNativeWorkbenchAxisBinding(binding);
  const checkoutState = updateNativeWorkbenchCheckoutState(binding, axisContext);
  const workbenchContext = readNativeWorkbenchContext(binding);
  const harness = getNativeHarnessSystem(binding, rawUserText);
  const diagnosticSystem = diagnostic
    ? `Diagnostic ingress. Purpose: ${String(diagnostic.purpose || '').slice(0, 240)}. Scope: ${String(diagnostic.scope || '').slice(0, 240)}. Mutation allowed: ${diagnostic.mutationAllowed === true}. This diagnostic marker is not user text.`
    : undefined;
  const selectedSystem = buildWorkbenchContextSystemPrompt(workbenchContext, [harness.system, diagnosticSystem].filter(Boolean).join('\n\n'));
  const payload = {
    agent: binding.agent,
    model: { providerID: 'deepseek', modelID: sanitizeDeepSeekConfig(readConfig().deepseek).model },
    system: checkoutState
      ? buildWorkbenchCheckoutSystemPrompt(checkoutState, selectedSystem, [{ type: 'text', text: rawUserText }], harness.turnRoute?.task)
      : selectedSystem,
    parts: [{ type: 'text', text: rawUserText }],
  };
  const result = (submissionState = 'accepted', accepted = null) => ({
    binding,
    ingressMode,
    submissionState,
    acceptedAt: Date.now(),
    nativeUserMessageId: String(accepted?.info?.id || accepted?.message?.id || accepted?.id || ''),
    providerVisibleMessages: [
      { role: 'system', source: 'workbench-context', text: payload.system },
      { role: 'user', text: rawUserText },
    ],
    harnessBinding: harness.binding,
    sessionHarnessBinding: harness.sessionBinding || harness.binding,
    harnessRoute: harness.turnRoute || null,
    harnessWarning: harness.warning,
    agentRelease: binding.agentRelease || null,
  });
  let response;
  try {
    response = await fetch(
      `${runtime.serverUrl}/session/${encodeURIComponent(sessionID)}/prompt_async?directory=${encodeURIComponent(binding.directory)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-def-interop': 'v1' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      },
    );
  } catch {
    // The request may have reached OpenCode even though its response did not.
    // Keep the single-flight reservation and reconcile transcript/status rather
    // than allowing the bridge to resend this client turn.
    retainNativePromptAdmissionForReconciliation(admission, runtime, binding);
    return result('unknown');
  }
  if (!response.ok) {
    const error = new Error(`native-session-prompt-failed-${response.status}`);
    error.status = response.status;
    throw error;
  }
  const accepted = await response.json().catch(() => null);
  scheduleNativeSessionAdmissionWatch(admission, runtime, binding);
  return result('accepted', accepted);
}

async function abortNativeSession(runtime, binding, sessionID, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  let response;
  try {
    response = await fetchImpl(
      `${runtime.serverUrl}/session/${encodeURIComponent(sessionID)}/abort?directory=${encodeURIComponent(binding.directory)}`,
      {
        method: 'POST',
        headers: { 'x-opencode-directory': encodeURIComponent(binding.directory) },
        signal: AbortSignal.timeout(OPENCODE_ACTION_TIMEOUT_MS),
      },
    );
  } catch {
    return { ok: false, code: 'NATIVE_SESSION_ABORT_FAILED', httpStatus: 502 };
  }
  if (!response?.ok && response?.status !== 404) {
    return { ok: false, code: 'NATIVE_SESSION_ABORT_FAILED', httpStatus: response?.status || 502 };
  }
  return { ok: true, status: response?.status || 200, reason: response?.status === 404 ? 'already-complete' : 'requested' };
}

function throwNativeAbortFailure(result, action) {
  const error = new Error(`${action}-failed-${result?.httpStatus || 502}`);
  error.code = result?.code || 'NATIVE_SESSION_ABORT_FAILED';
  error.status = result?.httpStatus || 502;
  throw error;
}

async function stopNativeInteropPrompt(sessionID) {
  const binding = findNativeSessionBinding(sessionID);
  if (!binding || binding.host !== 'workbench') {
    const error = new Error('native-workbench-session-binding-not-found');
    error.status = 404;
    throw error;
  }
  const runtime = await ensureRuntime(readConfig().deepseek);
  const aborted = await abortNativeSession(runtime, binding, sessionID);
  if (!aborted.ok) throwNativeAbortFailure(aborted, 'native-session-stop');
  nativeSessionAdmission.releaseSession(sessionID, 'native-abort');
  return { reason: aborted.reason };
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
  if (current?.targetType === 'work-node') session.boundNodeId = current.targetId;
  else delete session.boundNodeId;
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

async function syncNativeWorkbenchAxisBinding(binding) {
  if (!binding || binding.host !== 'workbench') return null;
  const current = binding.axisBindingId ? binding : ensureNativeSessionAxisBinding(binding.directory, binding.sessionID);
  if (!current?.axisBindingId || !current.timelineId) {
    const error = new Error('Workbench DEF sessions require an immutable timeline binding.');
    error.code = 'BLOCKED_BINDING';
    throw error;
  }
  await ensureDefRestService();
  const bindAxis = async (boundNodeId = '') => {
    const response = await fetch(`${defRestUrl}/api/def-tools/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-def-internal-token': defInternalGovernanceToken },
      body: JSON.stringify({
        tool: 'def.workbench.bind_session_axis',
        input: {
          sessionBindingId: current.axisBindingId,
          sessionID: current.sessionID,
          host: 'workbench',
          timelineId: current.timelineId,
          boundNodeId: boundNodeId || undefined,
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true || payload?.result?.ok === false) {
      throw new Error(payload?.result?.message || payload?.error?.message || payload?.message || 'native-session-axis-binding-failed');
    }
    return payload;
  };
  let payload = await bindAxis();
  const checkoutNodeId = payload?.result?.context?.checkout?.targetType === 'work-node'
    ? payload.result.context.checkout.targetId
    : '';
  if (checkoutNodeId && payload?.result?.binding?.boundNodeId !== checkoutNodeId) {
    payload = await bindAxis(checkoutNodeId);
  }
  const assertion = await fetch(`${defRestUrl}/api/def-tools/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-def-internal-token': defInternalGovernanceToken },
    body: JSON.stringify({
      tool: 'def.workbench.assert_session_axis',
      input: { sessionBindingId: current.axisBindingId, sessionID: current.sessionID, host: 'workbench', timelineId: current.timelineId },
    }),
    signal: AbortSignal.timeout(5000),
  });
  const assertionPayload = await assertion.json().catch(() => null);
  if (!assertion.ok || assertionPayload?.ok !== true || assertionPayload?.result?.ok === false) {
    const error = new Error(assertionPayload?.result?.message || assertionPayload?.error?.message || assertionPayload?.message || 'native-session-binding-stale');
    error.code = assertionPayload?.result?.code || assertionPayload?.error?.code || assertionPayload?.code || 'BLOCKED_BINDING_STALE';
    throw error;
  }
  const axisContext = payload.result.context || null;
  // Native sessions do not pass through the React-side attach endpoint.  The
  // local tool module still needs the same on-disk context attachment so its
  // current-checkout tools cannot fall back to an unrelated node store.
  writeNativeWorkbenchContext(current.directory, current.sessionID, {
    schemaVersion: 1,
    source: 'native-session-axis-binding',
    timeline: { id: current.timelineId },
    selectedWorkbenchNode: null,
    axisContext,
  });
  updateNativeWorkbenchCheckoutState(current, axisContext);
  return axisContext;
}

async function awaitNativeWorkbenchCheckoutProjection(binding) {
  if (!binding?.axisBindingId || binding.host !== 'workbench' || !binding.timelineId) {
    const error = new Error('Workbench checkout projection requires an immutable native binding.');
    error.code = 'BLOCKED_BINDING';
    throw error;
  }
  await ensureDefRestService();
  const response = await fetch(`${defRestUrl}/api/main-workbench/checkout-projection`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-def-internal-token': defInternalGovernanceToken },
    body: JSON.stringify({
      sessionBindingId: binding.axisBindingId,
      sessionID: binding.sessionID,
      timelineId: binding.timelineId,
      waitMs: 4500,
    }),
    signal: AbortSignal.timeout(7000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) {
    const error = new Error(payload?.error?.message || payload?.message || 'native-checkout-projection-unavailable');
    error.code = payload?.error?.code || payload?.code || 'BLOCKED_SESSION_MISMATCH';
    throw error;
  }
  return payload.snapshot;
}

async function assertWorkbenchTimelineAdmission(timelineId) {
  if (typeof timelineId !== 'string' || !timelineId.trim()) {
    const error = new Error('Workbench DEF session creation requires timelineId.');
    error.code = 'BLOCKED_BINDING';
    throw error;
  }
  await ensureDefRestService();
  const response = await fetch(`${defRestUrl}/api/def-tools/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-def-internal-token': defInternalGovernanceToken },
    body: JSON.stringify({ tool: 'def.workbench.assert_timeline_admission', input: { timelineId: timelineId.trim() } }),
    signal: AbortSignal.timeout(5000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true || payload?.result?.ok === false) {
    const error = new Error(payload?.result?.message || payload?.error?.message || payload?.message || 'workbench-timeline-admission-failed');
    error.code = payload?.result?.code || payload?.error?.code || payload?.code || 'BLOCKED_BINDING';
    throw error;
  }
  return payload.result.document;
}

async function removeNativeWorkbenchAxisBinding(binding) {
  if (!binding?.axisBindingId || binding.host !== 'workbench') return;
  await ensureDefRestService();
  await fetch(`${defRestUrl}/api/def-tools/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-def-internal-token': defInternalGovernanceToken },
    body: JSON.stringify({ tool: 'def.workbench.unbind_session_axis', input: { sessionBindingId: binding.axisBindingId, sessionID: binding.sessionID } }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined);
}

// A create request owns its directory until the binding and initial context
// have both succeeded.  If either step fails, make the just-created session
// unrecoverable rather than leaving an orphan that could later be recovered
// without the workspace gate.  This helper is intentionally only used with
// the local `session` value returned by this request, never by recover.
async function cleanupFailedNativeSessionCreate(session) {
  if (!session?.directory || !session?.sessionID) return;
  const binding = readNativeSessionBinding(session.directory, session.sessionID, { includeNodeRelation: false });
  const runtime = runtimeSummary(readConfig().deepseek);
  await fetch(`${runtime.serverUrl}/session/${encodeURIComponent(session.sessionID)}?directory=${encodeURIComponent(session.directory)}`, {
    method: 'DELETE',
    headers: { 'x-opencode-directory': encodeURIComponent(session.directory) },
    signal: AbortSignal.timeout(OPENCODE_ACTION_TIMEOUT_MS),
  }).catch(() => undefined);
  deleteNativeQuestionRecords(session.sessionID);
  await removeNativeWorkbenchAxisBinding(binding).catch(() => undefined);
  fs.rmSync(session.directory, { recursive: true, force: true });
}

function nativeSessionCleanupError(message, code, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalizeNativeSessionPath(value) {
  const resolved = path.resolve(value || '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function sameNativeSessionPath(left, right) {
  return normalizeNativeSessionPath(left) === normalizeNativeSessionPath(right);
}

function isRealManagedDirectory(directory, parentDirectory, fileSystem = fs) {
  const resolvedDirectory = path.resolve(directory || '');
  const resolvedParent = path.resolve(parentDirectory || '');
  if (!sameNativeSessionPath(path.dirname(resolvedDirectory), resolvedParent)) return false;
  try {
    const stat = fileSystem.lstatSync(resolvedDirectory);
    return stat.isDirectory()
      && !stat.isSymbolicLink()
      && sameNativeSessionPath(fileSystem.realpathSync(resolvedDirectory), resolvedDirectory);
  } catch {
    return false;
  }
}

function validateNativeAiCliSessionsRoot(rootDirectory, fileSystem = fs) {
  const resolvedRoot = path.resolve(rootDirectory || '');
  const sessionsRoot = path.dirname(resolvedRoot);
  if (path.basename(resolvedRoot).toLowerCase() !== 'ai-cli' || path.basename(sessionsRoot).toLowerCase() !== 'sessions') {
    throw nativeSessionCleanupError('Native ai-cli session root is invalid.', 'NATIVE_SESSION_CLEANUP_INVALID_ROOT');
  }
  try {
    const stat = fileSystem.lstatSync(resolvedRoot);
    if (
      !stat.isDirectory()
      || stat.isSymbolicLink()
      || !sameNativeSessionPath(fileSystem.realpathSync(resolvedRoot), resolvedRoot)
    ) throw new Error('unsafe-root');
  } catch {
    throw nativeSessionCleanupError('Native ai-cli session root is unavailable or redirected.', 'NATIVE_SESSION_CLEANUP_INVALID_ROOT');
  }
  return resolvedRoot;
}

function readValidatedAiCliBinding(directory, sessionID, options = {}) {
  const fileSystem = options.fileSystem || fs;
  const bindingResolver = options.bindingResolver || findNativeSessionBinding;
  const rootDirectory = options.aiCliSessionsRoot ? path.resolve(options.aiCliSessionsRoot) : null;
  const resolvedDirectory = path.resolve(directory || '');
  if (!resolvedDirectory || !sessionID || (rootDirectory && !isRealManagedDirectory(resolvedDirectory, rootDirectory, fileSystem))) return null;
  let stored = null;
  try {
    const bindingPath = path.join(resolvedDirectory, '.def-session.json');
    if (fileSystem.lstatSync(bindingPath).isSymbolicLink()) return null;
    stored = JSON.parse(fileSystem.readFileSync(bindingPath, 'utf8'));
  } catch {
    return null;
  }
  if (
    stored?.host !== 'ai-cli'
    || stored.sessionID !== sessionID
    || !sameNativeSessionPath(stored.directory || resolvedDirectory, resolvedDirectory)
  ) return null;
  const binding = bindingResolver(sessionID);
  if (
    !binding
    || binding.host !== 'ai-cli'
    || !sameNativeSessionPath(binding.directory, resolvedDirectory)
  ) return null;
  return binding;
}

function enumerateNativeAiCliCleanupTargets(keepBinding, options = {}) {
  const fileSystem = options.fileSystem || fs;
  const bindingResolver = options.bindingResolver || findNativeSessionBinding;
  const keepSessionID = typeof keepBinding?.sessionID === 'string' ? keepBinding.sessionID.trim() : '';
  const keepDirectory = path.resolve(keepBinding?.directory || '');
  const aiCliRoot = validateNativeAiCliSessionsRoot(options.aiCliSessionsRoot || nativeAiCliSessionsRoot, fileSystem);
  if (
    !keepSessionID
    || keepBinding?.host !== 'ai-cli'
    || !readValidatedAiCliBinding(keepDirectory, keepSessionID, { ...options, aiCliSessionsRoot: aiCliRoot, bindingResolver, fileSystem })
  ) {
    throw nativeSessionCleanupError('keepSessionID is not a valid DEF ai-cli session binding.', 'NATIVE_SESSION_CLEANUP_INVALID_KEEP');
  }

  const targets = [];
  for (const entry of fileSystem.readdirSync(aiCliRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const directory = path.resolve(aiCliRoot, entry.name);
    if (!isRealManagedDirectory(directory, aiCliRoot, fileSystem) || sameNativeSessionPath(directory, keepDirectory)) continue;
    let stored = null;
    try {
      stored = JSON.parse(fileSystem.readFileSync(path.join(directory, '.def-session.json'), 'utf8'));
    } catch {
      continue;
    }
    const sessionID = typeof stored?.sessionID === 'string' ? stored.sessionID.trim() : '';
    if (!sessionID || sessionID === keepSessionID) continue;
    const binding = readValidatedAiCliBinding(directory, sessionID, { ...options, aiCliSessionsRoot: aiCliRoot, bindingResolver, fileSystem });
    if (binding) targets.push(binding);
  }
  return targets;
}

async function deleteNativeSessionById(sessionID, options = {}) {
  const bindingResolver = options.bindingResolver || findNativeSessionBinding;
  const fetchImpl = options.fetchImpl || fetch;
  const admissionGate = options.admissionGate || nativeSessionAdmission;
  const rejectQuestions = options.rejectQuestions || rejectPendingQuestions;
  const deleteQuestionRecords = options.deleteQuestionRecords || deleteNativeQuestionRecords;
  const removeAxisBinding = options.removeAxisBinding || removeNativeWorkbenchAxisBinding;
  const removeDirectory = options.removeDirectory || ((directory) => fs.rmSync(directory, { recursive: true, force: true }));
  const binding = bindingResolver(sessionID);
  if (!binding) {
    admissionGate.releaseSession(sessionID, 'native-session-deleted');
    return { ok: true, status: 'already-deleted', sessionID };
  }
  if (options.expectedBinding && (
    binding.sessionID !== options.expectedBinding.sessionID
    || binding.host !== options.expectedBinding.host
    || !sameNativeSessionPath(binding.directory, options.expectedBinding.directory)
  )) {
    return {
      ok: false,
      status: 'failed',
      sessionID,
      code: 'NATIVE_SESSION_DELETE_BINDING_CHANGED',
    };
  }
  if (options.expectedBinding?.host === 'ai-cli' && !readValidatedAiCliBinding(
    options.expectedBinding.directory,
    sessionID,
    options,
  )) {
    return {
      ok: false,
      status: 'failed',
      sessionID,
      code: 'NATIVE_SESSION_DELETE_BINDING_CHANGED',
    };
  }

  try {
    const runtime = options.runtime || runtimeSummary(readConfig().deepseek);
    // The local gate is not durable across a sidecar restart and callers can
    // reach native Sessions through paths it did not observe. Abort every
    // extant binding before DELETE; only confirmation (including 404) permits
    // local removal and admission release.
    const aborted = await abortNativeSession(runtime, binding, sessionID, { fetchImpl });
    if (!aborted.ok) {
      return {
        ok: false,
        status: 'failed',
        sessionID,
        code: aborted.code,
        httpStatus: aborted.httpStatus,
      };
    }
    await rejectQuestions(runtime, binding.directory, sessionID);
    let upstream;
    try {
      upstream = await fetchImpl(
        `${runtime.serverUrl}/session/${encodeURIComponent(sessionID)}?directory=${encodeURIComponent(binding.directory)}`,
        {
          method: 'DELETE',
          headers: { 'x-opencode-directory': encodeURIComponent(binding.directory) },
          signal: AbortSignal.timeout(OPENCODE_ACTION_TIMEOUT_MS),
        },
      );
    } catch {
      // Abort succeeded, but deleting the Session did not. Preserve both the
      // binding and any admission reservation so a retry can finish cleanup
      // without admitting a new native turn.
      return {
        ok: false,
        status: 'failed',
        sessionID,
        code: 'NATIVE_SESSION_DELETE_UPSTREAM_FAILED',
      };
    }
    const upstreamAlreadyDeleted = upstream?.status === 404;
    if (upstream && !upstream.ok && !upstreamAlreadyDeleted) {
      return {
        ok: false,
        status: 'failed',
        sessionID,
        code: 'NATIVE_SESSION_DELETE_UPSTREAM_FAILED',
        httpStatus: upstream.status,
      };
    }
    deleteQuestionRecords(sessionID);
    await removeAxisBinding(binding);
    removeDirectory(binding.directory);
    admissionGate.releaseSession(sessionID, 'native-session-deleted');
    return { ok: true, status: upstreamAlreadyDeleted ? 'already-deleted' : 'deleted', sessionID };
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      sessionID,
      code: typeof error?.code === 'string' ? error.code : 'NATIVE_SESSION_DELETE_FAILED',
    };
  }
}

async function cleanupNativeAiCliSessions(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw nativeSessionCleanupError('Session cleanup request must be an object.', 'NATIVE_SESSION_CLEANUP_INVALID_REQUEST');
  }
  const unexpectedKeys = Object.keys(input).filter((key) => key !== 'host' && key !== 'keepSessionID');
  if (input.host !== 'ai-cli' || unexpectedKeys.length > 0) {
    throw nativeSessionCleanupError('Session cleanup only accepts host and keepSessionID for ai-cli.', 'NATIVE_SESSION_CLEANUP_INVALID_REQUEST');
  }
  const keepSessionID = typeof input.keepSessionID === 'string' ? input.keepSessionID.trim() : '';
  const fileSystem = options.fileSystem || fs;
  const bindingResolver = options.bindingResolver || findNativeSessionBinding;
  const keepBinding = keepSessionID ? bindingResolver(keepSessionID) : null;
  if (!keepBinding || keepBinding.host !== 'ai-cli') {
    throw nativeSessionCleanupError('keepSessionID is not a valid DEF ai-cli session binding.', 'NATIVE_SESSION_CLEANUP_INVALID_KEEP');
  }
  const aiCliRoot = validateNativeAiCliSessionsRoot(options.aiCliSessionsRoot || nativeAiCliSessionsRoot, fileSystem);
  if (!readValidatedAiCliBinding(keepBinding.directory, keepSessionID, {
    ...options,
    aiCliSessionsRoot: aiCliRoot,
    bindingResolver,
    fileSystem,
  })) {
    throw nativeSessionCleanupError('keepSessionID is not a valid DEF ai-cli session binding.', 'NATIVE_SESSION_CLEANUP_INVALID_KEEP');
  }

  const cleanupKey = normalizeNativeSessionPath(aiCliRoot);
  const existingCleanup = nativeSessionCleanupInFlight.get(cleanupKey);
  if (existingCleanup) {
    if (existingCleanup.keepSessionID === keepSessionID) return existingCleanup.promise;
    throw nativeSessionCleanupError(
      'Another ai-cli session cleanup is already in progress.',
      'NATIVE_SESSION_CLEANUP_BUSY',
      409,
    );
  }

  const cleanupPromise = (async () => {
    const targets = enumerateNativeAiCliCleanupTargets(keepBinding, {
      ...options,
      aiCliSessionsRoot: aiCliRoot,
      bindingResolver,
      fileSystem,
    });
    const summary = {
      ok: true,
      host: 'ai-cli',
      keptSessionID: keepSessionID,
      targetCount: targets.length,
      deletedCount: 0,
      alreadyDeletedCount: 0,
      failed: [],
    };
    for (const target of targets) {
      const result = await deleteNativeSessionById(target.sessionID, {
        ...options,
        bindingResolver,
        expectedBinding: target,
      });
      if (result.status === 'deleted') summary.deletedCount += 1;
      else if (result.status === 'already-deleted') summary.alreadyDeletedCount += 1;
      else summary.failed.push({
        sessionID: target.sessionID,
        code: result.code || 'NATIVE_SESSION_DELETE_FAILED',
        ...(Number.isInteger(result.httpStatus) ? { httpStatus: result.httpStatus } : {}),
      });
    }
    summary.ok = summary.failed.length === 0;
    return summary;
  })();
  nativeSessionCleanupInFlight.set(cleanupKey, { keepSessionID, promise: cleanupPromise });
  try {
    return await cleanupPromise;
  } finally {
    const active = nativeSessionCleanupInFlight.get(cleanupKey);
    if (active?.promise === cleanupPromise) nativeSessionCleanupInFlight.delete(cleanupKey);
  }
}

const server = http.createServer(async (request, response) => {
  const method = request.method || 'GET';
  const requestUrl = new URL(request.url || '/', `http://${HOST}:${PORT}`);

  if (requestUrl.pathname === '/api/native/sessions/cleanup') {
    if (method !== 'POST' || !isAuthorizedNativeSessionCleanupRequest(request, defInternalGovernanceToken)) {
      writeNativeSessionCleanupJson(response, 403, {
        ok: false,
        error: 'native-session-cleanup-forbidden',
      });
      return;
    }
  }

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
      const timelineId = typeof body.timelineId === 'string' ? body.timelineId.trim() : '';
      if (host === 'workbench') await assertWorkbenchTimelineAdmission(timelineId);
      let session = null;
      try {
        session = await createNativeHostSession({
          config: readConfig().deepseek,
          host,
          skillId: typeof body.skillId === 'string' ? body.skillId : undefined,
          thinkingEffort: body.thinkingEffort,
          harnessSelector: typeof body.harnessSelector === 'string' ? body.harnessSelector : 'stable',
          timelineId,
          boundNodeId: typeof body.boundNodeId === 'string' ? body.boundNodeId : '',
        });
        await registerNativeCatalogSession(session);
        const binding = ensureNativeSessionAxisBinding(session.directory, session.sessionID);
        const axisContext = await syncNativeWorkbenchAxisBinding(binding);
        writeJson(response, 200, { ok: true, session: { ...session, axisContext } });
      } catch (error) {
        await cleanupFailedNativeSessionCreate(session);
        throw error;
      }
      return;
    }

    const nativeSessionRecovery = /^\/api\/native\/session\/([^/]+)\/recover$/.exec(requestUrl.pathname);
    if (method === 'POST' && nativeSessionRecovery) {
      const sessionID = decodeURIComponent(nativeSessionRecovery[1]);
      const body = await readJsonBody(request);
      const existingBinding = readNativeSessionBinding(typeof body.directory === 'string' ? body.directory : '', sessionID, { includeNodeRelation: false });
      if (existingBinding?.host === 'workbench') await syncNativeWorkbenchAxisBinding(existingBinding);
      const session = await recoverNativeHostSession({
        config: readConfig().deepseek,
        directory: typeof body.directory === 'string' ? body.directory : '',
        sessionID,
      });
      await registerNativeCatalogSession(session);
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
      if (binding.host === 'workbench') await syncNativeWorkbenchAxisBinding(binding);

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
        const aborted = await abortNativeSession(runtime, binding, sessionID);
        if (!aborted.ok) throwNativeAbortFailure(aborted, 'native-question-stop');
        nativeSessionAdmission.releaseSession(sessionID, 'native-abort');
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

    if (method === 'POST' && requestUrl.pathname === '/api/native/sessions/cleanup') {
      const body = await readJsonBody(request);
      const result = await cleanupNativeAiCliSessions(body);
      writeNativeSessionCleanupJson(response, 200, result);
      return;
    }

    const nativeSessionDelete = /^\/api\/native\/session\/([^/]+)$/.exec(requestUrl.pathname);
    const nativeRunnerCleanup = /^\/api\/native\/session\/([^/]+)\/runner-cleanup$/.exec(requestUrl.pathname);
    if ((method === 'DELETE' && nativeSessionDelete) || (method === 'POST' && nativeRunnerCleanup)) {
      const sessionID = decodeURIComponent((nativeSessionDelete || nativeRunnerCleanup)[1]);
      const result = await deleteNativeSessionById(sessionID);
      if (!result.ok) {
        writeJson(response, result.httpStatus || 500, { ok: false, error: 'native-session-delete-failed', code: result.code });
        return;
      }
      writeJson(response, 200, { ok: true, status: result.status });
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
      const binding = ensureNativeSessionAxisBinding(body.directory, body.sessionID);
      const contextTimelineId = typeof body.context?.timeline?.id === 'string' ? body.context.timeline.id.trim() : '';
      if (!binding || binding.host !== 'workbench' || !binding.timelineId || contextTimelineId !== binding.timelineId) {
        writeJson(response, 409, { ok: false, error: 'Workbench context timeline does not match its immutable session binding.', code: 'BLOCKED_SESSION_MISMATCH' });
        return;
      }
      const axisContext = await syncNativeWorkbenchAxisBinding(binding);
      await awaitNativeWorkbenchCheckoutProjection(binding);
      const saved = writeNativeWorkbenchContext(body.directory, body.sessionID, body.context);
      const checkoutState = updateNativeWorkbenchCheckoutState(binding, axisContext);
      writeJson(response, 200, { ok: true, context: saved, axisContext, checkoutState });
      return;
    }

    const nativeInteropPrompt = /^\/api\/native\/session\/([^/]+)\/interop-prompt$/.exec(requestUrl.pathname);
    if (method === 'POST' && nativeInteropPrompt) {
      const sessionID = decodeURIComponent(nativeInteropPrompt[1]);
      const result = await sendNativeInteropPrompt(sessionID, await readJsonBody(request));
      writeJson(response, 202, { ok: true, sessionId: sessionID, ingressMode: result.ingressMode, submissionState: result.submissionState || 'accepted', acceptedAt: result.acceptedAt, nativeUserMessageId: result.nativeUserMessageId || undefined, providerVisibleMessages: result.providerVisibleMessages, harnessBinding: result.harnessBinding || null, sessionHarnessBinding: result.sessionHarnessBinding || null, harnessRoute: result.harnessRoute || null, harnessWarning: result.harnessWarning || null, agentRelease: result.agentRelease || null, idempotent: result.idempotent === true });
      return;
    }

    const nativeInteropTranscript = /^\/api\/native\/session\/([^/]+)\/interop-transcript$/.exec(requestUrl.pathname);
    if (method === 'GET' && nativeInteropTranscript) {
      const sessionID = decodeURIComponent(nativeInteropTranscript[1]);
      const result = await readNativeInteropTranscript(sessionID);
      writeJson(response, 200, { ok: true, sessionId: sessionID, messages: result.messages });
      return;
    }

    const nativeInteropQuestions = /^\/api\/native\/session\/([^/]+)\/interop-questions$/.exec(requestUrl.pathname);
    if (method === 'GET' && nativeInteropQuestions) {
      const sessionID = decodeURIComponent(nativeInteropQuestions[1]);
      const result = await readNativeInteropQuestions(sessionID);
      writeJson(response, 200, { ok: true, sessionId: sessionID, questions: result.questions });
      return;
    }

    const nativeInteropStop = /^\/api\/native\/session\/([^/]+)\/interop-stop$/.exec(requestUrl.pathname);
    if (method === 'POST' && nativeInteropStop) {
      const sessionID = decodeURIComponent(nativeInteropStop[1]);
      writeJson(response, 200, { ok: true, sessionId: sessionID, ...(await stopNativeInteropPrompt(sessionID)) });
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
      const requestedHost = requestUrl.searchParams.get('host');
      const sessions = await listPersistedDefSessions({
        config: readConfig().deepseek,
        limit: Number(requestUrl.searchParams.get('limit') || 100) || 100,
        host: requestedHost === 'ai-cli' || requestedHost === 'workbench' ? requestedHost : '',
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
          const snapshotResponse = await fetch(`${defRestUrl}/api/main-workbench/snapshot`, {
            signal: AbortSignal.timeout(4000),
            headers: process.env.DEF_INTERNAL_GOVERNANCE_TOKEN ? { 'x-def-internal-token': process.env.DEF_INTERNAL_GOVERNANCE_TOKEN } : {},
          });
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
      const sessionID = decodeURIComponent(messageMatch[1]);
      if (!findNativeSessionBinding(sessionID)) {
        const error = new Error('persisted DEF session not found');
        error.code = 'DEF_SESSION_NOT_FOUND';
        error.status = 404;
        throw error;
      }
      await ensureDefRestService();
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
      if (nativeBinding?.host === 'workbench') await syncNativeWorkbenchAxisBinding(nativeBinding);
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

    if (method === 'GET' && requestUrl.pathname === '/project') {
      writeJson(response, 200, buildEmbeddedWorkbenchProject());
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
    const statusCode = Number.isInteger(error?.status)
      ? error.status
      : errorCode === 'DEF_SESSION_SKILL_MISMATCH' || errorCode === 'BLOCKED_HARNESS_LOAD'
        ? 409
        : requestUrl.pathname === '/api/native/sessions/cleanup' && error instanceof SyntaxError
          ? 400
          : 500;
    const payload = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      ...(errorCode ? { code: errorCode } : {}),
      ...(errorCode === 'DEF_PERSISTED_SESSION_SCAN_LIMIT_EXCEEDED'
        || errorCode === 'DEF_PERSISTED_SESSION_LIST_TIMEOUT'
        || errorCode === 'DEF_PERSISTED_SESSION_VALIDATION_FAILED'
        ? { details: error.details || null }
        : {}),
    };
    if (requestUrl.pathname === '/api/native/sessions/cleanup') {
      writeNativeSessionCleanupJson(response, statusCode, payload);
    } else {
      writeJson(response, statusCode, payload);
    }
  }
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

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`[def-agent-sidecar] listening on http://${HOST}:${PORT}`);
  });
  process.once('SIGTERM', () => shutdownAndExit('SIGTERM'));
  process.once('SIGINT', () => shutdownAndExit('SIGINT'));
  process.once('exit', () => {
    shutdownRuntime();
  });
}

module.exports = {
  abortNativeSession,
  cleanupNativeAiCliSessions,
  deleteNativeSessionById,
  enumerateNativeAiCliCleanupTargets,
  server,
};
