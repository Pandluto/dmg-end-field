import * as definitions from './def.js'
import { DEF_NATIVE_TARGETS } from '../registry.mjs'
import activation from '../../def-opencode-adapter/session-harness-activation.cjs'

export default async function DefToolsPlugin(input = {}) {
  const directory = typeof input?.directory === 'string' ? input.directory : ''
  const equipment3Plus1Enabled = (sessionID) => activation.readDefEquipment3Plus1HarnessActivation(
    directory,
    sessionID,
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
