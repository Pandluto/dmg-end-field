import type { CandidateBuff } from '../core/domain/buff';

export interface WeaponArchiveSkillLevelData {
  value?: number;
  description?: string;
  passive?: Record<string, number>;
  effects?: Record<string, number>;
}

export interface WeaponArchiveSkillData {
  name?: string;
  statType?: string;
  levels?: Record<string, WeaponArchiveSkillLevelData>;
}

export interface WeaponArchiveData {
  name: string;
  attackGrowth?: Record<string, number>;
  skills?: Record<string, WeaponArchiveSkillData>;
}

interface WeaponCandidateBuffData {
  displayName?: string;
  level?: string;
  condition?: string;
  description?: string;
  type?: string;
  value?: number;
}

export interface WeaponBuffData {
  name: string;
  buffs?: WeaponCandidateBuffData[];
}

const weaponModules = import.meta.glob('../../data/weapons/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, WeaponArchiveData>;

const weaponArchiveMap: Record<string, WeaponArchiveData> = Object.values(weaponModules).reduce((acc, entry) => {
  if (entry?.name) {
    acc[entry.name] = entry;
  }
  return acc;
}, {} as Record<string, WeaponArchiveData>);

function buildConditionBuffs(weaponName: string, weaponData: WeaponArchiveData): WeaponCandidateBuffData[] {
  const skill3 = weaponData.skills?.skill3;
  if (!skill3?.levels) {
    return [];
  }

  return Object.entries(skill3.levels).flatMap(([level, levelData]) => {
    const result: WeaponCandidateBuffData[] = [];
    const effectMap = levelData.effects ?? {};
    const passiveMap = levelData.passive ?? {};
    const description = levelData.description;

    Object.entries({ ...passiveMap, ...effectMap }).forEach(([type, value]) => {
      if (typeof value !== 'number') {
        return;
      }
      result.push({
        displayName: `${skill3.name ?? weaponName} Lv${level}`,
        level: `Lv${level}`,
        condition: '武器效果',
        description: description ?? `${type} ${value}`,
        type,
        value,
      });
    });

    if (description) {
      result.push({
        displayName: `${skill3.name ?? weaponName} 条件效果`,
        level: `Lv${level}`,
        condition: '武器条件效果',
        description,
      });
    }

    return result;
  });
}

export function getAllWeaponNames(): string[] {
  return Object.keys(weaponArchiveMap);
}

export function getWeaponArchiveData(weaponName: string): WeaponArchiveData | null {
  return weaponArchiveMap[weaponName] ?? null;
}

export function getWeaponBuffData(weaponName: string): WeaponBuffData | null {
  const weaponData = getWeaponArchiveData(weaponName);
  if (!weaponData) {
    return null;
  }
  return {
    name: weaponData.name,
    buffs: buildConditionBuffs(weaponName, weaponData),
  };
}

export function buildWeaponCandidateBuffs(weaponName: string): CandidateBuff[] {
  const weaponBuffData = getWeaponBuffData(weaponName);
  if (!weaponBuffData?.buffs?.length) {
    return [];
  }

  return weaponBuffData.buffs.map((buff, index) => ({
    displayName: buff.displayName ?? `${weaponName} Buff ${index + 1}`,
    name: `${weaponName}-buff-${index + 1}`,
    level: buff.level ?? '',
    value: buff.value,
    type: buff.type,
    source: weaponName,
    sourceName: weaponName,
    ownerBuffDomain: 'weapon',
    ownerBuffGroup: 'weaponSkill',
    description: buff.description ?? '',
    condition: buff.condition,
  }));
}
