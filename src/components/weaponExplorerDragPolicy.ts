import type { WeaponSkillKey } from './weaponDraftCatalog';
import {
  moveRecordEntry,
  type WeaponDraft,
  type WeaponEffectBucket,
} from './weaponDraftModel';

export type WeaponExplorerDragNode =
  | {
      kind: 'draft';
      draftId: string;
    }
  | {
      kind: 'skill';
      draftId: string;
      skillKey: WeaponSkillKey;
    }
  | {
      kind: 'effect';
      draftId: string;
      skillKey: WeaponSkillKey;
      bucket: WeaponEffectBucket;
      effectKey: string;
    };

export interface WeaponExplorerDragPolicyState {
  filterKeyword: string;
}

export interface WeaponExplorerReorderResult {
  nextLibrary: Record<string, WeaponDraft>;
  nextDraft: WeaponDraft;
  shouldUpdateCurrentDraft: boolean;
}

export function getWeaponExplorerDragNodeKey(node: WeaponExplorerDragNode): string {
  if (node.kind === 'draft') {
    return `draft:${node.draftId}`;
  }
  if (node.kind === 'skill') {
    return `skill:${node.draftId}:${node.skillKey}`;
  }
  return `effect:${node.draftId}:${node.skillKey}:${node.bucket}:${node.effectKey}`;
}

export function getWeaponExplorerDragNodeLabel(
  library: Readonly<Record<string, WeaponDraft>>,
  node: WeaponExplorerDragNode,
): string {
  const targetDraft = library[node.draftId];
  if (!targetDraft) {
    return node.draftId;
  }
  if (node.kind === 'draft') {
    return targetDraft.name || node.draftId;
  }

  const targetSkill = targetDraft.skills?.[node.skillKey];
  if (!targetSkill) {
    return node.kind === 'skill' ? node.skillKey : node.effectKey;
  }
  if (node.kind === 'skill') {
    return targetSkill.name || node.skillKey;
  }
  if (node.bucket === 'value') {
    return node.effectKey;
  }
  return targetSkill.effects?.[node.effectKey]?.name || node.effectKey;
}

export function canStartWeaponExplorerDrag(
  node: WeaponExplorerDragNode,
  state: WeaponExplorerDragPolicyState,
): boolean {
  if (state.filterKeyword.trim()) {
    return false;
  }
  return node.kind === 'effect' && node.skillKey === 'skill3' && node.bucket === 'effect';
}

export function isValidWeaponExplorerDropTarget(
  source: WeaponExplorerDragNode,
  target: WeaponExplorerDragNode | null,
  state: WeaponExplorerDragPolicyState,
): boolean {
  if (!target || source.kind !== target.kind) {
    return false;
  }
  if (getWeaponExplorerDragNodeKey(source) === getWeaponExplorerDragNodeKey(target)) {
    return false;
  }
  if (source.kind !== 'effect' || target.kind !== 'effect') {
    return false;
  }
  return canStartWeaponExplorerDrag(source, state)
    && canStartWeaponExplorerDrag(target, state)
    && source.draftId === target.draftId
    && source.skillKey === target.skillKey
    && source.bucket === target.bucket
    && source.bucket === 'effect';
}

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function reorderWeaponExplorerLibrary(
  library: Record<string, WeaponDraft>,
  currentDraft: WeaponDraft | null | undefined,
  activeDraftKey: string,
  source: WeaponExplorerDragNode,
  target: WeaponExplorerDragNode | null,
): WeaponExplorerReorderResult | null {
  const policyState: WeaponExplorerDragPolicyState = { filterKeyword: '' };
  if (!isValidWeaponExplorerDropTarget(source, target, policyState) || source.kind !== 'effect' || !target || target.kind !== 'effect') {
    return null;
  }

  const shouldUpdateCurrentDraft = Boolean(currentDraft && activeDraftKey === source.draftId);
  const targetDraft = shouldUpdateCurrentDraft ? currentDraft : library[source.draftId];
  if (!targetDraft) {
    return null;
  }

  const targetSkill = targetDraft.skills?.[source.skillKey];
  if (!targetSkill || !targetSkill.effects || !hasOwn(targetSkill.effects, source.effectKey) || !hasOwn(targetSkill.effects, target.effectKey)) {
    return null;
  }

  const nextEffects = moveRecordEntry(targetSkill.effects, source.effectKey, target.effectKey);

  const nextDraft: WeaponDraft = {
    ...targetDraft,
    skills: {
      ...targetDraft.skills,
      [source.skillKey]: {
        ...targetSkill,
        effects: nextEffects,
      },
    },
  };

  return {
    nextLibrary: {
      ...library,
      [source.draftId]: nextDraft,
    },
    nextDraft,
    shouldUpdateCurrentDraft,
  };
}
