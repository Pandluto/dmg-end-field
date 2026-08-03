import type {
  PersistedSkillButton,
  SkillButtonPanelConfig,
} from '../../types/storage';

function withoutBuffId(ids: string[] | undefined, buffId: string): string[] {
  return (ids ?? []).filter((id) => id !== buffId);
}

function pruneDisabledBuffMap(
  source: Record<string, string[]> | undefined,
  buffId: string,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(source ?? {}).flatMap(([segmentKey, buffIds]) => {
      const remainingIds = withoutBuffId(buffIds, buffId);
      return remainingIds.length > 0 ? [[segmentKey, remainingIds] as const] : [];
    }),
  );
}

function pruneStackCountMap(
  source: Record<string, Record<string, number>> | undefined,
  buffId: string,
): Record<string, Record<string, number>> {
  return Object.fromEntries(
    Object.entries(source ?? {}).flatMap(([segmentKey, stackCounts]) => {
      const remainingCounts = Object.fromEntries(
        Object.entries(stackCounts).filter(([id]) => id !== buffId),
      );
      return Object.keys(remainingCounts).length > 0
        ? [[segmentKey, remainingCounts] as const]
        : [];
    }),
  );
}

function detachPanelConfig(
  source: SkillButtonPanelConfig | undefined,
  nextSelectedBuff: string[],
  buffId: string,
): SkillButtonPanelConfig {
  const next: SkillButtonPanelConfig = {
    ...(source ?? { selectedBuff: [] }),
    selectedBuff: nextSelectedBuff,
  };

  if (source?.globallyDisabledBuffIds !== undefined) {
    next.globallyDisabledBuffIds = withoutBuffId(source.globallyDisabledBuffIds, buffId);
  }
  if (source?.manualDisabledBuffIdsBySegmentKey !== undefined) {
    next.manualDisabledBuffIdsBySegmentKey = pruneDisabledBuffMap(
      source.manualDisabledBuffIdsBySegmentKey,
      buffId,
    );
  }
  if (source?.manualBuffStackCountsBySegmentKey !== undefined) {
    next.manualBuffStackCountsBySegmentKey = pruneStackCountMap(
      source.manualBuffStackCountsBySegmentKey,
      buffId,
    );
  }

  return next;
}

/** Detach one Buff and remove every persisted panel override keyed by its identity. */
export function detachBuffFromSkillButton(
  button: PersistedSkillButton,
  buffId: string,
): PersistedSkillButton {
  const selectedBuff = withoutBuffId(button.selectedBuff, buffId);
  const buffStackCounts = button.buffStackCounts
    ? Object.fromEntries(Object.entries(button.buffStackCounts).filter(([id]) => id !== buffId))
    : undefined;

  return {
    ...button,
    selectedBuff,
    buffStackCounts,
    panelConfig: detachPanelConfig(button.panelConfig, selectedBuff, buffId),
  };
}
