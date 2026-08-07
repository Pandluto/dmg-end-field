import type { EngineToolDescriptor, EngineToolRisk } from './engine.ts';
import type { DefSessionId, DefTurnId, ToolCallId } from './ids.ts';
import type { JsonObject, JsonValue } from './json.ts';
import type { ProductBinding, ProductSnapshotEnvelope } from './product.ts';
import type {
  DefPreparedWorkNodeCandidateRefV1,
  PreparedWorkNodeScope,
} from './prepared-work-node.ts';

export interface DefToolDescriptor extends EngineToolDescriptor {
  readonly risk: EngineToolRisk;
}

/**
 * The only identity a later Turn may submit for a prepared proposal.  The
 * candidate payload, review and source checkout are deliberately absent: the
 * Host resolves those from the completed Turn journal before it can create an
 * approval request.
 */
export type DefPreparedProposalIdentityV1 = Pick<
  DefPreparedWorkNodeCandidateRefV1,
  'proposalId' | 'nodeId' | 'nodeRevision' | 'proposalDigest'
>;

export interface DefProductSnapshotReader {
  getSnapshot(binding: ProductBinding): Promise<ProductSnapshotEnvelope>;
}

export interface DefToolExecutionContext {
  readonly defSessionId: DefSessionId;
  readonly defTurnId: DefTurnId;
  readonly toolCallId: ToolCallId;
  readonly binding: ProductBinding;
  readonly product: DefProductSnapshotReader;
  readonly abortSignal: AbortSignal;
}

export interface DefToolHandler {
  readonly descriptor: DefToolDescriptor;
  execute(input: JsonValue, context: DefToolExecutionContext): Promise<JsonValue>;
}

export type DefInteractiveToolPlan =
  | {
      readonly kind: 'question';
      readonly prompt: string;
      readonly details?: JsonObject;
    }
  | {
      readonly kind: 'command';
      readonly command: JsonObject;
      readonly visiblePostcondition?: JsonObject;
    }
  | {
      readonly kind: 'mutation';
      readonly prompt: string;
      readonly proposal: JsonValue;
      readonly scope: readonly string[];
      readonly command: JsonObject;
      readonly followUp?: 'checkout-prepared-work-node';
      readonly visiblePostcondition?: JsonObject;
    }
  | {
      /**
       * A Host-mediated proposal flow. The initial plan describes how the
       * Product should prepare the candidate; the candidate itself is returned
       * by that Product command and is never supplied by the Engine.
       */
      readonly kind: 'prepared-mutation';
      readonly prompt: string;
      readonly scope: readonly PreparedWorkNodeScope[];
      readonly prepareCommand: JsonObject;
      readonly applyOperation: 'applyReviewedWorkNodeProposal';
      readonly cleanupOperation: 'abandonPreparedWorkNodeProposal';
      readonly visiblePostcondition?: JsonObject;
    }
  | {
      /**
       * Prepare an isolated Timeline Work Node without asking for approval.
       * The complete proposal is returned to the Engine and persisted in the
       * completed Turn journal for a later apply/reject/revise action.
       */
      readonly kind: 'prepared-preview';
      readonly prompt: string;
      readonly scope: readonly PreparedWorkNodeScope[];
      readonly prepareCommand: JsonObject;
      readonly cleanupOperation: 'abandonPreparedWorkNodeProposal';
    }
  | {
      /**
       * Apply a prepared proposal from a previous completed Turn.  The
       * identity is model-supplied, but the Host resolves the full candidate
       * and review from history before creating a fresh Approval V2 request.
       */
      readonly kind: 'prepared-history-apply';
      readonly prompt: string;
      readonly identity: DefPreparedProposalIdentityV1;
      readonly intent: 'timeline';
      readonly applyOperation: 'applyReviewedWorkNodeProposal';
      readonly cleanupOperation: 'abandonPreparedWorkNodeProposal';
    }
  | {
      /**
       * Reject and delete a prepared proposal from a previous completed Turn.
       * This is an explicit cleanup operation and never opens a second
       * approval interaction.
       */
      readonly kind: 'prepared-history-reject';
      readonly prompt: string;
      readonly identity: DefPreparedProposalIdentityV1;
      readonly intent: 'timeline';
      readonly cleanupOperation: 'abandonPreparedWorkNodeProposal';
    }
  | {
      /**
       * Replace a previous preview.  The Host must resolve and clean the
       * superseded candidate before dispatching this new prepare command.
       */
      readonly kind: 'prepared-history-revise';
      readonly prompt: string;
      readonly superseded: DefPreparedProposalIdentityV1;
      readonly intent: 'timeline';
      readonly scope: readonly PreparedWorkNodeScope[];
      readonly prepareCommand: JsonObject;
      readonly cleanupOperation: 'abandonPreparedWorkNodeProposal';
    };

export interface DefInteractiveToolHandler {
  readonly descriptor: DefToolDescriptor;
  prepare(input: JsonValue, context: DefToolExecutionContext): Promise<DefInteractiveToolPlan>;
}

export interface DefWorkbenchToolRegistry {
  listDescriptors(): readonly DefToolDescriptor[];
  resolveDescriptor(name: string): DefToolDescriptor | null;
  executeRead(name: string, input: JsonValue, context: DefToolExecutionContext): Promise<JsonValue>;
  prepareInteractive(
    name: string,
    input: JsonValue,
    context: DefToolExecutionContext,
  ): Promise<DefInteractiveToolPlan>;
}

export type DefToolErrorCode =
  | 'DEF_TOOL_UNSUPPORTED'
  | 'DEF_TOOL_INPUT_INVALID'
  | 'DEF_TOOL_PRODUCT_SNAPSHOT_INVALID'
  | 'DEF_DAMAGE_REPORT_UNAVAILABLE'
  | 'DEF_INTERACTION_REJECTED'
  | 'DEF_INTERACTION_CANCELLED'
  | 'DEF_INTERACTION_EXPIRED'
  | 'DEF_INTERACTION_STALE'
  | 'DEF_PRODUCT_COMMAND_FAILED'
  | 'DEF_TOOL_ABORTED';

export class DefToolExecutionError extends Error {
  readonly code: DefToolErrorCode;
  readonly details?: JsonValue;

  constructor(
    code: DefToolErrorCode,
    message: string,
    details?: JsonValue,
  ) {
    super(message);
    this.name = 'DefToolExecutionError';
    this.code = code;
    this.details = details;
  }
}
