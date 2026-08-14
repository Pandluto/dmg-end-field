import type {
  RdpsAttributionSummary,
  RdpsCharacterContribution,
} from './rdpsAttribution.types';

export interface RdpsOverviewPart {
  key: string;
  name: string;
  damage: number;
  shareOfActual: number;
  colorIndex: number;
  kind: 'character' | 'other';
}

export interface RdpsOverviewModel {
  actualTotal: number;
  teamTotal: number;
  otherDamage: number;
  characters: RdpsCharacterContribution[];
  parts: RdpsOverviewPart[];
  canRenderPie: boolean;
}

const CHARACTER_LIMIT = 4;
const OTHER_COLOR_INDEX = 4;

function normalizeRemainder(value: number, actualTotal: number, teamTotal: number): number {
  const tolerance = Math.max(1, Math.abs(actualTotal), Math.abs(teamTotal)) * 1e-9;
  return Math.abs(value) <= tolerance ? 0 : value;
}

/**
 * 图 3 的统一展示口径：四名当前队伍干员都按 actualTotal 计算占比，
 * actualTotal 与四人贡献和之间的差额合并展示为“其他”。
 */
export function buildRdpsOverviewModel(summary: RdpsAttributionSummary): RdpsOverviewModel {
  const characters = summary.characters.slice(0, CHARACTER_LIMIT);
  const teamTotal = characters.reduce((sum, character) => sum + character.damage, 0);
  const otherDamage = normalizeRemainder(summary.actualTotal - teamTotal, summary.actualTotal, teamTotal);
  const shareOfActual = (damage: number) => summary.actualTotal > 0 ? damage / summary.actualTotal : 0;
  const characterParts: RdpsOverviewPart[] = characters.map((character, index) => ({
    key: character.characterId,
    name: character.characterName,
    damage: character.damage,
    shareOfActual: shareOfActual(character.damage),
    colorIndex: index,
    kind: 'character',
  }));
  const parts = otherDamage === 0
    ? characterParts
    : [
        ...characterParts,
        {
          key: 'other',
          name: '其他',
          damage: otherDamage,
          shareOfActual: shareOfActual(otherDamage),
          colorIndex: OTHER_COLOR_INDEX,
          kind: 'other' as const,
        },
      ];

  return {
    actualTotal: summary.actualTotal,
    teamTotal,
    otherDamage,
    characters,
    parts,
    canRenderPie: summary.actualTotal > 0
      && parts.some((part) => part.damage > 0)
      && parts.every((part) => part.damage >= 0),
  };
}
