import type { DefSessionId, DefTurnId } from './ids.ts';
import type { EngineToolProjectionInput } from './engine.ts';

export const DEF_HARNESS_STATE_VERSION = 1 as const;

export type DefHarnessBusinessId =
  | 'selection'
  | 'loadout'
  | 'timeline'
  | 'buff'
  | 'calculation';

export type DefHarnessOperationId =
  | 'inspect'
  | 'current'
  | 'resolve'
  | 'calculate'
  | 'apply'
  | 'edit'
  | 'add'
  | 'remove'
  | 'resistance'
  | 'recalculate'
  | 'ask';

export type DefHarnessPhaseKind =
  | 'route'
  | 'context'
  | 'evidence'
  | 'interaction'
  | 'proposal'
  | 'mutation'
  | 'verification'
  | 'response';

export type DefHarnessTerminalState = 'completed' | 'aborted';

export interface DefHarnessPhaseDefinition {
  readonly id: string;
  readonly kind: DefHarnessPhaseKind;
  readonly tools: readonly string[];
  readonly instructions: string;
  readonly onSuccess?: string;
  readonly onFailure?: string;
  readonly terminalState?: DefHarnessTerminalState;
  readonly writes: readonly string[];
}

export interface DefHarnessOperationDefinition {
  readonly operation: DefHarnessOperationId;
  readonly entryPhase: string;
  readonly phases: readonly DefHarnessPhaseDefinition[];
}

export interface DefHarnessRevisionDefinition {
  readonly schemaVersion: 1;
  readonly businessId: DefHarnessBusinessId;
  readonly displayName: string;
  readonly sourceLineage: string;
  readonly revision: string;
  readonly summary: string;
  readonly writeScope: readonly string[];
  readonly operations: readonly DefHarnessOperationDefinition[];
}

export interface DefHarnessRevisionRef {
  readonly businessId: DefHarnessBusinessId;
  readonly revision: string;
  readonly sourceLineage: string;
  readonly contentHash: string;
}

export interface DefHarnessRouteInput {
  readonly businessId: DefHarnessBusinessId;
  readonly operation: DefHarnessOperationId;
}

export type DefHarnessTransactionStatus =
  | 'routing'
  | 'active'
  | 'completed'
  | 'aborted';

export interface DefHarnessTransactionSnapshot {
  readonly transactionId: string;
  readonly defSessionId: DefSessionId;
  readonly defTurnId: DefTurnId;
  readonly status: DefHarnessTransactionStatus;
  readonly businessId: DefHarnessBusinessId | null;
  readonly operation: DefHarnessOperationId | null;
  readonly revision: DefHarnessRevisionRef | null;
  readonly phaseId: string;
  readonly phaseKind: DefHarnessPhaseKind;
  readonly projection: EngineToolProjectionInput;
  readonly terminalState: DefHarnessTerminalState | null;
}

export type DefHarnessTraceEntry =
  | {
      readonly sequence: number;
      readonly type: 'harness.routed';
      readonly businessId: DefHarnessBusinessId;
      readonly operation: DefHarnessOperationId;
      readonly revision: DefHarnessRevisionRef;
    }
  | {
      readonly sequence: number;
      readonly type: 'harness.phase.entered';
      readonly businessId: DefHarnessBusinessId | null;
      readonly operation: DefHarnessOperationId | null;
      readonly phaseId: string;
      readonly phaseKind: DefHarnessPhaseKind;
    }
  | {
      readonly sequence: number;
      readonly type: 'harness.tool.projected';
      readonly projectionRevision: number;
      readonly tools: readonly string[];
    }
  | {
      readonly sequence: number;
      readonly type: 'harness.terminal';
      readonly businessId: DefHarnessBusinessId | null;
      readonly operation: DefHarnessOperationId | null;
      readonly phaseId: string;
      readonly terminalState: DefHarnessTerminalState;
      readonly code?: string;
    };

export interface DefHarnessTransition {
  readonly transaction: DefHarnessTransactionSnapshot;
  readonly trace: readonly DefHarnessTraceEntry[];
}
