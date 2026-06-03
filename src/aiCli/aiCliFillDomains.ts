import type { AiAgentProposalDomain, AiAgentWorkflow } from './aiCliAgentTypes';

export type AgentFillCommandAction = 'task' | 'check' | 'apply';

export interface AgentFillValidationResult<T = unknown> {
  ok: boolean;
  errors: string[];
  normalized?: T;
}

export interface AgentFillProposalPayload<T = unknown> {
  rawCommand: string;
  normalized: T;
  summary: string;
}

export interface AgentFillDomainAdapter<TPayload = unknown> {
  domain: AiAgentProposalDomain;
  workflow: AiAgentWorkflow;
  commandPrefix: string;
  draftStorageKey: string;
  libraryStorageKey: string;
  supportedEffectTypes: string[];
  validateAiDraft(rawPayload: unknown): AgentFillValidationResult<TPayload>;
  validateProposalPayload?(payload: unknown): AgentFillValidationResult<TPayload>;
  createProposalPayload(validation: AgentFillValidationResult<TPayload>, rawCommand: string): AgentFillProposalPayload<TPayload>;
  summarizeProposal(payload: TPayload): string;
  buildTaskPackage(): { lines: string[]; data: unknown };
  applyToWorkingState(payload: TPayload): { ok: boolean; error?: string };
  saveToLocalTruth(payload: TPayload): { ok: boolean; error?: string };
  discardProposal?(payload: TPayload): void;
}

const registry = new Map<string, AgentFillDomainAdapter>();

export function registerFillDomainAdapter(adapter: AgentFillDomainAdapter) {
  registry.set(adapter.commandPrefix, adapter);
}

export function findFillDomainAdapter(commandPrefix: string): AgentFillDomainAdapter | null {
  return registry.get(commandPrefix) ?? null;
}

export function findFillDomainAdapterByDomain(domain: AiAgentProposalDomain): AgentFillDomainAdapter | null {
  for (const adapter of registry.values()) {
    if (adapter.domain === domain) {
      return adapter;
    }
  }
  return null;
}

export function resolveFillCommand(command: string): { prefix: string; action: AgentFillCommandAction; args: string } | { prefix: string; error: string } | null {
  const trimmed = command.trim();
  const prefixes = Array.from(registry.keys()).sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    const lowerPrefix = prefix.toLowerCase();
    if (trimmed.toLowerCase().startsWith(lowerPrefix)) {
      let rest = trimmed.slice(prefix.length).trim();
      // Support both "fill.check" and "fill check" formats
      if (rest.startsWith('.')) {
        rest = rest.slice(1).trim();
      }
      const actionMatch = rest.match(/^(task|check|apply)(?:[.\s]+|$)/i);
      if (!actionMatch) {
        // Registry hit but action is not task/check/apply
        return { prefix, error: `usage: ${prefix}.task | ${prefix}.check <json> | ${prefix}.apply <json>` };
      }
      const action = actionMatch[1].toLowerCase() as AgentFillCommandAction;
      const args = rest.slice(actionMatch[0].length).trim().replace(/^\./, '');
      return { prefix, action, args };
    }
  }
  return null;
}
