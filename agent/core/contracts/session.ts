import type { EngineSessionRef } from './engine.ts';
import type {
  DatabaseGeneration,
  DefSessionId,
  TimelineId,
  WorkspaceId,
} from './ids.ts';

export const DEF_SESSION_SCHEMA_VERSION = 6 as const;
export const DEF_EVENT_SCHEMA_VERSION = 1 as const;

export type DefSessionStatus =
  | 'binding-pending'
  | 'creating'
  | 'create-failed'
  | 'ready'
  | 'engine-unavailable'
  | 'archived'
  | 'binding-missing'
  | 'orphaned'
  | 'deleting'
  | 'delete-failed';

export interface DefSessionHarnessBinding {
  readonly stateVersion: number;
  readonly revision: string;
}

export interface DefSessionV6 {
  readonly schemaVersion: typeof DEF_SESSION_SCHEMA_VERSION;
  readonly eventSchemaVersion: typeof DEF_EVENT_SCHEMA_VERSION;
  readonly defSessionId: DefSessionId;
  readonly host: 'workbench';
  readonly status: DefSessionStatus;
  readonly workspaceId: WorkspaceId;
  readonly lastDatabaseGeneration: DatabaseGeneration;
  readonly timelineId: TimelineId;
  readonly axisBindingId: string | null;
  readonly boundNodeId: string | null;
  readonly engine: EngineSessionRef;
  readonly harness: DefSessionHarnessBinding;
  readonly createdAt: string;
  readonly updatedAt: string;
}
