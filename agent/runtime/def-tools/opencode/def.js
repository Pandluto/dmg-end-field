import fs from 'node:fs'
import path from 'node:path'
import { decodeDefNodePayload, hashDefNodeValue } from '../../def-node-workspace/codec.mjs'

const restBase = process.env.DEF_REST_BASE_URL || 'http://127.0.0.1:17321'
const bindingFile = '.def-node.json'
const workingFile = 'working-payload.json'
const baseFile = 'base-payload.json'
const workbenchContextFile = '.def-workbench-context.json'
const nodeRoot = 'node'
const nodeManifest = 'node/manifest.json'
const nodeSelection = 'node/working/selection.json'
const nodeTimeline = 'node/working/timeline.json'
const nodeBuffs = 'node/working/buffs.json'
const nodeInputs = 'node/working/inputs.json'

async function callDefTool(tool, input = {}) {
  const response = await fetch(`${restBase}/api/def-tools/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool, input }),
  })
  const payload = await response.json()
  if (!response.ok || payload?.ok !== true || payload?.result?.ok === false) {
    const error = new Error(payload?.result?.message || payload?.message || `${tool} failed with HTTP ${response.status}`)
    error.code = payload?.result?.code || payload?.code || 'def-tool-failed'
    throw error
  }
  return payload.result
}

async function askWithApproval(context, input) {
  const requested = await callDefTool('def.approval.request', {
    summary: input.summary,
    riskLevel: input.riskLevel || 'high',
    mode: 'blocking',
    workNodeId: input.nodeId,
    sessionId: context.sessionID,
    nodeRevision: input.revision,
    diffHash: input.diffHash,
    riskHash: input.riskHash,
    workingHash: input.workingHash,
    toolCallId: context.messageID,
    diffSummary: input.diff,
    riskFlags: input.riskFlags || [],
  })
  try {
    await context.ask({
      permission: input.permission,
      patterns: [input.nodeId],
      always: [],
      metadata: {
        action: input.action,
        nodeId: input.nodeId,
        revision: input.revision,
        diff: input.diff,
        riskFlags: input.riskFlags || [],
        consequence: input.consequence,
        approvalId: requested.approval.id,
      },
    })
  } catch (error) {
    await callDefTool('def.approval.record_decision', {
      approvalId: requested.approval.id,
      decision: 'rejected',
      decidedBy: 'user',
      rationale: `${input.action} rejected through OpenCode native permission UI.`,
    })
    throw error
  }
  await callDefTool('def.approval.record_decision', {
    approvalId: requested.approval.id,
    decision: 'approved',
    decidedBy: 'user',
    rationale: `${input.action} approved through OpenCode native permission UI.`,
  })
  return requested.approval
}

function inside(directory, name) {
  const root = path.resolve(directory)
  const target = path.resolve(root, name)
  const relative = path.relative(root, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing node workspace path outside ${root}: ${name}`)
  }
  return target
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function materialize(context, node, options = {}) {
  if (!node?.id || !node?.workingPayload || !node?.basePayload) throw new Error('Work node payload is incomplete')
  fs.mkdirSync(context.directory, { recursive: true })
  const source = decodeDefNodePayload(node.workingPayload)
  const baseSource = decodeDefNodePayload(node.basePayload)
  const manifest = {
    schemaVersion: 1,
    nodeId: node.id,
    parentNodeId: node.parentNodeId || null,
    saveId: node.saveId,
    branchId: node.branchId,
    sessionId: context.sessionID,
    revision: node.contentRevision || node.updatedAt,
    baseHash: hashDefNodeValue(node.basePayload),
    workingHash: hashDefNodeValue(node.workingPayload),
    sourceHash: hashDefNodeValue(source),
    checkoutAnchorNodeId: options.checkoutAnchorNodeId || null,
    materializedAt: Date.now(),
  }
  writeJson(inside(context.directory, bindingFile), {
    ...manifest,
    schemaVersion: 2,
  })
  writeJson(inside(context.directory, nodeManifest), manifest)
  writeJson(inside(context.directory, 'node/base/snapshot.json'), node.basePayload)
  writeJson(inside(context.directory, 'node/base/selection.json'), baseSource.selection)
  writeJson(inside(context.directory, 'node/base/timeline.json'), baseSource.timeline)
  writeJson(inside(context.directory, 'node/base/buffs.json'), baseSource.buffs)
  writeJson(inside(context.directory, 'node/base/inputs.json'), baseSource.inputs)
  writeJson(inside(context.directory, nodeSelection), source.selection)
  writeJson(inside(context.directory, nodeTimeline), source.timeline)
  writeJson(inside(context.directory, nodeBuffs), source.buffs)
  writeJson(inside(context.directory, nodeInputs), source.inputs)
  writeJson(inside(context.directory, 'node/context/derived.json'), {
    anomalyStateSnapshots: node.workingPayload.anomalyStateSnapshots || [],
    characterComputedMap: node.workingPayload.characterComputedMap || {},
    characterDisplayCacheMap: node.workingPayload.characterDisplayCacheMap || {},
  })
  writeJson(inside(context.directory, 'node/generated/payload.json'), node.workingPayload)
  writeJson(inside(context.directory, baseFile), node.basePayload)
  writeJson(inside(context.directory, workingFile), node.workingPayload)
  fs.writeFileSync(inside(context.directory, 'README.md'), [
    '# DEF child node workspace',
    '',
    `Node: ${node.id}`,
    '',
    `Edit only ${nodeRoot}/working/*.json with OpenCode read/edit/apply_patch.`,
    'The normalized timeline keeps every button once; generated storage mirrors are rebuilt by the codec.',
    `${nodeRoot}/base, ${nodeRoot}/context, ${nodeRoot}/generated and ${nodeManifest} are read-only evidence.`,
    'Run def_node_sync_validate to rebuild, validate and review before requesting approval or using the node.',
    '',
  ].join('\n'), 'utf8')
  return {
    nodeId: node.id,
    directory: context.directory,
    revision: manifest.revision,
    editableFiles: [nodeSelection, nodeTimeline, nodeBuffs, nodeInputs],
    readOnlyFiles: [nodeManifest, 'node/base/snapshot.json', 'node/context/derived.json', 'node/generated/payload.json'],
  }
}

function readBinding(context) {
  const target = inside(context.directory, bindingFile)
  if (!fs.existsSync(target)) throw new Error('No child node is bound to this OpenCode session. Call def_node_fork or def_node_bind first.')
  return JSON.parse(fs.readFileSync(target, 'utf8'))
}

function writeBinding(context, binding) {
  writeJson(inside(context.directory, bindingFile), binding)
  writeJson(inside(context.directory, nodeManifest), { ...binding, schemaVersion: 1 })
  return binding
}

function activeCheckoutNodeId(snapshot) {
  const checkout = snapshot?.axisContext?.checkout
  return checkout?.targetType === 'work-node' && typeof checkout.targetId === 'string' && checkout.targetId
    ? checkout.targetId
    : null
}

function writeSessionCheckoutObservation(context, checkout) {
  const target = inside(context.directory, '.def-session.json')
  if (!fs.existsSync(target)) return { changed: false, previous: null }
  const session = JSON.parse(fs.readFileSync(target, 'utf8'))
  const previous = session.workbenchCheckout || null
  const next = checkout
    ? { targetType: checkout.targetType, targetId: checkout.targetId, updatedAt: checkout.updatedAt || null }
    : null
  const changed = Boolean(previous) && (previous?.targetType !== next?.targetType || previous?.targetId !== next?.targetId)
  const existing = session.workbenchCheckoutState && typeof session.workbenchCheckoutState === 'object'
    ? session.workbenchCheckoutState
    : {}
  session.workbenchCheckout = next
  session.workbenchCheckoutState = {
    phase: changed ? 'checkout-changed' : (existing.phase === 'checkout-changed' ? 'checkout-changed' : 'ready'),
    current: next,
    previous: changed ? previous : (existing.previous || null),
    observedAt: Date.now(),
  }
  fs.writeFileSync(target, `${JSON.stringify(session, null, 2)}\n`, 'utf8')
  return { changed, previous, phase: session.workbenchCheckoutState.phase }
}

function readSessionCheckoutState(context) {
  const target = inside(context.directory, '.def-session.json')
  if (!fs.existsSync(target)) return null
  return JSON.parse(fs.readFileSync(target, 'utf8'))?.workbenchCheckoutState || null
}

function markWorkbenchCheckoutReady(context, checkoutNodeId) {
  const target = inside(context.directory, '.def-session.json')
  if (!fs.existsSync(target)) return
  const session = JSON.parse(fs.readFileSync(target, 'utf8'))
  const current = session.workbenchCheckout || null
  if (!checkoutNodeId || current?.targetType !== 'work-node' || current.targetId !== checkoutNodeId) return
  session.workbenchCheckoutState = {
    phase: 'ready',
    current,
    previous: null,
    acknowledgedAt: Date.now(),
  }
  fs.writeFileSync(target, `${JSON.stringify(session, null, 2)}\n`, 'utf8')
}

function requireWorkbenchCheckoutReady(context) {
  const state = readSessionCheckoutState(context)
  if (state?.phase !== 'checkout-changed') return
  const error = new Error(`Workbench checkout changed to ${state.current?.targetId || 'an unknown node'}. Call def_node_bind with nodeId="" before any other node operation.`)
  error.code = 'def-workbench-checkout-rebind-required'
  throw error
}

async function readWorkbenchState(context) {
  const target = inside(context.directory, workbenchContextFile)
  if (!fs.existsSync(target)) throw new Error('No live Workbench context is attached to this session.')
  const attached = JSON.parse(fs.readFileSync(target, 'utf8'))
  const snapshot = await callDefTool('def.workbench.snapshot', { sessionBindingId: attached.axisBindingId })
  const checkout = snapshot?.axisContext?.checkout || null
  const observation = writeSessionCheckoutObservation(context, checkout)
  return {
    attached,
    snapshot,
    checkout,
    checkoutNodeId: activeCheckoutNodeId(snapshot),
    checkoutChanged: observation.changed,
    previousCheckout: observation.previous,
    checkoutPhase: observation.phase,
  }
}

async function readOptionalWorkbenchState(context) {
  if (!fs.existsSync(inside(context.directory, workbenchContextFile))) return null
  return readWorkbenchState(context)
}

function workspaceIsDirty(context, binding) {
  try {
    return Boolean(binding?.sourceHash) && hashDefNodeValue(readWorkspaceSource(context)) !== binding.sourceHash
  } catch {
    return false
  }
}

async function readBindingForCurrentCheckout(context) {
  let binding = readBinding(context)
  const workbench = await readOptionalWorkbenchState(context)
  if (!workbench) return { binding, workbench: null }
  requireWorkbenchCheckoutReady(context)
  if (!binding.checkoutAnchorNodeId && workbench.checkoutNodeId) {
    if (binding.nodeId !== workbench.checkoutNodeId) {
      const error = new Error(`The active Workbench checkout is ${workbench.checkoutNodeId}, but this legacy workspace is materialized for ${binding.nodeId}. Call def_node_bind with nodeId="" before continuing; unsynchronized edits were preserved.`)
      error.code = 'def-workbench-checkout-changed'
      throw error
    }
    binding = writeBinding(context, { ...binding, checkoutAnchorNodeId: workbench.checkoutNodeId })
  }
  if (workbench.checkoutNodeId && binding.checkoutAnchorNodeId && binding.checkoutAnchorNodeId !== workbench.checkoutNodeId) {
    const error = new Error(`The Workbench checkout changed from ${binding.checkoutAnchorNodeId} to ${workbench.checkoutNodeId}. Call def_node_bind with nodeId="" before continuing; unsynchronized edits were preserved.`)
    error.code = 'def-workbench-checkout-changed'
    throw error
  }
  return { binding, workbench }
}

function readForkMetadata(args) {
  const name = typeof args?.name === 'string' ? args.name.trim() : ''
  const description = typeof args?.description === 'string' ? args.description.trim() : ''
  if (name.length < 2 || name.length > 48) {
    throw new Error('def_node_fork requires a 2-48 character short name that summarizes this change.')
  }
  if (description.length < 8 || description.length > 240) {
    throw new Error('def_node_fork requires an 8-240 character description of this change and its scope.')
  }
  return { name, description }
}

async function syncWorkspace(context) {
  const { binding } = await readBindingForCurrentCheckout(context)
  const workspaceSource = {
    schemaVersion: 1,
    selection: JSON.parse(fs.readFileSync(inside(context.directory, nodeSelection), 'utf8')),
    timeline: JSON.parse(fs.readFileSync(inside(context.directory, nodeTimeline), 'utf8')),
    buffs: JSON.parse(fs.readFileSync(inside(context.directory, nodeBuffs), 'utf8')),
    inputs: JSON.parse(fs.readFileSync(inside(context.directory, nodeInputs), 'utf8')),
  }
  const result = await callDefTool('def.worknode.sync_workspace', {
    nodeId: binding.nodeId,
    sessionId: context.sessionID,
    expectedRevision: binding.revision,
    expectedBaseHash: binding.baseHash,
    expectedWorkingHash: binding.workingHash,
    workspaceSource,
  })
  const nextBinding = { ...binding, revision: result.revision, workingHash: result.workingHash, synchronizedAt: Date.now() }
  nextBinding.sourceHash = hashDefNodeValue(workspaceSource)
  writeBinding(context, nextBinding)
  if (result.generatedPayload) {
    writeJson(inside(context.directory, workingFile), result.generatedPayload)
    writeJson(inside(context.directory, 'node/generated/payload.json'), result.generatedPayload)
  }
  writeJson(inside(context.directory, 'node/generated/validation.json'), result.validation)
  writeJson(inside(context.directory, 'node/generated/diff.json'), result.diff)
  writeJson(inside(context.directory, 'node/generated/risk.json'), { riskFlags: result.riskFlags, checkoutDecision: result.checkoutDecision })
  return result
}

function readWorkspaceSource(context) {
  return {
    schemaVersion: 1,
    selection: JSON.parse(fs.readFileSync(inside(context.directory, nodeSelection), 'utf8')),
    timeline: JSON.parse(fs.readFileSync(inside(context.directory, nodeTimeline), 'utf8')),
    buffs: JSON.parse(fs.readFileSync(inside(context.directory, nodeBuffs), 'utf8')),
    inputs: JSON.parse(fs.readFileSync(inside(context.directory, nodeInputs), 'utf8')),
  }
}

export const node_code_materialize = {
  description: 'Materialize an existing DEF Work Node as normalized editable node/working sources in this isolated session.',
  args: { nodeId: { type: 'string', description: 'Existing Work Node id.' } },
  async execute(args, context) {
    const workbench = await readOptionalWorkbenchState(context)
    if (workbench) requireWorkbenchCheckoutReady(context)
    const current = fs.existsSync(inside(context.directory, bindingFile)) ? readBinding(context) : null
    if (current?.nodeId !== args.nodeId && workspaceIsDirty(context, current)) {
      throw new Error(`Cannot replace ${current.nodeId} because node/working has unsynchronized edits. Sync, discard, or explicitly preserve that draft first.`)
    }
    const read = await callDefTool('def.worknode.read', { nodeId: args.nodeId, includePayload: true })
    return { title: 'DEF node code workspace materialized', output: JSON.stringify(materialize(context, read.node, { checkoutAnchorNodeId: workbench?.checkoutNodeId }), null, 2), metadata: { family: 'def-node-code', nodeId: args.nodeId } }
  },
}

export const node_code_status = {
  description: 'Read the current DEF node code workspace revision, hashes, dirty state, and latest generated validation reports.',
  args: {},
  async execute(_args, context) {
    const manifest = JSON.parse(fs.readFileSync(inside(context.directory, nodeManifest), 'utf8'))
    const source = readWorkspaceSource(context)
    const report = (name) => {
      const target = inside(context.directory, `node/generated/${name}.json`)
      return fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : null
    }
    const output = {
      nodeId: manifest.nodeId,
      revision: manifest.revision,
      baseHash: manifest.baseHash,
      workingHash: manifest.workingHash,
      dirty: hashDefNodeValue(source) !== manifest.sourceHash,
      validation: report('validation'),
      diff: report('diff'),
      risk: report('risk'),
    }
    return { title: 'DEF node code workspace status', output: JSON.stringify(boundResourceValue(output), null, 2), metadata: { family: 'def-node-code', nodeId: manifest.nodeId, dirty: output.dirty } }
  },
}

export const node_code_rebuild = {
  description: 'Rebuild the bound Work Node payload from normalized node/working sources with revision checks, validation, semantic diff, and risk analysis.',
  args: {},
  async execute(_args, context) {
    const result = await syncWorkspace(context)
    return { title: result.validation?.ok ? 'DEF node source rebuilt' : 'DEF node rebuild failed', output: JSON.stringify(result, null, 2), metadata: { family: 'def-node-code', nodeId: result.nodeId, revision: result.revision } }
  },
}

export const node_code_discard = {
  description: 'Discard unsynchronized node/working file edits after native confirmation and re-materialize the repository Work Node revision.',
  args: {},
  async execute(_args, context) {
    const { binding } = await readBindingForCurrentCheckout(context)
    await askWithApproval(context, {
      action: 'Discard node code edits',
      summary: `Discard unsynchronized code edits for ${binding.nodeId}`,
      permission: 'def_node_code_discard',
      nodeId: binding.nodeId,
      revision: binding.revision,
      workingHash: binding.workingHash,
      consequence: 'All unsynchronized node/working edits will be replaced from the repository Work Node.',
    })
    const read = await callDefTool('def.worknode.read', { nodeId: binding.nodeId, includePayload: true })
    return { title: 'DEF node code edits discarded', output: JSON.stringify(materialize(context, read.node, { checkoutAnchorNodeId: binding.checkoutAnchorNodeId }), null, 2), metadata: { family: 'def-node-code', nodeId: binding.nodeId } }
  },
}

export const node_fork = {
  description: 'Fork the current DEF Work Node/current checkout into an isolated child-node code workspace. You must provide a short change name and a concise description of the intended change and scope.',
  args: {
    name: { type: 'string', description: 'Short phrase naming this change, for example "调整莱万汀燃烬顺序". Do not use ids or timestamps.' },
    description: { type: 'string', description: 'Concise description of the intended timeline change and scope.' },
    approvalPolicy: { type: 'string', enum: ['auto-low-risk', 'ask-on-risk', 'manual'], description: 'Approval policy for using this child node.' },
  },
  async execute(args, context) {
    context.metadata({ title: 'Fork DEF child node' })
    const metadata = readForkMetadata(args)
    const workbench = await readOptionalWorkbenchState(context)
    if (workbench) requireWorkbenchCheckoutReady(context)
    const current = fs.existsSync(inside(context.directory, bindingFile)) ? readBinding(context) : null
    if (workspaceIsDirty(context, current)) {
      throw new Error(`Cannot fork over ${current.nodeId} because node/working has unsynchronized edits. Sync, discard, or explicitly preserve that draft first.`)
    }
    const created = await callDefTool('def.worknode.create_from_current', {
      approvalPolicy: args.approvalPolicy,
      label: metadata.name,
      description: metadata.description,
    })
    return {
      title: 'DEF child node ready',
      output: JSON.stringify(materialize(context, created.node, { checkoutAnchorNodeId: workbench?.checkoutNodeId }), null, 2),
      metadata: { nodeId: created.node.id, family: 'def-node-crud' },
    }
  },
}

export const workbench_context = {
  description: 'Read the bound DEF timeline tree and live current-checkout context. Detects manual checkout changes and requires a current-checkout rebind before stale node work can continue.',
  args: {},
  async execute(_args, context) {
    const workbench = await readWorkbenchState(context)
    const binding = fs.existsSync(inside(context.directory, bindingFile)) ? readBinding(context) : null
    const checkoutTransition = {
      changed: workbench.checkoutChanged,
      previous: workbench.previousCheckout,
      current: workbench.checkout,
      activeCheckoutNodeId: workbench.checkoutNodeId,
      boundWorkspaceNodeId: binding?.nodeId || null,
      checkoutAnchorNodeId: binding?.checkoutAnchorNodeId || null,
      requiresRebind: workbench.checkoutPhase === 'checkout-changed' || Boolean(workbench.checkoutNodeId && binding && (
        (binding.checkoutAnchorNodeId && binding.checkoutAnchorNodeId !== workbench.checkoutNodeId)
        || (!binding.checkoutAnchorNodeId && binding.nodeId !== workbench.checkoutNodeId)
      )),
      reasoningEffort: workbench.checkoutChanged ? 'high' : 'normal',
      phase: workbench.checkoutPhase,
    }
    return {
      title: 'DEF Workbench context',
      output: JSON.stringify(boundResourceValue({ attached: workbench.attached, snapshot: workbench.snapshot, checkoutTransition }), null, 2),
      metadata: { family: 'def-node-crud', host: 'workbench', updatedAt: workbench.attached.updatedAt, checkoutChanged: workbench.checkoutChanged },
    }
  },
}

export const workbench_current_node = {
  description: 'Read the one authoritative current Workbench checkout node. Never infer it from a node list, node cursor, parent, or latest-applied status.',
  args: {},
  async execute(_args, context) {
    const workbench = await readWorkbenchState(context)
    requireWorkbenchCheckoutReady(context)
    const checkout = workbench.checkout
    if (checkout?.targetType !== 'work-node' || !workbench.checkoutNodeId) {
      throw new Error('The current Workbench checkout is not a Work Node.')
    }
    const nodes = Array.isArray(workbench.snapshot?.axisContext?.nodes) ? workbench.snapshot.axisContext.nodes : []
    const node = nodes.find((candidate) => candidate?.id === workbench.checkoutNodeId)
    if (!node) throw new Error(`Current Workbench checkout node is missing from its bound tree: ${workbench.checkoutNodeId}`)
    const result = {
      nodeId: node.id,
      label: node.label,
      description: node.description || '',
      status: node.status,
      parentNodeId: node.parentNodeId || null,
      updatedAt: node.updatedAt,
    }
    return {
      title: 'DEF current checkout node',
      output: JSON.stringify(result, null, 2),
      metadata: { family: 'def-node-crud', host: 'workbench', nodeId: node.id, checkoutUpdatedAt: checkout.updatedAt },
    }
  },
}

export const workbench_buttons = {
  description: 'Read current-checkout buttons using exact coordinates. @N-L always means nodeIndex=N-1 and lineIndex=L-1; use this before resolving a button for deletion or edit.',
  args: {
    characterName: { type: 'string', description: 'Optional character name.' },
    skillName: { type: 'string', description: 'Optional skill display name.' },
    nodeIndex: { type: 'number', description: 'Zero-based timeline node index.' },
    lineIndex: { type: 'number', description: 'Zero-based timeline line index.' },
  },
  async execute(args, context) {
    context.metadata({ title: 'Find DEF timeline buttons' })
    const result = await callDefTool('def.workbench.find_buttons', args)
    return {
      title: 'DEF timeline button candidates',
      output: JSON.stringify(result, null, 2),
      metadata: { family: 'def-node-crud', count: result.count, snapshotUpdatedAt: result.snapshotUpdatedAt },
    }
  },
}

export const workbench_buff_ranking = {
  description: 'Rank current-checkout buttons for one character by selected Buff count. Use this for questions about which skill has the most Buffs; do not count Buffs manually.',
  args: {
    characterName: { type: 'string', description: 'Character name to rank. Required for character-specific questions.' },
  },
  async execute(args, context) {
    context.metadata({ title: 'Rank DEF timeline button Buffs' })
    const result = await callDefTool('def.workbench.rank_buttons_by_buff', args)
    return {
      title: 'DEF timeline Buff ranking',
      output: JSON.stringify(result, null, 2),
      metadata: { family: 'def-node-crud', count: result.count, snapshotUpdatedAt: result.snapshotUpdatedAt },
    }
  },
}

export const node_bind = {
  description: 'Bind an existing DEF Work Node to this isolated workspace. Pass an empty nodeId to bind the current Workbench checkout after a manual node switch.',
  args: {
    nodeId: { type: 'string', description: 'Existing DEF Work Node id. Pass an empty string to bind the active Workbench checkout.' },
  },
  async execute(args, context) {
    context.metadata({ title: 'Bind DEF child node' })
    const workbench = await readOptionalWorkbenchState(context)
    const nodeId = typeof args.nodeId === 'string' && args.nodeId.trim() ? args.nodeId.trim() : workbench?.checkoutNodeId
    if (!nodeId) throw new Error('No current Workbench Work Node is checked out. Provide nodeId explicitly.')
    if (workbench?.checkoutNodeId && nodeId !== workbench.checkoutNodeId) {
      throw new Error(`The Workbench is currently checked out at ${workbench.checkoutNodeId}. Bind that active checkout instead of ${nodeId}.`)
    }
    const current = fs.existsSync(inside(context.directory, bindingFile)) ? readBinding(context) : null
    if (current?.nodeId !== nodeId && workspaceIsDirty(context, current)) {
      throw new Error(`Cannot replace ${current.nodeId} because node/working has unsynchronized edits. Sync, discard, or explicitly preserve that draft first.`)
    }
    const read = await callDefTool('def.worknode.read', { nodeId, includePayload: true })
    const materialized = materialize(context, read.node, { checkoutAnchorNodeId: workbench?.checkoutNodeId })
    if (workbench?.checkoutNodeId) markWorkbenchCheckoutReady(context, workbench.checkoutNodeId)
    return {
      title: 'DEF child node bound',
      output: JSON.stringify(materialized, null, 2),
      metadata: { nodeId: read.node.id, family: 'def-node-crud', checkoutAnchorNodeId: workbench?.checkoutNodeId || null },
    }
  },
}

export const node_sync_validate = {
  description: 'Synchronize working-payload.json to the bound Work Node, validate it, and return parent/child diff evidence without touching current checkout.',
  args: {},
  async execute(_args, context) {
    context.metadata({ title: 'Validate DEF child node' })
    const synced = await syncWorkspace(context)
    return {
      title: synced.validation?.ok ? 'DEF child node validated' : 'DEF child node invalid',
      output: JSON.stringify(synced, null, 2),
      metadata: { nodeId: synced.nodeId, family: 'def-node-crud', validation: synced.validation },
    }
  },
}

export const node_diff = {
  description: 'Synchronize and show the validated diff between the bound child node and its base.',
  args: {},
  async execute(_args, context) {
    context.metadata({ title: 'Diff DEF child node' })
    const synced = await syncWorkspace(context)
    return {
      title: 'DEF child node diff',
      output: JSON.stringify({ nodeId: synced.nodeId, diff: synced.diff, diffSummary: synced.diffSummary, checkoutDecision: synced.checkoutDecision }, null, 2),
      metadata: { nodeId: synced.nodeId, family: 'def-node-crud' },
    }
  },
}

export const node_list = {
  description: 'List bounded DEF Work Node metadata without loading node payloads.',
  args: { limit: { type: 'number', description: 'Maximum nodes, from 1 to 100.' } },
  async execute(args, context) {
    context.metadata({ title: 'List DEF child nodes' })
    const result = await callDefTool('def.worknode.list', { limit: args.limit })
    return {
      title: 'DEF child nodes',
      output: JSON.stringify(boundResourceValue(result), null, 2),
      metadata: { family: 'def-node-crud', count: result.nodes?.length || 0 },
    }
  },
}

export const node_delete = {
  description: 'Delete one non-checked-out DEF Work Node subtree after native user approval and repository protection checks.',
  args: { nodeId: { type: 'string', description: 'Work Node id to delete.' } },
  async execute(args, context) {
    context.metadata({ title: 'Delete DEF child node' })
    const read = await callDefTool('def.worknode.read', { nodeId: args.nodeId, includePayload: false })
    await askWithApproval(context, {
      action: 'Delete Work Node',
      summary: `Delete DEF Work Node ${args.nodeId}`,
      permission: 'def_node_delete',
      nodeId: args.nodeId,
      revision: read.node?.contentRevision || read.node?.updatedAt,
      consequence: 'The Work Node subtree will be permanently deleted; the current checkout remains protected.',
    })
    const result = await callDefTool('def.worknode.delete', { nodeId: args.nodeId })
    return {
      title: 'DEF child node deleted',
      output: JSON.stringify(result, null, 2),
      metadata: { family: 'def-node-crud', nodeId: args.nodeId },
    }
  },
}

export const node_use = {
  description: 'Synchronize, validate, approve when required, and directly use the bound child Work Node as the current checkout.',
  args: {},
  async execute(_args, context) {
    context.metadata({ title: 'Use DEF child node' })
    const synced = await syncWorkspace(context)
    const binding = readBinding(context)
    await askWithApproval(context, {
      action: 'Apply Work Node',
      summary: `Apply DEF Work Node ${binding.nodeId} to the main Workbench`,
      permission: 'def_node_use',
      nodeId: binding.nodeId,
      revision: binding.revision,
      diffHash: hashDefNodeValue(synced.diff),
      riskHash: hashDefNodeValue(synced.riskFlags || []),
      workingHash: binding.workingHash,
      diff: synced.diff,
      riskFlags: synced.riskFlags || [],
      consequence: 'The validated Work Node becomes the current checkout and is sent to the Workbench renderer.',
    })
    const used = await callDefTool('def.worknode.checkout_and_verify', {
      nodeId: binding.nodeId,
      expectedRevision: binding.revision,
      expectedWorkingHash: binding.workingHash,
      reload: false,
    })
    if (used.currentCheckoutTouched === true) {
      writeBinding(context, { ...readBinding(context), checkoutAnchorNodeId: binding.nodeId })
    }
    return {
      title: used.ok ? 'DEF child node in use' : 'DEF child node use pending',
      output: JSON.stringify(used, null, 2),
      metadata: { nodeId: binding.nodeId, family: 'def-node-crud', currentCheckoutTouched: used.currentCheckoutTouched === true },
    }
  },
}

export const node_restore = {
  description: 'Restore the current checkout from the bound child node immutable base after native user approval.',
  args: {},
  async execute(_args, context) {
    context.metadata({ title: 'Restore DEF node base' })
    const { binding } = await readBindingForCurrentCheckout(context)
    await askWithApproval(context, {
      action: 'Restore Work Node base',
      summary: `Restore immutable base for DEF Work Node ${binding.nodeId}`,
      permission: 'def_node_restore',
      nodeId: binding.nodeId,
      revision: binding.revision,
      workingHash: binding.workingHash,
      consequence: 'The Work Node base snapshot becomes the current checkout after renderer verification.',
    })
    const restored = await callDefTool('def.worknode.restore_base_and_verify', { nodeId: binding.nodeId, expectedRevision: binding.revision, reload: false })
    return {
      title: restored.ok ? 'DEF node base restored' : 'DEF node restore pending',
      output: JSON.stringify(restored, null, 2),
      metadata: { nodeId: binding.nodeId, family: 'def-node-crud', currentCheckoutTouched: restored.currentCheckoutTouched === true },
    }
  },
}

function boundResourceValue(value, depth = 0) {
  if (typeof value === 'string') return value.length > 600 ? `${value.slice(0, 600)}…` : value
  if (value === null || typeof value !== 'object') return value
  if (depth >= 5) return '[bounded]'
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => boundResourceValue(item, depth + 1))
  return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, boundResourceValue(item, depth + 1)]))
}

function dataResource(definition) {
  return {
    description: definition.description,
    args: {
      query: { type: 'string', description: 'Optional id, name, or search text.' },
    },
    async execute(args, context) {
      context.metadata({ title: definition.title })
      const input = typeof definition.input === 'function' ? definition.input(args) : args
      const result = await callDefTool(definition.tool, input)
      const bounded = boundResourceValue(typeof definition.transform === 'function' ? definition.transform(result) : result)
      return {
        title: definition.title,
        output: JSON.stringify(bounded, null, 2),
        metadata: { family: 'def-data-resource', legacyTool: definition.tool },
      }
    },
  }
}

export const data_operator = dataResource({
  title: 'DEF operator resource',
  description: 'Resolve only the currently selected Workbench operators. Empty results are scoped to the current selection, not the full catalog.',
  tool: 'def.character.resolve',
  input: ({ query }) => ({ query, limit: 12 }),
})

export const data_operator_catalog = dataResource({
  title: 'DEF selection catalog resource',
  description: 'Search the read-only operator catalog used by the selection screen. Use this after a user asks to find someone outside the current selected roster; it never changes that roster.',
  tool: 'def.operator.catalog.search',
  input: ({ query }) => ({ query, limit: 12 }),
})

export const data_game_knowledge = dataResource({
  title: 'DEF game knowledge references',
  description: 'Read bounded evidence excerpts from the game-knowledge Skill references. Use it for glossary and team-guide facts instead of arbitrary filesystem reads.',
  tool: 'def.knowledge.game.search',
  input: ({ query }) => ({ query, limit: 3 }),
})

export const data_weapon = dataResource({
  title: 'DEF weapon resource',
  description: 'Search the same read-only local weapon library shown by the Operator Configuration page. Results include catalog scope/source and never mean only currently equipped weapons.',
  tool: 'def.weapon.resolve',
  input: ({ query }) => ({ query, limit: 12 }),
})

export const data_equipment = dataResource({
  title: 'DEF equipment resource',
  description: 'Resolve trusted DEF equipment and gear-set data by id, name, or query.',
  tool: 'def.equipment.resolve',
  input: ({ query }) => ({ query, limit: 12 }),
  transform: (result) => ({
    query: result.query,
    ambiguity: result.ambiguity,
    suggestedQuestion: result.suggestedQuestion,
    candidates: Array.isArray(result.candidates) ? result.candidates.slice(0, 12).map((item) => ({
      kind: item.kind,
      source: item.source,
      characterName: item.characterName,
      slotKey: item.slotKey,
      equipmentId: item.equipmentId,
      gearSetId: item.gearSetId,
      name: item.name,
      part: item.part,
      summary: item.summary,
      confidence: item.confidence,
      equipments: Array.isArray(item.equipments) ? item.equipments.slice(0, 4).map((equipment) => ({
        id: equipment.id,
        name: equipment.name,
        part: equipment.part,
      })) : undefined,
      threePieceBuffs: Array.isArray(item.threePieceBuffs) ? item.threePieceBuffs.slice(0, 4).map((buff) => ({
        id: buff.id,
        name: buff.name,
        typeKey: buff.typeKey,
        value: buff.value,
      })) : undefined,
    })) : [],
  }),
})

export const data_skill = dataResource({
  title: 'DEF skill resource',
  description: 'Resolve trusted DEF skill data by id, name, or query.',
  tool: 'def.skill.resolve',
  input: ({ query }) => ({ query, limit: 12 }),
})

export const data_buff = dataResource({
  title: 'DEF Buff resource',
  description: 'Resolve trusted DEF Buff candidates by id, name, or query.',
  tool: 'def.buff.resolve',
  input: ({ query }) => ({ query, limit: 12 }),
})

export const data_damage = dataResource({
  title: 'DEF damage resource',
  description: 'Read the trusted current DEF damage report.',
  tool: 'def.workbench.damage_report',
  input: () => ({}),
  transform: (result) => ({
    snapshotUpdatedAt: result.snapshotUpdatedAt,
    damageReport: result.damageReport ? {
      generatedAt: result.damageReport.generatedAt,
      buttonCount: result.damageReport.buttonCount,
      totalExpected: result.damageReport.totalExpected,
      totalNonCrit: result.damageReport.totalNonCrit,
      buttons: Array.isArray(result.damageReport.buttons)
        ? result.damageReport.buttons.slice(0, 20).map((button) => ({
          id: button.id,
          label: button.label,
          characterName: button.characterName,
          skillName: button.skillName,
          skillType: button.skillType,
          expected: button.expected,
          damage: button.damage,
        }))
        : [],
    } : null,
  }),
})

export const operator_config_patch = {
  description: 'Apply one explicitly approved weapon or equipment change to a selected operator through the typed Workbench route. Use only after the user has reviewed the proposed loadout and asked to apply it. The tool waits for the real operator-config mirror; a queued command alone is never success.',
  args: {
    characterId: { type: 'string', description: 'Selected operator id.' },
    characterName: { type: 'string', description: 'Selected operator name when id is unavailable.' },
    weaponName: { type: 'string', description: 'Exact weapon name from DEF weapon resource.' },
    weaponPotential: { type: 'string', enum: ['P0', 'PMAX'], description: 'Optional weapon potential.' },
    gearSetName: { type: 'string', description: 'Exact equipment set name from DEF equipment resource.' },
    gearSetId: { type: 'string', description: 'Exact equipment set id from DEF equipment resource.' },
    equipmentName: { type: 'string', description: 'Exact single equipment name from DEF equipment resource.' },
    equipmentId: { type: 'string', description: 'Exact single equipment id from DEF equipment resource.' },
    slotKey: { type: 'string', enum: ['armor', 'accessory2', 'accessory1', 'glove'], description: 'Slot for one equipment piece.' },
    fillSlots: { type: 'boolean', description: 'Fill all four slots from the named gear set.' },
  },
  async execute(args, context) {
    const weapon = typeof args.weaponName === 'string' && args.weaponName.trim()
      ? { name: args.weaponName.trim(), ...(typeof args.weaponPotential === 'string' ? { potential: args.weaponPotential } : {}) }
      : undefined
    const input = {
      ...(typeof args.characterId === 'string' && args.characterId.trim() ? { characterId: args.characterId.trim() } : {}),
      ...(typeof args.characterName === 'string' && args.characterName.trim() ? { characterName: args.characterName.trim() } : {}),
      ...(weapon ? { weapon } : {}),
      ...(typeof args.gearSetName === 'string' && args.gearSetName.trim() ? { gearSetName: args.gearSetName.trim() } : {}),
      ...(typeof args.gearSetId === 'string' && args.gearSetId.trim() ? { gearSetId: args.gearSetId.trim() } : {}),
      ...(typeof args.equipmentName === 'string' && args.equipmentName.trim() ? { equipmentName: args.equipmentName.trim() } : {}),
      ...(typeof args.equipmentId === 'string' && args.equipmentId.trim() ? { equipmentId: args.equipmentId.trim() } : {}),
      ...(typeof args.slotKey === 'string' && args.slotKey.trim() ? { slotKey: args.slotKey.trim() } : {}),
      ...(args.fillSlots === true ? { fillSlots: true } : {}),
    }
    if (!input.weapon && !input.gearSetName && !input.gearSetId && !input.equipmentName && !input.equipmentId) {
      throw new Error('Provide an exact weapon or equipment selection before applying operator configuration.')
    }
    const before = await callDefTool('def.operator.config.read', {})
    await askWithApproval(context, {
      action: 'Apply operator configuration',
      summary: `Apply reviewed operator weapon/equipment configuration for ${input.characterName || input.characterId || 'selected operator'}`,
      permission: 'def_operator_config_patch',
      nodeId: 'current-checkout',
      revision: before.snapshotUpdatedAt || undefined,
      diff: { type: 'operator-config', requested: input },
      riskFlags: [{ severity: 'warning', code: 'operator-config-mutation', message: 'Changes the visible operator weapon and/or equipment configuration.' }],
      consequence: 'The selected operator configuration changes only if the Workbench renderer returns a matching live postcondition.',
    })
    const result = await callDefTool('def.operator.config.patch', input)
    return {
      title: 'DEF operator configuration applied',
      output: JSON.stringify(result, null, 2),
      metadata: { family: 'def-operator-config', currentCheckoutTouched: result.ok === true, postcondition: result.postcondition?.pass === true },
    }
  },
}
