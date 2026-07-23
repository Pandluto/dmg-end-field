const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { RevisionController } = require('./revision-controller.cjs');

const BUSINESS_IDS = Object.freeze(['selection', 'loadout', 'timeline', 'buff', 'calculation']);
const BUSINESS_ID_SET = new Set(BUSINESS_IDS);
const TERMINAL_STATES = new Set(['completed', 'awaiting-confirmation', 'unsupported', 'aborted']);
const PHASE_KINDS = new Set([
  'context',
  'evidence',
  'plan',
  'proposal',
  'awaiting-confirmation',
  'mutation',
  'verification',
  'response',
  'unsupported',
]);

function readJson(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    const wrapped = new Error(`Cannot read ${label}: ${error.message}`);
    wrapped.code = 'HARNESS_REVISION_READ_FAILED';
    throw wrapped;
  }
  return parsed;
}

function sha256(parts) {
  const hash = crypto.createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest('hex');
}

function revisionSort(left, right) {
  const parse = (value) => String(value || '').replace(/^v/, '').split('.').map((part) => Number(part) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return String(left).localeCompare(String(right));
}

function assertStringArray(value, label, errors, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim()) || (!allowEmpty && value.length === 0)) {
    errors.push(`${label} must be ${allowEmpty ? 'an' : 'a non-empty'} array of strings`);
    return [];
  }
  return value;
}

function validateDefinition(definition, expectedBusinessId) {
  const errors = [];
  if (definition?.schemaVersion !== 1) errors.push('definition.schemaVersion must be 1');
  if (definition?.businessId !== expectedBusinessId) errors.push(`definition.businessId must be ${expectedBusinessId}`);
  if (!BUSINESS_ID_SET.has(definition?.businessId)) errors.push(`unsupported business id: ${definition?.businessId}`);
  if (typeof definition?.summary !== 'string' || !definition.summary.trim()) errors.push('definition.summary is required');
  const operations = assertStringArray(definition?.operations, 'definition.operations', errors, { allowEmpty: false });
  if (new Set(operations).size !== operations.length) errors.push('definition.operations contains duplicates');
  const toolCeiling = assertStringArray(definition?.toolCeiling, 'definition.toolCeiling', errors);
  if (new Set(toolCeiling).size !== toolCeiling.length) errors.push('definition.toolCeiling contains duplicates');
  const writeScope = assertStringArray(definition?.writeScope, 'definition.writeScope', errors);
  if (new Set(writeScope).size !== writeScope.length) errors.push('definition.writeScope contains duplicates');
  if (!definition?.completion || typeof definition.completion !== 'object') errors.push('definition.completion is required');
  if (!definition?.downstream || typeof definition.downstream !== 'object') errors.push('definition.downstream is required');
  if (errors.length) {
    const error = new Error(`Invalid business definition ${expectedBusinessId}:\n${errors.join('\n')}`);
    error.code = 'HARNESS_DEFINITION_INVALID';
    error.details = errors;
    throw error;
  }
  return definition;
}

function phaseTargets(phase) {
  const transitions = phase?.transitions && typeof phase.transitions === 'object' ? phase.transitions : {};
  return Object.values(transitions).filter((target) => typeof target === 'string' && target);
}

function reachesTerminal(startId, phasesById, memo = new Map(), visiting = new Set()) {
  if (memo.has(startId)) return memo.get(startId);
  if (visiting.has(startId)) return false;
  const phase = phasesById.get(startId);
  if (!phase) return false;
  if (phase.terminalState) return true;
  const nextVisiting = new Set(visiting);
  nextVisiting.add(startId);
  const targets = phaseTargets(phase);
  const result = targets.length > 0 && targets.every((target) => reachesTerminal(target, phasesById, memo, nextVisiting));
  memo.set(startId, result);
  return result;
}

function successPathHasVerification(startId, phasesById, visited = new Set()) {
  if (visited.has(startId)) return false;
  const phase = phasesById.get(startId);
  if (!phase) return false;
  if (phase.kind === 'verification') return true;
  if (phase.terminalState) return false;
  const next = phase.transitions?.onSuccess;
  if (typeof next !== 'string') return false;
  const nextVisited = new Set(visited);
  nextVisited.add(startId);
  return successPathHasVerification(next, phasesById, nextVisited);
}

function validateRevision({ definition, manifest, instructions, toolIds, source }) {
  const errors = [];
  if (manifest?.schemaVersion !== 1) errors.push('manifest.schemaVersion must be 1');
  if (manifest?.businessId !== definition.businessId) errors.push('manifest.businessId does not match definition');
  if (typeof manifest?.version !== 'string' || !manifest.version.trim()) errors.push('manifest.version is required');
  if (typeof instructions !== 'string' || !instructions.trim()) errors.push('instructions.md must not be empty');
  const manifestWriteScope = assertStringArray(manifest?.writeScope, 'manifest.writeScope', errors);
  const allowedWriteScope = new Set(definition.writeScope);
  for (const field of manifestWriteScope) {
    if (!allowedWriteScope.has(field)) errors.push(`Revision expands business write scope: ${field}`);
  }
  const operations = manifest?.operations && typeof manifest.operations === 'object' && !Array.isArray(manifest.operations)
    ? manifest.operations
    : {};
  if (Object.keys(operations).length === 0) errors.push('manifest.operations must not be empty');
  const definitionOperations = new Set(definition.operations);
  const toolCeiling = new Set(definition.toolCeiling);
  const knownToolIds = new Set(toolIds);

  for (const [operationId, operation] of Object.entries(operations)) {
    if (!definitionOperations.has(operationId)) errors.push(`Unknown operation for ${definition.businessId}: ${operationId}`);
    if (!operation || typeof operation !== 'object') {
      errors.push(`Operation ${operationId} must be an object`);
      continue;
    }
    if (typeof operation.entryPhase !== 'string' || !operation.entryPhase) errors.push(`Operation ${operationId} needs entryPhase`);
    if (!Array.isArray(operation.phases) || operation.phases.length === 0) {
      errors.push(`Operation ${operationId} needs phases`);
      continue;
    }
    const phasesById = new Map();
    for (const phase of operation.phases) {
      if (!phase || typeof phase.id !== 'string' || !phase.id) {
        errors.push(`Operation ${operationId} has phase without id`);
        continue;
      }
      if (phasesById.has(phase.id)) errors.push(`Operation ${operationId} has duplicate phase ${phase.id}`);
      phasesById.set(phase.id, phase);
      if (!PHASE_KINDS.has(phase.kind)) errors.push(`Operation ${operationId} phase ${phase.id} has invalid kind`);
      const tools = assertStringArray(phase.tools, `${operationId}.${phase.id}.tools`, errors);
      for (const toolId of tools) {
        if (!knownToolIds.has(toolId)) errors.push(`Unknown canonical Tool: ${toolId}`);
        if (!toolCeiling.has(toolId)) errors.push(`Tool exceeds ${definition.businessId} ceiling: ${toolId}`);
      }
      const writes = assertStringArray(phase.writes || [], `${operationId}.${phase.id}.writes`, errors);
      for (const field of writes) {
        if (!allowedWriteScope.has(field) || !manifestWriteScope.includes(field)) errors.push(`Phase ${phase.id} expands write scope: ${field}`);
      }
      if (phase.terminalState && !TERMINAL_STATES.has(phase.terminalState)) {
        errors.push(`Operation ${operationId} phase ${phase.id} has invalid terminalState`);
      }
      if (!phase.terminalState) {
        if (!phase.transitions || typeof phase.transitions !== 'object') errors.push(`Operation ${operationId} phase ${phase.id} has no transitions`);
        if (typeof phase.transitions?.onSuccess !== 'string') errors.push(`Operation ${operationId} phase ${phase.id} has no success exit`);
        if (typeof phase.transitions?.onFailure !== 'string') errors.push(`Operation ${operationId} phase ${phase.id} has no failure exit`);
      }
    }
    if (!phasesById.has(operation.entryPhase)) errors.push(`Operation ${operationId} entryPhase does not exist`);
    for (const phase of phasesById.values()) {
      for (const target of phaseTargets(phase)) {
        if (!phasesById.has(target)) errors.push(`Operation ${operationId} phase ${phase.id} points to missing phase ${target}`);
      }
      if (phase.kind === 'mutation' && !successPathHasVerification(phase.id, phasesById)) {
        errors.push(`Mutation phase ${operationId}.${phase.id} has no verification success path`);
      }
    }
    if (phasesById.has(operation.entryPhase) && !reachesTerminal(operation.entryPhase, phasesById)) {
      errors.push(`Operation ${operationId} contains a dead end or cycle without a terminal exit`);
    }
    const reachable = new Set();
    const visit = (phaseId) => {
      if (reachable.has(phaseId) || !phasesById.has(phaseId)) return;
      reachable.add(phaseId);
      for (const target of phaseTargets(phasesById.get(phaseId))) visit(target);
    };
    visit(operation.entryPhase);
    for (const phaseId of phasesById.keys()) {
      if (!reachable.has(phaseId)) errors.push(`Operation ${operationId} has unreachable phase ${phaseId}`);
    }
  }
  if (errors.length) {
    const error = new Error(`Invalid Harness Revision ${source}:\n${errors.join('\n')}`);
    error.code = 'HARNESS_REVISION_INVALID';
    error.details = errors;
    throw error;
  }
  return true;
}

class BusinessHarnessRegistry {
  constructor({ businessRoot, statePath, toolIds } = {}) {
    this.businessRoot = path.resolve(businessRoot || path.join(__dirname, '..', '..', 'harness', 'business'));
    this.controller = new RevisionController({
      statePath: statePath || path.join(this.businessRoot, '..', '..', '..', '.runtime', 'def-harness-manager', 'revisions.json'),
    });
    this.toolIds = Array.isArray(toolIds) ? [...toolIds] : null;
    this.definitions = new Map();
    this.revisions = new Map();
    this.definitionHashes = new Map();
    this.watchers = new Map();
  }

  async ensureToolIds() {
    if (!this.toolIds) {
      const registry = await import('../def-tools/registry.mjs');
      this.toolIds = registry.DEF_NATIVE_TARGETS.map((target) => target.id);
    }
    return this.toolIds;
  }

  definitionPath(businessId) {
    return path.join(this.businessRoot, businessId, 'definition.json');
  }

  revisionPath(businessId, version) {
    return path.join(this.businessRoot, businessId, 'revisions', version);
  }

  loadDefinition(businessId, { allowDefinitionChange = false } = {}) {
    if (!BUSINESS_ID_SET.has(businessId)) {
      const error = new Error(`Unsupported Harness business: ${businessId}`);
      error.code = 'HARNESS_BUSINESS_INVALID';
      throw error;
    }
    const filePath = this.definitionPath(businessId);
    const raw = fs.readFileSync(filePath, 'utf8');
    const definition = validateDefinition(JSON.parse(raw), businessId);
    const hash = sha256([raw]);
    const priorHash = this.definitionHashes.get(businessId);
    if (priorHash && priorHash !== hash && !allowDefinitionChange) {
      const error = new Error(`definition.json changed for ${businessId}; code migration and restart are required.`);
      error.code = 'HARNESS_DEFINITION_RESTART_REQUIRED';
      throw error;
    }
    this.definitionHashes.set(businessId, hash);
    this.definitions.set(businessId, definition);
    return definition;
  }

  listVersions(businessId) {
    const revisionsDir = path.join(this.businessRoot, businessId, 'revisions');
    try {
      return fs.readdirSync(revisionsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(revisionSort);
    } catch {
      return [];
    }
  }

  async validate(businessId, version) {
    const toolIds = await this.ensureToolIds();
    const definition = this.definitions.get(businessId) || this.loadDefinition(businessId);
    const directory = this.revisionPath(businessId, version);
    const manifestPath = path.join(directory, 'manifest.json');
    const instructionsPath = path.join(directory, 'instructions.md');
    const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
    const instructions = fs.readFileSync(instructionsPath, 'utf8');
    const manifest = readJson(manifestPath, `${businessId}@${version} manifest`);
    if (manifest.version !== version) {
      const error = new Error(`Revision directory/version mismatch: ${version} != ${manifest.version}`);
      error.code = 'HARNESS_REVISION_INVALID';
      throw error;
    }
    validateRevision({ definition, manifest, instructions, toolIds, source: `${businessId}@${version}` });
    const record = Object.freeze({
      businessId,
      version,
      contentHash: sha256([JSON.stringify(definition), manifestRaw, instructions]),
      manifest,
      instructions,
      directory,
    });
    this.revisions.set(`${businessId}@${version}`, record);
    return record;
  }

  async register(businessId, version) {
    const record = await this.validate(businessId, version);
    this.controller.registerCandidate(businessId, {
      version: record.version,
      contentHash: record.contentHash,
    });
    return record;
  }

  async activate(businessId, version = undefined) {
    const selectedVersion = version || this.controller.businessState(businessId).candidate?.version;
    if (!selectedVersion) {
      const error = new Error(`No candidate Revision for ${businessId}.`);
      error.code = 'HARNESS_REVISION_NO_CANDIDATE';
      throw error;
    }
    const record = await this.validate(businessId, selectedVersion);
    const state = this.controller.activate(businessId, {
      version: record.version,
      contentHash: record.contentHash,
    });
    return { record, state };
  }

  async rollback(businessId) {
    const previous = this.controller.businessState(businessId).previous;
    if (previous) await this.validate(businessId, previous.version);
    const state = this.controller.rollback(businessId);
    return { record: await this.resolveActive(businessId), state };
  }

  revoke(businessId, version) {
    return this.controller.revoke(businessId, version);
  }

  isRevoked(businessId, version) {
    return this.controller.isRevoked(businessId, version);
  }

  async resolveActive(businessId) {
    let state = this.controller.businessState(businessId);
    if (!state.active) {
      const definition = this.definitions.get(businessId) || this.loadDefinition(businessId);
      if (typeof definition.defaultRevision === 'string' && definition.defaultRevision) {
        const record = await this.validate(businessId, definition.defaultRevision);
        this.controller.registerCandidate(businessId, {
          version: record.version,
          contentHash: record.contentHash,
        });
        state = this.controller.activate(businessId, {
          version: record.version,
          contentHash: record.contentHash,
        });
      }
    }
    if (!state.active) return null;
    if (state.revoked.includes(state.active.version)) return null;
    const cached = this.revisions.get(`${businessId}@${state.active.version}`);
    if (cached?.contentHash === state.active.contentHash) return cached;
    const loaded = await this.validate(businessId, state.active.version);
    if (loaded.contentHash !== state.active.contentHash) {
      const error = new Error(`Active Revision content changed without activation: ${businessId}@${state.active.version}`);
      error.code = 'HARNESS_REVISION_HASH_MISMATCH';
      throw error;
    }
    return loaded;
  }

  async resolveRevision(businessId, revisionRef) {
    if (!revisionRef?.version || !revisionRef?.contentHash) {
      const error = new Error(`Pinned Revision is incomplete for ${businessId}.`);
      error.code = 'HARNESS_REVISION_INVALID';
      throw error;
    }
    if (this.controller.isRevoked(businessId, revisionRef.version)) {
      const error = new Error(`Revision is revoked: ${businessId}@${revisionRef.version}`);
      error.code = 'HARNESS_REVISION_REVOKED';
      throw error;
    }
    const cached = this.revisions.get(`${businessId}@${revisionRef.version}`);
    const record = cached?.contentHash === revisionRef.contentHash
      ? cached
      : await this.validate(businessId, revisionRef.version);
    if (record.contentHash !== revisionRef.contentHash) {
      const error = new Error(`Pinned Revision hash mismatch: ${businessId}@${revisionRef.version}`);
      error.code = 'HARNESS_REVISION_HASH_MISMATCH';
      throw error;
    }
    return record;
  }

  async inspect(businessId) {
    const definition = this.definitions.get(businessId) || this.loadDefinition(businessId);
    return {
      businessId,
      definition,
      versions: this.listVersions(businessId),
      revisionState: this.controller.businessState(businessId),
    };
  }

  async reloadBusiness(businessId, version = undefined) {
    const before = this.controller.businessState(businessId);
    try {
      this.loadDefinition(businessId);
      const versions = this.listVersions(businessId);
      const selectedVersion = version || versions.at(-1);
      if (!selectedVersion) throw Object.assign(new Error(`No Revision source for ${businessId}.`), { code: 'HARNESS_REVISION_NOT_FOUND' });
      const record = await this.validate(businessId, selectedVersion);
      this.controller.registerCandidate(businessId, {
        version: record.version,
        contentHash: record.contentHash,
      });
      const state = this.controller.activate(businessId, {
        version: record.version,
        contentHash: record.contentHash,
      });
      return { ok: true, businessId, record, state };
    } catch (error) {
      return {
        ok: false,
        businessId,
        error: { code: error.code || 'HARNESS_REVISION_RELOAD_FAILED', message: error.message },
        state: before,
      };
    }
  }

  watchBusinessRevisions(businessId, { debounceMs = 100, onReload } = {}) {
    if (this.watchers.has(businessId)) return this.watchers.get(businessId).close;
    const revisionRoot = path.join(this.businessRoot, businessId, 'revisions');
    let timer = null;
    const watcher = fs.watch(revisionRoot, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const result = await this.reloadBusiness(businessId);
        if (typeof onReload === 'function') onReload(result);
      }, debounceMs);
    });
    const close = () => {
      clearTimeout(timer);
      watcher.close();
      this.watchers.delete(businessId);
    };
    this.watchers.set(businessId, { watcher, close });
    return close;
  }

  close() {
    for (const entry of this.watchers.values()) entry.close();
  }
}

module.exports = {
  BUSINESS_IDS,
  BusinessHarnessRegistry,
  validateDefinition,
  validateRevision,
};
