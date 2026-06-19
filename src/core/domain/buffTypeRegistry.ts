export type SupportedBuffZone =
  | 'damageBonus'
  | 'fragile'
  | 'vulnerability'
  | 'amplify'
  | 'skillMultiplier';

export type BuffTypeMatchRule =
  | { kind: 'all' }
  | { kind: 'skillTypes'; skillTypes: Array<'A' | 'B' | 'E' | 'Q' | 'Dot'> }
  | { kind: 'physical' }
  | { kind: 'magic' }
  | { kind: 'element'; element: 'fire' | 'electric' | 'ice' | 'nature' }
  | { kind: 'skillType'; skillType: 'A' | 'B' | 'E' | 'Q' | 'Dot' };

export type BuffTypeValueStyle = 'ratio' | 'multiplier';

export interface BuffTypeRegistryEntry {
  type: string;
  zone: SupportedBuffZone;
  match: BuffTypeMatchRule;
  allowMultiplier: boolean;
  valueStyle: BuffTypeValueStyle;
}

const entries: BuffTypeRegistryEntry[] = [
  { type: 'physicalDmgBonus', zone: 'damageBonus', match: { kind: 'physical' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'magicDmgBonus', zone: 'damageBonus', match: { kind: 'magic' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'allElementDmgBonus', zone: 'damageBonus', match: { kind: 'magic' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'fireDmgBonus', zone: 'damageBonus', match: { kind: 'element', element: 'fire' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'electricDmgBonus', zone: 'damageBonus', match: { kind: 'element', element: 'electric' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'iceDmgBonus', zone: 'damageBonus', match: { kind: 'element', element: 'ice' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'natureDmgBonus', zone: 'damageBonus', match: { kind: 'element', element: 'nature' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'allDmgBonus', zone: 'damageBonus', match: { kind: 'all' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'normalAttackDmgBonus', zone: 'damageBonus', match: { kind: 'skillType', skillType: 'A' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'skillDmgBonus', zone: 'damageBonus', match: { kind: 'skillType', skillType: 'B' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'chainSkillDmgBonus', zone: 'damageBonus', match: { kind: 'skillType', skillType: 'E' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'ultimateDmgBonus', zone: 'damageBonus', match: { kind: 'skillType', skillType: 'Q' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'dotDmgBonus', zone: 'damageBonus', match: { kind: 'skillType', skillType: 'Dot' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'allSkillDmgBonus', zone: 'damageBonus', match: { kind: 'skillTypes', skillTypes: ['B', 'E', 'Q'] }, allowMultiplier: true, valueStyle: 'ratio' },

  { type: 'physicalFragile', zone: 'fragile', match: { kind: 'physical' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'magicFragile', zone: 'fragile', match: { kind: 'magic' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'fireFragile', zone: 'fragile', match: { kind: 'element', element: 'fire' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'electricFragile', zone: 'fragile', match: { kind: 'element', element: 'electric' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'iceFragile', zone: 'fragile', match: { kind: 'element', element: 'ice' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'natureFragile', zone: 'fragile', match: { kind: 'element', element: 'nature' }, allowMultiplier: true, valueStyle: 'ratio' },

  { type: 'physicalVulnerability', zone: 'vulnerability', match: { kind: 'physical' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'magicVulnerability', zone: 'vulnerability', match: { kind: 'magic' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'fireVulnerability', zone: 'vulnerability', match: { kind: 'element', element: 'fire' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'electricVulnerability', zone: 'vulnerability', match: { kind: 'element', element: 'electric' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'iceVulnerability', zone: 'vulnerability', match: { kind: 'element', element: 'ice' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'natureVulnerability', zone: 'vulnerability', match: { kind: 'element', element: 'nature' }, allowMultiplier: true, valueStyle: 'ratio' },

  { type: 'physicalAmplify', zone: 'amplify', match: { kind: 'physical' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'magicAmplify', zone: 'amplify', match: { kind: 'magic' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'fireAmplify', zone: 'amplify', match: { kind: 'element', element: 'fire' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'electricAmplify', zone: 'amplify', match: { kind: 'element', element: 'electric' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'iceAmplify', zone: 'amplify', match: { kind: 'element', element: 'ice' }, allowMultiplier: true, valueStyle: 'ratio' },
  { type: 'natureAmplify', zone: 'amplify', match: { kind: 'element', element: 'nature' }, allowMultiplier: true, valueStyle: 'ratio' },

  { type: 'multiplierBonus', zone: 'skillMultiplier', match: { kind: 'all' }, allowMultiplier: true, valueStyle: 'ratio' },
];

const abilityMultiplierTypes = new Set([
  'mainStatBoost',
  'subStatBoost',
  'allStatBoost',
  'strengthBoost',
  'agilityBoost',
  'intelligenceBoost',
  'willBoost',
]);

export const BUFF_TYPE_REGISTRY: ReadonlyMap<string, BuffTypeRegistryEntry> = new Map(
  entries.map((entry) => [entry.type, Object.freeze(entry)])
);

export function getBuffTypeRegistryEntry(type: string | undefined): BuffTypeRegistryEntry | undefined {
  return type ? BUFF_TYPE_REGISTRY.get(type) : undefined;
}

export function isMultiplierSupportedBuffType(type: string | undefined): boolean {
  return Boolean(type && abilityMultiplierTypes.has(type))
    || getBuffTypeRegistryEntry(type)?.allowMultiplier === true;
}

export function getMultiplierSupportedBuffTypes(): string[] {
  return [
    ...[...BUFF_TYPE_REGISTRY.values()]
      .filter((entry) => entry.allowMultiplier)
      .map((entry) => entry.type),
    ...abilityMultiplierTypes,
  ];
}
