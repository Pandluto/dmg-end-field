import fs from 'node:fs'
import path from 'node:path'

const restBase = process.env.DEF_REST_BASE_URL || 'http://127.0.0.1:17321'
const bindingFile = '.def-node.json'
const workingFile = 'working-payload.json'
const baseFile = 'base-payload.json'

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
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function materialize(context, node) {
  if (!node?.id || !node?.workingPayload || !node?.basePayload) throw new Error('Work node payload is incomplete')
  fs.mkdirSync(context.directory, { recursive: true })
  writeJson(inside(context.directory, bindingFile), {
    schemaVersion: 1,
    nodeId: node.id,
    parentNodeId: node.parentNodeId || null,
    saveId: node.saveId,
    branchId: node.branchId,
    sessionId: context.sessionID,
    materializedAt: Date.now(),
  })
  writeJson(inside(context.directory, baseFile), node.basePayload)
  writeJson(inside(context.directory, workingFile), node.workingPayload)
  fs.writeFileSync(inside(context.directory, 'README.md'), [
    '# DEF child node workspace',
    '',
    `Node: ${node.id}`,
    '',
    `Edit ${workingFile} with OpenCode read/edit/apply_patch.`,
    `Do not edit ${baseFile}; it is the immutable comparison baseline.`,
    'Run def_node_sync_validate before requesting approval or using the node.',
    '',
  ].join('\n'), 'utf8')
  return { nodeId: node.id, directory: context.directory, files: [bindingFile, baseFile, workingFile, 'README.md'] }
}

function readBinding(context) {
  const target = inside(context.directory, bindingFile)
  if (!fs.existsSync(target)) throw new Error('No child node is bound to this OpenCode session. Call def_node_fork or def_node_bind first.')
  return JSON.parse(fs.readFileSync(target, 'utf8'))
}

async function syncWorkspace(context) {
  const binding = readBinding(context)
  const workingPayload = JSON.parse(fs.readFileSync(inside(context.directory, workingFile), 'utf8'))
  return callDefTool('def.worknode.sync_workspace', {
    nodeId: binding.nodeId,
    sessionId: context.sessionID,
    workingPayload,
  })
}

export const node_fork = {
  description: 'Fork the current DEF Work Node/current checkout into an isolated child-node code workspace bound to this OpenCode session.',
  args: {},
  async execute(_args, context) {
    context.metadata({ title: 'Fork DEF child node' })
    const created = await callDefTool('def.worknode.create_from_current', {})
    return {
      title: 'DEF child node ready',
      output: JSON.stringify(materialize(context, created.node), null, 2),
      metadata: { nodeId: created.node.id, family: 'def-node-crud' },
    }
  },
}

export const node_bind = {
  description: 'Bind an existing DEF Work Node to this isolated OpenCode session and materialize its editable payload files.',
  args: {
    nodeId: { type: 'string', description: 'Existing DEF Work Node id.' },
  },
  async execute(args, context) {
    context.metadata({ title: 'Bind DEF child node' })
    const read = await callDefTool('def.worknode.read', { nodeId: args.nodeId, includePayload: true })
    return {
      title: 'DEF child node bound',
      output: JSON.stringify(materialize(context, read.node), null, 2),
      metadata: { nodeId: read.node.id, family: 'def-node-crud' },
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

export const node_use = {
  description: 'Synchronize, validate, approve when required, and directly use the bound child Work Node as the current checkout.',
  args: {},
  async execute(_args, context) {
    context.metadata({ title: 'Use DEF child node' })
    const synced = await syncWorkspace(context)
    const binding = readBinding(context)
    if (synced.checkoutDecision?.requiresManualApproval) {
      const requested = await callDefTool('def.approval.request', {
        summary: `Use DEF child node ${binding.nodeId}`,
        riskLevel: 'high',
        mode: 'blocking',
        workNodeId: binding.nodeId,
        toolCallId: context.messageID,
        diffSummary: synced.diff,
      })
      await context.ask({
        permission: 'def_node_use',
        patterns: [binding.nodeId],
        always: [],
        metadata: { nodeId: binding.nodeId, diff: synced.diff, approvalId: requested.approval.id },
      })
      await callDefTool('def.approval.record_decision', {
        approvalId: requested.approval.id,
        decision: 'approved',
        decidedBy: 'user',
        rationale: 'Approved through OpenCode native permission UI.',
      })
    }
    const used = await callDefTool('def.worknode.checkout_and_verify', {
      nodeId: binding.nodeId,
      reload: false,
    })
    return {
      title: used.ok ? 'DEF child node in use' : 'DEF child node use pending',
      output: JSON.stringify(used, null, 2),
      metadata: { nodeId: binding.nodeId, family: 'def-node-crud', currentCheckoutTouched: used.currentCheckoutTouched === true },
    }
  },
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
      return {
        title: definition.title,
        output: JSON.stringify(result, null, 2),
        metadata: { family: 'def-data-resource', legacyTool: definition.tool },
      }
    },
  }
}

export const data_operator = dataResource({
  title: 'DEF operator resource',
  description: 'Resolve trusted DEF operator/character data by id, name, or query.',
  tool: 'def.character.resolve',
  input: ({ query }) => ({ query }),
})

export const data_weapon = dataResource({
  title: 'DEF weapon resource',
  description: 'Resolve trusted DEF weapon data by id, name, or query.',
  tool: 'def.weapon.resolve',
  input: ({ query }) => ({ query }),
})

export const data_equipment = dataResource({
  title: 'DEF equipment resource',
  description: 'Resolve trusted DEF equipment and gear-set data by id, name, or query.',
  tool: 'def.equipment.resolve',
  input: ({ query }) => ({ query }),
})

export const data_skill = dataResource({
  title: 'DEF skill resource',
  description: 'Resolve trusted DEF skill data by id, name, or query.',
  tool: 'def.skill.resolve',
  input: ({ query }) => ({ query }),
})

export const data_buff = dataResource({
  title: 'DEF Buff resource',
  description: 'Resolve trusted DEF Buff candidates by id, name, or query.',
  tool: 'def.buff.resolve',
  input: ({ query }) => ({ query }),
})

export const data_damage = dataResource({
  title: 'DEF damage resource',
  description: 'Read the trusted current DEF damage report.',
  tool: 'def.workbench.damage_report',
  input: () => ({}),
})
