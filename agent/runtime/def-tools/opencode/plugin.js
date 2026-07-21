import * as definitions from './def.js'
import { DEF_NATIVE_TARGETS } from '../registry.mjs'

export default async function DefToolsPlugin() {
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
      definitions.beginDefToolTurnFromChatMessage(input?.sessionID, turnId, output?.parts)
    },
    'tool.execute.before': async (input, output) => {
      definitions.assertDefToolTurnNotBlocked(input?.sessionID, input?.tool)
      definitions.assertDefReadOnlyCatalogTurnPolicy(input, output?.args)
      definitions.assertDefNativeArtifactToolScope(input, output?.args)
    },
    'tool.execute.after': async (input, output) => {
      definitions.recordDefReadOnlyCatalogTurnToolOutput(input, output)
    },
  }
}
