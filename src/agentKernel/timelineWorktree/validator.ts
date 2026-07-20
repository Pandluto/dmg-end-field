import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import type { AiTimelineValidationIssue, AiTimelineValidationResult } from './types';

function collectTimelineButtonEntries(payload: TimelineSnapshotPayload) {
  return payload.timelineData.staffLines.flatMap((staffLine, staffOffset) => (
    Array.isArray(staffLine.buttons)
      ? staffLine.buttons.map((button, buttonOffset) => ({ button, staffLine, staffOffset, buttonOffset }))
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
  const validSkillTypes = new Set(['A', 'B', 'E', 'Q', 'Dot']);
  const selectedCharacters = new Set(payload.selectedCharacters);
  const staffIndices = new Set<number>();
  for (const [staffOffset, staffLine] of payload.timelineData.staffLines.entries()) {
    if (!Number.isInteger(staffLine.staffIndex) || staffLine.staffIndex < 0 || staffLine.staffIndex >= payload.selectedCharacters.length) {
      issues.push(issue('invalid-staff-index', `Staff line ${staffOffset} has an invalid staffIndex.`, `timelineData.staffLines.${staffOffset}.staffIndex`));
    } else if (staffIndices.has(staffLine.staffIndex)) {
      issues.push(issue('duplicate-staff-index', `Staff line index ${staffLine.staffIndex} appears more than once.`, `timelineData.staffLines.${staffOffset}.staffIndex`));
    } else {
      staffIndices.add(staffLine.staffIndex);
    }
    if (!staffLine.characterName?.trim()) {
      issues.push(issue('invalid-staff-character-name', `Staff line ${staffOffset} has no characterName.`, `timelineData.staffLines.${staffOffset}.characterName`));
    }
  }

  const seenTimelineButtonIds = new Set<string>();
  for (const { button, staffLine, staffOffset, buttonOffset } of timelineButtonEntries) {
    const buttonPath = `timelineData.staffLines.${staffOffset}.buttons.${buttonOffset}`;
    if (seenTimelineButtonIds.has(button.id)) {
      issues.push(issue('duplicate-timeline-button-entry', `Timeline button ${button.id} appears in more than one staff line.`, 'timelineData.staffLines'));
      continue;
    }
    seenTimelineButtonIds.add(button.id);
    const tableButton = payload.skillButtonTable[button.id];
    if (!button.characterId?.trim() || !selectedCharacters.has(button.characterId)) {
      issues.push(issue('invalid-button-character-id', `Timeline button ${button.id} has no selected characterId.`, `${buttonPath}.characterId`));
    }
    if (!button.characterName?.trim() || button.characterName !== staffLine.characterName) {
      issues.push(issue('invalid-button-character-name', `Timeline button ${button.id} does not match its staff line characterName.`, `${buttonPath}.characterName`));
    }
    if (!validSkillTypes.has(button.skillType)) {
      issues.push(issue('invalid-button-skill-type', `Timeline button ${button.id} needs skillType A, B, E, Q, or Dot.`, `${buttonPath}.skillType`));
    }
    const effectiveLineIndex = button.lineIndex ?? button.staffIndex;
    if (button.staffIndex !== staffLine.staffIndex || effectiveLineIndex !== staffLine.staffIndex) {
      issues.push(issue('timeline-button-staff-mismatch', `Timeline button ${button.id} must target persistent line ${staffLine.staffIndex}.`, buttonPath));
    }
    if (payload.selectedCharacters[staffLine.staffIndex] !== button.characterId) {
      issues.push(issue('timeline-button-character-staff-mismatch', `Timeline button ${button.id} character does not match selectedCharacters[${staffLine.staffIndex}].`, `${buttonPath}.characterId`));
    }
    if (!Number.isInteger(button.nodeIndex) || button.nodeIndex < 0) {
      issues.push(issue('invalid-button-node-index', `Timeline button ${button.id} has an invalid nodeIndex.`, `${buttonPath}.nodeIndex`));
    }
    if (tableButton) {
      for (const property of ['id', 'characterId', 'characterName', 'skillType', 'staffIndex', 'nodeIndex', 'nodeNumber'] as const) {
        if (tableButton[property] !== button[property]) {
          issues.push(issue('timeline-button-table-identity-mismatch', `Timeline button ${button.id} ${property} differs from skillButtonTable.`, `${buttonPath}.${property}`));
        }
      }
      if ((tableButton.lineIndex ?? tableButton.staffIndex) !== effectiveLineIndex) {
        issues.push(issue('timeline-button-table-identity-mismatch', `Timeline button ${button.id} lineIndex differs from skillButtonTable.`, `${buttonPath}.lineIndex`));
      }
      const timelineBuffIds = [...(button.buffIds || [])].sort();
      const tableBuffIds = [...(tableButton.selectedBuff || [])].sort();
      if (JSON.stringify(timelineBuffIds) !== JSON.stringify(tableBuffIds)) {
        issues.push(issue('timeline-button-table-buff-mismatch', `Timeline button ${button.id} Buff ids differ from skillButtonTable.`, `${buttonPath}.buffIds`));
      }
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
