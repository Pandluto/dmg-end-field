import type {
  CommandId,
  DatabaseGeneration,
  DefSessionId,
  DefTurnId,
  TimelineId,
  ToolCallId,
  WorkspaceId,
} from './ids.ts';
import type { JsonObject, JsonValue } from './json.ts';

export interface ProductBinding {
  readonly workspaceId: WorkspaceId;
  readonly databaseGeneration: DatabaseGeneration;
  readonly timelineId: TimelineId;
  readonly checkoutTargetId: string | null;
  readonly checkoutUpdatedAt: number;
  readonly contentRevision: number;
  readonly snapshotDigest: string;
}

export interface ProductSnapshotEnvelope {
  readonly protocolVersion: 1;
  readonly binding: ProductBinding;
  readonly capturedAt: string;
  readonly payload: JsonObject;
}

export type ProductOperationSchema = Readonly<Record<string, JsonObject>>;

export type ProductOperation<Schema extends ProductOperationSchema> = {
  [Operation in keyof Schema & string]: {
    readonly op: Operation;
    readonly payload: Schema[Operation];
  };
}[keyof Schema & string];

export interface ProductCommandEnvelope<Schema extends ProductOperationSchema> {
  readonly protocolVersion: 1;
  readonly commandId: CommandId;
  readonly defSessionId: DefSessionId;
  readonly defTurnId: DefTurnId;
  readonly toolCallId: ToolCallId;
  readonly expected: ProductBinding;
  readonly command: ProductOperation<Schema>;
  readonly approvalCapability?: string;
}

export interface ProductCommandReceipt {
  readonly commandId: CommandId;
  readonly status: 'queued' | 'dispatched' | 'claimed' | 'reconciling';
  readonly acceptedAt: string;
}

export type ProductCommandResultStatus =
  | 'succeeded'
  | 'committed'
  | 'not-executed'
  | 'rejected'
  | 'conflict'
  | 'error'
  | 'orphaned';

export interface ProductCommandResult {
  readonly commandId: CommandId;
  readonly status: ProductCommandResultStatus;
  readonly code?: string;
  readonly message?: string;
  readonly beforeRevision: number | null;
  readonly afterRevision: number | null;
  readonly browserResult?: JsonValue;
  readonly visiblePostcondition?: JsonValue;
  readonly executorLeaseId?: string;
  readonly completedAt: string;
}

export interface ProductWaitOptions {
  readonly timeoutMs?: number;
}

export interface ProductCommandCancelOptions {
  readonly code?: string;
  readonly message?: string;
}

export interface ProductGateway<Schema extends ProductOperationSchema> {
  getSnapshot(binding: ProductBinding): Promise<ProductSnapshotEnvelope>;
  dispatch(command: ProductCommandEnvelope<Schema>): Promise<ProductCommandReceipt>;
  awaitResult(commandId: CommandId, options?: ProductWaitOptions): Promise<ProductCommandResult>;
  reconcile(commandId: CommandId): Promise<ProductCommandResult | null>;
  /**
   * Atomically terminalize commands that have not yet been delivered to a
   * Product consumer. Once delivery starts, the Product owns completion and
   * the Host must reconcile its receipt instead of pretending it was stopped.
   */
  cancelPending?(
    defTurnId: DefTurnId,
    options?: ProductCommandCancelOptions,
  ): Promise<readonly ProductCommandResult[]>;
}
