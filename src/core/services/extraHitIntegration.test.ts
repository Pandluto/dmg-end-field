import { equipmentFillAdapter } from '../../aiCli/equipmentFillAdapter';
import { validateWeaponFillAiDraft } from '../../aiCli/weaponFillAdapter';
import { buildConfigSnapshot } from '../calculators/operatorPanelCalculator';
import { buildSnapshotEquipmentCandidateBuffs, buildSnapshotWeaponCandidateBuffs } from './operatorConfigCandidateBuffService';
import { buildAnomalyDamageSegments } from '../../components/CanvasBoard/skillButtonAnomalyDamage';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const extraHitConfig = {
  key: 'sword-set-hit',
  damageType: 'physical' as const,
  skillType: 'B' as const,
  baseMultiplier: 2.5,
  imbalanceValue: 0,
  cooldownSeconds: 15,
  trigger: 'physicalAbnormal' as const,
};

const weaponValidation = validateWeaponFillAiDraft({
  id: 'weapon-extra-hit',
  name: 'Extra Hit Weapon',
  rarity: 6,
  description: '',
  sourceName: 'test',
  source: 'test',
  skills: {
    skill3: {
      name: 'Skill 3',
      statType: 'atk',
      levels: {},
      effects: {
        effect1: {
          name: 'Triggered hit',
          type: '',
          category: 'passive',
          levels: { '4': 2.5 },
          effectKind: 'extraHit',
          extraHitConfig,
        },
      },
    },
  },
});
assert(weaponValidation.ok, `weapon extraHit should validate: ${weaponValidation.errors.join(', ')}`);

const equipmentValidation = equipmentFillAdapter.validateAiDraft(JSON.stringify({
  gearSets: {
    sword: {
      gearSetId: 'sword',
      name: 'Sword Set',
      equipments: {},
      threePieceBuffs: {
        effect1: {
          effectId: 'effect1',
          name: 'Triggered hit',
          category: 'passive',
          typeKey: '',
          value: 0,
          unit: 'percent',
          effectKind: 'extraHit',
          extraHitConfig,
        },
      },
    },
  },
}));
assert(equipmentValidation.ok, `equipment extraHit should validate: ${equipmentValidation.errors.join(', ')}`);

const snapshot = buildConfigSnapshot({
  operator: {
    id: 'operator', name: 'Operator', level: 90, potential: '0',
    attributes: { level90: { atk: 100, hp: 1000, strength: 10, agility: 10, intelligence: 10, will: 10 } },
  },
  weapon: {
    id: 'weapon-extra-hit', name: 'Extra Hit Weapon',
    config: { level: 90, skillLevels: { skill1: 9, skill2: 9, skill3: 4 } },
    data: { attackGrowth: { '90': 0 }, skills: { skill3: {
      effects: { effect1: { name: 'Triggered hit', type: '', category: 'passive', levels: { '4': 2.5 }, effectKind: 'extraHit', extraHitConfig } },
    } } },
  },
  equipment: {
    pieces: [
      { slotKey: 'a', equipmentId: 'a', name: 'A', effects: [] },
      { slotKey: 'b', equipmentId: 'b', name: 'B', effects: [] },
      { slotKey: 'c', equipmentId: 'c', name: 'C', effects: [] },
    ],
    setBuffs: [],
  },
});

const weaponCandidates = buildSnapshotWeaponCandidateBuffs(snapshot);
assert(weaponCandidates.length === 1, 'weapon extraHit should become one candidate');
assert(weaponCandidates[0].effectKind === 'extraHit', 'weapon candidate should preserve effectKind');
assert(weaponCandidates[0].extraHitConfig?.baseMultiplier === 2.5, 'weapon selected level should drive extraHit multiplier');

const equipmentCandidates = buildSnapshotEquipmentCandidateBuffs(snapshot, {
  gearSets: {
    sword: {
      gearSetId: 'sword', name: 'Sword Set',
      equipments: { a: { equipmentId: 'a' }, b: { equipmentId: 'b' }, c: { equipmentId: 'c' } },
      threePieceBuffs: { effect1: { effectId: 'effect1', name: 'Triggered hit', category: 'passive', effectKind: 'extraHit', extraHitConfig } },
    },
  },
});
assert(equipmentCandidates.length === 1, 'equipment extraHit should become one candidate');
assert(equipmentCandidates[0].extraHitConfig?.cooldownSeconds === 15, 'equipment candidate should preserve cooldown');

const damageSegments = buildAnomalyDamageSegments({
  panelBase: null,
  panelData: { atk: 1000, critRate: 0, critDmg: 0.5 },
  hitCards: [],
  selectedAnomalyDamages: [],
  buttonCharacterId: 'operator',
  damageBonus: { skillDmgBonus: 0.2, allSkillDmgBonus: 0.1 } as never,
  fullCombinedModifierBuffList: [],
  extraHitBuffList: [{
    id: 'extra-hit', name: 'extra-hit', displayName: 'Triggered hit', level: '', source: 'test', sourceName: 'test', refCount: 1,
    effectKind: 'extraHit', extraHitConfig,
  }],
  manuallyDisabledBuffIdsBySegmentKey: {},
  getEffectiveCharacterSourceSkillBoost: () => 0,
});
assert(damageSegments.length === 1, 'selected extraHit should create an independent damage segment');
assert(damageSegments[0].multiplierText === '250.0%', 'extraHit segment should use configured multiplier');
assert(damageSegments[0].skillTypeText === 'B', 'extraHit segment should preserve its skill damage type');
assert(damageSegments[0].nonCritText === '1625', 'extraHit segment should apply the selected skill damage bonus');
