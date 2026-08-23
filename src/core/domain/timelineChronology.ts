export type TimelineChronologyItem = {
  id: string;
  nodeIndex: number;
  staffIndex: number;
};

/**
 * Timeline node indices are global across every 15-node visual group.
 * Screen coordinates restart in each group and therefore cannot represent
 * the chronological order used by damage reports.
 */
export function compareTimelineChronology(
  left: TimelineChronologyItem,
  right: TimelineChronologyItem,
): number {
  return (
    left.nodeIndex - right.nodeIndex
    || left.staffIndex - right.staffIndex
    || left.id.localeCompare(right.id)
  );
}
