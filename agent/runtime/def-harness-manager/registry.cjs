const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { RevisionController, atomicWriteJson } = require('./revision-controller.cjs');

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
const CONTEXT_SOURCE_FORMATS = new Set(['json-compact', 'json-verbatim']);
const MAX_CONTEXT_SOURCES_PER_PHASE = 4;
const MAX_CONTEXT_SOURCE_BYTES = 128 * 1024;
const LEGACY_SOURCE_DEFAULT_VERSION = 'v1';

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

function hardDefinition(definition) {
  const source = definition && typeof definition === 'object' && !Array.isArray(definition)
    ? definition
    : {};
  const { defaultRevision: _defaultRevision, ...hardBoundary } = source;
  return hardBoundary;
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
  if (typeof definition?.defaultRevision !== 'string' || !definition.defaultRevision.trim()) {
    errors.push('definition.defaultRevision is required');
  }
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
  return [
    ...Object.values(transitions),
    ...(Array.isArray(phase?.resultTransitions) ? phase.resultTransitions.map((transition) => transition?.target) : []),
  ].filter((target) => typeof target === 'string' && target);
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
      if (phase.contextSources !== undefined) {
        if (!Array.isArray(phase.contextSources)
          || phase.contextSources.length === 0
          || phase.contextSources.length > MAX_CONTEXT_SOURCES_PER_PHASE) {
          errors.push(`Operation ${operationId} phase ${phase.id} contextSources must contain 1-${MAX_CONTEXT_SOURCES_PER_PHASE} entries`);
        } else {
          for (const [sourceIndex, contextSource] of phase.contextSources.entries()) {
            const label = `${operationId}.${phase.id}.contextSources[${sourceIndex}]`;
            const sourcePath = contextSource?.path;
            const normalized = typeof sourcePath === 'string' ? path.posix.normalize(sourcePath) : '';
            if (!contextSource || typeof contextSource !== 'object' || Array.isArray(contextSource)) {
              errors.push(`${label} must be an object`);
              continue;
            }
            if (typeof sourcePath !== 'string'
              || !sourcePath
              || sourcePath.includes('\\')
              || path.posix.isAbsolute(sourcePath)
              || normalized !== sourcePath
              || !normalized.startsWith('node/working/')
              || normalized === 'node/working/') {
              errors.push(`${label}.path must be a normalized file below node/working`);
            }
            if (!CONTEXT_SOURCE_FORMATS.has(contextSource.format)) {
              errors.push(`${label}.format must be json-compact or json-verbatim`);
            }
            if (!Number.isInteger(contextSource.maxBytes)
              || contextSource.maxBytes <= 0
              || contextSource.maxBytes > MAX_CONTEXT_SOURCE_BYTES) {
              errors.push(`${label}.maxBytes must be an integer from 1 to ${MAX_CONTEXT_SOURCE_BYTES}`);
            }
          }
        }
        if (phase.terminalState) {
          errors.push(`Operation ${operationId} phase ${phase.id} cannot bind contextSources after termination`);
        }
      }
      if (phase.exactReply !== undefined) {
        if (!phase.terminalState
          || typeof phase.exactReply !== 'string'
          || !phase.exactReply.trim()
          || phase.exactReply.length > 200
          || /[<>]/.test(phase.exactReply)) {
          errors.push(`Operation ${operationId} phase ${phase.id} exactReply must be a 1-200 character markup-free terminal reply`);
        }
      }
      if (phase.terminalState && !TERMINAL_STATES.has(phase.terminalState)) {
        errors.push(`Operation ${operationId} phase ${phase.id} has invalid terminalState`);
      }
      if (!phase.terminalState) {
        if (!phase.transitions || typeof phase.transitions !== 'object') errors.push(`Operation ${operationId} phase ${phase.id} has no transitions`);
        if (typeof phase.transitions?.onSuccess !== 'string') errors.push(`Operation ${operationId} phase ${phase.id} has no success exit`);
        if (typeof phase.transitions?.onFailure !== 'string') errors.push(`Operation ${operationId} phase ${phase.id} has no failure exit`);
      }
      if (phase.resultTransitions !== undefined) {
        if (!Array.isArray(phase.resultTransitions)) {
          errors.push(`Operation ${operationId} phase ${phase.id} resultTransitions must be an array`);
        } else {
          for (const [transitionIndex, transition] of phase.resultTransitions.entries()) {
            if (!transition || typeof transition.path !== 'string' || !transition.path
              || !Object.hasOwn(transition, 'equals')
              || typeof transition.target !== 'string' || !transition.target) {
              errors.push(`Operation ${operationId} phase ${phase.id} resultTransitions[${transitionIndex}] is invalid`);
            }
          }
        }
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
      statePath: statePath
        || process.env.DEF_HARNESS_STATE_PATH
        || path.join(this.businessRoot, '..', '..', '..', '.runtime', 'def-harness-manager', 'revisions.json'),
    });
    this.revisionCacheRoot = path.join(path.dirname(this.controller.statePath), 'revision-cache');
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

  revisionCachePath(businessId, contentHash) {
    return path.join(this.revisionCacheRoot, businessId, `${contentHash}.json`);
  }

  persistRevisionCache(record, definition) {
    const target = this.revisionCachePath(record.businessId, record.contentHash);
    if (fs.existsSync(target)) {
      const cached = readJson(target, `${record.businessId}@${record.version} immutable cache`);
      if (cached?.contentHash !== record.contentHash
        || cached?.businessId !== record.businessId
        || cached?.version !== record.version) {
        const error = new Error(`Immutable Revision cache collision: ${record.businessId}@${record.contentHash}`);
        error.code = 'HARNESS_REVISION_CACHE_COLLISION';
        throw error;
      }
      return;
    }
    atomicWriteJson(target, {
      schemaVersion: 1,
      businessId: record.businessId,
      version: record.version,
      contentHash: record.contentHash,
      definition: hardDefinition(definition),
      manifest: record.manifest,
      instructions: record.instructions,
    });
  }

  async loadRevisionCache(businessId, revisionRef) {
    const target = this.revisionCachePath(businessId, revisionRef.contentHash);
    if (!fs.existsSync(target)) return null;
    const cached = readJson(target, `${businessId}@${revisionRef.contentHash} immutable cache`);
    if (cached?.schemaVersion !== 1
      || cached.businessId !== businessId
      || cached.version !== revisionRef.version
      || cached.contentHash !== revisionRef.contentHash) {
      const error = new Error(`Immutable Revision cache is invalid: ${businessId}@${revisionRef.contentHash}`);
      error.code = 'HARNESS_REVISION_CACHE_INVALID';
      throw error;
    }
    // A transaction pins both the Revision content and the hard business
    // boundary that validated it. A later code migration may add an operation
    // to the current definition; that must affect new transactions without
    // making an already-pinned transaction unreadable.
    const pinnedDefinition = validateDefinition({
      ...cached.definition,
      defaultRevision: cached.version,
    }, businessId);
    const toolIds = await this.ensureToolIds();
    validateRevision({
      definition: pinnedDefinition,
      manifest: cached.manifest,
      instructions: cached.instructions,
      toolIds,
      source: `${businessId}@${revisionRef.version} immutable cache`,
    });
    const record = Object.freeze({
      businessId,
      version: cached.version,
      contentHash: cached.contentHash,
      manifest: cached.manifest,
      instructions: cached.instructions,
      directory: path.dirname(target),
      immutableCachePath: target,
    });
    this.revisions.set(`${businessId}@${record.version}:${record.contentHash}`, record);
    return record;
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
      contentHash: sha256([JSON.stringify(hardDefinition(definition)), manifestRaw, instructions]),
      manifest,
      instructions,
      directory,
    });
    this.persistRevisionCache(record, definition);
    this.revisions.set(`${businessId}@${version}:${record.contentHash}`, record);
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
    if (previous) await this.resolveRevision(businessId, previous);
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
    this.controller.reload();
    let state = this.controller.businessState(businessId);
    const definition = this.definitions.get(businessId) || this.loadDefinition(businessId);
    const desiredDefaultVersion = definition.defaultRevision;
    const observedDefaultVersion = state.sourceDefaultVersion || LEGACY_SOURCE_DEFAULT_VERSION;
    const defaultChanged = observedDefaultVersion !== desiredDefaultVersion;

    if (!state.active || defaultChanged) {
      let record;
      try {
        record = await this.validate(businessId, desiredDefaultVersion);
      } catch (error) {
        if (!state.active || state.revoked.includes(state.active.version)) throw error;
        return this.resolveRevision(businessId, state.active);
      }
      if (state.revoked.includes(record.version)) {
        state = this.controller.markSourceDefaultVersion(
          businessId,
          desiredDefaultVersion,
          { expectedSourceDefaultVersion: observedDefaultVersion },
        );
      } else {
        state = this.controller.activate(
          businessId,
          {
            version: record.version,
            contentHash: record.contentHash,
          },
          {
            sourceDefaultVersion: desiredDefaultVersion,
            expectedSourceDefaultVersion: observedDefaultVersion,
          },
        );
      }
    } else if (!state.sourceDefaultVersion) {
      state = this.controller.markSourceDefaultVersion(
        businessId,
        desiredDefaultVersion,
        { expectedSourceDefaultVersion: observedDefaultVersion },
      );
    }
    if (!state.active) return null;
    if (state.revoked.includes(state.active.version)) return null;
    return this.resolveRevision(businessId, state.active);
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
    const cacheKey = `${businessId}@${revisionRef.version}:${revisionRef.contentHash}`;
    const cached = this.revisions.get(cacheKey);
    if (cached) return cached;
    const immutable = await this.loadRevisionCache(businessId, revisionRef);
    if (immutable) return immutable;
    const record = await this.validate(businessId, revisionRef.version);
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
