import type { DefSessionId, DefTurnId } from './ids.ts';
import type { EngineToolProjectionInput } from './engine.ts';

export const DEF_HARNESS_STATE_VERSION = 2 as const;

export type DefHarnessBusinessId =
  | 'conversation'
  | 'selection'
  | 'loadout'
  | 'timeline'
  | 'buff'
  | 'calculation';

export type DefHarnessOperationId =
  | 'respond'
  | 'ask'
  | 'inspect'
  | 'search'
  | 'add'
  | 'remove'
  | 'replace'
  | 'reorder'
  | 'analyze'
  | 'apply'
  | 'evaluate'
  | 'resolve'
  | 'recommend'
  | 'recommend_named_set'
  | 'recommend_discovered_set'
  | 'recommend_weapon'
  | 'recommend_equipment'
  | 'compare'
  | 'preview'
  | 'restore'
  | 'current'
  | 'move'
  | 'copy'
  | 'validate'
  | 'source'
  | 'batch'
  | 'stack'
  | 'coverage'
  | 'calculate'
  | 'aggregate'
  | 'attribute'
  | 'diagnose'
  | 'export'
  | 'explain'
  | 'skill_fact';

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

export interface DefHarnessPlanStep {
  readonly businessId: DefHarnessBusinessId;
  readonly operation: DefHarnessOperationId;
}

export interface DefHarnessSingleRouteInput extends DefHarnessPlanStep {}

export interface DefHarnessPlanRouteInput {
  readonly steps: readonly DefHarnessPlanStep[];
}

export type DefHarnessRouteInput = DefHarnessSingleRouteInput | DefHarnessPlanRouteInput;

export interface DefHarnessPlannedStep extends DefHarnessPlanStep {
  readonly index: number;
  readonly revision: DefHarnessRevisionRef;
}

export interface DefHarnessCompletedPlanStep extends DefHarnessPlannedStep {}

export interface DefHarnessPlanSnapshot {
  readonly steps: readonly DefHarnessPlannedStep[];
  /** Zero-based active step, or steps.length after successful completion. */
  readonly currentIndex: number;
  readonly completedSteps: readonly DefHarnessCompletedPlanStep[];
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
  readonly plan: DefHarnessPlanSnapshot | null;
}

export type DefHarnessPlanTraceEvent =
  | {
      readonly type: 'plan.created';
      readonly steps: readonly DefHarnessPlannedStep[];
      readonly currentIndex: number;
    }
  | {
      readonly type: 'step.completed';
      readonly step: DefHarnessCompletedPlanStep;
    }
  | {
      readonly type: 'step.failed';
      readonly stepIndex: number;
      readonly step: DefHarnessPlanStep;
      readonly revision: DefHarnessRevisionRef;
      readonly code?: string;
    };

export type DefHarnessTraceEntry =
  | {
      readonly sequence: number;
      readonly type: 'harness.routed';
      readonly businessId: DefHarnessBusinessId;
      readonly operation: DefHarnessOperationId;
      readonly revision: DefHarnessRevisionRef;
      readonly planEvents?: readonly DefHarnessPlanTraceEvent[];
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
      readonly planEvents?: readonly DefHarnessPlanTraceEvent[];
    };

export interface DefHarnessTransition {
  readonly transaction: DefHarnessTransactionSnapshot;
  readonly trace: readonly DefHarnessTraceEntry[];
}
