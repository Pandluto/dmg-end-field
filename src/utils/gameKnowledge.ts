import gameKnowledge from '../data/gameKnowledge.json';

export interface GameKnowledgeOperatorAlias {
  terms: string[];
  name: string;
}

export interface GameKnowledgeGearSetAlias {
  terms: string[];
  gearSetId: string;
  name: string;
}

export interface GameKnowledgeWeaponAlias {
  terms: string[];
  name: string;
}

export function normalizeGameKnowledgeText(value: string | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-·・.]/g, '');
}

export const GAME_KNOWLEDGE_OPERATOR_ALIASES = gameKnowledge.operatorAliases as GameKnowledgeOperatorAlias[];
export const GAME_KNOWLEDGE_GEAR_SET_ALIASES = gameKnowledge.gearSetAliases as GameKnowledgeGearSetAlias[];
export const GAME_KNOWLEDGE_WEAPON_ALIASES = (gameKnowledge.weaponAliases || []) as GameKnowledgeWeaponAlias[];

export function resolveGameOperatorAlias(value: string | undefined): GameKnowledgeOperatorAlias | null {
  const normalized = normalizeGameKnowledgeText(value);
  if (!normalized) return null;
  return GAME_KNOWLEDGE_OPERATOR_ALIASES.find((entry) => (
    normalizeGameKnowledgeText(entry.name) === normalized ||
    entry.terms.some((term) => normalizeGameKnowledgeText(term) === normalized)
  )) ?? null;
}

export function resolveGameGearSetAlias(value: string | undefined): GameKnowledgeGearSetAlias | null {
  const normalized = normalizeGameKnowledgeText(value);
  if (!normalized) return null;
  return GAME_KNOWLEDGE_GEAR_SET_ALIASES.find((entry) => (
    normalizeGameKnowledgeText(entry.gearSetId) === normalized ||
    normalizeGameKnowledgeText(entry.name) === normalized ||
    entry.terms.some((term) => normalizeGameKnowledgeText(term) === normalized)
  )) ?? null;
}

export function resolveGameWeaponAlias(value: string | undefined): GameKnowledgeWeaponAlias | null {
  const normalized = normalizeGameKnowledgeText(value);
  if (!normalized) return null;
  return GAME_KNOWLEDGE_WEAPON_ALIASES.find((entry) => (
    normalizeGameKnowledgeText(entry.name) === normalized ||
    entry.terms.some((term) => normalizeGameKnowledgeText(term) === normalized)
  )) ?? null;
}

export function buildGameKnowledgePromptLines(): string[] {
  const operatorAliases = GAME_KNOWLEDGE_OPERATOR_ALIASES
    .flatMap((entry) => entry.terms.map((term) => `${term}=${entry.name}`))
    .join(', ');
  const gearAliases = GAME_KNOWLEDGE_GEAR_SET_ALIASES
    .flatMap((entry) => entry.terms.map((term) => `${term}=${entry.gearSetId}(${entry.name})`))
    .join(', ');
  const weaponAliases = GAME_KNOWLEDGE_WEAPON_ALIASES
    .flatMap((entry) => entry.terms.map((term) => `${term}=${entry.name}`))
    .join(', ');
  return [
    '游戏知识: 以下别名和易混词来自项目内 gameKnowledge 词库，命中时直接按映射理解。',
    operatorAliases ? `常见干员别名: ${operatorAliases}。` : '',
    gearAliases ? `常见装备套装别名: ${gearAliases}；命中套装别名时优先用 gearSetId。` : '',
    weaponAliases ? `常见武器别名: ${weaponAliases}。` : '',
  ].filter(Boolean);
}
