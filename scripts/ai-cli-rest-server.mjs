import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { buildMainWorkbenchEvidence } from '../src/agentKernel/mainWorkbench/evidenceRuntime.mjs';
import {
  MAIN_WORKBENCH_SUPPORTED_OPS,
  normalizeMainWorkbenchCommand,
  validateMainWorkbenchCommand,
} from '../src/agentKernel/mainWorkbench/commandSchemaRuntime.mjs';
import { buildAiTimelineCheckoutDecision } from '../src/agentKernel/timelineWorktree/checkoutDecision.mjs';

const HOST = '127.0.0.1';
const PORT = Number(process.env.AI_CLI_REST_PORT || 17321);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const storageDir = path.join(projectRoot, '.runtime', 'ai-cli-rest');
const agentScriptDir = path.join(projectRoot, '.runtime', 'def-agent', 'scripts');
const viteCacheDir = process.env.AI_CLI_REST_VITE_CACHE_DIR || path.join(projectRoot, '.runtime', 'vite-ai-cli-rest', String(process.pid));
const nowStoragePath = path.join(projectRoot, 'data', 'localdata', 'now-storage.json');
const aiTimelineWorkNodesPath = path.join(projectRoot, 'data', 'localdata', 'ai-timeline-worknodes.json');
const storageMode = process.env.AI_CLI_REST_STORAGE_MODE || 'now-storage';
const serverStartedAt = new Date().toISOString();
const SCRIPT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}\.m?js$/;
const SCRIPT_MAX_FILES = 3;
const SCRIPT_MAX_BYTES = 30000;
const SCRIPT_MAX_LINES = 500;
const SCRIPT_TIMEOUT_MS = 8000;
const SCRIPT_MAX_STDOUT = 256 * 1024;
const SCRIPT_MAX_STDERR = 64 * 1024;
const MAIN_WORKBENCH_COMMAND_QUEUE_KEY = 'def.main-workbench.command-queue.v1';
const MAIN_WORKBENCH_RESULT_LOG_KEY = 'def.main-workbench.result-log.v1';
const MAIN_WORKBENCH_SNAPSHOT_KEY = 'def.main-workbench.snapshot.v1';
const MAIN_WORKBENCH_SUPPORTED_OP_SET = new Set(MAIN_WORKBENCH_SUPPORTED_OPS);

class FileStorage {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = this.read();
  }

  read() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return {};
      }
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  flush() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this.data, key) ? String(this.data[key]) : null;
  }

  setItem(key, value) {
    this.data[key] = String(value);
    this.flush();
  }

  removeItem(key) {
    delete this.data[key];
    this.flush();
  }

  clear() {
    this.data = {};
    this.flush();
  }
}

class NowStorageLocalStorage {
  constructor(filePath, fallbackFilePath) {
    this.filePath = filePath;
    this.fallback = new FileStorage(fallbackFilePath);
    this.archive = this.readArchive();
  }

  readArchive() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return null;
      }
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      if (!parsed || parsed.type !== 'def.localdata.archive.v1' || !parsed.storage) {
        return null;
      }
      parsed.storage.local = parsed.storage.local && typeof parsed.storage.local === 'object'
        ? parsed.storage.local
        : {};
      parsed.storage.session = parsed.storage.session && typeof parsed.storage.session === 'object'
        ? parsed.storage.session
        : {};
      return parsed;
    } catch {
      return null;
    }
  }

  ensureArchive() {
    if (this.archive) {
      return this.archive;
    }
    this.archive = {
      type: 'def.localdata.archive.v1',
      schemaVersion: 1,
      id: 'now-storage',
      name: 'now-storage',
      createdAt: new Date().toISOString(),
      exportedAt: new Date().toISOString(),
      sections: ['all'],
      storage: {
        local: {},
        session: {},
      },
    };
    return this.archive;
  }

  flush() {
    const archive = this.ensureArchive();
    archive.exportedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(archive, null, 2)}\n`, 'utf-8');
  }

  get local() {
    return this.archive?.storage?.local || {};
  }

  refresh() {
    const nextArchive = this.readArchive();
    if (nextArchive) {
      this.archive = nextArchive;
    }
  }

  getItem(key) {
    this.refresh();
    if (!this.archive) {
      return this.fallback.getItem(key);
    }
    if (!Object.prototype.hasOwnProperty.call(this.local, key)) {
      return null;
    }
    const value = this.local[key];
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  setItem(key, value) {
    this.refresh();
    const archive = this.ensureArchive();
    try {
      archive.storage.local[key] = JSON.parse(String(value));
    } catch {
      archive.storage.local[key] = String(value);
    }
    this.fallback.setItem(key, value);
    this.flush();
  }

  removeItem(key) {
    if (!this.archive) {
      this.fallback.removeItem(key);
      return;
    }
    delete this.archive.storage.local[key];
    this.fallback.removeItem(key);
    this.flush();
  }

  clear() {
    const archive = this.ensureArchive();
    archive.storage.local = {};
    this.fallback.clear();
    this.flush();
  }
}

function installNodeWindowStorage() {
  const localStorage = storageMode === 'runtime'
    ? new FileStorage(path.join(storageDir, 'localStorage.json'))
    : new NowStorageLocalStorage(nowStoragePath, path.join(storageDir, 'localStorage.json'));
  const sessionStorage = new FileStorage(path.join(storageDir, 'sessionStorage.json'));
  globalThis.window = {
    localStorage,
    sessionStorage,
  };
}

function buildJsonHeaders() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, buildJsonHeaders());
  response.end(JSON.stringify(payload));
}

function failScript(status, code, message, details = undefined) {
  return {
    status,
    body: {
      ok: false,
      protocolVersion: 1,
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    },
  };
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeWorkNodeId(value, fallbackPrefix) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : makeId(fallbackPrefix);
  return raw
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || makeId(fallbackPrefix);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function summarizeTimelinePayload(payload) {
  const selectedCharacters = Array.isArray(payload?.selectedCharacters) ? payload.selectedCharacters : [];
  const skillButtonTable = isObject(payload?.skillButtonTable) ? payload.skillButtonTable : {};
  const allBuffList = Array.isArray(payload?.allBuffList) ? payload.allBuffList : [];
  return {
    characterCount: selectedCharacters.length,
    buttonCount: Object.keys(skillButtonTable).length,
    buffCount: allBuffList.length,
  };
}

function diffTimelinePayloadSummary(basePayload, workingPayload) {
  const baseButtons = new Set(Object.keys(isObject(basePayload?.skillButtonTable) ? basePayload.skillButtonTable : {}));
  const workingButtons = new Set(Object.keys(isObject(workingPayload?.skillButtonTable) ? workingPayload.skillButtonTable : {}));
  const baseBuffs = new Set((Array.isArray(basePayload?.allBuffList) ? basePayload.allBuffList : []).map((buff) => buff?.id).filter(Boolean));
  const workingBuffs = new Set((Array.isArray(workingPayload?.allBuffList) ? workingPayload.allBuffList : []).map((buff) => buff?.id).filter(Boolean));
  let addedButtonCount = 0;
  let removedButtonCount = 0;
  let addedBuffCount = 0;
  let removedBuffCount = 0;
  for (const id of workingButtons) {
    if (!baseButtons.has(id)) addedButtonCount += 1;
  }
  for (const id of baseButtons) {
    if (!workingButtons.has(id)) removedButtonCount += 1;
  }
  for (const id of workingBuffs) {
    if (!baseBuffs.has(id)) addedBuffCount += 1;
  }
  for (const id of baseBuffs) {
    if (!workingBuffs.has(id)) removedBuffCount += 1;
  }
  return {
    addedButtonCount,
    removedButtonCount,
    changedButtonCount: 0,
    addedBuffCount,
    removedBuffCount,
    beforeButtonCount: baseButtons.size,
    afterButtonCount: workingButtons.size,
    beforeBuffCount: baseBuffs.size,
    afterBuffCount: workingBuffs.size,
  };
}

function normalizeWorkNodeButton(button) {
  const item = {
    id: button.id,
    characterName: button.characterName,
    skillType: button.skillType,
    skillDisplayName: button.skillDisplayName,
    staffIndex: button.staffIndex,
    nodeIndex: button.nodeIndex,
    selectedBuffIds: Array.isArray(button.selectedBuff) ? [...button.selectedBuff].sort() : [],
  };
  return {
    ...item,
    label: `${item.characterName}-${item.skillDisplayName || item.skillType}@${item.staffIndex + 1}-${(item.nodeIndex ?? 0) + 1}`,
  };
}

function normalizeWorkNodeBuff(buff) {
  return {
    id: buff.id,
    displayName: buff.displayName || buff.name || buff.id,
    sourceName: buff.sourceName,
  };
}

function diffArrayField(changes, field, before, after) {
  const beforeValue = Array.isArray(before) ? JSON.stringify(before) : before;
  const afterValue = Array.isArray(after) ? JSON.stringify(after) : after;
  if (beforeValue !== afterValue) {
    changes.push({ field, before, after });
  }
}

function diffTimelinePayloadsForWorkNode(basePayload, workingPayload) {
  const baseButtons = new Map(Object.values(isObject(basePayload?.skillButtonTable) ? basePayload.skillButtonTable : {})
    .map((button) => [button.id, normalizeWorkNodeButton(button)]));
  const workingButtons = new Map(Object.values(isObject(workingPayload?.skillButtonTable) ? workingPayload.skillButtonTable : {})
    .map((button) => [button.id, normalizeWorkNodeButton(button)]));
  const baseBuffs = new Map((Array.isArray(basePayload?.allBuffList) ? basePayload.allBuffList : [])
    .map((buff) => [buff.id, normalizeWorkNodeBuff(buff)]));
  const workingBuffs = new Map((Array.isArray(workingPayload?.allBuffList) ? workingPayload.allBuffList : [])
    .map((buff) => [buff.id, normalizeWorkNodeBuff(buff)]));
  const addedButtons = [];
  const removedButtons = [];
  const changedButtons = [];
  const addedBuffs = [];
  const removedBuffs = [];

  for (const [id, after] of workingButtons) {
    const before = baseButtons.get(id);
    if (!before) {
      addedButtons.push(after);
      continue;
    }
    const changes = [];
    diffArrayField(changes, 'characterName', before.characterName, after.characterName);
    diffArrayField(changes, 'skillType', before.skillType, after.skillType);
    diffArrayField(changes, 'skillDisplayName', before.skillDisplayName, after.skillDisplayName);
    diffArrayField(changes, 'staffIndex', before.staffIndex, after.staffIndex);
    diffArrayField(changes, 'nodeIndex', before.nodeIndex, after.nodeIndex);
    diffArrayField(changes, 'selectedBuffIds', before.selectedBuffIds, after.selectedBuffIds);
    if (changes.length) changedButtons.push({ id, before, after, changes });
  }
  for (const [id, before] of baseButtons) {
    if (!workingButtons.has(id)) removedButtons.push(before);
  }
  for (const [id, buff] of workingBuffs) {
    if (!baseBuffs.has(id)) addedBuffs.push(buff);
  }
  for (const [id, buff] of baseBuffs) {
    if (!workingBuffs.has(id)) removedBuffs.push(buff);
  }

  return {
    summary: {
      addedButtonCount: addedButtons.length,
      removedButtonCount: removedButtons.length,
      changedButtonCount: changedButtons.length,
      addedBuffCount: addedBuffs.length,
      removedBuffCount: removedBuffs.length,
      beforeButtonCount: baseButtons.size,
      afterButtonCount: workingButtons.size,
      beforeBuffCount: baseBuffs.size,
      afterBuffCount: workingBuffs.size,
    },
    selectedCharactersChanged: JSON.stringify(basePayload?.selectedCharacters || []) !== JSON.stringify(workingPayload?.selectedCharacters || []),
    beforeSelectedCharacters: Array.isArray(basePayload?.selectedCharacters) ? basePayload.selectedCharacters : [],
    afterSelectedCharacters: Array.isArray(workingPayload?.selectedCharacters) ? workingPayload.selectedCharacters : [],
    addedButtons: addedButtons.sort((left, right) => left.label.localeCompare(right.label)),
    removedButtons: removedButtons.sort((left, right) => left.label.localeCompare(right.label)),
    changedButtons: changedButtons.sort((left, right) => left.after.label.localeCompare(right.after.label)),
    addedBuffs: addedBuffs.sort((left, right) => left.displayName.localeCompare(right.displayName)),
    removedBuffs: removedBuffs.sort((left, right) => left.displayName.localeCompare(right.displayName)),
  };
}

function buildAiTimelineWorkNodeDiff(node) {
  const riskFlags = Array.isArray(node.riskFlags) ? node.riskFlags : [];
  const diff = diffTimelinePayloadsForWorkNode(node.basePayload, node.workingPayload);
  const checkoutDecision = buildAiTimelineCheckoutDecision({
    approvalPolicy: node.approvalPolicy,
    riskFlags,
    diff,
  });
  return {
    nodeId: node.id,
    saveId: node.saveId,
    branchId: node.branchId,
    status: node.status,
    diff,
    riskFlags,
    readyToCheckout: checkoutDecision.canAutoApprove || !checkoutDecision.requiresManualApproval,
    checkoutDecision,
  };
}

function readAiTimelineWorkNodeArchive() {
  try {
    if (!fs.existsSync(aiTimelineWorkNodesPath)) {
      return { type: 'def.ai-timeline.worknodes.v1', schemaVersion: 1, nodes: [], commits: [] };
    }
    const parsed = JSON.parse(fs.readFileSync(aiTimelineWorkNodesPath, 'utf-8'));
    if (!parsed || parsed.type !== 'def.ai-timeline.worknodes.v1') {
      return { type: 'def.ai-timeline.worknodes.v1', schemaVersion: 1, nodes: [], commits: [] };
    }
    return {
      type: 'def.ai-timeline.worknodes.v1',
      schemaVersion: 1,
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      commits: Array.isArray(parsed.commits) ? parsed.commits : [],
    };
  } catch {
    return { type: 'def.ai-timeline.worknodes.v1', schemaVersion: 1, nodes: [], commits: [] };
  }
}

function writeAiTimelineWorkNodeArchive(archive) {
  fs.mkdirSync(path.dirname(aiTimelineWorkNodesPath), { recursive: true });
  fs.writeFileSync(aiTimelineWorkNodesPath, `${JSON.stringify({
    type: 'def.ai-timeline.worknodes.v1',
    schemaVersion: 1,
    nodes: Array.isArray(archive.nodes) ? archive.nodes.slice(0, 50) : [],
    commits: Array.isArray(archive.commits) ? archive.commits.slice(0, 200) : [],
  }, null, 2)}\n`, 'utf-8');
}

function normalizeRiskFlags(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => isObject(item))
    .map((item) => ({
      id: typeof item.id === 'string' && item.id.trim() ? item.id : makeId('ai-timeline-risk'),
      severity: ['info', 'warning', 'blocker'].includes(item.severity) ? item.severity : 'warning',
      code: typeof item.code === 'string' && item.code.trim() ? item.code.trim() : 'unspecified-risk',
      message: typeof item.message === 'string' && item.message.trim() ? item.message.trim() : 'Unspecified AI timeline risk.',
      ...(typeof item.path === 'string' && item.path.trim() ? { path: item.path.trim() } : {}),
    }));
}

function normalizeApproval(value, fallbackMode = 'auto') {
  const approvedAt = Date.now();
  if (!isObject(value)) {
    return {
      mode: fallbackMode,
      approvedAt,
      approvedBy: fallbackMode === 'manual' ? 'user' : 'ai',
      rationale: fallbackMode === 'manual' ? 'Manual approval required.' : 'Auto-approved by low-risk work node policy.',
    };
  }
  const mode = value.mode === 'manual' ? 'manual' : 'auto';
  return {
    mode,
    approvedAt: typeof value.approvedAt === 'number' ? value.approvedAt : approvedAt,
    approvedBy: ['ai', 'user', 'system'].includes(value.approvedBy) ? value.approvedBy : (mode === 'manual' ? 'user' : 'ai'),
    rationale: typeof value.rationale === 'string' && value.rationale.trim()
      ? value.rationale.trim()
      : (mode === 'manual' ? 'Manual approval recorded.' : 'Auto-approved by work node policy.'),
  };
}

function makeWorkNodeLog(level, message, details = undefined) {
  return {
    id: makeId('ai-timeline-log'),
    at: Date.now(),
    level,
    message,
    ...(details ? { details } : {}),
  };
}

function validateWorkNodePayload(payload, fieldName) {
  if (!isObject(payload)) {
    return `${fieldName} must be an object.`;
  }
  if (!Array.isArray(payload.selectedCharacters)) {
    return `${fieldName}.selectedCharacters must be an array.`;
  }
  if (!isObject(payload.timelineData)) {
    return `${fieldName}.timelineData must be an object.`;
  }
  if (!Array.isArray(payload.timelineData.staffLines)) {
    return `${fieldName}.timelineData.staffLines must be an array.`;
  }
  if (!isObject(payload.skillButtonTable)) {
    return `${fieldName}.skillButtonTable must be an object.`;
  }
  if (!Array.isArray(payload.allBuffList)) {
    return `${fieldName}.allBuffList must be an array.`;
  }
  return null;
}

function handleAiTimelineWorkNodeRequest(method, pathname, body) {
  if (method === 'GET' && pathname === '/api/ai-timeline-worknodes') {
    const archive = readAiTimelineWorkNodeArchive();
    return {
      status: 200,
      body: {
        ok: true,
        protocolVersion: 1,
        path: aiTimelineWorkNodesPath,
        nodes: archive.nodes.sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0)),
        commits: archive.commits.sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0)),
      },
    };
  }

  if (method === 'POST' && pathname === '/api/ai-timeline-worknodes/create') {
    const saveId = sanitizeWorkNodeId(body?.saveId, 'save');
    if (!body?.saveId || typeof body.saveId !== 'string') {
      return failScript(400, 'missing-ai-worknode-save-id', 'AI work node create requires saveId.');
    }
    const basePayload = body?.basePayload;
    const payloadError = validateWorkNodePayload(basePayload, 'basePayload');
    if (payloadError) {
      return failScript(400, 'invalid-ai-worknode-base-payload', payloadError);
    }
    const requestedWorkingPayload = body?.workingPayload && isObject(body.workingPayload) ? body.workingPayload : basePayload;
    const workingPayloadError = validateWorkNodePayload(requestedWorkingPayload, 'workingPayload');
    if (workingPayloadError) {
      return failScript(400, 'invalid-ai-worknode-working-payload', workingPayloadError);
    }
    const now = Date.now();
    const branchId = sanitizeWorkNodeId(body?.branchId, 'branch');
    const node = {
      id: sanitizeWorkNodeId(body?.id, 'ai-timeline-node'),
      saveId,
      branchId,
      createdAt: now,
      updatedAt: now,
      label: typeof body?.label === 'string' && body.label.trim() ? body.label.trim() : 'AI Timeline Work Node',
      status: 'open',
      basePayload: cloneJson(basePayload),
      workingPayload: cloneJson(requestedWorkingPayload),
      baseSummary: summarizeTimelinePayload(basePayload),
      workingSummary: summarizeTimelinePayload(requestedWorkingPayload),
      approvalPolicy: ['auto-low-risk', 'ask-on-risk', 'manual'].includes(body?.approvalPolicy) ? body.approvalPolicy : 'auto-low-risk',
      riskFlags: normalizeRiskFlags(body?.riskFlags),
      logs: [makeWorkNodeLog('info', 'Created AI timeline work node from checkout payload.')],
    };
    const archive = readAiTimelineWorkNodeArchive();
    writeAiTimelineWorkNodeArchive({
      ...archive,
      nodes: [node, ...archive.nodes.filter((item) => item?.id !== node.id)],
    });
    return { status: 200, body: { ok: true, protocolVersion: 1, path: aiTimelineWorkNodesPath, node } };
  }

  const match = /^\/api\/ai-timeline-worknodes\/([^/]+)(?:\/([^/]+))?$/.exec(pathname);
  if (!match) {
    return null;
  }
  let nodeId = '';
  try {
    nodeId = decodeURIComponent(match[1]);
  } catch {
    return failScript(400, 'bad-ai-worknode-url', 'AI work node URL contains malformed percent-encoding.');
  }
  const action = match[2] || '';
  const archive = readAiTimelineWorkNodeArchive();
  const node = archive.nodes.find((item) => item?.id === nodeId);
  if (!node) {
    return failScript(404, 'ai-worknode-not-found', `AI timeline work node not found: ${nodeId}`);
  }

  if (method === 'GET' && !action) {
    return { status: 200, body: { ok: true, protocolVersion: 1, path: aiTimelineWorkNodesPath, node } };
  }

  if (method === 'GET' && action === 'diff') {
    return {
      status: 200,
      body: {
        ok: true,
        protocolVersion: 1,
        path: aiTimelineWorkNodesPath,
        ...buildAiTimelineWorkNodeDiff(node),
      },
    };
  }

  if (method === 'POST' && action === 'update') {
    const workingPayload = Object.prototype.hasOwnProperty.call(body || {}, 'workingPayload')
      ? body.workingPayload
      : node.workingPayload;
    const payloadError = validateWorkNodePayload(workingPayload, 'workingPayload');
    if (payloadError) {
      return failScript(400, 'invalid-ai-worknode-working-payload', payloadError);
    }
    const riskFlags = Object.prototype.hasOwnProperty.call(body || {}, 'riskFlags')
      ? normalizeRiskFlags(body.riskFlags)
      : (Array.isArray(node.riskFlags) ? node.riskFlags : []);
    const allowedStatuses = new Set(['open', 'ready', 'committed', 'applied', 'abandoned']);
    const nextNode = {
      ...node,
      updatedAt: Date.now(),
      status: allowedStatuses.has(body?.status) ? body.status : node.status,
      workingPayload: cloneJson(workingPayload),
      workingSummary: summarizeTimelinePayload(workingPayload),
      riskFlags,
      logs: [
        makeWorkNodeLog('info', 'Updated AI timeline work node.', {
          riskFlagCount: riskFlags.length,
          status: allowedStatuses.has(body?.status) ? body.status : node.status,
        }),
        ...(Array.isArray(node.logs) ? node.logs : []),
      ],
    };
    writeAiTimelineWorkNodeArchive({
      ...archive,
      nodes: [nextNode, ...archive.nodes.filter((item) => item?.id !== nodeId)],
    });
    return { status: 200, body: { ok: true, protocolVersion: 1, path: aiTimelineWorkNodesPath, node: nextNode } };
  }

  if (method === 'POST' && action === 'commit') {
    const riskFlags = Object.prototype.hasOwnProperty.call(body || {}, 'riskFlags')
      ? normalizeRiskFlags(body.riskFlags)
      : (Array.isArray(node.riskFlags) ? node.riskFlags : []);
    const hasBlocker = riskFlags.some((risk) => risk.severity === 'blocker');
    const explicitApproval = isObject(body?.approval);
    if (node.approvalPolicy === 'manual' && !explicitApproval) {
      return failScript(409, 'ai-worknode-requires-manual-approval', 'Manual approval policy requires explicit approval before commit.', {
        approvalPolicy: node.approvalPolicy,
      });
    }
    if (hasBlocker && !explicitApproval) {
      return failScript(409, 'ai-worknode-blocked-by-risk', 'Blocker risk flags require explicit approval before commit.', { riskFlags });
    }
    const approval = normalizeApproval(body?.approval, explicitApproval ? 'manual' : 'auto');
    const now = Date.now();
    const commit = {
      id: sanitizeWorkNodeId(body?.commitId, 'ai-timeline-commit'),
      nodeId: node.id,
      saveId: node.saveId,
      branchId: node.branchId,
      createdAt: now,
      label: typeof body?.label === 'string' && body.label.trim() ? body.label.trim() : node.label,
      summary: diffTimelinePayloadSummary(node.basePayload, node.workingPayload),
      basePayload: cloneJson(node.basePayload),
      appliedPayload: cloneJson(node.workingPayload),
      riskFlags,
      approval,
      checkoutApplied: false,
    };
    const nextNode = {
      ...node,
      status: 'committed',
      updatedAt: now,
      riskFlags,
      logs: [
        makeWorkNodeLog('info', `Committed AI timeline work node as ${commit.id}.`, { approval }),
        ...(Array.isArray(node.logs) ? node.logs : []),
      ],
    };
    writeAiTimelineWorkNodeArchive({
      ...archive,
      nodes: [nextNode, ...archive.nodes.filter((item) => item?.id !== nodeId)],
      commits: [commit, ...archive.commits.filter((item) => item?.id !== commit.id)],
    });
    return { status: 200, body: { ok: true, protocolVersion: 1, path: aiTimelineWorkNodesPath, node: nextNode, commit } };
  }

  if (method === 'POST' && action === 'checkout-applied') {
    const commitId = typeof body?.commitId === 'string' && body.commitId.trim() ? body.commitId.trim() : '';
    const commitsForNode = archive.commits
      .filter((commit) => commit?.nodeId === node.id)
      .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
    const targetCommit = commitId
      ? archive.commits.find((commit) => commit?.id === commitId && commit?.nodeId === node.id)
      : commitsForNode[0];
    if (!targetCommit) {
      return failScript(404, 'ai-worknode-commit-not-found', `AI timeline work node commit not found for node: ${node.id}`);
    }
    const appliedAt = typeof body?.appliedAt === 'number' ? body.appliedAt : Date.now();
    const appliedBy = ['ai', 'user', 'system'].includes(body?.appliedBy) ? body.appliedBy : 'system';
    const checkout = {
      appliedAt,
      appliedBy,
      rationale: typeof body?.rationale === 'string' && body.rationale.trim()
        ? body.rationale.trim()
        : 'Renderer checkout applied to current timeline payload.',
    };
    const nextCommit = {
      ...targetCommit,
      checkoutApplied: true,
      checkout,
    };
    const nextNode = {
      ...node,
      status: 'applied',
      updatedAt: appliedAt,
      logs: [
        makeWorkNodeLog('info', `Applied AI timeline work node checkout from ${nextCommit.id}.`, { checkout }),
        ...(Array.isArray(node.logs) ? node.logs : []),
      ],
    };
    writeAiTimelineWorkNodeArchive({
      ...archive,
      nodes: [nextNode, ...archive.nodes.filter((item) => item?.id !== node.id)],
      commits: [nextCommit, ...archive.commits.filter((item) => item?.id !== nextCommit.id)],
    });
    return { status: 200, body: { ok: true, protocolVersion: 1, path: aiTimelineWorkNodesPath, node: nextNode, commit: nextCommit } };
  }

  if (method === 'POST' && action === 'rollback-applied') {
    const appliedAt = typeof body?.appliedAt === 'number' ? body.appliedAt : Date.now();
    const appliedBy = ['ai', 'user', 'system'].includes(body?.appliedBy) ? body.appliedBy : 'system';
    const rollback = {
      appliedAt,
      appliedBy,
      rationale: typeof body?.rationale === 'string' && body.rationale.trim()
        ? body.rationale.trim()
        : 'Renderer rollback applied from AI timeline work node basePayload.',
    };
    const nextNode = {
      ...node,
      status: 'open',
      updatedAt: appliedAt,
      logs: [
        makeWorkNodeLog('info', 'Rolled back AI timeline work node from basePayload.', { rollback }),
        ...(Array.isArray(node.logs) ? node.logs : []),
      ],
    };
    writeAiTimelineWorkNodeArchive({
      ...archive,
      nodes: [nextNode, ...archive.nodes.filter((item) => item?.id !== node.id)],
    });
    return { status: 200, body: { ok: true, protocolVersion: 1, path: aiTimelineWorkNodesPath, node: nextNode, rollback } };
  }

  return null;
}

function ensureAgentScriptDir() {
  fs.mkdirSync(agentScriptDir, { recursive: true });
}

function resolveAgentScriptPath(name) {
  if (typeof name !== 'string' || !SCRIPT_NAME_RE.test(name)) {
    return {
      ok: false,
      response: failScript(
        400,
        'invalid-script-name',
        'Script name must be a simple .js or .mjs filename using letters, numbers, dot, dash, or underscore.',
      ),
    };
  }
  ensureAgentScriptDir();
  const scriptPath = path.resolve(agentScriptDir, name);
  const relative = path.relative(agentScriptDir, scriptPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return {
      ok: false,
      response: failScript(400, 'invalid-script-path', 'Script path must stay inside the DEF agent scripts directory.'),
    };
  }
  return { ok: true, scriptPath, name };
}

function listAgentScripts() {
  ensureAgentScriptDir();
  return fs.readdirSync(agentScriptDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && SCRIPT_NAME_RE.test(entry.name))
    .map((entry) => {
      const scriptPath = path.join(agentScriptDir, entry.name);
      const stat = fs.statSync(scriptPath);
      return {
        name: entry.name,
        bytes: stat.size,
        updatedAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function writeAgentScript(body) {
  const resolved = resolveAgentScriptPath(body?.name);
  if (!resolved.ok) return resolved.response;
  const content = typeof body?.content === 'string' ? body.content : '';
  const bytes = Buffer.byteLength(content, 'utf-8');
  const lines = content ? content.split(/\r?\n/).length : 0;
  if (!content.trim()) {
    return failScript(400, 'empty-script', 'Script content must not be empty.');
  }
  if (bytes > SCRIPT_MAX_BYTES || lines > SCRIPT_MAX_LINES) {
    return failScript(413, 'script-too-large', 'Script exceeds the DEF agent workspace limit.', {
      maxBytes: SCRIPT_MAX_BYTES,
      maxLines: SCRIPT_MAX_LINES,
      bytes,
      lines,
    });
  }
  const existing = listAgentScripts();
  if (!fs.existsSync(resolved.scriptPath) && existing.length >= SCRIPT_MAX_FILES) {
    return failScript(409, 'script-limit-reached', 'DEF agent script workspace only allows a few temporary scripts.', {
      maxFiles: SCRIPT_MAX_FILES,
      files: existing.map((item) => item.name),
    });
  }
  fs.writeFileSync(resolved.scriptPath, content.endsWith('\n') ? content : `${content}\n`, 'utf-8');
  const stat = fs.statSync(resolved.scriptPath);
  return {
    status: 200,
    body: {
      ok: true,
      protocolVersion: 1,
      script: {
        name: resolved.name,
        bytes: stat.size,
        lines,
        updatedAt: stat.mtime.toISOString(),
      },
      constraints: scriptWorkbenchConstraints(),
    },
  };
}

function deleteAgentScript(body) {
  const resolved = resolveAgentScriptPath(body?.name);
  if (!resolved.ok) return resolved.response;
  fs.rmSync(resolved.scriptPath, { force: true });
  return {
    status: 200,
    body: {
      ok: true,
      protocolVersion: 1,
      deleted: resolved.name,
      scripts: listAgentScripts(),
    },
  };
}

function runAgentScript(body) {
  const resolved = resolveAgentScriptPath(body?.name);
  if (!resolved.ok) return Promise.resolve(resolved.response);
  if (!fs.existsSync(resolved.scriptPath)) {
    return Promise.resolve(failScript(404, 'script-not-found', `DEF agent script not found: ${resolved.name}`));
  }

  return new Promise((resolve) => {
    const input = {
      protocolVersion: 1,
      input: body && Object.prototype.hasOwnProperty.call(body, 'input') ? body.input : null,
      restBaseUrl: `http://${HOST}:${PORT}`,
      constraints: scriptWorkbenchConstraints(),
    };
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(process.execPath, [
      '--permission',
      `--allow-fs-read=${agentScriptDir}`,
      `--allow-fs-write=${agentScriptDir}`,
      '--disallow-code-generation-from-strings',
      resolved.scriptPath,
    ], {
      cwd: agentScriptDir,
      env: {
        PATH: process.env.PATH || '',
        NODE_ENV: 'production',
        ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE || '1',
        DEF_REST_BASE_URL: `http://${HOST}:${PORT}`,
        DEF_AGENT_SCRIPT_DIR: agentScriptDir,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      if (!settled) {
        child.kill('SIGKILL');
      }
    }, SCRIPT_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf-8');
      if (stdout.length > SCRIPT_MAX_STDOUT) {
        stdout = stdout.slice(0, SCRIPT_MAX_STDOUT);
        child.kill('SIGKILL');
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
      if (stderr.length > SCRIPT_MAX_STDERR) {
        stderr = stderr.slice(0, SCRIPT_MAX_STDERR);
        child.kill('SIGKILL');
      }
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(failScript(500, 'script-spawn-failed', error instanceof Error ? error.message : String(error)));
    });
    child.on('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let json = null;
      try {
        json = stdout.trim() ? JSON.parse(stdout) : null;
      } catch {
        json = null;
      }
      resolve({
        status: code === 0 ? 200 : 400,
        body: {
          ok: code === 0,
          protocolVersion: 1,
          script: resolved.name,
          code,
          signal,
          stdout,
          stderr,
          json,
          timedOut: signal === 'SIGKILL',
        },
      });
    });
    child.stdin.end(`${JSON.stringify(input)}\n`);
  });
}

function scriptWorkbenchConstraints() {
  return {
    directory: agentScriptDir,
    maxFiles: SCRIPT_MAX_FILES,
    maxBytes: SCRIPT_MAX_BYTES,
    maxLines: SCRIPT_MAX_LINES,
    timeoutMs: SCRIPT_TIMEOUT_MS,
    runtime: 'node',
    allowedPurpose: 'Temporary DEF JSON cleanup, comparison, batching, and draft generation only.',
    finalWritePath: 'Use fill.check/fill.apply proposal flow; scripts must not save app truth directly.',
  };
}

function readMainWorkbenchJson(key, fallback) {
  try {
    const raw = globalThis.window?.localStorage?.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeMainWorkbenchJson(key, value) {
  globalThis.window?.localStorage?.setItem(key, JSON.stringify(value));
}

function makeMainWorkbenchCommandId() {
  return `mw-rest-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeMainWorkbenchCommandEntry(entry, fallbackSource = 'rest') {
  if (!entry || typeof entry !== 'object' || !entry.command || typeof entry.command !== 'object') {
    return null;
  }
  if (typeof entry.command.op !== 'string') {
    return null;
  }
  const command = normalizeMainWorkbenchCommand(entry.command);
  const now = Date.now();
  return {
    id: typeof entry.id === 'string' && entry.id.trim() ? entry.id : makeMainWorkbenchCommandId(),
    command,
    status: ['pending', 'running', 'done', 'error'].includes(entry.status) ? entry.status : 'pending',
    source: typeof entry.source === 'string' && entry.source.trim() ? entry.source : fallbackSource,
    createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : now,
    updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : now,
    ...(Object.prototype.hasOwnProperty.call(entry, 'result') ? { result: entry.result } : {}),
    ...(typeof entry.error === 'string' ? { error: entry.error } : {}),
  };
}

function readMainWorkbenchCommandQueue() {
  const raw = readMainWorkbenchJson(MAIN_WORKBENCH_COMMAND_QUEUE_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => normalizeMainWorkbenchCommandEntry(entry))
    .filter(Boolean);
}

function writeMainWorkbenchCommandQueue(queue) {
  writeMainWorkbenchJson(MAIN_WORKBENCH_COMMAND_QUEUE_KEY, queue);
}

function appendMainWorkbenchResult(entry) {
  const raw = readMainWorkbenchJson(MAIN_WORKBENCH_RESULT_LOG_KEY, []);
  const current = Array.isArray(raw) ? raw : [];
  const next = [entry, ...current.filter((item) => item?.id !== entry.id)].slice(0, 50);
  writeMainWorkbenchJson(MAIN_WORKBENCH_RESULT_LOG_KEY, next);
}

function handleMainWorkbenchRequest(method, pathname, query, body) {
  if (method === 'GET' && pathname === '/api/main-workbench/evidence') {
    const snapshot = readMainWorkbenchJson(MAIN_WORKBENCH_SNAPSHOT_KEY, null);
    return {
      status: 200,
      body: {
        ok: true,
        protocolVersion: 1,
        evidence: buildMainWorkbenchEvidence(snapshot, {
          prompt: query.get('prompt') || '',
          previousButtonId: query.get('previousButtonId') || '',
        }),
      },
    };
  }

  if (method === 'GET' && pathname === '/api/main-workbench/snapshot') {
    return {
      status: 200,
      body: {
        ok: true,
        protocolVersion: 1,
        snapshot: readMainWorkbenchJson(MAIN_WORKBENCH_SNAPSHOT_KEY, null),
      },
    };
  }

  if (method === 'POST' && pathname === '/api/main-workbench/snapshot') {
    const snapshot = body && Object.prototype.hasOwnProperty.call(body, 'snapshot') ? body.snapshot : body;
    if (!snapshot || typeof snapshot !== 'object') {
      return failScript(400, 'invalid-main-workbench-snapshot', 'Snapshot payload must be an object.');
    }
    writeMainWorkbenchJson(MAIN_WORKBENCH_SNAPSHOT_KEY, {
      ...snapshot,
      updatedAt: typeof snapshot.updatedAt === 'number' ? snapshot.updatedAt : Date.now(),
      source: snapshot.source || 'rest',
    });
    return {
      status: 200,
      body: { ok: true, protocolVersion: 1, snapshot: readMainWorkbenchJson(MAIN_WORKBENCH_SNAPSHOT_KEY, null) },
    };
  }

  if (method === 'GET' && pathname === '/api/main-workbench/commands') {
    const status = query.get('status');
    const commands = readMainWorkbenchCommandQueue()
      .filter((entry) => !status || entry.status === status);
    return {
      status: 200,
      body: {
        ok: true,
        protocolVersion: 1,
        commands,
      },
    };
  }

  if (method === 'POST' && pathname === '/api/main-workbench/commands/enqueue') {
    const rawCommands = Array.isArray(body?.commands)
      ? body.commands
      : Array.isArray(body?.command)
        ? body.command
        : body?.command
          ? [body.command]
          : [];
    const commands = rawCommands
      .filter((command) => command && typeof command === 'object' && typeof command.op === 'string')
      .map(normalizeMainWorkbenchCommand);
    if (!commands.length) {
      return failScript(400, 'invalid-main-workbench-command', 'Body must contain command with an op field or commands array.');
    }
    const unsupported = commands
      .map((command) => command.op)
      .filter((op) => !MAIN_WORKBENCH_SUPPORTED_OP_SET.has(op));
    if (unsupported.length) {
      return failScript(
        400,
        'invalid-main-workbench-command-op',
        `Unsupported main workbench command op: ${[...new Set(unsupported)].join(', ')}`,
        { supportedOps: [...MAIN_WORKBENCH_SUPPORTED_OPS] },
      );
    }
    const invalid = commands
      .map((command) => validateMainWorkbenchCommand(command))
      .find((validation) => !validation.ok);
    if (invalid) {
      return failScript(400, invalid.code, invalid.message);
    }
    const queue = readMainWorkbenchCommandQueue();
    const source = typeof body?.source === 'string' ? body.source : 'rest';
    if (commands.length === 1) {
      const id = typeof body?.id === 'string' && body.id.trim() ? body.id : makeMainWorkbenchCommandId();
      const existing = queue.find((entry) => entry.id === id);
      if (existing) {
        return {
          status: 200,
          body: { ok: true, protocolVersion: 1, command: existing, commands: [existing], duplicate: true },
        };
      }
      const entry = normalizeMainWorkbenchCommandEntry({
        id,
        command: commands[0],
        source,
        status: 'pending',
      });
      writeMainWorkbenchCommandQueue([...queue, entry]);
      return {
        status: 200,
        body: { ok: true, protocolVersion: 1, command: entry, commands: [entry] },
      };
    }
    const entries = commands.map((command) => normalizeMainWorkbenchCommandEntry({
      id: makeMainWorkbenchCommandId(),
      command,
      source,
      status: 'pending',
    }));
    writeMainWorkbenchCommandQueue([...queue, ...entries]);
    return {
      status: 200,
      body: { ok: true, protocolVersion: 1, commands: entries },
    };
  }

  if (method === 'POST' && pathname === '/api/main-workbench/commands/result') {
    const id = typeof body?.id === 'string' ? body.id : '';
    if (!id) {
      return failScript(400, 'missing-main-workbench-command-id', 'Result body must include id.');
    }
    const queue = readMainWorkbenchCommandQueue();
    let patched = null;
    const nextQueue = queue.map((entry) => {
      if (entry.id !== id) return entry;
      patched = {
        ...entry,
        status: ['done', 'error', 'running', 'pending'].includes(body.status) ? body.status : entry.status,
        updatedAt: Date.now(),
        ...(Object.prototype.hasOwnProperty.call(body, 'result') ? { result: body.result } : {}),
        ...(typeof body.error === 'string' ? { error: body.error } : {}),
      };
      return patched;
    });
    if (!patched) {
      patched = normalizeMainWorkbenchCommandEntry({
        id,
        command: { op: 'refreshSnapshot' },
        status: ['done', 'error', 'running', 'pending'].includes(body.status) ? body.status : 'done',
        result: body.result,
        error: body.error,
        source: 'browser-result',
      });
      nextQueue.push(patched);
    }
    writeMainWorkbenchCommandQueue(nextQueue);
    appendMainWorkbenchResult(patched);
    return {
      status: 200,
      body: { ok: true, protocolVersion: 1, command: patched },
    };
  }

  return null;
}

async function handleAgentScriptRequest(method, pathname, body) {
  if (method === 'GET' && pathname === '/api/agent/scripts') {
    return {
      status: 200,
      body: {
        ok: true,
        protocolVersion: 1,
        scripts: listAgentScripts(),
        constraints: scriptWorkbenchConstraints(),
      },
    };
  }
  const readMatch = /^\/api\/agent\/scripts\/([^/]+)$/.exec(pathname);
  if (method === 'GET' && readMatch) {
    let decodedName = '';
    try {
      decodedName = decodeURIComponent(readMatch[1]);
    } catch {
      return failScript(400, 'bad-url-encoding', 'Script URL contains malformed percent-encoding.');
    }
    const resolved = resolveAgentScriptPath(decodedName);
    if (!resolved.ok) return resolved.response;
    if (!fs.existsSync(resolved.scriptPath)) {
      return failScript(404, 'script-not-found', `DEF agent script not found: ${resolved.name}`);
    }
    return {
      status: 200,
      body: {
        ok: true,
        protocolVersion: 1,
        script: {
          name: resolved.name,
          content: fs.readFileSync(resolved.scriptPath, 'utf-8'),
        },
        constraints: scriptWorkbenchConstraints(),
      },
    };
  }
  if (method === 'POST' && pathname === '/api/agent/scripts/write') return writeAgentScript(body);
  if (method === 'POST' && pathname === '/api/agent/scripts/delete') return deleteAgentScript(body);
  if (method === 'POST' && pathname === '/api/agent/scripts/run') return runAgentScript(body);
  return null;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) {
    return undefined;
  }
  return JSON.parse(raw);
}

installNodeWindowStorage();

const vite = await createViteServer({
  configFile: path.join(projectRoot, 'vite.config.ts'),
  cacheDir: viteCacheDir,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

vite.moduleGraph?.invalidateAll?.();

async function loadAiCliModules() {
  vite.moduleGraph?.invalidateAll?.();
  const restAdapter = await vite.ssrLoadModule('/src/aiCli/aiCliRestAdapter.ts');
  const buffFillAdapter = await vite.ssrLoadModule('/src/aiCli/buffFillAdapter.ts');
  const infrastructure = await vite.ssrLoadModule('/src/aiCli/aiCliAgentInfrastructure.ts');
  return {
    handleAiCliRestRequest: restAdapter.handleAiCliRestRequest,
    getAiCliRestDiagnostics: restAdapter.getAiCliRestDiagnostics,
    readCurrentBuffDraft: buffFillAdapter.readCurrentBuffDraft,
    readAgentRecordSnapshot: infrastructure.readAgentRecordSnapshot,
  };
}

const { getAiCliRestDiagnostics } = await loadAiCliModules();
const startupDiagnostics = getAiCliRestDiagnostics();

const sseClients = new Set();

function writeSse(response, eventName, payload) {
  try {
    response.write(`event: ${eventName}\n`);
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

function broadcastAgentRecords() {
  loadAiCliModules()
    .then(({ readAgentRecordSnapshot }) => {
      const payload = {
        ok: true,
        protocolVersion: 1,
        ...readAgentRecordSnapshot(),
      };
      for (const client of Array.from(sseClients)) {
        if (!writeSse(client, 'agent.records', payload)) {
          sseClients.delete(client);
        }
      }
    })
    .catch(() => {});
}

function shouldBroadcastAfter(pathname) {
  return pathname !== '/api/agent/events'
    && pathname !== '/api/agent/records'
    && pathname !== '/api/agent/logs'
    && pathname !== '/api/agent/sessions';
}

function broadcastSnapshot(readAgentRecordSnapshot) {
  const payload = {
    ok: true,
    protocolVersion: 1,
    ...readAgentRecordSnapshot(),
  };
  for (const client of sseClients) {
    if (!writeSse(client, 'agent.records', payload)) {
      sseClients.delete(client);
    }
  }
}

const heartbeatTimer = setInterval(() => {
  for (const client of sseClients) {
    if (!writeSse(client, 'heartbeat', { ok: true, now: Date.now() })) {
      sseClients.delete(client);
    }
  }
}, 15000);

const server = http.createServer(async (request, response) => {
  const method = request.method || 'GET';
  const requestUrl = new URL(request.url || '/', `http://${HOST}:${PORT}`);

  if (method === 'OPTIONS') {
    response.writeHead(204, buildJsonHeaders());
    response.end();
    return;
  }

  if (method === 'GET' && requestUrl.pathname === '/health') {
    writeJson(response, 200, {
      ok: true,
      service: 'def-ai-cli-rest',
      host: HOST,
      port: PORT,
      storageDir,
      storageMode: storageMode === 'runtime' ? 'runtime' : 'now-storage',
      nowStoragePath,
      aiTimelineWorkNodesPath,
      pid: process.pid,
      startedAt: serverStartedAt,
      projectRoot,
      viteCacheDir,
      diagnostics: startupDiagnostics,
    });
    return;
  }

  if (method === 'GET' && requestUrl.pathname === '/api/agent/events') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    response.write(': connected\n\n');
    sseClients.add(response);
    const { readAgentRecordSnapshot } = await loadAiCliModules();
    writeSse(response, 'agent.records', { ok: true, protocolVersion: 1, ...readAgentRecordSnapshot() });
    request.on('close', () => {
      sseClients.delete(response);
    });
    return;
  }

  try {
    const body = method === 'POST' ? await readJsonBody(request) : undefined;
    const aiTimelineWorkNodeResponse = handleAiTimelineWorkNodeRequest(method, requestUrl.pathname, body);
    if (aiTimelineWorkNodeResponse) {
      writeJson(response, aiTimelineWorkNodeResponse.status, aiTimelineWorkNodeResponse.body);
      return;
    }

    const mainWorkbenchResponse = handleMainWorkbenchRequest(method, requestUrl.pathname, requestUrl.searchParams, body);
    if (mainWorkbenchResponse) {
      writeJson(response, mainWorkbenchResponse.status, mainWorkbenchResponse.body);
      return;
    }

    const scriptResponse = await handleAgentScriptRequest(method, requestUrl.pathname, body);
    if (scriptResponse) {
      writeJson(response, scriptResponse.status, scriptResponse.body);
      return;
    }

    const { handleAiCliRestRequest, readCurrentBuffDraft, readAgentRecordSnapshot } = await loadAiCliModules();
    const restResponse = handleAiCliRestRequest({
      method,
      path: requestUrl.pathname,
      body,
      client: requestUrl.searchParams.get('client') || (body && typeof body.client === 'string' ? body.client : 'rest'),
      query: Object.fromEntries(requestUrl.searchParams.entries()),
    }, readCurrentBuffDraft(), {
      sourceText: '',
    });
    writeJson(response, restResponse.status, restResponse.body);
    if (shouldBroadcastAfter(requestUrl.pathname)) {
      broadcastSnapshot(readAgentRecordSnapshot);
    }
  } catch (error) {
    writeJson(response, 500, {
      ok: false,
      error: {
        code: 'internal-error',
        message: error instanceof Error ? error.message : String(error),
      },
    });
    if (shouldBroadcastAfter(requestUrl.pathname)) {
      broadcastAgentRecords();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[def-ai-cli-rest] listening on http://${HOST}:${PORT} pid=${process.pid} startedAt=${serverStartedAt} weaponFill=${startupDiagnostics.weaponFill.contractVersion}`);
});

const close = async () => {
  clearInterval(heartbeatTimer);
  for (const client of sseClients) {
    client.end();
  }
  sseClients.clear();
  await new Promise((resolve) => {
    server.close(() => resolve());
  });
  await vite.close();
  if (!process.env.AI_CLI_REST_KEEP_VITE_CACHE) {
    fs.rmSync(viteCacheDir, { recursive: true, force: true });
  }
};

process.once('SIGINT', () => {
  void close().finally(() => process.exit(0));
});

process.once('SIGTERM', () => {
  void close().finally(() => process.exit(0));
});
