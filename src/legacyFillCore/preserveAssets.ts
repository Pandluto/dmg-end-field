type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function preserveExistingWeaponImageUrlValue<T>(nextPayload: T, currentDraft?: unknown): T {
  const next = clone(nextPayload);
  const nextRecord = asRecord(next);
  const currentRecord = asRecord(currentDraft);
  if (nextRecord.id === currentRecord.id && hasText(currentRecord.imgUrl)) {
    nextRecord.imgUrl = currentRecord.imgUrl;
  }
  return next;
}

export function preserveExistingOperatorAssetUrlsValue<T>(nextPayload: T, currentDraft: unknown): T {
  const next = clone(nextPayload);
  const nextRecord = asRecord(next);
  const currentRecord = asRecord(currentDraft);
  if (nextRecord.id === currentRecord.id && hasText(currentRecord.avatarUrl)) {
    nextRecord.avatarUrl = currentRecord.avatarUrl;
  }

  const currentSkills = asRecord(currentRecord.skills);
  for (const [skillKey, nextSkillValue] of Object.entries(asRecord(nextRecord.skills))) {
    const nextSkill = asRecord(nextSkillValue);
    const candidates = Object.values(currentSkills).map(asRecord);
    const exactSkill = currentSkills[skillKey];
    const currentSkill = (exactSkill && typeof exactSkill === 'object' && !Array.isArray(exactSkill)
      ? asRecord(exactSkill)
      : candidates.find((skill) => (
        skill.buttonType === nextSkill.buttonType
        && skill.displayName === nextSkill.displayName
      ))
      || candidates.find((skill) => skill.buttonType === nextSkill.buttonType)) ?? {};
    if (nextRecord.id === currentRecord.id && hasText(currentSkill.iconUrl)) {
      nextSkill.iconUrl = currentSkill.iconUrl;
    }
  }
  return next;
}

export function preserveExistingEquipmentImageUrlsValue<T>(nextPayload: T, currentLibrary?: unknown): T {
  const next = clone(nextPayload);
  const nextGearSets = asRecord(asRecord(next).gearSets);
  const currentGearSets = asRecord(asRecord(currentLibrary).gearSets);

  for (const [gearSetKey, nextSetValue] of Object.entries(nextGearSets)) {
    const nextSet = asRecord(nextSetValue);
    const currentSet = asRecord(currentGearSets[gearSetKey] || currentGearSets[String(nextSet.gearSetId || '')]);
    if (nextSet.gearSetId === currentSet.gearSetId && hasText(currentSet.imgUrl)) {
      nextSet.imgUrl = currentSet.imgUrl;
    }

    const currentEquipments = asRecord(currentSet.equipments);
    for (const [equipmentKey, nextEquipmentValue] of Object.entries(asRecord(nextSet.equipments))) {
      const nextEquipment = asRecord(nextEquipmentValue);
      const currentEquipment = asRecord(
        currentEquipments[equipmentKey] || currentEquipments[String(nextEquipment.equipmentId || '')],
      );
      if (nextEquipment.equipmentId === currentEquipment.equipmentId && hasText(currentEquipment.imgUrl)) {
        nextEquipment.imgUrl = currentEquipment.imgUrl;
      }
    }
  }
  return next;
}

export function mergeEquipmentLibraryPatchValue<T>(baseLibrary: T, patch: T): T {
  const base = clone(baseLibrary);
  const baseRecord = asRecord(base);
  const patchRecord = asRecord(patch);
  const nextGearSets: UnknownRecord = { ...asRecord(baseRecord.gearSets) };

  for (const [patchKey, patchSetValue] of Object.entries(asRecord(patchRecord.gearSets))) {
    const patchSet = asRecord(patchSetValue);
    const patchSetId = String(patchSet.gearSetId || patchKey);
    const existingEntry = Object.entries(nextGearSets).find(([key, gearSetValue]) => {
      const gearSet = asRecord(gearSetValue);
      return key === patchKey || key === patchSetId || gearSet.gearSetId === patchSet.gearSetId;
    });
    if (existingEntry && existingEntry[0] !== patchSetId) delete nextGearSets[existingEntry[0]];
    nextGearSets[patchSetId] = patchSetValue;
  }

  const merged = {
    ...baseRecord,
    ...patchRecord,
    updatedAt: hasText(patchRecord.updatedAt) ? patchRecord.updatedAt : new Date().toISOString(),
    migration: patchRecord.migration ?? baseRecord.migration,
    gearSets: nextGearSets,
  };
  return preserveExistingEquipmentImageUrlsValue(merged, baseLibrary) as T;
}
