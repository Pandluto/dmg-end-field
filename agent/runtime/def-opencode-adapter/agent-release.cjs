const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const AGENT_RELEASE_KIND = 'AgentReleaseV1';
const AGENT_RELEASE_SCHEMA_VERSION = 1;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function collectComponentEntries(projectRoot, relativePaths) {
  const root = path.resolve(projectRoot);
  const entries = [];
  const visit = (relativePath) => {
    const normalized = relativePath.replace(/\\/g, '/');
    const absolute = path.resolve(root, relativePath);
    const relation = path.relative(root, absolute);
    if (!relation || relation.startsWith('..') || path.isAbsolute(relation)) {
      throw new Error(`Agent release component escapes project root: ${relativePath}`);
    }
    if (!fs.existsSync(absolute)) {
      entries.push(`${normalized}\0missing`);
      return;
    }
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      entries.push(`${normalized}\0symlink:${fs.readlinkSync(absolute)}`);
      return;
    }
    if (stat.isDirectory()) {
      const children = fs.readdirSync(absolute, { withFileTypes: true })
        .map((entry) => `${normalized}/${entry.name}`)
        .sort();
      if (!children.length) entries.push(`${normalized}/\0empty-directory`);
      for (const child of children) visit(child);
      return;
    }
    if (stat.isFile()) {
      entries.push(`${normalized}\0${sha256(fs.readFileSync(absolute))}`);
    }
  };
  for (const relativePath of [...new Set(relativePaths)].sort()) visit(relativePath);
  return entries.sort();
}

function hashComponents(projectRoot, relativePaths) {
  return sha256(collectComponentEntries(projectRoot, relativePaths).join('\n'));
}

function readPackageVersion(projectRoot) {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version || 'unknown');
  } catch {
    return 'unknown';
  }
}

function readRuntimeCommit(projectRoot) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  const commit = result.status === 0 ? String(result.stdout || '').trim() : '';
  return commit || `package-${readPackageVersion(projectRoot)}`;
}

function createAgentRelease({
  projectRoot,
  skillId,
  modelId,
  requestedThinkingEffort,
  basePrompt,
  harnessBinding,
  observedAt = Date.now(),
} = {}) {
  if (!projectRoot || !harnessBinding?.harness?.contentHash) {
    throw new Error('AgentReleaseV1 requires a project root and immutable Harness binding.');
  }
  const root = path.resolve(projectRoot);
  const components = {
    basePromptHash: sha256(String(basePrompt || '')),
    dynamicPromptHash: hashComponents(root, [
      'agent/server/workbench-system-prompts.cjs',
      'agent/server/def-agent-server.cjs',
    ]),
    skillTreeHash: hashComponents(root, ['agent/runtime/def/skills']),
    toolCatalogHash: hashComponents(root, [
      'agent/runtime/def-tools/definitions.mjs',
      'agent/runtime/def-tools/registry.mjs',
    ]),
    toolImplementationHash: hashComponents(root, [
      'agent/runtime/def-tools/opencode',
      'agent/runtime/def-node-workspace/codec.mjs',
      'agent/runtime/def-opencode-adapter/harness-turn-router.cjs',
    ]),
    permissionPolicyHash: hashComponents(root, ['agent/runtime/def-opencode-adapter/index.cjs']),
    knowledgeRevision: hashComponents(root, [
      'src/data/gameKnowledge.json',
      'agent/runtime/def/skills/game-knowledge/references',
      'agent/runtime/def/skills/game-knowledge/conventions',
      'agent/runtime/def/skills/game-knowledge/loadout-plans',
    ]),
    stateContractHash: hashComponents(root, [
      'scripts/ai-cli-rest-server.mjs',
      'scripts/def-core',
    ]),
    hostContractHash: hashComponents(root, [
      'src/components/CanvasBoard/index.tsx',
      'src/components/def-opencode/DefOpenCodeView.tsx',
      'src/utils/mainWorkbenchControl.ts',
    ]),
    openCodeRuntimeHash: hashComponents(root, [
      'agent/runtime/opencode-core/manifest.json',
      'agent/runtime/opencode-core/checksums.json',
    ]),
  };
  const identity = {
    kind: AGENT_RELEASE_KIND,
    schemaVersion: AGENT_RELEASE_SCHEMA_VERSION,
    runtimeCommit: readRuntimeCommit(root),
    packageVersion: readPackageVersion(root),
    skillId: String(skillId || 'operator'),
    model: {
      provider: 'deepseek',
      modelId: String(modelId || ''),
      requestedThinkingEffort: String(requestedThinkingEffort || 'medium'),
      configuredThinkingEffort: 'high',
    },
    harness: {
      selector: harnessBinding.selector,
      ref: harnessBinding.harness,
      slotHashes: harnessBinding.slotHashes,
    },
    components,
    stateSchemas: {
      session: 5,
      harness: 1,
      interop: 1,
    },
    pinning: {
      sessionGuarantee: 'harness-only',
      harness: 'immutable',
      runtime: 'observed-not-pinned',
    },
  };
  return Object.freeze({
    ...identity,
    releaseHash: sha256(stableJson(identity)),
    observedAt,
  });
}

module.exports = {
  AGENT_RELEASE_KIND,
  AGENT_RELEASE_SCHEMA_VERSION,
  collectComponentEntries,
  createAgentRelease,
  hashComponents,
  sha256,
  stableJson,
};
