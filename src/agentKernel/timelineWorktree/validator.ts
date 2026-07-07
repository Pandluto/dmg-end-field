import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import type { AiTimelineValidationIssue, AiTimelineValidationResult } from './types';

function collectTimelineButtonIds(payload: TimelineSnapshotPayload) {
  return new Set(payload.timelineData.staffLines.flatMap((staffLine) => (
    Array.isArray(staffLine.buttons) ? staffLine.buttons.map((button) => button.id) : []
  )));
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

  const timelineButtonIds = collectTimelineButtonIds(payload);
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
