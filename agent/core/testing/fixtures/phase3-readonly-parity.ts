import type {
  DefHarnessBusinessId,
  DefHarnessOperationId,
} from '../../contracts/index.ts';

export interface Phase3ReadonlyParityCase {
  readonly businessId: DefHarnessBusinessId;
  readonly operation: DefHarnessOperationId;
  readonly sourceLineage: string;
  readonly toolSequence: readonly string[];
}

// Recorded from codex/def-opencode-spec9-2-implementation@bcea5f12.
// This fixture preserves only the Phase 3 read-only vertical slices; it is not
// evidence that the old branch's mutation or recommendation paths were valid.
export const PHASE3_READONLY_PARITY_CASES = [
  {
    businessId: 'selection',
    operation: 'inspect',
    sourceLineage: 'selection@v1',
    toolSequence: ['def.node.crud.context'],
  },
  {
    businessId: 'loadout',
    operation: 'inspect',
    sourceLineage: 'loadout@v4',
    toolSequence: ['def.data.resource.team_loadouts'],
  },
  {
    businessId: 'timeline',
    operation: 'current',
    sourceLineage: 'timeline@v13',
    toolSequence: ['def.node.crud.current'],
  },
  {
    businessId: 'buff',
    operation: 'resolve',
    sourceLineage: 'buff@v1',
    toolSequence: ['def.data.resource.buff'],
  },
  {
    businessId: 'calculation',
    operation: 'calculate',
    sourceLineage: 'calculation@v1',
    toolSequence: ['def.node.crud.context', 'def.data.resource.damage'],
  },
] as const satisfies readonly Phase3ReadonlyParityCase[];
