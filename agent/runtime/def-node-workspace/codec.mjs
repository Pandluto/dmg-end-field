import crypto from 'node:crypto'

export const DEF_NODE_SOURCE_SCHEMA_VERSION = 1

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
      .map(clone)
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
  const buttonIds = new Set()
  const staffSlots = new Set()
  for (const [staffOffset, staff] of source.timeline.staffLines.entries()) {
    if (!Number.isInteger(staff?.staffIndex) || staff.staffIndex < 0) {
      issues.push({ code: 'staff-index-invalid', path: `timeline.staffLines.${staffOffset}.staffIndex`, message: 'staffIndex must be a non-negative integer.' })
    }
    if (!Array.isArray(staff?.buttons)) {
      issues.push({ code: 'staff-buttons-invalid', path: `timeline.staffLines.${staffOffset}.buttons`, message: 'buttons must be an array.' })
      continue
    }
    for (const [buttonOffset, button] of staff.buttons.entries()) {
      const path = `timeline.staffLines.${staffOffset}.buttons.${buttonOffset}`
      if (!button?.id || typeof button.id !== 'string') {
        issues.push({ code: 'button-id-invalid', path: `${path}.id`, message: 'Every button needs a stable string id.' })
        continue
      }
      if (buttonIds.has(button.id)) issues.push({ code: 'button-id-duplicate', path: `${path}.id`, message: `Duplicate button id ${button.id}.` })
      buttonIds.add(button.id)
      if (!Number.isInteger(button.nodeIndex) || button.nodeIndex < 0) {
        issues.push({ code: 'button-slot-invalid', path: `${path}.nodeIndex`, message: 'nodeIndex must be a non-negative integer.' })
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
