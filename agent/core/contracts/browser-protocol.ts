import type {
  ClientTurnId,
  CommandId,
  DefSessionId,
  DefTurnId,
  InteractionId,
  ToolCallId,
} from './ids.ts';
import type { InteractionRequest, InteractionResponse } from './interaction.ts';
import type { JsonObject, JsonValue } from './json.ts';
import type { DefEvent } from './events.ts';
import type { DefSessionV6 } from './session.ts';
import type {
  ProductBinding,
  ProductCommandEnvelope,
  ProductCommandResult,
  ProductSnapshotEnvelope,
} from './product.ts';

export const DEF_AGENT_PROTOCOL_VERSION = 2 as const;
export const DEF_AGENT_RUNTIME_SCHEMA_VERSION = 1 as const;
export const DEF_AGENT_COMMAND_SCHEMA_VERSION = 1 as const;

export const DEF_AGENT_IN_MEMORY_LIMITS = Object.freeze({
  maxSessionsPerHost: 16,
  maxTurnsPerSession: 64,
  maxEventsPerSession: 4_096,
  maxEventCodeUnitsPerSession: 4 * 1_024 * 1_024,
  maxEventsPerTurn: 1_024,
  maxEventCodeUnitsPerTurn: 1 * 1_024 * 1_024,
  terminalEventReserve: 32,
  terminalCodeUnitReserve: 64 * 1_024,
  maxHarnessTransactionsPerHost: 1_024,
  maxProductCommandsPerHost: 4_096,
});

export const AGENT_UI_CAPABILITY_HEADER = 'x-dmg-agent-ui-capability' as const;
export const AGENT_LAUNCH_GRANT_FRAGMENT_KEY = '__agent_launch_grant' as const;
export const AGENT_UI_CAPABILITY_STORAGE_KEY = 'dmg.desktop.agent-ui-session.v1' as const;
export const AGENT_APPROVAL_KEY_STORAGE_KEY = 'dmg.desktop.agent-approval-key.v1' as const;

export type AgentLaunchAudience = 'workbench-ai-mode';

export type Phase2ProductOperationSchema = {
  'workbench.refresh-snapshot': {
    readonly reason: 'agent-read';
  };
  'workbench.execute-command': {
    readonly command: JsonObject;
    readonly visiblePostcondition?: JsonObject;
  };
};

export type Phase2ProductCommand = ProductCommandEnvelope<Phase2ProductOperationSchema>;

export type AgentHostHealth = {
  readonly service: 'def-agent-host';
  readonly protocolVersion: typeof DEF_AGENT_PROTOCOL_VERSION;
  readonly runtimeSchemaVersion: typeof DEF_AGENT_RUNTIME_SCHEMA_VERSION;
  readonly state: 'starting' | 'ready' | 'stopping' | 'error';
  readonly engine: {
    readonly kind: string;
    readonly state: 'ready' | 'pending' | 'unavailable';
    readonly reason?: string;
  };
};

export type AgentLaunchGrantRegistration = {
  readonly grant: string;
  readonly origin: string;
  readonly audience: AgentLaunchAudience;
  readonly expiresAt: number;
};

export type AgentUiSessionExchange = {
  readonly launchGrant: string;
  readonly audience: AgentLaunchAudience;
};

export type AgentUiSession = {
  readonly protocolVersion: typeof DEF_AGENT_PROTOCOL_VERSION;
  readonly capability: string;
  readonly audience: AgentLaunchAudience;
  readonly expiresAt: number;
  readonly approvalVerificationKey: ApprovalCapabilityVerificationKey;
};

export type ApprovalCapabilityVerificationKey = {
  readonly algorithm: 'Ed25519';
  readonly keyEpoch: string;
  readonly publicKeySpki: string;
};

export type BrowserWorkbenchRegistration = {
  readonly consumerId: string;
  readonly executorLeaseId: string;
  readonly writer: true;
  readonly visible: true;
  readonly binding: ProductBinding;
};

export type BrowserWorkbenchHeartbeat = {
  readonly consumerId: string;
  readonly executorLeaseId: string;
  readonly writer: true;
  readonly visible: true;
  readonly binding: ProductBinding;
};

export type BrowserWorkbenchConsumerState = {
  readonly consumerId: string;
  readonly executorLeaseId: string;
  readonly binding: ProductBinding;
  readonly registeredAt: number;
  readonly heartbeatExpiresAt: number;
};

export type AgentUiState = {
  readonly protocolVersion: typeof DEF_AGENT_PROTOCOL_VERSION;
  readonly engine: AgentHostHealth['engine'];
  readonly consumer: BrowserWorkbenchConsumerState | null;
  readonly activeDefSessionId: DefSessionId | null;
  readonly activeDefTurnId: DefTurnId | null;
};

export type AgentInteractionList = {
  readonly protocolVersion: typeof DEF_AGENT_PROTOCOL_VERSION;
  readonly interactions: readonly InteractionRequest[];
};

export type AgentInteractionRespondInput = {
  readonly status: InteractionResponse['status'];
  readonly value?: JsonValue;
};

export type AgentInteractionEnvelope = {
  readonly protocolVersion: typeof DEF_AGENT_PROTOCOL_VERSION;
  readonly interactionId: InteractionId;
  readonly response: InteractionResponse;
};

export type AgentProductSession = Omit<DefSessionV6, 'engine'> & {
  readonly engine: {
    readonly kind: string;
    readonly runtimeVersion: string;
  };
};

export type AgentSessionList = {
  readonly protocolVersion: typeof DEF_AGENT_PROTOCOL_VERSION;
  readonly sessions: readonly AgentProductSession[];
};

export type AgentSessionCreateInput = {
  readonly providerProfileRef?: string;
};

export type AgentSessionEnvelope = {
  readonly protocolVersion: typeof DEF_AGENT_PROTOCOL_VERSION;
  readonly session: AgentProductSession;
};

export type AgentNativeUiLaunch = {
  readonly src: string;
  readonly defSessionId: DefSessionId;
};

export type AgentNativeUiLaunchEnvelope = {
  readonly protocolVersion: typeof DEF_AGENT_PROTOCOL_VERSION;
  readonly launch: AgentNativeUiLaunch;
};

export type AgentEventPage = {
  readonly protocolVersion: typeof DEF_AGENT_PROTOCOL_VERSION;
  readonly defSessionId: DefSessionId;
  readonly afterSequence: number;
  readonly nextSequence: number;
  readonly hasMore: boolean;
  readonly events: readonly DefEvent[];
};

export type AgentTurnStartInput = {
  readonly clientTurnId: ClientTurnId;
  readonly userMessage: string;
};

export type AgentTurnAccepted = {
  readonly protocolVersion: typeof DEF_AGENT_PROTOCOL_VERSION;
  readonly defSessionId: DefSessionId;
  readonly defTurnId: DefTurnId;
  readonly clientTurnId: ClientTurnId;
};

export type AgentTurnAbortResult = {
  readonly protocolVersion: typeof DEF_AGENT_PROTOCOL_VERSION;
  readonly defTurnId: DefTurnId;
  readonly stopped: true;
};

export type BrowserSnapshotPublish = {
  readonly consumerId: string;
  readonly executorLeaseId: string;
  readonly snapshot: ProductSnapshotEnvelope;
};

export type BrowserCommandDelivery = {
  readonly cursor: number;
  readonly command: Phase2ProductCommand;
  /**
   * `execute` is used only for a command accepted by the current Host
   * process. A command loaded after a Host restart is always `reconcile`.
   * The field stays optional for older test seams/clients; new Host
   * deliveries always include it.
   */
  readonly mode?: 'execute' | 'reconcile';
};

export type BrowserCommandResultSubmission = {
  readonly consumerId: string;
  readonly executorLeaseId: string;
  readonly result: ProductCommandResult;
};

export type BrowserCommandCorrelation = {
  readonly commandId: CommandId;
  readonly defSessionId: DefSessionId;
  readonly defTurnId: DefTurnId;
  readonly toolCallId: ToolCallId;
};
