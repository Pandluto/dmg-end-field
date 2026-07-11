import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import type { AiTimelineValidationIssue, AiTimelineValidationResult } from './types';

function collectTimelineButtonEntries(payload: TimelineSnapshotPayload) {
  return payload.timelineData.staffLines.flatMap((staffLine) => (
    Array.isArray(staffLine.buttons)
      ? staffLine.buttons.map((button) => ({ button, staffIndex: button.staffIndex }))
      : []
  ));
}

function issue(code: string, message: string, path?: string): AiTimelineValidationIssue {
  return { code, message, path };
}

export function validateTimelinePayload(payload: TimelineSnapshotPayload): AiTimelineValidationResult {
  const issues: AiTimelineValidationIssue[] = [];
  if (!Array.isArray(payload.selectedCharacters)) {
    issues.push(issue('invalid-selected-characters', 'selectedCharacters must be an array.', 'selectedCharacters'));
  }
  if (!payload.timelineData || !Array.isArray(payload.timelineData.staffLines)) {
    issues.push(issue('invalid-timeline-data', 'timelineData.staffLines must be an array.', 'timelineData.staffLines'));
  }
  if (!payload.skillButtonTable || typeof payload.skillButtonTable !== 'object') {
    issues.push(issue('invalid-skill-button-table', 'skillButtonTable must be an object.', 'skillButtonTable'));
  }
  if (!Array.isArray(payload.allBuffList)) {
    issues.push(issue('invalid-buff-list', 'allBuffList must be an array.', 'allBuffList'));
  }
  if (issues.length) return { ok: false, issues };

  const timelineButtonEntries = collectTimelineButtonEntries(payload);
  const timelineButtonIds = new Set(timelineButtonEntries.map(({ button }) => button.id));
  const tableButtonIds = new Set(Object.keys(payload.skillButtonTable));
  for (const buttonId of timelineButtonIds) {
    if (!tableButtonIds.has(buttonId)) {
      issues.push(issue('timeline-button-missing-table-entry', `Timeline button ${buttonId} is missing from skillButtonTable.`, `skillButtonTable.${buttonId}`));
    }
  }
  for (const buttonId of tableButtonIds) {
    if (!timelineButtonIds.has(buttonId)) {
      issues.push(issue('table-button-missing-timeline-entry', `skillButtonTable button ${buttonId} is missing from timelineData.`, `timelineData.${buttonId}`));
    }
  }
  const seenTimelineButtonIds = new Set<string>();
  for (const { button, staffIndex } of timelineButtonEntries) {
    if (seenTimelineButtonIds.has(button.id)) {
      issues.push(issue('duplicate-timeline-button-entry', `Timeline button ${button.id} appears in more than one staff line.`, 'timelineData.staffLines'));
      continue;
    }
    seenTimelineButtonIds.add(button.id);
    const tableButton = payload.skillButtonTable[button.id];
    if (tableButton && tableButton.staffIndex !== staffIndex) {
      issues.push(issue('timeline-button-staff-mismatch', `Timeline button ${button.id} is on staff ${staffIndex}, but its table entry targets staff ${tableButton.staffIndex}.`, 'timelineData.staffLines'));
    }
  }

  const buffIds = new Set(payload.allBuffList.map((buff) => buff.id));
  for (const [buttonId, button] of Object.entries(payload.skillButtonTable)) {
    for (const buffId of button.selectedBuff || []) {
      if (!buffIds.has(buffId)) {
        issues.push(issue('button-selected-buff-missing', `Button ${buttonId} references missing Buff ${buffId}.`, `skillButtonTable.${buttonId}.selectedBuff`));
      }
    }
  }

  return issues.length ? { ok: false, issues } : { ok: true, issues: [] };
}
