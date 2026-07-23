import managerRuntime from '../../def-harness-manager/runtime.cjs'
import managerBridge from '../../def-harness-manager/bridge.cjs'
import { DEF_NATIVE_TARGETS } from '../registry.mjs'

const { HarnessTransactionRuntime } = managerRuntime
const { readRuntimeBridge } = managerBridge
const sessionDirectories = new Map()
const pendingTurnIds = new Map()
const runtimes = new Map()
const completedToolCalls = new Set()

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

export async function projectHarnessTools({ sessionId, directory, tools }) {
  if (!sessionId || !directory) return
  sessionDirectories.set(sessionId, directory)
  const bridge = readRuntimeBridge(directory)
  if (!bridge || bridge.mode === 'legacy-compatibility') return
  const turnId = pendingTurnIds.get(sessionId)
  if (turnId && bridge.turnId !== turnId) runtimeFor(directory).bindTurn(sessionId, turnId)
  const current = readRuntimeBridge(directory)
  const allowed = new Set(current?.allowedToolBindings || [])
  for (const binding of Object.keys(tools)) {
    if (!allowed.has(binding)) delete tools[binding]
  }
}

export function appendHarnessSystem({ sessionId, directory, system }) {
  if (!sessionId || !directory) return
  sessionDirectories.set(sessionId, directory)
  const bridge = readRuntimeBridge(directory)
  if (!bridge || bridge.mode === 'legacy-compatibility') return
  system.push([
    'DEF HARNESS MANAGER ACTIVE PHASE (authoritative):',
    `Mode: ${bridge.mode}.`,
    `Business: ${bridge.businessId || 'none'}.`,
    `Operation: ${bridge.operation || 'none'}.`,
    `Phase: ${bridge.phase || 'none'}.`,
    bridge.instructions || '',
    `Bound context: ${JSON.stringify(bridge.context || {})}`,
  ].filter(Boolean).join('\n'))
}

export function assertHarnessToolBefore({ sessionId, turnId, tool, callId, args }) {
  const directory = sessionDirectories.get(sessionId)
  if (!directory || !readRuntimeBridge(directory)) return
  const runtime = runtimeFor(directory)
  const bridge = runtime.assertTool({
    sessionId,
    turnId: turnId || pendingTurnIds.get(sessionId) || '',
    toolBinding: tool,
    canonicalToolId: canonicalToolId(tool),
  })
  if (bridge?.transactionId) {
    runtime.transactions.recordToolCall(bridge.transactionId, {
      callId,
      toolId: canonicalToolId(tool),
      inputRef: args,
    })
  }
}

export async function advanceHarnessToolAfter({ sessionId, turnId, tool, callId, output }) {
  const directory = sessionDirectories.get(sessionId)
  if (!directory || !readRuntimeBridge(directory)) return
  const key = `${sessionId}:${callId}`
  if (completedToolCalls.has(key)) return
  completedToolCalls.add(key)
  await runtimeFor(directory).afterTool({
    sessionId,
    turnId: turnId || pendingTurnIds.get(sessionId) || '',
    callId,
    toolBinding: tool,
    canonicalToolId: canonicalToolId(tool),
    output,
  })
  if (completedToolCalls.size > 1024) completedToolCalls.delete(completedToolCalls.values().next().value)
}

export async function advanceHarnessToolFailure(event) {
  const part = event?.properties?.part
  if (event?.type !== 'message.part.updated' || part?.type !== 'tool' || part?.state?.status !== 'error') return
  const directory = sessionDirectories.get(part.sessionID)
  if (!directory || !readRuntimeBridge(directory)) return
  const key = `${part.sessionID}:${part.callID}`
  if (completedToolCalls.has(key)) return
  completedToolCalls.add(key)
  await runtimeFor(directory).afterTool({
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
  if (completedToolCalls.size > 1024) completedToolCalls.delete(completedToolCalls.values().next().value)
}
