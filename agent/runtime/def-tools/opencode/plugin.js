import * as definitions from './def.js'
import { DEF_NATIVE_TARGETS } from '../registry.mjs'
import activation from '../../def-opencode-adapter/session-harness-activation.cjs'

export async function createDefToolsPlugin(input = {}, options = {}) {
  const directory = typeof input?.directory === 'string' ? input.directory : ''
  const harnessRuntimeRoot = options.harnessRuntimeRoot === undefined
    ? process.env.DEF_HARNESS_RUNTIME_ROOT
    : options.harnessRuntimeRoot
  const harnessSealKey = options.harnessSealKey === undefined
    ? process.env.DEF_SESSION_HARNESS_SEAL_KEY
    : options.harnessSealKey
  const agentWorkspaceDirectory = options.agentWorkspaceDirectory
  const equipment3Plus1Enabled = (sessionID) => activation.readDefEquipment3Plus1HarnessActivation(
    directory,
    sessionID,
    undefined,
    { runtimeRoot: harnessRuntimeRoot, sealKey: harnessSealKey, agentWorkspaceDirectory },
  )
  const tool = {}
  for (const target of DEF_NATIVE_TARGETS) {
    if (!target.nativeBinding || !target.nativeBinding.startsWith('def_')) continue
    const definition = definitions[target.nativeBinding.slice(4)]
    if (!definition || typeof definition.execute !== 'function') {
      throw new Error(`DEF registry native binding has no implementation: ${target.nativeBinding}`)
    }
    tool[target.nativeBinding] = definition
  }
  return {
    tool,
    event: async ({ event }) => {
      definitions.recordDefToolEventFailure(event)
    },
    'chat.message': async (input, output) => {
      const turnId = output?.message?.id || input?.messageID
      definitions.beginDefToolTurnFromChatMessage(input?.sessionID, turnId, output?.parts, {
        equipment3Plus1Enabled: equipment3Plus1Enabled(input?.sessionID),
      })
    },
    'experimental.chat.messages.transform': async (input, output) => {
      if (input?.phase !== 'generation') {
        return definitions.applyDefToolModelMessagePolicy(output?.messages, input?.phase)
      }
      definitions.applyDefToolModelMessagePolicy(output?.messages, input?.phase, {
        equipment3Plus1Enabled: equipment3Plus1Enabled(input?.sessionID),
      })
    },
    'tool.execute.before': async (input, output) => {
      definitions.assertDefToolTurnNotBlocked(input?.sessionID, input?.tool, output?.args, {
        equipment3Plus1Enabled: equipment3Plus1Enabled(input?.sessionID),
      })
      definitions.assertDefNativeArtifactToolScope(input, output?.args)
    },
  }
}

export default async function DefToolsPlugin(input = {}) {
  return createDefToolsPlugin(input)
}
