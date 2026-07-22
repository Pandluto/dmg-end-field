export function extractDefOperatorConfig(payload, characterId) {
  const snapshot = payload?.operatorConfigPageCache?.[characterId];
  if (!snapshot) return null;
  return {
    characterId,
    characterName: snapshot?.operator?.name || '',
    weapon: {
      id: snapshot?.weapon?.id || '',
      name: snapshot?.weapon?.name || '',
      level: snapshot?.weapon?.config?.level,
      potential: snapshot?.weapon?.config?.potential || '',
      skillLevels: snapshot?.weapon?.config?.skillLevels || {},
    },
    equipment: (Array.isArray(snapshot?.equipment?.pieces) ? snapshot.equipment.pieces : []).map((piece) => ({
      slotKey: piece?.slotKey || '',
      equipmentId: piece?.equipmentId || '',
      name: piece?.name || '',
      effects: (Array.isArray(piece?.effects) ? piece.effects : []).map((effect) => ({
        effectId: effect?.effectId || '',
        label: effect?.label || '',
        level: effect?.level,
        value: effect?.value,
      })),
    })),
    operatorSkillLevels: snapshot?.operator?.skillConfig || {},
  };
}

export function exactDefOperatorConfigMatches(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function normalizeTargetText(value) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';
}

export function matchesDefOperatorConfigTarget(candidate, expected, normalizeText = normalizeTargetText) {
  const expectedId = typeof expected?.characterId === 'string' ? expected.characterId.trim() : '';
  const expectedName = typeof expected?.characterName === 'string' ? expected.characterName.trim() : '';
  if (!expectedId && !expectedName) return false;
  const candidateId = typeof candidate?.characterId === 'string' ? candidate.characterId.trim() : '';
  const candidateName = typeof candidate?.characterName === 'string' ? candidate.characterName.trim() : '';
  return (!expectedId || candidateId === expectedId)
    && (!expectedName || normalizeText(candidateName) === normalizeText(expectedName));
}

export function verifyDefOperatorConfigPreviewTarget(command, preview, normalizeText = normalizeTargetText) {
  const finalConfig = preview?.finalConfig;
  const targetMatches = matchesDefOperatorConfigTarget(finalConfig, command, normalizeText);
  const characterId = typeof finalConfig?.characterId === 'string' ? finalConfig.characterId.trim() : '';
  const preparedSnapshot = characterId
    ? preview?.preparedPayload?.operatorConfigPageCache?.[characterId]
    : null;
  const preparedOperatorId = typeof preparedSnapshot?.operator?.id === 'string'
    ? preparedSnapshot.operator.id.trim()
    : '';
  const preparedIdentityMatches = Boolean(characterId) && preparedOperatorId === characterId;
  const mismatches = [];
  if (!targetMatches) mismatches.push('operator-target-mismatch');
  if (!preparedIdentityMatches) mismatches.push('prepared-operator-identity-mismatch');
  return {
    pass: mismatches.length === 0,
    mismatches,
    characterId,
    preparedOperatorId,
  };
}

export function verifyDefOperatorConfigPreparedPayload(preview) {
  const characterId = typeof preview?.finalConfig?.characterId === 'string'
    ? preview.finalConfig.characterId.trim()
    : '';
  const preparedConfig = characterId
    ? extractDefOperatorConfig(preview?.preparedPayload, characterId)
    : null;
  return {
    pass: Boolean(preparedConfig) && exactDefOperatorConfigMatches(preparedConfig, preview?.finalConfig),
    characterId,
    preparedConfig,
  };
}
