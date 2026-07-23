const PRESENTATION_KEYS = new Set([
  'createdAt',
  'updatedAt',
  'hydratedAt',
  'position',
  'layout',
  'layoutMeta',
  'runtimeSnapshot',
  'skillIconUrl',
]);
const DERIVED_TOP_LEVEL_KEYS = new Set([
  'characterComputedMap',
  'damageReport',
  'damageResult',
  'statistics',
  'calculation',
  'calculationResult',
]);
const KNOWN_SOURCE_TOP_LEVEL_KEYS = new Set([
  'selectedCharacters',
  'characterInputMap',
  'operatorConfigPageCache',
  'timelineData',
  'skillButtonTable',
  'allBuffList',
  'anomalyStateSnapshots',
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !PRESENTATION_KEYS.has(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stable(entry)]));
}

function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function buttons(payload) {
  return payload?.skillButtonTable && typeof payload.skillButtonTable === 'object'
    ? payload.skillButtonTable
    : {};
}

function payloadFromNodeSource(value = {}) {
  if (!value?.selection || !value?.timeline || !value?.buffs || !value?.inputs) return value;
  const staffLines = Array.isArray(value.timeline.staffLines) ? value.timeline.staffLines : [];
  return {
    selectedCharacters: value.selection.selectedCharacters || [],
    characterInputMap: value.inputs.characterInputMap || {},
    operatorConfigPageCache: value.inputs.operatorConfigPageCache || {},
    timelineData: {
      version: value.timeline.version,
      staffLines,
    },
    skillButtonTable: Object.fromEntries(
      staffLines.flatMap((line) => (Array.isArray(line?.buttons) ? line.buttons : []))
        .filter((button) => button?.id)
        .map((button) => [button.id, button]),
    ),
    allBuffList: value.buffs.allBuffList || [],
    anomalyStateSnapshots: value.buffs.anomalyStateSnapshots || [],
  };
}

function timelineButton(button = {}) {
  return stable({
    id: button.id,
    characterId: button.characterId,
    characterName: button.characterName,
    skillType: button.skillType,
    runtimeSkillId: button.runtimeSkillId,
    skillDisplayName: button.skillDisplayName,
    staffIndex: button.staffIndex,
    lineIndex: button.lineIndex,
    nodeIndex: button.nodeIndex,
    nodeNumber: button.nodeNumber,
    customHits: button.customHits || [],
  });
}

function buffButton(button = {}) {
  return stable({
    selectedBuff: [...new Set(Array.isArray(button.selectedBuff) ? button.selectedBuff.map(String) : [])].sort(),
    buffStackCounts: button.buffStackCounts || {},
    anomalyConfig: button.anomalyConfig || null,
    resistanceConfig: button.resistanceConfig || null,
    panelConfig: button.panelConfig || null,
  });
}

function timelineProjection(payload = {}) {
  return {
    staffLines: (Array.isArray(payload?.timelineData?.staffLines) ? payload.timelineData.staffLines : []).map((line) => ({
      staffIndex: line?.staffIndex,
      characterName: line?.characterName,
      buttonIds: (Array.isArray(line?.buttons) ? line.buttons : []).map((button) => button?.id),
      occupiedNodes: Array.isArray(line?.occupiedNodes) ? line.occupiedNodes : [],
    })),
    buttons: Object.fromEntries(Object.entries(buttons(payload))
      .map(([id, button]) => [id, timelineButton(button)])
      .sort(([left], [right]) => left.localeCompare(right))),
  };
}

function buffProjection(payload = {}) {
  return {
    allBuffList: stable(payload?.allBuffList || []),
    anomalyStateSnapshots: stable(payload?.anomalyStateSnapshots || []),
    buttons: Object.fromEntries(Object.entries(buttons(payload))
      .map(([id, button]) => [id, buffButton(button)])
      .sort(([left], [right]) => left.localeCompare(right))),
  };
}

function buffCatalogById(payload = {}) {
  return new Map((Array.isArray(payload.allBuffList) ? payload.allBuffList : [])
    .filter((entry) => entry?.id)
    .map((entry) => [String(entry.id), entry]));
}

function deterministicRemovedButtonBuffCleanup(beforePayload, afterPayload, removedButtonIds) {
  return deterministicTimelineButtonBuffLifecycle(beforePayload, afterPayload, {
    removedButtonIds,
  });
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function containsOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isAbsentOrEmptyArray(value) {
  return value === null || value === undefined || (Array.isArray(value) && value.length === 0);
}

function isAbsentOrEmptyRecord(value) {
  return value === null || value === undefined || (isRecord(value) && Object.keys(value).length === 0);
}

function isCanonicalEmptyAnomalyConfig(value) {
  if (value === null || value === undefined) return true;
  if (!isRecord(value) || !containsOnlyKeys(value, new Set([
    'selectedStatuses',
    'selectedDamages',
    'selectedStateSnapshotIds',
  ]))) return false;
  return isAbsentOrEmptyArray(value.selectedStatuses)
    && isAbsentOrEmptyArray(value.selectedDamages)
    && isAbsentOrEmptyArray(value.selectedStateSnapshotIds);
}

function isCanonicalEmptyResistanceConfig(value) {
  if (value === null || value === undefined) return true;
  if (!isRecord(value) || !containsOnlyKeys(value, new Set(['targetResistance']))) return false;
  const target = value.targetResistance;
  if (target === null || target === undefined) return true;
  const resistanceKeys = new Set([
    'physicalResistance',
    'fireResistance',
    'electricResistance',
    'iceResistance',
    'natureResistance',
  ]);
  return isRecord(target)
    && containsOnlyKeys(target, resistanceKeys)
    && Object.values(target).every((entry) => typeof entry === 'number' && entry === 0);
}

function isCanonicalEmptyPanelConfig(value) {
  if (value === null || value === undefined) return true;
  if (!isRecord(value) || !containsOnlyKeys(value, new Set([
    'selectedBuff',
    'globallyDisabledBuffIds',
    'manualDisabledBuffIdsBySegmentKey',
    'manualBuffStackCountsBySegmentKey',
    'manualDisabledHitKeys',
  ]))) return false;
  return isAbsentOrEmptyArray(value.selectedBuff)
    && isAbsentOrEmptyArray(value.globallyDisabledBuffIds)
    && isAbsentOrEmptyRecord(value.manualDisabledBuffIdsBySegmentKey)
    && isAbsentOrEmptyRecord(value.manualBuffStackCountsBySegmentKey)
    && isAbsentOrEmptyArray(value.manualDisabledHitKeys);
}

function hasCanonicalEmptyBuffState(button = {}) {
  return isAbsentOrEmptyArray(button.selectedBuff)
    && isAbsentOrEmptyRecord(button.buffStackCounts)
    && isCanonicalEmptyAnomalyConfig(button.anomalyConfig)
    && isCanonicalEmptyResistanceConfig(button.resistanceConfig)
    && isCanonicalEmptyPanelConfig(button.panelConfig);
}

function deterministicTimelineButtonBuffLifecycle(
  beforePayload,
  afterPayload,
  { removedButtonIds = [], addedButtonIds = [] } = {},
) {
  const removed = new Set(removedButtonIds);
  const added = new Set(addedButtonIds);
  const beforeButtons = buttons(beforePayload);
  const afterButtons = buttons(afterPayload);
  const removedBuffIds = new Set(
    [...removed].flatMap((buttonId) => (
      Array.isArray(beforeButtons[buttonId]?.selectedBuff)
        ? beforeButtons[buttonId].selectedBuff.map(String)
        : []
    )),
  );
  for (const [buttonId, afterButton] of Object.entries(afterButtons)) {
    if (!beforeButtons[buttonId]) {
      if (added.has(buttonId) && hasCanonicalEmptyBuffState(afterButton)) continue;
      return { pass: false, reason: `added-button-has-buff-state:${buttonId}` };
    }
    if (!same(buffButton(beforeButtons[buttonId]), buffButton(afterButton))) {
      return { pass: false, reason: `changed-surviving-button-buff:${buttonId}` };
    }
  }
  if (!same(beforePayload.anomalyStateSnapshots || [], afterPayload.anomalyStateSnapshots || [])) {
    return { pass: false, reason: 'changed-anomaly-state' };
  }
  const beforeCatalog = buffCatalogById(beforePayload);
  const afterCatalog = buffCatalogById(afterPayload);
  const withoutRefCount = (entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    const { refCount: _refCount, ...rest } = entry;
    return rest;
  };
  for (const [buffId, afterEntry] of afterCatalog) {
    const beforeEntry = beforeCatalog.get(buffId);
    if (!beforeEntry || !same(withoutRefCount(beforeEntry), withoutRefCount(afterEntry))) {
      return { pass: false, reason: `changed-buff-catalog:${buffId}` };
    }
    if (!same(beforeEntry.refCount, afterEntry.refCount) && !removedBuffIds.has(buffId)) {
      return { pass: false, reason: `changed-unrelated-buff-refcount:${buffId}` };
    }
  }
  const survivingReferences = new Set(
    Object.values(afterButtons).flatMap((button) => (
      Array.isArray(button?.selectedBuff) ? button.selectedBuff.map(String) : []
    )),
  );
  for (const buffId of beforeCatalog.keys()) {
    if (!afterCatalog.has(buffId)
      && (!removedBuffIds.has(buffId) || survivingReferences.has(buffId))) {
      return { pass: false, reason: `removed-unrelated-buff:${buffId}` };
    }
  }
  return {
    pass: true,
    removedButtonIds: [...removed],
    addedButtonIds: [...added],
    removedBuffIds: [...removedBuffIds],
  };
}

function mapCleanupOnlyRemovesAllowed(before = {}, after = {}, allowedRemovedIds = []) {
  const allowed = new Set(allowedRemovedIds.map(String));
  for (const [id, value] of Object.entries(after || {})) {
    if (!Object.hasOwn(before || {}, id) || !same(before[id], value)) return false;
  }
  return Object.keys(before || {}).every((id) => Object.hasOwn(after || {}, id) || allowed.has(String(id)));
}

function projections(payload = {}) {
  return {
    selection: stable(payload.selectedCharacters || []),
    loadout: stable({
      characterInputMap: payload.characterInputMap || {},
      operatorConfigPageCache: payload.operatorConfigPageCache || {},
    }),
    timeline: timelineProjection(payload),
    buff: buffProjection(payload),
    calculation: null,
  };
}

function selectionCascade(beforePayload, afterPayload) {
  const beforeSelected = new Set((beforePayload.selectedCharacters || []).map(String));
  const afterSelected = new Set((afterPayload.selectedCharacters || []).map(String));
  const removedCharacterIds = [...beforeSelected].filter((id) => !afterSelected.has(id));
  const beforeButtons = buttons(beforePayload);
  const afterButtons = buttons(afterPayload);
  const addedButtonIds = Object.keys(afterButtons).filter((id) => !beforeButtons[id]);
  if (addedButtonIds.length) return { pass: false, reason: 'selection-cascade-added-buttons', removedCharacterIds };
  for (const [id, afterButton] of Object.entries(afterButtons)) {
    const beforeButton = beforeButtons[id];
    if (!afterSelected.has(String(afterButton.characterId || ''))) {
      return { pass: false, reason: 'selection-cascade-retained-unselected-button', removedCharacterIds };
    }
    const beforeIdentity = timelineButton(beforeButton);
    const afterIdentity = timelineButton(afterButton);
    for (const key of ['id', 'characterId', 'characterName', 'skillType', 'runtimeSkillId', 'skillDisplayName', 'nodeIndex', 'nodeNumber', 'customHits']) {
      if (!same(beforeIdentity[key], afterIdentity[key])) {
        return { pass: false, reason: `selection-cascade-changed-button-${key}`, removedCharacterIds };
      }
    }
  }
  const removedButtonIds = Object.keys(beforeButtons).filter((id) => !afterButtons[id]);
  if (removedButtonIds.some((id) => !removedCharacterIds.includes(String(beforeButtons[id]?.characterId || '')))) {
    return { pass: false, reason: 'selection-cascade-removed-retained-character-button', removedCharacterIds, removedButtonIds };
  }
  const buffCleanup = deterministicRemovedButtonBuffCleanup(beforePayload, afterPayload, removedButtonIds);
  if (!buffCleanup.pass) {
    return {
      pass: false,
      reason: `selection-cascade-${buffCleanup.reason}`,
      removedCharacterIds,
      removedButtonIds,
    };
  }
  if (!mapCleanupOnlyRemovesAllowed(
    beforePayload.characterInputMap,
    afterPayload.characterInputMap,
    removedCharacterIds,
  )) {
    return { pass: false, reason: 'selection-cascade-changed-character-input', removedCharacterIds, removedButtonIds };
  }
  const beforeConfigs = beforePayload.operatorConfigPageCache || {};
  const afterConfigs = afterPayload.operatorConfigPageCache || {};
  if (!mapCleanupOnlyRemovesAllowed(beforeConfigs, afterConfigs, removedCharacterIds)) {
    return { pass: false, reason: 'selection-cascade-changed-loadout', removedCharacterIds, removedButtonIds };
  }
  return {
    pass: true,
    removedCharacterIds,
    removedButtonIds,
    removedBuffIds: buffCleanup.removedBuffIds,
  };
}

function changedUnknownTopLevel(beforePayload, afterPayload) {
  const keys = new Set([...Object.keys(beforePayload || {}), ...Object.keys(afterPayload || {})]);
  return [...keys]
    .filter((key) => !KNOWN_SOURCE_TOP_LEVEL_KEYS.has(key) && !DERIVED_TOP_LEVEL_KEYS.has(key) && !PRESENTATION_KEYS.has(key))
    .filter((key) => !same(beforePayload?.[key], afterPayload?.[key]));
}

function analyzeBusinessMutation({ businessId, beforePayload, afterPayload }) {
  if (!['selection', 'loadout', 'timeline', 'buff', 'calculation'].includes(businessId)) {
    const error = new Error(`Unknown business write scope: ${businessId}`);
    error.code = 'HARNESS_WRITE_SCOPE_INVALID';
    throw error;
  }
  const normalizedBeforePayload = payloadFromNodeSource(beforePayload);
  const normalizedAfterPayload = payloadFromNodeSource(afterPayload);
  const before = projections(normalizedBeforePayload);
  const after = projections(normalizedAfterPayload);
  const changedDomains = Object.keys(before).filter((domain) => domain !== 'calculation' && !same(before[domain], after[domain]));
  const activeChanges = changedDomains.filter((domain) => domain === businessId);
  const productCascades = [];
  const unexplainedChanges = [];
  let cascadeDetails = {};

  for (const domain of changedDomains.filter((candidate) => candidate !== businessId)) {
    if (businessId === 'selection' && ['loadout', 'timeline', 'buff'].includes(domain)) {
      const cascade = selectionCascade(normalizedBeforePayload, normalizedAfterPayload);
      if (cascade.pass) {
        productCascades.push(domain);
        cascadeDetails = { ...cascadeDetails, ...cascade };
      } else {
        unexplainedChanges.push(`${domain}:${cascade.reason}`);
      }
      continue;
    }
    if (businessId === 'timeline' && domain === 'buff') {
      const beforeButtonIds = Object.keys(buttons(normalizedBeforePayload));
      const afterButtonIds = new Set(Object.keys(buttons(normalizedAfterPayload)));
      const removedButtonIds = beforeButtonIds.filter((id) => !afterButtonIds.has(id));
      const beforeButtonIdSet = new Set(beforeButtonIds);
      const addedButtonIds = [...afterButtonIds].filter((id) => !beforeButtonIdSet.has(id));
      const cascade = deterministicTimelineButtonBuffLifecycle(
        normalizedBeforePayload,
        normalizedAfterPayload,
        { removedButtonIds, addedButtonIds },
      );
      if ((removedButtonIds.length || addedButtonIds.length) && cascade.pass) {
        productCascades.push(domain);
        cascadeDetails = { ...cascadeDetails, ...cascade };
      } else {
        unexplainedChanges.push(`${domain}:timeline-cascade-${cascade.reason || 'no-removed-button'}`);
      }
      continue;
    }
    unexplainedChanges.push(domain);
  }
  if (businessId === 'timeline') {
    const beforeButtonIds = Object.keys(buttons(normalizedBeforePayload));
    const afterButtonIds = new Set(Object.keys(buttons(normalizedAfterPayload)));
    cascadeDetails = {
      ...cascadeDetails,
      removedButtonIds: beforeButtonIds.filter((id) => !afterButtonIds.has(id)),
    };
  }
  if (businessId === 'calculation' && changedDomains.length) unexplainedChanges.push(...changedDomains);
  unexplainedChanges.push(...changedUnknownTopLevel(normalizedBeforePayload, normalizedAfterPayload).map((key) => `unknown:${key}`));
  const recalculations = [...new Set([...Object.keys(normalizedBeforePayload || {}), ...Object.keys(normalizedAfterPayload || {})])]
    .filter((key) => DERIVED_TOP_LEVEL_KEYS.has(key))
    .filter((key) => !same(normalizedBeforePayload?.[key], normalizedAfterPayload?.[key]));
  return {
    pass: unexplainedChanges.length === 0,
    businessId,
    activeChanges,
    productCascades: [...new Set(productCascades)],
    recalculations,
    unexplainedChanges: [...new Set(unexplainedChanges)],
    changedDomains,
    cascadeDetails,
  };
}

module.exports = {
  analyzeBusinessMutation,
  buffProjection,
  payloadFromNodeSource,
  timelineProjection,
};
