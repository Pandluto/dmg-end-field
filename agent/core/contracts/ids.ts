declare const agentIdBrand: unique symbol;

type AgentId<Tag extends string> = string & {
  readonly [agentIdBrand]: Tag;
};

export type DefSessionId = AgentId<'DefSessionId'>;
export type ClientTurnId = AgentId<'ClientTurnId'>;
export type DefTurnId = AgentId<'DefTurnId'>;
export type EngineSessionId = AgentId<'EngineSessionId'>;
export type EngineTurnId = AgentId<'EngineTurnId'>;
export type EngineMessageId = AgentId<'EngineMessageId'>;
export type ToolCallId = AgentId<'ToolCallId'>;
export type InteractionId = AgentId<'InteractionId'>;
export type CommandId = AgentId<'CommandId'>;
export type WorkspaceId = AgentId<'WorkspaceId'>;
export type DatabaseGeneration = AgentId<'DatabaseGeneration'>;
export type TimelineId = AgentId<'TimelineId'>;

function asAgentId<T extends string>(value: string, label: string): T {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} must be a non-empty string`);
  return normalized as T;
}

export const asDefSessionId = (value: string): DefSessionId => asAgentId<DefSessionId>(value, 'DefSessionId');
export const asClientTurnId = (value: string): ClientTurnId => asAgentId<ClientTurnId>(value, 'ClientTurnId');
export const asDefTurnId = (value: string): DefTurnId => asAgentId<DefTurnId>(value, 'DefTurnId');
export const asEngineSessionId = (value: string): EngineSessionId => asAgentId<EngineSessionId>(value, 'EngineSessionId');
export const asEngineTurnId = (value: string): EngineTurnId => asAgentId<EngineTurnId>(value, 'EngineTurnId');
export const asEngineMessageId = (value: string): EngineMessageId => asAgentId<EngineMessageId>(value, 'EngineMessageId');
export const asToolCallId = (value: string): ToolCallId => asAgentId<ToolCallId>(value, 'ToolCallId');
export const asInteractionId = (value: string): InteractionId => asAgentId<InteractionId>(value, 'InteractionId');
export const asCommandId = (value: string): CommandId => asAgentId<CommandId>(value, 'CommandId');
export const asWorkspaceId = (value: string): WorkspaceId => asAgentId<WorkspaceId>(value, 'WorkspaceId');
export const asDatabaseGeneration = (value: string): DatabaseGeneration => asAgentId<DatabaseGeneration>(value, 'DatabaseGeneration');
export const asTimelineId = (value: string): TimelineId => asAgentId<TimelineId>(value, 'TimelineId');
