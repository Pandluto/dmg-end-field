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
