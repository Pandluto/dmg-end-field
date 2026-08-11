import type { TimelineData } from '../../types';
import type { SkillButtonTable } from '../../types/storage';

export type TimelineButtonBuffMirrorResult = {
  timelineData: TimelineData;
  changed: boolean;
  repairedButtonIds: string[];
};

function sameBuffIds(left: string[] | undefined, right: string[]): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right);
}

/**
 * skillButtonTable is the authoritative owner of a button's Buff references.
 * timelineData keeps a compact mirror for exports and validation; update only
 * that mirror without touching button identity, placement, or other runtime data.
 */
export function synchronizeTimelineButtonBuffMirrors(
  timelineData: TimelineData,
  skillButtonTable: SkillButtonTable,
  updatedAt = Date.now(),
): TimelineButtonBuffMirrorResult {
  const repairedButtonIds: string[] = [];
  if (!Array.isArray(timelineData.staffLines)) {
    return { timelineData, changed: false, repairedButtonIds };
  }
  const staffLines = timelineData.staffLines.map((staffLine) => {
    if (!Array.isArray(staffLine.buttons)) return staffLine;
    let lineChanged = false;
    const buttons = staffLine.buttons.map((button) => {
      const persistedButton = skillButtonTable[button.id];
      if (!persistedButton) return button;
      const selectedBuff = [...(persistedButton.selectedBuff ?? [])];
      if (sameBuffIds(button.buffIds, selectedBuff)) return button;
      lineChanged = true;
      repairedButtonIds.push(button.id);
      return { ...button, buffIds: selectedBuff };
    });
    return lineChanged ? { ...staffLine, buttons } : staffLine;
  });

  if (repairedButtonIds.length === 0) {
    return { timelineData, changed: false, repairedButtonIds };
  }
  return {
    timelineData: { ...timelineData, updatedAt, staffLines },
    changed: true,
    repairedButtonIds,
  };
}
