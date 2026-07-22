const CATALOG_SHA256_PATTERN = /^[a-f0-9]{64}$/;
const OFFICIAL_SKILL_TYPES = Object.freeze({
  normalAttack: 'A',
  skill: 'B',
  chainSkill: 'E',
  ultimate: 'Q',
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalized(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function blockedDataContract(message, details = {}) {
  const error = new Error(message);
  error.code = 'BLOCKED_DATA_CONTRACT';
  error.status = 409;
  error.retryable = false;
  error.nextAction = 'Repair and review the canonical catalog compatibility data, then restart guide discovery in a new user turn. Do not use local operator or weapon libraries as fallback.';
  error.details = { ...details, retryable: false, nextAction: error.nextAction };
  return error;
}

function cloneJsonValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function peakMultiplierLevel(multipliers) {
  if (!isPlainObject(multipliers)) return null;
  if (isPlainObject(multipliers.M3)) return { level: 'M3', values: multipliers.M3 };
  if (isPlainObject(multipliers['9'])) return { level: '9', values: multipliers['9'] };
  const candidates = Object.entries(multipliers)
    .filter(([, value]) => isPlainObject(value))
    .map(([level, values]) => ({ level, values, order: level.startsWith('M') ? 100 + Number(level.slice(1)) : Number(level) }))
    .filter((entry) => Number.isFinite(entry.order))
    .sort((left, right) => right.order - left.order);
  return candidates[0] || null;
}

function officialHitMeta(skill, skillType) {
  const peak = peakMultiplierLevel(skill?.multipliers);
  if (!peak) return {};
  return Object.fromEntries(Object.entries(peak.values).flatMap(([key, rawValue]) => {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return [];
    return [[key, {
      displayName: String(key),
      skillType,
      levels: { [peak.level]: value },
    }]];
  }));
}

function canonicalSkills(rawSkills) {
  if (!isPlainObject(rawSkills)) return {};
  const officialEntries = Object.entries(OFFICIAL_SKILL_TYPES)
    .filter(([sourceKey]) => isPlainObject(rawSkills[sourceKey]));
  if (!officialEntries.length) return cloneJsonValue(rawSkills);
  return Object.fromEntries(officialEntries.map(([sourceKey, skillType]) => {
    const skill = rawSkills[sourceKey];
    return [sourceKey, {
      ...cloneJsonValue(skill),
      sourceSkillKey: sourceKey,
      displayName: String(skill.name || sourceKey),
      buttonType: skillType,
      hitMeta: officialHitMeta(skill, skillType),
    }];
  }));
}

/** Adapt the official active-catalog operator payload to the one canonical evidence shape. */
export function canonicalizeDefActiveOperator(raw, fallbackId) {
  if (!isPlainObject(raw)) return null;
  const id = String(fallbackId || raw.id || '').trim();
  const name = String(raw.name || '').trim();
  if (!id || !name) return null;
  return deepFreeze({
    ...cloneJsonValue(raw),
    id,
    name,
    skills: canonicalSkills(raw.skills),
    catalogProvenance: 'active-game-catalog',
  });
}

/** Validate the reviewed stable/legacy weapon identity and compatibility map. */
export function normalizeDefWeaponCompatibilityMap(rawMap) {
  if (!isPlainObject(rawMap)
    || rawMap.kind !== 'def.weapon-catalog-compatibility.v1'
    || rawMap.schemaVersion !== 1
    || !isPlainObject(rawMap.weapons)) {
    throw blockedDataContract('The reviewed weapon compatibility map is missing or has an unsupported schema.', {
      issue: 'weapon-compatibility-map-schema-invalid',
    });
  }
  const byStableId = new Map();
  const idAliases = new Map();
  const normalizedNames = new Map();
  for (const [stableId, rawEntry] of Object.entries(rawMap.weapons)) {
    const name = String(rawEntry?.name || '').trim();
    const compatibilityType = String(rawEntry?.compatibilityType || '').trim();
    const legacyIds = Array.isArray(rawEntry?.legacyIds)
      ? [...new Set(rawEntry.legacyIds.map((value) => String(value || '').trim()).filter(Boolean))]
      : [];
    const skill3EffectAdapters = Array.isArray(rawEntry?.skill3EffectAdapters)
      ? rawEntry.skill3EffectAdapters.map((effect) => ({
        effectKey: String(effect?.effectKey || '').trim(),
        name: String(effect?.name || '').trim(),
        typeKey: String(effect?.typeKey || '').trim(),
        category: String(effect?.category || '').trim(),
        condition: String(effect?.condition || '').trim(),
      }))
      : [];
    if (!stableId.trim() || !name || !compatibilityType) {
      throw blockedDataContract(`Weapon compatibility entry ${stableId || '<empty>'} is incomplete.`, {
        issue: 'weapon-compatibility-entry-incomplete',
        stableId,
      });
    }
    if (skill3EffectAdapters.some((effect) => !effect.effectKey || !effect.name || !effect.typeKey || !['passive', 'condition'].includes(effect.category))) {
      throw blockedDataContract(`Weapon compatibility entry ${stableId} has an invalid skill3 effect adapter.`, {
        issue: 'weapon-skill3-effect-adapter-invalid',
        stableId,
      });
    }
    const effectKeys = new Set();
    for (const effect of skill3EffectAdapters) {
      if (effectKeys.has(effect.effectKey)) {
        throw blockedDataContract(`Weapon compatibility entry ${stableId} repeats skill3 effect ${effect.effectKey}.`, {
          issue: 'weapon-skill3-effect-adapter-duplicate',
          stableId,
          effectKey: effect.effectKey,
        });
      }
      effectKeys.add(effect.effectKey);
    }
    const entry = deepFreeze({ stableId, name, compatibilityType, legacyIds, skill3EffectAdapters });
    byStableId.set(stableId, entry);
    const aliases = [stableId, ...legacyIds];
    for (const alias of aliases) {
      const existing = idAliases.get(alias);
      if (existing && existing !== stableId) {
        throw blockedDataContract(`Weapon identity alias ${alias} resolves to more than one stable id.`, {
          issue: 'weapon-compatibility-alias-ambiguous',
          alias,
          stableIds: [existing, stableId],
        });
      }
      idAliases.set(alias, stableId);
    }
    const nameKey = normalized(name);
    const existingName = normalizedNames.get(nameKey);
    if (existingName && existingName !== stableId) {
      throw blockedDataContract(`Weapon name ${name} resolves to more than one stable id.`, {
        issue: 'weapon-compatibility-name-ambiguous',
        name,
        stableIds: [existingName, stableId],
      });
    }
    normalizedNames.set(nameKey, stableId);
  }
  return Object.freeze({
    kind: rawMap.kind,
    schemaVersion: rawMap.schemaVersion,
    reviewedSource: deepFreeze(cloneJsonValue(rawMap.reviewedSource || {})),
    byStableId,
    idAliases,
    normalizedNames,
  });
}

export function resolveDefCanonicalWeaponId(compatibilityMap, rawId) {
  const value = String(rawId || '').trim();
  return compatibilityMap?.idAliases?.get(value) || null;
}

function canonicalizeWeapon(raw, stableId, compatibilityMap) {
  if (!isPlainObject(raw)) return null;
  const name = String(raw.name || '').trim();
  const mapping = compatibilityMap.byStableId.get(stableId);
  if (!mapping) {
    throw blockedDataContract(`Active-catalog weapon ${stableId} has no reviewed compatibility mapping.`, {
      issue: 'active-weapon-compatibility-missing',
      stableId,
      name,
    });
  }
  if (normalized(mapping.name) !== normalized(name)) {
    throw blockedDataContract(`Active-catalog weapon ${stableId} disagrees with its reviewed identity mapping.`, {
      issue: 'active-weapon-name-drift',
      stableId,
      expectedName: mapping.name,
      actualName: name,
    });
  }
  return deepFreeze({
    ...cloneJsonValue(raw),
    id: stableId,
    name,
    catalogType: String(raw.type || '').trim(),
    type: mapping.compatibilityType,
    compatibilityType: mapping.compatibilityType,
    legacyIds: [...mapping.legacyIds],
    reviewedSkill3EffectAdapters: cloneJsonValue(mapping.skill3EffectAdapters),
    catalogProvenance: 'active-game-catalog+reviewed-compatibility-map',
  });
}

/** Capture an immutable, version-addressed view used across build planning. */
export function createDefActiveGameCatalogSnapshot(catalog, {
  weaponCompatibilityMap = null,
  requireWeapons = false,
} = {}) {
  const dataVersion = String(catalog?.dataVersion || '').trim();
  const catalogSha256 = String(catalog?.catalogSha256 || '').trim().toLowerCase();
  if (!isPlainObject(catalog)
    || !dataVersion
    || !CATALOG_SHA256_PATTERN.test(catalogSha256)
    || !isPlainObject(catalog.operators)
    || !isPlainObject(catalog.weapons)
    || !isPlainObject(catalog.equipmentLibrary)) {
    throw blockedDataContract('The active game catalog is missing its immutable v2 identity or required domains.', {
      issue: 'active-game-catalog-v2-invalid',
      dataVersion: dataVersion || null,
      catalogSha256: catalogSha256 || null,
    });
  }
  const operators = Object.fromEntries(Object.entries(catalog.operators).map(([stableId, raw]) => {
    const operator = canonicalizeDefActiveOperator(raw, stableId);
    if (!operator) {
      throw blockedDataContract(`Active-catalog operator ${stableId} is invalid.`, {
        issue: 'active-operator-invalid',
        stableId,
      });
    }
    return [stableId, operator];
  }));
  let weapons = cloneJsonValue(catalog.weapons);
  if (requireWeapons) {
    if (!weaponCompatibilityMap) {
      throw blockedDataContract('Weapon planning requires the reviewed compatibility map.', {
        issue: 'weapon-compatibility-map-required',
      });
    }
    weapons = Object.fromEntries(Object.entries(catalog.weapons).map(([stableId, raw]) => [
      stableId,
      canonicalizeWeapon(raw, stableId, weaponCompatibilityMap),
    ]));
  }
  const source = deepFreeze({
    name: 'active-game-catalog',
    sourceRef: `catalog:${dataVersion}`,
    dataVersion,
    catalogSha256,
    revision: `${dataVersion}:${catalogSha256}`,
  });
  return deepFreeze({
    source,
    operators,
    weapons,
    equipmentLibrary: cloneJsonValue(catalog.equipmentLibrary || {}),
  });
}

export function sameDefActiveCatalogRevision(left, right) {
  return Boolean(left && right
    && left.dataVersion === right.dataVersion
    && left.catalogSha256 === right.catalogSha256);
}
