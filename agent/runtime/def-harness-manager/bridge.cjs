const fs = require('fs');
const path = require('path');
const { atomicWriteJson } = require('./revision-controller.cjs');

const BRIDGE_SCHEMA_VERSION = 1;

function bridgePath(sessionDirectory) {
  if (!sessionDirectory) throw new Error('Harness runtime bridge requires a Session directory.');
  return path.join(path.resolve(sessionDirectory), '.def-harness-manager', 'runtime-bridge.json');
}

function readRuntimeBridge(sessionDirectory) {
  try {
    const parsed = JSON.parse(fs.readFileSync(bridgePath(sessionDirectory), 'utf8'));
    if (parsed?.schemaVersion !== BRIDGE_SCHEMA_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeRuntimeBridge(sessionDirectory, value) {
  const next = {
    ...value,
    schemaVersion: BRIDGE_SCHEMA_VERSION,
    projectionRevision: Number(value?.projectionRevision || 0) + 1,
    updatedAt: Date.now(),
  };
  atomicWriteJson(bridgePath(sessionDirectory), next);
  return next;
}

function updateRuntimeBridge(sessionDirectory, updater) {
  const current = readRuntimeBridge(sessionDirectory);
  if (!current) {
    const error = new Error('Harness runtime bridge is not prepared for this Session.');
    error.code = 'HARNESS_RUNTIME_NOT_PREPARED';
    throw error;
  }
  return writeRuntimeBridge(sessionDirectory, updater(structuredClone(current)));
}

function bindRuntimeTurn(sessionDirectory, sessionId, turnId) {
  return updateRuntimeBridge(sessionDirectory, (current) => {
    if (current.sessionId !== sessionId) {
      const error = new Error('Harness runtime bridge Session mismatch.');
      error.code = 'HARNESS_RUNTIME_SESSION_MISMATCH';
      throw error;
    }
    return { ...current, turnId };
  });
}

function assertProjectedTool({
  sessionDirectory,
  sessionId,
  turnId,
  toolBinding,
  canonicalToolId,
}) {
  const current = readRuntimeBridge(sessionDirectory);
  if (!current || current.mode === 'legacy-compatibility') return current;
  if (current.sessionId !== sessionId) {
    const error = new Error('Harness Tool gate rejected a Session mismatch.');
    error.code = 'HARNESS_TOOL_SESSION_MISMATCH';
    throw error;
  }
  if (current.turnId && turnId && current.turnId !== turnId) {
    const error = new Error('Harness Tool gate rejected a stale turn.');
    error.code = 'HARNESS_TOOL_TURN_MISMATCH';
    throw error;
  }
  const bindingAllowed = Array.isArray(current.allowedToolBindings) && current.allowedToolBindings.includes(toolBinding);
  const canonicalAllowed = canonicalToolId
    && Array.isArray(current.allowedToolIds)
    && current.allowedToolIds.includes(canonicalToolId);
  if (!bindingAllowed && !canonicalAllowed) {
    const error = new Error(`Harness phase ${current.phase || current.mode} does not allow Tool ${toolBinding}.`);
    error.code = 'HARNESS_TOOL_PHASE_DENIED';
    error.details = {
      attempted: false,
      transactionId: current.transactionId || null,
      businessId: current.businessId || null,
      operation: current.operation || null,
      phase: current.phase || current.mode,
      tool: toolBinding,
    };
    throw error;
  }
  return current;
}

module.exports = {
  assertProjectedTool,
  bindRuntimeTurn,
  bridgePath,
  readRuntimeBridge,
  updateRuntimeBridge,
  writeRuntimeBridge,
};
