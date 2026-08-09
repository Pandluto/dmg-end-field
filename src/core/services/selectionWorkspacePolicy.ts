export type SelectionWorkspaceTransition =
  | 'unchanged'
  | 'horizontal-branch'
  | 'new-temporary-workspace';

function normalizeRosterIds(characterIds: string[]): string[] {
  return characterIds
    .map((characterId) => String(characterId || '').trim())
    .filter(Boolean);
}

export function classifySelectionWorkspaceTransition(
  previousCharacterIds: string[],
  nextCharacterIds: string[],
): SelectionWorkspaceTransition {
  const previous = normalizeRosterIds(previousCharacterIds);
  const next = normalizeRosterIds(nextCharacterIds);

  if (previous.length === next.length && previous.every((characterId, index) => characterId === next[index])) {
    return 'unchanged';
  }

  if (previous.length === 0) {
    return 'new-temporary-workspace';
  }

  const previousSet = new Set(previous);
  const hasSharedCharacter = next.some((characterId) => previousSet.has(characterId));

  return hasSharedCharacter ? 'horizontal-branch' : 'new-temporary-workspace';
}

export function resolveSelectionHorizontalParentId(
  checkoutNodeId: string | null,
  checkoutNodeParentId: string | null | undefined,
): string | null {
  if (!checkoutNodeId) return null;
  return checkoutNodeParentId?.trim() || null;
}
