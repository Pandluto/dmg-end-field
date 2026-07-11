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
import workNodeStoreModule from '../electron/ai-timeline-work-node-store.cjs';
import timelineRepositoryModule from '../electron/timeline-repository.cjs';

const { createAiTimelineWorkNodeStore } = workNodeStoreModule;
const { createTimelineRepository } = timelineRepositoryModule;

const HOST = '127.0.0.1';
const PORT = Number(process.env.AI_CLI_REST_PORT || 17321);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const storageDir = path.join(projectRoot, '.runtime', 'ai-cli-rest');
const agentScriptDir = path.join(projectRoot, '.runtime', 'def-agent', 'scripts');
const viteCacheDir = process.env.AI_CLI_REST_VITE_CACHE_DIR || path.join(projectRoot, '.runtime', 'vite-ai-cli-rest', String(process.pid));
const nowStoragePath = path.join(projectRoot, 'data', 'localdata', 'now-storage.json');
const aiTimelineWorkNodesPath = process.env.AI_TIMELINE_WORK_NODE_DB_PATH
  || path.join(projectRoot, 'data', 'localdata', 'ai-timeline-worknodes.sqlite3');
const legacyAiTimelineWorkNodesPath = process.env.AI_TIMELINE_WORK_NODE_LEGACY_PATH
  || path.join(projectRoot, 'data', 'localdata', 'ai-timeline-worknodes.json');
const timelineRepositoryPath = process.env.TIMELINE_REPOSITORY_DB_PATH
  || path.join(projectRoot, 'data', 'localdata', 'timeline-repository.sqlite3');
const defToolGovernancePath = path.join(projectRoot, 'data', 'localdata', 'def-tool-governance.json');
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
const EQUIPMENT_LIBRARY_STORAGE_KEY = 'def.equipment-sheet.library.v1';
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
    timelineId: node.timelineId || node.saveId,
    saveId: node.saveId,
    branchId: node.branchId,
    status: node.status,
    diff,
    riskFlags,
    readyToCheckout: checkoutDecision.canAutoApprove || !checkoutDecision.requiresManualApproval,
    checkoutDecision,
  };
}

function formatDefWorkNodeDiffSummary(diff) {
  const summary = diff?.summary || {};
  const parts = [];
  if (summary.addedButtonCount) parts.push(`added ${summary.addedButtonCount} button(s)`);
  if (summary.removedButtonCount) parts.push(`removed ${summary.removedButtonCount} button(s)`);
  if (summary.changedButtonCount) parts.push(`changed ${summary.changedButtonCount} button(s)`);
  if (summary.addedBuffCount) parts.push(`added ${summary.addedBuffCount} buff(s)`);
  if (summary.removedBuffCount) parts.push(`removed ${summary.removedBuffCount} buff(s)`);
  if (diff?.selectedCharactersChanged) parts.push('selected characters changed');
  return parts.length ? parts.join('; ') : 'no diff';
}

function summarizeDefWorkNodeChangedButtons(diff) {
  return [
    ...(Array.isArray(diff?.addedButtons) ? diff.addedButtons.map((button) => ({
      kind: 'added',
      buttonId: button.id,
      label: button.label,
      after: button,
    })) : []),
    ...(Array.isArray(diff?.removedButtons) ? diff.removedButtons.map((button) => ({
      kind: 'removed',
      buttonId: button.id,
      label: button.label,
      before: button,
    })) : []),
    ...(Array.isArray(diff?.changedButtons) ? diff.changedButtons.map((change) => ({
      kind: 'changed',
      buttonId: change.id,
      beforeLabel: change.before?.label,
      afterLabel: change.after?.label,
      changes: change.changes,
    })) : []),
  ];
}

function buildDefWorkNodeButtonTargets(payload) {
  return Object.values(isObject(payload?.skillButtonTable) ? payload.skillButtonTable : {})
    .filter(isObject)
    .map((button) => ({
      buttonId: button.id,
      label: `${button.characterName}-${button.skillDisplayName || button.skillType}@${(button.staffIndex ?? 0) + 1}-${(button.nodeIndex ?? 0) + 1}`,
      characterName: button.characterName,
      skillType: button.skillType,
      skillDisplayName: button.skillDisplayName,
      staffIndex: button.staffIndex ?? 0,
      nodeIndex: button.nodeIndex ?? 0,
    }))
    .sort((left, right) => (
      (left.staffIndex - right.staffIndex)
      || (left.nodeIndex - right.nodeIndex)
      || String(left.label).localeCompare(String(right.label))
    ));
}

let aiTimelineWorkNodeStore;
let timelineRepository;

function getAiTimelineWorkNodeStore() {
  if (!aiTimelineWorkNodeStore) {
    aiTimelineWorkNodeStore = createAiTimelineWorkNodeStore({
      databasePath: aiTimelineWorkNodesPath,
      legacyJsonPath: legacyAiTimelineWorkNodesPath,
    });
  }
  return aiTimelineWorkNodeStore;
}

function getTimelineRepository() {
  if (!timelineRepository) timelineRepository = createTimelineRepository({ databasePath: timelineRepositoryPath });
  return timelineRepository;
}

function mirrorWorkNodeToTimelineRepository(node) {
  if (!node || node.saveId?.startsWith('timeline-snapshot-') || /^\[snapshot\]/i.test(node.label || '')) return;
  const timelineId = node.timelineId || node.saveId || 'current-main-workbench';
  const repository = getTimelineRepository();
  repository.ensureDocument({ id: timelineId, label: '主排轴' });
  // Legacy nodes can predate the repository migration. Importing a new child
  // must first repair any missing ancestry, otherwise SQLite rejects the child
  // foreign key and the two stores diverge again.
  const visiting = new Set();
  const mirrorOne = (candidate) => {
    if (!candidate || visiting.has(candidate.id) || repository.getWorkNode(candidate.id)) return;
    visiting.add(candidate.id);
    if (candidate.parentNodeId) mirrorOne(getAiTimelineWorkNodeStore().getNode(candidate.parentNodeId));
    repository.importWorkNode({ ...candidate, timelineId });
    visiting.delete(candidate.id);
  };
  mirrorOne(node);
}

function readAiTimelineWorkNodeArchive() {
  return getAiTimelineWorkNodeStore().readArchive();
}

// New DEF mutations read payloads from the TimelineRepository. The old store
// remains only as a compatibility projection for the existing Electron IPC.
function readRepositoryWorkNode(nodeId) {
  const node = getTimelineRepository().getWorkNode(nodeId);
  return node ? { ...node, saveId: node.timelineId } : null;
}

function listRepositoryWorkNodes() {
  return getTimelineRepository().listDocuments()
    .flatMap((document) => getTimelineRepository().listWorkNodes(document.id)
      .map((node) => readRepositoryWorkNode(node.id))
      .filter(Boolean));
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

function validateWorkNodePayloadIssues(payload, fieldName) {
  const structuralError = validateWorkNodePayload(payload, fieldName);
  if (structuralError) {
    return [{ code: `invalid-${fieldName}`, message: structuralError, path: fieldName }];
  }
  const issues = [];
  const timelineButtonEntries = (Array.isArray(payload.timelineData?.staffLines) ? payload.timelineData.staffLines : [])
    .flatMap((staffLine) => (Array.isArray(staffLine?.buttons)
      ? staffLine.buttons.map((button) => ({ button, staffIndex: staffLine?.staffIndex }))
      : []));
  const timelineButtonIds = new Set(timelineButtonEntries.map(({ button }) => button?.id).filter(Boolean));
  const tableButtonIds = new Set(Object.keys(isObject(payload.skillButtonTable) ? payload.skillButtonTable : {}));
  for (const buttonId of timelineButtonIds) {
    if (!tableButtonIds.has(buttonId)) {
      issues.push({
        code: 'timeline-button-missing-table-entry',
        message: `Timeline button ${buttonId} is missing from skillButtonTable.`,
        path: `${fieldName}.skillButtonTable.${buttonId}`,
      });
    }
  }
  for (const buttonId of tableButtonIds) {
    if (!timelineButtonIds.has(buttonId)) {
      issues.push({
        code: 'table-button-missing-timeline-entry',
        message: `skillButtonTable button ${buttonId} is missing from timelineData.`,
        path: `${fieldName}.timelineData.${buttonId}`,
      });
    }
  }
  const seenTimelineButtonIds = new Set();
  for (const { button, staffIndex } of timelineButtonEntries) {
    if (!button?.id) continue;
    if (seenTimelineButtonIds.has(button.id)) {
      issues.push({
        code: 'duplicate-timeline-button-entry',
        message: `Timeline button ${button.id} appears in more than one staff line.`,
        path: `${fieldName}.timelineData.staffLines`,
      });
      continue;
    }
    seenTimelineButtonIds.add(button.id);
    const tableButton = payload.skillButtonTable[button.id];
    if (tableButton && tableButton.staffIndex !== staffIndex) {
      issues.push({
        code: 'timeline-button-staff-mismatch',
        message: `Timeline button ${button.id} is on staff ${staffIndex}, but its table entry targets staff ${tableButton.staffIndex}.`,
        path: `${fieldName}.timelineData.staffLines`,
      });
    }
  }
  const buffIds = new Set((Array.isArray(payload.allBuffList) ? payload.allBuffList : []).map((buff) => buff?.id).filter(Boolean));
  for (const [buttonId, button] of Object.entries(isObject(payload.skillButtonTable) ? payload.skillButtonTable : {})) {
    for (const buffId of Array.isArray(button?.selectedBuff) ? button.selectedBuff : []) {
      if (!buffIds.has(buffId)) {
        issues.push({
          code: 'button-selected-buff-missing',
          message: `Button ${buttonId} references missing Buff ${buffId}.`,
          path: `${fieldName}.skillButtonTable.${buttonId}.selectedBuff`,
        });
      }
    }
  }
  return issues;
}

function readDefTimelineSnapshotArchivePayload() {
  const archive = readMainWorkbenchJson('def.timeline.snapshot-archive.v1', null);
  const snapshots = Array.isArray(archive?.snapshots) ? archive.snapshots : [];
  const snapshot = [...snapshots]
    .filter((item) => isObject(item?.payload))
    .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))[0];
  if (!snapshot) return null;
  return {
    payload: cloneJson(snapshot.payload),
    source: 'timeline-snapshot-archive',
    sourceId: snapshot.id || '',
    sourceUpdatedAt: snapshot.createdAt || null,
  };
}

function readDefLatestWorkNodePayload() {
  const archive = readAiTimelineWorkNodeArchive();
  const nodes = [...archive.nodes]
    .filter((node) => isObject(node?.workingPayload) || isObject(node?.basePayload))
    .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
  const preferred = nodes.find((node) => node?.saveId === 'current-main-workbench') || nodes[0];
  if (!preferred) return null;
  return {
    payload: cloneJson(preferred.basePayload || preferred.workingPayload),
    source: 'latest-ai-worknode',
    sourceId: preferred.id || '',
    sourceUpdatedAt: preferred.updatedAt || null,
  };
}

function normalizeMirrorButtonNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function buildDefTimelineButtonFromMirror(button = {}) {
  const nodeIndex = normalizeMirrorButtonNumber(button.nodeIndex, 0);
  const staffIndex = normalizeMirrorButtonNumber(button.staffIndex ?? button.lineIndex, 0);
  return {
    id: String(button.id || button.buttonId || makeId('mirror-button')),
    ...(button.characterId ? { characterId: String(button.characterId) } : {}),
    characterName: String(button.characterName || ''),
    skillType: String(button.skillType || 'A'),
    staffIndex,
    nodeIndex,
    nodeNumber: normalizeMirrorButtonNumber(button.nodeNumber, nodeIndex + 1),
    position: isObject(button.position)
      ? {
        x: normalizeMirrorButtonNumber(button.position.x, 80 + nodeIndex * 22),
        y: normalizeMirrorButtonNumber(button.position.y, 60 + staffIndex * 300),
      }
      : { x: 80 + nodeIndex * 22, y: 60 + staffIndex * 300 },
    ...(button.runtimeSkillId ? { runtimeSkillId: String(button.runtimeSkillId) } : {}),
    ...(button.skillDisplayName ? { skillDisplayName: String(button.skillDisplayName) } : {}),
    ...(button.skillIconUrl ? { skillIconUrl: String(button.skillIconUrl) } : {}),
    ...(Array.isArray(button.customHits) ? { customHits: cloneJson(button.customHits) } : {}),
    buffIds: Array.isArray(button.selectedBuffIds) ? [...button.selectedBuffIds] : [],
  };
}

function buildDefSkillButtonTableEntryFromMirror(button = {}) {
  const timelineButton = buildDefTimelineButtonFromMirror(button);
  const selectedBuff = Array.isArray(button.selectedBuffIds) ? [...button.selectedBuffIds] : [];
  return {
    ...timelineButton,
    selectedBuff,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    panelConfig: { selectedBuff },
  };
}

function buildDefAllBuffListFromMirror(buttons = []) {
  const buffMap = new Map();
  for (const button of buttons) {
    for (const buff of Array.isArray(button?.selectedBuffs) ? button.selectedBuffs : []) {
      if (!buff?.id) continue;
      const existing = buffMap.get(buff.id);
      buffMap.set(buff.id, {
        ...cloneJson(buff),
        refCount: normalizeMirrorButtonNumber(existing?.refCount, 0) + 1,
      });
    }
  }
  return [...buffMap.values()];
}

function readDefMainWorkbenchMirrorPayload() {
  const snapshot = readMainWorkbenchSnapshotMirror();
  const selectedCharacters = Array.isArray(snapshot?.selectedCharacters) ? snapshot.selectedCharacters : [];
  if (selectedCharacters.length === 0) return null;

  const selectedCharacterIds = selectedCharacters
    .map((character) => String(character?.id || character?.name || '').trim())
    .filter(Boolean)
    .slice(0, 4);
  if (selectedCharacterIds.length === 0) return null;

  const buttons = Array.isArray(snapshot?.skillButtons) ? snapshot.skillButtons : [];
  const staffLines = selectedCharacters.slice(0, 4).map((character, index) => {
    const lineButtons = buttons
      .filter((button) => normalizeMirrorButtonNumber(button?.staffIndex ?? button?.lineIndex, index) === index)
      .map(buildDefTimelineButtonFromMirror)
      .sort((left, right) => left.nodeIndex - right.nodeIndex);
    return {
      staffIndex: index,
      characterName: String(character?.name || character?.id || `干员${index + 1}`),
      occupiedNodes: lineButtons.map((button) => button.nodeIndex).sort((left, right) => left - right),
      buttons: lineButtons,
    };
  });
  const skillButtonTable = Object.fromEntries(
    buttons.map((button) => {
      const entry = buildDefSkillButtonTableEntryFromMirror(button);
      return [entry.id, entry];
    }),
  );
  const payload = {
    selectedCharacters: selectedCharacterIds,
    timelineData: {
      version: '1.0.0',
      createdAt: Number(snapshot?.updatedAt) || Date.now(),
      updatedAt: Number(snapshot?.updatedAt) || Date.now(),
      staffLines,
    },
    skillButtonTable,
    allBuffList: buildDefAllBuffListFromMirror(buttons),
    anomalyStateSnapshots: [],
    characterInputMap: {},
    characterComputedMap: {},
    characterDisplayCacheMap: {},
    operatorConfigPageCache: {},
  };
  if (validateWorkNodePayload(payload, 'basePayload') !== null) return null;
  return {
    payload,
    source: 'main-workbench-snapshot-mirror',
    sourceId: 'current-mirror',
    sourceUpdatedAt: snapshot?.updatedAt || null,
  };
}

function readDefCurrentTimelinePayloadSource() {
  const payloadFromMirror = readDefMainWorkbenchMirrorPayload();
  if (payloadFromMirror) return payloadFromMirror;

  const characterInputRaw = readMainWorkbenchJson('def.operator-config.character-input-map.v3', {});
  const characterComputedRaw = readMainWorkbenchJson('def.operator-runtime.character-computed-map.v3', {});
  const characterDisplayRaw = readMainWorkbenchJson('def.operator-ui.character-display-cache.v3', {});
  const payloadFromStorage = {
    selectedCharacters: readMainWorkbenchJson('def.selected-characters.v1', []),
    timelineData: readMainWorkbenchJson('def.timeline.data.v1', null),
    skillButtonTable: readMainWorkbenchJson('def.skill-button.v1', {}),
    allBuffList: readMainWorkbenchJson('def.all-buff-list.v1', []),
    anomalyStateSnapshots: readMainWorkbenchJson('def.anomaly-state-snapshot-archive.v1', { snapshots: [] })?.snapshots || [],
    characterInputMap: characterInputRaw?.items || characterInputRaw,
    characterComputedMap: characterComputedRaw?.items || characterComputedRaw,
    characterDisplayCacheMap: characterDisplayRaw?.items || characterDisplayRaw,
    operatorConfigPageCache: readMainWorkbenchJson('def.operator-config.page-cache.v1', {}),
  };
  if (validateWorkNodePayload(payloadFromStorage, 'basePayload') === null) {
    return {
      payload: payloadFromStorage,
      source: 'local-storage-current',
      sourceId: 'now-storage',
      sourceUpdatedAt: Date.now(),
    };
  }
  return readDefLatestWorkNodePayload() || readDefTimelineSnapshotArchivePayload();
}

function createDefWorkNodeFromPayload(payloadSource, input = {}) {
  if (!payloadSource || !isObject(payloadSource.payload)) {
    return {
      ok: false,
      code: 'current-payload-unavailable',
      message: 'No usable current timeline payload source is available for server-side work node creation.',
    };
  }
  const payloadError = validateWorkNodePayload(payloadSource.payload, 'basePayload');
  if (payloadError) {
    return {
      ok: false,
      code: 'invalid-current-payload',
      message: payloadError,
      source: payloadSource.source,
      sourceId: payloadSource.sourceId,
    };
  }
  const now = Date.now();
  const timelineId = typeof input.timelineId === 'string' && input.timelineId.trim()
    ? sanitizeWorkNodeId(input.timelineId, 'timeline')
    : typeof input.saveId === 'string' && input.saveId.trim()
      ? sanitizeWorkNodeId(input.saveId, 'timeline')
    : 'current-main-workbench';
  const saveId = timelineId;
  const store = getAiTimelineWorkNodeStore();
  const hasParentNodeInput = Object.prototype.hasOwnProperty.call(input, 'parentNodeId');
  const requestedParentNodeId = typeof input.parentNodeId === 'string' && input.parentNodeId.trim()
    ? sanitizeWorkNodeId(input.parentNodeId, 'ai-timeline-node')
    : undefined;
  const parentNodeId = hasParentNodeInput ? requestedParentNodeId : store.getHead(saveId)?.nodeId;
  const node = {
    id: sanitizeWorkNodeId(input.id, 'ai-timeline-node'),
    ...(parentNodeId ? { parentNodeId } : {}),
    saveId,
    timelineId,
    branchId: sanitizeWorkNodeId(input.branchId, `main-workbench-${now}`),
    createdAt: now,
    updatedAt: now,
    label: typeof input.label === 'string' && input.label.trim()
      ? input.label.trim()
      : `Main Workbench ${new Date(now).toLocaleString()}`,
    status: 'open',
    basePayload: cloneJson(payloadSource.payload),
    workingPayload: cloneJson(payloadSource.payload),
    baseSummary: summarizeTimelinePayload(payloadSource.payload),
    workingSummary: summarizeTimelinePayload(payloadSource.payload),
    approvalPolicy: ['auto-low-risk', 'ask-on-risk', 'manual'].includes(input.approvalPolicy) ? input.approvalPolicy : 'auto-low-risk',
    riskFlags: normalizeRiskFlags(input.riskFlags),
    logs: [makeWorkNodeLog('info', 'Created AI timeline work node from server-side payload source.', {
      source: payloadSource.source,
      sourceId: payloadSource.sourceId,
    })],
  };
  // Creating a draft is deliberately not a checkout operation.  HEAD is only
  // advanced after the renderer has applied a validated work node.
  store.saveNode(node);
  mirrorWorkNodeToTimelineRepository(node);
  return {
    ok: true,
    node,
    path: aiTimelineWorkNodesPath,
    source: payloadSource.source,
    sourceId: payloadSource.sourceId,
    sourceUpdatedAt: payloadSource.sourceUpdatedAt,
    buttonTargets: buildDefWorkNodeButtonTargets(payloadSource.payload),
  };
}

function toAiTimelineWorkNodeListItem(node) {
  if (!isObject(node)) return node;
  const { basePayload, workingPayload, ...item } = node;
  return item;
}

function toAiTimelineWorkNodeCommitListItem(commit) {
  if (!isObject(commit)) return commit;
  const { basePayload, appliedPayload, ...item } = commit;
  return item;
}

function handleAiTimelineWorkNodeRequest(method, pathname, body) {
  if (method === 'GET' && pathname === '/api/ai-timeline-worknodes') {
    const archive = getAiTimelineWorkNodeStore().list();
    return {
      status: 200,
      body: {
        ok: true,
        protocolVersion: 1,
        path: aiTimelineWorkNodesPath,
        nodes: archive.nodes
          .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
          .map(toAiTimelineWorkNodeListItem),
        commits: archive.commits
          .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))
          .map(toAiTimelineWorkNodeCommitListItem),
        heads: archive.heads,
        headNodeId: archive.headNodeId,
        revision: archive.revision,
      },
    };
  }
  if (method === 'POST' && pathname === '/api/ai-timeline-worknodes/create') {
    const rawTimelineId = typeof body?.timelineId === 'string' && body.timelineId.trim()
      ? body.timelineId
      : body?.saveId;
    const saveId = sanitizeWorkNodeId(rawTimelineId, 'timeline');
    if (!rawTimelineId || typeof rawTimelineId !== 'string') {
      return failScript(400, 'missing-ai-worknode-timeline-id', 'AI work node create requires timelineId.');
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
    const store = getAiTimelineWorkNodeStore();
    const hasParentNodeInput = Object.prototype.hasOwnProperty.call(body || {}, 'parentNodeId');
    const requestedParentNodeId = typeof body?.parentNodeId === 'string' && body.parentNodeId.trim()
      ? sanitizeWorkNodeId(body.parentNodeId, 'ai-timeline-node')
      : undefined;
    const parentNodeId = hasParentNodeInput ? requestedParentNodeId : store.getHead(saveId)?.nodeId;
    const node = {
      id: sanitizeWorkNodeId(body?.id, 'ai-timeline-node'),
      ...(parentNodeId ? { parentNodeId } : {}),
      saveId,
      timelineId: saveId,
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
    store.saveNode(node);
    mirrorWorkNodeToTimelineRepository(node);
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
  const store = getAiTimelineWorkNodeStore();
  const node = store.getNode(nodeId);
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
    const hasParentNodePatch = Object.prototype.hasOwnProperty.call(body || {}, 'parentNodeId');
    const parentNodeId = hasParentNodePatch && typeof body.parentNodeId === 'string' && body.parentNodeId.trim()
      ? sanitizeWorkNodeId(body.parentNodeId, 'ai-timeline-node')
      : undefined;
    const nextNode = {
      ...node,
      ...(hasParentNodePatch ? (parentNodeId ? { parentNodeId } : { parentNodeId: undefined }) : {}),
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
    store.saveNode(nextNode);
    mirrorWorkNodeToTimelineRepository(nextNode);
    return { status: 200, body: { ok: true, protocolVersion: 1, path: aiTimelineWorkNodesPath, node: nextNode } };
  }

  if (method === 'POST' && action === 'delete') {
    try {
      // The legacy store is retained only for runtime compatibility during the
      // migration. Validate both projections before changing either one, then
      // remove both so a later compatibility update cannot resurrect this node.
      const repository = getTimelineRepository();
      store.assertSubtreeDeletable(nodeId);
      if (repository.getWorkNode(nodeId)) repository.assertWorkNodeSubtreeDeletable(nodeId);
      if (repository.getWorkNode(nodeId)) repository.deleteWorkNodeSubtree(nodeId);
      store.deleteSubtree(nodeId);
    } catch (error) {
      if (error?.code === 'ai-worknode-current-checkout-protected') {
        return failScript(409, error.code, error.message, { nodeId });
      }
      throw error;
    }
    const list = store.list();
    return {
      status: 200,
      body: {
        ok: true,
        protocolVersion: 1,
        path: aiTimelineWorkNodesPath,
        nodes: list.nodes,
        commits: list.commits,
        heads: list.heads,
        headNodeId: list.headNodeId,
        revision: list.revision,
      },
    };
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
      timelineId: node.timelineId || node.saveId,
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
    store.saveNodeAndCommit(nextNode, commit);
    mirrorWorkNodeToTimelineRepository(nextNode);
    return { status: 200, body: { ok: true, protocolVersion: 1, path: aiTimelineWorkNodesPath, node: nextNode, commit } };
  }

  if (method === 'POST' && action === 'checkout-applied') {
    const commitId = typeof body?.commitId === 'string' && body.commitId.trim() ? body.commitId.trim() : '';
    const targetCommit = commitId ? store.getCommit(commitId) : store.getLatestCommitForNode(node.id);
    if (!targetCommit || targetCommit.nodeId !== node.id) {
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
    store.saveNodeAndCommit(nextNode, nextCommit, { setHead: true });
    mirrorWorkNodeToTimelineRepository(nextNode);
    getTimelineRepository().setCheckoutRef({
      timelineId: nextNode.timelineId || nextNode.saveId || 'current-main-workbench',
      targetType: 'work-node',
      targetId: nextNode.id,
      updatedAt: appliedAt,
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
    // A restore is an operation on the existing node, not a synthetic child
    // branch.  Synthetic "[restore]" nodes used to corrupt the visual tree and
    // made parent/child lineage lie about what actually happened.
    const nextNode = {
      ...node,
      status: 'ready',
      updatedAt: appliedAt,
      logs: [makeWorkNodeLog('info', 'Restored current checkout from work node basePayload.', {
        ...rollback,
        sourceNodeId: node.id,
      }), ...(Array.isArray(node.logs) ? node.logs : [])],
    };
    store.saveNode(nextNode);
    mirrorWorkNodeToTimelineRepository(nextNode);
    getTimelineRepository().appendAuditEvent({
      id: `work-node-base-restored-${node.id}-${appliedAt}`,
      timelineId: nextNode.timelineId || nextNode.saveId || 'current-main-workbench',
      eventType: 'work-node.base-restored',
      subjectType: 'work-node',
      subjectId: node.id,
      details: rollback,
      createdAt: appliedAt,
    });
    return { status: 200, body: { ok: true, protocolVersion: 1, path: aiTimelineWorkNodesPath, node: nextNode, rollback } };
  }

  return null;
}

function handleTimelineRepositoryRequest(method, pathname, query, body) {
  const repository = getTimelineRepository();
  if (method === 'GET' && pathname === '/api/timeline-documents') {
    return { status: 200, body: { ok: true, protocolVersion: 1, documents: repository.listDocuments() } };
  }
  if (method === 'POST' && pathname === '/api/timeline-documents') {
    return { status: 200, body: { ok: true, protocolVersion: 1, document: repository.ensureDocument(body) } };
  }
  if (method === 'POST' && pathname === '/api/timeline-bundles/import') {
    try {
      return { status: 200, body: { ok: true, protocolVersion: 1, ...repository.importDocumentBundle(body) } };
    } catch (error) {
      if (error?.status === 409) return failScript(409, error.code, error.message);
      if (error?.status === 400 || error?.code?.includes('timeline-bundle')) return failScript(400, error.code, error.message);
      throw error;
    }
  }
  if (method === 'GET' && pathname === '/api/timeline-bundles/export') {
    const timelineId = query.get('timelineId') || '';
    if (!timelineId) return failScript(400, 'missing-timeline-id', 'Timeline bundle export requires timelineId.');
    try {
      return { status: 200, body: { ok: true, protocolVersion: 1, ...repository.exportDocumentBundle(timelineId) } };
    } catch (error) {
      if (error?.status === 404) return failScript(404, error.code, error.message);
      throw error;
    }
  }
  if (method === 'GET' && pathname === '/api/timeline-snapshots') {
    const timelineId = query.get('timelineId') || '';
    if (!timelineId) return failScript(400, 'missing-timeline-id', 'Timeline snapshot list requires timelineId.');
    return { status: 200, body: { ok: true, protocolVersion: 1, snapshots: repository.listSnapshots(timelineId) } };
  }
  if (method === 'GET' && pathname === '/api/timeline-work-nodes') {
    const timelineId = query.get('timelineId') || '';
    if (!timelineId) return failScript(400, 'missing-timeline-id', 'Timeline work node list requires timelineId.');
    return { status: 200, body: { ok: true, protocolVersion: 1, nodes: repository.listWorkNodes(timelineId) } };
  }
  if (method === 'GET' && pathname === '/api/timeline-audit-events') {
    const timelineId = query.get('timelineId') || '';
    if (!timelineId) return failScript(400, 'missing-timeline-id', 'Timeline audit list requires timelineId.');
    return { status: 200, body: { ok: true, protocolVersion: 1, events: repository.listAuditEvents(timelineId, query.get('limit')) } };
  }
  const workNodePatchMatch = /^\/api\/timeline-work-nodes\/([^/]+)\/patches$/.exec(pathname);
  if (method === 'GET' && workNodePatchMatch) {
    return {
      status: 200,
      body: { ok: true, protocolVersion: 1, patches: repository.listWorkNodePatches(decodeURIComponent(workNodePatchMatch[1]), query.get('limit')) },
    };
  }
  const workNodeDeleteMatch = /^\/api\/timeline-work-nodes\/([^/]+)\/delete$/.exec(pathname);
  if (method === 'POST' && workNodeDeleteMatch) {
    try {
      const nodeId = decodeURIComponent(workNodeDeleteMatch[1]);
      const legacyStore = getAiTimelineWorkNodeStore();
      // During migration both stores can still contain the same node.  Validate
      // both before either write, then remove both projections so an old update
      // cannot mirror a deleted node back into the Repository.
      if (legacyStore.getNode(nodeId)) legacyStore.assertSubtreeDeletable(nodeId);
      repository.assertWorkNodeSubtreeDeletable(nodeId);
      const result = repository.deleteWorkNodeSubtree(nodeId);
      if (legacyStore.getNode(nodeId)) legacyStore.deleteSubtree(nodeId);
      return { status: 200, body: { ok: true, result } };
    } catch (error) {
      if (error?.status === 409 || error?.status === 404) return failScript(error.status, error.code, error.message);
      throw error;
    }
  }
  if (method === 'POST' && pathname === '/api/timeline-snapshots') {
    return { status: 200, body: { ok: true, protocolVersion: 1, ...repository.createOrReuseSnapshot(body) } };
  }
  const snapshotDeleteMatch = /^\/api\/timeline-snapshots\/([^/]+)\/archive$/.exec(pathname);
  if (method === 'POST' && snapshotDeleteMatch) {
    try {
      return { status: 200, body: { ok: true, protocolVersion: 1, result: repository.archiveSnapshot(decodeURIComponent(snapshotDeleteMatch[1])) } };
    } catch (error) {
      if (error?.status === 409) return failScript(409, error.code, error.message);
      throw error;
    }
  }
  if (method === 'GET' && pathname === '/api/timeline-checkout-ref') {
    const timelineId = query.get('timelineId') || '';
    if (!timelineId) return failScript(400, 'missing-timeline-id', 'Timeline checkout ref requires timelineId.');
    return { status: 200, body: { ok: true, protocolVersion: 1, checkoutRef: repository.getCheckoutRef(timelineId) } };
  }
  if (method === 'POST' && pathname === '/api/timeline-checkout-ref') {
    return { status: 200, body: { ok: true, protocolVersion: 1, checkoutRef: repository.setCheckoutRef(body) } };
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

function makeMainWorkbenchBatchId() {
  return `mw-batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeMainWorkbenchBatchId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
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
    ...(normalizeMainWorkbenchBatchId(entry.batchId) ? { batchId: normalizeMainWorkbenchBatchId(entry.batchId) } : {}),
    ...(typeof entry.batchIndex === 'number' ? { batchIndex: entry.batchIndex } : {}),
    ...(typeof entry.batchSize === 'number' ? { batchSize: entry.batchSize } : {}),
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

function buildMainWorkbenchCommandBatchSummary(commands, batchId = '') {
  const items = normalizeMainWorkbenchBatchId(batchId)
    ? commands.filter((entry) => entry.batchId === batchId)
    : commands.filter((entry) => entry.batchId);
  const statusCounts = items.reduce((counts, entry) => ({
    ...counts,
    [entry.status]: (counts[entry.status] || 0) + 1,
  }), {});
  const failedCommand = items.find((entry) => entry.status === 'error') || null;
  return {
    batchId: normalizeMainWorkbenchBatchId(batchId) || null,
    total: items.length,
    pending: statusCounts.pending || 0,
    running: statusCounts.running || 0,
    done: statusCounts.done || 0,
    error: statusCounts.error || 0,
    failedCommand,
    remainingCommands: items.filter((entry) => entry.status === 'pending' || entry.status === 'running'),
    commands: items,
  };
}

function normalizeDefToolText(value) {
  return String(value || '')
    .replace(/燃尽/g, '燃烬')
    .replace(/[「」"'\s_\-·・.]/g, '')
    .toLowerCase();
}

function parseDefOrdinalText(text) {
  const normalized = normalizeDefToolText(text);
  const digitMatch = /第?(\d+)(?:个|次|号)?/.exec(normalized);
  if (digitMatch) {
    const value = Number(digitMatch[1]);
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  const chineseDigits = [
    ['一', 1],
    ['二', 2],
    ['两', 2],
    ['三', 3],
    ['四', 4],
    ['五', 5],
    ['六', 6],
    ['七', 7],
    ['八', 8],
    ['九', 9],
    ['十', 10],
  ];
  for (const [label, value] of chineseDigits) {
    if (normalized.includes(`第${label}`) || normalized.includes(`${label}个`) || normalized.includes(`${label}号`)) {
      return value;
    }
  }
  return null;
}

function inferDefSkillTypeFromText(text) {
  const normalized = normalizeDefToolText(text);
  const raw = String(text || '');
  if (/(^|[^a-z])a([^a-z]|$)/i.test(raw) || normalized.includes('普攻') || normalized.includes('普通攻击')) return 'A';
  if (/(^|[^a-z])e([^a-z]|$)/i.test(raw) || normalized.includes('战技')) return 'E';
  if (/(^|[^a-z])q([^a-z]|$)/i.test(raw) || normalized.includes('终结') || normalized.includes('大招')) return 'Q';
  if (/(^|[^a-z])b([^a-z]|$)/i.test(raw) || normalized.includes('连携')) return 'B';
  if (normalized.includes('dot') || normalized.includes('持续')) return 'Dot';
  return '';
}

function parseDefButtonNaturalQuery(text) {
  const normalized = normalizeDefToolText(text);
  const ordinal = parseDefOrdinalText(text);
  const skillType = inferDefSkillTypeFromText(text);
  const staffIndex = /第?一(?:个)?干员|当前第?一|第?1(?:个)?干员/.test(normalized)
    ? 0
    : /第?二(?:个)?干员|第?2(?:个)?干员/.test(normalized)
      ? 1
      : null;
  const hasStructuredIntent = Boolean(ordinal || skillType || staffIndex !== null);
  return { ordinal, skillType, staffIndex, hasStructuredIntent };
}

function formatDefButtonLabel(button) {
  return `${button?.characterName || '未知'}-${button?.skillDisplayName || button?.skillType || '技能'}@${(button?.staffIndex || 0) + 1}-${(button?.nodeIndex ?? 0) + 1}`;
}

function compactDefButton(button) {
  const buffs = Array.isArray(button?.selectedBuffs)
    ? button.selectedBuffs.map((buff) => ({
      id: buff?.id || '',
      name: buff?.name || '',
      displayName: buff?.displayName || '',
      sourceName: buff?.sourceName || '',
      level: buff?.level || '',
      type: buff?.type || '',
      value: typeof buff?.value === 'number' ? buff.value : undefined,
      description: buff?.description || '',
      source: buff?.source || '',
      condition: buff?.condition || '',
      category: buff?.category || '',
      effectKind: buff?.effectKind || '',
    }))
    : [];
  return {
    id: button?.id || '',
    buttonId: button?.id || '',
    label: formatDefButtonLabel(button),
    characterId: button?.characterId || '',
    characterName: button?.characterName || '',
    skillType: button?.skillType || '',
    skillDisplayName: button?.skillDisplayName || button?.skillType || '',
    staffIndex: typeof button?.staffIndex === 'number' ? button.staffIndex : 0,
    lineIndex: typeof button?.lineIndex === 'number' ? button.lineIndex : 0,
    nodeIndex: typeof button?.nodeIndex === 'number' ? button.nodeIndex : undefined,
    nodeNumber: typeof button?.nodeNumber === 'number' ? button.nodeNumber : (
      typeof button?.nodeIndex === 'number' ? button.nodeIndex + 1 : undefined
    ),
    selectedBuffIds: Array.isArray(button?.selectedBuffIds) ? button.selectedBuffIds : [],
    selectedBuffs: buffs,
    buffCount: buffs.length || (Array.isArray(button?.selectedBuffIds) ? button.selectedBuffIds.length : 0),
  };
}

function readMainWorkbenchSnapshotMirror() {
  return readMainWorkbenchJson(MAIN_WORKBENCH_SNAPSHOT_KEY, null);
}

function readDefEquipmentLibrary() {
  const library = readMainWorkbenchJson(EQUIPMENT_LIBRARY_STORAGE_KEY, null);
  if (library && typeof library === 'object') return library;
  try {
    const payload = JSON.parse(fs.readFileSync(nowStoragePath, 'utf-8'));
    const storedLibrary = payload?.storage?.local?.[EQUIPMENT_LIBRARY_STORAGE_KEY];
    return storedLibrary && typeof storedLibrary === 'object' ? storedLibrary : { gearSets: {} };
  } catch {
    return { gearSets: {} };
  }
}

function normalizeDefToolPercent(value, unit = '') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value ?? null;
  if (unit === 'percent' || Math.abs(value) <= 1) {
    return `${Number((value * 100).toFixed(2))}%`;
  }
  return value;
}

function compactDefGearSetBuff(buff = {}, gearSet = {}) {
  return {
    id: String(buff.effectId || ''),
    name: String(buff.name || buff.label || buff.effectId || ''),
    typeKey: String(buff.typeKey || ''),
    category: String(buff.category || ''),
    effectKind: String(buff.effectKind || 'modifier'),
    value: normalizeDefToolPercent(buff.value, buff.unit),
    rawValue: typeof buff.value === 'number' ? buff.value : undefined,
    unit: String(buff.unit || ''),
    sourceName: String(gearSet.name || ''),
    gearSetId: String(gearSet.gearSetId || ''),
  };
}

function compactDefEquipmentItem(equipment = {}) {
  const effects = Object.values(equipment.effects || {})
    .filter((effect) => effect && typeof effect === 'object')
    .map((effect) => ({
      label: String(effect.label || effect.effectId || ''),
      typeKey: String(effect.typeKey || ''),
    }));
  return {
    id: String(equipment.equipmentId || ''),
    name: String(equipment.name || ''),
    part: String(equipment.part || ''),
    effectLabels: effects.slice(0, 4).map((effect) => effect.label).filter(Boolean),
  };
}

function compactDefGearSet(gearSet = {}) {
  const equipments = Object.values(gearSet.equipments || {})
    .filter((equipment) => equipment && typeof equipment === 'object')
    .map(compactDefEquipmentItem);
  const threePieceBuffs = [
    ...(gearSet.threePieceBuff ? [gearSet.threePieceBuff] : []),
    ...Object.values(gearSet.threePieceBuffs || {}),
  ]
    .filter((buff) => buff && typeof buff === 'object')
    .map((buff) => compactDefGearSetBuff(buff, gearSet));
  return {
    gearSetId: String(gearSet.gearSetId || ''),
    name: String(gearSet.name || ''),
    equipmentCount: equipments.length,
    parts: [...new Set(equipments.map((equipment) => equipment.part).filter(Boolean))],
    equipments: equipments.slice(0, 8),
    threePieceBuffs,
    summary: threePieceBuffs.length
      ? `${gearSet.name || gearSet.gearSetId} 是装备套装；三件套效果：${threePieceBuffs.map((buff) => `${buff.name || buff.typeKey}${buff.value !== null && buff.value !== undefined ? ` ${buff.value}` : ''}`).join('、')}。`
      : `${gearSet.name || gearSet.gearSetId} 是装备套装；未配置三件套效果。`,
  };
}

function listDefWorkbenchButtons(input = {}) {
  const snapshot = readMainWorkbenchSnapshotMirror();
  let buttons = Array.isArray(snapshot?.skillButtons) ? snapshot.skillButtons.map(compactDefButton) : [];
  const rawQuery = input.query || input.text || '';
  const parsedQuery = parseDefButtonNaturalQuery(rawQuery);
  const buttonId = typeof input.buttonId === 'string' && input.buttonId.trim() ? input.buttonId.trim() : '';
  const characterName = normalizeDefToolText(input.characterName || input.character || '');
  const skillType = normalizeDefToolText(input.skillType || parsedQuery.skillType || '');
  const skillName = normalizeDefToolText(input.skillName || input.skillDisplayName || '');
  const query = parsedQuery.hasStructuredIntent ? '' : normalizeDefToolText(rawQuery);
  const staffIndex = Number.isInteger(input.staffIndex) ? input.staffIndex : parsedQuery.staffIndex;
  const nodeIndex = Number.isInteger(input.nodeIndex) ? input.nodeIndex : null;
  const ordinal = Number.isInteger(input.ordinal) && input.ordinal > 0 ? input.ordinal : parsedQuery.ordinal;
  if (buttonId) {
    buttons = buttons.filter((button) => button.buttonId === buttonId);
  }
  if (characterName) {
    buttons = buttons.filter((button) => normalizeDefToolText(button.characterName).includes(characterName));
  }
  if (skillType) {
    buttons = buttons.filter((button) => normalizeDefToolText(button.skillType) === skillType);
  }
  if (skillName) {
    buttons = buttons.filter((button) => normalizeDefToolText(button.skillDisplayName).includes(skillName));
  }
  if (query) {
    buttons = buttons.filter((button) => {
      const haystack = normalizeDefToolText([
        button.label,
        button.characterName,
        button.skillType,
        button.skillDisplayName,
        ...button.selectedBuffs.flatMap((buff) => [buff.name, buff.displayName, buff.sourceName]),
      ].join(' '));
      return haystack.includes(query);
    });
  }
  if (staffIndex !== null) {
    buttons = buttons.filter((button) => button.staffIndex === staffIndex);
  }
  if (nodeIndex !== null) {
    buttons = buttons.filter((button) => button.nodeIndex === nodeIndex);
  }
  buttons = buttons.sort((left, right) => (
    (left.staffIndex - right.staffIndex) ||
    (left.lineIndex - right.lineIndex) ||
    ((left.nodeIndex ?? 0) - (right.nodeIndex ?? 0)) ||
    left.label.localeCompare(right.label)
  ));
  if (ordinal !== null) {
    buttons = buttons[ordinal - 1] ? [buttons[ordinal - 1]] : [];
  }
  const limit = Number(input.limit || 80) || 80;
  return {
    snapshotUpdatedAt: snapshot?.updatedAt || null,
    count: buttons.length,
    buttons: buttons.slice(0, Math.max(1, Math.min(limit, 200))),
    ambiguity: buttons.length !== 1,
    suggestedQuestion: buttons.length > 1 ? '找到多个按钮候选。请指定 buttonId、位置或第几个。' : '',
  };
}

function listDefWorkbenchCharacters() {
  const snapshot = readMainWorkbenchSnapshotMirror();
  const selectedCharacters = Array.isArray(snapshot?.selectedCharacters) ? snapshot.selectedCharacters : [];
  const operatorConfigs = Array.isArray(snapshot?.operatorConfigs) ? snapshot.operatorConfigs : [];
  return {
    snapshotUpdatedAt: snapshot?.updatedAt || null,
    count: selectedCharacters.length,
    characters: selectedCharacters.map((character, index) => {
      const config = operatorConfigs.find((item) => item?.characterId === character?.id || item?.characterName === character?.name);
      return {
        index,
        id: character?.id || '',
        name: character?.name || '',
        element: character?.element || '',
        profession: character?.profession || '',
        weapon: config?.weapon ? {
          id: config.weapon.id || '',
          name: config.weapon.name || '',
          level: config.weapon.level,
          potential: config.weapon.potential,
        } : null,
        equipmentCount: Array.isArray(config?.equipment) ? config.equipment.length : 0,
      };
    }),
  };
}

function resolveDefCharacters(input = {}) {
  const rawQuery = input.query || input.name || input.text || '';
  const normalizedQuery = normalizeDefToolText(rawQuery);
  const parsedOrdinal = parseDefOrdinalText(rawQuery);
  const ordinal = Number.isInteger(input.ordinal) && input.ordinal > 0 ? input.ordinal : parsedOrdinal;
  const ordinalCharacterQuery = Boolean(ordinal && (
    Number.isInteger(input.ordinal) ||
    /干员|角色|operator|character/i.test(String(rawQuery || ''))
  ));
  const query = ordinalCharacterQuery ? '' : normalizedQuery;
  const data = listDefWorkbenchCharacters();
  let candidates = data.characters
    .filter((character) => !query || normalizeDefToolText(`${character.name} ${character.id}`).includes(query))
    .map((character) => ({ ...character, confidence: normalizeDefToolText(character.name) === normalizedQuery ? 1 : 0.75 }));
  if (ordinal && candidates.length >= ordinal) {
    candidates = [{ ...candidates[ordinal - 1], confidence: Math.max(candidates[ordinal - 1].confidence || 0, 0.9) }];
  }
  return {
    query,
    candidates,
    ambiguity: candidates.length !== 1,
    suggestedQuestion: candidates.length === 0
      ? '没有找到匹配干员。请提供干员名称或当前位置。'
      : candidates.length > 1
        ? '找到多个干员候选。请指定干员名称或第几个。'
        : '',
  };
}

function resolveDefSkills(input = {}) {
  const rawQuery = input.query || input.skillName || input.text || '';
  const query = normalizeDefToolText(rawQuery);
  const requestedSkillType = normalizeDefToolText(input.skillType || inferDefSkillTypeFromText(rawQuery));
  const requestedCharacter = normalizeDefToolText(input.characterName || input.character || '');
  const buttons = listDefWorkbenchButtons({ limit: 200 }).buttons;
  const bySkill = new Map();
  for (const button of buttons) {
    const key = `${button.characterName}:${button.skillType}:${button.skillDisplayName}`;
    if (!bySkill.has(key)) {
      bySkill.set(key, {
        characterName: button.characterName,
        skillType: button.skillType,
        skillDisplayName: button.skillDisplayName,
        buttonCount: 0,
        exampleButtonId: button.buttonId,
      });
    }
    bySkill.get(key).buttonCount += 1;
  }
  const candidates = [...bySkill.values()]
    .filter((skill) => !requestedSkillType || normalizeDefToolText(skill.skillType) === requestedSkillType)
    .filter((skill) => !requestedCharacter || normalizeDefToolText(skill.characterName).includes(requestedCharacter))
    .filter((skill) => !query || requestedSkillType || normalizeDefToolText(`${skill.characterName} ${skill.skillType} ${skill.skillDisplayName}`).includes(query))
    .map((skill) => ({ ...skill, confidence: normalizeDefToolText(skill.skillDisplayName) === query || normalizeDefToolText(skill.skillType) === requestedSkillType ? 1 : 0.7 }));
  return {
    query,
    candidates,
    ambiguity: candidates.length !== 1,
    suggestedQuestion: candidates.length > 1 ? '找到多个技能候选。请指定干员或技能类型。' : '',
  };
}

function buildDefResolvedBuffObject(source = {}) {
  const effectKind = source.effectKind === 'extraHit' ? 'extraHit' : 'modifier';
  const type = effectKind === 'extraHit' ? '' : String(source.type || source.typeKey || '');
  const displayName = String(source.displayName || source.name || source.label || source.effectId || '未命名 Buff');
  const sourceName = String(source.sourceName || source.gearSetName || source.equipmentName || source.characterName || '');
  const idParts = [
    source.id || source.effectId || '',
    displayName,
    sourceName,
    type,
    source.value ?? '',
  ].filter((part) => String(part).trim().length > 0);
  return {
    ...(source.id ? { id: String(source.id) } : { id: `resolved-${Buffer.from(idParts.join('|')).toString('base64url').slice(0, 32)}` }),
    name: displayName,
    displayName,
    sourceName,
    level: String(source.level || ''),
    type,
    ...(typeof source.value === 'number' ? { value: source.value } : {}),
    description: String(source.description || source.raw || ''),
    source: String(source.source || 'resolver'),
    condition: String(source.condition || ''),
    category: ['positive', 'passive', 'condition', 'countable'].includes(source.category) ? source.category : 'condition',
    ownerBuffDomain: source.ownerBuffDomain || (source.gearSetName || source.equipmentName ? 'equipment' : undefined),
    ownerCharacterId: source.ownerCharacterId || source.characterId || undefined,
    ownerBuffGroup: source.ownerBuffGroup || (source.gearSetName ? 'threePiece' : undefined),
    refCount: 1,
    effectKind,
    ...(source.maxStacks !== undefined ? { maxStacks: source.maxStacks } : {}),
    ...(source.multiplier ? { multiplier: source.multiplier } : {}),
    ...(source.valueMode ? { valueMode: source.valueMode } : {}),
    ...(source.derivedValue ? { derivedValue: source.derivedValue } : {}),
    ...(effectKind === 'extraHit' && source.extraHitConfig ? { extraHitConfig: source.extraHitConfig } : {}),
  };
}

function resolveDefBuffs(input = {}) {
  const query = normalizeDefToolText(input.query || input.name || input.text || '');
  const snapshot = readMainWorkbenchSnapshotMirror();
  const buttons = Array.isArray(snapshot?.skillButtons) ? snapshot.skillButtons : [];
  const buffMap = new Map();
  for (const button of buttons) {
    for (const buff of Array.isArray(button?.selectedBuffs) ? button.selectedBuffs : []) {
      const key = buff?.id || `${buff?.displayName || buff?.name || ''}:${buff?.sourceName || ''}`;
      if (!key) continue;
      const resolvedBuff = buildDefResolvedBuffObject({
        ...buff,
        source: buff?.source || 'selected-button',
        ownerCharacterId: button?.characterId,
      });
      const current = buffMap.get(key) || {
        id: buff?.id || '',
        name: buff?.name || '',
        displayName: buff?.displayName || '',
        sourceName: buff?.sourceName || '',
        type: buff?.type || '',
        value: typeof buff?.value === 'number' ? buff.value : undefined,
        category: buff?.category || '',
        effectKind: buff?.effectKind || 'modifier',
        source: buff?.source || 'selected-button',
        buff: resolvedBuff,
        refButtonIds: [],
      };
      current.refButtonIds.push(button.id);
      buffMap.set(key, current);
    }
  }
  for (const config of Array.isArray(snapshot?.operatorConfigs) ? snapshot.operatorConfigs : []) {
    for (const equipment of Array.isArray(config?.equipment) ? config.equipment : []) {
      for (const effect of Array.isArray(equipment?.effects) ? equipment.effects : []) {
        const key = effect?.effectId || `${equipment?.name || ''}:${effect?.label || ''}`;
        if (!key || buffMap.has(key)) continue;
        const resolvedBuff = buildDefResolvedBuffObject({
          id: effect?.effectId || '',
          name: effect?.label || effect?.effectId || '',
          displayName: effect?.label || effect?.effectId || '',
          sourceName: equipment?.name || '',
          equipmentName: equipment?.name || '',
          characterId: config?.characterId || '',
          typeKey: effect?.typeKey || '',
          value: effect?.value,
          level: effect?.level || '',
          source: 'equipment',
          category: 'positive',
          ownerBuffDomain: 'equipment',
        });
        buffMap.set(key, {
          id: effect?.effectId || '',
          name: effect?.label || '',
          displayName: effect?.label || '',
          sourceName: equipment?.name || '',
          typeKey: effect?.typeKey || '',
          type: effect?.typeKey || '',
          value: effect?.value,
          category: 'positive',
          effectKind: 'modifier',
          source: 'equipment',
          characterId: config?.characterId || '',
          characterName: config?.characterName || '',
          buff: resolvedBuff,
          refButtonIds: [],
        });
      }
    }
    for (const setBuff of Array.isArray(config?.setBuffs) ? config.setBuffs : []) {
      const key = setBuff?.effectId || `${setBuff?.gearSetName || ''}:${setBuff?.label || ''}`;
      if (!key || buffMap.has(key)) continue;
      const resolvedBuff = buildDefResolvedBuffObject({
        id: setBuff?.effectId || '',
        name: setBuff?.label || setBuff?.effectId || '',
        displayName: setBuff?.label || setBuff?.effectId || '',
        sourceName: setBuff?.gearSetName || '',
        gearSetName: setBuff?.gearSetName || '',
        characterId: config?.characterId || '',
        typeKey: setBuff?.typeKey || '',
        value: setBuff?.value,
        source: 'equipment',
        category: setBuff?.category || 'condition',
        effectKind: setBuff?.effectKind || 'modifier',
        ownerBuffDomain: 'equipment',
        ownerBuffGroup: 'threePiece',
      });
      buffMap.set(key, {
        id: setBuff?.effectId || '',
        name: setBuff?.label || '',
        displayName: setBuff?.label || '',
        sourceName: setBuff?.gearSetName || '',
        gearSetId: setBuff?.gearSetId || '',
        gearSetName: setBuff?.gearSetName || '',
        typeKey: setBuff?.typeKey || '',
        type: setBuff?.typeKey || '',
        value: setBuff?.value,
        category: setBuff?.category || 'condition',
        effectKind: setBuff?.effectKind || 'modifier',
        source: 'equipment',
        characterId: config?.characterId || '',
        characterName: config?.characterName || '',
        buff: resolvedBuff,
        refButtonIds: [],
      });
    }
  }
  const equipmentLibrary = readDefEquipmentLibrary();
  for (const gearSet of Object.values(equipmentLibrary.gearSets || {})) {
    if (!gearSet || typeof gearSet !== 'object') continue;
    const setBuffs = [
      ...(gearSet.threePieceBuff ? [gearSet.threePieceBuff] : []),
      ...Object.values(gearSet.threePieceBuffs || {}),
    ].filter((buff) => buff && typeof buff === 'object');
    for (const setBuff of setBuffs) {
      const key = `library:${gearSet.gearSetId || gearSet.name}:${setBuff.effectId || setBuff.name || setBuff.label || ''}`;
      if (!key || buffMap.has(key)) continue;
      const resolvedBuff = buildDefResolvedBuffObject({
        id: setBuff.effectId || '',
        name: setBuff.name || setBuff.label || setBuff.effectId || '',
        displayName: setBuff.name || setBuff.label || setBuff.effectId || '',
        sourceName: gearSet.name || '',
        gearSetName: gearSet.name || '',
        typeKey: setBuff.typeKey || '',
        value: setBuff.value,
        source: 'equipment-library',
        category: setBuff.category || 'condition',
        effectKind: setBuff.effectKind || 'modifier',
        ownerBuffDomain: 'equipment',
        ownerBuffGroup: 'threePiece',
      });
      buffMap.set(key, {
        id: setBuff.effectId || '',
        name: setBuff.name || setBuff.label || '',
        displayName: setBuff.name || setBuff.label || '',
        sourceName: gearSet.name || '',
        gearSetId: gearSet.gearSetId || '',
        gearSetName: gearSet.name || '',
        typeKey: setBuff.typeKey || '',
        type: setBuff.typeKey || '',
        value: setBuff.value,
        valueLabel: normalizeDefToolPercent(setBuff.value, setBuff.unit),
        category: setBuff.category || 'condition',
        effectKind: setBuff.effectKind || 'modifier',
        source: 'equipment-library',
        buff: resolvedBuff,
        refButtonIds: [],
      });
    }
  }
  const candidates = [...buffMap.values()]
    .filter((buff) => !query || normalizeDefToolText(`${buff.name} ${buff.displayName} ${buff.sourceName} ${buff.gearSetName || ''} ${buff.id}`).includes(query))
    .map((buff) => ({ ...buff, confidence: normalizeDefToolText(`${buff.displayName || buff.name}`) === query ? 1 : 0.72 }));
  return {
    query,
    candidates,
    ambiguity: candidates.length !== 1,
    suggestedQuestion: candidates.length === 0
      ? '没有找到匹配 Buff。请提供 Buff 来源、完整名称或允许从模板构造。'
      : candidates.length > 1
        ? '找到多个 Buff 候选。请指定来源或完整名称。'
        : '',
  };
}

function resolveDefEquipment(input = {}) {
  const query = normalizeDefToolText(input.query || input.name || input.text || '');
  const snapshot = readMainWorkbenchSnapshotMirror();
  const candidates = [];
  for (const config of Array.isArray(snapshot?.operatorConfigs) ? snapshot.operatorConfigs : []) {
    for (const equipment of Array.isArray(config?.equipment) ? config.equipment : []) {
      const candidate = {
        characterName: config?.characterName || '',
        slotKey: equipment?.slotKey || '',
        equipmentId: equipment?.equipmentId || '',
        name: equipment?.name || '',
        part: equipment?.part || '',
        effectCount: Array.isArray(equipment?.effects) ? equipment.effects.length : 0,
      };
      if (!query || normalizeDefToolText(`${candidate.characterName} ${candidate.name} ${candidate.part} ${candidate.equipmentId}`).includes(query)) {
        candidates.push({ ...candidate, confidence: normalizeDefToolText(candidate.name) === query ? 1 : 0.7 });
      }
    }
  }
  const library = readDefEquipmentLibrary();
  for (const gearSet of Object.values(library.gearSets || {})) {
    if (!gearSet || typeof gearSet !== 'object') continue;
    const compactSet = compactDefGearSet(gearSet);
    const haystack = normalizeDefToolText([
      compactSet.name,
      compactSet.gearSetId,
      compactSet.summary,
      ...compactSet.equipments.flatMap((equipment) => [equipment.name, equipment.part, equipment.id]),
      ...compactSet.threePieceBuffs.flatMap((buff) => [buff.name, buff.typeKey, buff.value]),
    ].join(' '));
    if (query && !haystack.includes(query)) continue;
    candidates.push({
      kind: 'gearSet',
      source: 'equipment-library',
      ...compactSet,
      confidence: normalizeDefToolText(compactSet.name) === query || normalizeDefToolText(compactSet.gearSetId) === query ? 1 : 0.82,
      recommendation: compactSet.threePieceBuffs.length
        ? '这是装备套装；如果用户说“加长息 Buff”，应先确认是要装套装，还是只把三件套效果作为按钮 Buff 附加。'
        : '这是装备套装；未发现可直接附加的三件套 Buff。',
    });
  }
  return {
    query,
    candidates: candidates.sort((left, right) => (right.confidence || 0) - (left.confidence || 0)).slice(0, Math.max(1, Math.min(Number(input.limit || 12) || 12, 40))),
    ambiguity: candidates.length !== 1,
    suggestedQuestion: candidates.length > 1 ? '找到多个装备候选。请指定干员、槽位或装备名。' : '',
  };
}

function readDefWorkNode(input = {}) {
  const nodeId = typeof input.nodeId === 'string' && input.nodeId.trim()
    ? input.nodeId.trim()
    : typeof input.id === 'string' && input.id.trim()
      ? input.id.trim()
      : '';
  const nodes = listRepositoryWorkNodes().sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
  const node = nodeId ? nodes.find((item) => item?.id === nodeId) : nodes[0];
  if (!node) {
    return {
      ok: false,
      code: 'ai-worknode-not-found',
      message: nodeId ? `AI timeline work node not found: ${nodeId}` : 'No AI timeline work node exists.',
      nodes: nodes.map((item) => ({
        id: item.id,
        saveId: item.saveId,
        branchId: item.branchId,
        status: item.status,
        updatedAt: item.updatedAt,
        label: item.label,
      })),
    };
  }
  const includePayload = input.includePayload === true;
  return {
    ok: true,
    path: aiTimelineWorkNodesPath,
    node: {
      id: node.id,
      timelineId: node.timelineId || node.saveId,
      saveId: node.saveId,
      branchId: node.branchId,
      label: node.label,
      status: node.status,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      approvalPolicy: node.approvalPolicy,
      baseSummary: node.baseSummary || summarizeTimelinePayload(node.basePayload),
      workingSummary: node.workingSummary || summarizeTimelinePayload(node.workingPayload),
      riskFlags: Array.isArray(node.riskFlags) ? node.riskFlags : [],
      logs: Array.isArray(node.logs) ? node.logs.slice(0, 10) : [],
      ...(includePayload ? { basePayload: node.basePayload, workingPayload: node.workingPayload } : {}),
    },
    diff: buildAiTimelineWorkNodeDiff(node),
  };
}

function validateDefWorkNode(input = {}) {
  const readResult = readDefWorkNode(input);
  if (!readResult.ok) return readResult;
  const node = readRepositoryWorkNode(readResult.node.id);
  const issues = [
    ...validateWorkNodePayloadIssues(node?.basePayload, 'basePayload'),
    ...validateWorkNodePayloadIssues(node?.workingPayload, 'workingPayload'),
  ];
  return {
    ok: issues.length === 0,
    nodeId: readResult.node.id,
    issues,
    baseSummary: readResult.node.baseSummary,
    workingSummary: readResult.node.workingSummary,
  };
}

function verifyDefWorkNodeDiffClean(input = {}) {
  const readResult = readDefWorkNode(input);
  if (!readResult.ok) {
    return {
      pass: false,
      reason: readResult.message,
      readResult,
    };
  }
  const validation = validateDefWorkNode({ nodeId: readResult.node.id });
  const diff = readResult.diff;
  const riskFlags = Array.isArray(diff?.riskFlags) ? diff.riskFlags : [];
  const blockers = riskFlags.filter((risk) => risk?.severity === 'blocker');
  const requiresManualApproval = diff?.checkoutDecision?.requiresManualApproval === true;
  return {
    pass: validation.ok && blockers.length === 0,
    nodeId: readResult.node.id,
    validation,
    diffSummary: diff?.diff?.summary || null,
    riskFlags,
    blockers,
    requiresManualApproval,
    checkoutDecision: diff?.checkoutDecision || null,
  };
}

function findDefWorkNodePatchTargetButton(payload, target = {}) {
  const table = isObject(payload?.skillButtonTable) ? payload.skillButtonTable : {};
  const buttons = Object.values(table).filter(isObject);
  const buttonId = typeof target.buttonId === 'string' && target.buttonId.trim() ? target.buttonId.trim() : '';
  if (buttonId) {
    const button = buttons.find((item) => item.id === buttonId || item.buttonId === buttonId);
    return button ? { ok: true, button } : { ok: false, code: 'button-not-found', message: `Button not found: ${buttonId}` };
  }

  const characterName = normalizeDefToolText(target.characterName || '');
  const skillType = normalizeDefToolText(target.skillType || '');
  const nodeIndex = Number.isInteger(target.nodeIndex) ? target.nodeIndex : null;
  const candidates = buttons.filter((button) => {
    if (characterName && !normalizeDefToolText(button.characterName).includes(characterName)) return false;
    if (skillType && normalizeDefToolText(button.skillType) !== skillType) return false;
    if (nodeIndex !== null && button.nodeIndex !== nodeIndex) return false;
    return true;
  });
  if (!candidates.length) {
    return { ok: false, code: 'button-not-found', message: 'No button matched patch target.' };
  }
  if (candidates.length > 1 && target.latest !== true) {
    return {
      ok: false,
      code: 'button-target-ambiguous',
      message: 'Patch target matched multiple buttons; pass buttonId, nodeIndex, or latest:true.',
      candidates: candidates.map(normalizeWorkNodeButton),
    };
  }
  const sorted = [...candidates].sort((left, right) => (
    (right.staffIndex || 0) - (left.staffIndex || 0)
    || (right.nodeIndex || 0) - (left.nodeIndex || 0)
  ));
  return { ok: true, button: target.latest === true ? sorted[0] : candidates[0] };
}

function makeDefWorkNodeRiskFlag(severity, code, message, path = '') {
  return {
    id: makeId('def-worknode-risk'),
    severity: ['info', 'warning', 'blocker'].includes(severity) ? severity : 'warning',
    code,
    message,
    ...(path ? { path } : {}),
  };
}

function getDefWorkNodeSelectedBuffIds(button = {}) {
  return Array.isArray(button.selectedBuff) ? button.selectedBuff : [];
}

function findDefWorkNodeStaffLineByCharacter(payload, characterName) {
  return (Array.isArray(payload?.timelineData?.staffLines) ? payload.timelineData.staffLines : [])
    .find((line) => line?.characterName === characterName);
}

function removeDefWorkNodeTimelineButton(payload, buttonId) {
  for (const staffLine of Array.isArray(payload?.timelineData?.staffLines) ? payload.timelineData.staffLines : []) {
    staffLine.buttons = (Array.isArray(staffLine.buttons) ? staffLine.buttons : []).filter((button) => button?.id !== buttonId);
    staffLine.occupiedNodes = staffLine.buttons.map((button) => button.nodeIndex).sort((left, right) => left - right);
  }
}

function insertDefWorkNodeTimelineButton(payload, buttonId) {
  const tableButton = payload?.skillButtonTable?.[buttonId];
  if (!tableButton) return;
  const staffLine = (Array.isArray(payload?.timelineData?.staffLines) ? payload.timelineData.staffLines : [])
    .find((line) => line?.staffIndex === tableButton.staffIndex)
    || findDefWorkNodeStaffLineByCharacter(payload, tableButton.characterName);
  if (!staffLine) {
    throw new Error(`staff line not found for ${tableButton.characterName || buttonId}`);
  }
  staffLine.buttons = (Array.isArray(staffLine.buttons) ? staffLine.buttons : []).filter((button) => button?.id !== buttonId);
  staffLine.buttons.push({
    id: tableButton.id,
    characterId: tableButton.characterId,
    characterName: tableButton.characterName,
    skillType: tableButton.skillType,
    staffIndex: tableButton.staffIndex,
    nodeIndex: tableButton.nodeIndex,
    nodeNumber: tableButton.nodeNumber,
    position: tableButton.position,
    runtimeSkillId: tableButton.runtimeSkillId,
    skillDisplayName: tableButton.skillDisplayName,
    skillIconUrl: tableButton.skillIconUrl,
    customHits: tableButton.customHits,
    buffIds: [...getDefWorkNodeSelectedBuffIds(tableButton)],
  });
  staffLine.buttons.sort((left, right) => left.nodeIndex - right.nodeIndex);
  staffLine.occupiedNodes = staffLine.buttons.map((button) => button.nodeIndex).sort((left, right) => left - right);
}

function syncDefWorkNodeTimelineButtonFromTable(payload, buttonId) {
  const tableButton = payload?.skillButtonTable?.[buttonId];
  if (!tableButton) return;
  for (const staffLine of Array.isArray(payload?.timelineData?.staffLines) ? payload.timelineData.staffLines : []) {
    const timelineButton = (Array.isArray(staffLine.buttons) ? staffLine.buttons : []).find((button) => button?.id === buttonId);
    if (!timelineButton) continue;
    timelineButton.characterId = tableButton.characterId;
    timelineButton.characterName = tableButton.characterName;
    timelineButton.skillType = tableButton.skillType;
    timelineButton.staffIndex = tableButton.staffIndex;
    timelineButton.nodeIndex = tableButton.nodeIndex;
    timelineButton.nodeNumber = tableButton.nodeNumber;
    timelineButton.position = tableButton.position;
    timelineButton.runtimeSkillId = tableButton.runtimeSkillId;
    timelineButton.skillDisplayName = tableButton.skillDisplayName;
    timelineButton.skillIconUrl = tableButton.skillIconUrl;
    timelineButton.customHits = tableButton.customHits;
    timelineButton.buffIds = [...getDefWorkNodeSelectedBuffIds(tableButton)];
  }
}

function applyDefWorkNodePatchOperation(payload, operation, index, operationsApplied, riskFlags) {
  const path = `patch[${index}]`;
  if (!isObject(operation)) {
    throw new Error(`${path}: operation must be an object.`);
  }

  if (operation.op === 'clearTimeline') {
    for (const staffLine of Array.isArray(payload?.timelineData?.staffLines) ? payload.timelineData.staffLines : []) {
      staffLine.buttons = [];
      staffLine.occupiedNodes = [];
    }
    payload.skillButtonTable = {};
    riskFlags.push(makeDefWorkNodeRiskFlag('warning', 'timeline-cleared', 'Patch clears all timeline buttons.', path));
    operationsApplied.push({ op: 'clearTimeline', index });
    return;
  }

  if (operation.op === 'addButton') {
    if (typeof operation.characterName !== 'string' || !operation.characterName.trim()) {
      throw new Error(`${path}: addButton requires characterName.`);
    }
    const characterName = operation.characterName.trim();
    const staffLine = findDefWorkNodeStaffLineByCharacter(payload, characterName);
    if (!staffLine && !Number.isInteger(operation.staffIndex)) {
      throw new Error(`${path}: addButton requires selected characterName or explicit staffIndex.`);
    }
    const staffIndex = Number.isInteger(operation.staffIndex) ? operation.staffIndex : staffLine.staffIndex;
    const nodeIndex = Number.isInteger(operation.nodeIndex)
      ? operation.nodeIndex
      : Math.max(-1, ...(Array.isArray(staffLine?.buttons) ? staffLine.buttons : []).map((button) => button.nodeIndex)) + 1;
    const id = sanitizeWorkNodeId(operation.buttonId, `ai-patch-button-${Date.now()}-${index}`);
    const characterId = typeof operation.characterId === 'string' && operation.characterId.trim()
      ? operation.characterId.trim()
      : (typeof payload?.selectedCharacters?.[staffIndex] === 'string' && payload.selectedCharacters[staffIndex].trim()
        ? payload.selectedCharacters[staffIndex].trim()
        : characterName);
    const button = {
      id,
      characterId,
      characterName,
      skillType: typeof operation.skillType === 'string' && operation.skillType.trim() ? operation.skillType.trim() : 'A',
      staffIndex,
      nodeIndex,
      nodeNumber: nodeIndex + 1,
      position: { x: 80 + nodeIndex * 22, y: 60 + staffIndex * 300 },
      runtimeSkillId: typeof operation.runtimeSkillId === 'string' ? operation.runtimeSkillId : undefined,
      skillDisplayName: typeof operation.skillDisplayName === 'string' ? operation.skillDisplayName : undefined,
      selectedBuff: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    payload.skillButtonTable[id] = button;
    insertDefWorkNodeTimelineButton(payload, id);
    operationsApplied.push({ op: 'addButton', index, buttonId: id, after: normalizeWorkNodeButton(button) });
    return;
  }

  if (operation.op === 'copyStaffLine') {
    if (!Number.isInteger(operation.sourceStaffIndex) || !Number.isInteger(operation.targetStaffIndex)) {
      throw new Error(`${path}: copyStaffLine requires integer sourceStaffIndex and targetStaffIndex.`);
    }
    if (operation.sourceStaffIndex === operation.targetStaffIndex) {
      throw new Error(`${path}: copyStaffLine source and target must be different staff lines.`);
    }
    const lines = Array.isArray(payload?.timelineData?.staffLines) ? payload.timelineData.staffLines : [];
    const sourceLine = lines.find((line) => line?.staffIndex === operation.sourceStaffIndex);
    const targetLine = lines.find((line) => line?.staffIndex === operation.targetStaffIndex);
    if (!sourceLine || !targetLine) {
      throw new Error(`${path}: copyStaffLine source or target staff line does not exist.`);
    }
    if (Array.isArray(targetLine.buttons) && targetLine.buttons.length && operation.replaceTarget !== true) {
      throw new Error(`${path}: target staff line is not empty; set replaceTarget:true only when the user explicitly asked to replace it.`);
    }
    if (operation.replaceTarget === true) {
      for (const button of Array.isArray(targetLine.buttons) ? targetLine.buttons : []) {
        delete payload.skillButtonTable[button.id];
      }
      targetLine.buttons = [];
      targetLine.occupiedNodes = [];
      riskFlags.push(makeDefWorkNodeRiskFlag('warning', 'staff-line-replaced', `Patch replaces staff line ${operation.targetStaffIndex + 1}.`, path));
    }
    const sourceButtons = [...(Array.isArray(sourceLine.buttons) ? sourceLine.buttons : [])]
      .map((button) => payload.skillButtonTable?.[button?.id])
      .filter(Boolean)
      .sort((left, right) => left.nodeIndex - right.nodeIndex);
    const copiedButtonIds = [];
    for (const sourceButton of sourceButtons) {
      const id = makeId('ai-copy-button');
      const copiedButton = cloneJson(sourceButton);
      copiedButton.id = id;
      copiedButton.staffIndex = operation.targetStaffIndex;
      copiedButton.nodeNumber = Number(copiedButton.nodeIndex || 0) + 1;
      copiedButton.position = {
        ...copiedButton.position,
        x: 80 + Number(copiedButton.nodeIndex || 0) * 22,
        y: 60 + operation.targetStaffIndex * 300,
      };
      copiedButton.createdAt = Date.now();
      copiedButton.updatedAt = Date.now();
      if (operation.preserveCharacterIdentity === false) {
        copiedButton.characterId = payload.selectedCharacters?.[operation.targetStaffIndex] || targetLine.characterId || copiedButton.characterId;
        copiedButton.characterName = targetLine.characterName || copiedButton.characterName;
      }
      payload.skillButtonTable[id] = copiedButton;
      for (const buffId of getDefWorkNodeSelectedBuffIds(copiedButton)) {
        const buff = (Array.isArray(payload.allBuffList) ? payload.allBuffList : []).find((item) => item?.id === buffId);
        if (buff) buff.refCount = Math.max(1, Number(buff.refCount || 0) + 1);
      }
      insertDefWorkNodeTimelineButton(payload, id);
      copiedButtonIds.push(id);
    }
    operationsApplied.push({
      op: 'copyStaffLine',
      index,
      sourceStaffIndex: operation.sourceStaffIndex,
      targetStaffIndex: operation.targetStaffIndex,
      copiedButtonCount: copiedButtonIds.length,
      copiedButtonIds,
      preserveCharacterIdentity: operation.preserveCharacterIdentity !== false,
    });
    return;
  }

  if (operation.op === 'removeButton') {
    const targetResult = findDefWorkNodePatchTargetButton(payload, isObject(operation.target) ? operation.target : {});
    if (!targetResult.ok) throw new Error(`${path}: ${targetResult.message}`);
    const before = normalizeWorkNodeButton(targetResult.button);
    delete payload.skillButtonTable[targetResult.button.id];
    removeDefWorkNodeTimelineButton(payload, targetResult.button.id);
    riskFlags.push(makeDefWorkNodeRiskFlag('warning', 'button-removed', `Patch removes button ${before.label}.`, path));
    operationsApplied.push({ op: 'removeButton', index, buttonId: before.id, before });
    return;
  }

  if (operation.op === 'moveButton') {
    if (!Number.isInteger(operation.nodeIndex)) {
      throw new Error(`${path}: moveButton requires integer nodeIndex.`);
    }
    const targetResult = findDefWorkNodePatchTargetButton(payload, isObject(operation.target) ? operation.target : {});
    if (!targetResult.ok) throw new Error(`${path}: ${targetResult.message}`);
    const before = normalizeWorkNodeButton(targetResult.button);
    const nextStaffIndex = Number.isInteger(operation.staffIndex) ? operation.staffIndex : targetResult.button.staffIndex;
    targetResult.button.staffIndex = nextStaffIndex;
    targetResult.button.nodeIndex = operation.nodeIndex;
    targetResult.button.nodeNumber = operation.nodeIndex + 1;
    targetResult.button.position = {
      ...targetResult.button.position,
      x: 80 + operation.nodeIndex * 22,
      y: 60 + nextStaffIndex * 300,
    };
    removeDefWorkNodeTimelineButton(payload, targetResult.button.id);
    insertDefWorkNodeTimelineButton(payload, targetResult.button.id);
    operationsApplied.push({
      op: 'moveButton',
      index,
      buttonId: targetResult.button.id,
      before,
      after: normalizeWorkNodeButton(targetResult.button),
    });
    return;
  }

  if (operation.op === 'attachBuff') {
    if (typeof operation.buffId !== 'string' || !operation.buffId.trim()) {
      throw new Error(`${path}: attachBuff requires buffId.`);
    }
    const buff = (Array.isArray(payload?.allBuffList) ? payload.allBuffList : []).find((item) => item?.id === operation.buffId);
    if (!buff) throw new Error(`${path}: buff not found: ${operation.buffId}`);
    const targetResult = findDefWorkNodePatchTargetButton(payload, isObject(operation.target) ? operation.target : {});
    if (!targetResult.ok) throw new Error(`${path}: ${targetResult.message}`);
    const before = normalizeWorkNodeButton(targetResult.button);
    const selectedBuff = new Set(getDefWorkNodeSelectedBuffIds(targetResult.button));
    selectedBuff.add(buff.id);
    targetResult.button.selectedBuff = [...selectedBuff];
    targetResult.button.updatedAt = Date.now();
    buff.refCount = Math.max(1, Number(buff.refCount || 0) + 1);
    syncDefWorkNodeTimelineButtonFromTable(payload, targetResult.button.id);
    operationsApplied.push({
      op: 'attachBuff',
      index,
      buttonId: targetResult.button.id,
      buffId: buff.id,
      before,
      after: normalizeWorkNodeButton(targetResult.button),
    });
    return;
  }

  if (operation.op === 'removeBuff') {
    if (typeof operation.buffId !== 'string' || !operation.buffId.trim()) {
      throw new Error(`${path}: removeBuff requires buffId.`);
    }
    const targetResult = findDefWorkNodePatchTargetButton(payload, isObject(operation.target) ? operation.target : {});
    if (!targetResult.ok) throw new Error(`${path}: ${targetResult.message}`);
    const before = normalizeWorkNodeButton(targetResult.button);
    const selectedBuffIds = getDefWorkNodeSelectedBuffIds(targetResult.button);
    if (!selectedBuffIds.includes(operation.buffId)) {
      throw new Error(`${path}: button does not reference buff ${operation.buffId}.`);
    }
    targetResult.button.selectedBuff = selectedBuffIds.filter((id) => id !== operation.buffId);
    targetResult.button.updatedAt = Date.now();
    const buff = (Array.isArray(payload?.allBuffList) ? payload.allBuffList : []).find((item) => item?.id === operation.buffId);
    if (buff) buff.refCount = Math.max(0, Number(buff.refCount || 0) - 1);
    syncDefWorkNodeTimelineButtonFromTable(payload, targetResult.button.id);
    riskFlags.push(makeDefWorkNodeRiskFlag('warning', 'buff-removed', `Patch removes buff ${operation.buffId} from a button.`, path));
    operationsApplied.push({
      op: 'removeBuff',
      index,
      buttonId: targetResult.button.id,
      buffId: operation.buffId,
      before,
      after: normalizeWorkNodeButton(targetResult.button),
    });
    return;
  }

  if (operation.op === 'setTargetResistance') {
    if (!isObject(operation.targetResistance)) {
      throw new Error(`${path}: setTargetResistance requires targetResistance object.`);
    }
    const targetResult = findDefWorkNodePatchTargetButton(payload, isObject(operation.target) ? operation.target : {});
    if (!targetResult.ok) throw new Error(`${path}: ${targetResult.message}`);
    const before = normalizeWorkNodeButton(targetResult.button);
    targetResult.button.resistanceConfig = { targetResistance: { ...operation.targetResistance } };
    targetResult.button.updatedAt = Date.now();
    syncDefWorkNodeTimelineButtonFromTable(payload, targetResult.button.id);
    operationsApplied.push({
      op: 'setTargetResistance',
      index,
      buttonId: targetResult.button.id,
      before,
      after: normalizeWorkNodeButton(targetResult.button),
    });
    return;
  }

  throw new Error(`${path}: unsupported patch op ${operation.op || 'unknown'}.`);
}

function applyDefWorkNodePatchAndValidate(input = {}) {
  let nodeId = typeof input.nodeId === 'string' && input.nodeId.trim() ? input.nodeId.trim() : '';
  const patch = Array.isArray(input.patch) ? input.patch : [];
  const checkout = input.checkout !== false;
  const dryRun = input.dryRun === true;
  let created = null;
  if (!nodeId) {
    const createResult = createDefWorkNodeFromPayload(readDefCurrentTimelinePayloadSource(), input);
    if (!createResult.ok) {
      return {
        ...createResult,
        checkout: false,
        currentCheckoutTouched: false,
        completedSteps: ['create-node-failed'],
        nextActions: ['Open the Web main workbench once so it can mirror the current timeline payload, then retry.'],
      };
    }
    created = {
      nodeId: createResult.node.id,
      saveId: createResult.node.saveId,
      branchId: createResult.node.branchId,
      label: createResult.node.label,
      status: createResult.node.status,
      baseSummary: createResult.node.baseSummary,
      workingSummary: createResult.node.workingSummary,
      buttonTargets: createResult.buttonTargets,
      source: createResult.source,
      sourceId: createResult.sourceId,
      sourceUpdatedAt: createResult.sourceUpdatedAt,
      path: createResult.path,
    };
    nodeId = createResult.node.id;
  }
  if (!patch.length) {
    return {
      ok: false,
      code: 'empty-patch',
      message: 'patch_and_validate requires a non-empty patch array.',
      nodeId,
      checkout: false,
      currentCheckoutTouched: false,
      completedSteps: created ? ['create-node', 'read-input'] : ['read-input'],
    };
  }

  const node = readRepositoryWorkNode(nodeId);
  if (!node) {
    return {
      ok: false,
      code: 'ai-worknode-not-found',
      message: `AI timeline work node not found: ${nodeId}`,
      nodeId,
      checkout: false,
      currentCheckoutTouched: false,
      completedSteps: created ? ['create-node', 'read-input'] : ['read-input'],
    };
  }

  const workingPayload = cloneJson(node.workingPayload);
  const operationsApplied = [];
  const riskFlags = [...(Array.isArray(node.riskFlags) ? node.riskFlags : [])];
  try {
    patch.forEach((operation, index) => applyDefWorkNodePatchOperation(workingPayload, operation, index, operationsApplied, riskFlags));
  } catch (error) {
    return {
      ok: false,
      code: 'patch-failed',
      message: 'Patch failed before writing work node.',
      nodeId,
      checkout: false,
      currentCheckoutTouched: false,
      completedSteps: created ? ['create-node', 'read-node'] : ['read-node'],
      issues: [{
        code: 'patch-apply-failed',
        message: error instanceof Error ? error.message : String(error),
      }],
      operationsApplied,
      riskFlags: [
        ...riskFlags,
        makeDefWorkNodeRiskFlag('blocker', 'patch-apply-failed', error instanceof Error ? error.message : String(error)),
      ],
    };
  }

  if (isObject(workingPayload.timelineData)) workingPayload.timelineData.updatedAt = Date.now();
  const validationIssues = validateWorkNodePayloadIssues(workingPayload, 'workingPayload');
  if (validationIssues.length) {
    return {
      ok: false,
      code: 'validation-failed',
      message: validationIssues.map((issue) => issue.message).join('; '),
      nodeId,
      patchApplied: false,
      checkout: false,
      currentCheckoutTouched: false,
      completedSteps: created ? ['create-node', 'read-node', 'patch-dry-build'] : ['read-node', 'patch-dry-build'],
      operationsApplied,
      validation: { ok: false, issues: validationIssues },
    };
  }

  const nextNode = {
    ...node,
    updatedAt: Date.now(),
    status: dryRun ? node.status : 'ready',
    workingPayload,
    workingSummary: summarizeTimelinePayload(workingPayload),
    riskFlags,
    logs: dryRun ? node.logs : [
      makeWorkNodeLog('info', 'Applied patch_and_validate work node patch.', {
        operationCount: operationsApplied.length,
        dryRun,
      }),
      ...(Array.isArray(node.logs) ? node.logs : []),
    ],
  };
  const diff = diffTimelinePayloadsForWorkNode(node.basePayload, workingPayload);
  const checkoutDecision = buildAiTimelineCheckoutDecision({
    approvalPolicy: nextNode.approvalPolicy,
    riskFlags,
    diff,
  });
  if (!dryRun) {
    getAiTimelineWorkNodeStore().saveNode(nextNode);
    mirrorWorkNodeToTimelineRepository(nextNode);
    getTimelineRepository().appendWorkNodePatch({
      id: `work-node-patch-${nextNode.id}-${nextNode.updatedAt}`,
      timelineId: nextNode.timelineId || nextNode.saveId || 'current-main-workbench',
      nodeId: nextNode.id,
      patch,
      validation: { ok: true, issues: [] },
      diffSummary: diff.summary,
      riskFlags,
      createdAt: nextNode.updatedAt,
    });
  }
  const validation = {
    ok: true,
    nodeId: nextNode.id,
    issues: [],
    baseSummary: summarizeTimelinePayload(node.basePayload),
    workingSummary: summarizeTimelinePayload(workingPayload),
  };
  return {
    ok: validation.ok,
    nodeId: nextNode.id,
    ...(created ? { created } : {}),
    dryRun,
    patchApplied: !dryRun,
    operationsApplied,
    validation,
    diffSummary: formatDefWorkNodeDiffSummary(diff),
    diff: { summary: diff.summary, selectedCharactersChanged: diff.selectedCharactersChanged },
    changedButtons: summarizeDefWorkNodeChangedButtons(diff),
    checkout,
    currentCheckoutTouched: false,
    pollutionCheck: {
      pass: true,
      method: 'server-side work node update; checkout is executed by the verified renderer command path',
    },
    riskFlags,
    checkoutDecision,
    completedSteps: created
      ? ['create-node', 'read-node', 'patch', 'validate', 'diff', 'pollution-check']
      : ['read-node', 'patch', 'validate', 'diff', 'pollution-check'],
    nextActions: checkoutDecision.requiresManualApproval
      ? ['Review diff/risk flags before def.worknode.checkout.']
      : checkout && !dryRun
        ? ['Apply this protected work node immediately through checkout_and_verify.']
        : ['Work node remains staged because checkout:false or dryRun was requested.'],
  };
}

function normalizeDefStaffIndex(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function copyDefWorkNodeStaffLineAndValidate(input = {}) {
  const sourceStaffIndex = normalizeDefStaffIndex(input.sourceStaffIndex);
  const targetStaffIndex = normalizeDefStaffIndex(input.targetStaffIndex);
  if (sourceStaffIndex === null || targetStaffIndex === null) {
    return {
      ok: false,
      code: 'invalid-staff-line-copy-input',
      message: 'sourceStaffIndex and targetStaffIndex must be non-negative integers or integer strings.',
      details: {
        sourceStaffIndex: input.sourceStaffIndex,
        targetStaffIndex: input.targetStaffIndex,
      },
      checkout: false,
      currentCheckoutTouched: false,
    };
  }
  return applyDefWorkNodePatchAndValidate({
    ...input,
    patch: [{
      op: 'copyStaffLine',
      sourceStaffIndex,
      targetStaffIndex,
      preserveCharacterIdentity: input.preserveCharacterIdentity !== false,
      replaceTarget: input.replaceTarget === true,
    }],
  });
}

function readDefToolGovernanceArchive() {
  try {
    if (!fs.existsSync(defToolGovernancePath)) {
      return { type: 'def.tool.governance.v1', schemaVersion: 1, questions: [], approvals: [] };
    }
    const parsed = JSON.parse(fs.readFileSync(defToolGovernancePath, 'utf-8'));
    if (!parsed || parsed.type !== 'def.tool.governance.v1') {
      return { type: 'def.tool.governance.v1', schemaVersion: 1, questions: [], approvals: [] };
    }
    return {
      type: 'def.tool.governance.v1',
      schemaVersion: 1,
      questions: Array.isArray(parsed.questions) ? parsed.questions : [],
      approvals: Array.isArray(parsed.approvals) ? parsed.approvals : [],
    };
  } catch {
    return { type: 'def.tool.governance.v1', schemaVersion: 1, questions: [], approvals: [] };
  }
}

function writeDefToolGovernanceArchive(archive) {
  fs.mkdirSync(path.dirname(defToolGovernancePath), { recursive: true });
  fs.writeFileSync(defToolGovernancePath, `${JSON.stringify({
    type: 'def.tool.governance.v1',
    schemaVersion: 1,
    questions: Array.isArray(archive.questions) ? archive.questions.slice(0, 100) : [],
    approvals: Array.isArray(archive.approvals) ? archive.approvals.slice(0, 200) : [],
  }, null, 2)}\n`, 'utf-8');
}

function appendDefGovernanceWorkNodeLog(workNodeId, level, message, data = {}) {
  if (typeof workNodeId !== 'string' || !workNodeId.trim()) return null;
  const store = getAiTimelineWorkNodeStore();
  const node = store.getNode(workNodeId.trim());
  if (!node) return null;
  const updatedNode = {
    ...node,
    updatedAt: Date.now(),
    logs: [
      makeWorkNodeLog(level, message, data),
      ...(Array.isArray(node.logs) ? node.logs : []),
    ].slice(0, 100),
  };
  store.saveNode(updatedNode);
  mirrorWorkNodeToTimelineRepository(updatedNode);
  return updatedNode;
}

function createDefUserQuestion(input = {}) {
  const question = typeof input.question === 'string' && input.question.trim()
    ? input.question.trim()
    : typeof input.prompt === 'string' && input.prompt.trim()
      ? input.prompt.trim()
      : '';
  if (!question) {
    return { ok: false, code: 'missing-question', message: 'def.user.ask requires question or prompt.' };
  }
  const mode = ['optional', 'non-blocking', 'blocking'].includes(input.mode) ? input.mode : 'non-blocking';
  const archive = readDefToolGovernanceArchive();
  const record = {
    id: makeId('def-question'),
    createdAt: Date.now(),
    status: 'open',
    mode,
    question,
    suggestedOptions: Array.isArray(input.suggestedOptions) ? input.suggestedOptions.slice(0, 6) : [],
    context: isObject(input.context) ? input.context : {},
    workNodeId: typeof input.workNodeId === 'string' ? input.workNodeId : '',
    toolCallId: typeof input.toolCallId === 'string' ? input.toolCallId : '',
  };
  writeDefToolGovernanceArchive({
    ...archive,
    questions: [record, ...archive.questions.filter((item) => item?.id !== record.id)],
  });
  appendDefGovernanceWorkNodeLog(record.workNodeId, 'info', 'Recorded DEF user question.', {
    questionId: record.id,
    mode: record.mode,
    question: record.question,
  });
  return {
    ok: true,
    question: record,
    note: 'Recorded question for low-blocking UI/agent follow-up. This tool does not force a modal by itself.',
  };
}

function createDefApprovalRequest(input = {}) {
  const summary = typeof input.summary === 'string' && input.summary.trim()
    ? input.summary.trim()
    : typeof input.rationale === 'string' && input.rationale.trim()
      ? input.rationale.trim()
      : '';
  if (!summary) {
    return { ok: false, code: 'missing-approval-summary', message: 'def.approval.request requires summary or rationale.' };
  }
  const riskLevel = ['low', 'medium', 'high'].includes(input.riskLevel) ? input.riskLevel : 'medium';
  const mode = ['optional', 'non-blocking', 'blocking'].includes(input.mode) ? input.mode : (riskLevel === 'high' ? 'blocking' : 'non-blocking');
  const archive = readDefToolGovernanceArchive();
  const record = {
    id: makeId('def-approval'),
    createdAt: Date.now(),
    status: 'requested',
    mode,
    riskLevel,
    summary,
    diffSummary: isObject(input.diffSummary) ? input.diffSummary : null,
    riskFlags: Array.isArray(input.riskFlags) ? input.riskFlags : [],
    workNodeId: typeof input.workNodeId === 'string' ? input.workNodeId : '',
    toolCallId: typeof input.toolCallId === 'string' ? input.toolCallId : '',
  };
  writeDefToolGovernanceArchive({
    ...archive,
    approvals: [record, ...archive.approvals.filter((item) => item?.id !== record.id)],
  });
  appendDefGovernanceWorkNodeLog(record.workNodeId, 'warning', 'Recorded DEF approval request.', {
    approvalId: record.id,
    mode: record.mode,
    riskLevel: record.riskLevel,
    summary: record.summary,
  });
  return {
    ok: true,
    approval: record,
    note: 'Recorded approval request. Policy/verifier still decide whether execution may continue.',
  };
}

function recordDefApprovalDecision(input = {}) {
  const approvalId = typeof input.approvalId === 'string' && input.approvalId.trim() ? input.approvalId.trim() : '';
  const decision = ['approved', 'rejected', 'deferred'].includes(input.decision) ? input.decision : '';
  if (!approvalId || !decision) {
    return { ok: false, code: 'invalid-approval-decision', message: 'def.approval.record_decision requires approvalId and decision approved/rejected/deferred.' };
  }
  const archive = readDefToolGovernanceArchive();
  let updated = null;
  const approvals = archive.approvals.map((approval) => {
    if (approval?.id !== approvalId) return approval;
    updated = {
      ...approval,
      status: decision,
      decidedAt: Date.now(),
      decidedBy: ['ai', 'user', 'system'].includes(input.decidedBy) ? input.decidedBy : 'ai',
      rationale: typeof input.rationale === 'string' ? input.rationale : '',
    };
    return updated;
  });
  if (!updated) {
    return { ok: false, code: 'approval-not-found', message: `Approval request not found: ${approvalId}` };
  }
  writeDefToolGovernanceArchive({ ...archive, approvals });
  appendDefGovernanceWorkNodeLog(updated.workNodeId, decision === 'approved' ? 'info' : 'warning', 'Recorded DEF approval decision.', {
    approvalId,
    decision,
    decidedBy: updated.decidedBy,
    rationale: updated.rationale,
  });
  return { ok: true, approval: updated };
}

function buildDefToolDefinitions() {
  const executeCommand = 'Wraps current main workbench command queue; enqueue success still requires verification.';
  const workNode = 'Uses appdata/localdata AI work node; current checkout changes only on checkout/restore.';
  const patchDslProperty = {
    type: 'array',
    description: 'Constrained work node Patch DSL. Edits workingPayload only; checkout remains separate.',
    items: {
      type: 'object',
      properties: {
        op: {
          type: 'string',
          enum: ['addButton', 'copyStaffLine', 'removeButton', 'moveButton', 'attachBuff', 'removeBuff', 'setTargetResistance', 'clearTimeline'],
        },
        characterName: { type: 'string', description: 'Required for addButton.' },
        skillType: { type: 'string' },
        runtimeSkillId: { type: 'string' },
        skillDisplayName: { type: 'string' },
        target: {
          type: 'object',
          properties: {
            buttonId: { type: 'string' },
            characterName: { type: 'string' },
            skillType: { type: 'string' },
            nodeIndex: { type: 'number' },
            latest: { type: 'boolean' },
          },
        },
        staffIndex: { type: 'number' },
        sourceStaffIndex: { type: 'number', description: 'Required for copyStaffLine.' },
        targetStaffIndex: { type: 'number', description: 'Required for copyStaffLine.' },
        preserveCharacterIdentity: { type: 'boolean', description: 'copyStaffLine defaults to true for an exact visual/content duplicate.' },
        replaceTarget: { type: 'boolean', description: 'copyStaffLine rejects non-empty targets unless this is explicitly true.' },
        nodeIndex: { type: 'number', description: 'Required for moveButton; optional for addButton.' },
        buffId: { type: 'string', description: 'Required for attachBuff/removeBuff.' },
        targetResistance: { type: 'object', description: 'Required for setTargetResistance.' },
      },
    },
  };
  const workNodePatchSchema = {
    type: 'object',
    required: ['nodeId', 'patch'],
    properties: {
      nodeId: { type: 'string', description: 'Existing appdata work node id.' },
      dryRun: { type: 'boolean' },
      patch: patchDslProperty,
    },
  };
  const patchAndValidateSchema = {
    type: 'object',
    required: ['patch'],
    properties: {
      nodeId: { type: 'string', description: 'Optional existing appdata work node id. If omitted, the tool creates a new work node from the best available current payload mirror before patching.' },
      checkout: { type: 'boolean', description: 'Defaults to true for an explicit user mutation: after validation, immediately checkout through the protected no-reload path. Set false only to stage a draft.' },
      dryRun: { type: 'boolean' },
      approvalPolicy: { type: 'string', enum: ['auto-low-risk', 'ask-on-risk', 'manual'] },
      label: { type: 'string' },
      saveId: { type: 'string' },
      branchId: { type: 'string' },
      patch: patchDslProperty,
    },
  };
  const copyStaffLineSchema = {
    type: 'object',
    required: ['sourceStaffIndex', 'targetStaffIndex'],
    properties: {
      nodeId: { type: 'string', description: 'Optional existing work node. Omit to create one from the current checkout.' },
      sourceStaffIndex: { type: 'integer', minimum: 0, description: 'Zero-based source staff line index. Numeric strings are normalized defensively.' },
      targetStaffIndex: { type: 'integer', minimum: 0, description: 'Zero-based target staff line index. Numeric strings are normalized defensively.' },
      preserveCharacterIdentity: { type: 'boolean', description: 'Defaults to true for an exact copy.' },
      replaceTarget: { type: 'boolean', description: 'Only true when the user explicitly requested replacing a non-empty target line.' },
      checkout: { type: 'boolean', description: 'Defaults to true and applies the validated work node without a browser reload.' },
      dryRun: { type: 'boolean' },
    },
  };
  const checkoutWorkNodeSchema = {
    type: 'object',
    required: ['nodeId'],
    properties: {
      nodeId: { type: 'string', description: 'Existing appdata work node id to apply to current checkout.' },
      commitId: { type: 'string' },
      reload: { type: 'boolean', description: 'Defaults to false to preserve the current UI. Set true only when the user explicitly requests a full reload.' },
      waitMs: { type: 'number', description: 'Optional synchronous verification wait window in milliseconds for *_and_verify tools.' },
      snapshotWaitMs: { type: 'number', description: 'Optional extra wait for the mirrored snapshot to reflect the applied command.' },
      approval: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['auto', 'manual'] },
          approvedBy: { type: 'string', enum: ['ai', 'user', 'system'] },
          rationale: { type: 'string' },
        },
      },
    },
  };
  const restoreWorkNodeSchema = {
    type: 'object',
    required: ['nodeId'],
    properties: {
      nodeId: { type: 'string', description: 'Existing appdata work node id whose basePayload should be restored.' },
      reload: { type: 'boolean', description: 'Defaults to false to preserve the current UI. Set true only when the user explicitly requests a full reload.' },
      waitMs: { type: 'number', description: 'Optional synchronous verification wait window in milliseconds for *_and_verify tools.' },
      snapshotWaitMs: { type: 'number', description: 'Optional extra wait for the mirrored snapshot to reflect the restored command.' },
      approval: {
        type: 'object',
        properties: {
          approvedBy: { type: 'string', enum: ['ai', 'user', 'system'] },
          rationale: { type: 'string' },
        },
      },
    },
  };
  const damageCalculateAndVerifySchema = {
    type: 'object',
    properties: {
      buttonId: { type: 'string' },
      waitMs: { type: 'number', description: 'Synchronous verification wait window in milliseconds.' },
      snapshotWaitMs: { type: 'number', description: 'Optional extra wait for the mirrored damage report.' },
    },
  };
  return [
    { name: 'def.tool.list', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'List DEF typed tools.' },
    { name: 'def.tool.describe', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Describe one DEF typed tool.' },
    { name: 'def.workbench.snapshot', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Read the current checkout snapshot mirror.' },
    { name: 'def.workbench.evidence', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Read bounded current-checkout evidence for the model.' },
    { name: 'def.workbench.list_buttons', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'List skill buttons with stable ids and labels.' },
    { name: 'def.workbench.list_characters', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'List selected characters and compact config summary.' },
    { name: 'def.workbench.damage_report', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Read compact damage report.' },
    { name: 'def.workbench.find_buttons', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Resolve button candidates from query, character, skill, type, and position.' },
    { name: 'def.buff.resolve', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Resolve buff candidates from current button buffs, equipped effects, and gear-set three-piece buffs.' },
    { name: 'def.buff.search_candidates', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Wide buff candidate search; alias of def.buff.resolve for now.' },
    { name: 'def.skill.resolve', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Resolve skill candidates from current timeline buttons.' },
    { name: 'def.character.resolve', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Resolve selected character candidates.' },
    { name: 'def.equipment.resolve', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Resolve current equipment and equipment-library gear sets with compact summaries; use for questions like 长息是什么/有哪些/该选哪个.' },
    { name: 'def.weapon.resolve', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Resolve weapon candidates from current operator configs.' },
    { name: 'def.gear.resolve', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Resolve gear/equipment candidates and gear-set three-piece buff summaries; preferred for equipment-set explanation.' },
    { name: 'def.workbench.add_skill_button', commandOp: 'addSkillButton', scope: 'current-checkout', riskLevel: 'low', approval: 'auto', status: 'implemented', description: executeCommand },
    { name: 'def.workbench.add_skill_button_and_verify', scope: 'current-checkout', riskLevel: 'low', approval: 'auto', status: 'implemented', description: 'Add one skill button, wait for browser command execution, then return command result and snapshot verification.' },
    { name: 'def.workbench.remove_skill_button', commandOp: 'removeSkillButton', scope: 'current-checkout', riskLevel: 'medium', approval: 'ai-review', status: 'implemented', description: executeCommand },
    { name: 'def.buff.add_to_button', commandOp: 'addBuff', scope: 'current-checkout', riskLevel: 'medium', approval: 'auto', status: 'implemented', description: executeCommand },
    { name: 'def.buff.add_to_button_and_verify', scope: 'current-checkout', riskLevel: 'medium', approval: 'auto', status: 'implemented', description: 'Add one buff to one button, wait for browser command execution, then verify the target button contains that buff.' },
    { name: 'def.buff.add_to_buttons', commandOp: 'addBuffToButtons', scope: 'current-checkout', riskLevel: 'medium', approval: 'ai-review', status: 'implemented', description: executeCommand },
    { name: 'def.buff.remove_from_button', commandOp: 'removeBuff', scope: 'current-checkout', riskLevel: 'medium', approval: 'ai-review', status: 'implemented', description: executeCommand },
    { name: 'def.target.set_resistance', commandOp: 'setTargetResistance', scope: 'current-checkout', riskLevel: 'low', approval: 'auto', status: 'implemented', description: executeCommand },
    { name: 'def.damage.calculate', commandOp: 'calculateDamage', scope: 'current-checkout', riskLevel: 'low', approval: 'auto', status: 'implemented', description: executeCommand },
    { name: 'def.damage.calculate_and_verify', scope: 'current-checkout', riskLevel: 'low', approval: 'auto', status: 'implemented', description: 'Trigger damage calculation, wait briefly for command execution, then return command and damage report verification.' },
    { name: 'def.worknode.create_from_current', commandOp: 'createAiTimelineWorkNodeFromCurrent', scope: 'appdata-work-node', riskLevel: 'medium', approval: 'auto', status: 'implemented', description: workNode },
    { name: 'def.worknode.patch', commandOp: 'patchAiTimelineWorkNode', scope: 'appdata-work-node', riskLevel: 'high', approval: 'ai-review', status: 'implemented', description: 'Class-code Patch DSL / CRUD tool for node.workingPayload.' },
    { name: 'def.worknode.patch_and_validate', scope: 'appdata-work-node', riskLevel: 'high', approval: 'ai-review', status: 'implemented', description: 'Apply a constrained work node patch, validate, then immediately checkout and verify explicit low-risk user mutations without reloading. Use checkout:false only to stage a draft.' },
    { name: 'def.worknode.copy_staff_line_and_verify', scope: 'appdata-work-node', riskLevel: 'high', approval: 'ai-review', status: 'implemented', description: 'Directly copy one complete timeline staff line into another work-node line, validate it, then checkout and verify. Use for requests such as copying all of group 1 to group 2; do not emulate with addButton patches.' },
    { name: 'def.worknode.diff', commandOp: 'diffAiTimelineWorkNode', scope: 'appdata-work-node', riskLevel: 'read', approval: 'none', status: 'implemented', description: workNode },
    { name: 'def.worknode.checkout', commandOp: 'checkoutAiTimelineWorkNode', scope: 'appdata-work-node', riskLevel: 'high', approval: 'ai-review', status: 'implemented', description: workNode },
    { name: 'def.worknode.checkout_and_verify', scope: 'appdata-work-node', riskLevel: 'high', approval: 'ai-review', status: 'implemented', description: 'Checkout a work node with reload:false by default, wait briefly for renderer execution, and verify current checkout snapshot.' },
    { name: 'def.worknode.restore_base', commandOp: 'restoreAiTimelineWorkNodeBase', scope: 'appdata-work-node', riskLevel: 'high', approval: 'ai-review', status: 'implemented', description: workNode },
    { name: 'def.worknode.restore_base_and_verify', scope: 'appdata-work-node', riskLevel: 'high', approval: 'ai-review', status: 'implemented', description: 'Restore a work node basePayload with reload:false by default, wait briefly for renderer execution, and verify current checkout snapshot.' },
    { name: 'def.worknode.read', scope: 'appdata-work-node', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Read appdata work node state without touching current checkout.' },
    { name: 'def.worknode.validate', scope: 'appdata-work-node', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Validate work node basePayload and workingPayload without checkout.' },
    { name: 'def.user.ask', scope: 'governance', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Record a formal low-blocking question for user follow-up.' },
    { name: 'def.approval.request', scope: 'governance', riskLevel: 'medium', approval: 'user-confirm', status: 'implemented', description: 'Record an approval request without forcing every warning into a blocker.' },
    { name: 'def.approval.record_decision', scope: 'governance', riskLevel: 'medium', approval: 'ai-review', status: 'implemented', description: 'Record approval rationale into local audit.' },
    { name: 'def.verify.command_result', scope: 'verification', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Verify command or batch status from result log/queue.' },
    { name: 'def.verify.snapshot_delta', scope: 'verification', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Return compact snapshot facts for caller-side delta checks.' },
    { name: 'def.verify.buttons_have_buff', scope: 'verification', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Verify target buttons contain a buff by id/name/displayName.' },
    { name: 'def.verify.damage_recalculated', scope: 'verification', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Verify damage report exists and expose generatedAt/total.' },
    { name: 'def.verify.worknode_diff_clean', scope: 'verification', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Verify work node diff/risk before checkout.' },
    { name: 'def.operator.config.read', scope: 'read', riskLevel: 'read', approval: 'none', status: 'implemented', description: 'Read compact operator config summary from snapshot.' },
    { name: 'def.operator.config.patch', scope: 'current-checkout', riskLevel: 'medium', approval: 'ai-review', status: 'implemented', description: 'Structured operator config patch for weapon/equipment fields.' },
    { name: 'def.gear.set_entry_level', scope: 'current-checkout', riskLevel: 'medium', approval: 'ai-review', status: 'implemented', description: 'Set equipped gear entry level through structured config commands.' },
  ].map((tool) => ({
    ...tool,
    inputSchema: tool.name === 'def.worknode.copy_staff_line_and_verify'
      ? copyStaffLineSchema
      : tool.name === 'def.worknode.patch_and_validate'
      ? patchAndValidateSchema
      : tool.name === 'def.worknode.patch'
        ? workNodePatchSchema
        : tool.name === 'def.worknode.checkout' || tool.name === 'def.worknode.checkout_and_verify'
          ? checkoutWorkNodeSchema
          : tool.name === 'def.worknode.restore_base' || tool.name === 'def.worknode.restore_base_and_verify'
            ? restoreWorkNodeSchema
            : tool.name === 'def.damage.calculate_and_verify'
              ? damageCalculateAndVerifySchema
              : tool.commandOp ? { type: 'object', description: `MainWorkbenchCommand fields without op; op is ${tool.commandOp}.` } : { type: 'object' },
    outputSchema: { type: 'object', fields: ['ok', 'tool', 'result'] },
    verification: tool.scope === 'current-checkout' ? ['command_result', 'snapshot_delta'] : tool.scope === 'appdata-work-node' ? ['schema', 'diff'] : ['schema'],
    rollback: tool.scope === 'appdata-work-node' ? 'required' : tool.scope === 'current-checkout' ? 'optional' : 'none',
    idempotency: tool.commandOp ? 'caller-provided requestId optional; command queue deduplicates explicit ids' : 'read-only',
    modelOutputPolicy: 'bounded-json',
    auditLog: tool.commandOp ? 'command queue/result log' : 'rest access log',
  }));
}

const DEF_TOOL_DEFINITIONS = buildDefToolDefinitions();

function getDefToolDefinition(name) {
  return DEF_TOOL_DEFINITIONS.find((tool) => tool.name === name) || null;
}

function enqueueDefToolCommand(definition, input = {}) {
  const { requestId: _requestId, source: _source, toolCallId: _toolCallId, ...commandInput } = isObject(input) ? input : {};
  void _requestId;
  void _source;
  void _toolCallId;
  const command = normalizeMainWorkbenchCommand({ ...commandInput, op: definition.commandOp });
  const validation = validateMainWorkbenchCommand(command);
  if (!validation.ok) return failScript(400, validation.code, validation.message);
  const source = typeof input.source === 'string' ? input.source : 'def-tool-runtime';
  const requestId = typeof input.requestId === 'string' && input.requestId.trim() ? input.requestId.trim() : '';
  const queue = readMainWorkbenchCommandQueue();
  if (requestId) {
    const existing = queue.find((entry) => entry.id === requestId);
    if (existing) {
      return { status: 200, body: { ok: true, protocolVersion: 1, tool: definition.name, command: existing, duplicate: true } };
    }
  }
  const entry = normalizeMainWorkbenchCommandEntry({
    id: requestId || makeMainWorkbenchCommandId(),
    command,
    source,
    status: 'pending',
  });
  writeMainWorkbenchCommandQueue([...queue, entry]);
  return {
    status: 200,
    body: {
      ok: true,
      protocolVersion: 1,
      tool: definition.name,
      resultState: 'queued',
      status: 'queued',
      command: entry,
      verificationRequired: definition.verification,
      note: 'queued does not mean executed; verify command_result or snapshot_delta before final answer.',
    },
  };
}

function enqueueDefToolCommands(definition, commands, input = {}) {
  const normalizedCommands = Array.isArray(commands)
    ? commands.map(normalizeMainWorkbenchCommand)
    : [];
  if (!normalizedCommands.length) {
    return failScript(400, 'def-tool-no-commands', `${definition.name} did not produce any command.`);
  }
  const invalid = normalizedCommands
    .map((command) => validateMainWorkbenchCommand(command))
    .find((validation) => !validation.ok);
  if (invalid) {
    return failScript(400, invalid.code, invalid.message);
  }

  const queue = readMainWorkbenchCommandQueue();
  const source = typeof input.source === 'string' ? input.source : 'def-tool-runtime';
  const requestedBatchId = normalizeMainWorkbenchBatchId(input.batchId);
  if (normalizedCommands.length === 1) {
    const requestId = typeof input.requestId === 'string' && input.requestId.trim() ? input.requestId.trim() : '';
    const id = requestId || makeMainWorkbenchCommandId();
    const existing = queue.find((entry) => entry.id === id);
    if (existing) {
      return { status: 200, body: { ok: true, protocolVersion: 1, tool: definition.name, command: existing, commands: [existing], duplicate: true } };
    }
    const entry = normalizeMainWorkbenchCommandEntry({
      id,
      command: normalizedCommands[0],
      source,
      status: 'pending',
      ...(requestedBatchId ? { batchId: requestedBatchId, batchIndex: 0, batchSize: 1 } : {}),
    });
    writeMainWorkbenchCommandQueue([...queue, entry]);
    return {
      status: 200,
      body: {
        ok: true,
        protocolVersion: 1,
        tool: definition.name,
        resultState: 'queued',
        status: 'queued',
        command: entry,
        commands: [entry],
        verificationRequired: definition.verification,
        note: 'queued does not mean executed; verify command_result or snapshot_delta before final answer.',
      },
    };
  }

  const batchId = requestedBatchId || makeMainWorkbenchBatchId();
  const batchSize = normalizedCommands.length;
  const entries = normalizedCommands.map((command, index) => normalizeMainWorkbenchCommandEntry({
    id: makeMainWorkbenchCommandId(),
    command,
    source,
    status: 'pending',
    batchId,
    batchIndex: index,
    batchSize,
  }));
  writeMainWorkbenchCommandQueue([...queue, ...entries]);
  return {
    status: 200,
    body: {
      ok: true,
      protocolVersion: 1,
      tool: definition.name,
      resultState: 'queued',
      status: 'queued',
      batchId,
      commands: entries,
      batch: buildMainWorkbenchCommandBatchSummary(entries, batchId),
      verificationRequired: definition.verification,
      note: 'queued does not mean executed; verify command_result or snapshot_delta before final answer.',
    },
  };
}

function sleep(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDefVerifyWaitMs(value, fallback = 8000) {
  const waitMs = Number(value);
  if (!Number.isFinite(waitMs)) return fallback;
  return Math.max(0, Math.min(waitMs, 30000));
}

function readDefCommandResultById(commandId) {
  const queueEntry = readMainWorkbenchCommandQueue().find((entry) => entry.id === commandId);
  if (queueEntry) return queueEntry;
  const raw = readMainWorkbenchJson(MAIN_WORKBENCH_RESULT_LOG_KEY, []);
  const resultLog = Array.isArray(raw) ? raw.map((entry) => normalizeMainWorkbenchCommandEntry(entry)).filter(Boolean) : [];
  return resultLog.find((entry) => entry.id === commandId) || null;
}

async function waitForDefCommandResult(commandId, waitMs) {
  const deadline = Date.now() + normalizeDefVerifyWaitMs(waitMs);
  let entry = readDefCommandResultById(commandId);
  while (entry && (entry.status === 'pending' || entry.status === 'running') && Date.now() < deadline) {
    await sleep(250);
    entry = readDefCommandResultById(commandId);
  }
  return entry;
}

async function buildDefToolCommandVerification(commandEntry, waitMs) {
  const commandId = commandEntry?.id || '';
  const result = commandId ? await waitForDefCommandResult(commandId, waitMs) : null;
  const classified = classifyDefCommandResult(result || commandEntry);
  return {
    commandId,
    pass: classified.resultState === 'applied' || classified.resultState === 'duplicate' || classified.resultState === 'skipped',
    ...classified,
    result: result || commandEntry || null,
  };
}

function readDefWorkNodeById(nodeId) {
  return readRepositoryWorkNode(nodeId);
}

function snapshotButtonCount(snapshot = readMainWorkbenchSnapshotMirror()) {
  return Array.isArray(snapshot?.skillButtons) ? snapshot.skillButtons.length : 0;
}

async function waitForDefSnapshotButtonCount(expectedButtonCount, waitMs) {
  const deadline = Date.now() + normalizeDefVerifyWaitMs(waitMs, 4000);
  let snapshot = readMainWorkbenchSnapshotMirror();
  while (snapshotButtonCount(snapshot) !== expectedButtonCount && Date.now() < deadline) {
    await sleep(250);
    snapshot = readMainWorkbenchSnapshotMirror();
  }
  return snapshot;
}

async function waitForDefDamageReport(waitMs) {
  const deadline = Date.now() + normalizeDefVerifyWaitMs(waitMs, 4000);
  let snapshot = readMainWorkbenchSnapshotMirror();
  while (!snapshot?.damageReport && Date.now() < deadline) {
    await sleep(250);
    snapshot = readMainWorkbenchSnapshotMirror();
  }
  return snapshot;
}

async function executeDefWorkNodeApplyAndVerify(name, input = {}, restore = false) {
  const nodeId = typeof input.nodeId === 'string' && input.nodeId.trim() ? input.nodeId.trim() : '';
  if (!nodeId) {
    return { ok: false, code: 'missing-node-id', message: `${name} requires nodeId.` };
  }
  const node = readDefWorkNodeById(nodeId);
  if (!node) {
    return { ok: false, code: 'ai-worknode-not-found', message: `AI timeline work node not found: ${nodeId}` };
  }
  const before = readMainWorkbenchSnapshotMirror();
  const expectedPayload = restore ? node.basePayload : node.workingPayload;
  const expectedSummary = summarizeTimelinePayload(expectedPayload);
  const definition = getDefToolDefinition(restore ? 'def.worknode.restore_base' : 'def.worknode.checkout');
  const commandInput = {
    ...input,
    nodeId,
    reload: input.reload === true ? true : false,
  };
  const enqueued = enqueueDefToolCommand(definition, commandInput);
  if (enqueued.status < 200 || enqueued.status >= 300 || !enqueued.body?.command) {
    return {
      ok: false,
      nodeId,
      before: { buttonCount: snapshotButtonCount(before) },
      expectedSummary,
      enqueue: enqueued.body,
    };
  }
  const commandVerification = await buildDefToolCommandVerification(enqueued.body.command, input.waitMs);
  const after = commandVerification.pass
    ? await waitForDefSnapshotButtonCount(expectedSummary.buttonCount, input.snapshotWaitMs ?? 5000)
    : readMainWorkbenchSnapshotMirror();
  const snapshotVerification = verifyDefSnapshotDelta(after, {
    expected: { buttonCount: { equals: expectedSummary.buttonCount } },
  });
  const expectedStaffCounts = Object.values(isObject(expectedPayload?.skillButtonTable) ? expectedPayload.skillButtonTable : {})
    .reduce((counts, button) => {
      const staffIndex = Number(button?.staffIndex);
      if (Number.isInteger(staffIndex) && staffIndex >= 0) counts[staffIndex] = (counts[staffIndex] || 0) + 1;
      return counts;
    }, {});
  const actualStaffCounts = (Array.isArray(after?.skillButtons) ? after.skillButtons : [])
    .reduce((counts, button) => {
      const staffIndex = Number(button?.staffIndex);
      if (Number.isInteger(staffIndex) && staffIndex >= 0) counts[staffIndex] = (counts[staffIndex] || 0) + 1;
      return counts;
    }, {});
  const expectedStaffKeys = Object.keys(expectedStaffCounts).sort();
  const actualStaffKeys = Object.keys(actualStaffCounts).sort();
  const staffIndexVerification = {
    pass: expectedStaffKeys.length === actualStaffKeys.length
      && expectedStaffKeys.every((key, index) => key === actualStaffKeys[index] && expectedStaffCounts[key] === actualStaffCounts[key]),
    expected: expectedStaffCounts,
    actual: actualStaffCounts,
  };
  return {
    ok: commandVerification.pass && snapshotVerification.pass && staffIndexVerification.pass,
    nodeId,
    mode: restore ? 'restore_base' : 'checkout',
    command: enqueued.body.command,
    commandVerification,
    before: { buttonCount: snapshotButtonCount(before), snapshotUpdatedAt: before?.updatedAt || null },
    after: { buttonCount: snapshotButtonCount(after), snapshotUpdatedAt: after?.updatedAt || null },
    expectedSummary,
    snapshotVerification,
    staffIndexVerification,
    reload: commandInput.reload,
    note: commandVerification.pass
      ? 'Command reached terminal success state and snapshot was checked.'
      : 'Command was not confirmed within waitMs; do not report applied as complete.',
  };
}

async function executeDefDamageCalculateAndVerify(input = {}) {
  const definition = getDefToolDefinition('def.damage.calculate');
  const before = readMainWorkbenchSnapshotMirror();
  const enqueued = enqueueDefToolCommand(definition, input);
  if (enqueued.status < 200 || enqueued.status >= 300 || !enqueued.body?.command) {
    return {
      ok: false,
      before: {
        snapshotUpdatedAt: before?.updatedAt || null,
        damageGeneratedAt: before?.damageReport?.generatedAt || null,
      },
      enqueue: enqueued.body,
    };
  }
  const commandVerification = await buildDefToolCommandVerification(enqueued.body.command, input.waitMs);
  const after = commandVerification.pass
    ? await waitForDefDamageReport(input.snapshotWaitMs ?? 5000)
    : readMainWorkbenchSnapshotMirror();
  const commandDamageReport = isObject(commandVerification.result?.result)
    ? commandVerification.result.result
    : null;
  const expectedButtonCount = typeof input.buttonId === 'string' && input.buttonId.trim()
    ? (snapshotButtonCount(before) > 0 ? 1 : 0)
    : snapshotButtonCount(before);
  const damageVerification = {
    pass: Boolean(commandDamageReport)
      && Number(commandDamageReport.buttonCount) === expectedButtonCount
      && Boolean(commandDamageReport.generatedAt),
    expectedButtonCount,
    commandButtonCount: Number(commandDamageReport?.buttonCount ?? 0),
    commandGeneratedAt: commandDamageReport?.generatedAt || null,
    snapshotUpdatedAt: after?.updatedAt || null,
    generatedAt: after?.damageReport?.generatedAt || null,
    buttonCount: after?.damageReport?.buttonCount || 0,
    totalExpected: after?.damageReport?.totalExpected ?? null,
  };
  return {
    ok: commandVerification.pass && damageVerification.pass,
    command: enqueued.body.command,
    commandVerification,
    before: {
      snapshotUpdatedAt: before?.updatedAt || null,
      damageGeneratedAt: before?.damageReport?.generatedAt || null,
      buttonCount: snapshotButtonCount(before),
    },
    after: {
      snapshotUpdatedAt: after?.updatedAt || null,
      damageGeneratedAt: after?.damageReport?.generatedAt || null,
      buttonCount: snapshotButtonCount(after),
    },
    damageVerification,
    note: commandVerification.pass
      ? 'Damage command reached terminal success state and damage report was checked.'
      : 'Damage command was not confirmed within waitMs; do not report recalculation as complete.',
  };
}

async function executeDefAddSkillButtonAndVerify(input = {}) {
  const definition = getDefToolDefinition('def.workbench.add_skill_button');
  const before = readMainWorkbenchSnapshotMirror();
  const beforeButtonCount = snapshotButtonCount(before);
  const enqueued = enqueueDefToolCommand(definition, input);
  if (enqueued.status < 200 || enqueued.status >= 300 || !enqueued.body?.command) {
    return {
      ok: false,
      before: { buttonCount: beforeButtonCount, snapshotUpdatedAt: before?.updatedAt || null },
      enqueue: enqueued.body,
    };
  }
  const commandVerification = await buildDefToolCommandVerification(enqueued.body.command, input.waitMs);
  const after = commandVerification.pass
    ? await waitForDefSnapshotButtonCount(beforeButtonCount + 1, input.snapshotWaitMs ?? 5000)
    : readMainWorkbenchSnapshotMirror();
  const afterButtons = Array.isArray(after?.skillButtons) ? after.skillButtons : [];
  const commandResult = isObject(commandVerification.result?.result) ? commandVerification.result.result : null;
  const resultButtonId = typeof commandResult?.buttonId === 'string' ? commandResult.buttonId : '';
  const addedButton = resultButtonId
    ? afterButtons.find((button) => button.id === resultButtonId) || null
    : afterButtons.find((button) => {
      const characterMatched = input.characterId
        ? button.characterId === input.characterId
        : input.characterName
          ? button.characterName === input.characterName
          : true;
      const skillMatched = input.skillType ? button.skillType === input.skillType : true;
      return characterMatched && skillMatched;
    }) || null;
  const snapshotVerification = verifyDefSnapshotDelta(after, {
    expected: { buttonCount: { equals: beforeButtonCount + 1 } },
  });
  return {
    ok: commandVerification.pass && snapshotVerification.pass && Boolean(addedButton),
    command: enqueued.body.command,
    commandVerification,
    before: { buttonCount: beforeButtonCount, snapshotUpdatedAt: before?.updatedAt || null },
    after: { buttonCount: snapshotButtonCount(after), snapshotUpdatedAt: after?.updatedAt || null },
    addedButton: addedButton
      ? {
          id: addedButton.id,
          characterId: addedButton.characterId,
          characterName: addedButton.characterName,
          skillType: addedButton.skillType,
          skillDisplayName: addedButton.skillDisplayName,
          staffIndex: addedButton.staffIndex,
          lineIndex: addedButton.lineIndex,
          nodeIndex: addedButton.nodeIndex,
        }
      : null,
    snapshotVerification,
    note: commandVerification.pass && snapshotVerification.pass && addedButton
      ? 'Add command reached terminal success state and exactly one new mirrored button was checked.'
      : 'Add command or snapshot verification was not confirmed; do not report add as complete.',
  };
}

async function executeDefAddBuffToButtonAndVerify(input = {}) {
  const definition = getDefToolDefinition('def.buff.add_to_button');
  let commandInput = { ...input };
  if (!isObject(commandInput.buff)) {
    const buffQuery = commandInput.buffId || commandInput.buffName || commandInput.name || commandInput.displayName || commandInput.query || '';
    const resolved = resolveDefBuffs({ query: buffQuery });
    const preferredCandidate = resolved.candidates.find((candidate) => (
      candidate.source === 'equipment-library' &&
      isObject(candidate.buff) &&
      (normalizeDefToolText(candidate.sourceName) === normalizeDefToolText(buffQuery) ||
        normalizeDefToolText(candidate.gearSetName) === normalizeDefToolText(buffQuery) ||
        normalizeDefToolText(candidate.displayName).includes(normalizeDefToolText(buffQuery)))
    )) || (resolved.candidates.length === 1 ? resolved.candidates[0] : null);
    if (preferredCandidate && isObject(preferredCandidate.buff)) {
      commandInput = {
        ...commandInput,
        buff: preferredCandidate.buff,
      };
    } else if (buffQuery || commandInput.type || commandInput.value) {
      commandInput = {
        ...commandInput,
        buff: buildDefResolvedBuffObject({
          id: commandInput.buffId || commandInput.id || '',
          name: commandInput.buffName || commandInput.name || commandInput.displayName || buffQuery || '',
          displayName: commandInput.displayName || commandInput.buffName || commandInput.name || buffQuery || '',
          sourceName: commandInput.sourceName || '',
          type: commandInput.type || commandInput.typeKey || '',
          value: commandInput.value,
          category: commandInput.category || 'condition',
          effectKind: commandInput.effectKind || 'modifier',
          source: commandInput.source || 'def-tool-input',
        }),
      };
    }
  }
  const preflightBuff = isObject(commandInput.buff) ? commandInput.buff : {};
  const preflightTargetButtonId = typeof commandInput.buttonId === 'string' ? commandInput.buttonId.trim() : '';
  const preflightNeedle = commandInput.buffId || preflightBuff.id || preflightBuff.displayName || preflightBuff.name || commandInput.name || commandInput.buffName || '';
  if (preflightTargetButtonId && preflightNeedle) {
    const existingVerification = verifyButtonsHaveBuff({
      buttonIds: [preflightTargetButtonId],
      buffName: preflightNeedle,
    });
    if (existingVerification.pass) {
      return {
        ok: true,
        skipped: true,
        reason: 'buff-already-present',
        targetButtonId: preflightTargetButtonId,
        buffNeedle: preflightNeedle,
        buffVerification: existingVerification,
        note: 'Target button already contains the buff; no command was enqueued.',
      };
    }
  }
  const enqueued = enqueueDefToolCommand(definition, commandInput);
  if (enqueued.status < 200 || enqueued.status >= 300 || !enqueued.body?.command) {
    return {
      ok: false,
      enqueue: enqueued.body,
    };
  }
  const commandVerification = await buildDefToolCommandVerification(enqueued.body.command, input.waitMs);
  const commandResult = isObject(commandVerification.result?.result) ? commandVerification.result.result : null;
  const targetButtonId = typeof commandResult?.buttonId === 'string' && commandResult.buttonId.trim()
    ? commandResult.buttonId.trim()
    : typeof input.buttonId === 'string'
      ? input.buttonId.trim()
      : '';
  const buff = isObject(commandInput.buff) ? commandInput.buff : {};
  const buffNeedle = commandInput.buffId || buff.id || buff.displayName || buff.name || commandInput.name || commandInput.buffName || '';
  const buffVerification = await waitForDefButtonsHaveBuff({
    buttonIds: targetButtonId ? [targetButtonId] : [],
    buffName: buffNeedle,
  }, input.snapshotWaitMs ?? 5000);
  return {
    ok: buffVerification.pass,
    command: enqueued.body.command,
    commandVerification,
    targetButtonId,
    buffNeedle,
    buffVerification,
    note: buffVerification.pass
      ? 'Target button contains the buff; final state verification passed.'
      : 'Buff command or verification was not confirmed; do not report add as complete.',
  };
}

function compactOperatorCommandTarget(input = {}) {
  return {
    ...(typeof input.characterId === 'string' && input.characterId.trim() ? { characterId: input.characterId.trim() } : {}),
    ...(typeof input.characterName === 'string' && input.characterName.trim() ? { characterName: input.characterName.trim() } : {}),
  };
}

function normalizeDefToolWeaponPatch(input = {}) {
  const patch = isObject(input.weapon) ? input.weapon : isObject(input.setWeapon) ? input.setWeapon : null;
  if (!patch) return null;
  const weaponName = patch.weaponName || patch.name || patch.weaponId || patch.id;
  if (typeof weaponName !== 'string' || !weaponName.trim()) return null;
  return {
    op: 'setOperatorWeapon',
    ...compactOperatorCommandTarget(input),
    weaponName: weaponName.trim(),
    ...(patch.level !== undefined ? { level: patch.level } : {}),
    ...(typeof patch.potential === 'string' ? { potential: patch.potential } : {}),
    ...(isObject(patch.skillLevels) ? { skillLevels: patch.skillLevels } : {}),
  };
}

function normalizeDefToolEquipmentSelection(selection = {}, input = {}) {
  const normalized = {
    ...(selection.slotKey ? { slotKey: selection.slotKey } : {}),
    ...(selection.part ? { part: selection.part } : {}),
    ...(selection.equipmentId ? { equipmentId: selection.equipmentId } : {}),
    ...(selection.equipmentName || selection.name ? { equipmentName: selection.equipmentName || selection.name } : {}),
    ...(selection.gearSetId ? { gearSetId: selection.gearSetId } : {}),
    ...(selection.gearSetName || selection.setName ? { gearSetName: selection.gearSetName || selection.setName } : {}),
    ...(selection.fillSlots !== undefined ? { fillSlots: selection.fillSlots === true } : {}),
    ...(selection.entryLevel !== undefined ? { entryLevel: selection.entryLevel } : input.entryLevel !== undefined ? { entryLevel: input.entryLevel } : {}),
    ...(selection.entryLevels !== undefined ? { entryLevels: selection.entryLevels } : input.entryLevels !== undefined ? { entryLevels: input.entryLevels } : {}),
  };
  if (!normalized.equipmentId && !normalized.equipmentName && !normalized.gearSetId && !normalized.gearSetName) {
    return null;
  }
  return normalized;
}

function normalizeDefToolEquipmentCommands(input = {}) {
  const rawSelections = [];
  if (Array.isArray(input.equipments)) rawSelections.push(...input.equipments);
  if (Array.isArray(input.equipment)) rawSelections.push(...input.equipment);
  if (isObject(input.equipment)) rawSelections.push(input.equipment);
  if (isObject(input.gear)) rawSelections.push(input.gear);
  if (isObject(input.setEquipment)) rawSelections.push(input.setEquipment);
  if (input.gearSetName || input.gearSetId || input.equipmentName || input.equipmentId) rawSelections.push(input);

  const selections = rawSelections
    .filter(isObject)
    .map((selection) => normalizeDefToolEquipmentSelection(selection, input))
    .filter(Boolean);
  if (!selections.length) return [];

  if (selections.length === 1) {
    return [{
      op: 'setOperatorEquipment',
      ...compactOperatorCommandTarget(input),
      ...selections[0],
    }];
  }
  return [{
    op: 'setOperatorEquipment',
    ...compactOperatorCommandTarget(input),
    equipments: selections,
  }];
}

function buildDefOperatorConfigPatchCommands(input = {}) {
  const commands = [];
  const patchItems = Array.isArray(input.patches) ? input.patches : Array.isArray(input.patch) ? input.patch : [];
  if (patchItems.length) {
    for (const patch of patchItems.filter(isObject)) {
      commands.push(...buildDefOperatorConfigPatchCommands({ ...input, ...patch, patches: undefined, patch: undefined }));
    }
    return commands;
  }
  const weaponCommand = normalizeDefToolWeaponPatch(input);
  if (weaponCommand) commands.push(weaponCommand);
  commands.push(...normalizeDefToolEquipmentCommands(input));
  return commands;
}

function findDefOperatorConfig(input = {}) {
  const snapshot = readMainWorkbenchSnapshotMirror();
  const configs = Array.isArray(snapshot?.operatorConfigs) ? snapshot.operatorConfigs : [];
  const characterId = typeof input.characterId === 'string' && input.characterId.trim() ? input.characterId.trim() : '';
  const characterName = normalizeDefToolText(input.characterName || input.character || '');
  return configs.find((config) => (
    (characterId && config?.characterId === characterId) ||
    (characterName && normalizeDefToolText(config?.characterName).includes(characterName))
  )) || (!characterId && !characterName ? configs[0] : null);
}

function buildDefGearEntryLevelCommands(input = {}) {
  const directSelection = normalizeDefToolEquipmentSelection(input, input);
  if (directSelection) {
    return [{
      op: 'setOperatorEquipment',
      ...compactOperatorCommandTarget(input),
      ...directSelection,
    }];
  }

  const config = findDefOperatorConfig(input);
  if (!config) {
    return failScript(404, 'def-operator-config-not-found', 'No matching operator config found for gear entry level patch.');
  }
  const slotKey = typeof input.slotKey === 'string' && input.slotKey.trim() ? input.slotKey.trim() : '';
  const part = typeof input.part === 'string' && input.part.trim() ? input.part.trim() : '';
  const pieces = (Array.isArray(config.equipment) ? config.equipment : [])
    .filter((piece) => (!slotKey || piece?.slotKey === slotKey) && (!part || piece?.part === part));
  if (!pieces.length) {
    return failScript(404, 'def-gear-piece-not-found', 'No matching equipped gear piece found for entry level patch.');
  }
  return pieces.map((piece) => ({
    op: 'setOperatorEquipment',
    characterId: config.characterId,
    characterName: config.characterName,
    slotKey: piece.slotKey,
    equipmentId: piece.equipmentId,
    ...(input.entryLevel !== undefined ? { entryLevel: input.entryLevel } : {}),
    ...(input.entryLevels !== undefined ? { entryLevels: input.entryLevels } : {}),
  }));
}

function verifyButtonsHaveBuff(input = {}) {
  const buttonIds = Array.isArray(input.buttonIds) ? input.buttonIds.filter((id) => typeof id === 'string' && id.trim()) : [];
  const buffNeedle = normalizeDefToolText(input.buffId || input.buffName || input.name || input.displayName || input.query || '');
  const buttons = listDefWorkbenchButtons({ limit: 200 }).buttons
    .filter((button) => buttonIds.length === 0 || buttonIds.includes(button.buttonId));
  const results = buttons.map((button) => {
    const matchedBuffs = button.selectedBuffs.filter((buff) => {
      const haystack = normalizeDefToolText(`${buff.id} ${buff.name} ${buff.displayName} ${buff.sourceName}`);
      return buffNeedle ? haystack.includes(buffNeedle) : false;
    });
    return {
      buttonId: button.buttonId,
      label: button.label,
      pass: matchedBuffs.length > 0,
      matchedBuffs,
      buffCount: button.buffCount,
    };
  });
  return {
    pass: results.length > 0 && results.every((item) => item.pass),
    checked: results.length,
    missing: results.filter((item) => !item.pass),
    results,
  };
}

async function waitForDefButtonsHaveBuff(input = {}, waitMs = 4000) {
  const deadline = Date.now() + normalizeDefVerifyWaitMs(waitMs, 4000);
  let verification = verifyButtonsHaveBuff(input);
  while (!verification.pass && Date.now() < deadline) {
    await sleep(250);
    verification = verifyButtonsHaveBuff(input);
  }
  return verification;
}

function compareDefExpectedFact(actual, expected, label) {
  if (!isObject(expected)) {
    return actual === expected
      ? { label, pass: true, actual, expected }
      : { label, pass: false, actual, expected };
  }
  if (Object.prototype.hasOwnProperty.call(expected, 'equals') && actual !== expected.equals) {
    return { label, pass: false, actual, expected };
  }
  if (Object.prototype.hasOwnProperty.call(expected, 'min') && !(actual >= expected.min)) {
    return { label, pass: false, actual, expected };
  }
  if (Object.prototype.hasOwnProperty.call(expected, 'max') && !(actual <= expected.max)) {
    return { label, pass: false, actual, expected };
  }
  if (Object.prototype.hasOwnProperty.call(expected, 'notEquals') && actual === expected.notEquals) {
    return { label, pass: false, actual, expected };
  }
  return { label, pass: true, actual, expected };
}

function verifyDefSnapshotDelta(snapshot, input = {}) {
  const facts = {
    snapshotUpdatedAt: snapshot?.updatedAt || null,
    selectedCharacterCount: Array.isArray(snapshot?.selectedCharacters) ? snapshot.selectedCharacters.length : 0,
    buttonCount: Array.isArray(snapshot?.skillButtons) ? snapshot.skillButtons.length : 0,
    damageTotalExpected: snapshot?.damageReport?.totalExpected ?? null,
  };
  const expected = isObject(input.expected) ? input.expected : {};
  const checks = Object.entries(expected)
    .filter(([key]) => Object.prototype.hasOwnProperty.call(facts, key))
    .map(([key, expectation]) => compareDefExpectedFact(facts[key], expectation, key));
  return {
    pass: Boolean(snapshot) && checks.every((check) => check.pass),
    ...facts,
    checks,
  };
}

function classifyDefCommandResult(entryOrBatch) {
  if (!entryOrBatch) return { resultState: 'failed', reason: 'command-not-found' };
  if (entryOrBatch.batchId || Object.prototype.hasOwnProperty.call(entryOrBatch, 'total')) {
    if (entryOrBatch.error > 0) return { resultState: 'failed', reason: 'batch-has-error' };
    if (entryOrBatch.pending > 0 || entryOrBatch.running > 0) return { resultState: 'queued', reason: 'batch-still-running' };
    if (entryOrBatch.done > 0) return { resultState: 'applied', reason: 'batch-done' };
    return { resultState: 'skipped', reason: 'batch-empty' };
  }
  if (entryOrBatch.status === 'error') return { resultState: 'failed', reason: entryOrBatch.error || 'command-error' };
  if (entryOrBatch.status === 'pending' || entryOrBatch.status === 'running') return { resultState: 'queued', reason: `command-${entryOrBatch.status}` };
  if (entryOrBatch.status !== 'done') return { resultState: 'failed', reason: `command-${entryOrBatch.status || 'unknown'}` };
  if (entryOrBatch.result && typeof entryOrBatch.result === 'object') {
    if (entryOrBatch.result.duplicate === true) return { resultState: 'duplicate', reason: 'command-result-duplicate' };
    if (entryOrBatch.result.skipped === true) return { resultState: 'skipped', reason: 'command-result-skipped' };
  }
  return { resultState: 'applied', reason: 'command-done' };
}

async function executeDefTool(name, input = {}, query = new URLSearchParams()) {
  const definition = getDefToolDefinition(name);
  if (!definition) {
    return failScript(404, 'def-tool-not-found', `Unknown DEF tool: ${name}`, {
      availableTools: DEF_TOOL_DEFINITIONS.map((tool) => tool.name),
    });
  }
  if (definition.status === 'planned') {
    return failScript(501, 'def-tool-planned', `DEF tool is planned but not implemented yet: ${name}`, { tool: definition });
  }
  if (definition.commandOp) return enqueueDefToolCommand(definition, input);

  if (name === 'def.operator.config.patch') {
    return enqueueDefToolCommands(definition, buildDefOperatorConfigPatchCommands(input), input);
  }
  if (name === 'def.gear.set_entry_level') {
    const commandsOrResponse = buildDefGearEntryLevelCommands(input);
    if (commandsOrResponse?.status && commandsOrResponse?.body) return commandsOrResponse;
    return enqueueDefToolCommands(definition, commandsOrResponse, input);
  }
  if (name === 'def.worknode.checkout_and_verify') {
    return {
      status: 200,
      body: {
        ok: true,
        protocolVersion: 1,
        tool: name,
        result: await executeDefWorkNodeApplyAndVerify(name, input, false),
      },
    };
  }
  if (name === 'def.worknode.restore_base_and_verify') {
    return {
      status: 200,
      body: {
        ok: true,
        protocolVersion: 1,
        tool: name,
        result: await executeDefWorkNodeApplyAndVerify(name, input, true),
      },
    };
  }
  if (name === 'def.damage.calculate_and_verify') {
    return {
      status: 200,
      body: {
        ok: true,
        protocolVersion: 1,
        tool: name,
        result: await executeDefDamageCalculateAndVerify(input),
      },
    };
  }
  if (name === 'def.workbench.add_skill_button_and_verify') {
    return {
      status: 200,
      body: {
        ok: true,
        protocolVersion: 1,
        tool: name,
        result: await executeDefAddSkillButtonAndVerify(input),
      },
    };
  }
  if (name === 'def.buff.add_to_button_and_verify') {
    return {
      status: 200,
      body: {
        ok: true,
        protocolVersion: 1,
        tool: name,
        result: await executeDefAddBuffToButtonAndVerify(input),
      },
    };
  }
  const snapshot = readMainWorkbenchSnapshotMirror();
  let result = null;
  if (name === 'def.tool.list') {
    result = { tools: DEF_TOOL_DEFINITIONS };
  } else if (name === 'def.tool.describe') {
    const targetName = input.name || input.tool || query.get('name') || '';
    result = { tool: getDefToolDefinition(targetName) };
    if (!result.tool) return failScript(404, 'def-tool-not-found', `Unknown DEF tool: ${targetName}`);
  } else if (name === 'def.workbench.snapshot') {
    result = { snapshot };
  } else if (name === 'def.workbench.evidence') {
    result = buildMainWorkbenchEvidence(snapshot, {
      prompt: input.prompt || input.query || '',
      previousButtonId: input.previousButtonId || '',
    });
  } else if (name === 'def.workbench.list_buttons' || name === 'def.workbench.find_buttons') {
    result = listDefWorkbenchButtons(input);
  } else if (name === 'def.workbench.list_characters') {
    result = listDefWorkbenchCharacters();
  } else if (name === 'def.workbench.damage_report') {
    result = { snapshotUpdatedAt: snapshot?.updatedAt || null, damageReport: snapshot?.damageReport || null };
  } else if (name === 'def.character.resolve') {
    result = resolveDefCharacters(input);
  } else if (name === 'def.skill.resolve') {
    result = resolveDefSkills(input);
  } else if (name === 'def.buff.resolve' || name === 'def.buff.search_candidates') {
    result = resolveDefBuffs(input);
  } else if (name === 'def.equipment.resolve' || name === 'def.gear.resolve') {
    result = resolveDefEquipment(input);
  } else if (name === 'def.weapon.resolve') {
    const characters = listDefWorkbenchCharacters().characters;
    const queryText = normalizeDefToolText(input.query || input.name || input.text || '');
    result = {
      query: queryText,
      candidates: characters
        .filter((character) => character.weapon && (!queryText || normalizeDefToolText(`${character.name} ${character.weapon.name} ${character.weapon.id}`).includes(queryText)))
        .map((character) => ({ characterName: character.name, ...character.weapon, confidence: normalizeDefToolText(character.weapon?.name) === queryText ? 1 : 0.7 })),
    };
    result.ambiguity = result.candidates.length !== 1;
  } else if (name === 'def.operator.config.read') {
    result = { snapshotUpdatedAt: snapshot?.updatedAt || null, operatorConfigs: snapshot?.operatorConfigs || [] };
  } else if (name === 'def.user.ask') {
    result = createDefUserQuestion(input);
  } else if (name === 'def.approval.request') {
    result = createDefApprovalRequest(input);
  } else if (name === 'def.approval.record_decision') {
    result = recordDefApprovalDecision(input);
  } else if (name === 'def.worknode.patch_and_validate' || name === 'def.worknode.copy_staff_line_and_verify') {
    result = name === 'def.worknode.copy_staff_line_and_verify'
      ? copyDefWorkNodeStaffLineAndValidate(input)
      : applyDefWorkNodePatchAndValidate(input);
    if (result.ok && result.checkout === true && result.dryRun !== true && !result.checkoutDecision?.requiresManualApproval) {
      const applied = await executeDefWorkNodeApplyAndVerify('def.worknode.checkout_and_verify', {
        nodeId: result.nodeId,
        reload: false,
        waitMs: input.waitMs ?? 20000,
        snapshotWaitMs: input.snapshotWaitMs ?? 8000,
      }, false);
      result = {
        ...result,
        checkout: applied,
        currentCheckoutTouched: applied.ok === true,
        completedSteps: [...(result.completedSteps || []), 'checkout', 'verify'],
        nextActions: applied.ok ? [] : ['Checkout command was not confirmed; report the pending/error state without retrying automatically.'],
      };
    }
  } else if (name === 'def.worknode.read') {
    result = readDefWorkNode(input);
  } else if (name === 'def.worknode.validate') {
    result = validateDefWorkNode(input);
  } else if (name === 'def.verify.command_result') {
    const commandId = typeof input.commandId === 'string' ? input.commandId : '';
    const batchId = normalizeMainWorkbenchBatchId(input.batchId);
    const commands = readMainWorkbenchCommandQueue();
    result = batchId
      ? buildMainWorkbenchCommandBatchSummary(commands, batchId)
      : commands.find((entry) => entry.id === commandId) || null;
    const classified = classifyDefCommandResult(result);
    result = {
      pass: classified.resultState === 'applied' || classified.resultState === 'duplicate' || classified.resultState === 'skipped',
      ...classified,
      result,
    };
  } else if (name === 'def.verify.snapshot_delta') {
    result = verifyDefSnapshotDelta(snapshot, input);
  } else if (name === 'def.verify.buttons_have_buff') {
    result = verifyButtonsHaveBuff(input);
  } else if (name === 'def.verify.damage_recalculated') {
    result = {
      pass: Boolean(snapshot?.damageReport),
      snapshotUpdatedAt: snapshot?.updatedAt || null,
      generatedAt: snapshot?.damageReport?.generatedAt || null,
      buttonCount: snapshot?.damageReport?.buttonCount || 0,
      totalExpected: snapshot?.damageReport?.totalExpected ?? null,
    };
  } else if (name === 'def.verify.worknode_diff_clean') {
    result = verifyDefWorkNodeDiffClean(input);
  }

  if (result === null) {
    return failScript(500, 'def-tool-unhandled', `DEF tool has no executor: ${name}`);
  }
  return {
    status: 200,
    body: {
      ok: true,
      protocolVersion: 1,
      tool: name,
      result,
    },
  };
}

async function handleDefToolRequest(method, pathname, query, body) {
  if (method === 'GET' && (pathname === '/api/def-tools' || pathname === '/api/def-tools/list')) {
    return await executeDefTool('def.tool.list', {}, query);
  }
  if (method === 'GET' && pathname === '/api/def-tools/governance') {
    const archive = readDefToolGovernanceArchive();
    const limit = Math.max(1, Math.min(Number(query.get('limit') || 20) || 20, 100));
    const since = Number(query.get('since') || 0) || 0;
    const questions = archive.questions
      .filter((item) => !since || (item?.createdAt || 0) >= since || (item?.decidedAt || 0) >= since)
      .slice(0, limit);
    const approvals = archive.approvals
      .filter((item) => !since || (item?.createdAt || 0) >= since || (item?.decidedAt || 0) >= since)
      .slice(0, limit);
    return {
      status: 200,
      body: {
        ok: true,
        protocolVersion: 1,
        path: defToolGovernancePath,
        questions,
        approvals,
        latestAt: Math.max(
          0,
          ...questions.map((item) => item?.createdAt || item?.decidedAt || 0),
          ...approvals.map((item) => item?.createdAt || item?.decidedAt || 0),
        ),
      },
    };
  }
  if (method === 'GET' && pathname === '/api/def-tools/describe') {
    return await executeDefTool('def.tool.describe', { name: query.get('name') || '' }, query);
  }
  const callMatch = /^\/api\/def-tools\/([^/]+)\/call$/.exec(pathname);
  if (method === 'POST' && callMatch) {
    const name = decodeURIComponent(callMatch[1]);
    const input = body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'input') ? body.input : body;
    return await executeDefTool(name, input || {}, query);
  }
  if (method === 'POST' && pathname === '/api/def-tools/call') {
    const name = typeof body?.tool === 'string' ? body.tool : typeof body?.name === 'string' ? body.name : '';
    return await executeDefTool(name, body?.input || {}, query);
  }
  return null;
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
    if (!snapshot || typeof snapshot !== 'object'
      || !Array.isArray(snapshot.selectedCharacters)
      || !Array.isArray(snapshot.skillButtons)) {
      return failScript(400, 'invalid-main-workbench-snapshot', 'Snapshot requires selectedCharacters and skillButtons arrays.');
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
    const batchId = normalizeMainWorkbenchBatchId(query.get('batchId'));
    const commands = readMainWorkbenchCommandQueue()
      .filter((entry) => !status || entry.status === status)
      .filter((entry) => !batchId || entry.batchId === batchId);
    return {
      status: 200,
      body: {
        ok: true,
        protocolVersion: 1,
        commands,
      },
    };
  }

  if (method === 'GET' && pathname === '/api/main-workbench/commands/batch') {
    const batchId = normalizeMainWorkbenchBatchId(query.get('batchId'));
    if (!batchId) {
      return failScript(400, 'missing-main-workbench-batch-id', 'Batch summary requires batchId.');
    }
    const commands = readMainWorkbenchCommandQueue();
    return {
      status: 200,
      body: {
        ok: true,
        protocolVersion: 1,
        batch: buildMainWorkbenchCommandBatchSummary(commands, batchId),
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
    const requestedBatchId = normalizeMainWorkbenchBatchId(body?.batchId);
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
        ...(requestedBatchId ? { batchId: requestedBatchId, batchIndex: 0, batchSize: 1 } : {}),
      });
      writeMainWorkbenchCommandQueue([...queue, entry]);
      broadcastMainWorkbenchCommands([entry]);
      return {
        status: 200,
        body: {
          ok: true,
          protocolVersion: 1,
          command: entry,
          commands: [entry],
          ...(requestedBatchId ? { batch: buildMainWorkbenchCommandBatchSummary([entry], requestedBatchId) } : {}),
        },
      };
    }
    const batchId = requestedBatchId || makeMainWorkbenchBatchId();
    const batchSize = commands.length;
    const entries = commands.map((command, index) => normalizeMainWorkbenchCommandEntry({
      id: makeMainWorkbenchCommandId(),
      command,
      source,
      status: 'pending',
      batchId,
      batchIndex: index,
      batchSize,
    }));
    writeMainWorkbenchCommandQueue([...queue, ...entries]);
    broadcastMainWorkbenchCommands(entries);
    return {
      status: 200,
      body: {
        ok: true,
        protocolVersion: 1,
        batchId,
        commands: entries,
        batch: buildMainWorkbenchCommandBatchSummary(entries, batchId),
      },
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
const mainWorkbenchCommandSseClients = new Set();

function writeSse(response, eventName, payload) {
  try {
    response.write(`event: ${eventName}\n`);
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

function broadcastMainWorkbenchCommands(commands) {
  const payload = { ok: true, protocolVersion: 1, commands };
  for (const client of Array.from(mainWorkbenchCommandSseClients)) {
    if (!writeSse(client, 'main-workbench.commands', payload)) {
      mainWorkbenchCommandSseClients.delete(client);
    }
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
  for (const client of mainWorkbenchCommandSseClients) {
    if (!writeSse(client, 'heartbeat', { ok: true, now: Date.now() })) {
      mainWorkbenchCommandSseClients.delete(client);
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
      defToolGovernancePath,
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

  if (method === 'GET' && requestUrl.pathname === '/api/main-workbench/commands/events') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    response.write(': connected\n\n');
    mainWorkbenchCommandSseClients.add(response);
    writeSse(response, 'main-workbench.commands', {
      ok: true,
      protocolVersion: 1,
      commands: readMainWorkbenchCommandQueue().filter((entry) => entry.status === 'pending'),
    });
    request.on('close', () => {
      mainWorkbenchCommandSseClients.delete(response);
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

    const timelineRepositoryResponse = handleTimelineRepositoryRequest(method, requestUrl.pathname, requestUrl.searchParams, body);
    if (timelineRepositoryResponse) {
      writeJson(response, timelineRepositoryResponse.status, timelineRepositoryResponse.body);
      return;
    }

    const defToolResponse = await handleDefToolRequest(method, requestUrl.pathname, requestUrl.searchParams, body);
    if (defToolResponse) {
      writeJson(response, defToolResponse.status, defToolResponse.body);
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
