import * as definitions from './def.js'
import { DEF_NATIVE_TARGETS } from '../registry.mjs'
import {
  advanceHarnessToolAfter,
  advanceHarnessToolFailure,
  appendHarnessSystem,
  assertHarnessToolBefore,
  projectHarnessTools,
  recordHarnessChatTurn,
} from './harness-manager-bridge.mjs'

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
      await advanceHarnessToolFailure(event)
    },
    'chat.message': async (input, output) => {
      const turnId = output?.message?.id || input?.messageID
      definitions.beginDefToolTurnFromChatMessage(input?.sessionID, turnId, output?.parts)
      recordHarnessChatTurn(input?.sessionID, turnId)
    },
    'experimental.chat.system.transform': async (input, output) => {
      appendHarnessSystem({
        sessionId: input?.sessionID,
        directory: input?.directory,
        system: output.system,
      })
    },
    'experimental.chat.tools.transform': async (input, output) => {
      await projectHarnessTools({
        sessionId: input?.sessionID,
        directory: input?.directory,
        tools: output.tools,
      })
    },
    'tool.execute.before': async (input, output) => {
      definitions.assertDefToolTurnNotBlocked(input?.sessionID, input?.tool, output?.args)
      definitions.assertDefNativeArtifactToolScope(input, output?.args)
      await assertHarnessToolBefore({
        sessionId: input?.sessionID,
        turnId: input?.messageID,
        tool: input?.tool,
        callId: input?.callID,
        args: output?.args,
      })
    },
    'tool.execute.after': async (input, output) => {
      await advanceHarnessToolAfter({
        sessionId: input?.sessionID,
        turnId: input?.messageID,
        tool: input?.tool,
        callId: input?.callID,
        output,
      })
    },
  }
}
