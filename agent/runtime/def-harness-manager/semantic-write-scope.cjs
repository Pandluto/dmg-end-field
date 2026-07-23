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
  const beforeConfigs = beforePayload.operatorConfigPageCache || {};
  const afterConfigs = afterPayload.operatorConfigPageCache || {};
  for (const [characterId, config] of Object.entries(afterConfigs)) {
    if (!Object.hasOwn(beforeConfigs, characterId) || !same(beforeConfigs[characterId], config)) {
      return { pass: false, reason: 'selection-cascade-added-or-changed-loadout', removedCharacterIds, removedButtonIds };
    }
  }
  const changedConfigIds = Object.keys(beforeConfigs).filter((id) => !same(beforeConfigs[id], afterConfigs[id]));
  if (changedConfigIds.some((id) => !removedCharacterIds.includes(String(id)))) {
    return { pass: false, reason: 'selection-cascade-removed-retained-loadout', removedCharacterIds, removedButtonIds };
  }
  return { pass: true, removedCharacterIds, removedButtonIds };
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
  const before = projections(beforePayload);
  const after = projections(afterPayload);
  const changedDomains = Object.keys(before).filter((domain) => domain !== 'calculation' && !same(before[domain], after[domain]));
  const activeChanges = changedDomains.filter((domain) => domain === businessId);
  const productCascades = [];
  const unexplainedChanges = [];
  let cascadeDetails = {};

  for (const domain of changedDomains.filter((candidate) => candidate !== businessId)) {
    if (businessId === 'selection' && ['loadout', 'timeline', 'buff'].includes(domain)) {
      const cascade = selectionCascade(beforePayload, afterPayload);
      if (cascade.pass) {
        productCascades.push(domain);
        cascadeDetails = { ...cascadeDetails, ...cascade };
      } else {
        unexplainedChanges.push(`${domain}:${cascade.reason}`);
      }
      continue;
    }
    unexplainedChanges.push(domain);
  }
  if (businessId === 'calculation' && changedDomains.length) unexplainedChanges.push(...changedDomains);
  unexplainedChanges.push(...changedUnknownTopLevel(beforePayload, afterPayload).map((key) => `unknown:${key}`));
  const recalculations = [...new Set([...Object.keys(beforePayload || {}), ...Object.keys(afterPayload || {})])]
    .filter((key) => DERIVED_TOP_LEVEL_KEYS.has(key))
    .filter((key) => !same(beforePayload?.[key], afterPayload?.[key]));
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
  timelineProjection,
};
