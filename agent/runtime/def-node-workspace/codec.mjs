import crypto from 'node:crypto'

export const DEF_NODE_SOURCE_SCHEMA_VERSION = 1
const DEF_SKILL_TYPES = new Set(['A', 'B', 'E', 'Q', 'Dot'])

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

export function hashDefNodeValue(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function tableButtonForTimeline(button) {
  return Object.fromEntries(Object.entries({
    id: button.id,
    characterId: button.characterId,
    characterName: button.characterName,
    skillType: button.skillType,
    staffIndex: button.staffIndex,
    lineIndex: button.lineIndex,
    nodeIndex: button.nodeIndex,
    nodeNumber: button.nodeNumber,
    position: button.position,
    runtimeSkillId: button.runtimeSkillId,
    skillDisplayName: button.skillDisplayName,
    skillIconUrl: button.skillIconUrl,
    customHits: button.customHits,
    buffIds: [...(Array.isArray(button.selectedBuff) ? button.selectedBuff : [])],
  }).filter(([, value]) => value !== undefined))
}

export function decodeDefNodePayload(payload) {
  const table = payload?.skillButtonTable && typeof payload.skillButtonTable === 'object'
    ? payload.skillButtonTable
    : {}
  const staffLines = (Array.isArray(payload?.timelineData?.staffLines) ? payload.timelineData.staffLines : []).map((line) => ({
    staffIndex: line.staffIndex,
    characterName: line.characterName,
    buttons: (Array.isArray(line.buttons) ? line.buttons : [])
      .map((button) => table[button.id] || button)
      .map((button) => ({
        ...clone(button),
        lineIndex: Number.isInteger(button?.lineIndex) ? button.lineIndex : line.staffIndex,
      }))
      .sort((left, right) => (left.nodeIndex ?? 0) - (right.nodeIndex ?? 0)),
  }))
  return {
    schemaVersion: DEF_NODE_SOURCE_SCHEMA_VERSION,
    selection: { selectedCharacters: clone(payload?.selectedCharacters || []) },
    timeline: {
      schemaVersion: DEF_NODE_SOURCE_SCHEMA_VERSION,
      version: payload?.timelineData?.version || '1.0',
      createdAt: payload?.timelineData?.createdAt || Date.now(),
      staffLines,
    },
    buffs: { allBuffList: clone(payload?.allBuffList || []) },
    inputs: {
      characterInputMap: clone(payload?.characterInputMap || {}),
      operatorConfigPageCache: clone(payload?.operatorConfigPageCache || {}),
    },
  }
}

export function validateDefNodeSource(source) {
  const issues = []
  if (!source || typeof source !== 'object') return [{ code: 'source-not-object', path: '', message: 'Node source must be an object.' }]
  if (source.schemaVersion !== DEF_NODE_SOURCE_SCHEMA_VERSION) {
    issues.push({ code: 'source-schema-version', path: 'schemaVersion', message: `Expected source schema ${DEF_NODE_SOURCE_SCHEMA_VERSION}.` })
  }
  if (!Array.isArray(source.selection?.selectedCharacters)) {
    issues.push({ code: 'selection-invalid', path: 'selection.selectedCharacters', message: 'selectedCharacters must be an array.' })
  }
  if (!Array.isArray(source.timeline?.staffLines)) {
    issues.push({ code: 'timeline-invalid', path: 'timeline.staffLines', message: 'staffLines must be an array.' })
    return issues
  }
  if (!Array.isArray(source.buffs?.allBuffList)) {
    issues.push({ code: 'buffs-invalid', path: 'buffs.allBuffList', message: 'allBuffList must be an array.' })
  }
  const selectedCharacters = Array.isArray(source.selection?.selectedCharacters) ? source.selection.selectedCharacters : []
  const selectedCharacterIds = new Set()
  for (const [characterOffset, characterId] of selectedCharacters.entries()) {
    const path = `selection.selectedCharacters.${characterOffset}`
    if (typeof characterId !== 'string' || !characterId.trim()) {
      issues.push({ code: 'selected-character-id-invalid', path, message: 'Every selected character needs a non-empty stable id.' })
      continue
    }
    if (selectedCharacterIds.has(characterId)) issues.push({ code: 'selected-character-id-duplicate', path, message: `Duplicate selected character id ${characterId}.` })
    selectedCharacterIds.add(characterId)
  }
  const buttonIds = new Set()
  const staffSlots = new Set()
  const staffIndices = new Set()
  for (const [staffOffset, staff] of source.timeline.staffLines.entries()) {
    const staffPath = `timeline.staffLines.${staffOffset}`
    if (!Number.isInteger(staff?.staffIndex) || staff.staffIndex < 0) {
      issues.push({ code: 'staff-index-invalid', path: `${staffPath}.staffIndex`, message: 'staffIndex must be a non-negative integer.' })
    } else {
      if (staffIndices.has(staff.staffIndex)) issues.push({ code: 'staff-index-duplicate', path: `${staffPath}.staffIndex`, message: `Duplicate staffIndex ${staff.staffIndex}.` })
      staffIndices.add(staff.staffIndex)
      if (staff.staffIndex >= selectedCharacters.length) issues.push({ code: 'staff-index-out-of-range', path: `${staffPath}.staffIndex`, message: `staffIndex ${staff.staffIndex} does not resolve to a selected character.` })
    }
    if (typeof staff?.characterName !== 'string' || !staff.characterName.trim()) {
      issues.push({ code: 'staff-character-name-invalid', path: `${staffPath}.characterName`, message: 'Every staff line needs a non-empty characterName.' })
    }
    if (!Array.isArray(staff?.buttons)) {
      issues.push({ code: 'staff-buttons-invalid', path: `${staffPath}.buttons`, message: 'buttons must be an array.' })
      continue
    }
    for (const [buttonOffset, button] of staff.buttons.entries()) {
      const path = `${staffPath}.buttons.${buttonOffset}`
      if (!button?.id || typeof button.id !== 'string') {
        issues.push({ code: 'button-id-invalid', path: `${path}.id`, message: 'Every button needs a stable string id.' })
        continue
      }
      if (buttonIds.has(button.id)) issues.push({ code: 'button-id-duplicate', path: `${path}.id`, message: `Duplicate button id ${button.id}.` })
      buttonIds.add(button.id)
      if (!Number.isInteger(button.nodeIndex) || button.nodeIndex < 0) {
        issues.push({ code: 'button-slot-invalid', path: `${path}.nodeIndex`, message: 'nodeIndex must be a non-negative integer.' })
      }
      if (typeof button.characterId !== 'string' || !button.characterId.trim()) {
        issues.push({ code: 'button-character-id-invalid', path: `${path}.characterId`, message: 'Every button needs a non-empty stable characterId.' })
      } else if (!selectedCharacterIds.has(button.characterId)) {
        issues.push({ code: 'button-character-not-selected', path: `${path}.characterId`, message: `Button character ${button.characterId} is not selected.` })
      }
      if (typeof button.characterName !== 'string' || !button.characterName.trim()) {
        issues.push({ code: 'button-character-name-invalid', path: `${path}.characterName`, message: 'Every button needs a non-empty characterName.' })
      } else if (typeof staff.characterName === 'string' && staff.characterName.trim() && button.characterName !== staff.characterName) {
        issues.push({ code: 'button-character-name-mismatch', path: `${path}.characterName`, message: `Button characterName ${button.characterName} does not match its staff line ${staff.characterName}.` })
      }
      if (!DEF_SKILL_TYPES.has(button.skillType)) {
        issues.push({ code: 'button-skill-type-invalid', path: `${path}.skillType`, message: 'skillType must be one of A, B, E, Q, or Dot; skillKey is not a substitute.' })
      }
      if (!Number.isInteger(button.staffIndex) || button.staffIndex !== staff.staffIndex) {
        issues.push({ code: 'button-staff-index-mismatch', path: `${path}.staffIndex`, message: `Button staffIndex must equal its staff line index ${staff.staffIndex}.` })
      }
      if (!Number.isInteger(button.lineIndex) || button.lineIndex !== staff.staffIndex) {
        issues.push({ code: 'button-line-index-mismatch', path: `${path}.lineIndex`, message: `Button lineIndex must equal its persistent staff line index ${staff.staffIndex}.` })
      }
      if (Number.isInteger(staff.staffIndex) && typeof button.characterId === 'string'
        && selectedCharacters[staff.staffIndex] !== button.characterId) {
        issues.push({ code: 'button-character-staff-mismatch', path: `${path}.characterId`, message: `Button character ${button.characterId} does not match selectedCharacters[${staff.staffIndex}].` })
      }
      const slot = `${staff.staffIndex}:${button.nodeIndex}`
      if (staffSlots.has(slot)) issues.push({ code: 'button-slot-conflict', path, message: `More than one button occupies staff ${staff.staffIndex}, slot ${button.nodeIndex}.` })
      staffSlots.add(slot)
    }
  }
  const buffIds = new Set((source.buffs?.allBuffList || []).map((buff) => buff?.id).filter(Boolean))
  for (const [staffOffset, staff] of source.timeline.staffLines.entries()) {
    for (const [buttonOffset, button] of (staff.buttons || []).entries()) {
      for (const buffId of Array.isArray(button.selectedBuff) ? button.selectedBuff : []) {
        if (!buffIds.has(buffId)) issues.push({
          code: 'button-buff-missing',
          path: `timeline.staffLines.${staffOffset}.buttons.${buttonOffset}.selectedBuff`,
          message: `Button ${button.id} references missing Buff ${buffId}.`,
        })
      }
    }
  }
  return issues
}

function sameStringArray(left, right) {
  const normalize = (value) => (Array.isArray(value) ? value.map(String).sort() : [])
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

export function validateDefTimelinePayload(payload, fieldName = 'payload') {
  if (!payload || typeof payload !== 'object') return [{ code: 'payload-not-object', path: fieldName, message: `${fieldName} must be an object.` }]
  if (!Array.isArray(payload.selectedCharacters)
    || !Array.isArray(payload.timelineData?.staffLines)
    || !payload.skillButtonTable || typeof payload.skillButtonTable !== 'object'
    || !Array.isArray(payload.allBuffList)) {
    return [{ code: 'payload-structure-invalid', path: fieldName, message: `${fieldName} is missing selectedCharacters, timelineData.staffLines, skillButtonTable, or allBuffList.` }]
  }
  const issues = validateDefNodeSource(decodeDefNodePayload(payload)).map((issue) => ({
    ...issue,
    path: issue.path ? `${fieldName}.${issue.path}` : fieldName,
  }))
  const timelineButtons = new Map()
  for (const [staffOffset, staff] of payload.timelineData.staffLines.entries()) {
    for (const [buttonOffset, button] of (Array.isArray(staff?.buttons) ? staff.buttons : []).entries()) {
      const path = `${fieldName}.timelineData.staffLines.${staffOffset}.buttons.${buttonOffset}`
      if (!button?.id) continue
      if (timelineButtons.has(button.id)) {
        issues.push({ code: 'duplicate-timeline-button-entry', path, message: `Timeline button ${button.id} appears more than once.` })
      } else {
        timelineButtons.set(button.id, { button, path })
      }
    }
  }
  const tableEntries = Object.entries(payload.skillButtonTable)
  for (const [buttonId, tableButton] of tableEntries) {
    const timelineEntry = timelineButtons.get(buttonId)
    const tablePath = `${fieldName}.skillButtonTable.${buttonId}`
    if (!timelineEntry) {
      issues.push({ code: 'table-button-missing-timeline-entry', path: tablePath, message: `skillButtonTable button ${buttonId} is missing from timelineData.` })
      continue
    }
    const timelineButton = timelineEntry.button
    for (const property of ['id', 'characterId', 'characterName', 'skillType', 'staffIndex', 'lineIndex', 'nodeIndex', 'nodeNumber']) {
      if (timelineButton?.[property] !== tableButton?.[property]) {
        issues.push({
          code: `timeline-button-${property}-mismatch`,
          path: `${timelineEntry.path}.${property}`,
          message: `Timeline button ${buttonId} ${property} does not match skillButtonTable.`,
        })
      }
    }
    if (!sameStringArray(timelineButton?.buffIds, tableButton?.selectedBuff)) {
      issues.push({ code: 'timeline-button-buffs-mismatch', path: `${timelineEntry.path}.buffIds`, message: `Timeline button ${buttonId} Buff ids do not match skillButtonTable.` })
    }
  }
  for (const [buttonId, entry] of timelineButtons.entries()) {
    if (!Object.prototype.hasOwnProperty.call(payload.skillButtonTable, buttonId)) {
      issues.push({ code: 'timeline-button-missing-table-entry', path: entry.path, message: `Timeline button ${buttonId} is missing from skillButtonTable.` })
    }
  }
  return issues
}

export function rebuildDefNodePayload(previousPayload, source) {
  const issues = validateDefNodeSource(source)
  if (issues.length) return { ok: false, issues }
  const payload = clone(previousPayload)
  payload.selectedCharacters = clone(source.selection.selectedCharacters)
  payload.allBuffList = clone(source.buffs.allBuffList)
  payload.characterInputMap = clone(source.inputs?.characterInputMap || {})
  payload.operatorConfigPageCache = clone(source.inputs?.operatorConfigPageCache || {})
  payload.skillButtonTable = {}
  const staffLines = source.timeline.staffLines.map((staff) => {
    const buttons = staff.buttons.map((raw) => {
      const button = clone(raw)
      payload.skillButtonTable[button.id] = button
      return tableButtonForTimeline(button)
    }).sort((left, right) => left.nodeIndex - right.nodeIndex)
    return {
      staffIndex: staff.staffIndex,
      characterName: staff.characterName,
      occupiedNodes: buttons.map((button) => button.nodeIndex),
      buttons,
    }
  })
  payload.timelineData = {
    ...(payload.timelineData || {}),
    version: source.timeline.version || payload.timelineData?.version || '1.0',
    createdAt: source.timeline.createdAt || payload.timelineData?.createdAt || Date.now(),
    updatedAt: payload.timelineData?.updatedAt || Date.now(),
    staffLines,
  }
  const payloadIssues = validateDefTimelinePayload(payload)
  if (payloadIssues.length) return { ok: false, issues: payloadIssues }
  if (JSON.stringify(payload) !== JSON.stringify(previousPayload)) payload.timelineData.updatedAt = Date.now()
  return { ok: true, payload, source: clone(source) }
}

export function computeDefNodeSourceRisk(diff, sourceIssues = []) {
  const flags = []
  const summary = diff?.summary || {}
  const changed = (summary.addedButtonCount || 0) + (summary.removedButtonCount || 0) + (summary.changedButtonCount || 0)
  if (summary.removedButtonCount > 0) flags.push({ code: 'buttons-removed', severity: 'warning', message: `${summary.removedButtonCount} button(s) removed.` })
  if (changed >= 8) flags.push({ code: 'large-button-change', severity: 'warning', message: `${changed} timeline button(s) changed.` })
  if (diff?.selectedCharactersChanged) flags.push({ code: 'selected-characters-changed', severity: 'warning', message: 'Selected operators changed.' })
  for (const issue of sourceIssues) flags.push({ code: issue.code, severity: 'blocker', message: issue.message, path: issue.path })
  return flags
}
