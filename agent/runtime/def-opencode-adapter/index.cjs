const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { EventEmitter } = require('events');
const { spawn, spawnSync } = require('child_process');

const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-pro';
const OPENCODE_HOST = '127.0.0.1';
const OPENCODE_PORT_BASE = Number(process.env.DEF_OPENCODE_PORT || 17445);
const OPENCODE_PORT_MAX_ATTEMPTS = 20;

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const runtimeRoot = path.join(projectRoot, 'agent', 'runtime', 'opencode-core');
const skillsRoot = path.join(projectRoot, 'agent', 'runtime', 'def', 'skills');
const defOpenCodeToolSource = path.join(projectRoot, 'agent', 'runtime', 'def-tools', 'opencode', 'def.js');
const defOpenCodePluginSource = path.join(projectRoot, 'agent', 'runtime', 'def-tools', 'opencode', 'plugin.js');
const runtimeLogDir = path.join(projectRoot, '.runtime', 'def-agent');
const agentWorkspaceDir = path.join(os.tmpdir(), 'dmg-end-field', 'def-agent-workspace');
let resolvedAgentWorkspaceDir = null;
const defaultDefOpenCodeHome = path.join(projectRoot, '.runtime', 'def-opencode');
const DEF_TRANSCRIPT_SCHEMA_VERSION = 1;

const capabilityPolicy = {
  name: 'def-runtime-minimal-v1',
  workspace: agentWorkspaceDir,
  allowed: ['model-chat', 'structured-output', 'skill', 'webfetch:def-rest', 'script-workbench:def-json'],
  denied: [
    'bash',
    'edit',
    'read',
    'grep',
    'glob',
    'task',
    'todowrite',
    'websearch',
    'lsp',
    'external_directory',
    'question',
    'plan_enter',
    'plan_exit',
  ],
  webfetchAllow: ['http://127.0.0.1:17321/*'],
};

const skillMap = {
  operator: { agent: 'def-operator', skill: 'operator-fill', label: '填干员' },
  weapon: { agent: 'def-weapon', skill: 'weapon-fill', label: '填武器' },
  equipment: { agent: 'def-equipment', skill: 'equipment-fill', label: '填装备' },
  workbench: { agent: 'def-search', skill: 'rest-search', label: '主界面' },
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

function normalizeKnowledgeText(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_\-·・.]/g, '');
}

function readGameKnowledge() {
  try {
    const knowledgePath = path.join(projectRoot, 'src', 'data', 'gameKnowledge.json');
    return JSON.parse(fs.readFileSync(knowledgePath, 'utf8'));
  } catch {
    return null;
  }
}

function buildGameKnowledgePromptLines() {
  const knowledge = readGameKnowledge();
  if (!knowledge) return [];
  const operatorAliases = Array.isArray(knowledge.operatorAliases)
    ? knowledge.operatorAliases.flatMap((entry) => (
      Array.isArray(entry.terms) ? entry.terms.map((term) => `${term}=${entry.name}`) : []
    )).join(', ')
    : '';
  const gearAliases = Array.isArray(knowledge.gearSetAliases)
    ? knowledge.gearSetAliases.flatMap((entry) => (
      Array.isArray(entry.terms)
        ? entry.terms
          .filter((term, index, terms) => terms.findIndex((item) => normalizeKnowledgeText(item) === normalizeKnowledgeText(term)) === index)
          .map((term) => `${term}=${entry.gearSetId}(${entry.name})`)
        : []
    )).join(', ')
    : '';
  return [
    operatorAliases ? `- Common operator aliases: ${operatorAliases}.` : '',
    gearAliases ? `- Common gear-set aliases: ${gearAliases}. When an alias matches, prefer gearSetId over gearSetName.` : '',
  ].filter(Boolean);
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

function buildCapabilityPermission(webfetchAllow = ['http://127.0.0.1:17321/*'], options = {}) {
  const nodeCode = options.nodeCode === true;
  const webfetch = { '*': 'deny' };
  for (const pattern of webfetchAllow) {
    webfetch[pattern] = 'allow';
  }
  return {
    bash: 'deny',
    edit: nodeCode ? 'allow' : 'deny',
    read: nodeCode ? 'allow' : 'deny',
    grep: nodeCode ? 'allow' : 'deny',
    glob: nodeCode ? 'allow' : 'deny',
    task: 'deny',
    todowrite: 'deny',
    websearch: 'deny',
    lsp: 'deny',
    external_directory: 'deny',
    question: 'deny',
    plan_enter: 'deny',
    plan_exit: 'deny',
    skill: 'allow',
    'def_*': 'allow',
    def_node_use: 'ask',
    webfetch,
  };
}

function buildAgentPermission(skillId) {
  if (skillId === 'workbench') {
    return buildCapabilityPermission([
      'http://127.0.0.1:17321/api/main-workbench/snapshot',
      'http://127.0.0.1:17321/api/main-workbench/commands',
      'http://127.0.0.1:17321/api/main-workbench/commands?*',
      'http://127.0.0.1:17321/api/main-workbench/commands/enqueue',
      'http://127.0.0.1:17321/api/def-tools',
      'http://127.0.0.1:17321/api/def-tools/*',
      'http://127.0.0.1:17321/api/def-tools?*',
      'http://127.0.0.1:17321/api/def-tools/describe?*',
      'http://127.0.0.1:17321/api/def-tools/call',
    ], { nodeCode: true });
  }
  return buildCapabilityPermission();
}

function capabilityPolicySummary() {
  return {
    name: capabilityPolicy.name,
    workspace: getAgentWorkspaceDir(),
    allowed: capabilityPolicy.allowed,
    denied: capabilityPolicy.denied,
    webfetchAllow: capabilityPolicy.webfetchAllow,
  };
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
  if (skillId === 'workbench') {
    return [
      'You are the embedded DEF main-workbench assistant operating an isolated child-node workspace.',
      'Reply in Chinese by default. Keep the final answer short and describe only the visible outcome.',
      'Do not expose API keys, hidden configuration, internal protocol noise, session ids, REST URLs, or adapters.',
      '',
      '## Node-first execution',
      '- Mutations happen in a copied child Work Node, never directly in the parent node or current checkout.',
      '- If this session has no bound node, call def_node_fork. To continue an existing node, call def_node_bind.',
      '- Use the native read/edit/apply_patch tools on working-payload.json for flexible node changes. base-payload.json is immutable evidence.',
      '- Native file tools are allowed only inside this session directory. Never access project source, another session, or another node directory.',
      '- After editing, call def_node_sync_validate. Use def_node_diff when the user needs review evidence.',
      '- Call def_node_use only after validation and any required approval. It is the only normal step that may touch current checkout.',
      '- Do not translate a completed node file back into button-by-button commands or a legacy Patch DSL.',
      '',
      '## Tool families',
      '- def-node-code: native read/edit/apply_patch in the bound child-node workspace.',
      '- def-node-crud: fork, bind, validate, diff, approval, use, restore, and simple structured node operations.',
      '- def-data-resource: trusted operator, weapon, equipment, skill, Buff, and damage data.',
      '- Legacy REST tools are compatibility fallbacks while migration is incomplete; do not treat their current list as the architecture.',
      '',
      '## Interaction rules',
      '- Read-only questions do not create or use a node.',
      '- A mutation is not complete until node validation passes and, when requested, def_node_use confirms the checkout.',
      '- Ask only when the target or approval is genuinely ambiguous. Do not invent operator, equipment, skill, or Buff data.',
      '- Do not narrate plans, chain of thought, tool names, URLs, command ids, step tables, or suggested next steps.',
      '- If application is still pending, say it is waiting for execution confirmation; never claim success without evidence.',
      ...buildGameKnowledgePromptLines(),
    ].join('\n');
  }
  return [
    'You are the embedded OpenCode agent inside DEF Shell.',
    'Reply in Chinese by default. Use another language only when the user explicitly asks for it or quotes text that must remain unchanged.',
    'The user is a shallow AI user. Keep replies practical, short, and action-oriented.',
    'Do not expose API keys, hidden configuration, or internal protocol noise.',
    'Do not describe OpenCode, sessions, events, adapters, providers, or runtime details unless the user explicitly asks.',
    'You are a DEF business assistant, not a coding agent. Do not modify project code, run shell commands, run git commands, scan arbitrary directories, or write project files.',
    'Do not use task/subagents, shell, git, direct file read/write/edit/patch, grep, glob, lsp, web search, or unrestricted external network access.',
    'Complete the work in the current agent with normal model reasoning, the DEF skill tool, allowed DEF REST access, and the optional DEF JSON script workbench only.',
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
    '- GET /api/agent/scripts - list temporary DEF JSON helper scripts and constraints',
    '- GET /api/agent/scripts/<name> - read one temporary helper script',
    '- GET /api/main-workbench/snapshot - current main workbench mirror: selected operators, timeline buttons, selected buff ids, damage totals',
    '- GET /api/main-workbench/commands?status=pending - queued main workbench commands waiting for the browser page to execute',
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
    '- POST /api/agent/scripts/write - create or update one small temporary .js/.mjs helper script',
    '- POST /api/agent/scripts/run - run a temporary helper script with JSON input and JSON/text stdout',
    '- POST /api/agent/scripts/delete - delete a temporary helper script',
    '- POST /api/main-workbench/commands/enqueue - enqueue declarative browser-executed main workbench commands',
    '- POST /api/main-workbench/commands/result - browser result mirror for command completion',
    '',
    '### DEF JSON script workbench (optional)',
    '- Use scripts only for repetitive JSON cleanup, comparison, batching, validation-error aggregation, or draft generation.',
    '- Scripts live only under .runtime/def-agent/scripts and are managed through /api/agent/scripts/* endpoints.',
    '- Scripts must accept JSON from stdin and print compact JSON or a short report to stdout.',
    '- Do not use scripts to edit project code, read arbitrary project files, run git, run npm install, automate shell tasks, fetch external network data, or bypass proposal review.',
    '- Script output is only evidence or a candidate draft. Always validate final drafts with fill.check before fill.apply.',
    '',
    '### Main workbench code-control commands',
    '- Use /api/main-workbench/commands/enqueue when the user asks to control the main screen by code.',
    '- Supported command op values: selectCharacters, openView, openWorkbenchPage, clearTimeline, setOperatorWeapon, setOperatorEquipment, addSkillButton, removeSkillButton, addBuff, removeBuff, setTargetResistance, saveTimelineSnapshot, restoreTimelineSnapshot, listTimelineSnapshots, refreshOperatorConfig, calculateDamage, refreshSnapshot.',
    '- Commands are declarative JSON. Do not automate DOM clicks; the browser page maps commands to React services, localStorage/sessionStorage repositories, Buff service, and damage calculation.',
    '- Strategy flow: selectCharacters -> setOperatorWeapon/setOperatorEquipment -> refreshOperatorConfig -> restoreTimelineSnapshot or clearTimeline/addSkillButton -> addBuff/setTargetResistance -> calculateDamage -> saveTimelineSnapshot.',
    '- setOperatorEquipment can use gearSetName/gearSetId with fillSlots:true to equip four pieces, or slotKey plus equipmentName/equipmentId for one piece. Use entryLevel:3 for max equipment entries when appropriate.',
    '- Before risky edits, enqueue saveTimelineSnapshot with a clear label so the user can roll back with restoreTimelineSnapshot.',
    '- After enqueue, poll GET /api/main-workbench/snapshot and GET /api/main-workbench/commands for completion evidence.',
    '- Example: {"command":{"op":"selectCharacters","characterIds":["operator-id"],"openCanvas":true},"source":"def-opencode"}.',
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
  const requestOptions = skillId === 'workbench'
    ? { thinking: { type: 'disabled' } }
    : deepSeekRequestOptions(deepseek.model, thinkingEffort);
  const agents = {};
  for (const id of Object.keys(skillMap)) {
    const info = skillMap[id];
    agents[info.agent] = {
      model: modelRef,
      mode: 'primary',
      prompt: buildAgentPrompt(id),
      options: requestOptions,
      permission: buildAgentPermission(id),
      steps: id === 'workbench' ? 8 : 8,
    };
  }

  return {
    model: modelRef,
    default_agent: (skillMap[skillId] || skillMap.operator).agent,
    disabled_providers: ['opencode'],
    permission: buildAgentPermission(skillId),
    skills: {
      paths: [skillsRoot],
    },
    plugin: [pathToFileURL(defOpenCodePluginSource).href],
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

function getAgentWorkspaceDir() {
  fs.mkdirSync(agentWorkspaceDir, { recursive: true });
  if (!resolvedAgentWorkspaceDir) {
    resolvedAgentWorkspaceDir = fs.realpathSync(agentWorkspaceDir);
  }
  return resolvedAgentWorkspaceDir;
}

function getDefOpenCodeHome() {
  const configured = typeof process.env.DEF_OPENCODE_HOME === 'string' ? process.env.DEF_OPENCODE_HOME.trim() : '';
  return path.resolve(configured || defaultDefOpenCodeHome);
}

function buildOpenCodeRuntimeEnv(openCodeConfig) {
  const home = getDefOpenCodeHome();
  const dataHome = path.join(home, 'data');
  const stateHome = path.join(home, 'state');
  const cacheHome = path.join(home, 'cache');
  const configHome = path.join(home, 'config');
  const dbPath = path.join(home, 'db', 'def-opencode.db');
  for (const dir of [dataHome, stateHome, cacheHome, configHome, path.dirname(dbPath)]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return {
    ...process.env,
    XDG_DATA_HOME: dataHome,
    XDG_STATE_HOME: stateHome,
    XDG_CACHE_HOME: cacheHome,
    XDG_CONFIG_HOME: configHome,
    OPENCODE_DB: dbPath,
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_DISABLE_SHARE: '1',
    OPENCODE_CONFIG_CONTENT: JSON.stringify(openCodeConfig),
  };
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function platformRuntimeTarget() {
  const platform = process.platform === 'win32'
    ? 'win32'
    : process.platform === 'darwin'
      ? 'darwin'
      : process.platform === 'linux'
        ? 'linux'
        : process.platform;
  return `${platform}-${process.arch}`;
}

function runtimeBinaryName() {
  return process.platform === 'win32' ? 'opencode.exe' : 'opencode';
}

function resolveAsarUnpackedPath(filePath) {
  const marker = `${path.sep}app.asar${path.sep}`;
  if (!filePath.includes(marker)) return filePath;
  return filePath.replace(marker, `${path.sep}app.asar.unpacked${path.sep}`);
}

function getRuntimeManifest() {
  return readJsonFile(path.join(runtimeRoot, 'manifest.json'));
}

function getRuntimeChecksums() {
  return readJsonFile(path.join(runtimeRoot, 'checksums.json'));
}

function resolveOpenCodeBinary() {
  const target = platformRuntimeTarget();
  const binaryName = runtimeBinaryName();
  const manifest = getRuntimeManifest();
  const candidates = [];

  if (manifest?.runtimeTarget === target && typeof manifest.binary === 'string' && manifest.binary) {
    candidates.push(path.join(runtimeRoot, manifest.binary));
  }
  candidates.push(path.join(runtimeRoot, 'bin', target, binaryName));

  for (const candidate of candidates) {
    const resolved = resolveAsarUnpackedPath(candidate);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  }

  throw new Error(
    `OpenCode runtime binary is missing for ${target}. Run "npm run build:opencode-runtime" before starting DEF agent.`,
  );
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
  $_.CommandLine -like '*opencode.exe*' -and
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
  const nextHash = hashConfig({ config: openCodeConfig, opencodeHome: getDefOpenCodeHome() });
  if (processRunning(opencodeProcess) && opencodeConfigHash === nextHash && opencodeReadyUrl) {
    return opencodeReadyUrl;
  }

  stopOpenCodeProcess();
  cleanupStaleOpenCodeProcesses();
  const directory = getAgentWorkspaceDir();
  fs.mkdirSync(runtimeLogDir, { recursive: true });
  opencodeConfigHash = nextHash;
  opencodeReadyPort = await findOpenCodePort();
  const binaryPath = resolveOpenCodeBinary();
  appendLog(`[policy] ${JSON.stringify(capabilityPolicySummary())}`);
  opencodeProcess = spawn(binaryPath, [
    'serve',
    `--hostname=${OPENCODE_HOST}`,
    `--port=${opencodeReadyPort}`,
  ], {
    cwd: directory,
    env: buildOpenCodeRuntimeEnv(openCodeConfig),
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

async function getOpenCodeServerForRead(config, skillId, thinkingEffort) {
  if (processRunning(opencodeProcess) && opencodeReadyUrl) {
    return opencodeReadyUrl;
  }
  return ensureOpenCodeServer(config, skillId, thinkingEffort);
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

function createAgentSessionWorkspace(skillId) {
  const root = getAgentWorkspaceDir();
  const host = skillId === 'workbench' ? 'workbench' : 'ai-cli';
  const directory = path.join(root, 'sessions', host, crypto.randomUUID());
  const toolsDir = path.join(directory, '.opencode', 'tools');
  fs.mkdirSync(toolsDir, { recursive: true });
  if (!fs.existsSync(defOpenCodeToolSource)) {
    throw new Error(`Missing DEF OpenCode native tool module: ${defOpenCodeToolSource}`);
  }
  fs.copyFileSync(defOpenCodeToolSource, path.join(toolsDir, 'def.js'));
  fs.writeFileSync(path.join(directory, 'AGENTS.md'), [
    '# DEF isolated session workspace',
    '',
    'This directory belongs to one OpenCode session.',
    'For Work Node changes, call def_node_fork or def_node_bind before using read/edit/apply_patch.',
    'Only working-payload.json is editable node truth. base-payload.json is immutable comparison evidence.',
    'Run def_node_sync_validate before def_node_use.',
    '',
  ].join('\n'), 'utf8');
  return fs.realpathSync(directory);
}

function extractReplyError(reply) {
  if (!reply || typeof reply !== 'object') return '';
  const info = reply.info && typeof reply.info === 'object' ? reply.info : reply;
  const error = info.error || reply.error;
  if (!error) return '';
  const statusCode = Number(error?.data?.statusCode || error?.statusCode || error?.status) || 0;
  const code = statusCode ? `AI_MODEL_${statusCode}` : 'AI_MODEL_REJECTED';
  const message = typeof error === 'string'
    ? error
    : typeof error.message === 'string'
      ? error.message
      : typeof error.data?.message === 'string'
        ? error.data.message
        : compactValue(error);
  return `${code}: ${message}`;
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

function sanitizeError(value, limit = 300) {
  const text = compactValue(value, limit)
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/api[-_ ]?key["'\s:=]+[A-Za-z0-9._~+/-]+/gi, 'apiKey=[redacted]')
    .replace(/token["'\s:=]+[A-Za-z0-9._~+/-]+/gi, 'token=[redacted]');
  return text;
}

function metadataSkillId(metadata) {
  const value = metadata && typeof metadata === 'object' ? metadata.skillId : '';
  return typeof value === 'string' && skillMap[value] ? value : undefined;
}

function metadataThinkingEffort(metadata) {
  const value = metadata && typeof metadata === 'object' ? metadata.thinkingEffort : '';
  return ['low', 'medium', 'high'].includes(value) ? value : undefined;
}

function isDefOpenCodeSession(info) {
  const metadata = info?.metadata || {};
  if (metadata.defOpencode === true || metadata.app === 'dmg-end-field') return true;
  return info?.directory === getAgentWorkspaceDir();
}

function buildSessionCreatePayload({ selected, deepseek, skillId, thinkingEffort }) {
  const normalizedSkillId = skillMap[skillId] ? skillId : 'operator';
  return {
    title: `DEF ${selected.label} - ${new Date().toISOString()}`,
    agent: selected.agent,
    model: {
      providerID: 'deepseek',
      id: deepseek.model,
    },
    metadata: {
      defOpencode: true,
      app: 'dmg-end-field',
      schemaVersion: DEF_TRANSCRIPT_SCHEMA_VERSION,
      skillId: normalizedSkillId,
      host: normalizedSkillId === 'workbench' ? 'workbench' : 'ai-cli',
      thinkingEffort: normalizeThinkingEffort(thinkingEffort),
    },
  };
}

function mapOpenCodeSessionSummary(info) {
  const skillId = metadataSkillId(info?.metadata) || Object.keys(skillMap).find((id) => skillMap[id].agent === info?.agent);
  return {
    id: info.id,
    sessionID: info.id,
    title: info.title,
    agent: info.agent,
    model: modelIdFromOpenCodeSession(info),
    skillId,
    directory: info.directory,
    active: false,
    stopped: Boolean(info.time?.archived),
    archived: Boolean(info.time?.archived),
    createdAt: info.time?.created,
    updatedAt: info.time?.updated,
    tokens: normalizeTokens(info.tokens),
    lastSeq: 0,
    persisted: true,
  };
}

function modelIdFromOpenCodeSession(info, fallback) {
  const model = info?.model;
  if (typeof model === 'string' && model.trim()) return model.trim();
  if (typeof model?.id === 'string' && model.id.trim()) return model.id.trim();
  if (typeof model?.modelID === 'string' && model.modelID.trim()) return model.modelID.trim();
  return fallback;
}

function proposalIdFromValue(value) {
  if (!value || typeof value !== 'object') return undefined;
  for (const key of ['proposalId', 'proposalID', 'id', 'recordId']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function summarizeToolPart(part) {
  const state = part?.state || {};
  const metadata = state.metadata && typeof state.metadata === 'object' ? state.metadata : {};
  const output = state.output && typeof state.output === 'object' ? state.output : {};
  const proposalId = proposalIdFromValue(metadata) || proposalIdFromValue(output);
  const status = state.status === 'completed' ? 'done' : state.status === 'error' ? 'error' : 'running';
  return {
    id: part.id,
    kind: 'tool',
    title: String(state.title || part.tool || part.name || '工具调用'),
    detail: proposalId ? `提案 ${proposalId}` : status === 'running' ? '运行中' : status === 'error' ? '执行异常' : '已返回结果',
    result: proposalId ? `proposal=${proposalId}` : undefined,
    proposalId,
    status,
  };
}

function safeToolTitle(part, fallback = '工具调用') {
  return String(part?.state?.title || part?.tool || part?.name || fallback);
}

function defBusinessToolName(part) {
  const input = part?.state?.input;
  if (!input || typeof input !== 'object') return undefined;
  let body = input.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = undefined;
    }
  }
  if (body && typeof body === 'object' && typeof body.tool === 'string') {
    return body.tool;
  }
  const url = typeof input.url === 'string' ? input.url : '';
  const directMatch = /\/api\/def-tools\/([^/?]+)\/call(?:[/?]|$)/.exec(url);
  if (!directMatch) return undefined;
  try {
    return decodeURIComponent(directMatch[1]);
  } catch {
    return directMatch[1];
  }
}

function buildSafeToolPayload(part) {
  const summary = summarizeToolPart(part);
  return {
    id: part.id,
    partId: part.id,
    callId: part.callID,
    messageId: part.messageID,
    toolName: part.tool || part.name || 'tool',
    businessToolName: defBusinessToolName(part),
    status: summary.status,
    title: summary.title,
    result: summary.result,
    proposalId: summary.proposalId,
    summary: summary.detail,
    error: summary.status === 'error' ? sanitizeError(part.state?.error) : undefined,
  };
}

function textFromMessageParts(parts = []) {
  return parts
    .filter((part) => part?.type === 'text' && part.ignored !== true && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function userVisibleReply(text) {
  const normalized = typeof text === 'string' ? text.trim() : '';
  if (!normalized || !/\b(?:Goal|Constraints|Progress|Key Decisions|Next Steps|Critical Context|Relevant Files)\b/i.test(normalized)) return normalized;
  if (/checkout\s*[:=]\s*false|暂不应用|尚未应用/i.test(normalized)) return '已生成排轴草稿，尚未应用到当前时间轴。';
  if (/\bpending\b|等待(?:浏览器|执行|确认)|queued/i.test(normalized)) return '正在应用到当前时间轴，等待执行确认。';
  return '已完成本轮排轴操作。';
}

function mapOpenCodeMessagesToDefTranscript(messages = [], sessionInfo) {
  const transcript = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const info = message?.info || {};
    const parts = Array.isArray(message?.parts) ? message.parts : [];
    if (info.role === 'user') {
      const text = textFromMessageParts(parts) || (typeof info.text === 'string' ? info.text : '');
      if (!text) continue;
      transcript.push({
        id: info.id,
        role: 'user',
        text,
        sessionId: info.sessionID || sessionInfo?.id,
        createdAt: info.time?.created,
      });
      continue;
    }

    if (info.role !== 'assistant') continue;
    const text = textFromMessageParts(parts);
    const toolActivity = parts.filter((part) => part?.type === 'tool').map(summarizeToolPart);
    const hasReasoning = parts.some((part) => part?.type === 'reasoning');
    const finish = [...parts].reverse().find((part) => part?.type === 'step-finish');
    const tokens = normalizeTokens(finish?.tokens || info.tokens);
    const activity = [];
    if (hasReasoning) {
      activity.push({
        id: `${info.id || 'assistant'}-reasoning`,
        kind: 'reasoning',
        title: '思考',
        detail: '隐藏推理已保护',
        status: 'done',
      });
    }
    activity.push(...toolActivity);
    if (info.error) {
      activity.push({
        id: `${info.id || 'assistant'}-error`,
        kind: 'event',
        title: '运行异常',
        detail: sanitizeError(info.error),
        status: 'error',
      });
    }
    transcript.push({
      id: info.id,
      role: 'agent',
      text: userVisibleReply(text) || (info.error ? sanitizeError(info.error) : ''),
      sessionId: info.sessionID || sessionInfo?.id,
      activity,
      tokens,
      isStreaming: false,
      createdAt: info.time?.created,
      updatedAt: info.time?.completed || info.time?.updated,
    });
  }
  return transcript;
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
    reasoningStatus: new Map(),
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

function emitReasoningProgress(state, part, status = 'running') {
  if (!part?.id) return;
  const nextStatus = status === 'done' || part.time?.end ? 'done' : 'running';
  const previousStatus = state.reasoningStatus.get(part.id);
  if (previousStatus === nextStatus) return;
  state.reasoningStatus.set(part.id, nextStatus);
  emitStreamEvent(state, 'reasoning', {
    partId: part.id,
    messageId: part.messageID,
    status: nextStatus,
    redacted: true,
    summary: nextStatus === 'done' ? '隐藏推理已保护' : '正在分析上下文',
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
        title: safeToolTitle(part),
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
      result: undefined,
      error,
      title: safeToolTitle(part, '子代理已拦截'),
      summary: '子代理调用已拦截',
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
      title: safeToolTitle(part),
    });
  }
  state.toolStatus.set(part.id, status);
  emitStreamEvent(state, status === 'error' ? 'tool.error' : 'tool.content', buildSafeToolPayload(part));
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
      error: sanitizeError(properties.error || properties),
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
        error: sanitizeError(info.error),
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
      emitReasoningProgress(state, part);
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
    if (partType === 'reasoning') {
      emitReasoningProgress(state, {
        id: partId,
        messageID: properties.messageID,
        sessionID: properties.sessionID,
      });
      return;
    }
    const previous = state.partText.get(partId) || '';
    state.partText.set(partId, `${previous}${properties.delta}`);
    emitStreamEvent(state, 'text', {
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
    if (part.type === 'reasoning') emitReasoningProgress(state, part);
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

async function listPersistedDefSessions({ config = {}, skillId = 'operator', thinkingEffort = 'medium', limit = 100 } = {}) {
  const deepseek = sanitizeDeepSeekConfig(config);
  const directory = getAgentWorkspaceDir();
  const baseUrl = await getOpenCodeServerForRead(deepseek, skillId, thinkingEffort);
  const query = new URLSearchParams({
    directory,
    roots: 'true',
    limit: String(limit),
  });
  const sessions = await requestJson('GET', `${baseUrl}/session?${query.toString()}`, undefined, undefined, 15000);
  return (Array.isArray(sessions) ? sessions : [])
    .filter(isDefOpenCodeSession)
    .map(mapOpenCodeSessionSummary)
    .sort((left, right) => (right.updatedAt || right.createdAt || 0) - (left.updatedAt || left.createdAt || 0));
}

async function getPersistedDefSession(sessionID, { config = {}, skillId = 'operator', thinkingEffort = 'medium' } = {}) {
  if (!sessionID) throw new Error('session id is required');
  const deepseek = sanitizeDeepSeekConfig(config);
  const rootDirectory = getAgentWorkspaceDir();
  const baseUrl = await getOpenCodeServerForRead(deepseek, skillId, thinkingEffort);
  const listQuery = new URLSearchParams({ directory: rootDirectory, roots: 'true', limit: '500' });
  const sessions = await requestJson('GET', `${baseUrl}/session?${listQuery.toString()}`, undefined, undefined, 15000);
  const candidate = (Array.isArray(sessions) ? sessions : []).find((item) => item?.id === sessionID && isDefOpenCodeSession(item));
  if (!candidate) {
    const error = new Error('persisted DEF session not found');
    error.code = 'DEF_SESSION_NOT_FOUND';
    throw error;
  }
  const directory = typeof candidate.directory === 'string' && candidate.directory.trim()
    ? candidate.directory
    : rootDirectory;
  const query = `directory=${encodeURIComponent(directory)}`;
  const session = await requestJson('GET', `${baseUrl}/session/${encodeURIComponent(sessionID)}?${query}`, undefined, undefined, 15000);
  if (!isDefOpenCodeSession(session)) {
    const error = new Error('persisted DEF session not found');
    error.code = 'DEF_SESSION_NOT_FOUND';
    throw error;
  }
  return {
    baseUrl,
    directory,
    session,
    summary: mapOpenCodeSessionSummary(session),
  };
}

async function hydrateDefSession(sessionID, options = {}) {
  const persisted = await getPersistedDefSession(sessionID, options);
  const query = `directory=${encodeURIComponent(persisted.directory)}`;
  const messages = await requestJson(
    'GET',
    `${persisted.baseUrl}/session/${encodeURIComponent(sessionID)}/message?${query}`,
    undefined,
    undefined,
    20000,
  );
  return {
    session: persisted.summary,
    messages: mapOpenCodeMessagesToDefTranscript(messages, persisted.session),
  };
}

async function ensurePersistedStreamSession(sessionID, { config = {}, skillId, thinkingEffort } = {}) {
  const existing = streamSessions.get(sessionID);
  if (existing) {
    if (skillId && existing.skillId !== skillId) {
      const error = new Error(`DEF session skill mismatch: expected ${skillId}, received ${existing.skillId || 'unknown'}`);
      error.code = 'DEF_SESSION_SKILL_MISMATCH';
      throw error;
    }
    return existing;
  }

  const persisted = await getPersistedDefSession(sessionID, {
    config,
    skillId: skillId || 'operator',
    thinkingEffort: thinkingEffort || 'medium',
  });
  const session = persisted.session || {};
  const metadataSkill = metadataSkillId(session.metadata);
  if (skillId && metadataSkill && metadataSkill !== skillId) {
    const error = new Error(`DEF session skill mismatch: expected ${skillId}, received ${metadataSkill}`);
    error.code = 'DEF_SESSION_SKILL_MISMATCH';
    throw error;
  }
  const persistedSkillId = metadataSkill || skillId || Object.keys(skillMap).find((id) => skillMap[id].agent === session.agent) || 'operator';
  const selected = skillMap[persistedSkillId] || skillMap.operator;
  const persistedThinkingEffort = metadataThinkingEffort(session.metadata) || thinkingEffort || 'medium';
  const liveBaseUrl = await ensureOpenCodeServer(sanitizeDeepSeekConfig(config), persistedSkillId, persistedThinkingEffort);
  const state = makeStreamState({
    baseUrl: liveBaseUrl,
    directory: persisted.directory,
    sessionID,
    agent: session.agent || selected.agent,
    model: modelIdFromOpenCodeSession(session, sanitizeDeepSeekConfig(config).model),
    skillId: persistedSkillId,
    thinkingEffort: persistedThinkingEffort,
  });
  state.createdAt = session.time?.created || state.createdAt;
  state.updatedAt = session.time?.updated || state.updatedAt;
  state.tokens = normalizeTokens(session.tokens);
  return state;
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

function getLiveDefTranscript(sessionID) {
  const state = streamSessions.get(sessionID);
  if (!state) return null;

  const turns = new Map();
  for (const event of state.buffer) {
    const turnId = event.turnId || 'default';
    if (!turns.has(turnId)) {
      turns.set(turnId, {
        turnId,
        userText: '',
        assistantText: '',
        activity: [],
        tokens: undefined,
        createdAt: event.at,
        updatedAt: event.at,
        done: false,
      });
    }
    const turn = turns.get(turnId);
    turn.updatedAt = event.at || turn.updatedAt;

    if (event.type === 'message.start') {
      turn.userText = event.text || turn.userText;
    } else if (event.type === 'text') {
      turn.assistantText += event.text || '';
    } else if (event.type === 'reasoning') {
      const existing = turn.activity.find((item) => item.kind === 'reasoning');
      if (existing) {
        existing.status = event.status === 'done' ? 'done' : 'running';
        existing.detail = event.summary || existing.detail;
      } else {
        turn.activity.push({
          id: `${turnId}-reasoning`,
          kind: 'reasoning',
          title: '思考',
          detail: event.summary || '隐藏推理已保护',
          status: event.status === 'done' ? 'done' : 'running',
        });
      }
    } else if (event.type === 'tool.start' || event.type === 'tool.content' || event.type === 'tool.error') {
      const toolId = event.partId || event.id || `${turnId}-tool-${turn.activity.length}`;
      const existing = turn.activity.find((item) => item.id === toolId);
      const next = {
        id: toolId,
        kind: 'tool',
        title: event.title || event.toolName || '工具调用',
        detail: event.summary || event.result || event.error || '',
        status: event.type === 'tool.error' ? 'error' : event.status === 'running' ? 'running' : 'done',
      };
      if (existing) Object.assign(existing, next);
      else turn.activity.push(next);
    } else if (event.type === 'step.finish') {
      turn.tokens = event.tokens || turn.tokens;
    } else if (event.type === 'done') {
      turn.done = true;
      turn.assistantText = event.content || turn.assistantText;
      turn.tokens = event.tokens || turn.tokens;
    } else if (event.type === 'error' || event.type === 'stopped') {
      turn.activity.push({
        id: `${turnId}-${event.type}`,
        kind: 'event',
        title: event.type === 'stopped' ? '已停止' : '运行异常',
        detail: event.error || '',
        status: event.type === 'stopped' ? 'done' : 'error',
      });
    }
  }

  const messages = [];
  for (const turn of turns.values()) {
    if (turn.userText) {
      messages.push({
        id: `${turn.turnId}-user`,
        role: 'user',
        text: turn.userText,
        sessionId: state.sessionID,
        createdAt: turn.createdAt,
      });
    }
    if (turn.assistantText || turn.activity.length) {
      messages.push({
        id: `${turn.turnId}-agent`,
        role: 'agent',
        text: userVisibleReply(turn.assistantText),
        sessionId: state.sessionID,
        activity: turn.activity,
        tokens: turn.tokens,
        isStreaming: state.active && !turn.done,
        createdAt: turn.createdAt,
        updatedAt: turn.updatedAt,
      });
    }
  }

  return {
    session: {
      id: state.sessionID,
      sessionID: state.sessionID,
      title: `DEF ${state.skillId || 'agent'} live session`,
      agent: state.agent,
      model: state.model,
      skillId: state.skillId,
      active: state.active,
      stopped: state.stopped,
      archived: false,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      tokens: state.tokens,
      lastSeq: state.nextSeq - 1,
      persisted: false,
      live: true,
    },
    messages,
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
        emitStreamEvent(state, 'error', { error: sanitizeError(error instanceof Error ? error.message : String(error)) });
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
    const replyError = extractReplyError(reply);
    if (replyError) {
      throw new Error(replyError);
    }
    emitReplyRemainder(state, reply);
    emitStreamEvent(state, 'done', {
      turnId,
      ok: true,
      content: userVisibleReply(extractText(reply.parts)),
      tokens: state.tokens || normalizeTokens(reply.parts?.find((part) => part.type === 'step-finish')?.tokens),
    });
  } catch (error) {
    const stopped = runController.signal.aborted;
    state.stopped = stopped;
    emitStreamEvent(state, stopped ? 'stopped' : 'error', {
      turnId,
      error: sanitizeError(error instanceof Error ? error.message : String(error)),
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
  const directory = createAgentSessionWorkspace(skillId);
  const baseUrl = await ensureOpenCodeServer(deepseek, skillId, thinkingEffort);
  const query = `directory=${encodeURIComponent(directory)}`;
  const sessionPayload = buildSessionCreatePayload({ selected, deepseek, skillId, thinkingEffort });
  const session = await requestJson('POST', `${baseUrl}/session?${query}`, sessionPayload, undefined, 15000);
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

async function continueChat(sessionID, message, clientTurnId, options = {}) {
  const deepseek = sanitizeDeepSeekConfig(options.config || {});
  let state = streamSessions.get(sessionID);
  if (state && options.skillId && state.skillId !== options.skillId) {
    const error = new Error(`DEF session skill mismatch: expected ${options.skillId}, received ${state.skillId || 'unknown'}`);
    error.code = 'DEF_SESSION_SKILL_MISMATCH';
    throw error;
  }
  if (!state) {
    if (!deepseek.apiKey) {
      throw new Error('DeepSeek API key is not configured in DEF Shell 05 Agent.');
    }
    state = await ensurePersistedStreamSession(sessionID, {
      config: deepseek,
      skillId: options.skillId,
      thinkingEffort: options.thinkingEffort,
    });
    emitStreamEvent(state, 'session.created', {
      turnId: clientTurnId,
      sessionId: state.sessionID,
      agent: state.agent,
      skillId: state.skillId,
      model: state.model,
      resumed: true,
    });
  }
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
  const detail = sanitizeError(error instanceof Error ? error.message : String(error));
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
  const directory = createAgentSessionWorkspace(skillId);
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
    const sessionPayload = buildSessionCreatePayload({ selected, deepseek, skillId, thinkingEffort });
    const session = await requestJson('POST', `${baseUrl}/session?${query}`, sessionPayload, runController.signal, 15000);
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
      error: sanitizeError(error instanceof Error ? error.message : String(error)),
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
        const detail = sanitizeError(error instanceof Error ? error.message : String(error));
        emitStreamEvent(state, 'error', { error: detail });
        return {
          ok: false,
          stopped: true,
          sessionID: state.sessionID,
          reason: detail,
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
  const manifest = getRuntimeManifest();
  const checksums = getRuntimeChecksums();
  let binaryPath = '';
  let binaryAvailable = false;
  let binaryError = '';
  try {
    binaryPath = resolveOpenCodeBinary();
    binaryAvailable = true;
  } catch (error) {
    binaryError = error instanceof Error ? error.message : String(error);
  }
  return {
    kind: 'embedded-opencode-runtime-binary',
    runtimeRoot: path.relative(projectRoot, runtimeRoot).replace(/\\/g, '/'),
    runtimeTarget: platformRuntimeTarget(),
    binaryPath: binaryPath ? path.relative(projectRoot, binaryPath).replace(/\\/g, '/') : '',
    binaryAvailable,
    binaryError,
    manifest: manifest ? {
      upstreamVersion: manifest.upstreamVersion,
      runtimeTarget: manifest.runtimeTarget,
      binary: manifest.binary,
      checksumSha256: manifest.checksumSha256,
      builtAt: manifest.builtAt,
    } : null,
    checksumAvailable: Boolean(checksums?.files),
    serverUrl: opencodeReadyUrl || `http://${OPENCODE_HOST}:${actualPort}`,
    portBase: OPENCODE_PORT_BASE,
    port: actualPort,
    running: processRunning(opencodeProcess),
    deepseek: summarizeConfig(config),
    capabilityPolicy: capabilityPolicySummary(),
    opencodeHome: getDefOpenCodeHome(),
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
  listPersistedDefSessions,
  getPersistedDefSession,
  hydrateDefSession,
  createAgentSessionWorkspace,
  getChatSessionStream,
  getLiveDefTranscript,
  shutdownRuntime,
};
