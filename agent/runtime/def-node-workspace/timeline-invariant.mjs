import crypto from 'node:crypto'

const PRESENTATION_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'hydratedAt',
  'position',
  'layout',
  'layoutMeta',
  'runtimeSnapshot',
  'skillIconUrl',
])

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !PRESENTATION_FIELDS.has(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stableValue(entry)]))
}

function stableJson(value) {
  return JSON.stringify(stableValue(value))
}

function stableStringList(value) {
  return [...new Set(Array.isArray(value) ? value.map((entry) => String(entry)) : [])].sort()
}

function canonicalPanelConfig(value) {
  if (!isRecord(value)) return null
  return stableValue({
    ...value,
    selectedBuff: stableStringList(value.selectedBuff),
    globallyDisabledBuffIds: stableStringList(value.globallyDisabledBuffIds),
    manualDisabledHitKeys: stableStringList(value.manualDisabledHitKeys),
    manualDisabledBuffIdsBySegmentKey: Object.fromEntries(Object.entries(value.manualDisabledBuffIdsBySegmentKey || {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, ids]) => [key, stableStringList(ids)])),
    manualBuffStackCountsBySegmentKey: stableValue(value.manualBuffStackCountsBySegmentKey || {}),
  })
}

function canonicalButton(button = {}) {
  return {
    id: String(button.id || ''),
    characterId: String(button.characterId || ''),
    characterName: String(button.characterName || ''),
    skillType: String(button.skillType || ''),
    runtimeSkillId: String(button.runtimeSkillId || ''),
    skillDisplayName: String(button.skillDisplayName || ''),
    staffIndex: button.staffIndex,
    lineIndex: button.lineIndex,
    nodeIndex: button.nodeIndex,
    nodeNumber: button.nodeNumber,
    selectedBuff: stableStringList(button.selectedBuff),
    customHits: stableValue(button.customHits || []),
    buffStackCounts: stableValue(button.buffStackCounts || {}),
    anomalyConfig: stableValue(button.anomalyConfig || null),
    resistanceConfig: stableValue(button.resistanceConfig || null),
    panelConfig: canonicalPanelConfig(button.panelConfig),
  }
}

function canonicalStaffLines(payload = {}) {
  const lines = Array.isArray(payload?.timelineData?.staffLines) ? payload.timelineData.staffLines : []
  return lines
    .map((line) => ({
      staffIndex: line?.staffIndex,
      characterName: String(line?.characterName || ''),
      occupiedNodes: [...new Set(Array.isArray(line?.occupiedNodes) ? line.occupiedNodes : [])].sort((left, right) => Number(left) - Number(right)),
      buttonIds: (Array.isArray(line?.buttons) ? line.buttons : []).map((button) => String(button?.id || '')).sort(),
    }))
    .sort((left, right) => Number(left.staffIndex) - Number(right.staffIndex))
}

function canonicalBuffs(value) {
  return (Array.isArray(value) ? value : [])
    .map((buff) => stableValue(buff))
    .sort((left, right) => `${left?.id || ''}:${stableJson(left)}`.localeCompare(`${right?.id || ''}:${stableJson(right)}`))
}

/**
 * A timeline invariant deliberately contains only typed game state.  It is
 * stable across renderer hydration, visual layout and timestamp churn while
 * still preserving the values that affect a visible skill button or damage.
 */
export function canonicalizeDefTimelineInvariant(payload = {}) {
  const buttons = Object.fromEntries(Object.entries(isRecord(payload?.skillButtonTable) ? payload.skillButtonTable : {})
    .map(([id, button]) => [id, canonicalButton(button)])
    .sort(([left], [right]) => left.localeCompare(right)))
  return {
    selectedCharacters: Array.isArray(payload?.selectedCharacters) ? [...payload.selectedCharacters] : [],
    staffLines: canonicalStaffLines(payload),
    buttons,
    allBuffList: canonicalBuffs(payload?.allBuffList),
    anomalyStateSnapshots: canonicalBuffs(payload?.anomalyStateSnapshots),
  }
}

function collectChangedPaths(before, after, path = '', paths = [], limit = 48) {
  if (paths.length >= limit) return paths
  if (stableJson(before) === stableJson(after)) return paths
  const beforeObject = isRecord(before)
  const afterObject = isRecord(after)
  if (beforeObject && afterObject) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    for (const key of keys) {
      collectChangedPaths(before[key], after[key], path ? `${path}.${key}` : key, paths, limit)
      if (paths.length >= limit) break
    }
    return paths
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length)
    for (let index = 0; index < length; index += 1) {
      collectChangedPaths(before[index], after[index], `${path}[${index}]`, paths, limit)
      if (paths.length >= limit) break
    }
    return paths
  }
  paths.push(path || '$')
  return paths
}

export function compareDefTimelineInvariants(beforePayload, afterPayload) {
  const before = canonicalizeDefTimelineInvariant(beforePayload)
  const after = canonicalizeDefTimelineInvariant(afterPayload)
  const beforeJson = stableJson(before)
  const afterJson = stableJson(after)
  const changedPaths = collectChangedPaths(before, after)
  return {
    pass: beforeJson === afterJson,
    beforeCanonicalHash: crypto.createHash('sha256').update(beforeJson).digest('hex'),
    afterCanonicalHash: crypto.createHash('sha256').update(afterJson).digest('hex'),
    changedPaths,
    changedPathLimitReached: changedPaths.length >= 48,
    beforeButtonIds: Object.keys(before.buttons),
    afterButtonIds: Object.keys(after.buttons),
  }
}
