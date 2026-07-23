import fs from 'node:fs'
import path from 'node:path'
import managerRuntime from '../../def-harness-manager/runtime.cjs'
import managerBridge from '../../def-harness-manager/bridge.cjs'
import { DEF_NATIVE_TARGETS } from '../registry.mjs'

const { HarnessTransactionRuntime } = managerRuntime
const { readRuntimeBridge } = managerBridge
const sessionDirectories = new Map()
const pendingTurnIds = new Map()
const runtimes = new Map()
const completedToolCalls = new Set()

function managedWorkbenchBinding(directory) {
  if (!directory) return null
  try {
    const binding = JSON.parse(fs.readFileSync(path.join(directory, '.def-session.json'), 'utf8'))
    return binding?.host === 'workbench' && binding?.sessionID ? binding : null
  } catch {
    return null
  }
}

function canonicalToolId(binding) {
  return DEF_NATIVE_TARGETS.find((target) => target.nativeBinding === binding)?.id || ''
}

function runtimeFor(directory) {
  if (!runtimes.has(directory)) {
    runtimes.set(directory, new HarnessTransactionRuntime({
      sessionDirectory: directory,
      toolTargets: DEF_NATIVE_TARGETS,
    }))
  }
  return runtimes.get(directory)
}

export function recordHarnessChatTurn(sessionId, turnId) {
  if (!sessionId || !turnId) return
  pendingTurnIds.set(sessionId, turnId)
  const directory = sessionDirectories.get(sessionId)
  if (directory && readRuntimeBridge(directory)) runtimeFor(directory).bindTurn(sessionId, turnId)
}

export function harnessToolChoiceForProjection(projection) {
  if (!['route', 'business', 'clarify', 'complete'].includes(projection?.mode)) return undefined
  return Array.isArray(projection.allowedToolBindings) && projection.allowedToolBindings.length > 0
    ? 'required'
    : 'none'
}

export async function projectHarnessTools({ sessionId, directory, tools }) {
  if (!sessionId || !directory) return null
  sessionDirectories.set(sessionId, directory)
  const bridge = readRuntimeBridge(directory)
  if (!bridge) {
    if (managedWorkbenchBinding(directory)) {
      const error = new Error('Harness Manager projection is missing for this managed Workbench request.')
      error.code = 'HARNESS_RUNTIME_NOT_PREPARED'
      throw error
    }
    return null
  }
  const turnId = pendingTurnIds.get(sessionId)
  if (turnId && bridge.turnId !== turnId) runtimeFor(directory).bindTurn(sessionId, turnId)
  const current = readRuntimeBridge(directory)
  const allowed = new Set(current?.allowedToolBindings || [])
  for (const binding of Object.keys(tools)) {
    if (!allowed.has(binding)) delete tools[binding]
  }
  return current
}

export function appendHarnessSystem({ sessionId, directory, system }) {
  if (!sessionId || !directory) return
  sessionDirectories.set(sessionId, directory)
  const bridge = readRuntimeBridge(directory)
  if (!bridge) {
    if (managedWorkbenchBinding(directory)) {
      const error = new Error('Harness Manager system projection is missing for this managed Workbench request.')
      error.code = 'HARNESS_RUNTIME_NOT_PREPARED'
      throw error
    }
    return
  }
  const { serviceEpoch: _serviceEpoch, ...visibleContext } = bridge.context || {}
  system.push([
    'DEF HARNESS MANAGER ACTIVE PHASE (authoritative):',
    `Mode: ${bridge.mode}.`,
    `Business: ${bridge.businessId || 'none'}.`,
    `Operation: ${bridge.operation || 'none'}.`,
    `Phase: ${bridge.phase || 'none'}.`,
    bridge.mode === 'route'
      ? `Available business definitions: ${JSON.stringify(bridge.routeDefinitions || [])}`
      : '',
    bridge.mode === 'clarify'
      ? `Required clarification: ${JSON.stringify(bridge.question || {})}`
      : '',
    harnessToolChoiceForProjection(bridge) === 'required'
      ? 'This phase is incomplete until one projected Tool succeeds. A final answer cannot complete the turn before that Tool call.'
      : '',
    bridge.instructions || '',
    `Bound context: ${JSON.stringify(visibleContext)}`,
  ].filter(Boolean).join('\n'))
}

export async function assertHarnessToolBefore({ sessionId, turnId, tool, callId, args }) {
  const directory = sessionDirectories.get(sessionId)
  if (!directory) return
  if (!readRuntimeBridge(directory)) {
    if (managedWorkbenchBinding(directory)) {
      const error = new Error('Harness Manager Tool gate is missing for this managed Workbench request.')
      error.code = 'HARNESS_RUNTIME_NOT_PREPARED'
      throw error
    }
    return
  }
  const runtime = runtimeFor(directory)
  runtime.refreshFromDisk()
  await runtime.beforeTool({
    sessionId,
    turnId: turnId || pendingTurnIds.get(sessionId) || '',
    toolBinding: tool,
    canonicalToolId: canonicalToolId(tool),
    callId,
    args,
  })
}

export async function advanceHarnessToolAfter({ sessionId, turnId, tool, callId, output }) {
  const directory = sessionDirectories.get(sessionId)
  if (!directory || !readRuntimeBridge(directory)) return
  const key = `${sessionId}:${callId}`
  if (completedToolCalls.has(key)) return
  completedToolCalls.add(key)
  if (completedToolCalls.size > 1024) completedToolCalls.delete(completedToolCalls.values().next().value)
  const runtime = runtimeFor(directory)
  runtime.refreshFromDisk()
  await runtime.afterTool({
    sessionId,
    turnId: turnId || pendingTurnIds.get(sessionId) || '',
    callId,
    toolBinding: tool,
    canonicalToolId: canonicalToolId(tool),
    output,
  })
}

export async function advanceHarnessToolFailure(event) {
  const part = event?.properties?.part
  if (event?.type !== 'message.part.updated' || part?.type !== 'tool' || part?.state?.status !== 'error') return
  const unavailable = /Model tried to call unavailable tool\b.*\bAvailable tools:/i
    .test(String(part.state.error || ''))
  const directory = sessionDirectories.get(part.sessionID)
  if (!directory || !readRuntimeBridge(directory)) return
  const key = `${part.sessionID}:${part.callID}`
  if (completedToolCalls.has(key)) return
  completedToolCalls.add(key)
  if (completedToolCalls.size > 1024) completedToolCalls.delete(completedToolCalls.values().next().value)
  const runtime = runtimeFor(directory)
  runtime.refreshFromDisk()
  if (unavailable) {
    await runtime.rejectUnavailableTool({
      sessionId: part.sessionID,
      turnId: pendingTurnIds.get(part.sessionID) || '',
      callId: part.callID,
      toolBinding: part.tool,
      error: String(part.state.error || ''),
    })
    return
  }
  await runtime.afterTool({
    sessionId: part.sessionID,
    turnId: pendingTurnIds.get(part.sessionID) || '',
    callId: part.callID,
    toolBinding: part.tool,
    canonicalToolId: canonicalToolId(part.tool),
    output: {
      title: 'DEF Tool failed',
      output: String(part.state.error || 'def-tool-execution-failed'),
      metadata: { ok: false, state: 'error' },
    },
  })
}
