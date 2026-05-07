import type { SkillType } from '../../types';
import type { AnomalyStateSnapshot, PersistedAnomalyCard, SkillButtonBuff } from '../../types/storage';

const COMBO_SKILL_BONUS_BY_LEVEL = [0.3, 0.45, 0.6, 0.75];
const COMBO_ULTIMATE_BONUS_BY_LEVEL = [0.2, 0.3, 0.4, 0.5];
const IMBALANCE_FIXED_BONUS = 0.3;

export function buildAnomalyStateDerivedBuffs(
  cards: Array<Pick<PersistedAnomalyCard, 'id' | 'key' | 'label' | 'primaryText' | 'level'>>,
  buttonSkillType: SkillType | string
): SkillButtonBuff[] {
  return cards.flatMap((card) => {
    if (card.key === 'combo-state') {
      const levelIndex = Math.min(Math.max((card.level || 1) - 1, 0), 3);
      const comboValue = buttonSkillType === 'B'
        ? COMBO_SKILL_BONUS_BY_LEVEL[levelIndex]
        : buttonSkillType === 'Q'
          ? COMBO_ULTIMATE_BONUS_BY_LEVEL[levelIndex]
          : 0;

      if (comboValue <= 0) {
        return [];
      }

      return [{
        id: `anomaly-state-${card.id}`,
        name: card.key,
        displayName: '连击',
        sourceName: card.primaryText || card.label || '连击',
        level: `${card.level || 1}层`,
        type: 'comboDamageBonus',
        value: comboValue,
        description: '连击增伤区',
        source: 'anomaly_state',
        condition: '状态区入口',
        refCount: 1,
        target: { mode: 'all' },
      }];
    }

    return [{
      id: `anomaly-state-${card.id}`,
      name: card.key,
      displayName: '失衡',
      sourceName: card.primaryText || card.label || '失衡',
      level: '',
      type: 'imbalanceDmgBonus',
      value: IMBALANCE_FIXED_BONUS,
      description: '固定失衡区 30%',
      source: 'anomaly_state',
      condition: '状态区固定入口',
      refCount: 1,
      target: { mode: 'all' },
    }];
  });
}

export function buildAnomalyStateSnapshotBuffs(
  snapshots: AnomalyStateSnapshot[]
): SkillButtonBuff[] {
  return snapshots.flatMap((snapshot): SkillButtonBuff[] => {
    if (snapshot.key === 'conductive') {
      return [{
        id: `anomaly-state-snapshot-${snapshot.id}`,
        name: snapshot.key,
        displayName: '导电',
        sourceName: snapshot.sourceCharacterName,
        level: `${snapshot.level}层`,
        type: 'magicTakenDmgBonus',
        value: snapshot.effectValue,
        description: '导电提供法术易伤',
        source: 'anomaly_state_snapshot',
        condition: '异常状态快照',
        refCount: 1,
        target: { mode: 'all' },
      }];
    }

    if (snapshot.key === 'armor-break') {
      return [{
        id: `anomaly-state-snapshot-${snapshot.id}`,
        name: snapshot.key,
        displayName: '碎甲',
        sourceName: snapshot.sourceCharacterName,
        level: `${snapshot.level}层`,
        type: 'physicalFragile',
        value: snapshot.effectValue,
        description: '碎甲提供物伤易伤',
        source: 'anomaly_state_snapshot',
        condition: '异常状态快照',
        refCount: 1,
        target: { mode: 'all' },
      }];
    }

    return [];
  });
}
