import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import Fuse from 'fuse.js';
import { pinyin } from 'pinyin-pro';
import { buildMainWorkbenchEvidence } from '../src/agentKernel/mainWorkbench/evidenceRuntime.mjs';
import {
  MAIN_WORKBENCH_SUPPORTED_OPS,
  normalizeMainWorkbenchCommand,
  validateMainWorkbenchCommand,
} from '../src/agentKernel/mainWorkbench/commandSchemaRuntime.mjs';
import { buildAiTimelineCheckoutDecision } from '../src/agentKernel/timelineWorktree/checkoutDecision.mjs';
import {
  buildDefToolRouteMap,
  createDefToolRegistry,
  DEF_PROJECTION_ACCESS,
  DEF_WORKSPACE_SCOPE,
  resolveDefToolAccessPolicy,
} from '../agent/runtime/def-tools/registry.mjs';
import { DEF_TOOL_DEFINITION_BASE } from '../agent/runtime/def-tools/definitions.mjs';
import { matchesAtomicTeamCandidateCapability, prepareAtomicTeamCandidate } from '../agent/runtime/def-tools/atomic-team-candidate.mjs';
import { assessAtomicRollbackConvergence, assessAtomicRollbackPrecondition } from '../agent/runtime/def-tools/atomic-team-rollback.mjs';
import { observeAtomicTeamApplyCommand } from '../agent/runtime/def-tools/atomic-team-command-state.mjs';
import {
  computeDefNodeSourceRisk,
  hashDefNodeValue,
  rebuildDefNodePayload,
  validateDefTimelinePayload,
} from '../agent/runtime/def-node-workspace/codec.mjs';
import { compareDefTimelineInvariants } from '../agent/runtime/def-node-workspace/timeline-invariant.mjs';
import workNodeStoreModule from '../electron/ai-timeline-work-node-store.cjs';
import timelineRepositoryModule from '../electron/timeline-repository.cjs';
import dataManagementServiceModule from '../electron/data-management-service.cjs';
import { createDefCoreRuntimeComposition } from './def-core/runtime-composition.mjs';
import { createDefCoreRequestRouter } from './def-core/request-router.mjs';
import { createDefCoreTransportState } from './def-core/transport-state.mjs';
import { createDefCoreRuntimeState, createDefRawTransportPolicy } from './def-core/runtime-state.mjs';
import { createDefCoreToolRegistry } from './def-core/tool-registry.mjs';

const { createAiTimelineWorkNodeStore } = workNodeStoreModule;
const { createTimelineRepository } = timelineRepositoryModule;
const { createDataManagementService } = dataManagementServiceModule;

const HOST = '127.0.0.1';
const PORT = Number(process.env.AI_CLI_REST_PORT || 17321);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const storageDir = process.env.AI_CLI_REST_STORAGE_DIR
  || path.join(projectRoot, '.runtime', 'ai-cli-rest');
const agentScriptDir = process.env.DEF_AGENT_SCRIPT_DIR
  || path.join(projectRoot, '.runtime', 'def-agent', 'scripts');
const viteCacheDir = process.env.AI_CLI_REST_VITE_CACHE_DIR || path.join(projectRoot, '.runtime', 'vite-ai-cli-rest', String(process.pid));
const nowStoragePath = process.env.AI_CLI_NOW_STORAGE_PATH
  || path.join(projectRoot, 'data', 'localdata', 'now-storage.json');
const aiTimelineWorkNodesPath = process.env.AI_TIMELINE_WORK_NODE_DB_PATH
  || path.join(projectRoot, 'data', 'localdata', 'ai-timeline-worknodes.sqlite3');
const legacyAiTimelineWorkNodesPath = process.env.AI_TIMELINE_WORK_NODE_LEGACY_PATH
  || path.join(projectRoot, 'data', 'localdata', 'ai-timeline-worknodes.json');
const timelineRepositoryPath = process.env.TIMELINE_REPOSITORY_DB_PATH
  || path.join(projectRoot, 'data', 'localdata', 'timeline-repository.sqlite3');
const dataManagementRuntimeRoot = process.env.DATA_MANAGEMENT_RUNTIME_ROOT
  || path.join(projectRoot, 'data');
const defToolGovernancePath = process.env.DEF_TOOL_GOVERNANCE_PATH
  || path.join(projectRoot, 'data', 'localdata', 'def-tool-governance.json');
const storageMode = process.env.AI_CLI_REST_STORAGE_MODE || 'now-storage';
const legacyFillServiceUrl = process.env.LEGACY_FILL_SERVICE_URL || 'http://127.0.0.1:17323';
const legacyFillCompatibilityProxyEnabled = process.env.LEGACY_FILL_COMPAT_PROXY_ENABLED !== '0';
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
const MAIN_WORKBENCH_TRANSIENT_STORAGE_KEYS = new Set([
  MAIN_WORKBENCH_COMMAND_QUEUE_KEY,
  MAIN_WORKBENCH_RESULT_LOG_KEY,
  MAIN_WORKBENCH_SNAPSHOT_KEY,
]);
const EQUIPMENT_LIBRARY_STORAGE_KEY = 'def.equipment-sheet.library.v1';
const EQUIPMENT_DRAFT_STORAGE_KEY = 'def.equipment-sheet.draft.v1';
const OPERATOR_CATALOG_STORAGE_KEY = 'def.operator-editor.library.v1';
const WEAPON_LIBRARY_STORAGE_KEY = 'def.weapon-sheet.library.v1';
const DEF_NATIVE_CATALOG_ARTIFACT_CONTRACT = 'DefNativeCatalogArtifactV1';
const DEF_EQUIPMENT_THREE_PLUS_ONE_FACTS_CONTRACT = 'DefEquipmentThreePlusOneFactsV1';
const DEF_NATIVE_CATALOG_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const GAME_KNOWLEDGE_JSON_PATH = path.join(projectRoot, 'src', 'data', 'gameKnowledge.json');
const GAME_KNOWLEDGE_REFERENCES_DIR = path.join(projectRoot, 'agent', 'runtime', 'def', 'skills', 'game-knowledge', 'references');
const GAME_KNOWLEDGE_LOADOUT_MANIFESTS_DIR = path.join(projectRoot, 'agent', 'runtime', 'def', 'skills', 'game-knowledge', 'loadout-plans');
const MAIN_WORKBENCH_SUPPORTED_OP_SET = new Set(MAIN_WORKBENCH_SUPPORTED_OPS);
const DEF_GRID_NODE_COUNT = 15;
// Ephemeral, unforgeable capability for a reviewed operator-config branch.
// A sidecar restart invalidates it safely; callers must build a fresh preview.
const defCoreState = createDefCoreRuntimeState({
  governanceToken: process.env.DEF_INTERNAL_GOVERNANCE_TOKEN,
});
const {
  preparedOperatorConfigCapabilities,
  approvedApplyCapabilities,
  guideLoadoutPlanSources,
  preparedTeamLoadoutPlans,
  preparedOperatorConfigTtlMs: PREPARED_OPERATOR_CONFIG_TTL_MS,
  preparedTeamLoadoutTtlMs: PREPARED_TEAM_LOADOUT_TTL_MS,
  preparedTeamLoadoutApprovalGraceMs: PREPARED_TEAM_LOADOUT_APPROVAL_GRACE_MS,
  governanceToken: defInternalGovernanceToken,
  internalRawTransport: INTERNAL_RAW_TRANSPORT,
} = defCoreState;
// The model-facing materializer only runs through a session created by the
// native host.  This map is intentionally sidecar-ephemeral: a restart makes
// old capabilities fail closed until the host recovery route registers again.
const registeredDefNativeCatalogSessions = new Map();

function normalizeDefNativeCatalogSessionId(value) {
  const sessionId = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{2,239}$/.test(sessionId) ? sessionId : '';
}

function pruneRegisteredDefNativeCatalogSessions(now = Date.now()) {
  for (const [sessionId, registration] of registeredDefNativeCatalogSessions) {
    if (!registration || registration.expiresAt <= now) registeredDefNativeCatalogSessions.delete(sessionId);
  }
}

function registerDefNativeCatalogSession(input = {}) {
  const sessionId = normalizeDefNativeCatalogSessionId(input.sessionId || input.__defSessionId);
  if (!sessionId) return null;
  const host = input.host === 'workbench' ? 'workbench' : input.host === 'ai-cli' ? 'ai-cli' : '';
  if (!host) return null;
  const registeredAt = Date.now();
  const registration = { sessionId, host, registeredAt, expiresAt: registeredAt + DEF_NATIVE_CATALOG_SESSION_TTL_MS };
  registeredDefNativeCatalogSessions.set(sessionId, registration);
  return registration;
}

function resolveRegisteredDefNativeCatalogSession(value) {
  pruneRegisteredDefNativeCatalogSessions();
  const sessionId = normalizeDefNativeCatalogSessionId(value);
  return sessionId ? registeredDefNativeCatalogSessions.get(sessionId) || null : null;
}

// A native catalog artifact is intentionally sidecar-ephemeral, but a
// Workbench session binding is durable SQLite authority.  When the sidecar is
// restarted while Electron and OpenCode remain alive, the native plugin has
// already proved the internal governance token and can present its exact
// session id again.  Recover only a live, non-temporary Workbench binding;
// never infer a host from a user supplied id or grant this recovery to an
// unauthenticated loopback caller.
function restoreRegisteredDefNativeCatalogSession(input = {}, invocation = {}) {
  const sessionId = typeof input.__defSessionId === 'string' ? input.__defSessionId.trim() : '';
  const existing = resolveRegisteredDefNativeCatalogSession(sessionId);
  if (existing) return existing;
  if (!sessionId || !defInternalGovernanceToken || invocation.internalToken !== defInternalGovernanceToken) return null;
  const binding = getTimelineRepository().getSessionAxisBindingBySession('workbench', sessionId);
  const document = binding ? getTimelineRepository().getDocument(binding.timelineId) : null;
  if (!binding || binding.host !== 'workbench' || !document || document.archivedAt || document.isTemporary) return null;
  return registerDefNativeCatalogSession({ sessionId, host: 'workbench' });
}

function consumeApprovedApplyCapability(input = {}, expected = {}) {
  const token = typeof input.approvalCapability === 'string' ? input.approvalCapability : '';
  const capability = approvedApplyCapabilities.get(token);
  if (!capability || capability.used || capability.expiresAt <= Date.now()) return false;
  if (Object.entries(expected).some(([key, value]) => value !== undefined && capability[key] !== value)) return false;
  capability.used = true;
  return true;
}
// Guide reads are deliberately session-scoped and in-memory. They are an
// opaque hand-off between two native turns, never a filesystem capability or
// a cross-session recommendation cache.
// A native permission card can remain open longer than the short planning
// TTL.  Once that exact immutable plan has produced its one review card, keep
// only its server-side capability alive for a bounded grace period so approval
// cannot turn into a spurious plan-not-found race.  The reservation is still
// session-bound, sidecar-ephemeral, and consumed by the first apply attempt.
// Raw repository, Work Node and projection endpoints are renderer/native
// transport, never a model-facing REST surface.  Keep the marker distinct
// from the typed-tool policy: internal calls inside this process use the
// opaque object; HTTP callers must prove possession of the native token.
const defRawTransportPolicy = createDefRawTransportPolicy({
  governanceToken: defInternalGovernanceToken,
  fail: failScript,
});
const rawTransportAuthorized = defRawTransportPolicy.authorized;
const denyRawTransport = defRawTransportPolicy.deny;

function hashDefLoadoutPlan(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function prunePreparedOperatorConfigCapabilities() {
  const now = Date.now();
  for (const [token, prepared] of preparedOperatorConfigCapabilities) {
    if (prepared.expiresAt <= now) preparedOperatorConfigCapabilities.delete(token);
  }
}

function pruneDefTeamLoadoutPlans() {
  const now = Date.now();
  for (const [sessionId, source] of guideLoadoutPlanSources) {
    if (source.expiresAt <= now) guideLoadoutPlanSources.delete(sessionId);
  }
  for (const [planHash, prepared] of preparedTeamLoadoutPlans) {
    const approvalReservationActive = Number(prepared.approvalExpiresAt) > now;
    if (prepared.expiresAt <= now && !approvalReservationActive && !prepared.usedResult && !prepared.pendingCommand) preparedTeamLoadoutPlans.delete(planHash);
  }
}

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
    this.archiveFingerprint = null;
    this.archive = this.readArchive();
    this.transient = new Map();
  }

  fingerprint() {
    try {
      const stat = fs.statSync(this.filePath);
      return `${stat.size}:${stat.mtimeMs}`;
    } catch {
      return null;
    }
  }

  readArchive() {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.archiveFingerprint = null;
        return null;
      }
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      this.archiveFingerprint = this.fingerprint();
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
      this.archiveFingerprint = this.fingerprint();
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
    this.archiveFingerprint = this.fingerprint();
  }

  get local() {
    return this.archive?.storage?.local || {};
  }

  refresh() {
    if (this.fingerprint() === this.archiveFingerprint) return;
    const nextArchive = this.readArchive();
    this.archive = nextArchive;
  }

  getItem(key) {
    if (MAIN_WORKBENCH_TRANSIENT_STORAGE_KEYS.has(key)) {
      return this.transient.has(key) ? this.transient.get(key) : null;
    }
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

  getSessionItem(key) {
    this.refresh();
    if (!this.archive || !Object.prototype.hasOwnProperty.call(this.archive.storage.session, key)) {
      return null;
    }
    const value = this.archive.storage.session[key];
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  setItem(key, value) {
    if (MAIN_WORKBENCH_TRANSIENT_STORAGE_KEYS.has(key)) {
      this.transient.set(key, String(value));
      return;
    }
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
    if (MAIN_WORKBENCH_TRANSIENT_STORAGE_KEYS.has(key)) {
      this.transient.delete(key);
      return;
    }
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
    'Access-Control-Allow-Headers': 'Content-Type, X-Def-Internal-Token',
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

function isLegacyFillCompatibilityRoute(method, pathname, body) {
  if (/^\/api\/(buff|weapon|operator|equipment)\/(current|library(?:\/[^/]+)?|fill\/(template|check|apply))$/.test(pathname)) return true;
  if (method === 'GET' && pathname === '/api/ai-cli/spec') return true;
  if (method === 'POST' && pathname === '/api/ai-cli/run' && typeof body?.command === 'string') {
    return /^(proposal\.(list|show|clear|approve|reject|save|unsave)|y|n)(?:\s|$)/i.test(body.command.trim());
  }
  return false;
}

async function proxyLegacyFillCompatibilityRequest(method, requestUrl, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${legacyFillServiceUrl}${requestUrl.pathname}${requestUrl.search}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json; charset=utf-8' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    return { status: response.status, body: await response.json() };
  } catch (error) {
    return failScript(503, 'legacy-fill-service-unavailable', error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
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
    label: `${item.characterName}-${item.skillDisplayName || item.skillType}@${(item.nodeIndex ?? 0) + 1}-${(item.lineIndex ?? item.staffIndex ?? 0) + 1}`,
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
      label: `${button.characterName}-${button.skillDisplayName || button.skillType}@${(button.nodeIndex ?? 0) + 1}-${(button.lineIndex ?? button.staffIndex ?? 0) + 1}`,
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

const defCoreRuntime = createDefCoreRuntimeComposition({
  createAiTimelineWorkNodeStore,
  createTimelineRepository,
  createDataManagementService,
  aiTimelineWorkNodesPath,
  legacyAiTimelineWorkNodesPath,
  timelineRepositoryPath,
  dataManagementRuntimeRoot,
  builtinCatalogPath: path.join(projectRoot, 'public', 'data', 'catalog.sqlite'),
});
const {
  getAiTimelineWorkNodeStore,
  getTimelineRepository,
  getDataManagementService,
} = defCoreRuntime;

function mirrorWorkNodeToTimelineRepository(node) {
  if (!node || node.saveId?.startsWith('timeline-snapshot-') || /^\[snapshot\]/i.test(node.label || '')) return;
  const timelineId = node.timelineId || node.saveId || 'current-main-workbench';
  const repository = getTimelineRepository();
  repository.ensureDocument({ id: timelineId, label: '主排轴', preserveExistingLabel: true });
  // Legacy nodes can predate the repository migration. Importing a new child
  // must first repair any missing ancestry, otherwise SQLite rejects the child
  // foreign key and the two stores diverge again.  Do not stop at an existing
  // node: this function is also the compatibility projection's update path.
  const visiting = new Set();
  const mirrorOne = (candidate) => {
    if (!candidate || visiting.has(candidate.id)) return;
    visiting.add(candidate.id);
    if (candidate.parentNodeId && !repository.getWorkNode(candidate.parentNodeId)) {
      mirrorOne(getAiTimelineWorkNodeStore().getNode(candidate.parentNodeId));
    }
    repository.importWorkNode({ ...candidate, timelineId });
    visiting.delete(candidate.id);
  };
  mirrorOne(node);
}

function mirrorWorkNodeCommitToTimelineRepository(commit) {
  if (!commit) return null;
  return getTimelineRepository().importWorkNodeCommit({
    ...commit,
    timelineId: commit.timelineId || commit.saveId || 'current-main-workbench',
  });
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

function listRepositoryWorkNodeCommits() {
  return getTimelineRepository().listDocuments()
    .flatMap((document) => getTimelineRepository().listWorkNodeCommits(document.id)
      .map((commit) => ({ ...commit, saveId: commit.timelineId })));
}

function shouldWriteLegacyWorkNodeProjection() {
  if (process.env.AI_TIMELINE_DISABLE_LEGACY_PROJECTION === '1') return false;
  const migrationRaw = getTimelineRepository().getMeta('legacy_work_node_migration_v1');
  try {
    if (migrationRaw && JSON.parse(migrationRaw)?.complete === true) return false;
  } catch {
    // An invalid marker is not completion evidence.
  }
  const archive = getAiTimelineWorkNodeStore().list();
  return archive.nodes.length > 0 || archive.commits.length > 0;
}

function writeLegacyNodeProjection(node) {
  if (shouldWriteLegacyWorkNodeProjection()) getAiTimelineWorkNodeStore().saveNode(node);
}

function writeLegacyNodeCommitProjection(node, commit, options) {
  if (shouldWriteLegacyWorkNodeProjection()) getAiTimelineWorkNodeStore().saveNodeAndCommit(node, commit, options);
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
  if (!isObject(payload.characterInputMap)) {
    return `${fieldName}.characterInputMap must be an object.`;
  }
  if (!isObject(payload.operatorConfigPageCache)) {
    return `${fieldName}.operatorConfigPageCache must be an object.`;
  }
  return null;
}

const DEF_CHARACTER_INPUT_EQUIPMENT_KEYS = new Set([
  'strength', 'agility', 'intelligence', 'will', 'mainStatBoost', 'subStatBoost', 'allStatBoost',
  'flatAtk', 'atkPercentBoost', 'critRateBoost', 'critDmgBonusBoost', 'defense', 'hp',
  'physicalDmgBonus', 'fireDmgBonus', 'electricDmgBonus', 'iceDmgBonus', 'natureDmgBonus',
  'magicDmgBonus', 'skillDmgBonus', 'chainSkillDmgBonus', 'ultimateDmgBonus', 'normalAttackDmgBonus',
  'dotDmgBonus', 'imbalanceDmgBonus', 'sourceSkillBoost', 'allSkillDmgBonus', 'allDmgBonus',
]);
const DEF_CHARACTER_INPUT_KEYS = new Set(['potential', 'skillLevels', 'weapon', 'equipment']);
const DEF_CHARACTER_SKILL_KEYS = new Set(['A', 'B', 'E', 'Q', 'Dot']);
const DEF_CHARACTER_WEAPON_KEYS = new Set(['name', 'potentialMode']);
const DEF_OPERATOR_CONFIG_SNAPSHOT_KEYS = new Set(['panel', 'operator', 'weapon', 'equipment', 'buff', 'detailMarkdown']);

function validateDefObjectKeys(value, allowedKeys, path, issues) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push({
        code: 'unknown-operator-config-field',
        message: `${path}.${key} is not part of the DEF operator configuration schema.`,
        path: `${path}.${key}`,
      });
    }
  }
}

function validateDefCharacterInputMap(value, path, issues) {
  if (!isObject(value)) {
    issues.push({ code: 'invalid-character-input-map', message: `${path} must be an object.`, path });
    return;
  }
  for (const [characterId, config] of Object.entries(value)) {
    const configPath = `${path}.${characterId}`;
    if (!characterId.trim() || !isObject(config)) {
      issues.push({ code: 'invalid-character-input-config', message: `${configPath} must be a non-empty id mapped to an object.`, path: configPath });
      continue;
    }
    validateDefObjectKeys(config, DEF_CHARACTER_INPUT_KEYS, configPath, issues);
    if (config.potential !== '0潜' && config.potential !== '满潜') {
      issues.push({ code: 'invalid-character-input-potential', message: `${configPath}.potential must be 0潜 or 满潜.`, path: `${configPath}.potential` });
    }
    if (!isObject(config.skillLevels)) {
      issues.push({ code: 'invalid-character-input-skill-levels', message: `${configPath}.skillLevels must be an object.`, path: `${configPath}.skillLevels` });
    } else {
      validateDefObjectKeys(config.skillLevels, DEF_CHARACTER_SKILL_KEYS, `${configPath}.skillLevels`, issues);
      for (const key of DEF_CHARACTER_SKILL_KEYS) {
        if (config.skillLevels[key] !== 'L9' && config.skillLevels[key] !== 'M3') {
          issues.push({ code: 'invalid-character-input-skill-level', message: `${configPath}.skillLevels.${key} must be L9 or M3.`, path: `${configPath}.skillLevels.${key}` });
        }
      }
    }
    if (!isObject(config.weapon)) {
      issues.push({ code: 'invalid-character-input-weapon', message: `${configPath}.weapon must be an object.`, path: `${configPath}.weapon` });
    } else {
      validateDefObjectKeys(config.weapon, DEF_CHARACTER_WEAPON_KEYS, `${configPath}.weapon`, issues);
      if (typeof config.weapon.name !== 'string' || !config.weapon.name.trim()) {
        issues.push({ code: 'invalid-character-input-weapon-name', message: `${configPath}.weapon.name must be a non-empty string.`, path: `${configPath}.weapon.name` });
      }
      if (config.weapon.potentialMode !== 'P0' && config.weapon.potentialMode !== 'PMAX') {
        issues.push({ code: 'invalid-character-input-weapon-potential', message: `${configPath}.weapon.potentialMode must be P0 or PMAX.`, path: `${configPath}.weapon.potentialMode` });
      }
    }
    if (!isObject(config.equipment)) {
      issues.push({ code: 'invalid-character-input-equipment', message: `${configPath}.equipment must be an object.`, path: `${configPath}.equipment` });
    } else {
      validateDefObjectKeys(config.equipment, DEF_CHARACTER_INPUT_EQUIPMENT_KEYS, `${configPath}.equipment`, issues);
      for (const [key, equipmentValue] of Object.entries(config.equipment)) {
        if (!Number.isFinite(equipmentValue)) {
          issues.push({ code: 'invalid-character-input-equipment-value', message: `${configPath}.equipment.${key} must be a finite number.`, path: `${configPath}.equipment.${key}` });
        }
      }
    }
  }
}

function validateDefOperatorConfigPageCache(value, path, issues) {
  if (!isObject(value)) {
    issues.push({ code: 'invalid-operator-config-page-cache', message: `${path} must be an object.`, path });
    return;
  }
  for (const [characterId, snapshot] of Object.entries(value)) {
    const snapshotPath = `${path}.${characterId}`;
    if (!characterId.trim() || !isObject(snapshot)) {
      issues.push({ code: 'invalid-operator-config-snapshot', message: `${snapshotPath} must be a non-empty id mapped to a ConfigSnapshot object.`, path: snapshotPath });
      continue;
    }
    validateDefObjectKeys(snapshot, DEF_OPERATOR_CONFIG_SNAPSHOT_KEYS, snapshotPath, issues);
    if (!isObject(snapshot.panel) || !isObject(snapshot.panel.calc) || !isObject(snapshot.panel.display)) {
      issues.push({ code: 'invalid-operator-config-panel', message: `${snapshotPath}.panel must contain calc and display objects.`, path: `${snapshotPath}.panel` });
    }
    if (!isObject(snapshot.operator) || typeof snapshot.operator.id !== 'string' || typeof snapshot.operator.name !== 'string') {
      issues.push({ code: 'invalid-operator-config-operator', message: `${snapshotPath}.operator must contain string id and name.`, path: `${snapshotPath}.operator` });
    }
    if (!isObject(snapshot.weapon) || typeof snapshot.weapon.id !== 'string' || typeof snapshot.weapon.name !== 'string' || !isObject(snapshot.weapon.config)) {
      issues.push({ code: 'invalid-operator-config-weapon', message: `${snapshotPath}.weapon must contain id, name, and config.`, path: `${snapshotPath}.weapon` });
    }
    if (!isObject(snapshot.equipment) || !Array.isArray(snapshot.equipment.pieces) || !Array.isArray(snapshot.equipment.setBuffs)) {
      issues.push({ code: 'invalid-operator-config-equipment', message: `${snapshotPath}.equipment must contain pieces and setBuffs arrays.`, path: `${snapshotPath}.equipment` });
    }
    if (!isObject(snapshot.buff) || !Array.isArray(snapshot.buff.operator) || !Array.isArray(snapshot.buff.weapon) || !Array.isArray(snapshot.buff.equipment)) {
      issues.push({ code: 'invalid-operator-config-buff', message: `${snapshotPath}.buff must contain operator, weapon, and equipment arrays.`, path: `${snapshotPath}.buff` });
    }
    if (typeof snapshot.detailMarkdown !== 'string') {
      issues.push({ code: 'invalid-operator-config-detail', message: `${snapshotPath}.detailMarkdown must be a string.`, path: `${snapshotPath}.detailMarkdown` });
    }
  }
}

function validateWorkNodePayloadIssues(payload, fieldName) {
  const structuralError = validateWorkNodePayload(payload, fieldName);
  if (structuralError) {
    return [{ code: `invalid-${fieldName}`, message: structuralError, path: fieldName }];
  }
  const issues = [];
  validateDefCharacterInputMap(payload.characterInputMap, `${fieldName}.characterInputMap`, issues);
  validateDefOperatorConfigPageCache(payload.operatorConfigPageCache, `${fieldName}.operatorConfigPageCache`, issues);
  issues.push(...validateDefTimelinePayload(payload, fieldName));
  return issues;
}

function validateDefTimelineAgainstSkillCatalog(payload, snapshot, fieldName = 'payload') {
  const buttons = Object.values(isObject(payload?.skillButtonTable) ? payload.skillButtonTable : {});
  if (buttons.length === 0) return [];
  const catalog = Array.isArray(snapshot?.skillCatalog) ? snapshot.skillCatalog : [];
  if (catalog.length === 0) {
    return [{
      code: 'trusted-skill-catalog-empty',
      path: `${fieldName}.skillButtonTable`,
      message: 'Visible trusted skill catalog is empty; timeline buttons cannot be verified for hydration.',
    }];
  }
  const issues = [];
  for (const button of buttons) {
    const path = `${fieldName}.skillButtonTable.${button?.id || 'unknown'}`;
    const typedCandidates = catalog.filter((skill) =>
      String(skill?.characterId || '') === String(button?.characterId || '')
      && String(skill?.characterName || '') === String(button?.characterName || '')
      && String(skill?.skillType || '') === String(button?.skillType || ''));
    const runtimeSkillId = String(button?.runtimeSkillId || '').trim();
    const skillDisplayName = String(button?.skillDisplayName || '').trim();
    const exact = runtimeSkillId
      ? typedCandidates.find((skill) => String(skill?.skillId || '') === runtimeSkillId)
      : typedCandidates.length === 1 ? typedCandidates[0] : null;
    if (!exact) {
      issues.push({
        code: runtimeSkillId ? 'button-runtime-skill-untrusted' : 'button-runtime-skill-ambiguous',
        path: `${path}.runtimeSkillId`,
        message: runtimeSkillId
          ? `Button ${button?.id || 'unknown'} runtimeSkillId ${runtimeSkillId} is not in the selected operator's trusted skill catalog.`
          : `Button ${button?.id || 'unknown'} needs an exact runtimeSkillId because its character and skillType do not resolve uniquely.`,
      });
      continue;
    }
    if (skillDisplayName && skillDisplayName !== String(exact.skillDisplayName || '')) {
      issues.push({
        code: 'button-skill-display-name-mismatch',
        path: `${path}.skillDisplayName`,
        message: `Button ${button?.id || 'unknown'} skillDisplayName does not match the trusted skill catalog.`,
      });
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
  const nodes = listRepositoryWorkNodes()
    .filter((node) => isObject(node?.workingPayload) || isObject(node?.basePayload))
    .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
  const preferred = nodes.find((node) => node?.timelineId === 'current-main-workbench') || nodes[0];
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
  const staffIndex = normalizeMirrorButtonNumber(button.persistenceStaffIndex ?? button.lineIndex, 0);
  const localNodeIndex = normalizeMirrorButtonNumber(button.nodeIndex, 0);
  const nodeIndex = normalizeMirrorButtonNumber(
    button.persistenceNodeIndex,
    normalizeMirrorButtonNumber(button.staffIndex, 0) * DEF_GRID_NODE_COUNT + localNodeIndex,
  );
  return {
    id: String(button.id || button.buttonId || makeId('mirror-button')),
    ...(button.characterId ? { characterId: String(button.characterId) } : {}),
    characterName: String(button.characterName || ''),
    skillType: String(button.skillType || 'A'),
    staffIndex,
    lineIndex: staffIndex,
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

function readDefMainWorkbenchMirrorPayload(expectedTimelineId = '') {
  const snapshot = readMainWorkbenchSnapshotMirror();
  const timelineId = typeof snapshot?.timelineId === 'string' ? snapshot.timelineId.trim() : '';
  if (!timelineId || (expectedTimelineId && timelineId !== expectedTimelineId)) return null;
  const selectedCharacters = Array.isArray(snapshot?.selectedCharacters) ? snapshot.selectedCharacters : [];
  if (selectedCharacters.length === 0) return null;

  const selectedCharacterIds = selectedCharacters
    .map((character) => String(character?.id || character?.name || '').trim())
    .filter(Boolean)
    .slice(0, 4);
  if (selectedCharacterIds.length === 0) return null;

  const buttons = Array.isArray(snapshot?.skillButtons) ? snapshot.skillButtons : [];
  const characterInputRaw = readMainWorkbenchSessionJson('def.operator-config.character-input-map.v3', {});
  const operatorConfigPageCache = readMainWorkbenchSessionJson('def.operator-config.page-cache.v1', {});
  const staffLines = selectedCharacters.slice(0, 4).map((character, index) => {
    const lineButtons = buttons
      .filter((button) => Number.isInteger(Number(button?.persistenceStaffIndex ?? button?.lineIndex))
        ? Number(button.persistenceStaffIndex ?? button.lineIndex) === index
        : String(button?.characterId || button?.characterName || '') === String(character?.id || character?.name || ''))
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
    characterInputMap: characterInputRaw?.items || characterInputRaw?.data || characterInputRaw,
    characterComputedMap: {},
    characterDisplayCacheMap: {},
    operatorConfigPageCache,
  };
  if (validateWorkNodePayload(payload, 'basePayload') !== null) return null;
  return {
    payload,
    source: 'main-workbench-snapshot-mirror',
    sourceId: 'current-mirror',
    timelineId,
    sourceUpdatedAt: snapshot?.updatedAt || null,
  };
}

function readDefCurrentTimelinePayloadSource(expectedTimelineId = '') {
  const payloadFromMirror = readDefMainWorkbenchMirrorPayload(expectedTimelineId);
  if (payloadFromMirror) return payloadFromMirror;

  // Legacy storage and "latest node" values have no authoritative workspace
  // identity. They are intentionally unavailable to a bound DEF session.
  if (expectedTimelineId) return null;

  const characterInputRaw = readMainWorkbenchSessionJson('def.operator-config.character-input-map.v3', {});
  const characterComputedRaw = readMainWorkbenchSessionJson('def.operator-runtime.character-computed-map.v3', {});
  const characterDisplayRaw = readMainWorkbenchSessionJson('def.operator-ui.character-display-cache.v3', {});
  const payloadFromStorage = {
    selectedCharacters: readMainWorkbenchJson('def.selected-characters.v1', []),
    timelineData: readMainWorkbenchJson('def.timeline.data.v1', null),
    skillButtonTable: readMainWorkbenchJson('def.skill-button.v1', {}),
    allBuffList: readMainWorkbenchJson('def.all-buff-list.v1', []),
    anomalyStateSnapshots: readMainWorkbenchJson('def.anomaly-state-snapshot-archive.v1', { snapshots: [] })?.snapshots || [],
    characterInputMap: characterInputRaw?.items || characterInputRaw?.data || characterInputRaw,
    characterComputedMap: characterComputedRaw?.items || characterComputedRaw?.data || characterComputedRaw,
    characterDisplayCacheMap: characterDisplayRaw?.items || characterDisplayRaw?.data || characterDisplayRaw,
    operatorConfigPageCache: readMainWorkbenchSessionJson('def.operator-config.page-cache.v1', {}),
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
  const payloadIssues = validateWorkNodePayloadIssues(payloadSource.payload, 'basePayload');
  if (payloadIssues.length > 0) {
    return {
      ok: false,
      code: 'invalid-current-payload',
      message: payloadIssues.map((issue) => issue.message).join('; '),
      source: payloadSource.source,
      sourceId: payloadSource.sourceId,
      issues: payloadIssues,
    };
  }
  const now = Date.now();
  const timelineId = typeof input.timelineId === 'string' && input.timelineId.trim()
    ? sanitizeWorkNodeId(input.timelineId, 'timeline')
    : typeof input.saveId === 'string' && input.saveId.trim()
      ? sanitizeWorkNodeId(input.saveId, 'timeline')
    : 'current-main-workbench';
  if (payloadSource.timelineId && payloadSource.timelineId !== timelineId) {
    return { ok: false, code: 'blocked-session-mismatch', message: 'Current Workbench projection does not belong to this session workspace.' };
  }
  // Calls made by a native Workbench session must fork exactly from the
  // checkout which the canonical gate authenticated.  Do not let a payload
  // caller smuggle a different parent into this otherwise same-timeline fork.
  const gate = input.__defCurrentGate;
  if (gate) {
    if (gate.binding?.timelineId !== timelineId || !gate.checkout || !gate.checkoutPayload) {
      return { ok: false, code: 'checkout-unavailable', message: 'Creating a Work Node requires an authenticated current checkout.' };
    }
    const repository = getTimelineRepository();
    const currentCheckout = repository.getCheckoutRef(timelineId);
    if (!currentCheckout || currentCheckout.targetType !== gate.checkout.targetType
      || currentCheckout.targetId !== gate.checkout.targetId
      || Number(currentCheckout.updatedAt) !== Number(gate.checkout.updatedAt)) {
      return { ok: false, code: 'checkout-changed', message: 'The current checkout changed before this Work Node was created.' };
    }
    if (gate.checkout.targetType === 'work-node') {
      if (!gate.checkoutNodeId) {
        return { ok: false, code: 'checkout-unavailable', message: 'The authenticated Work Node checkout is unavailable.' };
      }
      if (Object.prototype.hasOwnProperty.call(input, 'parentNodeId')
        && String(input.parentNodeId || '').trim() !== gate.checkoutNodeId) {
        return { ok: false, code: 'blocked-session-mismatch', message: 'A Work Node fork must use the authenticated current checkout as its parent.' };
      }
      const authenticatedParent = repository.getWorkNode(gate.checkoutNodeId);
      if (!authenticatedParent || authenticatedParent.timelineId !== timelineId
        || Number(authenticatedParent.contentRevision || authenticatedParent.updatedAt) !== Number(gate.checkoutRevision)
        || hashDefNodeValue(authenticatedParent.workingPayload) !== gate.checkoutPayloadHash) {
        return { ok: false, code: 'checkout-changed', message: 'The current checkout revision changed before this Work Node fork was created.' };
      }
    } else if (gate.checkout.targetType === 'snapshot') {
      if (typeof input.parentNodeId === 'string' && input.parentNodeId.trim()) {
        return { ok: false, code: 'blocked-session-mismatch', message: 'The first Work Node created from a snapshot checkout cannot claim a Work Node parent.' };
      }
      const authenticatedSnapshot = repository.getSnapshot(gate.checkout.targetId);
      if (!authenticatedSnapshot || authenticatedSnapshot.archivedAt || authenticatedSnapshot.timelineId !== timelineId
        || authenticatedSnapshot.payloadHash !== gate.checkoutPayloadHash
        || Number(currentCheckout.updatedAt) !== Number(gate.checkoutTargetRevision)) {
        return { ok: false, code: 'checkout-changed', message: 'The authenticated snapshot changed before the first Work Node was created.' };
      }
    } else {
      return { ok: false, code: 'checkout-unavailable', message: 'The authenticated checkout type cannot create a Work Node.' };
    }
  }
  const saveId = timelineId;
  const hasParentNodeInput = Object.prototype.hasOwnProperty.call(input, 'parentNodeId');
  const requestedParentNodeId = typeof input.parentNodeId === 'string' && input.parentNodeId.trim()
    ? sanitizeWorkNodeId(input.parentNodeId, 'ai-timeline-node')
    : undefined;
  const checkoutRef = getTimelineRepository().getCheckoutRef(timelineId);
  const checkoutNodeId = gate?.checkoutNodeId
    ? gate.checkoutNodeId
    : hasParentNodeInput
    ? requestedParentNodeId
    : checkoutRef?.targetType === 'work-node' ? checkoutRef.targetId : undefined;
  const placement = input.placement === 'horizontal-branch' ? 'horizontal-branch' : 'child';
  const checkoutNode = checkoutNodeId ? getTimelineRepository().getWorkNode(checkoutNodeId) : null;
  const parentNodeId = placement === 'horizontal-branch'
    ? horizontalConfigurationParent(checkoutNode)
    : checkoutNodeId;
  const node = {
    id: sanitizeWorkNodeId(input.id, 'ai-timeline-node'),
    ...(parentNodeId ? { parentNodeId } : {}),
    saveId,
    timelineId,
    branchId: sanitizeWorkNodeId(input.branchId, `main-workbench-${now}`),
    createdAt: now,
    updatedAt: now,
    contentRevision: now,
    description: normalizeWorkNodeDescription(input.description),
    label: aiWorkNodeLabel(input.label, `Main Workbench ${new Date(now).toLocaleString()}`),
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
      placement,
      baseNodeId: checkoutNodeId || null,
    })],
  };
  // Creating a draft is deliberately not a checkout operation.  HEAD is only
  // advanced after the renderer has applied a validated work node.
  mirrorWorkNodeToTimelineRepository(node);
  writeLegacyNodeProjection(node);
  return {
    ok: true,
    node,
    path: aiTimelineWorkNodesPath,
    source: payloadSource.source,
    sourceId: payloadSource.sourceId,
    sourceUpdatedAt: payloadSource.sourceUpdatedAt,
    placement,
    baseNodeId: checkoutNodeId || null,
    buttonTargets: buildDefWorkNodeButtonTargets(payloadSource.payload),
  };
}

function readDefWorkbenchAxisContext(input = {}) {
  if (input.__defCurrentGate?.axisContext) return input.__defCurrentGate.axisContext;
  const repository = getTimelineRepository();
  const bindingId = typeof input.sessionBindingId === 'string' ? input.sessionBindingId.trim() : '';
  if (bindingId) {
    const context = repository.getSessionAxisContext(bindingId);
    if (context) return context;
  }
  // A timeline id supplied by a caller is not an axis identity.  Returning a
  // context for it here used to make no-binding and cross-workspace callers
  // appear legitimate.  The canonical gate is the only source of a current
  // Workbench context; a direct binding lookup remains for bootstrap output.
  return null;
}

function workbenchBindingFailure(code, message, status = 409) {
  return { ok: false, code, message, status, state: code.toUpperCase().replaceAll('-', '_') };
}

function resolveBoundWorkbenchSession(input = {}, { nodeId = '', allowMissingNode = false } = {}) {
  const sessionID = typeof input.__defSessionId === 'string' ? input.__defSessionId.trim() : '';
  if (!sessionID) return workbenchBindingFailure('blocked-binding', 'This Workbench tool requires an active bound DEF OpenCode session.', 403);
  const repository = getTimelineRepository();
  const binding = repository.getSessionAxisBindingBySession('workbench', sessionID);
  if (!binding) return workbenchBindingFailure('blocked-binding-stale', 'This DEF OpenCode session no longer has a valid workspace binding.', 409);
  const document = repository.getDocument(binding.timelineId);
  if (!document || document.archivedAt || document.isTemporary) {
    return workbenchBindingFailure('blocked-binding-stale', 'The SQLite workspace bound to this DEF session is no longer available.', 409);
  }
  const suppliedTimelineId = typeof input.timelineId === 'string' ? input.timelineId.trim() : '';
  if (suppliedTimelineId && suppliedTimelineId !== binding.timelineId) {
    return workbenchBindingFailure('blocked-session-mismatch', 'A DEF OpenCode session cannot access another SQLite workspace.', 409);
  }
  const resolvedNodeId = nodeId || (typeof input.nodeId === 'string' ? input.nodeId.trim() : '');
  if (resolvedNodeId) {
    const node = repository.getWorkNode(resolvedNodeId);
    if (!node || node.timelineId !== binding.timelineId) {
      return workbenchBindingFailure('blocked-session-mismatch', 'The requested Work Node is outside this session binding.', 409);
    }
  } else if (!allowMissingNode) {
    return { ok: true, binding, document };
  }
  return { ok: true, binding, document };
}

/**
 * The one authoritative bridge from the active Workbench projection to a
 * native DEF session.  Do not replace this with per-tool SQLite reads: the UI
 * projection is valid only when it proves it belongs to the same formal
 * workspace as the immutable session binding.
 */
function resolveCanonicalWorkbenchCurrent(input = {}, { nodeId = '' } = {}) {
  const session = resolveBoundWorkbenchSession(input, { nodeId });
  if (!session.ok) return session;
  const snapshot = readMainWorkbenchSnapshotMirror();
  const activeTimelineId = typeof snapshot?.activeTimelineId === 'string' ? snapshot.activeTimelineId.trim() : '';
  const projectionTimelineId = typeof snapshot?.timelineId === 'string' ? snapshot.timelineId.trim() : '';
  if (!activeTimelineId || !projectionTimelineId
    || activeTimelineId !== projectionTimelineId
    || activeTimelineId !== session.binding.timelineId) {
    return workbenchBindingFailure('blocked-session-mismatch', 'The current Workbench projection does not match this DEF session binding.');
  }
  const axisContext = getTimelineRepository().getSessionAxisContext(session.binding.id);
  const checkout = axisContext?.checkout || null;
  if (!axisContext?.binding || axisContext.binding.timelineId !== session.binding.timelineId
    || !axisContext.document || axisContext.document.isTemporary || axisContext.document.archivedAt
    || (checkout && checkout.timelineId !== session.binding.timelineId)) {
    return workbenchBindingFailure('blocked-binding-stale', 'The bound Workbench workspace is no longer available.');
  }
  if (!checkout) {
    return workbenchBindingFailure('blocked-session-mismatch', 'The bound Workbench workspace has no authenticated checkout.');
  }
  const repository = getTimelineRepository();
  const checkoutNode = checkout.targetType === 'work-node'
    ? repository.getWorkNode(checkout.targetId)
    : null;
  const checkoutSnapshot = checkout.targetType === 'snapshot'
    ? repository.getSnapshot(checkout.targetId)
    : null;
  const checkoutPayload = checkoutNode?.workingPayload || checkoutSnapshot?.payload || null;
  const checkoutTargetTimelineId = checkoutNode?.timelineId || checkoutSnapshot?.timelineId || '';
  if (!checkoutPayload || checkoutTargetTimelineId !== session.binding.timelineId
    || checkoutSnapshot?.archivedAt) {
    return workbenchBindingFailure('blocked-session-mismatch', 'The current checkout is outside this DEF session workspace or no longer available.');
  }
  if (!workbenchProjectionMatchesCheckout(snapshot, checkoutPayload)) {
    return workbenchBindingFailure('blocked-session-mismatch', 'The current Workbench payload does not match the authenticated checkout projection.');
  }
  if (!workbenchProjectionMatchesCheckoutIdentity(snapshot, checkout)) {
    return workbenchBindingFailure('blocked-session-mismatch', 'The current Workbench projection belongs to a different checkout.');
  }
  if (!isCompleteCanvasWorkbenchProjection(snapshot)) {
    return workbenchBindingFailure('blocked-session-mismatch', 'The current Canvas has not published a complete checkout projection.');
  }
  return {
    ok: true,
    ...session,
    snapshot,
    activeTimelineId,
    projectionTimelineId,
    axisContext,
    checkout,
    checkoutPayload,
    checkoutPayloadHash: checkout.targetType === 'snapshot'
      ? checkoutSnapshot.payloadHash
      : hashDefNodeValue(checkoutPayload),
    checkoutTargetRevision: checkout.targetType === 'work-node'
      ? Number(checkoutNode?.contentRevision || 0) || null
      : Number(checkout.updatedAt) || null,
    checkoutNodeId: checkout.targetType === 'work-node' ? checkout.targetId : null,
    checkoutRevision: checkout.targetType === 'work-node'
      ? Number(checkoutNode?.contentRevision || 0) || null
      : null,
  };
}

function sortedStrings(values = []) {
  return values.map((value) => String(value || '').trim()).filter(Boolean).sort();
}

function sameStrings(left = [], right = []) {
  return JSON.stringify(sortedStrings(left)) === JSON.stringify(sortedStrings(right));
}

function workbenchProjectionMatchesCheckout(snapshot, workingPayload) {
  if (!isObject(snapshot) || !isObject(workingPayload)) return false;
  const selectedIds = (Array.isArray(snapshot.selectedCharacters) ? snapshot.selectedCharacters : [])
    .map((character) => character?.id || character?.name);
  if (!sameStrings(selectedIds, Array.isArray(workingPayload.selectedCharacters) ? workingPayload.selectedCharacters : [])) return false;

  const expectedButtons = isObject(workingPayload.skillButtonTable) ? workingPayload.skillButtonTable : {};
  const projectedButtons = Array.isArray(snapshot.skillButtons) ? snapshot.skillButtons : [];
  if (!sameStrings(projectedButtons.map((button) => button?.id), Object.keys(expectedButtons))) return false;
  for (const button of projectedButtons) {
    const expected = expectedButtons[button?.id];
    const projectedStaffIndex = Number(button?.persistenceStaffIndex ?? button?.lineIndex);
    const projectedNodeIndex = Number(button?.persistenceNodeIndex
      ?? (Number(button?.staffIndex) * DEF_GRID_NODE_COUNT + Number(button?.nodeIndex)));
    if (!expected
      || !String(button?.characterId || '').trim()
      || !String(button?.characterName || '').trim()
      || String(button.characterId) !== String(expected.characterId || '')
      || String(button.characterName) !== String(expected.characterName || '')
      || String(button?.skillType || '') !== String(expected.skillType || '')
      || projectedStaffIndex !== Number(expected.staffIndex)
      || projectedNodeIndex !== Number(expected.nodeIndex)
      || !sameStrings(button?.selectedBuffIds || [], expected.selectedBuff || [])) return false;
  }

  const expectedConfigs = isObject(workingPayload.operatorConfigPageCache) ? workingPayload.operatorConfigPageCache : {};
  const projectedConfigs = Array.isArray(snapshot.operatorConfigs) ? snapshot.operatorConfigs : [];
  const expectedConfigIds = selectedIds.filter((id) => isObject(expectedConfigs[id]));
  if (!sameStrings(projectedConfigs.map((config) => config?.characterId), expectedConfigIds)) return false;
  for (const config of projectedConfigs) {
    const expected = expectedConfigs[config?.characterId];
    const expectedWeapon = expected?.weapon;
    const projectedWeapon = config?.weapon;
    if (!isObject(expectedWeapon) || !isObject(projectedWeapon)
      || String(projectedWeapon.id || projectedWeapon.name || '') !== String(expectedWeapon.id || expectedWeapon.name || '')
      || String(projectedWeapon.level ?? '') !== String(expectedWeapon.config?.level ?? '')
      || String(projectedWeapon.potential ?? '') !== String(expectedWeapon.config?.potential ?? '')) return false;
    const projectedPieces = Array.isArray(config.equipment) ? config.equipment : [];
    const expectedPieces = Array.isArray(expected?.equipment?.pieces) ? expected.equipment.pieces : [];
    const pieceIdentity = (piece) => `${String(piece?.slotKey || '')}:${String(piece?.equipmentId || piece?.id || '')}`;
    if (!sameStrings(projectedPieces.map(pieceIdentity), expectedPieces.map(pieceIdentity))) return false;
  }
  return true;
}

function workbenchProjectionMatchesCheckoutIdentity(snapshot, checkout) {
  return isObject(snapshot?.checkout)
    && snapshot.checkout.targetType === checkout?.targetType
    && snapshot.checkout.targetId === checkout?.targetId
    && Number(snapshot.checkout.updatedAt) === Number(checkout?.updatedAt);
}

function isCompleteCanvasWorkbenchProjection(snapshot) {
  if (!isObject(snapshot) || snapshot.source !== 'app' || !isObject(snapshot.damageReport)
    || !Array.isArray(snapshot.damageReport.buttons)) return false;
  return (Array.isArray(snapshot.skillButtons) ? snapshot.skillButtons : []).every((button) => {
    const persistenceStaffIndex = Number(button?.persistenceStaffIndex ?? button?.lineIndex);
    const persistenceNodeIndex = Number(button?.persistenceNodeIndex
      ?? (Number(button?.staffIndex) * DEF_GRID_NODE_COUNT + Number(button?.nodeIndex)));
    if (!String(button?.id || '').trim()
      || !String(button?.characterId || '').trim()
      || !String(button?.characterName || '').trim()
      || !['A', 'B', 'E', 'Q', 'Dot'].includes(String(button?.skillType || ''))
      || !Number.isInteger(Number(button?.staffIndex)) || Number(button.staffIndex) < 0
      || !Number.isInteger(Number(button?.lineIndex)) || Number(button.lineIndex) < 0
      || !Number.isInteger(Number(button?.nodeIndex)) || Number(button.nodeIndex) < 0
      || !Number.isInteger(persistenceStaffIndex) || persistenceStaffIndex < 0
      || !Number.isInteger(persistenceNodeIndex) || persistenceNodeIndex < 0
      || !Array.isArray(button?.selectedBuffIds) || !Array.isArray(button?.selectedBuffs)) return false;
    const resolvedIds = new Set(button.selectedBuffs.map((buff) => String(buff?.id || '')).filter(Boolean));
    return button.selectedBuffIds.every((buffId) => resolvedIds.has(String(buffId)));
  });
}

async function waitForWorkbenchProjectionPayload(timelineId, workingPayload, waitMs, extraPredicate = null) {
  const deadline = Date.now() + normalizeDefVerifyWaitMs(waitMs, 8000);
  let snapshot = readMainWorkbenchSnapshotMirror();
  let pass = Boolean(snapshot
    && snapshot.activeTimelineId === timelineId
    && snapshot.timelineId === timelineId
    && workbenchProjectionMatchesCheckout(snapshot, workingPayload)
    && (!extraPredicate || extraPredicate(snapshot)));
  while (!pass && Date.now() < deadline) {
    await sleep(150);
    snapshot = readMainWorkbenchSnapshotMirror();
    pass = Boolean(snapshot
      && snapshot.activeTimelineId === timelineId
      && snapshot.timelineId === timelineId
      && workbenchProjectionMatchesCheckout(snapshot, workingPayload)
      && (!extraPredicate || extraPredicate(snapshot)));
  }
  return { pass, snapshot };
}

function workbenchDamageMatchesSnapshot(snapshot, expectedSnapshot) {
  const normalize = (value) => {
    const report = value?.damageReport;
    if (!isObject(report)) return null;
    return {
      totalExpected: report.totalExpected ?? null,
      totalNonCrit: report.totalNonCrit ?? null,
      buttonCount: report.buttonCount ?? null,
      buttons: Array.isArray(report.buttons) ? report.buttons : [],
    };
  };
  return JSON.stringify(normalize(snapshot)) === JSON.stringify(normalize(expectedSnapshot));
}

function normalizeWorkNodeDescription(value) {
  return typeof value === 'string' ? value.trim().slice(0, 240) : '';
}

function aiWorkNodeLabel(value, fallback) {
  return (typeof value === 'string' && value.trim() ? value.trim() : fallback).slice(0, 120);
}

function readAgentWorkNodeMetadata(input = {}) {
  const title = typeof input.nodeTitle === 'string' ? input.nodeTitle.trim() : '';
  const description = typeof input.nodeDescription === 'string' ? input.nodeDescription.trim() : '';
  if (title.length < 2 || title.length > 32) {
    return { ok: false, code: 'operator-config-node-title-required', message: 'Operator configuration requires an Agent-written 2-32 character node title.' };
  }
  if (description.length < 8 || description.length > 160) {
    return { ok: false, code: 'operator-config-node-description-required', message: 'Operator configuration requires an Agent-written 8-160 character change description.' };
  }
  return { ok: true, title, description };
}

function horizontalConfigurationParent(node) {
  return typeof node?.parentNodeId === 'string' && node.parentNodeId.trim() ? node.parentNodeId.trim() : '';
}

function sameOptionalNodeId(actual, expected) {
  return String(actual || '') === String(expected || '');
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

function handleAiTimelineWorkNodeRequest(method, pathname, body, invocation = {}) {
  if (!pathname.startsWith('/api/ai-timeline-worknodes')) return null;
  if (!rawTransportAuthorized(invocation)) return denyRawTransport(pathname);
  if (method === 'GET' && pathname === '/api/ai-timeline-worknodes') {
    const nodes = listRepositoryWorkNodes().sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
    const commits = listRepositoryWorkNodeCommits().sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
    const heads = Object.fromEntries(getTimelineRepository().listDocuments().map((document) => {
      const checkout = getTimelineRepository().getCheckoutRef(document.id);
      return [document.id, checkout?.targetType === 'work-node'
        ? { nodeId: checkout.targetId, revision: checkout.updatedAt }
        : { nodeId: '', revision: checkout?.updatedAt || 0 }];
    }));
    const latestHead = Object.values(heads).sort((left, right) => right.revision - left.revision)[0];
    return {
      status: 200,
      body: {
        ok: true,
        protocolVersion: 1,
        path: aiTimelineWorkNodesPath,
        nodes: nodes.map(toAiTimelineWorkNodeListItem),
        commits: commits.map(toAiTimelineWorkNodeCommitListItem),
        heads,
        headNodeId: latestHead?.nodeId || '',
        revision: latestHead?.revision || 0,
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
    const hasParentNodeInput = Object.prototype.hasOwnProperty.call(body || {}, 'parentNodeId');
    const requestedParentNodeId = typeof body?.parentNodeId === 'string' && body.parentNodeId.trim()
      ? sanitizeWorkNodeId(body.parentNodeId, 'ai-timeline-node')
      : undefined;
    const checkoutRef = getTimelineRepository().getCheckoutRef(saveId);
    const parentNodeId = hasParentNodeInput
      ? requestedParentNodeId
      : checkoutRef?.targetType === 'work-node' ? checkoutRef.targetId : undefined;
    const node = {
      id: sanitizeWorkNodeId(body?.id, 'ai-timeline-node'),
      ...(parentNodeId ? { parentNodeId } : {}),
      saveId,
      timelineId: saveId,
      branchId,
      createdAt: now,
      updatedAt: now,
      contentRevision: now,
      label: aiWorkNodeLabel(body?.label, 'AI Timeline Work Node'),
      description: normalizeWorkNodeDescription(body?.description),
      status: 'open',
      basePayload: cloneJson(basePayload),
      workingPayload: cloneJson(requestedWorkingPayload),
      baseSummary: summarizeTimelinePayload(basePayload),
      workingSummary: summarizeTimelinePayload(requestedWorkingPayload),
      approvalPolicy: ['auto-low-risk', 'ask-on-risk', 'manual'].includes(body?.approvalPolicy) ? body.approvalPolicy : 'auto-low-risk',
      riskFlags: normalizeRiskFlags(body?.riskFlags),
      logs: [makeWorkNodeLog('info', 'Created AI timeline work node from checkout payload.')],
    };
    mirrorWorkNodeToTimelineRepository(node);
    writeLegacyNodeProjection(node);
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
  const node = readRepositoryWorkNode(nodeId);
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
    const hasWorkingPayloadPatch = Object.prototype.hasOwnProperty.call(body || {}, 'workingPayload');
    const currentContentRevision = Number(node.contentRevision || node.updatedAt);
    if (hasWorkingPayloadPatch) {
      const expectedContentRevision = Number(body?.expectedContentRevision);
      if (!Number.isFinite(expectedContentRevision)) {
        return failScript(409, 'ai-worknode-content-revision-required', 'Replacing a Work Node working payload requires expectedContentRevision.', {
          nodeId: node.id,
          actualContentRevision: currentContentRevision,
        });
      }
      if (expectedContentRevision !== currentContentRevision) {
        return failScript(409, 'ai-worknode-content-revision-conflict', 'Work Node content changed before this payload update could be applied.', {
          nodeId: node.id,
          expectedContentRevision,
          actualContentRevision: currentContentRevision,
        });
      }
    }
    const workingPayload = hasWorkingPayloadPatch
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
    if (Object.prototype.hasOwnProperty.call(body || {}, 'status') && !allowedStatuses.has(body.status)) {
      return failScript(400, 'invalid-timeline-work-node-status', `Unsupported AI Work Node status: ${String(body.status)}`);
    }
    const hasParentNodePatch = Object.prototype.hasOwnProperty.call(body || {}, 'parentNodeId');
    const hasLabelPatch = Object.prototype.hasOwnProperty.call(body || {}, 'label');
    const hasDescriptionPatch = Object.prototype.hasOwnProperty.call(body || {}, 'description');
    const label = hasLabelPatch && typeof body.label === 'string' && body.label.trim()
      ? body.label.trim().slice(0, 120)
      : node.label;
    const description = hasDescriptionPatch
      ? normalizeWorkNodeDescription(body.description)
      : (node.description || '');
    const parentNodeId = hasParentNodePatch && typeof body.parentNodeId === 'string' && body.parentNodeId.trim()
      ? sanitizeWorkNodeId(body.parentNodeId, 'ai-timeline-node')
      : undefined;
    const nextNode = {
      ...node,
      ...(hasParentNodePatch ? (parentNodeId ? { parentNodeId } : { parentNodeId: undefined }) : {}),
      label,
      description,
      updatedAt: Date.now(),
      status: allowedStatuses.has(body?.status) ? body.status : node.status,
      workingPayload: cloneJson(workingPayload),
      contentRevision: hashDefNodeValue(workingPayload) === hashDefNodeValue(node.workingPayload)
        ? currentContentRevision
        : currentContentRevision + 1,
      workingSummary: summarizeTimelinePayload(workingPayload),
      riskFlags,
      logs: [
        makeWorkNodeLog('info', 'Updated AI timeline work node.', {
          riskFlagCount: riskFlags.length,
          status: allowedStatuses.has(body?.status) ? body.status : node.status,
          ...(hasLabelPatch ? { label } : {}),
          ...(hasDescriptionPatch ? { description } : {}),
        }),
        ...(Array.isArray(node.logs) ? node.logs : []),
      ],
    };
    mirrorWorkNodeToTimelineRepository(nextNode);
    writeLegacyNodeProjection(nextNode);
    return { status: 200, body: { ok: true, protocolVersion: 1, path: aiTimelineWorkNodesPath, node: nextNode } };
  }

  if (method === 'POST' && action === 'delete') {
    try {
      // The legacy store is retained only for runtime compatibility during the
      // migration. Validate both projections before changing either one, then
      // remove both so a later compatibility update cannot resurrect this node.
      const repository = getTimelineRepository();
      const legacyStore = getAiTimelineWorkNodeStore();
      if (repository.getWorkNode(nodeId)) repository.assertWorkNodeSubtreeDeletable(nodeId);
      if (repository.getWorkNode(nodeId)) repository.deleteWorkNodeSubtree(nodeId);
      if (legacyStore.getNode(nodeId)) legacyStore.deleteSubtreeProjection(nodeId);
    } catch (error) {
      if (error?.code === 'ai-worknode-current-checkout-protected') {
        return failScript(409, error.code, error.message, { nodeId });
      }
      throw error;
    }
    return handleAiTimelineWorkNodeRequest('GET', '/api/ai-timeline-worknodes', null, INTERNAL_RAW_TRANSPORT);
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
    if (getTimelineRepository().getWorkNodeCommit(commit.id)) {
      return failScript(409, 'ai-worknode-commit-id-conflict', `AI Work Node commit id already exists: ${commit.id}`);
    }
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
    mirrorWorkNodeToTimelineRepository(nextNode);
    mirrorWorkNodeCommitToTimelineRepository(commit);
    writeLegacyNodeCommitProjection(nextNode, commit);
    return { status: 200, body: { ok: true, protocolVersion: 1, path: aiTimelineWorkNodesPath, node: nextNode, commit } };
  }

  if (method === 'POST' && action === 'checkout-applied') {
    const commitId = typeof body?.commitId === 'string' && body.commitId.trim() ? body.commitId.trim() : '';
    const targetCommit = commitId
      ? getTimelineRepository().getWorkNodeCommit(commitId)
      : getTimelineRepository().getLatestWorkNodeCommit(node.id);
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
    mirrorWorkNodeToTimelineRepository(nextNode);
    mirrorWorkNodeCommitToTimelineRepository(nextCommit);
    getTimelineRepository().setCheckoutRef({
      timelineId: nextNode.timelineId || nextNode.saveId || 'current-main-workbench',
      targetType: 'work-node',
      targetId: nextNode.id,
      updatedAt: appliedAt,
    });
    writeLegacyNodeCommitProjection(nextNode, nextCommit, { setHead: true });
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
    const atomicParentNodeId = typeof body?.atomicParentNodeId === 'string' ? body.atomicParentNodeId.trim() : '';
    const atomicCommitId = typeof body?.commitId === 'string' ? body.commitId.trim() : '';
    const checkout = getTimelineRepository().getCheckoutRef(node.timelineId || node.saveId);
    if (atomicParentNodeId) {
      const parent = readRepositoryWorkNode(atomicParentNodeId);
      const targetCommit = atomicCommitId ? getTimelineRepository().getWorkNodeCommit(atomicCommitId) : null;
      if (!parent || parent.timelineId !== node.timelineId || !targetCommit || targetCommit.nodeId !== node.id
        || checkout?.targetType !== 'work-node' || checkout.targetId !== parent.id) {
        return failScript(409, 'atomic-rollback-stale', 'Atomic rollback no longer owns the current checkout; lifecycle was left unchanged.');
      }
      const nextCommit = { ...targetCommit, checkoutApplied: false, checkout: undefined, rollback };
      const nextNode = {
        ...node,
        status: 'committed',
        updatedAt: appliedAt,
        logs: [makeWorkNodeLog('info', 'Reconciled atomic team candidate back to its committed, un-applied state.', {
          ...rollback, sourceNodeId: node.id, parentNodeId: parent.id,
        }), ...(Array.isArray(node.logs) ? node.logs : [])],
      };
      mirrorWorkNodeToTimelineRepository(nextNode);
      mirrorWorkNodeCommitToTimelineRepository(nextCommit);
      writeLegacyNodeProjection(nextNode);
      return { status: 200, body: { ok: true, protocolVersion: 1, path: aiTimelineWorkNodesPath, node: nextNode, commit: nextCommit, rollback } };
    }
    const nextNode = {
      ...node,
      status: 'ready',
      updatedAt: appliedAt,
      logs: [makeWorkNodeLog('info', 'Restored current checkout from work node basePayload.', {
        ...rollback,
        sourceNodeId: node.id,
      }), ...(Array.isArray(node.logs) ? node.logs : [])],
    };
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
    writeLegacyNodeProjection(nextNode);
    return { status: 200, body: { ok: true, protocolVersion: 1, path: aiTimelineWorkNodesPath, node: nextNode, rollback } };
  }

  return null;
}

function handleTimelineRepositoryRequest(method, pathname, query, body, invocation = {}) {
  if (!pathname.startsWith('/api/timeline-')) return null;
  if (!rawTransportAuthorized(invocation)) return denyRawTransport(pathname);
  if (method === 'GET' && pathname === '/api/timeline-archives') {
    try {
      const source = query.get('source') || '';
      return { status: 200, body: { ok: true, archives: getDataManagementService().listTimelineArchives({ source }) } };
    } catch (error) {
      return failScript(400, error?.code || 'timeline-archive-list-failed', error instanceof Error ? error.message : String(error));
    }
  }
  if (method === 'GET' && pathname === '/api/timeline-workspaces') {
    try {
      return { status: 200, body: { ok: true, workspaces: getDataManagementService().listSqliteWorkspaces() } };
    } catch (error) {
      return failScript(500, error?.code || 'timeline-workspace-list-failed', error instanceof Error ? error.message : String(error));
    }
  }
  if (method === 'POST' && pathname === '/api/timeline-archives/convert') {
    try {
      return { status: 200, body: { ok: true, ...getDataManagementService().convertTimelineArchiveToWorkspace(body) } };
    } catch (error) {
      return failScript(400, error?.code || 'timeline-archive-convert-failed', error instanceof Error ? error.message : String(error), error?.details);
    }
  }
  if (method === 'POST' && pathname === '/api/timeline-archives/delete') {
    try {
      return { status: 200, body: { ok: true, result: getDataManagementService().deleteTimelineArchive(body) } };
    } catch (error) {
      return failScript(400, error?.code || 'timeline-archive-delete-failed', error instanceof Error ? error.message : String(error), error?.details);
    }
  }
  if (method === 'POST' && pathname === '/api/timeline-archives/transfer') {
    try {
      return { status: 200, body: { ok: true, result: getDataManagementService().transferTimelineArchive(body) } };
    } catch (error) {
      return failScript(400, error?.code || 'timeline-archive-transfer-failed', error instanceof Error ? error.message : String(error), error?.details);
    }
  }
  if (method === 'POST' && pathname === '/api/timeline-archives/import-legacy-bundle') {
    try {
      return { status: 200, body: { ok: true, ...getDataManagementService().importLegacyTimelineBundleArchive(body) } };
    } catch (error) {
      return failScript(400, error?.code || 'legacy-timeline-bundle-import-failed', error instanceof Error ? error.message : String(error), error?.details);
    }
  }
  const workspaceApplyMatch = /^\/api\/timeline-workspaces\/([^/]+)\/apply$/.exec(pathname);
  if (method === 'POST' && workspaceApplyMatch) {
    try {
      return { status: 200, body: { ok: true, ...getDataManagementService().applySqliteWorkspace({
        timelineId: decodeURIComponent(workspaceApplyMatch[1]),
        updatedAt: body?.updatedAt,
      }) } };
    } catch (error) {
      return failScript(error?.code === 'timeline-document-not-found' ? 404 : 400, error?.code || 'timeline-workspace-apply-failed', error instanceof Error ? error.message : String(error));
    }
  }
  const workspaceExportMatch = /^\/api\/timeline-workspaces\/([^/]+)\/export-archive$/.exec(pathname);
  if (method === 'POST' && workspaceExportMatch) {
    try {
      return { status: 200, body: { ok: true, ...getDataManagementService().exportSqliteWorkspaceArchive({
        timelineId: decodeURIComponent(workspaceExportMatch[1]),
        kind: body?.kind,
        label: body?.label,
      }) } };
    } catch (error) {
      return failScript(error?.code === 'timeline-document-not-found' ? 404 : 400, error?.code || 'timeline-workspace-export-failed', error instanceof Error ? error.message : String(error));
    }
  }
  const workspaceDeleteMatch = /^\/api\/timeline-workspaces\/([^/]+)\/delete$/.exec(pathname);
  if (method === 'POST' && workspaceDeleteMatch) {
    try {
      const result = getDataManagementService().deleteSqliteWorkspace({ timelineId: decodeURIComponent(workspaceDeleteMatch[1]) });
      getAiTimelineWorkNodeStore().deleteTimeline(result.document.id);
      return { status: 200, body: { ok: true, result } };
    } catch (error) {
      return failScript(error?.code === 'timeline-document-not-found' ? 404 : 400, error?.code || 'timeline-workspace-delete-failed', error instanceof Error ? error.message : String(error), error?.details);
    }
  }
  const repository = getTimelineRepository();
  if (method === 'GET' && pathname === '/api/timeline-documents') {
    return { status: 200, body: { ok: true, protocolVersion: 1, documents: repository.listDocuments() } };
  }
  if (method === 'POST' && pathname === '/api/timeline-documents') {
    return { status: 200, body: { ok: true, protocolVersion: 1, document: repository.ensureDocument(body) } };
  }
  const timelineDocumentDeleteMatch = /^\/api\/timeline-documents\/([^/]+)\/delete$/.exec(pathname);
  if (method === 'POST' && timelineDocumentDeleteMatch) {
    try {
      const timelineId = decodeURIComponent(timelineDocumentDeleteMatch[1]);
      const result = repository.deleteDocument(timelineId);
      getAiTimelineWorkNodeStore().deleteTimeline(timelineId);
      return { status: 200, body: { ok: true, protocolVersion: 1, result } };
    } catch (error) {
      return failScript(error?.status || 500, error?.code || 'timeline-document-delete-failed', error instanceof Error ? error.message : String(error));
    }
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
  if (method === 'GET' && pathname === '/api/timeline-work-node-commits') {
    const timelineId = query.get('timelineId') || '';
    if (!timelineId) return failScript(400, 'missing-timeline-id', 'Timeline Work Node commit list requires timelineId.');
    return { status: 200, body: { ok: true, protocolVersion: 1, commits: repository.listWorkNodeCommits(timelineId) } };
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
      repository.assertWorkNodeSubtreeDeletable(nodeId);
      const result = repository.deleteWorkNodeSubtree(nodeId);
      if (legacyStore.getNode(nodeId)) legacyStore.deleteSubtreeProjection(nodeId);
      return { status: 200, body: { ok: true, result } };
    } catch (error) {
      if (error?.status === 409 || error?.status === 404) return failScript(error.status, error.code, error.message);
      throw error;
    }
  }
  if (method === 'POST' && pathname === '/api/timeline-snapshots') {
    try {
      return { status: 200, body: { ok: true, protocolVersion: 1, ...repository.createOrReuseSnapshot(body) } };
    } catch (error) {
      if (error?.status) return failScript(error.status, error.code, error.message);
      throw error;
    }
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
    try {
      return { status: 200, body: { ok: true, protocolVersion: 1, checkoutRef: repository.setCheckoutRef(body) } };
    } catch (error) {
      if (error?.status) return failScript(error.status, error.code, error.message);
      throw error;
    }
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

function readMainWorkbenchSessionJson(key, fallback) {
  try {
    const storage = globalThis.window?.localStorage;
    const raw = typeof storage?.getSessionItem === 'function'
      ? storage.getSessionItem(key)
      : globalThis.window?.sessionStorage?.getItem(key);
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

function buildDefPhoneticText(value) {
  return pinyin(String(value || ''), { toneType: 'none', type: 'array' })
    .map((part) => normalizeDefToolText(part))
    .filter(Boolean)
    .join('');
}

function buildDefRankedSearchRecord(candidate, searchValues = []) {
  const values = searchValues.map((value) => String(value || '').trim()).filter(Boolean);
  const searchText = values.join(' ');
  const phoneticParts = values.map(buildDefPhoneticText).filter(Boolean);
  return {
    candidate,
    searchText,
    normalizedValues: values.map(normalizeDefToolText).filter(Boolean),
    normalizedText: normalizeDefToolText(searchText),
    phoneticValues: phoneticParts,
    phoneticText: phoneticParts.join(' '),
  };
}

function rankDefResourceCandidates(records, rawQuery, limit = 12) {
  const query = normalizeDefToolText(rawQuery);
  const boundedLimit = Math.max(1, Math.min(Number(limit || 12) || 12, 40));
  const finish = (matched, matchMethod, confidence) => ({
    candidates: matched.slice(0, boundedLimit).map((record) => ({
      ...record.candidate,
      matchMethod,
      confidence,
    })),
    matchCount: matched.length,
    exhaustive: matched.length <= boundedLimit,
    truncated: matched.length > boundedLimit,
  });
  if (!query) return finish(records, 'catalog', 1);

  const exact = records.filter((record) => record.normalizedValues.includes(query));
  if (exact.length) return finish(exact, 'exact', 1);

  const queryPhonetic = buildDefPhoneticText(rawQuery);
  const exactPhonetic = queryPhonetic
    ? records.filter((record) => record.phoneticValues.includes(queryPhonetic))
    : [];
  if (exactPhonetic.length) return finish(exactPhonetic, 'phonetic', 0.96);

  const substring = records.filter((record) => record.normalizedText.includes(query));
  if (substring.length) return finish(substring, 'substring', 0.9);

  const phoneticSubstring = queryPhonetic
    ? records.filter((record) => record.phoneticText.includes(queryPhonetic))
    : [];
  if (phoneticSubstring.length) return finish(phoneticSubstring, 'phonetic-substring', 0.86);

  const fuse = new Fuse(records, {
    keys: ['searchText', 'normalizedText', 'phoneticText'],
    threshold: 0.38,
    ignoreLocation: true,
    includeScore: true,
    shouldSort: true,
  });
  const fuzzy = fuse.search(String(rawQuery || '').trim());
  return {
    candidates: fuzzy.slice(0, boundedLimit).map((result) => ({
      ...result.item.candidate,
      matchMethod: 'fuzzy',
      confidence: Number(Math.max(0.5, Math.min(0.84, 1 - Number(result.score || 0))).toFixed(3)),
    })),
    matchCount: fuzzy.length,
    exhaustive: fuzzy.length <= boundedLimit,
    truncated: fuzzy.length > boundedLimit,
  };
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
  if (/(^|[^a-z])a([^a-z]|$)/i.test(raw) || normalized.includes('普攻') || normalized.includes('普通攻击') || normalized.includes('重击')) return 'A';
  // DEF canonical vocabulary: B is 战技 and E is 连携技.  Keep this
  // resolver authoritative so tool results cannot teach the model the
  // reversed mapping.
  if (/(^|[^a-z])b([^a-z]|$)/i.test(raw) || normalized.includes('战技')) return 'B';
  if (/(^|[^a-z])e([^a-z]|$)/i.test(raw) || normalized.includes('连携')) return 'E';
  if (/(^|[^a-z])q([^a-z]|$)/i.test(raw) || normalized.includes('终结') || normalized.includes('大招')) return 'Q';
  if (normalized.includes('dot') || normalized.includes('持续')) return 'Dot';
  return '';
}

function describeDefSkillSemantic(skill = {}) {
  const skillType = String(skill.skillType || '').trim();
  const displayName = String(skill.skillDisplayName || '').trim();
  if (skillType === 'B') {
    return { category: 'battle-skill', label: '战技', aliases: ['战技', 'B'] };
  }
  if (skillType === 'E') {
    return { category: 'chain-skill', label: '连携技', aliases: ['连携', '连携技', 'E'] };
  }
  if (skillType === 'Q') {
    return { category: 'ultimate', label: '终结技', aliases: ['大招', '终结技', 'Q'] };
  }
  if (skillType === 'Dot') {
    return { category: 'damage-over-time', label: '持续伤害', aliases: ['持续', 'Dot'] };
  }
  if (skillType === 'A') {
    if (displayName.includes('下落')) {
      return { category: 'normal-attack', actionVariant: 'plunging', label: '下落攻击', aliases: ['下落攻击'] };
    }
    if (displayName.includes('处决')) {
      return { category: 'normal-attack', actionVariant: 'execution', label: '处决', aliases: ['处决'] };
    }
    return { category: 'normal-attack', actionVariant: 'heavy', label: '普通重击', aliases: ['重击', '普通重击', '普攻', '普通攻击', 'A'] };
  }
  return { category: 'unknown', label: skillType || '未知技能类型', aliases: [] };
}

function inferDefSkillActionVariant(text) {
  const normalized = normalizeDefToolText(text);
  if (normalized.includes('下落')) return 'plunging';
  if (normalized.includes('处决')) return 'execution';
  if (normalized.includes('重击') || normalized.includes('普攻') || normalized.includes('普通攻击')) return 'heavy';
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
  return `${button?.characterName || '未知'}-${button?.skillDisplayName || button?.skillType || '技能'}@${(button?.nodeIndex ?? 0) + 1}-${(button?.lineIndex ?? button?.staffIndex ?? 0) + 1}`;
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

function readDefEquipmentLibrarySource() {
  const library = readMainWorkbenchJson(EQUIPMENT_LIBRARY_STORAGE_KEY, null);
  if (library && typeof library === 'object' && Object.keys(library.gearSets || {}).length > 0) {
    return { library, storageKey: EQUIPMENT_LIBRARY_STORAGE_KEY };
  }
  const draft = readMainWorkbenchJson(EQUIPMENT_DRAFT_STORAGE_KEY, null);
  if (draft && typeof draft === 'object' && Object.keys(draft.gearSets || {}).length > 0) {
    return { library: draft, storageKey: EQUIPMENT_DRAFT_STORAGE_KEY };
  }
  try {
    const payload = JSON.parse(fs.readFileSync(nowStoragePath, 'utf-8'));
    const storedLibrary = payload?.storage?.local?.[EQUIPMENT_LIBRARY_STORAGE_KEY];
    if (storedLibrary && typeof storedLibrary === 'object' && Object.keys(storedLibrary.gearSets || {}).length > 0) {
      return { library: storedLibrary, storageKey: EQUIPMENT_LIBRARY_STORAGE_KEY };
    }
    const storedDraft = payload?.storage?.local?.[EQUIPMENT_DRAFT_STORAGE_KEY];
    if (storedDraft && typeof storedDraft === 'object' && Object.keys(storedDraft.gearSets || {}).length > 0) {
      return { library: storedDraft, storageKey: EQUIPMENT_DRAFT_STORAGE_KEY };
    }
  } catch {
    // The normal product path above deliberately remains authoritative. The
    // archive is only a renderer-less sidecar fallback.
  }
  return { library: { gearSets: {} }, storageKey: EQUIPMENT_LIBRARY_STORAGE_KEY };
}

function readDefEquipmentLibrary() {
  return readDefEquipmentLibrarySource().library;
}

function normalizeDefToolPercent(value, unit = '') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value ?? null;
  if (unit === 'percent' || Math.abs(value) <= 1) {
    return `${Number((value * 100).toFixed(2))}%`;
  }
  return value;
}

// Native catalog artifacts deliberately use their own stable serializer. A
// local-storage object can acquire keys in a different order after a normal
// renderer save; that must not make an unchanged catalog look like a new
// source revision.
function canonicalizeDefNativeCatalogValue(value) {
  if (Array.isArray(value)) return value.map(canonicalizeDefNativeCatalogValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) => {
    const entry = value[key];
    return entry === undefined ? [] : [[key, canonicalizeDefNativeCatalogValue(entry)]];
  }));
}

function serializeDefNativeCatalogValue(value) {
  return JSON.stringify(canonicalizeDefNativeCatalogValue(value));
}

function hashDefNativeCatalogValue(value) {
  return createHash('sha256').update(serializeDefNativeCatalogValue(value)).digest('hex');
}

function nativeCatalogText(value) {
  return normalizeDefToolText(String(value || '').normalize('NFKC'))
    .replace(/(?:套装|套)$/u, '');
}

function readDefNativeGearSetAliasIndex() {
  try {
    const knowledge = JSON.parse(fs.readFileSync(GAME_KNOWLEDGE_JSON_PATH, 'utf8'));
    const aliases = Array.isArray(knowledge?.gearSetAliases) ? knowledge.gearSetAliases : [];
    return new Map(aliases.flatMap((entry) => {
      const gearSetId = typeof entry?.gearSetId === 'string' ? entry.gearSetId.trim() : '';
      const terms = Array.isArray(entry?.terms) ? entry.terms : [];
      if (!gearSetId) return [];
      return terms
        .map((term) => nativeCatalogText(term))
        .filter((term) => term.length >= 2)
        .map((term) => [term, gearSetId]);
    }));
  } catch {
    // Alias data is a trusted convenience layer, never a reason to broaden
    // matching or manufacture a catalog when that local file is unavailable.
    return new Map();
  }
}

function nativeCatalogSafeBusinessValue(value, depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 10 || !value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) return value
    .map((item) => nativeCatalogSafeBusinessValue(item, depth + 1))
    .filter((item) => item !== undefined);
  const blocked = new Set([
    'selected', 'selection', 'selectedIndex', 'draft', 'ui', 'session',
    'chat', 'commandQueue', 'command', 'approval', 'checkout', 'timeline',
    'workNode', 'workspace', 'storage', 'localStorage', 'sessionStorage',
  ]);
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) => {
    if (blocked.has(key)) return [];
    const entry = nativeCatalogSafeBusinessValue(value[key], depth + 1);
    return entry === undefined ? [] : [[key, entry]];
  }));
}

function nativeEquipmentSlots(part) {
  if (part === '护甲') return ['armor'];
  if (part === '护手') return ['glove'];
  if (part === '配件') return ['accessory1', 'accessory2'];
  return [];
}

function projectDefNativeEquipment(equipment = {}, gearSet = {}) {
  return {
    domain: 'equipment',
    id: String(equipment.equipmentId || ''),
    name: String(equipment.name || ''),
    part: String(equipment.part || ''),
    availableSlots: nativeEquipmentSlots(String(equipment.part || '')),
    gearSet: {
      id: String(gearSet.gearSetId || ''),
      name: String(gearSet.name || ''),
    },
    ...(equipment.imgUrl ? { icon: String(equipment.imgUrl) } : {}),
    ...(equipment.fixedStat && typeof equipment.fixedStat === 'object'
      ? { fixedStat: nativeCatalogSafeBusinessValue(equipment.fixedStat) }
      : {}),
    effects: nativeCatalogSafeBusinessValue(equipment.effects || {}),
  };
}

function projectDefNativeGearSet(gearSet = {}) {
  const equipments = Object.values(gearSet.equipments || {})
    .filter((equipment) => equipment && typeof equipment === 'object')
    .map((equipment) => projectDefNativeEquipment(equipment, gearSet));
  return {
    domain: 'equipment',
    kind: 'gear-set',
    id: String(gearSet.gearSetId || ''),
    name: String(gearSet.name || ''),
    ...(gearSet.buffId ? { buffId: String(gearSet.buffId) } : {}),
    ...(gearSet.imgUrl ? { icon: String(gearSet.imgUrl) } : {}),
    equipments,
    threePieceBuffs: nativeCatalogSafeBusinessValue({
      ...(gearSet.threePieceBuff ? { single: gearSet.threePieceBuff } : {}),
      ...(gearSet.threePieceBuffs || {}),
    }),
  };
}

function projectDefNativeWeapon(raw = {}, fallbackId = '') {
  const id = String(raw.id || fallbackId || '').trim();
  const name = String(raw.name || '').trim();
  if (!id || !name) return null;
  return {
    domain: 'weapon',
    kind: 'weapon',
    id,
    name,
    type: String(raw.type || ''),
    ...(Number.isFinite(Number(raw.rarity)) ? { rarity: Number(raw.rarity) } : {}),
    ...(raw.description ? { description: String(raw.description) } : {}),
    ...(raw.imgUrl ? { icon: String(raw.imgUrl) } : {}),
    ...(raw.attackGrowth && typeof raw.attackGrowth === 'object'
      ? { attackGrowth: nativeCatalogSafeBusinessValue(raw.attackGrowth) }
      : {}),
    ...(raw.skills && typeof raw.skills === 'object'
      ? { skills: nativeCatalogSafeBusinessValue(raw.skills) }
      : {}),
  };
}

function nativeCatalogLeafFields(value, prefix = '', fields = []) {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (prefix) fields.push({ path: prefix, value });
    return fields;
  }
  if (!value || typeof value !== 'object') return fields;
  if (Array.isArray(value)) {
    value.forEach((item, index) => nativeCatalogLeafFields(item, `${prefix}[${index}]`, fields));
    return fields;
  }
  Object.keys(value).sort().forEach((key) => nativeCatalogLeafFields(value[key], prefix ? `${prefix}.${key}` : key, fields));
  return fields;
}

function nativeCatalogMinimalRecord(entity, query) {
  const normalized = nativeCatalogText(query);
  const matchedFields = nativeCatalogLeafFields(entity)
    .filter((field) => nativeCatalogText(field.value).includes(normalized))
    .map((field) => ({ path: field.path, value: field.value }));
  if (!matchedFields.length) return null;
  if (entity.domain === 'equipment') {
    return {
      domain: 'equipment',
      kind: 'equipment',
      id: entity.id,
      name: entity.name,
      part: entity.part,
      availableSlots: entity.availableSlots,
      gearSet: entity.gearSet,
      matchedFields,
    };
  }
  return {
    domain: 'weapon',
    kind: 'weapon',
    id: entity.id,
    name: entity.name,
    type: entity.type,
    ...(entity.rarity !== undefined ? { rarity: entity.rarity } : {}),
    matchedFields,
  };
}

function readDefNativeWeaponLibrarySource() {
  const library = readMainWorkbenchJson(WEAPON_LIBRARY_STORAGE_KEY, null);
  if (library && typeof library === 'object' && !Array.isArray(library) && Object.keys(library).length > 0) {
    return { library, storageKey: WEAPON_LIBRARY_STORAGE_KEY };
  }
  try {
    const archive = JSON.parse(fs.readFileSync(nowStoragePath, 'utf-8'));
    const stored = archive?.storage?.local?.[WEAPON_LIBRARY_STORAGE_KEY];
    if (stored && typeof stored === 'object' && !Array.isArray(stored) && Object.keys(stored).length > 0) {
      return { library: stored, storageKey: WEAPON_LIBRARY_STORAGE_KEY };
    }
  } catch {
    // Report a structured source-unavailable result below rather than using a
    // second unrelated source or manufacturing a catalog.
  }
  return { library: {}, storageKey: WEAPON_LIBRARY_STORAGE_KEY };
}

function buildDefNativeCatalogSnapshot(domain) {
  const capturedAt = Date.now();
  if (domain === 'equipment') {
    const source = readDefEquipmentLibrarySource();
    const gearSets = Object.values(source.library?.gearSets || {})
      .filter((gearSet) => gearSet && typeof gearSet === 'object')
      .map(projectDefNativeGearSet)
      .filter((gearSet) => gearSet.id && gearSet.name)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (!gearSets.length) return { ok: false, code: 'native-catalog-source-unavailable', message: 'The current equipment local library is unavailable or empty.', domain };
    const sourceValue = { domain, gearSets };
    return {
      ok: true,
      domain,
      source: {
        storageKey: source.storageKey,
        revision: `sha256:${hashDefNativeCatalogValue(sourceValue)}`,
        capturedAt,
      },
      gearSets,
      entities: gearSets.flatMap((gearSet) => gearSet.equipments),
    };
  }
  if (domain === 'weapon') {
    const source = readDefNativeWeaponLibrarySource();
    const entities = Object.entries(source.library || {})
      .map(([fallbackId, raw]) => projectDefNativeWeapon(raw, fallbackId))
      .filter(Boolean)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (!entities.length) return { ok: false, code: 'native-catalog-source-unavailable', message: 'The current weapon local library is unavailable or empty.', domain };
    const sourceValue = { domain, weapons: entities };
    return {
      ok: true,
      domain,
      source: {
        storageKey: source.storageKey,
        revision: `sha256:${hashDefNativeCatalogValue(sourceValue)}`,
        capturedAt,
      },
      entities,
    };
  }
  return { ok: false, code: 'native-catalog-domain-invalid', message: 'domain must be equipment or weapon.', domain };
}

function resolveDefNativeEquipmentGearSet(snapshot, query) {
  const normalized = nativeCatalogText(query);
  if (!normalized) return { ok: false, code: 'equipment-3plus1-set-query-required', message: 'A non-empty exact equipment set query is required.' };
  const gearSetAliases = readDefNativeGearSetAliasIndex();
  const aliasedGearSetIds = new Set([...gearSetAliases.entries()]
    .filter(([term]) => normalized === term || normalized.includes(term))
    .map(([, gearSetId]) => gearSetId));
  const matches = snapshot.gearSets.filter((gearSet) => {
    const identities = [gearSet.id, gearSet.name].map(nativeCatalogText).filter(Boolean);
    return aliasedGearSetIds.has(gearSet.id)
      || identities.some((identity) => normalized === identity || normalized.includes(identity));
  });
  if (matches.length !== 1) {
    return {
      ok: false,
      code: matches.length === 0 ? 'equipment-3plus1-set-not-found' : 'equipment-3plus1-set-ambiguous',
      message: matches.length === 0
        ? 'The materialized equipment catalog does not contain one exact matching set.'
        : 'The set query resolves to multiple catalog sets; choose one exact set name.',
      candidates: matches.map((item) => ({ id: item.id, name: item.name })),
    };
  }
  return { ok: true, set: matches[0] };
}

function projectDefEquipmentThreePlusOnePiece(item, { slot, setPieceCount, selectionReason }) {
  return {
    stableId: item.id,
    name: item.name,
    part: item.part,
    slot,
    availableSlots: item.availableSlots,
    gearSet: item.gearSet,
    fixedStat: item.fixedStat || null,
    effects: item.effects || {},
    setPieceCount,
    selectionReason,
  };
}

function buildDefEquipmentThreePlusOneFacts(input = {}) {
  const expectedRevision = typeof input.sourceRevision === 'string' ? input.sourceRevision.trim() : '';
  const setQuery = typeof input.setQuery === 'string' ? input.setQuery.trim() : '';
  if (!expectedRevision) {
    return { ok: false, code: 'equipment-3plus1-source-revision-required', message: 'This 3+1 facts request must name the source revision from a native catalog artifact.' };
  }
  const snapshot = buildDefNativeCatalogSnapshot('equipment');
  if (!snapshot.ok) return snapshot;
  if (snapshot.source.revision !== expectedRevision) {
    return {
      ok: false,
      code: 'equipment-3plus1-source-revision-stale',
      message: 'The equipment catalog changed after the native artifact was materialized. Capture a fresh artifact before planning.',
      expectedSourceRevision: expectedRevision,
      actualSourceRevision: snapshot.source.revision,
    };
  }
  const resolved = resolveDefNativeEquipmentGearSet(snapshot, setQuery);
  if (!resolved.ok) return { ...resolved, source: snapshot.source, setQuery };
  const gearSet = resolved.set;
  const byPart = {
    armor: gearSet.equipments.filter((item) => item.availableSlots.includes('armor')),
    glove: gearSet.equipments.filter((item) => item.availableSlots.includes('glove')),
    accessory: gearSet.equipments.filter((item) => item.availableSlots.includes('accessory1') || item.availableSlots.includes('accessory2')),
  };
  const offSetAccessories = snapshot.entities
    .filter((item) => item.gearSet?.id !== gearSet.id
      && (item.availableSlots.includes('accessory1') || item.availableSlots.includes('accessory2')))
    .sort((left, right) => left.id.localeCompare(right.id));
  const allStructures = byPart.armor.flatMap((armor) => byPart.glove.flatMap((glove) => byPart.accessory.map((accessory) => ({
    setPieceCount: 3,
    setPieces: [
      projectDefEquipmentThreePlusOnePiece(armor, {
        slot: 'armor',
        setPieceCount: 3,
        selectionReason: 'Required target-set armor for the requested three-piece topology; no attribute ranking was applied.',
      }),
      projectDefEquipmentThreePlusOnePiece(glove, {
        slot: 'glove',
        setPieceCount: 3,
        selectionReason: 'Required target-set glove for the requested three-piece topology; no attribute ranking was applied.',
      }),
      projectDefEquipmentThreePlusOnePiece(accessory, {
        slot: 'accessory1',
        setPieceCount: 3,
        selectionReason: 'Required target-set accessory for the requested three-piece topology; no attribute ranking was applied.',
      }),
    ],
    plusOne: {
      requiredPart: '配件',
      slot: 'accessory2',
      availableSlots: ['accessory1', 'accessory2'],
      excludedGearSetId: gearSet.id,
      selectionReason: 'The fourth item must be an off-set accessory. It is intentionally unranked until primary and secondary attribute priorities are supplied.',
      candidates: offSetAccessories.map((item) => projectDefEquipmentThreePlusOnePiece(item, {
        slot: 'accessory2',
        setPieceCount: 0,
        selectionReason: 'Off-set accessory candidate; no preference-derived ranking or elemental trigger inference was applied.',
      })),
      candidatesExhaustive: true,
    },
  }))));
  const structures = allStructures.slice(0, 24);
  if (!structures.length) {
    return {
      ok: false,
      code: 'equipment-3plus1-slot-structure-unavailable',
      message: 'The exact set cannot form one armor, one glove, and one accessory structure from this catalog.',
      source: snapshot.source,
      targetSet: gearSet,
    };
  }
  return {
    ok: true,
    contract: DEF_EQUIPMENT_THREE_PLUS_ONE_FACTS_CONTRACT,
    state: 'REQUIRES_ATTRIBUTE_PREFERENCE',
    source: snapshot.source,
    characterId: typeof input.characterId === 'string' && input.characterId.trim() ? input.characterId.trim() : null,
    setQuery,
    targetSet: gearSet,
    targetSetPieceCount: 3,
    targetSetThreePieceBuffs: gearSet.threePieceBuffs || {},
    structures,
    structuresExhaustive: allStructures.length <= structures.length,
    missingReasons: [{
      code: 'attribute-preference-required',
      message: 'The catalog proves slot topology and each item’s fixedStat/effects, but it does not define this character’s desired primary or secondary attributes.',
      requiredInput: ['preferredFixedStatTypeKey', 'preferredEffectTypeKeys'],
    }],
    nextAction: 'State the desired fixed stat and ordered secondary-effect type keys before asking for a ranked +1 item. Until then, report only these catalog facts and do not recommend or apply one off-set item.',
  };
}

function buildDefNativeCatalogArtifact(input = {}) {
  const domain = typeof input.domain === 'string' ? input.domain.trim() : '';
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (!query) return { ok: false, code: 'native-catalog-query-required', message: 'A non-empty equipment or weapon query is required; an empty query cannot materialize a full domain.' };
  const snapshot = buildDefNativeCatalogSnapshot(domain);
  if (!snapshot.ok) return snapshot;
  const normalized = nativeCatalogText(query);
  const entityFull = (entity, reason) => ({
    ok: true,
    contract: DEF_NATIVE_CATALOG_ARTIFACT_CONTRACT,
    domain,
    query,
    selectionMode: 'entity-full',
    selectionReason: reason,
    source: snapshot.source,
    files: [{ path: 'entity.full.json', records: 1, content: `${JSON.stringify(canonicalizeDefNativeCatalogValue(entity), null, 2)}\n` }],
  });
  if (domain === 'equipment') {
    const resolvedSet = resolveDefNativeEquipmentGearSet(snapshot, query);
    if (resolvedSet.ok) return entityFull(resolvedSet.set, 'exact-gear-set');
  }
  const exactEntities = snapshot.entities.filter((entity) => [entity.id, entity.name].map(nativeCatalogText).some((identity) => identity === normalized));
  if (exactEntities.length === 1) return entityFull(exactEntities[0], 'exact-entity');
  const minimal = snapshot.entities.map((entity) => nativeCatalogMinimalRecord(entity, query)).filter(Boolean);
  if (minimal.length) {
    const content = `${minimal.map((record) => JSON.stringify(canonicalizeDefNativeCatalogValue(record))).join('\n')}\n`;
    return {
      ok: true,
      contract: DEF_NATIVE_CATALOG_ARTIFACT_CONTRACT,
      domain,
      query,
      selectionMode: 'substring-minimal',
      selectionReason: 'deterministic-substring',
      source: snapshot.source,
      files: [{ path: 'records.jsonl', records: minimal.length, content }],
    };
  }
  const fallback = domain === 'equipment' ? snapshot.gearSets : snapshot.entities;
  return {
    ok: true,
    contract: DEF_NATIVE_CATALOG_ARTIFACT_CONTRACT,
    domain,
    query,
    selectionMode: 'domain-full-fallback',
    selectionReason: 'no-deterministic-match',
    source: snapshot.source,
    files: [{
      path: 'domain.full.jsonl',
      records: fallback.length,
      content: `${fallback.map((record) => JSON.stringify(canonicalizeDefNativeCatalogValue(record))).join('\n')}\n`,
    }],
  };
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
    equipments: equipments.slice(0, 12),
    equipmentListExhaustive: equipments.length <= 12,
    equipmentListTruncated: equipments.length > 12,
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
  const lineIndex = Number.isInteger(input.lineIndex) ? input.lineIndex : null;
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
  if (lineIndex !== null) {
    buttons = buttons.filter((button) => button.lineIndex === lineIndex);
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
    scope: 'selected',
    source: 'current-workbench-selection',
    exhaustive: false,
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
    scope: 'selected',
    source: 'current-workbench-selection',
    exhaustive: false,
    selectedCount: data.count,
    query,
    candidates,
    ambiguity: candidates.length !== 1,
    suggestedQuestion: candidates.length === 0
      ? '当前已选阵容中没有匹配干员；这不代表选人目录或外部知识库中不存在。若要查选人界面目录，请使用 catalog scope。'
      : candidates.length > 1
        ? '找到多个干员候选。请指定干员名称或第几个。'
        : '',
  };
}

function boundedDefLimit(value, fallback = 12, maximum = 24) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(Math.floor(numeric), maximum));
}

function compactDefOperatorCatalogEntry(raw, fallbackId) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || fallbackId || '').trim();
  const name = String(raw.name || '').trim();
  if (!id || !name) return null;
  const skills = Array.isArray(raw.skills) ? raw.skills : [];
  return {
    id,
    name,
    element: String(raw.element || '').trim(),
    profession: String(raw.profession || '').trim(),
    rarity: Number.isFinite(Number(raw.rarity)) ? Number(raw.rarity) : null,
    weapon: String(raw.weapon || '').trim(),
    skillTypes: skills.map((skill) => String(skill?.buttonType || skill?.type || '')).filter(Boolean).slice(0, 8),
  };
}

function listDefOperatorCatalog(input = {}) {
  const library = readMainWorkbenchJson(OPERATOR_CATALOG_STORAGE_KEY, {});
  const entries = library && typeof library === 'object' && !Array.isArray(library)
    ? Object.entries(library).map(([fallbackId, raw]) => compactDefOperatorCatalogEntry(raw, fallbackId)).filter(Boolean)
    : [];
  const rawQuery = input.query || input.name || input.text || '';
  const query = normalizeDefToolText(rawQuery);
  const limit = boundedDefLimit(input.limit, 12);
  const matched = entries
    .filter((character) => !query || normalizeDefToolText(`${character.name} ${character.id} ${character.element} ${character.profession}`).includes(query))
    .map((character) => ({ ...character, confidence: normalizeDefToolText(character.name) === query ? 1 : 0.8 }));
  const candidates = matched.slice(0, limit);
  return {
    scope: 'catalog',
    source: 'selection-screen-local-library',
    catalogCount: entries.length,
    count: candidates.length,
    query,
    candidates,
    ambiguity: matched.length !== 1,
    exhaustive: matched.length <= limit,
    truncated: matched.length > limit,
    suggestedQuestion: matched.length === 0
      ? '选人目录中没有匹配干员。此结果只覆盖当前本地选人目录，不代表外部游戏知识库。'
      : matched.length > 1
        ? '选人目录中有多个候选。请指定干员名称或 id。'
        : '',
  };
}

function compactDefWeaponLibraryEntry(raw, fallbackId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = String(raw.id || fallbackId || '').trim();
  const name = String(raw.name || '').trim();
  if (!id || !name) return null;
  const skills = raw.skills && typeof raw.skills === 'object' && !Array.isArray(raw.skills)
    ? Object.keys(raw.skills).filter((key) => raw.skills[key] && typeof raw.skills[key] === 'object').slice(0, 3)
    : [];
  return {
    id,
    name,
    type: String(raw.type || '').trim(),
    rarity: Number.isFinite(Number(raw.rarity)) ? Number(raw.rarity) : null,
    skillKeys: skills,
  };
}

function resolveDefWeaponQuery(entries, rawQuery, limit = 12) {
  const query = normalizeDefToolText(rawQuery);
  const ranked = rankDefResourceCandidates(entries.map((weapon) => buildDefRankedSearchRecord({
    ...weapon,
    kind: 'weapon',
    scope: 'catalog',
    source: 'operator-config-weapon-library',
  }, [weapon.name, weapon.id, weapon.type])), rawQuery, boundedDefLimit(limit, 12));
  return {
    contract: 'DefWeaponResolutionV2',
    scope: 'catalog',
    source: 'operator-config-weapon-library',
    catalogCount: entries.length,
    count: ranked.candidates.length,
    query,
    candidates: ranked.candidates,
    ambiguity: ranked.candidates.length !== 1 || ranked.candidates[0]?.matchMethod === 'fuzzy',
    exhaustive: ranked.exhaustive,
    truncated: ranked.truncated,
    suggestedQuestion: ranked.candidates.length === 0
      ? '干员配置页武器库中没有匹配武器；这不代表外部游戏资料不存在。'
      : ranked.candidates.length > 1 || ranked.candidates[0]?.matchMethod === 'fuzzy'
        ? '干员配置页武器库中有多个或近似候选。请根据名称、id、类型和匹配置信度确认。'
        : '',
  };
}

function resolveDefWeapons(input = {}) {
  const library = readMainWorkbenchJson(WEAPON_LIBRARY_STORAGE_KEY, {});
  const entries = library && typeof library === 'object' && !Array.isArray(library)
    ? Object.entries(library).map(([fallbackId, raw]) => compactDefWeaponLibraryEntry(raw, fallbackId)).filter(Boolean)
    : [];
  const queries = Array.isArray(input.queries)
    ? [...new Set(input.queries.map((query) => String(query || '').trim()).filter(Boolean))].slice(0, 8)
    : [];
  if (queries.length) {
    const results = queries.map((query) => resolveDefWeaponQuery(entries, query, input.limitPerQuery || 5));
    return {
      contract: 'DefWeaponBatchResolutionV2',
      scope: 'catalog',
      source: 'operator-config-weapon-library',
      catalogCount: entries.length,
      queryCount: results.length,
      exhaustive: results.every((result) => result.exhaustive),
      truncated: results.some((result) => result.truncated),
      results,
    };
  }
  return resolveDefWeaponQuery(entries, input.query || input.name || input.text || '', input.limit || 12);
}

function selectedDefCharacterIds(input = {}) {
  const supplied = Array.isArray(input.characterIds) ? input.characterIds : [];
  return [...new Set(supplied
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean))];
}

function defOperatorSkillNames(rawOperator = {}) {
  const grouped = { A: [], B: [], E: [], Q: [] };
  const skills = rawOperator?.skills && typeof rawOperator.skills === 'object'
    ? Object.values(rawOperator.skills)
    : [];
  for (const skill of skills) {
    const type = String(skill?.buttonType || skill?.type || '').trim();
    const name = String(skill?.displayName || skill?.name || '').trim();
    if (Object.hasOwn(grouped, type) && name && !grouped[type].includes(name)) grouped[type].push(name);
  }
  return grouped;
}

function defSelectedTeamLoadoutFromSnapshot(snapshot, input = {}) {
  const selectedCharacters = Array.isArray(snapshot?.selectedCharacters) ? snapshot.selectedCharacters : [];
  const operatorConfigs = Array.isArray(snapshot?.operatorConfigs) ? snapshot.operatorConfigs : [];
  const requestedIds = selectedDefCharacterIds(input);
  const selectedById = new Map(selectedCharacters.map((character) => [String(character?.id || ''), character]));
  const catalog = readMainWorkbenchJson(OPERATOR_CATALOG_STORAGE_KEY, {});
  const catalogById = catalog && typeof catalog === 'object' && !Array.isArray(catalog) ? catalog : {};
  const missing = requestedIds
    .filter((characterId) => !selectedById.has(characterId))
    .map((characterId) => ({
      code: 'selected-character-not-found',
      component: 'team-loadouts',
      characterId,
      message: '该 characterId 不在当前已选队伍中。',
    }));
  const selected = requestedIds.length
    ? requestedIds.map((characterId) => selectedById.get(characterId)).filter(Boolean)
    : selectedCharacters;
  const operators = selected.map((character, index) => {
    const characterId = String(character?.id || '');
    const rawOperator = catalogById[characterId] && typeof catalogById[characterId] === 'object'
      ? catalogById[characterId]
      : null;
    const config = operatorConfigs.find((entry) => entry?.characterId === characterId) || null;
    const operatorMissing = [];
    if (!rawOperator) {
      operatorMissing.push({
        code: 'operator-catalog-entry-unavailable',
        component: 'team-loadouts',
        characterId,
        message: '当前选人目录没有该干员的结构化武器类型和技能数据。',
      });
    }
    if (!config) {
      operatorMissing.push({
        code: 'operator-loadout-unavailable',
        component: 'team-loadouts',
        characterId,
        message: '当前快照没有该干员的已保存配装；未按默认值补全。',
      });
    }
    const equipment = Array.isArray(config?.equipment) ? config.equipment.map((piece) => ({
      slotKey: String(piece?.slotKey || ''),
      equipmentId: String(piece?.equipmentId || ''),
      name: String(piece?.name || ''),
      part: String(piece?.part || ''),
      effects: Array.isArray(piece?.effects) ? piece.effects.map((effect) => ({
        effectId: String(effect?.effectId || ''),
        label: String(effect?.label || ''),
        typeKey: String(effect?.typeKey || ''),
        level: typeof effect?.level === 'number' ? effect.level : null,
        value: typeof effect?.value === 'number' ? effect.value : null,
      })) : [],
    })) : [];
    const weapon = config?.weapon && typeof config.weapon === 'object' ? {
      id: String(config.weapon.id || ''),
      name: String(config.weapon.name || ''),
      level: typeof config.weapon.level === 'number' ? config.weapon.level : null,
      potential: config.weapon.potential ?? null,
      skillLevels: {
        skill1: typeof config.weapon.skillLevels?.skill1 === 'number' ? config.weapon.skillLevels.skill1 : null,
        skill2: typeof config.weapon.skillLevels?.skill2 === 'number' ? config.weapon.skillLevels.skill2 : null,
        skill3: typeof config.weapon.skillLevels?.skill3 === 'number' ? config.weapon.skillLevels.skill3 : null,
      },
    } : null;
    const operatorSkillLevels = config?.operatorSkillLevels && typeof config.operatorSkillLevels === 'object' ? {
      A: config.operatorSkillLevels.A ?? null,
      B: config.operatorSkillLevels.B ?? null,
      E: config.operatorSkillLevels.E ?? null,
      Q: config.operatorSkillLevels.Q ?? null,
    } : { A: null, B: null, E: null, Q: null };
    missing.push(...operatorMissing);
    return {
      index,
      characterId,
      characterName: String(character?.name || rawOperator?.name || ''),
      element: String(character?.element || rawOperator?.element || ''),
      profession: String(character?.profession || rawOperator?.profession || ''),
      weaponType: rawOperator ? String(rawOperator.weapon || '') : null,
      skills: rawOperator ? defOperatorSkillNames(rawOperator) : { A: [], B: [], E: [], Q: [] },
      operatorSkillLevels,
      weapon,
      equipment,
      setBuffs: Array.isArray(config?.setBuffs) ? config.setBuffs.map((buff) => ({
        gearSetId: String(buff?.gearSetId || ''),
        gearSetName: String(buff?.gearSetName || ''),
        effectId: String(buff?.effectId || ''),
        label: String(buff?.label || ''),
        typeKey: String(buff?.typeKey || ''),
        value: typeof buff?.value === 'number' ? buff.value : null,
      })) : [],
    };
  });
  const gate = input.__defCurrentGate;
  const axis = gate?.axisContext || null;
  const checkout = axis?.checkout || null;
  // The UI checkout timestamp identifies the selected target, but it is not
  // the optimistic-concurrency revision used by prepared operator-config
  // children. Bind a team plan to the same repository-node revision that the
  // serial apply path will CAS-check.
  const checkoutNode = checkout?.targetType === 'work-node' && checkout?.targetId
    ? readRepositoryWorkNode(checkout.targetId)
    : null;
  const checkoutRevision = Number(checkoutNode?.contentRevision || checkoutNode?.updatedAt || checkout?.updatedAt);
  return {
    protocolVersion: 1,
    contract: 'DefSelectedTeamLoadoutsV1',
    scope: 'selected',
    source: {
      snapshot: 'main-workbench-snapshot-mirror',
      operatorCatalog: 'selection-screen-local-library',
      checkout: 'timeline-repository',
    },
    snapshotUpdatedAt: snapshot?.updatedAt || null,
    checkout: {
      timelineId: gate?.binding?.timelineId || '',
      targetType: checkout?.targetType || null,
      targetId: checkout?.targetId || null,
      revision: Number.isFinite(checkoutRevision) ? checkoutRevision : null,
    },
    selectedCount: selectedCharacters.length,
    complete: missing.length === 0,
    operators,
    missing,
    truncated: false,
  };
}

function readDefSelectedTeamLoadouts(input = {}) {
  const snapshot = input.__defCurrentGate?.snapshot || readMainWorkbenchSnapshotMirror();
  if (!snapshot || typeof snapshot !== 'object') return null;
  return defSelectedTeamLoadoutFromSnapshot(snapshot, input);
}

function compactDefLoadoutCandidateGearSet(gearSet = {}) {
  const equipments = Object.values(gearSet?.equipments || {})
    .filter((equipment) => equipment && typeof equipment === 'object')
    .slice(0, 4)
    .map((equipment) => ({
      name: String(equipment.name || ''),
      part: String(equipment.part || ''),
    }));
  const buffs = [
    ...(gearSet?.threePieceBuff ? [gearSet.threePieceBuff] : []),
    ...Object.values(gearSet?.threePieceBuffs || {}),
  ].filter((buff) => buff && typeof buff === 'object').slice(0, 2).map((buff) => ({
    effectId: String(buff.effectId || ''),
    label: String(buff.name || buff.label || buff.effectId || ''),
    typeKey: String(buff.typeKey || ''),
    value: typeof buff.value === 'number' ? normalizeDefToolPercent(buff.value, buff.unit) : null,
  }));
  return {
    gearSetId: String(gearSet.gearSetId || ''),
    name: String(gearSet.name || ''),
    equipmentPieces: equipments,
    threePieceBuffs: buffs,
  };
}

function readDefLoadoutCandidates(input = {}) {
  const snapshot = input.__defCurrentGate?.snapshot || readMainWorkbenchSnapshotMirror();
  if (!snapshot || typeof snapshot !== 'object') return null;
  const team = defSelectedTeamLoadoutFromSnapshot(snapshot, input);
  const include = Array.isArray(input.include) && input.include.length
    ? [...new Set(input.include.filter((kind) => kind === 'weapon' || kind === 'equipment'))]
    : ['weapon', 'equipment'];
  const limitPerOperator = boundedDefLimit(input.limitPerOperator, 4, 4);
  const weaponLibrary = readMainWorkbenchJson(WEAPON_LIBRARY_STORAGE_KEY, {});
  const weapons = weaponLibrary && typeof weaponLibrary === 'object' && !Array.isArray(weaponLibrary)
    ? Object.entries(weaponLibrary).map(([fallbackId, raw]) => compactDefWeaponLibraryEntry(raw, fallbackId)).filter(Boolean)
    : [];
  const equipmentLibrary = readDefEquipmentLibrary();
  const gearSets = equipmentLibrary?.gearSets && typeof equipmentLibrary.gearSets === 'object'
    ? Object.values(equipmentLibrary.gearSets).filter((set) => set && typeof set === 'object').map(compactDefLoadoutCandidateGearSet)
    : [];
  const goal = typeof input.goal === 'string' ? input.goal.trim().slice(0, 240) : '';
  // One exact-team lookup is more useful than repeatedly translating a
  // natural-language goal into aliases. This is an index citation, not an
  // excerpt: a guide fact is usable only after the caller reads the returned
  // exact section through def.knowledge.game.section.read.
  const evidenceQuery = [
    team.operators.map((operator) => operator.characterName).filter(Boolean).join(' '),
    goal,
  ].filter(Boolean).join(' ');
  const evidence = evidenceQuery ? searchDefGameKnowledge({ query: evidenceQuery, limit: 3 }).candidates.slice(0, 3).map((candidate) => ({
    referenceId: candidate.referenceId,
    title: candidate.title,
    source: candidate.source,
    section: candidate.recommendedSection || null,
    availableSections: candidate.headings,
    state: candidate.recommendedSection ? 'section-read-required' : 'no-section-match',
  })) : [];
  let truncated = false;
  const missingReasons = [...team.missing];
  const operators = team.operators.map((operator) => {
    const reasons = team.missing.filter((reason) => reason.characterId === operator.characterId);
    const type = typeof operator.weaponType === 'string' ? operator.weaponType : '';
    const compatibleWeapons = type
      ? weapons.filter((weapon) => normalizeDefToolText(weapon.type) === normalizeDefToolText(type))
      : [];
    const weaponCandidates = include.includes('weapon') ? compatibleWeapons.slice(0, limitPerOperator).map((weapon) => ({
      id: weapon.id,
      name: weapon.name,
      rarity: weapon.rarity,
    })) : [];
    // Equipment compatibility is not operator-specific in the product model.
    // Keep detailed four-piece set facts once at bundle scope and use tiny,
    // stable references per operator so the response stays directly usable by
    // OpenCode instead of being spilled into a follow-up file read.
    const equipmentSetCandidates = include.includes('equipment')
      ? gearSets.slice(0, limitPerOperator).map((gearSet) => gearSet.gearSetId)
      : [];
    if (include.includes('weapon') && !type) {
      reasons.push({
        code: 'weapon-type-unavailable',
        component: 'loadout-candidates',
        characterId: operator.characterId,
        message: '没有结构化 weaponType，未使用干员名称搜索武器库。',
      });
    } else if (include.includes('weapon') && compatibleWeapons.length === 0) {
      reasons.push({
        code: 'compatible-weapon-unavailable',
        component: 'loadout-candidates',
        characterId: operator.characterId,
        message: '当前本地武器库没有该 weaponType 的候选。',
      });
    }
    if (include.includes('equipment') && gearSets.length === 0) {
      reasons.push({
        code: 'equipment-library-unavailable',
        component: 'loadout-candidates',
        characterId: operator.characterId,
        message: '当前本地装备库没有可返回的套装候选。',
      });
    }
    if ((include.includes('weapon') && compatibleWeapons.length > limitPerOperator) || (include.includes('equipment') && gearSets.length > limitPerOperator)) truncated = true;
    missingReasons.push(...reasons.filter((reason) => !missingReasons.includes(reason)));
    return {
      characterId: operator.characterId,
      characterName: operator.characterName,
      weaponType: operator.weaponType,
      currentLoadout: {
        state: operator.weapon || operator.equipment.length ? 'configured' : 'unconfigured',
        weaponName: operator.weapon?.name || null,
        equipmentCount: operator.equipment.length,
      },
      weaponCandidates,
      equipmentSetCandidates,
      missingReasons: reasons,
    };
  });
  return {
    protocolVersion: 1,
    contract: 'DefLoadoutCandidateBundleV1',
    scope: 'selected',
    source: {
      team: team.source,
      weaponLibrary: 'operator-config-weapon-library',
      equipmentLibrary: 'operator-config-equipment-library',
      ...(goal ? { evidence: 'allowlisted-game-knowledge-reference-index' } : {}),
    },
    snapshotUpdatedAt: team.snapshotUpdatedAt,
    checkout: team.checkout,
    include,
    goal: goal || null,
    limitPerOperator,
    operators,
    equipmentSetCandidates: include.includes('equipment') ? gearSets.slice(0, limitPerOperator).map((gearSet) => ({
      ...gearSet,
      source: 'operator-config-equipment-library',
    })) : [],
    evidence,
    exhaustive: !truncated,
    truncated,
    missingReasons,
  };
}

function safeGameKnowledgeReferenceFiles() {
  const root = fs.realpathSync(GAME_KNOWLEDGE_REFERENCES_DIR);
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => {
      const target = path.join(root, entry.name);
      const resolved = fs.realpathSync(target);
      if (!resolved.startsWith(`${root}${path.sep}`)) return null;
      return { id: entry.name, path: resolved };
    })
    .filter(Boolean);
}

const GAME_KNOWLEDGE_SECTION_MAX_CHARS = 12_000;
const GAME_KNOWLEDGE_SEARCH_ALIAS_TERMS = Object.freeze([
  ['yz', '月咒'],
  ['月咒', 'yz'],
  ['新手', '萌新'],
  ['萌新', '新手'],
  ['配装', '装备'],
  ['养成', '装备'],
]);
const GAME_KNOWLEDGE_QUERY_KEYWORDS = Object.freeze([
  '新手', '萌新', '碎冰', '装备', '配装', '养成', '武器', '攻略', '配队', '排轴',
]);

function gameKnowledgeSectionId(level, heading, counts) {
  const normalized = String(heading || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{Script=Han}a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'section';
  const base = `h${level}-${normalized}`;
  const seen = (counts.get(base) || 0) + 1;
  counts.set(base, seen);
  return seen === 1 ? base : `${base}-${seen}`;
}

function indexGameKnowledgeSections(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const counts = new Map();
  const headings = [];
  const stack = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const match = lines[lineIndex].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const level = match[1].length;
    const heading = match[2].trim();
    while (stack.length && stack.at(-1).level >= level) stack.pop();
    const entry = {
      sectionId: gameKnowledgeSectionId(level, heading, counts),
      heading,
      level,
      lineStart: lineIndex,
      parentSectionId: stack.at(-1)?.sectionId || null,
      lineEnd: lines.length,
    };
    headings.push(entry);
    stack.push(entry);
  }
  for (let index = 0; index < headings.length; index += 1) {
    const current = headings[index];
    const nextBoundary = headings.slice(index + 1).find((entry) => entry.level <= current.level);
    current.lineEnd = nextBoundary ? nextBoundary.lineStart : lines.length;
  }
  return { lines, headings };
}

function gameKnowledgeQueryTerms(query) {
  const raw = String(query || '').normalize('NFKC').toLowerCase();
  const namedTerms = raw.match(/[\p{Script=Han}]{2,}|[a-z0-9]{2,}/gu) || [];
  const expanded = [...namedTerms];
  for (const keyword of GAME_KNOWLEDGE_QUERY_KEYWORDS) {
    if (raw.includes(keyword)) expanded.push(keyword);
  }
  for (const [from, to] of GAME_KNOWLEDGE_SEARCH_ALIAS_TERMS) {
    if (raw.includes(from)) expanded.push(to);
  }
  const normalized = expanded.map((term) => normalizeDefToolText(term)).filter(Boolean);
  return normalized.length ? [...new Set(normalized)] : [normalizeDefToolText(raw)].filter(Boolean);
}

function compactGameKnowledgeHeading(entry) {
  return {
    sectionId: entry.sectionId,
    heading: entry.heading,
    level: entry.level,
    parentSectionId: entry.parentSectionId,
  };
}

function scoreGameKnowledgeReference(reference, queryTerms, query) {
  const title = normalizeDefToolText(reference.title || reference.id);
  const body = normalizeDefToolText(reference.text);
  const matchedTerms = queryTerms.filter((term) => body.includes(term));
  if (queryTerms.length && matchedTerms.length === 0) return null;
  const headingMatches = reference.index.headings.filter((entry) => {
    const section = reference.text.slice(
      reference.lineOffsets[entry.lineStart] || 0,
      reference.lineOffsets[entry.lineEnd] || reference.text.length,
    );
    const searchable = normalizeDefToolText(`${entry.heading}\n${section}`);
    return matchedTerms.some((term) => searchable.includes(term));
  });
  const normalizedQuery = normalizeDefToolText(query);
  const asksBeginnerIceTeam = (normalizedQuery.includes('新手') || normalizedQuery.includes('萌新')) && normalizedQuery.includes('碎冰');
  const score = matchedTerms.reduce((total, term) => total + (title.includes(term) ? 4 : 1), 0)
    + headingMatches.reduce((total, entry) => total + (normalizeDefToolText(entry.heading).includes('装备') || normalizeDefToolText(entry.heading).includes('养成') ? 0.25 : 0), 0);
  // “新手碎冰” is a joint guide intent, not two unrelated common words.
  // Prefer a beginner-labelled reference that actually contains the ice-team
  // material over a generic YZ/装备 guide whose title merely has more tokens.
  const intentBonus = asksBeginnerIceTeam && title.includes('萌新') && body.includes('碎冰') ? 20 : 0;
  return { score: score + intentBonus, matchedTerms, headingMatches };
}

function preferredGameKnowledgeSection(reference, headingMatches, queryTerms) {
  const beginnerIceBuild = queryTerms.some((term) => term.includes('新手') || term.includes('萌新'))
    && queryTerms.some((term) => term.includes('碎冰'))
    && /弭弗.*陈千语.*埃特拉.*阿列什/.test(reference.title);
  const equipmentRequest = beginnerIceBuild || queryTerms.some((term) => ['装备', '配装', '养成', '武器'].includes(term));
  const candidates = equipmentRequest
    ? reference.index.headings.filter((entry) => entry.level === 2 && /装备|养成|配装/.test(entry.heading))
    : headingMatches;
  return (candidates[0] || headingMatches[0] || reference.index.headings[0])
    ? compactGameKnowledgeHeading(candidates[0] || headingMatches[0] || reference.index.headings[0])
    : null;
}

function gameKnowledgeExactReadPolicy(reference, recommendedSection) {
  if (!recommendedSection) return null;
  return {
    mode: 'single-exact-section',
    maxSectionReads: 1,
    requiredSectionId: recommendedSection.sectionId,
    reason: '此检索已给出完成当前攻略问题所需的精读章节；不得再读取概述或其他章节。',
    rosterSource: /弭弗.*陈千语.*埃特拉.*阿列什/.test(reference.title) ? 'reference-title' : null,
  };
}

function readGameKnowledgeReference(referenceId) {
  const requested = String(referenceId || '').trim();
  if (!requested || requested !== path.basename(requested) || requested.includes(path.sep) || requested.includes('/') || requested.includes('\\')) {
    return { error: { status: 400, code: 'invalid-game-knowledge-reference', message: 'referenceId 必须是 allowlisted Markdown 文件名，不能包含路径。' } };
  }
  const allowed = safeGameKnowledgeReferenceFiles().find((reference) => reference.id === requested);
  if (!allowed) {
    return { error: { status: 404, code: 'game-knowledge-reference-not-allowed', message: 'referenceId 不在 allowlisted game-knowledge references 中。' } };
  }
  const root = fs.realpathSync(GAME_KNOWLEDGE_REFERENCES_DIR);
  const resolved = fs.realpathSync(allowed.path);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    return { error: { status: 403, code: 'game-knowledge-reference-outside-root', message: 'referenceId 未解析到允许的 references root。' } };
  }
  const text = fs.readFileSync(resolved, 'utf8').replace(/\r\n/g, '\n');
  const index = indexGameKnowledgeSections(text);
  const lineOffsets = [];
  let offset = 0;
  for (const line of index.lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }
  const title = index.headings.find((entry) => entry.level === 1)?.heading || requested.replace(/\.md$/i, '');
  return { reference: { id: requested, path: resolved, text, title, index, lineOffsets } };
}

function searchDefGameKnowledge(input = {}) {
  const query = String(input.query || input.name || input.text || '').trim();
  const queryTerms = gameKnowledgeQueryTerms(query);
  const limit = boundedDefLimit(input.limit, 3, 6);
  const matched = safeGameKnowledgeReferenceFiles()
    .map((entry) => readGameKnowledgeReference(entry.id).reference)
    .filter(Boolean)
    .map((reference) => ({ reference, ranking: scoreGameKnowledgeReference(reference, queryTerms, query) }))
    .filter((entry) => entry.ranking)
    .sort((left, right) => right.ranking.score - left.ranking.score || left.reference.id.localeCompare(right.reference.id, 'zh-Hans-CN'));
  const candidates = matched.slice(0, limit).map(({ reference, ranking }) => {
    const recommendedSection = preferredGameKnowledgeSection(reference, ranking.headingMatches, queryTerms);
    return {
      referenceId: reference.id,
      title: reference.title,
      source: `game-knowledge/references/${reference.id}`,
      matchedTerms: ranking.matchedTerms,
      headings: reference.index.headings.map(compactGameKnowledgeHeading),
      matchingSections: ranking.headingMatches.map(compactGameKnowledgeHeading),
      recommendedSection,
      exactReadPolicy: gameKnowledgeExactReadPolicy(reference, recommendedSection),
    };
  });
  return {
    protocolVersion: 1,
    contract: 'DefGameKnowledgeReferenceSearchV1',
    scope: 'allowlisted-game-knowledge-references',
    source: 'allowlisted-game-knowledge-skill',
    query,
    queryTerms,
    count: candidates.length,
    ambiguity: candidates.length !== 1,
    exhaustive: matched.length <= limit,
    truncated: matched.length > limit,
    candidates,
    suggestedQuestion: candidates.length === 0 ? '当前 allowlisted game-knowledge references 中没有匹配内容；这不表示游戏中不存在该角色或机制。' : '',
  };
}

function readDefGameKnowledgeSection(input = {}) {
  const loaded = readGameKnowledgeReference(input.referenceId);
  if (loaded.error) return { ok: false, ...loaded.error, component: 'game-knowledge-section' };
  const reference = loaded.reference;
  const sectionId = String(input.sectionId || '').trim();
  const heading = String(input.heading || '').trim();
  const section = reference.index.headings.find((entry) => (
    (sectionId && entry.sectionId === sectionId) || (!sectionId && heading && entry.heading === heading)
  ));
  if (!section) {
    return {
      ok: false,
      status: 404,
      code: 'game-knowledge-section-not-found',
      component: 'game-knowledge-section',
      message: '该 reference 中不存在精确 sectionId 或 heading。请使用 reference search 返回的 headings。',
      availableSections: reference.index.headings.map(compactGameKnowledgeHeading),
    };
  }
  const cursor = Number.isInteger(input.cursor) && input.cursor >= 0 ? input.cursor : 0;
  const sectionText = reference.text.slice(
    reference.lineOffsets[section.lineStart] || 0,
    reference.lineOffsets[section.lineEnd] || reference.text.length,
  ).trim();
  const content = sectionText.slice(cursor, cursor + GAME_KNOWLEDGE_SECTION_MAX_CHARS);
  const nextCursor = cursor + content.length;
  const truncated = nextCursor < sectionText.length;
  return {
    ok: true,
    protocolVersion: 1,
    contract: 'DefGameKnowledgeSectionReadV1',
    scope: 'allowlisted-game-knowledge-section',
    source: `game-knowledge/references/${reference.id}`,
    referenceId: reference.id,
    title: reference.title,
    requested: { sectionId: section.sectionId, heading: section.heading, cursor },
    section: compactGameKnowledgeHeading(section),
    content,
    characterLimit: GAME_KNOWLEDGE_SECTION_MAX_CHARS,
    truncated,
    nextSection: truncated ? { referenceId: reference.id, sectionId: section.sectionId, cursor: nextCursor } : null,
    availableSections: reference.index.headings.map(compactGameKnowledgeHeading),
  };
}

function rememberDefGuideLoadoutSource(input = {}) {
  const sessionId = typeof input.__defSessionId === 'string' ? input.__defSessionId.trim() : '';
  const referenceId = typeof input.referenceId === 'string' ? input.referenceId.trim() : '';
  const sectionId = typeof input.sectionId === 'string' ? input.sectionId.trim() : '';
  const content = typeof input.content === 'string' ? input.content : '';
  if (!sessionId || !referenceId || !sectionId || !content) {
    return { ok: false, code: 'invalid-guide-plan-source', component: 'team-loadout-plan', message: 'A native session, exact reference, section and content are required.' };
  }
  const sourceContentHash = hashDefLoadoutPlan(content);
  pruneDefTeamLoadoutPlans();
  guideLoadoutPlanSources.set(sessionId, { sessionId, referenceId, sectionId, content, sourceContentHash, rememberedAt: Date.now(), expiresAt: Date.now() + PREPARED_TEAM_LOADOUT_TTL_MS });
  return { ok: true, sessionId, referenceId, sectionId, sourceContentHash };
}

function safeDefGuideLoadoutManifestFiles() {
  try {
    if (!fs.existsSync(GAME_KNOWLEDGE_LOADOUT_MANIFESTS_DIR)) return [];
    const root = fs.realpathSync(GAME_KNOWLEDGE_LOADOUT_MANIFESTS_DIR);
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(root, entry.name))
      .filter((candidate) => {
        try { return fs.realpathSync(candidate).startsWith(`${root}${path.sep}`); } catch { return false; }
      });
  } catch { return []; }
}

function readDefGuideLoadoutManifest(source) {
  for (const manifestPath of safeDefGuideLoadoutManifestFiles()) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest?.contract !== 'DefGuideTeamLoadoutManifestV1'
        || manifest?.referenceId !== source.referenceId
        || manifest?.sectionId !== source.sectionId
        || manifest?.sourceContentHash !== source.sourceContentHash
        || !Array.isArray(manifest?.operators)) continue;
      return { manifest, manifestPath: path.basename(manifestPath) };
    } catch { /* invalid companion manifests are not executable */ }
  }
  return null;
}

function defPlanNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function defPlanPercent(value, unit = '') {
  const numeric = defPlanNumber(value);
  return unit === 'percent' && Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
}

function defPlanEffectValue(effect = {}, level = 3) {
  const levels = effect?.levels && typeof effect.levels === 'object' ? effect.levels : {};
  const value = levels[String(level)] ?? levels[level] ?? effect?.value ?? 0;
  return defPlanPercent(value, String(effect?.unit || ''));
}

function findDefPlanEquipment(library, selection, usedEquipmentIds) {
  const all = Object.values(library?.gearSets || {}).flatMap((gearSet) => Object.values(gearSet?.equipments || {}).map((equipment) => ({ gearSet, equipment })));
  const exact = selection?.equipmentId
    ? all.filter(({ gearSet, equipment }) => gearSet?.gearSetId === selection.gearSetId && equipment?.equipmentId === selection.equipmentId)
    : all.filter(({ gearSet, equipment }) => (
      (!selection?.gearSetId || gearSet?.gearSetId === selection.gearSetId)
      && (!selection?.part || equipment?.part === selection.part)
      && (!selection?.effectType || Object.values(equipment?.effects || {}).some((effect) => effect?.typeKey === selection.effectType))
      && !usedEquipmentIds.has(String(equipment?.equipmentId || ''))
    ));
  const candidates = exact.sort((left, right) => `${left.gearSet?.gearSetId}:${left.equipment?.equipmentId}`.localeCompare(`${right.gearSet?.gearSetId}:${right.equipment?.equipmentId}`));
  if (candidates.length !== 1) return { error: candidates.length ? 'product-selector-ambiguous' : 'product-selector-empty' };
  const { gearSet, equipment } = candidates[0];
  if (selection?.name && selection.name !== equipment.name) return { error: 'product-name-mismatch' };
  const entryLevel = Number.isInteger(selection?.entryLevel) ? selection.entryLevel : 3;
  const effects = Object.values(equipment?.effects || {}).map((effect) => ({
    effectId: String(effect?.effectId || ''), label: String(effect?.label || effect?.effectId || ''), typeKey: String(effect?.typeKey || ''),
    level: entryLevel, value: defPlanEffectValue(effect, entryLevel), unit: String(effect?.unit || ''),
  }));
  return { product: { gearSetId: String(gearSet?.gearSetId || ''), gearSetName: String(gearSet?.name || ''), equipmentId: String(equipment?.equipmentId || ''), name: String(equipment?.name || ''), part: String(equipment?.part || ''), entryLevel, effects } };
}

function resolveDefPlanSelectedOperator(team, name) {
  const matches = (team?.operators || []).filter((operator) => normalizeDefToolText(operator?.characterName) === normalizeDefToolText(name));
  if (matches.length !== 1) return { error: matches.length ? 'selected-operator-name-ambiguous' : 'selected-operator-not-found' };
  const selected = matches[0];
  const catalog = readMainWorkbenchJson(OPERATOR_CATALOG_STORAGE_KEY, {});
  const catalogEntry = catalog && typeof catalog === 'object' ? catalog[selected.characterId] : null;
  if (!catalogEntry || String(catalogEntry?.name || '') !== selected.characterName) return { error: 'selected-operator-id-name-mismatch' };
  return { selected };
}

function computeDefPlanDerivedCharge(products, weapon, library) {
  const equipment = products.reduce((sum, product) => sum + product.effects
    .filter((effect) => effect.typeKey === 'ultimateChargeEfficiency')
    .reduce((effectSum, effect) => effectSum + defPlanNumber(effect.value), 0), 0);
  const weaponEffects = Object.values(weapon?.effects || {});
  const weaponCharge = weaponEffects.filter((effect) => effect?.typeKey === 'ultimateChargeEfficiency')
    .reduce((sum, effect) => sum + defPlanEffectValue(effect, Number(weapon?.level || 3)), 0);
  const setBonus = [...new Set(products.map((product) => product.gearSetId))].reduce((sum, gearSetId) => {
    const gearSet = Object.values(library?.gearSets || {}).find((set) => set?.gearSetId === gearSetId);
    const count = products.filter((product) => product.gearSetId === gearSetId).length;
    if (count < 3) return sum;
    return sum + [...(gearSet?.threePieceBuff ? [gearSet.threePieceBuff] : []), ...Object.values(gearSet?.threePieceBuffs || {})]
      .filter((buff) => buff?.typeKey === 'ultimateChargeEfficiency')
      .reduce((buffSum, buff) => buffSum + defPlanPercent(buff?.value, String(buff?.unit || '')), 0);
  }, 0);
  return { base: 100, equipment: Number(equipment.toFixed(2)), weapon: Number(weaponCharge.toFixed(2)), setBonus: Number(setBonus.toFixed(2)), total: Number((100 + equipment + weaponCharge + setBonus).toFixed(2)), unit: 'percent' };
}

function defPlanCheckoutMatches(checkout, gate) {
  const current = gate?.axisContext?.checkout || null;
  const currentNode = current?.targetType === 'work-node' && current?.targetId
    ? readRepositoryWorkNode(current.targetId)
    : null;
  const currentRevision = Number(currentNode?.contentRevision || currentNode?.updatedAt || current?.updatedAt);
  return Boolean(checkout && current && currentNode
    && current.targetType === checkout.targetType
    && current.targetId === checkout.targetId
    && Number.isFinite(currentRevision)
    && currentRevision === Number(checkout.revision));
}

function buildDefGuideTeamLoadoutPlan(input = {}, options = {}) {
  const gate = input.__defCurrentGate || resolveCanonicalWorkbenchCurrent(input);
  if (!gate.ok) return { ok: false, code: gate.code, component: 'team-loadout-plan', state: 'BLOCKED', message: gate.message };
  const sessionId = typeof input.__defSessionId === 'string' ? input.__defSessionId.trim() : '';
  pruneDefTeamLoadoutPlans();
  const source = guideLoadoutPlanSources.get(sessionId);
  if (!source) return { ok: false, code: 'guide-plan-source-unavailable', component: 'team-loadout-plan', state: 'BLOCKED', nextAction: 'Read the named guide section in this same native session before preparing a plan.' };
  const companion = readDefGuideLoadoutManifest(source);
  if (!companion) return { ok: false, code: 'guide-plan-manifest-unavailable', component: 'team-loadout-plan', state: 'BLOCKED', nextAction: 'This allowlisted guide has no content-hash-verified structured loadout companion; no generic plan is inferred.' };
  const snapshot = gate.snapshot;
  const team = snapshot ? defSelectedTeamLoadoutFromSnapshot(snapshot, { ...input, __defCurrentGate: gate }) : null;
  if (!team?.checkout?.targetId || !team.checkout?.revision) return { ok: false, code: 'team-loadout-checkout-unavailable', component: 'team-loadout-plan', state: 'BLOCKED', nextAction: 'Open a revisioned Work Node checkout and rebuild the plan.' };
  const library = readDefEquipmentLibrary();
  const weaponLibrary = readMainWorkbenchJson(WEAPON_LIBRARY_STORAGE_KEY, {});
  const confirmed = new Set(options.confirmedDecisionIds || []);
  const confirmedChoices = new Map((options.confirmedChoices || []).map((choice) => [choice.decisionId, choice.optionId]));
  const unresolved = [];
  const operators = companion.manifest.operators.map((target) => {
    const resolvedOperator = resolveDefPlanSelectedOperator(team, target.characterName);
    if (resolvedOperator.error) {
      unresolved.push({ code: resolvedOperator.error, characterName: target.characterName, message: `${target.characterName} 无法以当前 selected team/catalog 同源精确解析。` });
      return { characterName: target.characterName, exactProduct: { complete: false } };
    }
    const selected = resolvedOperator.selected;
    const usedEquipmentIds = new Set();
    const products = [];
    for (const selection of target.equipment || []) {
      const found = findDefPlanEquipment(library, selection, usedEquipmentIds);
      if (found.error) {
        unresolved.push({ code: found.error, characterId: selected.characterId, characterName: selected.characterName, slotKey: selection.slotKey, message: `${selected.characterName} 的 ${selection.slotKey} 无法由 companion manifest 和当前产品库精确解析。` });
        continue;
      }
      usedEquipmentIds.add(found.product.equipmentId);
      products.push({ slotKey: selection.slotKey, ...found.product });
    }
    const slots = ['armor', 'glove', 'accessory1', 'accessory2'];
    if (products.length !== 4 || new Set(products.map((product) => product.slotKey)).size !== 4 || !slots.every((slot) => products.some((product) => product.slotKey === slot))) {
      unresolved.push({ code: 'four-slot-plan-incomplete', characterId: selected.characterId, characterName: selected.characterName, message: `${selected.characterName} 未得到四个唯一精确装备槽位。` });
    }
    const selectedWeapon = selected.weapon || null;
    const selectedWeaponCatalogMatches = selectedWeapon?.id || selectedWeapon?.name
      ? Object.values(weaponLibrary || {}).filter((candidate) => (
        (selectedWeapon?.id && candidate?.id === selectedWeapon.id)
        || (selectedWeapon?.name && candidate?.name === selectedWeapon.name)
      ))
      : [];
    const selectedWeaponProduct = selectedWeaponCatalogMatches.length === 1
      ? { ...selectedWeaponCatalogMatches[0], level: selectedWeapon?.level ?? null, potential: selectedWeapon?.potential ?? null, skillLevels: selectedWeapon?.skillLevels ?? {} }
      : selectedWeapon;
    const manifestWeapon = target.weapon || { mode: 'preserve-current' };
    let weapon = selectedWeaponProduct;
    if (manifestWeapon.mode === 'exact-name') {
      const matches = Object.values(weaponLibrary || {}).filter((candidate) => candidate?.name === manifestWeapon.name);
      if (matches.length !== 1) unresolved.push({ code: 'weapon-product-unresolved', characterId: selected.characterId, characterName: selected.characterName, message: `${selected.characterName} 的 companion 武器未能在同源武器库精确解析。` });
      else weapon = { ...matches[0], level: selectedWeapon?.level ?? manifestWeapon.level ?? 1, potential: selectedWeapon?.potential ?? null, skillLevels: selectedWeapon?.skillLevels ?? {} };
    }
    const counts = [...new Map(products.map((product) => [product.gearSetId, products.filter((candidate) => candidate.gearSetId === product.gearSetId).length])).entries()]
      .map(([gearSetId, count]) => ({ gearSetId, count }));
    const threePlusOne = counts.find((entry) => entry.count === 3) || null;
    if (target.requireThreePlusOne && !threePlusOne) unresolved.push({ code: 'three-plus-one-unresolved', characterId: selected.characterId, characterName: selected.characterName, message: `${selected.characterName} 未满足 companion 指定的 3+1。` });
    for (const decision of target.decisions || []) {
      if (!confirmed.has(decision.decisionId)) unresolved.push({ code: 'requires-user-decision', decisionId: decision.decisionId, characterId: selected.characterId, characterName: selected.characterName, message: decision.message, options: decision.options });
    }
    const charge = computeDefPlanDerivedCharge(products, weapon, library);
    return {
      characterId: selected.characterId, characterName: selected.characterName,
      weapon: weapon ? { id: String(weapon.id || ''), name: String(weapon.name || ''), level: weapon.level ?? null, potential: weapon.potential ?? null, skillLevels: weapon.skillLevels || {} } : null,
      equipment: products,
      threePlusOne: { required: Boolean(target.requireThreePlusOne), composition: counts, resolved: threePlusOne },
      derived: { ultimateChargeEfficiency: charge },
      exactProduct: { complete: products.length === 4, patch: { characterId: selected.characterId, characterName: selected.characterName, equipments: products.map((product) => ({ slotKey: product.slotKey, equipmentId: product.equipmentId, equipmentName: product.name, gearSetId: product.gearSetId, entryLevels: Object.fromEntries(product.effects.map((effect) => [effect.effectId, effect.level])) })) } },
    };
  });
  const decisions = companion.manifest.operators.flatMap((target) => (target.decisions || []).map((decision) => ({ ...decision, characterName: target.characterName, status: confirmed.has(decision.decisionId) ? 'confirmed' : 'open', confirmedOptionId: confirmedChoices.get(decision.decisionId) || null })));
  const confirmedDecisions = decisions.filter((decision) => decision.status === 'confirmed').map((decision) => ({ decisionId: decision.decisionId, optionId: decision.confirmedOptionId, message: decision.message, optionLabel: decision.options.find((option) => option.optionId === decision.confirmedOptionId)?.label || '' }));
  const body = { protocolVersion: 1, contract: 'DefTeamLoadoutPlanV1', sessionId, timelineId: gate.binding.timelineId, axisBindingId: gate.binding.id, sourceReferenceId: source.referenceId, sourceSectionId: source.sectionId, sourceContentHash: source.sourceContentHash, companionManifest: companion.manifestPath, checkout: team.checkout, team: { selectedCount: team.selectedCount, snapshotUpdatedAt: team.snapshotUpdatedAt }, operators, decisions, confirmedDecisionIds: [...confirmed].sort(), confirmedDecisions, unresolved };
  const planHash = hashDefLoadoutPlan(body);
  const plan = { ok: true, ...body, planId: `team-loadout-${planHash.slice(0, 16)}`, planHash, state: unresolved.length ? 'REQUIRES_CONFIRMATION' : 'READY', immutable: true, expiresAt: Date.now() + PREPARED_TEAM_LOADOUT_TTL_MS, nextAction: unresolved.length ? 'Use only the returned decisionId and optionId to confirm an explicit deviation; a new immutable plan will then be built.' : 'Request one native approval for this exact team diff.' };
  preparedTeamLoadoutPlans.set(planHash, { ...plan, ownerSessionId: sessionId, checkoutBinding: team.checkout, timelineId: gate.binding.timelineId, axisBindingId: gate.binding.id, expiresAt: plan.expiresAt, usedAt: null, usedResult: null, pendingCommand: null });
  return plan;
}

function reviseDefTeamLoadoutPlan(input = {}) {
  const gate = input.__defCurrentGate || resolveCanonicalWorkbenchCurrent(input);
  if (!gate.ok) return { ok: false, code: gate.code, state: 'BLOCKED', component: 'team-loadout-plan', message: gate.message };
  const sessionId = typeof input.__defSessionId === 'string' ? input.__defSessionId.trim() : '';
  const planHash = typeof input.planHash === 'string' ? input.planHash.trim() : '';
  pruneDefTeamLoadoutPlans();
  const original = preparedTeamLoadoutPlans.get(planHash);
  if (!original) return { ok: false, code: 'team-loadout-plan-not-found', state: 'BLOCKED', component: 'team-loadout-plan', message: 'The plan is unavailable, expired, or belongs to a previous sidecar lifetime.' };
  if (original.ownerSessionId !== sessionId) return { ok: false, code: 'team-loadout-plan-session-mismatch', state: 'BLOCKED', component: 'team-loadout-plan', message: 'A plan may be revised only by the native session that prepared it.' };
  if (original.timelineId !== gate.binding.timelineId || original.axisBindingId !== gate.binding.id
    || !defPlanCheckoutMatches(original.checkoutBinding, gate)) {
    return { ok: false, code: 'team-loadout-checkout-changed', state: 'BLOCKED', component: 'team-loadout-plan', message: 'The workspace or checkout changed after planning; create a new plan.' };
  }
  const source = guideLoadoutPlanSources.get(sessionId);
  if (!source
    || source.referenceId !== original.sourceReferenceId
    || source.sectionId !== original.sourceSectionId
    || source.sourceContentHash !== original.sourceContentHash) {
    return { ok: false, code: 'team-loadout-plan-source-changed', state: 'BLOCKED', component: 'team-loadout-plan', message: 'The guide source binding changed after planning; reread the original source before creating a new plan.' };
  }
  const choices = Array.isArray(input.choices) ? input.choices : [];
  const open = new Map((original.decisions || []).filter((decision) => decision.status === 'open').map((decision) => [decision.decisionId, decision]));
  if (!choices.length || choices.some((choice) => !open.has(choice?.decisionId) || !open.get(choice.decisionId).options?.some((option) => option.optionId === choice.optionId))) {
    return { ok: false, code: 'invalid-team-loadout-decision', state: 'BLOCKED', component: 'team-loadout-plan', message: 'Revision choices must use only decisionId/optionId pairs returned by this plan.' };
  }
  return buildDefGuideTeamLoadoutPlan(input, {
    confirmedDecisionIds: [...new Set([...(original.confirmedDecisionIds || []), ...choices.map((choice) => choice.decisionId)])],
    confirmedChoices: [...(original.confirmedDecisions || []).map((decision) => ({ decisionId: decision.decisionId, optionId: decision.optionId })), ...choices],
  });
}

function teamCandidatePresentation(plan) {
  const candidate = plan.preparedCandidate;
  const approvalPatterns = [
    `团队计划: ${plan.planId}`, `Plan hash: ${plan.planHash}`, `来源: ${plan.sourceReferenceId} / ${plan.sourceSectionId} / ${plan.sourceContentHash}`,
    `节点标题: ${candidate.nodeTitle}`, `修改描述: ${candidate.nodeDescription}`, '节点位置: horizontal-branch',
    `Parent: ${candidate.parentNodeId} @ r${candidate.parentRevision}`,
    `Candidate: ${candidate.nodeId} @ r${candidate.nodeRevision} / ${candidate.workingHash}`,
    ...plan.operators.flatMap((operator) => [
      `干员: ${operator.characterName} (${operator.characterId})`,
      `武器: ${operator.weapon?.name || '未变更/无'} · Lv${operator.weapon?.level ?? '-'}`,
      ...operator.equipment.map((piece) => `${piece.slotKey}: ${piece.name} (${piece.equipmentId}) · ${piece.gearSetName}`),
      `3+1: ${operator.threePlusOne?.composition?.map((entry) => `${entry.gearSetId}×${entry.count}`).join(' + ') || '无'}`,
      `终结技充能效率: ${operator.derived?.ultimateChargeEfficiency?.total ?? '-'}%`,
    ]),
    ...plan.confirmedDecisions.map((decision) => `已确认偏差: ${decision.message} → ${decision.optionLabel || decision.optionId}`),
  ];
  return {
    ...plan,
    candidateNodeId: candidate.nodeId,
    candidateRevision: candidate.nodeRevision,
    candidateWorkingHash: candidate.workingHash,
    parentNodeId: candidate.parentNodeId,
    parentRevision: candidate.parentRevision,
    parentWorkingHash: candidate.parentWorkingHash,
    nodeTitle: candidate.nodeTitle,
    nodeDescription: candidate.nodeDescription,
    nodePlacement: 'horizontal-branch',
    sessionBindingId: plan.axisBindingId,
    approvalPatterns,
    approvalDiff: candidate.diff,
  };
}

// This is intentionally narrower than resolveCanonicalWorkbenchCurrent(). It
// exists only after one exact apply command timed out.  In that state the
// renderer may already hold C while the persisted checkout correctly remains
// P; the ordinary gate must reject that split, while this continuation owns
// precisely the one recovery needed to converge it back to P.
function resolvePendingTeamLoadoutReconciliation(input = {}) {
  const sessionId = typeof input.__defSessionId === 'string' ? input.__defSessionId.trim() : '';
  const planHash = typeof input.planHash === 'string' ? input.planHash.trim() : '';
  pruneDefTeamLoadoutPlans();
  const plan = preparedTeamLoadoutPlans.get(planHash);
  if (!plan) return { ok: false, status: 404, code: 'team-loadout-plan-not-found', message: 'The team plan is unavailable or belongs to a previous sidecar lifetime.' };
  if (!sessionId || plan.ownerSessionId !== sessionId) return { ok: false, status: 409, code: 'team-loadout-plan-session-mismatch', message: 'Only the native session that owns this plan may reconcile it.' };
  const session = resolveBoundWorkbenchSession(input);
  if (!session.ok) return session;
  if (session.binding.host !== 'workbench' || session.binding.id !== plan.axisBindingId || session.binding.timelineId !== plan.timelineId) {
    return workbenchBindingFailure('blocked-session-mismatch', 'The pending team plan does not belong to this bound Workbench session.');
  }
  if (!plan.pendingCommand) return { ok: true, pending: false, plan };
  const candidate = plan.preparedCandidate;
  const parent = candidate ? readRepositoryWorkNode(candidate.parentNodeId) : null;
  const node = candidate ? readRepositoryWorkNode(candidate.nodeId) : null;
  if (!candidate || !parent || !node
    || parent.timelineId !== plan.timelineId || node.timelineId !== plan.timelineId
    || Number(parent.contentRevision || parent.updatedAt) !== Number(candidate.parentRevision)
    || Number(node.contentRevision || node.updatedAt) !== Number(candidate.nodeRevision)
    || hashDefNodeValue(parent.workingPayload) !== candidate.parentWorkingHash
    || hashDefNodeValue(node.workingPayload) !== candidate.workingHash) {
    return workbenchBindingFailure('team-loadout-candidate-changed', 'The pending team candidate no longer matches its exact parent or revision.');
  }
  const snapshot = readMainWorkbenchSnapshotMirror();
  const activeTimelineId = typeof snapshot?.activeTimelineId === 'string' ? snapshot.activeTimelineId.trim() : '';
  const projectionTimelineId = typeof snapshot?.timelineId === 'string' ? snapshot.timelineId.trim() : '';
  const checkout = getTimelineRepository().getCheckoutRef(plan.timelineId);
  const projectionIsParent = workbenchProjectionMatchesCheckout(snapshot, parent.workingPayload);
  const projectionIsCandidate = workbenchProjectionMatchesCheckout(snapshot, node.workingPayload);
  if (activeTimelineId !== plan.timelineId || projectionTimelineId !== plan.timelineId
    || checkout?.targetType !== 'work-node' || checkout.targetId !== parent.id
    || (!projectionIsParent && !projectionIsCandidate)) {
    return workbenchBindingFailure('team-loadout-reconciliation-context-changed', 'Pending reconciliation requires this exact bound timeline with checkout P and a projection of P or C.');
  }
  return {
    ok: true,
    pending: true,
    plan,
    session,
    binding: session.binding,
    document: session.document,
    snapshot,
    checkout,
    projectionIsCandidate,
    pendingCommandId: plan.pendingCommand.id,
  };
}

async function prepareDefTeamLoadoutPlanApply(input = {}) {
  const sessionId = typeof input.__defSessionId === 'string' ? input.__defSessionId.trim() : '';
  const planHash = typeof input.planHash === 'string' ? input.planHash.trim() : '';
  pruneDefTeamLoadoutPlans();
  const plan = preparedTeamLoadoutPlans.get(planHash);
  if (!plan) return { ok: false, code: 'team-loadout-plan-not-found', state: 'BLOCKED', component: 'team-loadout-plan', message: 'Plan hash is unavailable, expired, or belongs to another sidecar lifetime.' };
  if (plan.ownerSessionId !== sessionId) return { ok: false, code: 'team-loadout-plan-session-mismatch', state: 'BLOCKED', component: 'team-loadout-plan', message: 'A plan may be applied only by the native session that prepared it.' };
  if (plan.usedResult) return { ...plan.usedResult, idempotent: true };
  const reconciliation = input.__defPendingTeamReconciliation;
  if (reconciliation?.pending && reconciliation.plan === plan
    && reconciliation.session?.binding?.id === plan.axisBindingId
    && reconciliation.pendingCommandId === plan.pendingCommand?.id) {
    const { pendingCommand, ...presentationPlan } = plan;
    return { ...teamCandidatePresentation(presentationPlan), reconciliation: true, pendingCommandId: pendingCommand.id };
  }
  const gate = input.__defCurrentGate || resolveCanonicalWorkbenchCurrent(input);
  if (!gate.ok) return { ok: false, code: gate.code, state: 'BLOCKED', component: 'team-loadout-plan', message: gate.message };
  // A timed-out renderer command remains bound to this exact session and
  // candidate.  Let apply re-observe it even if C has since become current;
  // the reconciliation path below still refuses a different timeline.
  if (plan.pendingCommand) {
    const { pendingCommand, ...presentationPlan } = plan;
    return { ...teamCandidatePresentation(presentationPlan), reconciliation: true, pendingCommandId: pendingCommand.id };
  }
  if (plan.timelineId !== gate.binding.timelineId || plan.axisBindingId !== gate.binding.id
    || !defPlanCheckoutMatches(plan.checkoutBinding, gate)) return { ok: false, code: 'team-loadout-checkout-changed', state: 'BLOCKED', component: 'team-loadout-plan', message: 'Checkout target, revision, or workspace changed after planning; no apply was started.' };
  if (plan.state !== 'READY') return { ...plan, ok: true, approvalPatterns: [], nextAction: plan.nextAction };
  if (plan.preparedCandidate) {
    const existing = readRepositoryWorkNode(plan.preparedCandidate.nodeId);
    if (!existing || existing.timelineId !== plan.timelineId
      || !sameOptionalNodeId(existing.parentNodeId, plan.preparedCandidate.structuralParentNodeId)
      || Number(existing.contentRevision || existing.updatedAt) !== plan.preparedCandidate.nodeRevision
      || hashDefNodeValue(existing.workingPayload) !== plan.preparedCandidate.workingHash) {
      return { ok: false, code: 'team-loadout-candidate-changed', state: 'BLOCKED', component: 'team-loadout-plan', message: 'The prepared team candidate changed; create a new plan.' };
    }
    return teamCandidatePresentation(plan);
  }
  const patches = plan.operators.map((operator) => operator.exactProduct?.patch).filter(Boolean);
  if (patches.length !== plan.operators.length) {
    return { ok: false, state: 'BLOCKED', code: 'team-loadout-patch-incomplete', planId: plan.planId, planHash: plan.planHash, nextAction: 'The reviewed plan does not contain one exact patch per operator; no candidate was created.' };
  }
  const parent = gate.checkoutNodeId ? readRepositoryWorkNode(gate.checkoutNodeId) : null;
  const parentRevision = Number(parent?.contentRevision || parent?.updatedAt);
  if (!parent || parent.timelineId !== gate.binding.timelineId || parent.id !== plan.checkoutBinding.targetId
    || parentRevision !== Number(plan.checkoutBinding.revision)) {
    return { ok: false, code: 'team-loadout-checkout-changed', state: 'BLOCKED', component: 'team-loadout-plan', message: 'The parent checkout changed before the team candidate was prepared.' };
  }
  const nodeMetadata = readAgentWorkNodeMetadata(input);
  if (!nodeMetadata.ok) return { ...nodeMetadata, state: 'BLOCKED', component: 'team-loadout-plan', retryable: false, nextAction: nodeMetadata.message };
  const structuralParentNodeId = horizontalConfigurationParent(parent);
  const definition = getDefToolDefinition('def.operator.config.patch');
  const atomic = await prepareAtomicTeamCandidate({
    parentPayload: parent.workingPayload,
    parentNodeId: parent.id,
    parentRevision,
    patches,
    previewPatch: async (patch) => {
      const planned = buildDefOperatorConfigPreviewCommand(patch);
      if (!planned.ok) return planned;
      const enqueued = enqueueDefToolCommands(definition, [{ op: 'previewOperatorConfig', request: planned.command }], input);
      if (enqueued.status < 200 || enqueued.status >= 300 || !enqueued.body?.commands?.[0]) {
        return { ok: false, code: 'team-loadout-preview-enqueue-failed' };
      }
      const verification = await buildDefToolCommandVerification(enqueued.body.commands[0], input.waitMs);
      const preview = verification?.result?.result;
      return {
        ok: Boolean(verification.pass),
        code: verification.pass ? 'previewed' : 'team-loadout-preview-failed',
        parentNodeId: preview?.parentNodeId,
        parentRevision: preview?.parentRevision,
        preparedPayload: preview?.preparedPayload,
        finalConfig: preview?.finalConfig,
        evidence: { characterId: preview?.finalConfig?.characterId, commandId: enqueued.body.commands[0].id, verification },
      };
    },
    createCandidate: ({ candidatePayload }) => {
      const latestGate = resolveCanonicalWorkbenchCurrent(input);
      const latestParent = readRepositoryWorkNode(parent.id);
      if (!latestGate.ok || latestGate.binding.timelineId !== gate.binding.timelineId || latestGate.checkoutNodeId !== parent.id
        || Number(latestParent?.contentRevision || latestParent?.updatedAt) !== parentRevision) {
        return { ok: false, code: 'team-loadout-checkout-changed' };
      }
      const created = handleAiTimelineWorkNodeRequest('POST', '/api/ai-timeline-worknodes/create', {
        timelineId: gate.binding.timelineId,
        parentNodeId: structuralParentNodeId || null,
        branchId: `team-loadout-${Date.now()}`,
        label: nodeMetadata.title,
        description: nodeMetadata.description,
        basePayload: parent.workingPayload,
        workingPayload: candidatePayload,
        approvalPolicy: 'manual',
        riskFlags: [{ severity: 'warning', code: 'team-loadout-mutation', message: 'One native approval is required for this complete team candidate.' }],
      }, INTERNAL_RAW_TRANSPORT);
      return created?.status === 200 && created?.body?.node
        ? { ok: true, value: created.body.node }
        : { ok: false, code: created?.body?.code || 'team-loadout-branch-create-failed' };
    },
  });
  if (!atomic.ok) {
    return { ...atomic, state: 'BLOCKED', component: 'team-loadout-plan', message: 'The complete team candidate could not be prepared; no horizontal branch was created.' };
  }
  const node = atomic.candidate;
  plan.preparedCandidate = {
    schemaVersion: 1,
    nodeId: node.id,
    nodeRevision: Number(node.contentRevision || node.updatedAt),
    workingHash: hashDefNodeValue(node.workingPayload),
    parentNodeId: parent.id,
    parentRevision,
    structuralParentNodeId,
    nodeTitle: nodeMetadata.title,
    nodeDescription: nodeMetadata.description,
    parentWorkingHash: hashDefNodeValue(parent.workingPayload),
    finalConfigs: atomic.finalConfigs,
    diff: diffTimelinePayloadsForWorkNode(node.basePayload, node.workingPayload),
    previewEvidence: atomic.previewEvidence,
    createdAt: Date.now(),
  };
  plan.approvalReservedAt = Date.now();
  plan.approvalExpiresAt = plan.approvalReservedAt + PREPARED_TEAM_LOADOUT_APPROVAL_GRACE_MS;
  return teamCandidatePresentation(plan);
}

async function applyDefTeamLoadoutPlan(input = {}) {
  const prepared = await prepareDefTeamLoadoutPlanApply(input);
  if (!prepared.ok || prepared.state !== 'READY' || prepared.idempotent) return prepared;
  const stored = preparedTeamLoadoutPlans.get(prepared.planHash);
  if (!stored || (stored.usedAt && !stored.pendingCommand)) return stored?.usedResult ? { ...stored.usedResult, idempotent: true } : { ok: false, code: 'team-loadout-plan-consumed', state: 'BLOCKED', component: 'team-loadout-plan' };
  const candidate = stored.preparedCandidate;
  if (!input.__defPendingTeamReconciliation && !matchesAtomicTeamCandidateCapability(input, candidate)) {
    return { ok: false, state: 'BLOCKED', code: 'team-loadout-capability-mismatch', planId: prepared.planId, planHash: prepared.planHash, nextAction: 'The approved candidate identity does not match the prepared team capability.' };
  }
  const gate = input.__defCurrentGate || input.__defPendingTeamReconciliation || resolveCanonicalWorkbenchCurrent(input);
  if (stored.pendingCommand && (!gate.ok
    || gate.binding.timelineId !== stored.timelineId
    || gate.binding.id !== stored.axisBindingId)) {
    return {
      ok: false,
      state: 'RECONCILIATION_REQUIRED',
      code: 'team-loadout-reconciliation-context-changed',
      planId: stored.planId,
      planHash: stored.planHash,
      pendingCommandId: stored.pendingCommand.id,
      currentCheckoutTouched: null,
      nextAction: 'The exact delayed command is retained, but the current native session no longer targets its workspace. Do not touch the new workspace.',
    };
  }
  const parentSnapshot = cloneJson(stored.pendingCommand?.parentSnapshot || gate?.snapshot || {});
  const node = readRepositoryWorkNode(candidate.nodeId);
  const parent = readRepositoryWorkNode(candidate.parentNodeId);
  if (!gate.ok || (!stored.pendingCommand && gate.checkoutNodeId !== candidate.parentNodeId) || !node || !parent
    || node.timelineId !== stored.timelineId || parent.timelineId !== stored.timelineId
    || !sameOptionalNodeId(node.parentNodeId, candidate.structuralParentNodeId)
    || Number(node.contentRevision || node.updatedAt) !== candidate.nodeRevision
    || Number(parent.contentRevision || parent.updatedAt) !== candidate.parentRevision
    || hashDefNodeValue(node.workingPayload) !== candidate.workingHash
    || hashDefNodeValue(parent.workingPayload) !== candidate.parentWorkingHash) {
    const outcome = { ok: false, state: 'BLOCKED', code: gate.code || 'team-loadout-candidate-changed', planId: stored.planId, planHash: stored.planHash, currentCheckoutTouched: false };
    stored.usedResult = outcome;
    return outcome;
  }
  const sessionId = typeof input.__defSessionId === 'string' ? input.__defSessionId.trim() : '';
  if (!stored.pendingCommand && !consumeApprovedApplyCapability(input, {
    sessionId,
    timelineId: stored.timelineId,
    axisBindingId: stored.axisBindingId,
    sessionBindingId: stored.axisBindingId,
    parentNodeId: candidate.parentNodeId,
    parentRevision: candidate.parentRevision,
    candidateNodeId: candidate.nodeId,
    candidateRevision: candidate.nodeRevision,
    workingHash: candidate.workingHash,
    planId: stored.planId,
    planHash: stored.planHash,
  })) {
    return { ok: false, state: 'BLOCKED', code: 'approval-capability-required', planId: stored.planId, planHash: stored.planHash, currentCheckoutTouched: false, nextAction: 'Native user approval for this exact team candidate is required before apply.' };
  }
  if (!stored.pendingCommand) stored.usedAt = Date.now();
  const definition = getDefToolDefinition('def.operator.config.patch');
  let checkoutApplied = false;
  let commitId = '';
  const parentStillCanonical = async () => {
    const parentProjection = await waitForWorkbenchProjectionPayload(stored.timelineId, parent.workingPayload, 0);
    const current = resolveCanonicalWorkbenchCurrent(input);
    return Boolean(parentProjection.pass
      && current.ok
      && current.binding.timelineId === stored.timelineId
      && current.checkoutNodeId === parent.id
      && getTimelineRepository().getCheckoutRef(stored.timelineId)?.targetId === parent.id);
  };
  const rollback = async (code, details = {}) => {
    // A failed command can mean "C was never written" (notably a late A→B
    // checkout switch). Never compensate that case: proving C live is the
    // prerequisite for touching either the UI or the checkout ref.
    const candidateLive = await waitForWorkbenchProjectionPayload(stored.timelineId, node.workingPayload, 0);
    const persistedCheckout = getTimelineRepository().getCheckoutRef(stored.timelineId);
    const precondition = assessAtomicRollbackPrecondition({
      candidateLive: candidateLive.pass,
      checkout: persistedCheckout,
      timelineId: stored.timelineId,
      parentNodeId: parent.id,
      candidateNodeId: node.id,
    });
    if (!precondition.attempt) {
      const outcome = {
        ok: false,
        state: candidateLive.pass ? 'RECONCILIATION_REQUIRED' : 'BLOCKED',
        code: candidateLive.pass ? 'team-loadout-rollback-precondition-failed' : code,
        planId: stored.planId,
        planHash: stored.planHash,
        currentCheckoutTouched: false,
        rollback: { attempted: false, reason: precondition.reason },
        ...details,
      };
      stored.pendingCommand = null;
      stored.usedResult = outcome;
      return outcome;
    }
    const enqueued = enqueueDefToolCommands(definition, [{
      op: 'restoreAtomicTeamParent',
      parentNodeId: parent.id,
      parentRevision: candidate.parentRevision,
      expectedTimelineId: stored.timelineId,
      expectedCheckoutNodeId: precondition.expectedCheckoutNodeId,
      candidateNodeId: node.id,
      candidateRevision: Number(node.contentRevision || node.updatedAt),
    }], input);
    const rollbackVerification = enqueued.status >= 200 && enqueued.status < 300 && enqueued.body?.commands?.[0]
      ? await buildDefToolCommandVerification(enqueued.body.commands[0], input.waitMs)
      : { pass: false, error: 'team-loadout-rollback-enqueue-failed' };
    const commandRestored = Boolean(rollbackVerification.pass
      && rollbackVerification?.result?.result?.parentNodeId === parent.id
      && Number(rollbackVerification?.result?.result?.parentRevision) === candidate.parentRevision
      && rollbackVerification?.result?.result?.sessionPayloadMatches === true);
    let lifecycleRestored = !checkoutApplied;
    if (commandRestored && checkoutApplied) {
      const lifecycle = handleAiTimelineWorkNodeRequest('POST', `/api/ai-timeline-worknodes/${encodeURIComponent(node.id)}/rollback-applied`, {
        commitId,
        atomicParentNodeId: parent.id,
        appliedBy: 'system',
        appliedAt: Date.now(),
        rationale: 'Atomic team candidate reverted after post-apply failure.',
      }, INTERNAL_RAW_TRANSPORT);
      lifecycleRestored = lifecycle?.status === 200
        && lifecycle?.body?.node?.status === 'committed'
        && lifecycle?.body?.commit?.checkoutApplied === false;
    }
    const parentLive = commandRestored
      ? await waitForWorkbenchProjectionPayload(stored.timelineId, parent.workingPayload, input.snapshotWaitMs ?? 8000)
      : { pass: false, snapshot: null };
    const damageRestored = parentLive.pass && workbenchDamageMatchesSnapshot(parentLive.snapshot, parentSnapshot);
    const restoredCheckout = getTimelineRepository().getCheckoutRef(stored.timelineId);
    const restored = assessAtomicRollbackConvergence({
      commandRestored,
      sessionPayloadMatches: rollbackVerification?.result?.result?.sessionPayloadMatches === true,
      projectionRestored: parentLive.pass,
      damageRestored,
      lifecycleRestored,
      checkout: restoredCheckout,
      parentNodeId: parent.id,
    });
    const outcome = {
      ok: false,
      state: restored ? 'ROLLED_BACK' : 'RECONCILIATION_REQUIRED',
      code,
      planId: stored.planId,
      planHash: stored.planHash,
      currentCheckoutTouched: true,
      rollback: { attempted: true, restored, verification: rollbackVerification, projection: parentLive, damageRestored, lifecycleRestored },
      ...details,
    };
    stored.pendingCommand = null;
    stored.usedResult = outcome;
    return outcome;
  };
  const reconcileExactCommand = async (commandId) => {
    const observed = await observeAtomicTeamApplyCommand({
      commandId,
      waitMs: input.waitMs,
      waitForCommand: (id, waitMs) => buildDefToolCommandVerification({ id }, waitMs),
      // A terminal queue entry can precede React snapshot publication.  Wait
      // for C's canonical projection before deciding that a late write did
      // not happen; a one-shot read would recreate the timeout race.
      candidateIsLive: async () => (await waitForWorkbenchProjectionPayload(
        stored.timelineId,
        node.workingPayload,
        input.snapshotWaitMs ?? 8000,
      )).pass,
      parentIsCanonical: parentStillCanonical,
    });
    const { commandVerification, commandState } = observed;
    if (commandState.kind === 'unresolved') {
      stored.pendingCommand = {
        ...(stored.pendingCommand || {}),
        id: commandId,
        parentSnapshot,
        observedAt: Date.now(),
      };
      return {
        ok: false,
        state: 'RECONCILIATION_REQUIRED',
        code: commandState.code,
        planId: stored.planId,
        planHash: stored.planHash,
        currentCheckoutTouched: null,
        pendingCommandId: commandId,
        commandVerification,
        nextAction: 'The renderer command has not reached a terminal state. Re-apply this exact plan to reconcile this exact command; do not start a new mutation.',
      };
    }
    if (commandState.kind === 'rollback') return rollback(commandState.code, { commandVerification, pendingCommandId: commandId });
    if (commandState.kind === 'zero-change') {
      const outcome = {
        ok: false,
        state: 'BLOCKED',
        code: commandState.code,
        planId: stored.planId,
        planHash: stored.planHash,
        currentCheckoutTouched: false,
        commandVerification,
      };
      stored.pendingCommand = null;
      stored.usedResult = outcome;
      return outcome;
    }
    const outcome = {
      ok: false,
      state: 'RECONCILIATION_REQUIRED',
      code: commandState.code,
      planId: stored.planId,
      planHash: stored.planHash,
      currentCheckoutTouched: null,
      commandVerification,
    };
    stored.pendingCommand = null;
    stored.usedResult = outcome;
    return outcome;
  };
  if (stored.pendingCommand) return reconcileExactCommand(stored.pendingCommand.id);
  const enqueued = enqueueDefToolCommands(definition, [{
    op: 'applyPreparedOperatorConfig', parentNodeId: parent.id, parentRevision: candidate.parentRevision,
    nodeId: node.id, nodeRevision: candidate.nodeRevision,
  }], input);
  if (enqueued.status < 200 || enqueued.status >= 300 || !enqueued.body?.commands?.[0]) {
    const outcome = { ok: false, state: 'BLOCKED', code: 'team-loadout-apply-enqueue-failed', planId: stored.planId, planHash: stored.planHash, currentCheckoutTouched: false };
    stored.usedResult = outcome;
    return outcome;
  }
  const commandVerification = await buildDefToolCommandVerification(enqueued.body.commands[0], input.waitMs);
  if (!commandVerification.pass) return reconcileExactCommand(enqueued.body.commands[0].id);
  const liveVerification = await waitForExactDefOperatorConfigs(candidate.finalConfigs, input.snapshotWaitMs ?? 8000);
  if (!liveVerification.pass) {
    return rollback('team-loadout-postcondition-failed', { commandVerification, postcondition: liveVerification });
  }
  const committed = handleAiTimelineWorkNodeRequest('POST', `/api/ai-timeline-worknodes/${encodeURIComponent(node.id)}/commit`, {
    label: node.label,
    approval: { mode: 'manual', approvedBy: 'user', approvedAt: Date.now(), rationale: 'Native DEF complete team loadout approval.' },
  }, INTERNAL_RAW_TRANSPORT);
  if (committed?.status !== 200 || !committed?.body?.commit) {
    return rollback(committed?.body?.code || 'team-loadout-commit-failed', { commandVerification, postcondition: liveVerification });
  }
  commitId = committed.body.commit.id;
  const applied = handleAiTimelineWorkNodeRequest('POST', `/api/ai-timeline-worknodes/${encodeURIComponent(node.id)}/checkout-applied`, {
    commitId: committed.body.commit.id, appliedBy: 'user', appliedAt: Date.now(), rationale: 'Native DEF complete team loadout applied exact reviewed payload.',
  }, INTERNAL_RAW_TRANSPORT);
  if (applied?.status !== 200) {
    return rollback(applied?.body?.code || 'team-loadout-checkout-apply-failed', { commandVerification, postcondition: liveVerification, commitId: committed.body.commit.id });
  }
  checkoutApplied = true;
  const finalized = enqueueDefToolCommands(definition, [{ op: 'finalizePreparedOperatorConfig', nodeId: node.id, commitId: committed.body.commit.id }], input);
  const finalizeVerification = finalized.status >= 200 && finalized.status < 300 && finalized.body?.commands?.[0]
    ? await buildDefToolCommandVerification(finalized.body.commands[0], input.waitMs)
    : { pass: false };
  const exactResults = candidate.finalConfigs.map((finalConfig) => ({
    characterId: finalConfig.characterId,
    live: exactDefOperatorConfigMatches(normalizeLiveDefOperatorConfig(liveVerification.snapshot, finalConfig), finalConfig),
    checkoutPayload: exactDefOperatorConfigMatches(extractDefOperatorConfig(node.workingPayload, finalConfig.characterId), finalConfig),
    commitPayload: exactDefOperatorConfigMatches(extractDefOperatorConfig(committed.body.commit.appliedPayload, finalConfig.characterId), finalConfig),
  }));
  const pass = finalizeVerification.pass && exactResults.every((result) => result.live && result.checkoutPayload && result.commitPayload);
  if (!pass) {
    return rollback('team-loadout-finalize-failed', { commandVerification, finalizeVerification, postcondition: { pass: false, operators: exactResults }, commitId: committed.body.commit.id });
  }
  const outcome = {
    ok: true,
    state: 'APPLIED',
    code: 'applied',
    planId: stored.planId,
    planHash: stored.planHash,
    nodeId: node.id,
    commitId: committed.body.commit.id,
    nodeTitle: node.label,
    nodeDescription: node.description || '',
    nodePlacement: 'horizontal-branch',
    currentCheckoutTouched: true,
    commandVerification,
    finalizeVerification,
    postcondition: { pass: true, operators: exactResults },
  };
  stored.usedResult = outcome;
  return outcome;
}

function discardPreparedTeamLoadoutPlan(input = {}) {
  const gate = input.__defCurrentGate || resolveCanonicalWorkbenchCurrent(input);
  if (!gate.ok) return { ok: false, state: 'BLOCKED', code: gate.code, component: 'team-loadout-plan' };
  const plan = preparedTeamLoadoutPlans.get(typeof input.planHash === 'string' ? input.planHash.trim() : '');
  const sessionId = typeof input.__defSessionId === 'string' ? input.__defSessionId.trim() : '';
  if (!plan || plan.ownerSessionId !== sessionId || !plan.preparedCandidate) {
    return { ok: false, state: 'BLOCKED', code: 'team-loadout-candidate-unavailable', component: 'team-loadout-plan' };
  }
  if (plan.pendingCommand) {
    return { ok: false, state: 'RECONCILIATION_REQUIRED', code: 'team-loadout-reconciliation-pending', component: 'team-loadout-plan', pendingCommandId: plan.pendingCommand.id };
  }
  const candidate = plan.preparedCandidate;
  if (!matchesAtomicTeamCandidateCapability(input, candidate)) {
    return { ok: false, state: 'BLOCKED', code: 'team-loadout-capability-mismatch', component: 'team-loadout-plan' };
  }
  const node = readRepositoryWorkNode(candidate.nodeId);
  const hasCommit = node ? getTimelineRepository().getLatestWorkNodeCommit(node.id) : null;
  const hasChild = node ? listRepositoryWorkNodes().some((item) => item.parentNodeId === node.id) : false;
  if (!node || node.timelineId !== gate.binding.timelineId || !sameOptionalNodeId(node.parentNodeId, candidate.structuralParentNodeId)
    || Number(node.contentRevision || node.updatedAt) !== candidate.nodeRevision
    || hashDefNodeValue(node.workingPayload) !== candidate.workingHash || hasCommit || hasChild
    || gate.checkoutNodeId !== candidate.parentNodeId) {
    return { ok: false, state: 'BLOCKED', code: 'team-loadout-discard-precondition-failed', component: 'team-loadout-plan' };
  }
  const deleted = handleAiTimelineWorkNodeRequest('POST', `/api/ai-timeline-worknodes/${encodeURIComponent(node.id)}/delete`, {}, INTERNAL_RAW_TRANSPORT);
  const outcome = deleted?.status === 200
    ? { ok: true, state: 'REJECTED', code: 'discarded', planId: plan.planId, planHash: plan.planHash, nodeId: node.id, currentCheckoutTouched: false }
    : { ok: false, state: 'BLOCKED', code: deleted?.body?.code || 'team-loadout-discard-failed', component: 'team-loadout-plan' };
  if (outcome.ok) {
    plan.usedAt = Date.now();
    plan.usedResult = outcome;
  }
  return outcome;
}

function resolveDefSkills(input = {}) {
  const rawQuery = input.query || input.skillName || input.text || '';
  const query = normalizeDefToolText(rawQuery);
  const requestedSkillType = normalizeDefToolText(input.skillType || inferDefSkillTypeFromText(rawQuery));
  const explicitCharacter = normalizeDefToolText(input.characterName || input.character || '');
  const requestedActionVariant = inferDefSkillActionVariant(rawQuery);
  const snapshot = readMainWorkbenchSnapshotMirror();
  const buttons = listDefWorkbenchButtons({ limit: 200 }).buttons;
  const bySkill = new Map();
  for (const skill of Array.isArray(snapshot?.skillCatalog) ? snapshot.skillCatalog : []) {
    const characterId = String(skill.characterId || '').trim();
    const characterName = String(skill.characterName || '').trim();
    const skillId = String(skill.skillId || '').trim();
    const skillType = String(skill.skillType || '').trim();
    const skillDisplayName = String(skill.skillDisplayName || '').trim();
    if (!characterId || !characterName || !skillId || !['A', 'B', 'E', 'Q', 'Dot'].includes(skillType) || !skillDisplayName) continue;
    const key = `${characterId}:${skillId}`;
    bySkill.set(key, {
      characterId,
      characterName,
      skillId,
      skillType,
      skillDisplayName,
      semantic: describeDefSkillSemantic({ skillType, skillId, skillDisplayName }),
      source: String(skill.source || 'runtime-template'),
      buttonCount: 0,
      exampleButtonId: null,
    });
  }
  for (const button of buttons) {
    const key = button.runtimeSkillId
      ? `${button.characterId}:${button.runtimeSkillId}`
      : `${button.characterName}:${button.skillType}:${button.skillDisplayName}`;
    if (!bySkill.has(key)) {
      bySkill.set(key, {
        characterId: button.characterId,
        characterName: button.characterName,
        skillId: button.runtimeSkillId || null,
        skillType: button.skillType,
        skillDisplayName: button.skillDisplayName,
        semantic: describeDefSkillSemantic({
          skillType: button.skillType,
          skillId: button.runtimeSkillId,
          skillDisplayName: button.skillDisplayName,
        }),
        buttonCount: 0,
        exampleButtonId: button.buttonId,
      });
    }
    bySkill.get(key).buttonCount += 1;
  }
  const requestedCharacter = explicitCharacter || [...bySkill.values()]
    .map((skill) => normalizeDefToolText(skill.characterName || ''))
    .find((characterName) => characterName && query.includes(characterName)) || '';
  const candidates = [...bySkill.values()]
    .filter((skill) => !requestedSkillType || normalizeDefToolText(skill.skillType) === requestedSkillType)
    .filter((skill) => !requestedCharacter || normalizeDefToolText(`${skill.characterId || ''} ${skill.characterName}`).includes(requestedCharacter))
    .filter((skill) => !requestedActionVariant || skill.semantic?.actionVariant === requestedActionVariant)
    .filter((skill) => !query || requestedSkillType || normalizeDefToolText(`${skill.characterId || ''} ${skill.characterName} ${skill.skillId || ''} ${skill.skillType} ${skill.skillDisplayName}`).includes(query))
    .map((skill) => ({
      ...skill,
      confidence: normalizeDefToolText(skill.skillDisplayName) === query || normalizeDefToolText(skill.skillId) === query || normalizeDefToolText(skill.skillType) === requestedSkillType || skill.semantic?.actionVariant === requestedActionVariant ? 1 : 0.7,
    }));
  return {
    query,
    terminology: {
      A: '普通重击/普通攻击（处决、下落攻击是独立 A 变体）',
      B: '战技',
      E: '连携技',
      Q: '终结技/大招',
    },
    candidates,
    ambiguity: candidates.length !== 1,
    suggestedQuestion: candidates.length > 1 ? '找到多个技能候选。请指定干员或技能名称。' : (candidates.length === 0 ? '没有与该术语和所选干员一致的可信技能；请指定技能名称。' : ''),
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
  const publicOnly = input.__defPublicOnly === true;
  const snapshot = publicOnly ? null : (input.__defCurrentGate?.snapshot || readMainWorkbenchSnapshotMirror());
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
        scope: 'current-selection',
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
          scope: 'current-selection',
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
        scope: 'current-selection',
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
        scope: 'public-catalog',
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
    scope: publicOnly ? 'public-catalog' : 'current-and-public',
    source: publicOnly ? ['equipment-library'] : ['current-workbench-projection', 'equipment-library'],
    candidates,
    ambiguity: candidates.length !== 1,
    suggestedQuestion: candidates.length === 0
      ? '没有找到匹配 Buff。请提供 Buff 来源、完整名称或允许从模板构造。'
      : candidates.length > 1
        ? '找到多个 Buff 候选。请指定来源或完整名称。'
        : '',
  };
}

function buildDefEquipmentSearchIndex(snapshot, library) {
  const publicEquipmentIds = new Set();
  const currentSelections = new Map();
  for (const config of Array.isArray(snapshot?.operatorConfigs) ? snapshot.operatorConfigs : []) {
    for (const equipment of Array.isArray(config?.equipment) ? config.equipment : []) {
      const equipmentId = String(equipment?.equipmentId || '');
      if (!equipmentId) continue;
      const selections = currentSelections.get(equipmentId) || [];
      selections.push({
        characterName: String(config?.characterName || ''),
        slotKey: String(equipment?.slotKey || ''),
      });
      currentSelections.set(equipmentId, selections);
    }
  }

  const records = [];
  let catalogCount = 0;
  let gearSetCount = 0;
  for (const gearSet of Object.values(library?.gearSets || {})) {
    if (!gearSet || typeof gearSet !== 'object') continue;
    gearSetCount += 1;
    const compactSet = compactDefGearSet(gearSet);
    records.push(buildDefRankedSearchRecord({
      kind: 'gearSet',
      source: 'equipment-library',
      scope: 'public-catalog',
      ...compactSet,
      recommendation: compactSet.threePieceBuffs.length
        ? '这是装备套装；如果用户说“加长息 Buff”，应先确认是要装套装，还是只把三件套效果作为按钮 Buff 附加。'
        : '这是装备套装；未发现可直接附加的三件套 Buff。',
    }, [
      compactSet.name,
      compactSet.gearSetId,
      ...compactSet.threePieceBuffs.flatMap((buff) => [buff.name, buff.typeKey]),
    ]));
    for (const equipment of Object.values(gearSet.equipments || {})) {
      if (!equipment || typeof equipment !== 'object') continue;
      const compact = compactDefEquipmentItem(equipment);
      if (!compact.id || !compact.name) continue;
      catalogCount += 1;
      publicEquipmentIds.add(compact.id);
      records.push(buildDefRankedSearchRecord({
        kind: 'equipment',
        source: 'equipment-library',
        scope: 'public-catalog',
        equipmentId: compact.id,
        name: compact.name,
        part: compact.part,
        effectLabels: compact.effectLabels,
        gearSetId: compactSet.gearSetId,
        gearSetName: compactSet.name,
        currentSelections: currentSelections.get(compact.id) || [],
      }, [compact.name, compact.id, compact.part, compactSet.name, compactSet.gearSetId]));
    }
  }

  for (const config of Array.isArray(snapshot?.operatorConfigs) ? snapshot.operatorConfigs : []) {
    for (const equipment of Array.isArray(config?.equipment) ? config.equipment : []) {
      const equipmentId = String(equipment?.equipmentId || '');
      if (!equipmentId || publicEquipmentIds.has(equipmentId)) continue;
      const candidate = {
        kind: 'currentEquipment',
        source: 'current-selection',
        scope: 'current-selection',
        characterName: String(config?.characterName || ''),
        slotKey: String(equipment?.slotKey || ''),
        equipmentId,
        name: String(equipment?.name || ''),
        part: String(equipment?.part || ''),
        effectCount: Array.isArray(equipment?.effects) ? equipment.effects.length : 0,
      };
      records.push(buildDefRankedSearchRecord(candidate, [candidate.name, candidate.equipmentId, candidate.part, candidate.characterName]));
    }
  }
  return { records, catalogCount, gearSetCount };
}

function resolveDefEquipmentQuery(index, rawQuery, options = {}) {
  const query = normalizeDefToolText(rawQuery);
  const ranked = rankDefResourceCandidates(index.records, rawQuery, options.limit || 12);
  const publicOnly = options.publicOnly === true;
  return {
    contract: 'DefEquipmentResolutionV2',
    query,
    scope: publicOnly ? 'public-catalog' : 'current-and-public',
    source: publicOnly ? ['equipment-library'] : ['current-workbench-projection', 'equipment-library'],
    catalogCount: index.catalogCount,
    gearSetCount: index.gearSetCount,
    count: ranked.candidates.length,
    candidates: ranked.candidates,
    ambiguity: ranked.candidates.length !== 1 || ranked.candidates[0]?.matchMethod === 'fuzzy',
    exhaustive: ranked.exhaustive,
    truncated: ranked.truncated,
    suggestedQuestion: ranked.candidates.length === 0
      ? '干员配置页同源装备库中没有匹配候选；这不代表外部游戏资料不存在。'
      : ranked.candidates.length > 1 || ranked.candidates[0]?.matchMethod === 'fuzzy'
        ? '找到多个或近似装备候选。请根据名称、稳定 id、部位和匹配置信度确认。'
        : '',
  };
}

function resolveDefEquipment(input = {}) {
  const publicOnly = input.__defPublicOnly === true;
  const snapshot = publicOnly ? null : (input.__defCurrentGate?.snapshot || readMainWorkbenchSnapshotMirror());
  const index = buildDefEquipmentSearchIndex(snapshot, readDefEquipmentLibrary());
  const queries = Array.isArray(input.queries)
    ? [...new Set(input.queries.map((query) => String(query || '').trim()).filter(Boolean))].slice(0, 8)
    : [];
  if (queries.length) {
    const results = queries.map((query) => resolveDefEquipmentQuery(index, query, {
      publicOnly,
      limit: Math.max(1, Math.min(Number(input.limitPerQuery || 5) || 5, 12)),
    }));
    return {
      contract: 'DefEquipmentBatchResolutionV2',
      scope: publicOnly ? 'public-catalog' : 'current-and-public',
      source: publicOnly ? ['equipment-library'] : ['current-workbench-projection', 'equipment-library'],
      catalogCount: index.catalogCount,
      gearSetCount: index.gearSetCount,
      queryCount: results.length,
      exhaustive: results.every((result) => result.exhaustive),
      truncated: results.some((result) => result.truncated),
      results,
    };
  }
  return resolveDefEquipmentQuery(index, input.query || input.name || input.text || '', {
    publicOnly,
    limit: input.limit || 12,
  });
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
      contentRevision: node.contentRevision || node.updatedAt,
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
  const staffLine = findDefWorkNodeStaffLineByCharacter(payload, tableButton.characterName)
    || (Array.isArray(payload?.timelineData?.staffLines) ? payload.timelineData.staffLines : [])
      .find((line) => line?.staffIndex === tableButton.staffIndex);
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
    if (!staffLine && !Number.isInteger(operation.staffIndex) && !Number.isInteger(operation.lineIndex)) {
      throw new Error(`${path}: addButton requires selected characterName or explicit staffIndex.`);
    }
    const staffIndex = Number.isInteger(operation.staffIndex)
      ? operation.staffIndex
      : Number.isInteger(operation.lineIndex)
        ? operation.lineIndex
        : staffLine.staffIndex;
    const nodeIndex = Number.isInteger(operation.nodeIndex)
      ? operation.nodeIndex
      : Math.max(-1, ...(Array.isArray(staffLine?.buttons) ? staffLine.buttons : []).map((button) => button.nodeIndex)) + 1;
    if (nodeIndex < 0 || nodeIndex > 14) throw new Error(`${path}: nodeIndex must be between 0 and 14.`);
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
    const suppliedBuff = isObject(operation.buff) ? cloneJson(operation.buff) : null;
    const suppliedBuffId = typeof suppliedBuff?.id === 'string' ? suppliedBuff.id.trim() : '';
    const buffId = typeof operation.buffId === 'string' && operation.buffId.trim() ? operation.buffId.trim() : suppliedBuffId;
    if (!buffId) {
      throw new Error(`${path}: attachBuff requires buffId.`);
    }
    if (operation.nodeIndex < 0 || operation.nodeIndex > 14) throw new Error(`${path}: nodeIndex must be between 0 and 14.`);
    if (!Array.isArray(payload.allBuffList)) payload.allBuffList = [];
    let buff = payload.allBuffList.find((item) => item?.id === buffId);
    if (!buff && suppliedBuff) {
      buff = { ...suppliedBuff, id: buffId, refCount: 0 };
      payload.allBuffList.push(buff);
    }
    if (!buff) throw new Error(`${path}: buff not found: ${buffId}`);
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
    const gate = input.__defCurrentGate || resolveCanonicalWorkbenchCurrent(input);
    if (!gate.ok) {
      return {
        ok: false, code: gate.code, message: gate.message, checkout: false,
        currentCheckoutTouched: false, completedSteps: ['canonical-current-gate-failed'],
      };
    }
    const createResult = createDefWorkNodeFromPayload(
      readDefCurrentTimelinePayloadSource(gate.binding.timelineId),
      { ...input, timelineId: gate.binding.timelineId, __defCurrentGate: gate },
    );
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
  const riskFlags = [
    ...(Array.isArray(node.riskFlags) ? node.riskFlags : []),
    ...normalizeRiskFlags(input.riskFlags),
  ].filter((risk, index, all) => all.findIndex((candidate) => candidate.code === risk.code) === index);
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
  const validationIssues = [
    ...validateWorkNodePayloadIssues(workingPayload, 'workingPayload'),
    ...validateDefTimelineAgainstSkillCatalog(workingPayload, input.__defCurrentGate?.snapshot || readMainWorkbenchSnapshotMirror(), 'workingPayload'),
  ];
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
    writeLegacyNodeProjection(nextNode);
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

function rankDefWorkbenchButtonsByBuff(input = {}) {
  const listed = listDefWorkbenchButtons({
    characterName: input.characterName || input.character || '',
    skillName: input.skillName || input.skillDisplayName || '',
    limit: 200,
  });
  const buttons = [...listed.buttons]
    .sort((left, right) => (
      right.buffCount - left.buffCount
      || (left.nodeIndex ?? Number.MAX_SAFE_INTEGER) - (right.nodeIndex ?? Number.MAX_SAFE_INTEGER)
      || left.label.localeCompare(right.label)
    ))
    .map((button, index) => ({ rank: index + 1, ...button }));
  return {
    snapshotUpdatedAt: listed.snapshotUpdatedAt,
    characterName: input.characterName || input.character || '',
    count: buttons.length,
    buttons,
  };
}

function syncDefWorkNodeWorkspace(input = {}) {
  const nodeId = typeof input.nodeId === 'string' ? input.nodeId.trim() : '';
  const node = nodeId ? readRepositoryWorkNode(nodeId) : null;
  if (!node) {
    return {
      ok: false,
      code: 'ai-worknode-not-found',
      message: nodeId ? `AI timeline work node not found: ${nodeId}` : 'sync_workspace requires nodeId.',
      currentCheckoutTouched: false,
    };
  }
  const expectedRevision = Number(input.expectedRevision);
  const actualRevision = Number(node.contentRevision || node.updatedAt);
  if (Number.isFinite(Number(node.contentRevision)) && Number.isFinite(expectedRevision) && expectedRevision !== actualRevision) {
    return {
      ok: false,
      code: 'workspace-revision-conflict',
      message: `Work Node revision changed from ${expectedRevision} to ${actualRevision}. Re-read or fork before rebuilding.`,
      nodeId,
      expectedRevision,
      actualRevision,
      currentCheckoutTouched: false,
    };
  }
  const actualBaseHash = hashDefNodeValue(node.basePayload);
  if (typeof input.expectedBaseHash === 'string' && input.expectedBaseHash !== actualBaseHash) {
    return {
      ok: false,
      code: 'workspace-base-conflict',
      message: 'Work Node base hash changed. Re-materialize before rebuilding.',
      nodeId,
      expectedBaseHash: input.expectedBaseHash,
      actualBaseHash,
      currentCheckoutTouched: false,
    };
  }
  const actualWorkingHash = hashDefNodeValue(node.workingPayload);
  if (typeof input.expectedWorkingHash === 'string' && input.expectedWorkingHash !== actualWorkingHash) {
    return {
      ok: false,
      code: 'workspace-working-conflict',
      message: 'Work Node working payload changed after materialization. Re-read or fork before rebuilding.',
      nodeId,
      expectedWorkingHash: input.expectedWorkingHash,
      actualWorkingHash,
      currentCheckoutTouched: false,
    };
  }
  let workingPayload = null;
  let sourceIssues = [];
  if (isObject(input.workspaceSource)) {
    const rebuilt = rebuildDefNodePayload(node.workingPayload, input.workspaceSource);
    if (!rebuilt.ok) sourceIssues = rebuilt.issues;
    else workingPayload = rebuilt.payload;
  } else if (isObject(input.workingPayload)) {
    workingPayload = cloneJson(input.workingPayload);
  }
  if (sourceIssues.length) {
    return {
      ok: false,
      code: 'workspace-source-validation-failed',
      message: sourceIssues.map((issue) => issue.message).join('; '),
      nodeId,
      validation: { ok: false, issues: sourceIssues },
      currentCheckoutTouched: false,
    };
  }
  if (!isObject(workingPayload)) {
    return {
      ok: false,
      code: 'invalid-workspace-payload',
      message: 'sync_workspace requires workspaceSource or workingPayload.',
      nodeId,
      currentCheckoutTouched: false,
    };
  }
  const issues = [
    ...validateWorkNodePayloadIssues(workingPayload, 'workingPayload'),
    ...validateDefTimelineAgainstSkillCatalog(workingPayload, input.__defCurrentGate?.snapshot || readMainWorkbenchSnapshotMirror(), 'workingPayload'),
  ];
  if (issues.length) {
    return {
      ok: false,
      code: 'workspace-validation-failed',
      message: issues.map((issue) => issue.message).join('; '),
      nodeId,
      validation: { ok: false, issues },
      currentCheckoutTouched: false,
    };
  }
  const diff = diffTimelinePayloadsForWorkNode(node.basePayload, workingPayload);
  const riskFlags = computeDefNodeSourceRisk(diff).map((risk) => makeDefWorkNodeRiskFlag(
    risk.severity,
    risk.code,
    risk.message,
    risk.path,
  ));
  const now = Date.now();
  const nextNode = {
    ...node,
    workingPayload,
    workingSummary: summarizeTimelinePayload(workingPayload),
    updatedAt: now,
    contentRevision: now,
    status: 'ready',
    riskFlags,
    logs: [
      makeWorkNodeLog('info', 'Synchronized working payload from isolated OpenCode node workspace.', {
        sessionId: typeof input.sessionId === 'string' ? input.sessionId : undefined,
      }),
      ...(Array.isArray(node.logs) ? node.logs : []),
    ],
  };
  const checkoutDecision = buildAiTimelineCheckoutDecision({
    approvalPolicy: nextNode.approvalPolicy,
    riskFlags,
    diff,
  });
  mirrorWorkNodeToTimelineRepository(nextNode);
  writeLegacyNodeProjection(nextNode);
  return {
    ok: true,
    nodeId,
    revision: now,
    baseHash: actualBaseHash,
    workingHash: hashDefNodeValue(workingPayload),
    validation: { ok: true, issues: [] },
    diff,
    diffSummary: formatDefWorkNodeDiffSummary(diff),
    riskFlags,
    checkoutDecision,
    workingSummary: nextNode.workingSummary,
    generatedPayload: workingPayload,
    currentCheckoutTouched: false,
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
  const node = readRepositoryWorkNode(workNodeId.trim());
  if (!node) return null;
  const updatedNode = {
    ...node,
    updatedAt: Date.now(),
    logs: [
      makeWorkNodeLog(level, message, data),
      ...(Array.isArray(node.logs) ? node.logs : []),
    ].slice(0, 100),
  };
  mirrorWorkNodeToTimelineRepository(updatedNode);
  writeLegacyNodeProjection(updatedNode);
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
    sessionId: typeof input.sessionId === 'string' ? input.sessionId : '',
    nodeRevision: Number.isFinite(Number(input.nodeRevision)) ? Number(input.nodeRevision) : null,
    diffHash: typeof input.diffHash === 'string' ? input.diffHash : '',
    riskHash: typeof input.riskHash === 'string' ? input.riskHash : '',
    workingHash: typeof input.workingHash === 'string' ? input.workingHash : '',
    toolCallId: typeof input.toolCallId === 'string' ? input.toolCallId : '',
    timelineId: typeof input.timelineId === 'string' ? input.timelineId : '',
    axisBindingId: typeof input.axisBindingId === 'string' ? input.axisBindingId : '',
    sessionBindingId: typeof input.sessionBindingId === 'string' ? input.sessionBindingId : '',
    parentNodeId: typeof input.parentNodeId === 'string' ? input.parentNodeId : '',
    parentRevision: Number.isFinite(Number(input.parentRevision)) ? Number(input.parentRevision) : null,
    candidateNodeId: typeof input.candidateNodeId === 'string' ? input.candidateNodeId : '',
    candidateRevision: Number.isFinite(Number(input.candidateRevision)) ? Number(input.candidateRevision) : null,
    planId: typeof input.planId === 'string' ? input.planId : '',
    planHash: typeof input.planHash === 'string' ? input.planHash : '',
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
  const requested = archive.approvals.find((approval) => approval?.id === approvalId);
  if (decision === 'approved' && requested?.workNodeId) {
    const node = readRepositoryWorkNode(requested.workNodeId);
    const actualRevision = Number(node?.contentRevision || node?.updatedAt);
    const actualWorkingHash = node ? hashDefNodeValue(node.workingPayload) : '';
    const staleRevision = Number.isFinite(Number(node?.contentRevision))
      && Number.isFinite(Number(requested.nodeRevision))
      && actualRevision !== Number(requested.nodeRevision);
    const staleHash = requested.workingHash && actualWorkingHash !== requested.workingHash;
    if (!node || staleRevision || staleHash) {
      return {
        ok: false,
        code: 'approval-stale',
        message: 'Work Node content changed after approval was requested. Rebuild the diff and request approval again.',
        approvalId,
        expectedRevision: requested.nodeRevision,
        actualRevision: node ? actualRevision : null,
        expectedWorkingHash: requested.workingHash || '',
        actualWorkingHash,
      };
    }
  }
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
  const approvalCapability = decision === 'approved' ? crypto.randomUUID() : '';
  if (approvalCapability) {
    approvedApplyCapabilities.set(approvalCapability, {
      sessionId: updated.sessionId,
      timelineId: updated.timelineId,
      axisBindingId: updated.axisBindingId,
      sessionBindingId: updated.sessionBindingId,
      parentNodeId: updated.parentNodeId,
      parentRevision: updated.parentRevision,
      candidateNodeId: updated.candidateNodeId || updated.workNodeId,
      candidateRevision: updated.candidateRevision || updated.nodeRevision,
      workingHash: updated.workingHash,
      planId: updated.planId,
      planHash: updated.planHash,
      used: false,
      expiresAt: Date.now() + PREPARED_OPERATOR_CONFIG_TTL_MS,
    });
  }
  return { ok: true, approval: updated, ...(approvalCapability ? { approvalCapability } : {}) };
}

function buildDefToolDefinitions() {
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
            nodeIndex: { type: 'integer', minimum: 0, maximum: 14 },
            latest: { type: 'boolean' },
          },
        },
        staffIndex: { type: 'number' },
        sourceStaffIndex: { type: 'number', description: 'Required for copyStaffLine.' },
        targetStaffIndex: { type: 'number', description: 'Required for copyStaffLine.' },
        preserveCharacterIdentity: { type: 'boolean', description: 'copyStaffLine defaults to true for an exact visual/content duplicate.' },
        replaceTarget: { type: 'boolean', description: 'copyStaffLine rejects non-empty targets unless this is explicitly true.' },
        nodeIndex: { type: 'integer', minimum: 0, maximum: 14, description: 'Required for moveButton; optional for addButton. User-facing positions are 1-15.' },
        buffId: { type: 'string', description: 'Required for attachBuff/removeBuff.' },
        buff: { type: 'object', description: 'Optional full buff object for attachBuff when it is not already present in allBuffList.' },
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
  const batchBuffSchema = {
    type: 'object',
    required: ['buttonIds', 'buff'],
    properties: {
      buttonIds: { type: 'array', items: { type: 'string' }, description: 'Two or more stable button ids.' },
      buff: { type: 'object', description: 'Buff object to stage in the Work Node and attach to every target.' },
      nodeId: { type: 'string', description: 'Optional existing Work Node; omitted creates one from current checkout.' },
      timelineId: { type: 'string' },
      label: { type: 'string' },
      checkout: { type: 'boolean', description: 'Batch changes remain staged when risk review is required.' },
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
      expectedRevision: { type: 'number' },
      expectedWorkingHash: { type: 'string' },
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
      expectedRevision: { type: 'number' },
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
  const buttonLookupSchema = {
    type: 'object',
    properties: {
      buttonId: { type: 'string' },
      characterName: { type: 'string' },
      skillName: { type: 'string' },
      skillType: { type: 'string' },
      nodeIndex: { type: 'integer', minimum: 0, maximum: 14, description: 'Zero-based node coordinate. In @N-L notation, N maps to nodeIndex=N-1.' },
      lineIndex: { type: 'integer', minimum: 0, description: 'Zero-based line coordinate. In @N-L notation, L maps to lineIndex=L-1.' },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
    },
  };
  const addSkillButtonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['characterName', 'skillType'],
    properties: {
      characterId: { type: 'string' },
      characterName: { type: 'string' },
      skillType: { type: 'string' },
      runtimeSkillId: { type: 'string' },
      skillDisplayName: { type: 'string' },
      staffIndex: { type: 'integer', minimum: 0, description: 'Zero-based visual timeline group. “第二组” means staffIndex=1. Never use lineIndex for a group.' },
      nodeIndex: { type: 'integer', minimum: 0, maximum: 14, description: 'Zero-based position in the group. “第一个” means nodeIndex=0.' },
      select: { type: 'boolean' },
      waitMs: { type: 'number' },
      snapshotWaitMs: { type: 'number' },
    },
  };
  const syncWorkspaceSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['nodeId'],
    anyOf: [{ required: ['workspaceSource'] }, { required: ['workingPayload'] }],
    properties: {
      nodeId: { type: 'string' },
      workingPayload: { type: 'object' },
      workspaceSource: { type: 'object' },
      sessionId: { type: 'string' },
      expectedRevision: { type: 'number' },
      expectedBaseHash: { type: 'string' },
      expectedWorkingHash: { type: 'string' },
    },
  };
  return DEF_TOOL_DEFINITION_BASE.map((tool) => ({
    ...tool,
    inputSchema: tool.name === 'def.workbench.add_skill_button' || tool.name === 'def.workbench.add_skill_button_and_verify'
      ? addSkillButtonSchema
      : tool.name === 'def.workbench.find_buttons' || tool.name === 'def.workbench.rank_buttons_by_buff'
        ? buttonLookupSchema
      : tool.name === 'def.worknode.copy_staff_line_and_verify'
      ? copyStaffLineSchema
      : tool.name === 'def.buff.add_to_buttons'
        ? batchBuffSchema
      : tool.name === 'def.worknode.patch_and_validate'
      ? patchAndValidateSchema
      : tool.name === 'def.worknode.sync_workspace'
        ? syncWorkspaceSchema
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

const defCoreToolRegistry = createDefCoreToolRegistry({
  buildDefinitions: buildDefToolDefinitions,
  createRegistry: createDefToolRegistry,
});
const DEF_TOOL_REGISTRY = defCoreToolRegistry.definitions;
const DEF_TOOL_DEFINITIONS = defCoreToolRegistry.definitions;

function getDefToolDefinition(name) {
  return defCoreToolRegistry.get(name);
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

function recordDefUserQuestionAnswer(input = {}) {
  const nativeRequestId = typeof input.nativeRequestId === 'string' ? input.nativeRequestId.trim() : '';
  const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
  if (!nativeRequestId || !sessionId) {
    return { ok: false, code: 'invalid-question-decision', message: 'nativeRequestId and sessionId are required.' };
  }
  const status = input.status === 'answered' ? 'answered' : 'rejected';
  const archive = readDefToolGovernanceArchive();
  const record = {
    id: `def-question-${nativeRequestId}`,
    nativeRequestId,
    sessionId,
    workNodeId: typeof input.workNodeId === 'string' ? input.workNodeId : '',
    createdAt: Number(input.createdAt || Date.now()),
    decidedAt: Date.now(),
    status,
    mode: 'blocking',
    questions: Array.isArray(input.questions) ? input.questions.slice(0, 6) : [],
    answers: Array.isArray(input.answers) ? input.answers.slice(0, 6) : [],
  };
  writeDefToolGovernanceArchive({
    ...archive,
    questions: [record, ...archive.questions.filter((item) => item?.id !== record.id)],
  });
  appendDefGovernanceWorkNodeLog(record.workNodeId, status === 'answered' ? 'info' : 'warning', 'Recorded OpenCode native question decision.', {
    questionId: record.id,
    nativeRequestId,
    sessionId,
    status,
  });
  return { ok: true, question: record };
}

function snapshotButtonCount(snapshot = readMainWorkbenchSnapshotMirror()) {
  return Array.isArray(snapshot?.skillButtons) ? snapshot.skillButtons.length : 0;
}

function timelineButtonIdentityFromPayload(button = {}) {
  return {
    id: String(button.id || ''),
    characterId: String(button.characterId || ''),
    characterName: String(button.characterName || ''),
    skillType: String(button.skillType || ''),
    staffIndex: Number(button.staffIndex),
    lineIndex: Number(button.lineIndex ?? button.staffIndex),
    nodeIndex: Number(button.nodeIndex),
  };
}

function timelineButtonIdentityFromSnapshot(button = {}) {
  const staffIndex = Number(button.persistenceStaffIndex ?? button.lineIndex);
  return {
    id: String(button.id || ''),
    characterId: String(button.characterId || ''),
    characterName: String(button.characterName || ''),
    skillType: String(button.skillType || ''),
    staffIndex,
    lineIndex: staffIndex,
    nodeIndex: Number(button.persistenceNodeIndex
      ?? (Number(button.staffIndex) * DEF_GRID_NODE_COUNT + Number(button.nodeIndex))),
  };
}

function sortedTimelineButtonIdentities(values, mapper) {
  return (Array.isArray(values) ? values : []).map(mapper).sort((left, right) => left.id.localeCompare(right.id));
}

function verifyVisibleTimelineButtons(payload, snapshot) {
  const expected = sortedTimelineButtonIdentities(
    Object.values(isObject(payload?.skillButtonTable) ? payload.skillButtonTable : {}),
    timelineButtonIdentityFromPayload,
  );
  const actual = sortedTimelineButtonIdentities(snapshot?.skillButtons, timelineButtonIdentityFromSnapshot);
  const expectedIdentityComplete = expected.every((button) => button.id && button.characterId && button.characterName
    && ['A', 'B', 'E', 'Q', 'Dot'].includes(button.skillType)
    && Number.isInteger(button.staffIndex) && button.staffIndex >= 0
    && Number.isInteger(button.lineIndex) && button.lineIndex >= 0
    && Number.isInteger(button.nodeIndex) && button.nodeIndex >= 0);
  return {
    pass: expectedIdentityComplete && JSON.stringify(expected) === JSON.stringify(actual),
    expectedIdentityComplete,
    expected,
    actual,
  };
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

function normalizeDefOperatorConfigTarget(value = {}) {
  return {
    characterId: typeof value.characterId === 'string' ? value.characterId.trim() : '',
    characterName: typeof value.characterName === 'string' ? value.characterName.trim() : '',
  };
}

function buildDefOperatorConfigPostconditions(commands, commandVerifications) {
  const targets = new Map();
  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index];
    const verification = commandVerifications[index];
    const result = isObject(verification?.result?.result) ? verification.result.result : null;
    if (!verification?.pass || !result) continue;
    const target = normalizeDefOperatorConfigTarget({
      characterId: result.characterId || command.characterId,
      characterName: result.characterName || command.characterName,
    });
    const key = target.characterId || normalizeDefToolText(target.characterName);
    if (!key) continue;
    const current = targets.get(key) || { ...target };
    if ((command.op === 'setOperatorWeapon' || command.op === 'setOperatorConfig') && isObject(result.weapon)) {
      current.weapon = {
        id: typeof result.weapon.id === 'string' ? result.weapon.id : '',
        name: typeof result.weapon.name === 'string' ? result.weapon.name : command.weaponName || '',
      };
    }
    if ((command.op === 'setOperatorEquipment' || command.op === 'setOperatorConfig') && Array.isArray(result.equipment)) {
      current.equipment = result.equipment.map((piece) => ({
        slotKey: typeof piece?.slotKey === 'string' ? piece.slotKey : '',
        equipmentId: typeof piece?.equipmentId === 'string' ? piece.equipmentId : '',
        name: typeof piece?.name === 'string' ? piece.name : '',
      }));
    }
    targets.set(key, current);
  }
  return [...targets.values()];
}

function verifyDefOperatorConfigTargets(configs, expectedTargets) {
  const results = expectedTargets.map((expected) => {
    const config = configs.find((candidate) => (
      (expected.characterId && candidate?.characterId === expected.characterId)
      || (expected.characterName && normalizeDefToolText(candidate?.characterName) === normalizeDefToolText(expected.characterName))
    ));
    const mismatches = [];
    if (!config) {
      mismatches.push('operator-config-not-mirrored');
    } else {
      if (expected.weapon) {
        const actualWeapon = config.weapon || {};
        const matchesWeapon = (expected.weapon.id && actualWeapon.id === expected.weapon.id)
          || (expected.weapon.name && actualWeapon.name === expected.weapon.name);
        if (!matchesWeapon) mismatches.push('weapon-mismatch');
      }
      if (Array.isArray(expected.equipment)) {
        const actualEquipment = Array.isArray(config.equipment) ? config.equipment : [];
        for (const expectedPiece of expected.equipment) {
          const found = actualEquipment.some((actualPiece) => (
            (expectedPiece.slotKey && actualPiece?.slotKey === expectedPiece.slotKey)
            && ((expectedPiece.equipmentId && actualPiece?.equipmentId === expectedPiece.equipmentId)
              || (expectedPiece.name && actualPiece?.name === expectedPiece.name))
          ));
          if (!found) mismatches.push(`equipment-mismatch:${expectedPiece.slotKey || expectedPiece.equipmentId || expectedPiece.name || 'unknown'}`);
        }
      }
    }
    return {
      characterId: expected.characterId || config?.characterId || '',
      characterName: expected.characterName || config?.characterName || '',
      pass: mismatches.length === 0,
      mismatches,
      actual: config ? {
        weapon: config.weapon ? { id: config.weapon.id || '', name: config.weapon.name || '' } : null,
        equipment: Array.isArray(config.equipment) ? config.equipment.map((piece) => ({
          slotKey: piece?.slotKey || '', equipmentId: piece?.equipmentId || '', name: piece?.name || '',
        })) : [],
      } : null,
    };
  });
  return { pass: results.length > 0 && results.every((result) => result.pass), results };
}

function verifyDefOperatorConfigPostconditions(snapshot, expectedTargets) {
  const configs = Array.isArray(snapshot?.operatorConfigs) ? snapshot.operatorConfigs : [];
  return verifyDefOperatorConfigTargets(configs, expectedTargets);
}

function verifyDefOperatorConfigCheckoutPostconditions(expectedTargets, input = {}) {
  const gate = input.__defCurrentGate || resolveCanonicalWorkbenchCurrent(input);
  if (!gate.ok) {
    return { pass: false, code: gate.code, checkout: null, verification: { pass: false, results: [] } };
  }
  const axis = gate.axisContext;
  const checkout = axis?.checkout || null;
  if (checkout?.targetType !== 'work-node' || !checkout.targetId) {
    return {
      pass: false,
      code: 'operator-config-checkout-unavailable',
      checkout,
      verification: { pass: false, results: [] },
    };
  }
  const node = readRepositoryWorkNode(checkout.targetId);
  if (!node?.workingPayload || node.timelineId !== gate.binding.timelineId) {
    return {
      pass: false,
      code: 'operator-config-checkout-unavailable',
      checkout,
      verification: { pass: false, results: [] },
    };
  }
  const cache = isObject(node.workingPayload.operatorConfigPageCache)
    ? node.workingPayload.operatorConfigPageCache
    : {};
  const configs = Object.entries(cache).map(([characterId, snapshot]) => ({
    characterId,
    characterName: snapshot?.operator?.name || '',
    weapon: snapshot?.weapon || null,
    equipment: Array.isArray(snapshot?.equipment?.pieces) ? snapshot.equipment.pieces : [],
  }));
  const verification = verifyDefOperatorConfigTargets(configs, expectedTargets);
  return {
    pass: verification.pass,
    code: verification.pass ? 'operator-config-checkout-persisted' : 'operator-config-checkout-mismatch',
    checkout: {
      timelineId: node.timelineId || node.saveId || '',
      targetType: 'work-node',
      targetId: node.id,
      updatedAt: node.updatedAt || null,
      contentRevision: node.contentRevision || node.updatedAt || null,
    },
    verification,
  };
}

async function waitForDefOperatorConfigPostconditions(expectedTargets, waitMs) {
  const deadline = Date.now() + normalizeDefVerifyWaitMs(waitMs, 8000);
  let snapshot = readMainWorkbenchSnapshotMirror();
  let verification = verifyDefOperatorConfigPostconditions(snapshot, expectedTargets);
  while (!verification.pass && Date.now() < deadline) {
    await sleep(250);
    snapshot = readMainWorkbenchSnapshotMirror();
    verification = verifyDefOperatorConfigPostconditions(snapshot, expectedTargets);
  }
  return { snapshot, verification };
}

async function executeDefOperatorConfigPatchAndVerify(definition, input = {}) {
  const commands = buildDefOperatorConfigPatchCommands(input);
  const enqueued = enqueueDefToolCommands(definition, commands, input);
  if (enqueued.status < 200 || enqueued.status >= 300 || !enqueued.body?.commands?.length) {
    return {
      ok: false,
      code: enqueued.body?.code || 'operator-config-enqueue-failed',
      component: 'operator-config',
      retryable: false,
      nextAction: 'Correct the typed weapon/equipment input before retrying.',
      enqueue: enqueued.body || null,
    };
  }
  const commandVerifications = await Promise.all(
    enqueued.body.commands.map((command) => buildDefToolCommandVerification(command, input.waitMs)),
  );
  if (!commandVerifications.every((verification) => verification.pass)) {
    return {
      ok: false,
      code: 'operator-config-command-failed',
      component: 'operator-config',
      retryable: true,
      nextAction: 'Read the failed command result; do not describe the configuration as applied.',
      commands: enqueued.body.commands,
      commandVerifications,
    };
  }
  const persistence = commandVerifications.map((verification) => verification.result?.result?.persistence || null);
  if (!persistence.every((result) => result?.pass === true)) {
    return {
      ok: false,
      code: 'operator-config-persistence-failed',
      component: 'operator-config',
      retryable: true,
      nextAction: 'Read the command result and restore a writable Work Node checkout before retrying.',
      commands: enqueued.body.commands,
      commandVerifications,
      persistence,
    };
  }
  const expectedTargets = buildDefOperatorConfigPostconditions(commands, commandVerifications);
  if (!expectedTargets.length) {
    return {
      ok: false,
      code: 'operator-config-postcondition-unavailable',
      component: 'operator-config',
      retryable: false,
      nextAction: 'The renderer did not return a typed operator-config result; do not claim application.',
      commands: enqueued.body.commands,
      commandVerifications,
    };
  }
  const { snapshot, verification } = await waitForDefOperatorConfigPostconditions(expectedTargets, input.snapshotWaitMs ?? 8000);
  if (!verification.pass) {
    return {
      ok: false,
      code: 'postcondition-failed',
      component: 'operator-config',
      retryable: true,
      nextAction: 'Read the live operator configuration and reconcile the renderer before retrying.',
      commands: enqueued.body.commands,
      commandVerifications,
      expectedTargets,
      postcondition: verification,
      snapshotUpdatedAt: snapshot?.updatedAt || null,
    };
  }
  const checkoutPersistence = verifyDefOperatorConfigCheckoutPostconditions(expectedTargets, input);
  if (!checkoutPersistence.pass) {
    return {
      ok: false,
      code: 'operator-config-persistence-failed',
      component: 'operator-config',
      retryable: true,
      nextAction: 'The live page changed but the checked-out payload does not contain the same configuration; do not describe it as applied.',
      commands: enqueued.body.commands,
      commandVerifications,
      expectedTargets,
      postcondition: verification,
      checkoutPersistence,
      snapshotUpdatedAt: snapshot?.updatedAt || null,
    };
  }
  return {
    ok: true,
    component: 'operator-config',
    commands: enqueued.body.commands,
    commandVerifications,
    expectedTargets,
    postcondition: verification,
    checkoutPersistence,
    snapshotUpdatedAt: snapshot?.updatedAt || null,
    note: 'Applied only after the live Workbench operator-config mirror matched the renderer result.',
  };
}

function buildDefOperatorConfigPreviewCommand(input = {}) {
  const commands = buildDefOperatorConfigPatchCommands(input);
  if (commands.length !== 1) {
    return { ok: false, code: 'operator-config-preview-requires-one-command', message: 'One native approval must resolve exactly one operator configuration mutation.' };
  }
  return {
    ok: true,
    command: {
      ...commands[0],
      op: 'setOperatorConfig',
      ...(isObject(input.operatorSkillLevels) ? { operatorSkillLevels: input.operatorSkillLevels } : {}),
    },
  };
}

function extractDefOperatorConfig(payload, characterId) {
  const snapshot = payload?.operatorConfigPageCache?.[characterId];
  if (!snapshot) return null;
  return {
    characterId,
    characterName: snapshot?.operator?.name || '',
    weapon: {
      id: snapshot?.weapon?.id || '',
      name: snapshot?.weapon?.name || '',
      level: snapshot?.weapon?.config?.level,
      potential: snapshot?.weapon?.config?.potential || '',
      skillLevels: snapshot?.weapon?.config?.skillLevels || {},
    },
    equipment: (Array.isArray(snapshot?.equipment?.pieces) ? snapshot.equipment.pieces : []).map((piece) => ({
      slotKey: piece?.slotKey || '', equipmentId: piece?.equipmentId || '', name: piece?.name || '',
      effects: (Array.isArray(piece?.effects) ? piece.effects : []).map((effect) => ({ effectId: effect?.effectId || '', label: effect?.label || '', level: effect?.level, value: effect?.value })),
    })),
    operatorSkillLevels: snapshot?.operator?.skillConfig || {},
  };
}

function exactDefOperatorConfigMatches(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function verifyDefTimelinePreserved(before, after) {
  const beforeIssues = validateDefTimelinePayload(before, 'beforePayload');
  const afterIssues = validateDefTimelinePayload(after, 'afterPayload');
  const invariant = compareDefTimelineInvariants(before, after);
  return {
    pass: beforeIssues.length === 0 && afterIssues.length === 0 && invariant.pass,
    beforeIssues,
    afterIssues,
    ...invariant,
  };
}

function operatorConfigTimelineInvariantFailure({ stage, timelinePreservation, timelineCatalogIssues, currentCheckoutTouched = false }) {
  const diagnostics = {
    stage,
    beforeCanonicalHash: timelinePreservation.beforeCanonicalHash,
    afterCanonicalHash: timelinePreservation.afterCanonicalHash,
    changedPaths: timelinePreservation.changedPaths,
    changedPathLimitReached: timelinePreservation.changedPathLimitReached,
    validatorIssues: {
      before: timelinePreservation.beforeIssues,
      after: timelinePreservation.afterIssues,
    },
    catalogIssues: timelineCatalogIssues,
  };
  return {
    ok: false,
    code: 'operator-config-timeline-invariant-failed',
    message: 'The operator configuration preview changed a typed timeline invariant.',
    component: 'operator-config',
    retryable: false,
    failureStage: stage,
    currentCheckoutTouched,
    nextAction: 'No branch or checkout change was applied. Report this typed invariant failure and its changed paths; do not refresh or retry this mutation in the current turn.',
    diagnostics,
    timelinePreservation,
    timelineCatalogIssues,
  };
}

function normalizeLiveDefOperatorConfig(snapshot, finalConfig) {
  const live = Array.isArray(snapshot?.operatorConfigs)
    ? snapshot.operatorConfigs.find((config) => config?.characterId === finalConfig?.characterId) || null
    : null;
  return live ? {
    characterId: live.characterId,
    characterName: live.characterName,
    weapon: {
      id: live.weapon?.id || '', name: live.weapon?.name || '', level: live.weapon?.level,
      potential: live.weapon?.potential || '', skillLevels: live.weapon?.skillLevels || {},
    },
    equipment: (Array.isArray(live.equipment) ? live.equipment : []).map((piece) => ({
      slotKey: piece?.slotKey || '', equipmentId: piece?.equipmentId || '', name: piece?.name || '',
      effects: (Array.isArray(piece?.effects) ? piece.effects : []).map((effect) => ({ effectId: effect?.effectId || '', label: effect?.label || '', level: effect?.level, value: effect?.value })),
    })),
    operatorSkillLevels: live.operatorSkillLevels || live.skillConfig || {},
  } : null;
}

async function waitForExactDefOperatorConfig(finalConfig, waitMs) {
  const deadline = Date.now() + normalizeDefVerifyWaitMs(waitMs, 8000);
  let snapshot = readMainWorkbenchSnapshotMirror();
  let normalized = normalizeLiveDefOperatorConfig(snapshot, finalConfig);
  while (!exactDefOperatorConfigMatches(normalized, finalConfig) && Date.now() < deadline) {
    await sleep(150);
    snapshot = readMainWorkbenchSnapshotMirror();
    normalized = normalizeLiveDefOperatorConfig(snapshot, finalConfig);
  }
  return { snapshot, normalized, pass: exactDefOperatorConfigMatches(normalized, finalConfig) };
}

async function waitForExactDefOperatorConfigs(finalConfigs, waitMs) {
  const expected = Array.isArray(finalConfigs) ? finalConfigs : [];
  const deadline = Date.now() + normalizeDefVerifyWaitMs(waitMs, 8000);
  let snapshot = readMainWorkbenchSnapshotMirror();
  let normalized = expected.map((finalConfig) => normalizeLiveDefOperatorConfig(snapshot, finalConfig));
  let pass = expected.length > 0 && expected.every((finalConfig, index) => exactDefOperatorConfigMatches(normalized[index], finalConfig));
  while (!pass && Date.now() < deadline) {
    await sleep(150);
    snapshot = readMainWorkbenchSnapshotMirror();
    normalized = expected.map((finalConfig) => normalizeLiveDefOperatorConfig(snapshot, finalConfig));
    pass = expected.length > 0 && expected.every((finalConfig, index) => exactDefOperatorConfigMatches(normalized[index], finalConfig));
  }
  return { snapshot, normalized, pass };
}

async function executeDefOperatorConfigPrepare(input = {}) {
  const gate = resolveCanonicalWorkbenchCurrent(input);
  if (!gate.ok) return { ok: false, code: gate.code, component: 'operator-config', retryable: false, nextAction: gate.message };
  const nodeMetadata = readAgentWorkNodeMetadata(input);
  if (!nodeMetadata.ok) return { ...nodeMetadata, component: 'operator-config', retryable: false, nextAction: nodeMetadata.message };
  const planned = buildDefOperatorConfigPreviewCommand(input);
  if (!planned.ok) return planned;
  const definition = getDefToolDefinition('def.operator.config.patch');
  const enqueued = enqueueDefToolCommands(definition, [{ op: 'previewOperatorConfig', request: planned.command }], input);
  if (enqueued.status < 200 || enqueued.status >= 300 || !enqueued.body?.commands?.[0]) {
    return { ok: false, code: 'operator-config-preview-enqueue-failed', component: 'operator-config', retryable: true, nextAction: 'Restore the current Workbench connection and retry the preview.', enqueue: enqueued.body || null };
  }
  const verification = await buildDefToolCommandVerification(enqueued.body.commands[0], input.waitMs);
  const preview = verification?.result?.result;
  if (!verification.pass || !isObject(preview?.preparedPayload) || !isObject(preview?.finalConfig)) {
    return { ok: false, code: 'operator-config-preview-failed', component: 'operator-config', retryable: true, nextAction: 'Read the renderer command result; no approval should be requested.', commandVerification: verification };
  }
  const parentNodeId = typeof preview.parentNodeId === 'string' ? preview.parentNodeId : '';
  const parentRevision = Number(preview.parentRevision);
  const parent = readRepositoryWorkNode(parentNodeId);
  const checkout = gate.checkout;
  if (!parent || parent.timelineId !== gate.binding.timelineId || checkout?.targetType !== 'work-node' || checkout.targetId !== parentNodeId || Number(parent.contentRevision || parent.updatedAt) !== parentRevision) {
    return { ok: false, code: 'checkout-changed', component: 'operator-config', retryable: true, nextAction: 'The checkout changed during preview. Re-read it and request a new approval.', currentCheckoutTouched: false };
  }
  const timelinePreservation = verifyDefTimelinePreserved(parent.workingPayload, preview.preparedPayload);
  const timelineCatalogIssues = [
    ...validateDefTimelineAgainstSkillCatalog(parent.workingPayload, gate.snapshot, 'parentPayload'),
    ...validateDefTimelineAgainstSkillCatalog(preview.preparedPayload, gate.snapshot, 'preparedPayload'),
  ];
  if (!timelinePreservation.pass || timelineCatalogIssues.length) {
    return operatorConfigTimelineInvariantFailure({
      stage: 'prepare',
      timelinePreservation,
      timelineCatalogIssues,
    });
  }
  const structuralParentNodeId = horizontalConfigurationParent(parent);
  const created = handleAiTimelineWorkNodeRequest('POST', '/api/ai-timeline-worknodes/create', {
    timelineId: parent.timelineId || parent.saveId,
    parentNodeId: structuralParentNodeId || null,
    branchId: `operator-config-${Date.now()}`,
    label: nodeMetadata.title,
    description: nodeMetadata.description,
    basePayload: parent.workingPayload,
    workingPayload: preview.preparedPayload,
    approvalPolicy: 'manual',
    riskFlags: [{ severity: 'warning', code: 'operator-config-mutation', message: 'Native approval is required before this prepared operator configuration can be applied.' }],
  }, INTERNAL_RAW_TRANSPORT);
  if (created?.status !== 200 || !created?.body?.node) {
    return { ok: false, code: created?.body?.code || 'operator-config-branch-create-failed', component: 'operator-config', retryable: true, nextAction: 'No configuration was applied. Rebuild the preview after resolving the Work Node error.', create: created?.body || null };
  }
  const node = created.body.node;
  prunePreparedOperatorConfigCapabilities();
  const preparedToken = crypto.randomUUID();
  const workingHash = hashDefNodeValue(node.workingPayload);
  preparedOperatorConfigCapabilities.set(preparedToken, {
    nodeId: node.id,
    nodeRevision: Number(node.contentRevision || node.updatedAt),
    parentNodeId,
    parentRevision,
    structuralParentNodeId,
    workingHash,
    sessionId: typeof input.__defSessionId === 'string' ? input.__defSessionId.trim() : '',
    timelineId: gate.binding.timelineId,
    axisBindingId: gate.binding.id,
    consumed: false,
    expiresAt: Date.now() + PREPARED_OPERATOR_CONFIG_TTL_MS,
  });
  return {
    ok: true,
    component: 'operator-config',
    nodeId: node.id,
    nodeRevision: Number(node.contentRevision || node.updatedAt),
    preparedToken,
    workingHash,
    parentNodeId,
    parentRevision,
    structuralParentNodeId,
    timelineId: gate.binding.timelineId,
    axisBindingId: gate.binding.id,
    checkout: { nodeId: parentNodeId, revision: parentRevision },
    nodeTitle: nodeMetadata.title,
    nodeDescription: nodeMetadata.description,
    nodePlacement: 'horizontal-branch',
    finalConfig: preview.finalConfig,
    diff: diffTimelinePayloadsForWorkNode(node.basePayload, node.workingPayload),
    timelinePreservation,
    commandVerification: verification,
  };
}

async function executeDefOperatorConfigApplyPrepared(input = {}) {
  const nodeId = typeof input.nodeId === 'string' ? input.nodeId.trim() : '';
  const parentNodeId = typeof input.parentNodeId === 'string' ? input.parentNodeId.trim() : '';
  const nodeRevision = Number(input.nodeRevision);
  const parentRevision = Number(input.parentRevision);
  const finalConfig = input.finalConfig;
  const preparedToken = typeof input.preparedToken === 'string' ? input.preparedToken : '';
  prunePreparedOperatorConfigCapabilities();
  const capability = preparedOperatorConfigCapabilities.get(preparedToken);
  if (!capability || capability.nodeId !== nodeId || capability.nodeRevision !== nodeRevision
    || capability.parentNodeId !== parentNodeId || capability.parentRevision !== parentRevision) {
    return { ok: false, code: 'prepared-capability-invalid', component: 'operator-config', retryable: false, nextAction: 'Build a new reviewed preview; this apply capability is missing, expired, or does not match the horizontal branch.' };
  }
  const sessionId = typeof input.__defSessionId === 'string' ? input.__defSessionId.trim() : '';
  if (capability.sessionId && capability.sessionId !== sessionId) {
    return { ok: false, code: 'prepared-capability-session-mismatch', component: 'operator-config', retryable: false, nextAction: 'This prepared horizontal branch belongs to a different native session.' };
  }
  if (capability.consumed) {
    return { ok: false, code: 'prepared-capability-consumed', component: 'operator-config', retryable: false, nextAction: 'This prepared horizontal branch has already begun an apply attempt; do not issue a second mutation.' };
  }
  const gate = resolveCanonicalWorkbenchCurrent(input);
  if (!gate.ok || capability.timelineId !== gate.binding.timelineId || capability.axisBindingId !== gate.binding.id) {
    return { ok: false, code: gate.code || 'prepared-capability-session-mismatch', component: 'operator-config', retryable: false, nextAction: 'The current Workbench workspace changed after approval; no mutation was executed.' };
  }
  const node = readRepositoryWorkNode(nodeId);
  const parent = readRepositoryWorkNode(parentNodeId);
  const checkout = gate.checkout;
  if (!node || !parent || node.timelineId !== gate.binding.timelineId || parent.timelineId !== gate.binding.timelineId || checkout?.targetType !== 'work-node' || checkout.targetId !== parentNodeId
    || !sameOptionalNodeId(node.parentNodeId, capability.structuralParentNodeId)
    || Number(parent.contentRevision || parent.updatedAt) !== parentRevision
    || Number(node.contentRevision || node.updatedAt) !== nodeRevision
    || hashDefNodeValue(node.workingPayload) !== capability.workingHash) {
    return { ok: false, code: 'checkout-changed', component: 'operator-config', retryable: true, nextAction: 'Checkout or prepared revision changed during approval; no mutation was executed.', currentCheckoutTouched: false };
  }
  const timelinePreservation = verifyDefTimelinePreserved(parent.workingPayload, node.workingPayload);
  const timelineCatalogIssues = [
    ...validateDefTimelineAgainstSkillCatalog(parent.workingPayload, gate.snapshot, 'parentPayload'),
    ...validateDefTimelineAgainstSkillCatalog(node.workingPayload, gate.snapshot, 'preparedPayload'),
  ];
  if (!timelinePreservation.pass || timelineCatalogIssues.length) {
    return operatorConfigTimelineInvariantFailure({
      stage: 'apply-prepared',
      timelinePreservation,
      timelineCatalogIssues,
    });
  }
  if (!consumeApprovedApplyCapability(input, {
    sessionId,
    timelineId: gate.binding.timelineId,
    axisBindingId: gate.binding.id,
    parentNodeId,
    parentRevision,
    candidateNodeId: nodeId,
    candidateRevision: nodeRevision,
    workingHash: capability.workingHash,
  })) {
    return { ok: false, code: 'approval-capability-required', component: 'operator-config', retryable: false, nextAction: 'Native user approval for this exact candidate is required before apply.' };
  }
  capability.consumed = true;
  // Commit the reviewed horizontal branch before touching the live renderer. It remains
  // un-applied until the exact live mirror has converged.
  const committed = handleAiTimelineWorkNodeRequest('POST', `/api/ai-timeline-worknodes/${encodeURIComponent(nodeId)}/commit`, {
    label: node.label,
    approval: { mode: 'manual', approvedBy: 'user', approvedAt: Date.now(), rationale: 'Native DEF operator configuration approval.' },
  }, INTERNAL_RAW_TRANSPORT);
  if (committed?.status !== 200 || !committed?.body?.commit) {
    return { ok: false, code: committed?.body?.code || 'operator-config-commit-failed', component: 'operator-config', retryable: false, nextAction: 'No live mutation was executed; inspect the prepared horizontal branch before any recovery.' };
  }
  // The approval CAS above protects the reviewed branch revision. Committing
  // that exact branch advances only its lifecycle revision, so the renderer
  // must check the committed revision rather than falsely treating the
  // bridge's own commit as an external checkout change.
  const committedNodeRevision = Number(committed.body.node?.contentRevision || committed.body.node?.updatedAt);
  if (!Number.isFinite(committedNodeRevision)) {
    return { ok: false, code: 'operator-config-commit-revision-missing', component: 'operator-config', retryable: false, nextAction: 'The reviewed branch commit did not return a stable revision; no renderer mutation was executed.' };
  }
  const definition = getDefToolDefinition('def.operator.config.patch');
  const enqueued = enqueueDefToolCommands(definition, [{ op: 'applyPreparedOperatorConfig', parentNodeId, parentRevision, nodeId, nodeRevision: committedNodeRevision }], input);
  if (enqueued.status < 200 || enqueued.status >= 300 || !enqueued.body?.commands?.[0]) {
    return { ok: false, code: 'operator-config-apply-enqueue-failed', component: 'operator-config', retryable: true, nextAction: 'The reviewed branch remains un-applied. Read the queue failure before retrying.', enqueue: enqueued.body || null, commitId: committed.body.commit.id };
  }
  const commandVerification = await buildDefToolCommandVerification(enqueued.body.commands[0], input.waitMs);
  if (!commandVerification.pass) {
    return { ok: false, code: commandVerification?.result?.error?.includes('checkout-changed') ? 'checkout-changed' : 'operator-config-apply-failed', component: 'operator-config', retryable: true, nextAction: 'Read the renderer command result. Do not report applied.', commandVerification };
  }
  const liveVerification = await waitForExactDefOperatorConfig(finalConfig, input.snapshotWaitMs ?? 8000);
  if (!liveVerification.pass) {
    return { ok: false, code: 'postcondition-failed', component: 'operator-config', retryable: true, nextAction: 'The branch commit remains un-applied because the live mirror did not converge to the reviewed values.', nodeId, commitId: committed.body.commit.id, commandVerification, postcondition: { pass: false, live: liveVerification.normalized } };
  }
  const applied = handleAiTimelineWorkNodeRequest('POST', `/api/ai-timeline-worknodes/${encodeURIComponent(nodeId)}/checkout-applied`, {
    commitId: committed.body.commit.id, appliedBy: 'user', appliedAt: Date.now(), rationale: 'Native DEF operator configuration approval applied exact reviewed payload.',
  }, INTERNAL_RAW_TRANSPORT);
  if (applied?.status !== 200) {
    return { ok: false, code: applied?.body?.code || 'operator-config-checkout-apply-failed', component: 'operator-config', retryable: true, nextAction: 'The live mirror changed but the reviewed commit was not marked checkout-applied. Do not report applied.' };
  }
  const finalized = enqueueDefToolCommands(definition, [{ op: 'finalizePreparedOperatorConfig', nodeId, commitId: committed.body.commit.id }], input);
  if (finalized.status < 200 || finalized.status >= 300 || !finalized.body?.commands?.[0]) {
    return { ok: false, code: 'operator-config-finalize-enqueue-failed', component: 'operator-config', retryable: true, nextAction: 'The commit is applied but the renderer checkout did not synchronize; reconcile before another mutation.' };
  }
  const finalizeVerification = await buildDefToolCommandVerification(finalized.body.commands[0], input.waitMs);
  if (!finalizeVerification.pass) {
    return { ok: false, code: finalizeVerification?.result?.error?.includes('checkout-changed') ? 'checkout-changed' : 'operator-config-finalize-failed', component: 'operator-config', retryable: true, nextAction: 'The commit is applied but the renderer checkout did not synchronize; reconcile before another mutation.', finalizeVerification };
  }
  const liveNormalized = liveVerification.normalized;
  const payloadNormalized = extractDefOperatorConfig(node.workingPayload, finalConfig?.characterId);
  const commitNormalized = extractDefOperatorConfig(committed.body.commit.appliedPayload, finalConfig?.characterId);
  const exact = {
    liveMirror: exactDefOperatorConfigMatches(liveNormalized, finalConfig),
    checkoutPayload: exactDefOperatorConfigMatches(payloadNormalized, finalConfig),
    commitPayload: exactDefOperatorConfigMatches(commitNormalized, finalConfig),
  };
  const visibleProjection = await waitForWorkbenchProjectionPayload(
    node.timelineId,
    node.workingPayload,
    input.snapshotWaitMs ?? 8000,
    (snapshot) => snapshot?.checkout?.targetType === 'work-node' && snapshot.checkout.targetId === node.id,
  );
  const visibleTimeline = verifyVisibleTimelineButtons(node.workingPayload, visibleProjection.snapshot);
  const pass = exact.liveMirror && exact.checkoutPayload && exact.commitPayload
    && timelinePreservation.pass && visibleProjection.pass && visibleTimeline.pass;
  if (pass) preparedOperatorConfigCapabilities.delete(preparedToken);
  return {
    ok: pass, component: 'operator-config', code: pass ? 'applied' : 'postcondition-failed', retryable: !pass,
    nextAction: pass ? 'None.' : 'Inspect live mirror, branch working payload, and checkoutApplied commit; do not describe the change as applied.',
    nodeId, commitId: committed.body.commit.id, nodeTitle: node.label, nodeDescription: node.description || '', nodePlacement: 'horizontal-branch',
    structuralParentNodeId: capability.structuralParentNodeId || null,
    finalConfig, commandVerification, finalizeVerification,
    postcondition: { pass, exact, timelinePreservation, visibleProjection: visibleProjection.pass, visibleTimeline, live: liveNormalized, checkoutPayload: payloadNormalized, commitPayload: commitNormalized },
  };
}

function discardDefPreparedOperatorConfig(input = {}) {
  const nodeId = typeof input.nodeId === 'string' ? input.nodeId.trim() : '';
  const parentNodeId = typeof input.parentNodeId === 'string' ? input.parentNodeId.trim() : '';
  const nodeRevision = Number(input.nodeRevision);
  const parentRevision = Number(input.parentRevision);
  const preparedToken = typeof input.preparedToken === 'string' ? input.preparedToken : '';
  if (!nodeId) return { ok: false, code: 'missing-node-id', component: 'operator-config', retryable: false, nextAction: 'No prepared node id was supplied.' };
  prunePreparedOperatorConfigCapabilities();
  const capability = preparedOperatorConfigCapabilities.get(preparedToken);
  if (!capability || capability.nodeId !== nodeId || capability.parentNodeId !== parentNodeId
    || capability.nodeRevision !== nodeRevision || capability.parentRevision !== parentRevision) {
    return { ok: false, code: 'prepared-capability-invalid', component: 'operator-config', retryable: false, nextAction: 'Discard requires the matching active prepared capability; no node was deleted.' };
  }
  const sessionId = typeof input.__defSessionId === 'string' ? input.__defSessionId.trim() : '';
  if (capability.sessionId && capability.sessionId !== sessionId) {
    return { ok: false, code: 'prepared-capability-session-mismatch', component: 'operator-config', retryable: false, nextAction: 'This prepared horizontal branch belongs to a different native session.' };
  }
  const gate = resolveCanonicalWorkbenchCurrent(input);
  if (!gate.ok || capability.timelineId !== gate.binding.timelineId || capability.axisBindingId !== gate.binding.id) {
    return { ok: false, code: gate.code || 'prepared-capability-session-mismatch', component: 'operator-config', retryable: false, nextAction: 'The current Workbench workspace changed; no prepared node was deleted.' };
  }
  const node = readRepositoryWorkNode(nodeId);
  const parent = readRepositoryWorkNode(parentNodeId);
  const checkout = gate.checkout;
  const latestCommit = node ? getTimelineRepository().getLatestWorkNodeCommit(node.id) : null;
  const hasPreparedChild = node
    ? listRepositoryWorkNodes().some((candidate) => candidate.parentNodeId === node.id)
    : false;
  if (!node || !parent || node.timelineId !== gate.binding.timelineId || parent.timelineId !== gate.binding.timelineId || checkout?.targetType !== 'work-node' || checkout.targetId !== parentNodeId
    || !sameOptionalNodeId(node.parentNodeId, capability.structuralParentNodeId) || node.status !== 'open' || node.approvalPolicy !== 'manual'
    || Number(node.contentRevision || node.updatedAt) !== nodeRevision
    || Number(parent.contentRevision || parent.updatedAt) !== parentRevision
    || hashDefNodeValue(node.workingPayload) !== capability.workingHash
    || latestCommit || hasPreparedChild || (checkout?.targetType === 'work-node' && checkout.targetId === nodeId)) {
    return { ok: false, code: 'prepared-discard-precondition-failed', component: 'operator-config', retryable: false, nextAction: 'The prepared horizontal branch is no longer an uncommitted open/manual leaf; no node was deleted.' };
  }
  const deleted = handleAiTimelineWorkNodeRequest('POST', `/api/ai-timeline-worknodes/${encodeURIComponent(nodeId)}/delete`, {}, INTERNAL_RAW_TRANSPORT);
  if (deleted?.status === 200) preparedOperatorConfigCapabilities.delete(preparedToken);
  return deleted?.status === 200
    ? { ok: true, nodeId, discarded: true }
    : { ok: false, code: deleted?.body?.code || 'operator-config-discard-failed', component: 'operator-config', retryable: true, nextAction: 'Remove the unapproved horizontal branch before retrying.', nodeId };
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
  const actualRevision = Number(node.contentRevision || node.updatedAt);
  if (Number.isFinite(Number(node.contentRevision)) && Number.isFinite(Number(input.expectedRevision)) && Number(input.expectedRevision) !== actualRevision) {
    return {
      ok: false,
      code: 'worknode-use-revision-conflict',
      message: `Work Node revision changed from ${input.expectedRevision} to ${actualRevision}. Rebuild and review again before use.`,
      nodeId,
      expectedRevision: Number(input.expectedRevision),
      actualRevision,
      currentCheckoutTouched: false,
    };
  }
  const actualWorkingHash = hashDefNodeValue(node.workingPayload);
  if (!restore && typeof input.expectedWorkingHash === 'string' && input.expectedWorkingHash !== actualWorkingHash) {
    return {
      ok: false,
      code: 'worknode-use-hash-conflict',
      message: 'Work Node payload changed after review. Rebuild and approve the new diff before use.',
      nodeId,
      expectedWorkingHash: input.expectedWorkingHash,
      actualWorkingHash,
      currentCheckoutTouched: false,
    };
  }
  const checkoutDecision = buildAiTimelineCheckoutDecision({
    approvalPolicy: node.approvalPolicy,
    riskFlags: Array.isArray(node.riskFlags) ? node.riskFlags : [],
    diff: diffTimelinePayloadsForWorkNode(node.basePayload, node.workingPayload),
  });
  let rendererApproval;
  if (checkoutDecision.requiresManualApproval) {
    const gate = input.__defCurrentGate;
    const approved = consumeApprovedApplyCapability(input, {
      sessionId: typeof input.__defSessionId === 'string' ? input.__defSessionId.trim() : '',
      timelineId: gate?.binding?.timelineId || node.timelineId || node.saveId,
      axisBindingId: gate?.binding?.id || '',
      candidateNodeId: nodeId,
      candidateRevision: actualRevision,
      workingHash: actualWorkingHash,
    });
    if (!approved) {
      return {
        ok: false,
        code: 'worknode-approval-capability-invalid',
        message: 'The reviewed Work Node requires a fresh native approval bound to this exact revision and payload.',
        nodeId,
        currentCheckoutTouched: false,
      };
    }
    rendererApproval = {
      mode: 'manual',
      approvedBy: 'user',
      rationale: 'Approved through the native DEF permission continuation.',
    };
  }
  const before = readMainWorkbenchSnapshotMirror();
  const expectedPayload = restore ? node.basePayload : node.workingPayload;
  const expectedSummary = summarizeTimelinePayload(expectedPayload);
  const payloadFieldName = restore ? 'basePayload' : 'workingPayload';
  const payloadIssues = [
    ...validateDefTimelinePayload(expectedPayload, payloadFieldName),
    ...validateDefTimelineAgainstSkillCatalog(expectedPayload, before, payloadFieldName),
  ];
  if (payloadIssues.length) {
    return {
      ok: false,
      code: 'worknode-visible-payload-invalid',
      message: payloadIssues.map((issue) => issue.message).join('; '),
      nodeId,
      validation: { ok: false, issues: payloadIssues },
      currentCheckoutTouched: false,
    };
  }
  const definition = getDefToolDefinition(restore ? 'def.worknode.restore_base' : 'def.worknode.checkout');
  const commandInput = {
    ...input,
    nodeId,
    reload: input.reload === true ? true : false,
    ...(rendererApproval ? { approval: rendererApproval } : {}),
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
  const projection = commandVerification.pass
    ? await waitForWorkbenchProjectionPayload(
      node.timelineId || node.saveId || 'current-main-workbench',
      expectedPayload,
      input.snapshotWaitMs ?? 5000,
      (snapshot) => snapshot?.checkout?.targetType === 'work-node' && snapshot.checkout.targetId === nodeId,
    )
    : { pass: false, snapshot: readMainWorkbenchSnapshotMirror() };
  const after = projection.snapshot;
  const countVerification = verifyDefSnapshotDelta(after, {
    expected: { buttonCount: { equals: expectedSummary.buttonCount } },
  });
  const visibleButtonVerification = verifyVisibleTimelineButtons(expectedPayload, after);
  const snapshotVerification = {
    pass: countVerification.pass && projection.pass && visibleButtonVerification.pass,
    count: countVerification,
    projectionPass: projection.pass,
    visibleButtons: visibleButtonVerification,
  };
  const expectedStaffCounts = Object.values(isObject(expectedPayload?.skillButtonTable) ? expectedPayload.skillButtonTable : {})
    .reduce((counts, button) => {
      const staffIndex = Number(button?.staffIndex);
      if (Number.isInteger(staffIndex) && staffIndex >= 0) counts[staffIndex] = (counts[staffIndex] || 0) + 1;
      return counts;
    }, {});
  const actualStaffCounts = (Array.isArray(after?.skillButtons) ? after.skillButtons : [])
    .reduce((counts, button) => {
      const staffIndex = Number(button?.persistenceStaffIndex ?? button?.lineIndex);
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
  const checkoutRef = getTimelineRepository().getCheckoutRef(node.timelineId || node.saveId || 'current-main-workbench');
  const checkoutVerification = {
    pass: checkoutRef?.targetType === 'work-node' && checkoutRef.targetId === nodeId,
    actual: checkoutRef || null,
  };
  const rendererError = typeof commandVerification?.result?.error === 'string'
    ? commandVerification.result.error
    : '';
  const applied = commandVerification.pass
    && checkoutVerification.pass
    && snapshotVerification.pass
    && staffIndexVerification.pass;
  return {
    ok: applied,
    code: applied ? 'applied' : 'visible-postcondition-failed',
    message: applied
      ? 'Renderer checkout completed and the canonical visible projection matches the reviewed payload.'
      : rendererError || (commandVerification.pass
        ? 'Renderer command completed but the canonical visible projection did not match the reviewed payload.'
        : 'Renderer checkout command did not complete successfully.'),
    rendererError,
    currentCheckoutTouched: commandVerification.pass,
    nodeId,
    mode: restore ? 'restore_base' : 'checkout',
    command: enqueued.body.command,
    commandVerification,
    before: { buttonCount: snapshotButtonCount(before), snapshotUpdatedAt: before?.updatedAt || null },
    after: { buttonCount: snapshotButtonCount(after), snapshotUpdatedAt: after?.updatedAt || null },
    expectedSummary,
    snapshotVerification,
    visibleButtonVerification,
    staffIndexVerification,
    checkoutVerification,
    reload: commandInput.reload,
    note: applied
      ? 'Command reached terminal success and every persisted button identity was observed in the canonical Canvas projection.'
      : commandVerification.pass
        ? 'The command completed, but one or more checkout, projection, identity, or staff-line postconditions failed; report not fully applied.'
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
  const normalizedCommand = enqueued.body.command.command || {};
  const expectedStaffIndex = Number.isInteger(normalizedCommand.staffIndex) ? normalizedCommand.staffIndex : 0;
  const placementVerification = {
    pass: Boolean(addedButton)
      && addedButton.staffIndex === expectedStaffIndex
      && (!Number.isInteger(normalizedCommand.nodeIndex) || addedButton.nodeIndex === normalizedCommand.nodeIndex),
    expected: {
      staffIndex: expectedStaffIndex,
      nodeIndex: Number.isInteger(normalizedCommand.nodeIndex) ? normalizedCommand.nodeIndex : null,
    },
    actual: addedButton ? { staffIndex: addedButton.staffIndex, nodeIndex: addedButton.nodeIndex } : null,
  };
  return {
    ok: commandVerification.pass && snapshotVerification.pass && placementVerification.pass,
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
    placementVerification,
    note: commandVerification.pass && snapshotVerification.pass && placementVerification.pass
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
    ...(patch.level !== undefined ? { weaponLevel: patch.level } : {}),
    ...(typeof patch.potential === 'string' ? { potential: patch.potential } : {}),
    ...(isObject(patch.skillLevels) ? { weaponSkillLevels: patch.skillLevels } : {}),
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
    ...(selection.entryLevel !== undefined ? { equipmentEntryLevel: selection.entryLevel } : input.equipmentEntryLevel !== undefined ? { equipmentEntryLevel: input.equipmentEntryLevel } : input.entryLevel !== undefined ? { equipmentEntryLevel: input.entryLevel } : {}),
    ...(selection.entryLevels !== undefined ? { equipmentEntryLevels: selection.entryLevels } : input.equipmentEntryLevels !== undefined ? { equipmentEntryLevels: input.equipmentEntryLevels } : input.entryLevels !== undefined ? { equipmentEntryLevels: input.entryLevels } : {}),
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
  const equipmentCommands = normalizeDefToolEquipmentCommands(input);
  if (equipmentCommands.length === 1) {
    const weapon = weaponCommand
      ? Object.fromEntries(Object.entries(weaponCommand).filter(([key]) => !['op', 'characterId', 'characterName'].includes(key)))
      : {};
    const { op: _equipmentOp, characterId: _equipmentCharacterId, characterName: _equipmentCharacterName, ...equipment } = equipmentCommands[0];
    void _equipmentOp;
    void _equipmentCharacterId;
    void _equipmentCharacterName;
    commands.push({
      op: 'setOperatorConfig',
      ...compactOperatorCommandTarget(input),
      ...(weaponCommand ? weapon : {}),
      ...equipment,
      ...(isObject(input.operatorSkillLevels) ? { operatorSkillLevels: input.operatorSkillLevels } : {}),
    });
    return commands;
  }
  if (weaponCommand) commands.push({ ...weaponCommand, ...(isObject(input.operatorSkillLevels) ? { operatorSkillLevels: input.operatorSkillLevels } : {}) });
  commands.push(...equipmentCommands);
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

function applyDefToolInvocationPolicy(name, definition, input, invocation = {}) {
  const policy = resolveDefToolAccessPolicy(name, definition || { name });
  const deniedHost = (host) => ({
    ok: false,
    response: failScript(403, 'denied-tool-host', `DEF tool ${name} is not available to host ${host}.`),
  });
  if (policy.workspaceScope === DEF_WORKSPACE_SCOPE.INTERNAL_GOVERNANCE) {
    if (!defInternalGovernanceToken || invocation.internalToken !== defInternalGovernanceToken) {
      return { ok: false, response: failScript(403, 'denied-internal-governance', 'This DEF governance capability is available only to the native host.') };
    }
    return { ok: true, input, policy };
  }
  // The bridge response carries catalog bytes only so the native plugin can
  // write them into its own session directory. A generic loopback caller must
  // never receive that transport payload, even though the persisted artifact
  // itself is read-only.
  if (name === 'def.native_catalog.materialize' || name === 'def.equipment.3plus1.facts') {
    const sessionId = typeof input.__defSessionId === 'string' ? input.__defSessionId.trim() : '';
    const registration = restoreRegisteredDefNativeCatalogSession(input, invocation);
    if (!registration || !defInternalGovernanceToken || invocation.internalToken !== defInternalGovernanceToken) {
      return {
        ok: false,
        response: failScript(403, 'denied-native-catalog-session', 'Native catalog materialization and 3+1 facts require an authenticated, registered DEF native session.'),
      };
    }
    return { ok: true, input: { ...input, __defNativeCatalogSessionId: sessionId, __defNativeCatalogSession: registration }, policy };
  }
  // This private continuation is the sole exception to the normal current
  // projection gate.  It cannot create a plan, mint approval, or choose a
  // command: it can only re-observe the server-stored exact pending command
  // for its owning bound session and converge P/C back through guarded
  // rollback.
  if (name === 'def.team.loadout.plan.apply.reconcile') {
    const reconciliation = resolvePendingTeamLoadoutReconciliation(input);
    if (!reconciliation.ok) {
      return { ok: false, response: failScript(reconciliation.status || 409, reconciliation.code, reconciliation.message, { state: reconciliation.state }) };
    }
    if (reconciliation.session?.binding?.host !== 'workbench') return deniedHost(reconciliation.session?.binding?.host || 'unknown');
    return { ok: true, input: { ...input, __defPendingTeamReconciliation: reconciliation }, policy };
  }
  // A decision is emitted only after OpenCode's native permission UI resolves.
  // A model-facing caller may request an approval record, but cannot mint the
  // capability that authorizes apply by posting an "approved" decision.
  if (name === 'def.approval.record_decision'
    && (!defInternalGovernanceToken || invocation.internalToken !== defInternalGovernanceToken)) {
    return { ok: false, response: failScript(403, 'denied-approval-decision', 'Approval decisions are accepted only from the native permission continuation.') };
  }
  if (policy.projectionAccess === DEF_PROJECTION_ACCESS.MIXED_CURRENT_PUBLIC) {
    if (input.catalogOnly === true) {
      const requestedHost = typeof input.__defSessionId === 'string' && input.__defSessionId.trim() ? 'workbench' : 'ai-cli';
      if (!policy.allowedHosts.includes(requestedHost)) return deniedHost(requestedHost);
      return { ok: true, input: { ...input, __defPublicOnly: true }, policy };
    }
    const sessionId = typeof input.__defSessionId === 'string' ? input.__defSessionId.trim() : '';
    if (!sessionId) {
      if (!policy.allowedHosts.includes('ai-cli')) return deniedHost('ai-cli');
      return { ok: true, input: { ...input, __defPublicOnly: true }, policy };
    }
    const gate = resolveCanonicalWorkbenchCurrent(input);
    if (!gate.ok) return { ok: false, response: failScript(gate.status, gate.code, gate.message, { state: gate.state }) };
    if (!policy.allowedHosts.includes(gate.binding.host)) return deniedHost(gate.binding.host);
    return { ok: true, input: { ...input, timelineId: gate.binding.timelineId, __defCurrentGate: gate, __defPublicOnly: false }, policy };
  }
  if (policy.workspaceScope === DEF_WORKSPACE_SCOPE.WORKBENCH_CURRENT
    || policy.workspaceScope === DEF_WORKSPACE_SCOPE.WORKNODE_TREE) {
    const nodeId = policy.workspaceScope === DEF_WORKSPACE_SCOPE.WORKNODE_TREE && typeof input.nodeId === 'string'
      ? input.nodeId.trim()
      : '';
    const gate = resolveCanonicalWorkbenchCurrent(input, { nodeId });
    if (!gate.ok) return { ok: false, response: failScript(gate.status, gate.code, gate.message, { state: gate.state }) };
    if (!policy.allowedHosts.includes(gate.binding.host)) return deniedHost(gate.binding.host);
    return { ok: true, input: { ...input, timelineId: gate.binding.timelineId, __defCurrentGate: gate }, policy };
  }
  if (!policy.allowedHosts.includes('ai-cli')) return deniedHost('ai-cli');
  return { ok: true, input, policy };
}

async function executeDefTool(name, input = {}, query = new URLSearchParams(), invocation = {}) {
  // These three names are private continuations of the single public typed
  // operator-config tool.  They are intentionally not registry routes: only
  // the native adapter can call them after it has constructed a reviewed
  // child-node plan, so they cannot become a generic mutation backdoor.
  const privateOperatorConfigContinuation = new Set([
    'def.operator.config.prepare',
    'def.operator.config.apply_prepared',
    'def.operator.config.discard_prepared',
    'def.team.loadout.plan.remember_guide',
    'def.team.loadout.plan.revise',
    'def.team.loadout.plan.apply.prepare',
    'def.team.loadout.plan.apply.discard',
    'def.team.loadout.plan.apply.reconcile',
  ]);
  const privateTeamApplyContinuation = name === 'def.team.loadout.plan.apply.reconcile';
  const definition = getDefToolDefinition(name)
    || (privateTeamApplyContinuation ? getDefToolDefinition('def.team.loadout.plan.apply') : null)
    || ((name === 'def.team.loadout.plan.remember_guide' || name === 'def.team.loadout.plan.revise' || name === 'def.team.loadout.plan.apply.prepare' || name === 'def.team.loadout.plan.apply.discard') ? getDefToolDefinition('def.team.loadout.plan.prepare') : null)
    || (privateOperatorConfigContinuation.has(name) ? getDefToolDefinition('def.operator.config.patch') : null);
  if (!definition) {
    return failScript(404, 'def-tool-not-found', `Unknown DEF tool: ${name}`, {
      availableTools: DEF_TOOL_DEFINITIONS.map((tool) => tool.name),
    });
  }
  if (definition.status === 'planned') {
    return failScript(501, 'def-tool-planned', `DEF tool is planned but not implemented yet: ${name}`, { tool: definition });
  }
  const authorized = applyDefToolInvocationPolicy(name, definition, input, invocation);
  if (!authorized.ok) return authorized.response;
  input = authorized.input;
  if (name === 'def.workbench.assert_session_axis') {
    const sessionID = typeof input.sessionID === 'string' ? input.sessionID.trim() : '';
    const bindingId = typeof input.sessionBindingId === 'string' ? input.sessionBindingId.trim() : '';
    const timelineId = typeof input.timelineId === 'string' ? input.timelineId.trim() : '';
    if (!sessionID || !bindingId || input.host !== 'workbench' || !timelineId) {
      return failScript(400, 'blocked-binding', 'Workbench binding assertion requires sessionBindingId, sessionID, host=workbench, and timelineId.');
    }
    const repository = getTimelineRepository();
    const binding = repository.getSessionAxisBinding(bindingId);
    const document = repository.getDocument(timelineId);
    if (!binding || binding.host !== 'workbench' || binding.opencodeSessionId !== sessionID || binding.timelineId !== timelineId) {
      return failScript(409, 'blocked-session-mismatch', 'The Workbench session binding does not match its SQLite workspace.');
    }
    if (!document || document.archivedAt) return failScript(409, 'blocked-binding-stale', 'The SQLite workspace bound to this DEF session is no longer available.');
    if (document.isTemporary) return failScript(409, 'blocked-temporary-workspace', 'Temporary SQLite workspaces cannot be bound to DEF OpenCode.');
    return { status: 200, body: { ok: true, protocolVersion: 1, tool: name, result: { ok: true, binding, document } } };
  }
  if (name === 'def.workbench.assert_timeline_admission') {
    const timelineId = typeof input.timelineId === 'string' ? input.timelineId.trim() : '';
    if (!timelineId) return failScript(400, 'blocked-binding', 'Workbench session creation requires timelineId.');
    const document = getTimelineRepository().getDocument(timelineId);
    if (!document || document.archivedAt) return failScript(404, 'blocked-binding', 'The requested SQLite workspace is unavailable.');
    if (document.isTemporary) return failScript(409, 'blocked-temporary-workspace', 'Temporary SQLite workspaces cannot open DEF AI mode.');
    return { status: 200, body: { ok: true, protocolVersion: 1, tool: name, result: { ok: true, document } } };
  }
  if (name === 'def.native_catalog.register_session') {
    const registration = registerDefNativeCatalogSession(input);
    if (!registration) {
      return failScript(400, 'invalid-native-catalog-session', 'Native catalog session registration requires a valid sessionId and host.');
    }
    return {
      status: 200,
      body: {
        ok: true,
        protocolVersion: 1,
        tool: name,
        result: { ok: true, sessionId: registration.sessionId, host: registration.host, registeredAt: registration.registeredAt, expiresAt: registration.expiresAt },
      },
    };
  }
  if (name === 'def.worknode.create_from_current') {
    const session = input.__defCurrentGate || resolveCanonicalWorkbenchCurrent(input);
    if (!session.ok) return failScript(session.status, session.code, session.message, { state: session.state });
    const payloadSource = session.checkoutPayload ? {
      payload: cloneJson(session.checkoutPayload),
      source: `current-checkout-${session.checkout.targetType}`,
      sourceId: session.checkout.targetId,
      timelineId: session.binding.timelineId,
      sourceUpdatedAt: session.checkout.updatedAt,
    } : null;
    const result = createDefWorkNodeFromPayload(payloadSource, { ...input, timelineId: session.binding.timelineId });
    return { status: result.ok ? 200 : 400, body: { ok: result.ok, protocolVersion: 1, tool: name, result } };
  }
  if (name === 'def.workbench.bind_session_axis') {
    const bindingId = typeof input.sessionBindingId === 'string' ? input.sessionBindingId.trim() : '';
    const sessionID = typeof input.sessionID === 'string' ? input.sessionID.trim() : '';
    const host = input.host === 'workbench' ? 'workbench' : '';
    const timelineId = typeof input.timelineId === 'string' && input.timelineId.trim() ? input.timelineId.trim() : '';
    if (!bindingId || !sessionID || !host || !timelineId) {
      return failScript(400, 'blocked-binding', 'sessionBindingId, sessionID, host=workbench, and timelineId are required.');
    }
    const repository = getTimelineRepository();
    try {
      const binding = repository.upsertSessionAxisBinding({
        id: bindingId,
        timelineId,
        host,
        opencodeSessionId: sessionID,
        boundNodeId: typeof input.boundNodeId === 'string' && input.boundNodeId.trim()
          ? input.boundNodeId.trim()
          : null,
      });
      return { status: 200, body: { ok: true, protocolVersion: 1, tool: name, result: { ok: true, binding, context: repository.getSessionAxisContext(binding.id) } } };
    } catch (error) {
      return failScript(error?.status || 409, error?.code || 'blocked-binding', error instanceof Error ? error.message : 'Workbench binding failed.');
    }
  }
  if (name === 'def.workbench.unbind_session_axis') {
    const bindingId = typeof input.sessionBindingId === 'string' ? input.sessionBindingId.trim() : '';
    const sessionID = typeof input.sessionID === 'string' ? input.sessionID.trim() : '';
    if (!bindingId || !sessionID) return failScript(400, 'invalid-session-axis-binding', 'sessionBindingId and sessionID are required.');
    const binding = getTimelineRepository().getSessionAxisBinding(bindingId);
    if (!binding || binding.host !== 'workbench' || binding.opencodeSessionId !== sessionID) {
      return failScript(409, 'blocked-session-mismatch', 'The requested binding does not belong to this Workbench session.');
    }
    const result = getTimelineRepository().deleteSessionAxisBinding(bindingId);
    return { status: 200, body: { ok: true, protocolVersion: 1, tool: name, result: { ok: true, ...result } } };
  }
  if (name === 'def.worknode.list') {
    const session = input.__defCurrentGate || resolveCanonicalWorkbenchCurrent(input);
    if (!session.ok) return failScript(session.status, session.code, session.message, { state: session.state });
    const limit = Math.max(1, Math.min(Number(input.limit || 50) || 50, 100));
    const nodes = listRepositoryWorkNodes()
      .filter((node) => (node.timelineId || node.saveId) === session.binding.timelineId)
      .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
      .slice(0, limit)
      .map(toAiTimelineWorkNodeListItem);
    return { status: 200, body: { ok: true, protocolVersion: 1, tool: name, result: { ok: true, nodes } } };
  }
  if (name === 'def.worknode.delete') {
    const nodeId = typeof input.nodeId === 'string' ? input.nodeId.trim() : '';
    if (!nodeId) return failScript(400, 'missing-node-id', 'def.worknode.delete requires nodeId.');
    const session = resolveBoundWorkbenchSession(input, { nodeId });
    if (!session.ok) return failScript(session.status, session.code, session.message, { state: session.state });
    try {
      const repository = getTimelineRepository();
      const legacyStore = getAiTimelineWorkNodeStore();
      if (!repository.getWorkNode(nodeId)) return failScript(404, 'ai-worknode-not-found', `AI timeline work node not found: ${nodeId}`);
      repository.assertWorkNodeSubtreeDeletable(nodeId);
      repository.deleteWorkNodeSubtree(nodeId);
      if (legacyStore.getNode(nodeId)) legacyStore.deleteSubtreeProjection(nodeId);
      return { status: 200, body: { ok: true, protocolVersion: 1, tool: name, result: { ok: true, nodeId, deleted: true } } };
    } catch (error) {
      if (error?.code === 'ai-worknode-current-checkout-protected') return failScript(409, error.code, error.message, { nodeId });
      throw error;
    }
  }
  if (definition.commandOp) return enqueueDefToolCommand(definition, input);

  if (name === 'def.buff.add_to_buttons') {
    const buttonIds = [...new Set((Array.isArray(input.buttonIds) ? input.buttonIds : [])
      .filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))];
    if (buttonIds.length < 2 || !isObject(input.buff)) {
      return failScript(400, 'invalid-batch-buff-input', 'Batch buff mutation requires at least two buttonIds and one buff object.');
    }
    const buffId = typeof input.buff.id === 'string' && input.buff.id.trim()
      ? input.buff.id.trim()
      : `def-batch-buff-${Date.now()}`;
    const result = applyDefWorkNodePatchAndValidate({
      ...input,
      checkout: input.checkout !== false,
      approvalPolicy: 'ask-on-risk',
      label: typeof input.label === 'string' && input.label.trim() ? input.label.trim() : '[ai] 批量添加 Buff',
      riskFlags: [
        ...(Array.isArray(input.riskFlags) ? input.riskFlags : []),
        makeDefWorkNodeRiskFlag('warning', 'multi-button-mutation', `Batch mutation targets ${buttonIds.length} buttons.`),
      ],
      patch: buttonIds.map((buttonId) => ({
        op: 'attachBuff',
        target: { buttonId },
        buffId,
        buff: { ...input.buff, id: buffId },
      })),
    });
    return { status: result.ok ? 200 : 400, body: { ok: result.ok, protocolVersion: 1, tool: name, result } };
  }

  if (name === 'def.operator.config.patch') {
    const result = await executeDefOperatorConfigPatchAndVerify(definition, input);
    return { status: result.ok ? 200 : 409, body: { ok: result.ok, protocolVersion: 1, tool: name, result } };
  }
  if (name === 'def.operator.config.prepare') {
    const result = await executeDefOperatorConfigPrepare(input);
    return { status: result.ok ? 200 : 409, body: { ok: result.ok, protocolVersion: 1, tool: name, result } };
  }
  if (name === 'def.operator.config.apply_prepared') {
    const result = await executeDefOperatorConfigApplyPrepared(input);
    return { status: result.ok ? 200 : 409, body: { ok: result.ok, protocolVersion: 1, tool: name, result } };
  }
  if (name === 'def.operator.config.discard_prepared') {
    const result = discardDefPreparedOperatorConfig(input);
    return { status: result.ok ? 200 : 409, body: { ok: result.ok, protocolVersion: 1, tool: name, result } };
  }
  if (name === 'def.gear.set_entry_level') {
    const commandsOrResponse = buildDefGearEntryLevelCommands(input);
    if (commandsOrResponse?.status && commandsOrResponse?.body) return commandsOrResponse;
    return enqueueDefToolCommands(definition, commandsOrResponse, input);
  }
  if (name === 'def.worknode.checkout_and_verify') {
    const session = resolveBoundWorkbenchSession(input, { nodeId: typeof input.nodeId === 'string' ? input.nodeId.trim() : '' });
    if (!session.ok) return failScript(session.status, session.code, session.message, { state: session.state });
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
    const session = resolveBoundWorkbenchSession(input, { nodeId: typeof input.nodeId === 'string' ? input.nodeId.trim() : '' });
    if (!session.ok) return failScript(session.status, session.code, session.message, { state: session.state });
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
    result = { tools: DEF_TOOL_DEFINITIONS.filter((tool) => tool.exposure.length > 0) };
  } else if (name === 'def.tool.describe') {
    const targetName = input.name || input.tool || query.get('name') || '';
    result = { tool: getDefToolDefinition(targetName) };
    if (!result.tool || result.tool.exposure.length === 0) return failScript(404, 'def-tool-not-found', `Unknown DEF tool: ${targetName}`);
  } else if (name === 'def.workbench.snapshot') {
    const session = input.__defCurrentGate || resolveCanonicalWorkbenchCurrent(input);
    if (!session.ok) return failScript(session.status, session.code, session.message, { state: session.state });
    const requestedBindingId = typeof input.sessionBindingId === 'string' ? input.sessionBindingId.trim() : '';
    if (!requestedBindingId || requestedBindingId !== session.binding.id) {
      return failScript(409, 'blocked-session-mismatch', 'The requested session-axis binding does not belong to this DEF session.');
    }
    result = { snapshot: session.snapshot, axisContext: session.axisContext };
  } else if (name === 'def.workbench.evidence') {
    result = buildMainWorkbenchEvidence(snapshot, {
      prompt: input.prompt || input.query || '',
      previousButtonId: input.previousButtonId || '',
    });
  } else if (name === 'def.workbench.list_buttons' || name === 'def.workbench.find_buttons') {
    result = listDefWorkbenchButtons(input);
  } else if (name === 'def.workbench.rank_buttons_by_buff') {
    result = rankDefWorkbenchButtonsByBuff(input);
  } else if (name === 'def.workbench.list_characters') {
    result = listDefWorkbenchCharacters();
  } else if (name === 'def.team.loadouts.read') {
    result = readDefSelectedTeamLoadouts(input);
    if (!result) return failScript(409, 'snapshot-unavailable', 'Current Workbench snapshot is unavailable.', {
      state: 'BLOCKED_ENVIRONMENT',
      component: 'team-loadouts',
      nextAction: 'Open the current DEF Workbench and wait for its snapshot mirror before retrying.',
    });
  } else if (name === 'def.loadout.candidates.read') {
    result = readDefLoadoutCandidates(input);
    if (!result) return failScript(409, 'snapshot-unavailable', 'Current Workbench snapshot is unavailable.', {
      state: 'BLOCKED_ENVIRONMENT',
      component: 'loadout-candidates',
      nextAction: 'Open the current DEF Workbench and wait for its snapshot mirror before retrying.',
    });
  } else if (name === 'def.team.loadout.plan.remember_guide') {
    result = rememberDefGuideLoadoutSource(input);
    if (!result.ok) return failScript(400, result.code, result.message, { component: result.component });
  } else if (name === 'def.team.loadout.plan.prepare') {
    result = buildDefGuideTeamLoadoutPlan(input);
    if (!result.ok) return failScript(409, result.code, result.message || 'Guide plan source is unavailable.', { component: result.component, state: result.state, nextAction: result.nextAction });
  } else if (name === 'def.team.loadout.plan.revise') {
    result = reviseDefTeamLoadoutPlan(input);
    if (!result.ok) return failScript(409, result.code, result.message || 'Team loadout plan revision is unavailable.', { component: result.component, state: result.state, nextAction: result.nextAction });
  } else if (name === 'def.team.loadout.plan.apply.prepare') {
    result = await prepareDefTeamLoadoutPlanApply(input);
    if (!result.ok) return failScript(409, result.code, result.message || 'Team loadout plan is unavailable.', { component: result.component, state: result.state, nextAction: result.nextAction });
  } else if (name === 'def.team.loadout.plan.apply.discard') {
    result = discardPreparedTeamLoadoutPlan(input);
    if (!result.ok) return failScript(409, result.code, result.message || 'Prepared team loadout candidate could not be discarded.', { component: result.component, state: result.state, nextAction: result.nextAction });
  } else if (name === 'def.team.loadout.plan.apply.reconcile') {
    if (!input.__defPendingTeamReconciliation?.pending) {
      result = { ok: true, state: 'NOT_PENDING', planHash: input.planHash };
    } else {
      const reconciliationResult = await applyDefTeamLoadoutPlan(input);
      // Reconciliation states such as ROLLED_BACK are operational outcomes,
      // not a second user approval failure.  Preserve the exact outcome under
      // a successful private continuation envelope so the native adapter can
      // report it without re-entering the public apply/permission path.
      result = { ok: true, state: reconciliationResult.state, reconciliation: reconciliationResult };
    }
  } else if (name === 'def.team.loadout.plan.apply') {
    result = await applyDefTeamLoadoutPlan(input);
    if (!result.ok) return failScript(409, result.code || 'team-loadout-plan-apply-failed', result.message || 'Team loadout plan was not applied.', { component: 'team-loadout-plan', state: result.state, nextAction: result.nextAction, results: result.results });
  } else if (name === 'def.workbench.damage_report') {
    result = { snapshotUpdatedAt: snapshot?.updatedAt || null, damageReport: snapshot?.damageReport || null };
  } else if (name === 'def.character.resolve') {
    result = resolveDefCharacters(input);
  } else if (name === 'def.operator.catalog.search') {
    result = listDefOperatorCatalog(input);
  } else if (name === 'def.knowledge.game.search') {
    result = searchDefGameKnowledge(input);
  } else if (name === 'def.knowledge.game.section.read') {
    result = readDefGameKnowledgeSection(input);
    if (!result.ok) {
      return failScript(result.status || 400, result.code || 'game-knowledge-section-read-failed', result.message || 'Unable to read game-knowledge section.', {
        component: result.component || 'game-knowledge-section',
        ...(Array.isArray(result.availableSections) ? { availableSections: result.availableSections } : {}),
        nextAction: 'Use def.knowledge.game.search and select an exact allowlisted referenceId plus sectionId.',
      });
    }
  } else if (name === 'def.skill.resolve') {
    result = resolveDefSkills(input);
  } else if (name === 'def.buff.resolve' || name === 'def.buff.search_candidates') {
    result = resolveDefBuffs(input);
  } else if (name === 'def.native_catalog.materialize') {
    result = buildDefNativeCatalogArtifact(input);
    if (!result.ok) {
      return failScript(400, result.code || 'native-catalog-materialize-failed', result.message || 'Unable to capture a native catalog artifact.', {
        domain: result.domain || input.domain || null,
        nextAction: 'Keep this read-only request unmodified and provide a non-empty equipment or weapon query after the local catalog is available.',
      });
    }
  } else if (name === 'def.equipment.3plus1.facts') {
    result = buildDefEquipmentThreePlusOneFacts(input);
    if (!result.ok) {
      return failScript(409, result.code || 'equipment-3plus1-facts-failed', result.message || 'Unable to derive evidence-backed 3+1 equipment facts.', {
        source: result.source,
        candidates: result.candidates,
        expectedSourceRevision: result.expectedSourceRevision,
        actualSourceRevision: result.actualSourceRevision,
        nextAction: result.code === 'equipment-3plus1-source-revision-stale'
          ? 'Materialize a fresh native equipment catalog artifact, read its manifest, then request 3+1 facts again.'
          : 'Use one exact set name from the materialized native artifact and report only the returned fixedStat/effects facts.',
      });
    }
  } else if (name === 'def.equipment.resolve' || name === 'def.gear.resolve') {
    result = resolveDefEquipment(input);
  } else if (name === 'def.weapon.resolve') {
    result = resolveDefWeapons(input);
  } else if (name === 'def.operator.config.read') {
    result = { snapshotUpdatedAt: snapshot?.updatedAt || null, operatorConfigs: snapshot?.operatorConfigs || [] };
  } else if (name === 'def.user.ask') {
    result = createDefUserQuestion(input);
  } else if (name === 'def.user.record_answer') {
    result = recordDefUserQuestionAnswer(input);
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
    const session = resolveBoundWorkbenchSession(input, { nodeId: typeof input.nodeId === 'string' ? input.nodeId.trim() : '' });
    if (!session.ok) return failScript(session.status, session.code, session.message, { state: session.state });
    result = readDefWorkNode(input);
  } else if (name === 'def.worknode.sync_workspace') {
    const session = resolveBoundWorkbenchSession(input, { nodeId: typeof input.nodeId === 'string' ? input.nodeId.trim() : '' });
    if (!session.ok) return failScript(session.status, session.code, session.message, { state: session.state });
    result = syncDefWorkNodeWorkspace(input);
  } else if (name === 'def.worknode.validate') {
    const session = resolveBoundWorkbenchSession(input, { nodeId: typeof input.nodeId === 'string' ? input.nodeId.trim() : '' });
    if (!session.ok) return failScript(session.status, session.code, session.message, { state: session.state });
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

async function handleDefToolRequest(method, pathname, query, body, invocation = {}) {
  // Deliberately unavailable outside the isolated contract child process.
  // It seeds only the in-memory pending-plan map so the REST contract can
  // exercise the real policy → continuation → guarded-rollback path without
  // adding any production data-management capability.
  if (process.env.DEF_CONTRACT_TEST_MODE === '1'
    && method === 'POST' && pathname === '/api/def-contract-test/pending-team-reconciliation') {
    if (!rawTransportAuthorized(invocation)) return denyRawTransport(pathname);
    const planHash = typeof body?.planHash === 'string' ? body.planHash.trim() : '';
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
    const timelineId = typeof body?.timelineId === 'string' ? body.timelineId.trim() : '';
    const axisBindingId = typeof body?.axisBindingId === 'string' ? body.axisBindingId.trim() : '';
    const parentNodeId = typeof body?.parentNodeId === 'string' ? body.parentNodeId.trim() : '';
    const candidateNodeId = typeof body?.candidateNodeId === 'string' ? body.candidateNodeId.trim() : '';
    const pendingCommandId = typeof body?.pendingCommandId === 'string' ? body.pendingCommandId.trim() : '';
    const parent = parentNodeId ? readRepositoryWorkNode(parentNodeId) : null;
    const candidate = candidateNodeId ? readRepositoryWorkNode(candidateNodeId) : null;
    if (!planHash || !sessionId || !timelineId || !axisBindingId || !pendingCommandId || !parent || !candidate
      || parent.timelineId !== timelineId || candidate.timelineId !== timelineId) {
      return failScript(400, 'invalid-contract-pending-team-plan', 'The isolated contract seed requires one bound P/C pair and exact pending command identity.');
    }
    const preparedCandidate = {
      nodeId: candidate.id,
      nodeRevision: Number(candidate.contentRevision || candidate.updatedAt),
      workingHash: hashDefNodeValue(candidate.workingPayload),
      parentNodeId: parent.id,
      parentRevision: Number(parent.contentRevision || parent.updatedAt),
      parentWorkingHash: hashDefNodeValue(parent.workingPayload),
      finalConfigs: [],
      diff: [],
    };
    preparedTeamLoadoutPlans.set(planHash, {
      ok: true, state: 'READY', planId: `contract-${planHash}`, planHash,
      ownerSessionId: sessionId, timelineId, axisBindingId,
      operators: [], confirmedDecisions: [],
      preparedCandidate, usedAt: Date.now(), usedResult: null,
      pendingCommand: { id: pendingCommandId, parentSnapshot: cloneJson(readMainWorkbenchSnapshotMirror() || {}), observedAt: Date.now() },
    });
    writeMainWorkbenchCommandQueue([
      ...readMainWorkbenchCommandQueue().filter((entry) => entry.id !== pendingCommandId),
      normalizeMainWorkbenchCommandEntry({
        id: pendingCommandId,
        status: 'done',
        command: { op: 'applyPreparedOperatorConfig', parentNodeId: parent.id, parentRevision: preparedCandidate.parentRevision, nodeId: candidate.id, nodeRevision: preparedCandidate.nodeRevision },
      }),
    ]);
    return { status: 200, body: { ok: true, planHash, pendingCommandId } };
  }
  if (method === 'GET' && pathname === '/api/def-tools/route-map') {
    return {
      status: 200,
      body: {
        ok: true,
        protocolVersion: 1,
        result: buildDefToolRouteMap(DEF_TOOL_REGISTRY),
      },
    };
  }
  if (method === 'GET' && (pathname === '/api/def-tools' || pathname === '/api/def-tools/list')) {
    return await executeDefTool('def.tool.list', {}, query, invocation);
  }
  if (method === 'GET' && pathname === '/api/def-tools/governance') {
    if (!defInternalGovernanceToken || invocation.internalToken !== defInternalGovernanceToken) {
      return failScript(403, 'denied-governance-read', 'DEF governance records are available only to the native host.');
    }
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
    return await executeDefTool('def.tool.describe', { name: query.get('name') || '' }, query, invocation);
  }
  const callMatch = /^\/api\/def-tools\/([^/]+)\/call$/.exec(pathname);
  if (method === 'POST' && callMatch) {
    const name = decodeURIComponent(callMatch[1]);
    const rawInput = body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'input') ? body.input : body;
    const input = rawInput && typeof rawInput === 'object' ? { ...rawInput } : {};
    if (typeof body?.sessionId === 'string' && body.sessionId.trim()) input.__defSessionId = body.sessionId.trim();
    return await executeDefTool(name, input, query, invocation);
  }
  if (method === 'POST' && pathname === '/api/def-tools/call') {
    const name = typeof body?.tool === 'string' ? body.tool : typeof body?.name === 'string' ? body.name : '';
    const input = body?.input && typeof body.input === 'object' ? { ...body.input } : {};
    if (typeof body?.sessionId === 'string' && body.sessionId.trim()) input.__defSessionId = body.sessionId.trim();
    return await executeDefTool(name, input, query, invocation);
  }
  return null;
}

async function handleMainWorkbenchRequest(method, pathname, query, body, invocation = {}) {
  // The mirror is canonical-gate input.  Unauthenticated HTTP must neither
  // replay a projection nor inspect it as a side door into another timeline.
  if (!pathname.startsWith('/api/main-workbench')) return null;
  if (!rawTransportAuthorized(invocation)) return denyRawTransport(pathname);
  if (method === 'POST' && pathname === '/api/main-workbench/checkout-projection') {
    const sessionBindingId = typeof body?.sessionBindingId === 'string' ? body.sessionBindingId.trim() : '';
    const sessionID = typeof body?.sessionID === 'string' ? body.sessionID.trim() : '';
    const timelineId = typeof body?.timelineId === 'string' ? body.timelineId.trim() : '';
    const binding = sessionBindingId ? getTimelineRepository().getSessionAxisBinding(sessionBindingId) : null;
    const axisContext = binding ? getTimelineRepository().getSessionAxisContext(binding.id) : null;
    const checkout = axisContext?.checkout || null;
    if (!binding || binding.host !== 'workbench' || binding.opencodeSessionId !== sessionID
      || !timelineId || binding.timelineId !== timelineId
      || !axisContext?.document || axisContext.document.isTemporary || axisContext.document.archivedAt
      || checkout?.timelineId !== binding.timelineId || checkout.targetType !== 'work-node') {
      return failScript(409, 'blocked-session-mismatch', 'The native checkout projection request does not match an active formal Workbench binding.');
    }
    const node = getTimelineRepository().getWorkNode(checkout.targetId);
    if (!node || node.timelineId !== binding.timelineId) {
      return failScript(409, 'blocked-session-mismatch', 'The native checkout projection request targets a Work Node outside its binding.');
    }
    const projection = await waitForWorkbenchProjectionPayload(
      binding.timelineId,
      node.workingPayload,
      body?.waitMs ?? 4500,
      (snapshot) => workbenchProjectionMatchesCheckoutIdentity(snapshot, checkout)
        && isCompleteCanvasWorkbenchProjection(snapshot),
    );
    if (!projection.pass) {
      return failScript(409, 'checkout-projection-unavailable', 'The Canvas has not published a complete projection for the bound checkout.');
    }
    return { status: 200, body: { ok: true, protocolVersion: 1, snapshot: projection.snapshot } };
  }
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
    const snapshot = readMainWorkbenchJson(MAIN_WORKBENCH_SNAPSHOT_KEY, null);
    return {
      status: 200,
      body: {
        ok: true,
        protocolVersion: 1,
        snapshot: snapshot ? { ...snapshot, axisContext: readDefWorkbenchAxisContext() } : null,
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
    // This legacy endpoint used to bypass tool schemas, registry metadata,
    // current-gate admission, and approval continuations. All model-side
    // command creation now goes through /api/def-tools/* and reaches the queue
    // only after canonical policy evaluation.
    return failScript(403, 'denied-direct-command-enqueue', 'Direct Workbench command enqueue is disabled; invoke a canonical DEF tool route.');
    /* c8 ignore start -- retained response parser for one release of wire-format archaeology */
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
    /* c8 ignore stop */
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
      return failScript(404, 'main-workbench-command-not-found', 'A renderer result may update only an existing canonical command.');
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
  // The packaged sidecar only needs Vite's SSR loader. Pulling in the app's
  // development config would make the release depend on Tailwind/React plugins.
  configFile: false,
  root: projectRoot,
  cacheDir: viteCacheDir,
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
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

const defCoreTransportState = createDefCoreTransportState({ writeSse });
const broadcastMainWorkbenchCommands = defCoreTransportState.broadcastCommands;

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
  defCoreTransportState.heartbeat();
}, 15000);

const routeDefCoreRequest = createDefCoreRequestRouter({
  handleAiTimelineWorkNodeRequest,
  handleTimelineRepositoryRequest,
  handleDefToolRequest,
  handleMainWorkbenchRequest,
});

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
    const invocation = { internalToken: typeof request.headers['x-def-internal-token'] === 'string' ? request.headers['x-def-internal-token'] : '' };
    if (!rawTransportAuthorized(invocation)) {
      const denied = denyRawTransport(requestUrl.pathname);
      writeJson(response, denied.status, denied.body);
      return;
    }
    const origin = typeof request.headers.origin === 'string' && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(request.headers.origin)
      ? request.headers.origin
      : '';
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    });
    response.write(': connected\n\n');
    defCoreTransportState.addCommandClient(response);
    writeSse(response, 'main-workbench.commands', {
      ok: true,
      protocolVersion: 1,
      commands: readMainWorkbenchCommandQueue().filter((entry) => entry.status === 'pending'),
    });
    request.on('close', () => {
      defCoreTransportState.removeCommandClient(response);
    });
    return;
  }

  try {
    const body = method === 'POST' ? await readJsonBody(request) : undefined;
    const rawInvocation = { internalToken: typeof request.headers['x-def-internal-token'] === 'string' ? request.headers['x-def-internal-token'] : '' };
    const defCoreResponse = await routeDefCoreRequest({
      method,
      pathname: requestUrl.pathname,
      searchParams: requestUrl.searchParams,
      body,
      rawInvocation,
    });
    if (defCoreResponse) {
      writeJson(response, defCoreResponse.status, defCoreResponse.body);
      return;
    }

    if (legacyFillCompatibilityProxyEnabled && isLegacyFillCompatibilityRoute(method, requestUrl.pathname, body)) {
      const compatibilityResponse = await proxyLegacyFillCompatibilityRequest(method, requestUrl, body);
      writeJson(response, compatibilityResponse.status, compatibilityResponse.body);
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
    writeJson(response, error?.status || 500, {
      ok: false,
      error: {
        code: error?.code || 'internal-error',
        message: error instanceof Error ? error.message : String(error),
        ...(error?.details !== undefined ? { details: error.details } : {}),
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
  defCoreTransportState.close();
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
