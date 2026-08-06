import {
  AgentEngineProtocolError,
  type AgentEngine,
  type EngineHealth,
  type EngineRecoveryResult,
  type EngineSessionCreateInput,
  type EngineSessionRef,
  type EngineTurnHandle,
  type EngineTurnInput,
} from '../core/contracts/index.ts';

/** Phase 2 deliberately ships the Host framework without a production AI engine. */
export class PendingAgentEngine implements AgentEngine {
  readonly kind = 'pending';

  async probe(): Promise<EngineHealth> {
    return {
      status: 'unavailable',
      kind: this.kind,
      code: 'ENGINE_PENDING',
      message: 'Agent engine adapter has not been installed yet',
    };
  }

  async createSession(_input: EngineSessionCreateInput): Promise<EngineSessionRef> {
    throw this.#pending();
  }

  async recoverSession(_ref: EngineSessionRef): Promise<EngineRecoveryResult> {
    return {
      status: 'incompatible',
      code: 'ENGINE_PENDING',
      message: 'Agent engine adapter has not been installed yet',
    };
  }

  async startTurn(_input: EngineTurnInput): Promise<EngineTurnHandle> {
    throw this.#pending();
  }

  async disposeSession(_ref: EngineSessionRef): Promise<void> {}

  async shutdown(): Promise<void> {}

  #pending(): AgentEngineProtocolError {
    return new AgentEngineProtocolError('ENGINE_SESSION_INCOMPATIBLE', 'Agent engine adapter is pending');
  }
}
