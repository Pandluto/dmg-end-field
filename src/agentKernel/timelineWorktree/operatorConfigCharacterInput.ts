import type { ConfigSnapshot } from '../../core/calculators/operatorPanelCalculator';
import type { CharacterInputConfig, SkillLevelMode } from '../../types/storage';

const DEFAULT_SKILL_LEVELS: CharacterInputConfig['skillLevels'] = {
  A: 'L9',
  B: 'L9',
  E: 'L9',
  Q: 'L9',
  Dot: 'M3',
};

function normalizeSkillLevel(value: unknown, fallback: SkillLevelMode): SkillLevelMode {
  return value === 'L9' || value === 'M3' ? value : fallback;
}

export function buildPersistedCharacterInput(
  snapshot: ConfigSnapshot,
  previous?: Partial<CharacterInputConfig> | null,
): CharacterInputConfig {
  const operatorIsMaxPotential = snapshot.operator.potential === '满潜'
    || Number(snapshot.operator.potentialCount) >= 6;
  const weaponIsMaxPotential = snapshot.weapon.config.potential === '满潜'
    || Number(snapshot.weapon.config.potentialCount) >= 6;
  const previousWeaponName = previous?.weapon?.name?.trim() || '';

  return {
    potential: operatorIsMaxPotential ? '满潜' : '0潜',
    skillLevels: {
      A: normalizeSkillLevel(snapshot.operator.skillConfig.A, DEFAULT_SKILL_LEVELS.A),
      B: normalizeSkillLevel(snapshot.operator.skillConfig.B, DEFAULT_SKILL_LEVELS.B),
      E: normalizeSkillLevel(snapshot.operator.skillConfig.E, DEFAULT_SKILL_LEVELS.E),
      Q: normalizeSkillLevel(snapshot.operator.skillConfig.Q, DEFAULT_SKILL_LEVELS.Q),
      Dot: normalizeSkillLevel(snapshot.operator.skillConfig.Dot, DEFAULT_SKILL_LEVELS.Dot),
    },
    weapon: {
      // The v3 input contract uses a non-empty sentinel for an empty slot.
      // Detailed weapon identity remains authoritative in ConfigSnapshot.
      name: snapshot.weapon.name.trim() || previousWeaponName || '无',
      potentialMode: weaponIsMaxPotential ? 'PMAX' : 'P0',
    },
    equipment: { ...(previous?.equipment ?? {}) },
  };
}
