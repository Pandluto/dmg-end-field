import type { BuffExtraHitDamageType, BuffExtraHitTrigger } from '../core/domain/buff';

export type BuffModifierType =
  | 'atkPercentBoost'
  | 'flatAtk'
  | 'mainStatBoost'
  | 'subStatBoost'
  | 'allStatBoost'
  | 'strengthBoost'
  | 'agilityBoost'
  | 'intelligenceBoost'
  | 'willBoost'
  | 'critRateBoost'
  | 'critDmgBonusBoost'
  | 'physicalDmgBonus'
  | 'magicDmgBonus'
  | 'fireDmgBonus'
  | 'electricDmgBonus'
  | 'iceDmgBonus'
  | 'natureDmgBonus'
  | 'allDmgBonus'
  | 'allElementDmgBonus'
  | 'skillDmgBonus'
  | 'chainSkillDmgBonus'
  | 'ultimateDmgBonus'
  | 'normalAttackDmgBonus'
  | 'allSkillDmgBonus'
  | 'physicalFragile'
  | 'fireFragile'
  | 'electricFragile'
  | 'iceFragile'
  | 'natureFragile'
  | 'magicFragile'
  | 'physicalVulnerability'
  | 'fireVulnerability'
  | 'electricVulnerability'
  | 'iceVulnerability'
  | 'natureVulnerability'
  | 'magicTakenDmgBonus'
  | 'physicalAmplify'
  | 'magicAmplify'
  | 'fireAmplify'
  | 'electricAmplify'
  | 'iceAmplify'
  | 'natureAmplify'
  | 'comboDamageBonus'
  | 'multiplierBonus'
  | 'multiplierMultiplier'
  | 'sourceSkillBoost';

export type BuffValueStyle = 'ratio' | 'flat' | 'multiplier';

export interface BuffTypeCatalogEntry {
  id: BuffModifierType;
  label: string;
  valueStyle: BuffValueStyle;
  aliases: string[];
  positivePatterns: string[];
  negativePatterns: string[];
  examplePhrases: string[];
  notes: string;
  canInferFromImplicitText: boolean;
}

export interface BuffExtraHitCatalogRule {
  trigger: BuffExtraHitTrigger;
  allowedDamageTypes: BuffExtraHitDamageType[];
  positivePatterns: string[];
  negativePatterns: string[];
  notes: string;
}

function createEntry(entry: BuffTypeCatalogEntry): BuffTypeCatalogEntry {
  return entry;
}

export const BUFF_TYPE_CATALOG: readonly BuffTypeCatalogEntry[] = [
  createEntry({
    id: 'atkPercentBoost',
    label: '攻击力百分比',
    valueStyle: 'ratio',
    aliases: ['攻击提升', '攻击力提升', '攻击力提高', 'atk%'],
    positivePatterns: ['攻击力提升', '攻击提高', '攻击增加'],
    negativePatterns: ['造成攻击', '攻击目标'],
    examplePhrases: ['攻击力提高20%', '提升攻击15%'],
    notes: '只用于明确的攻击力百分比提升。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'flatAtk',
    label: '固定攻击力',
    valueStyle: 'flat',
    aliases: ['固定攻击', '攻击力+', '攻击加值'],
    positivePatterns: ['攻击力+', '攻击力增加100', '固定攻击'],
    negativePatterns: ['攻击力提升20%'],
    examplePhrases: ['攻击力+120', '增加100点攻击力'],
    notes: '只用于固定数值，不用于百分比。',
    canInferFromImplicitText: false,
  }),
  createEntry({
    id: 'mainStatBoost',
    label: '主能力提升',
    valueStyle: 'ratio',
    aliases: ['主能力', '主属性', '主词条'],
    positivePatterns: ['主能力提升', '主属性提升'],
    negativePatterns: ['力量提升', '敏捷提升', '智识提升', '意志提升'],
    examplePhrases: ['主属性提高12%'],
    notes: '只在文本明确写主能力时使用。',
    canInferFromImplicitText: false,
  }),
  createEntry({
    id: 'subStatBoost',
    label: '副能力提升',
    valueStyle: 'ratio',
    aliases: ['副能力', '副属性', '副词条'],
    positivePatterns: ['副能力提升', '副属性提升'],
    negativePatterns: ['主能力提升'],
    examplePhrases: ['副属性提升18%'],
    notes: '只在文本明确写副能力时使用。',
    canInferFromImplicitText: false,
  }),
  createEntry({
    id: 'allStatBoost',
    label: '全属性提升',
    valueStyle: 'ratio',
    aliases: ['全属性', '全能力', '全属性提高'],
    positivePatterns: ['全属性提升', '全能力提升'],
    negativePatterns: ['攻击力提升', '力量提升'],
    examplePhrases: ['全属性提高10%'],
    notes: '用于覆盖多项基础属性的统一提升。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'strengthBoost',
    label: '力量提升',
    valueStyle: 'ratio',
    aliases: ['力量', '力属性'],
    positivePatterns: ['力量提升', '力量提高'],
    negativePatterns: ['全属性提升'],
    examplePhrases: ['力量提高15%'],
    notes: '仅映射明确的力量提升。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'agilityBoost',
    label: '敏捷提升',
    valueStyle: 'ratio',
    aliases: ['敏捷', '敏捷属性'],
    positivePatterns: ['敏捷提升', '敏捷提高'],
    negativePatterns: ['全属性提升'],
    examplePhrases: ['敏捷提高15%'],
    notes: '仅映射明确的敏捷提升。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'intelligenceBoost',
    label: '智识提升',
    valueStyle: 'ratio',
    aliases: ['智识', '智力', '智能'],
    positivePatterns: ['智识提升', '智识提高'],
    negativePatterns: ['全属性提升'],
    examplePhrases: ['智识提高18%'],
    notes: '仅映射明确的智识提升。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'willBoost',
    label: '意志提升',
    valueStyle: 'ratio',
    aliases: ['意志', '意志属性'],
    positivePatterns: ['意志提升', '意志提高'],
    negativePatterns: ['全属性提升'],
    examplePhrases: ['意志提高12%'],
    notes: '仅映射明确的意志提升。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'critRateBoost',
    label: '暴击率',
    valueStyle: 'ratio',
    aliases: ['暴击率', '暴击几率', '暴击'],
    positivePatterns: ['暴击率提升', '暴击率提高'],
    negativePatterns: ['暴击伤害', '暴击伤害提高'],
    examplePhrases: ['暴击率提高10%'],
    notes: '用于暴击率提升，不用于暴伤。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'critDmgBonusBoost',
    label: '暴击伤害',
    valueStyle: 'ratio',
    aliases: ['暴伤', '暴击伤害'],
    positivePatterns: ['暴击伤害提升', '暴伤提高'],
    negativePatterns: ['暴击率提高'],
    examplePhrases: ['暴击伤害提升25%'],
    notes: '用于暴击伤害提升。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'physicalDmgBonus',
    label: '物理伤害加成',
    valueStyle: 'ratio',
    aliases: ['物伤', '物理增伤'],
    positivePatterns: ['物理伤害提高', '物伤提升'],
    negativePatterns: ['物理易伤', '物理脆弱'],
    examplePhrases: ['物理伤害提高20%'],
    notes: '仅用于己方物理伤害加成。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'magicDmgBonus',
    label: '法术伤害加成',
    valueStyle: 'ratio',
    aliases: ['法伤', '法术增伤', '魔法伤害'],
    positivePatterns: ['法术伤害提高', '法伤提升'],
    negativePatterns: ['法术易伤', '法术脆弱'],
    examplePhrases: ['法术伤害提高20%'],
    notes: '仅用于己方法术伤害加成。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'fireDmgBonus',
    label: '灼热伤害加成',
    valueStyle: 'ratio',
    aliases: ['灼热增伤', '火伤', '火属性伤害'],
    positivePatterns: ['灼热伤害提高', '火伤提升'],
    negativePatterns: ['灼热易伤', '灼热脆弱'],
    examplePhrases: ['灼热伤害提高18%'],
    notes: '仅用于己方灼热伤害加成。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'electricDmgBonus',
    label: '电磁伤害加成',
    valueStyle: 'ratio',
    aliases: ['电伤', '电磁增伤', '雷伤'],
    positivePatterns: ['电磁伤害提高', '电伤提升'],
    negativePatterns: ['电磁易伤', '电磁脆弱'],
    examplePhrases: ['电磁伤害提高18%'],
    notes: '仅用于己方电磁伤害加成。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'iceDmgBonus',
    label: '寒冷伤害加成',
    valueStyle: 'ratio',
    aliases: ['冰伤', '寒冷增伤'],
    positivePatterns: ['寒冷伤害提高', '冰伤提升'],
    negativePatterns: ['寒冷易伤', '寒冷脆弱'],
    examplePhrases: ['寒冷伤害提高18%'],
    notes: '仅用于己方寒冷伤害加成。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'natureDmgBonus',
    label: '自然伤害加成',
    valueStyle: 'ratio',
    aliases: ['自然增伤', '自然伤害'],
    positivePatterns: ['自然伤害提高', '自然伤害提升'],
    negativePatterns: ['自然易伤', '自然脆弱'],
    examplePhrases: ['自然伤害提高18%'],
    notes: '仅用于己方自然伤害加成。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'allDmgBonus',
    label: '全伤害加成',
    valueStyle: 'ratio',
    aliases: ['所有伤害加成', '所有伤害提高', '全伤害增伤', '通用增伤'],
    positivePatterns: ['全伤害提高', '所有伤害提高', '造成的伤害提高'],
    negativePatterns: ['全元素伤害提高', '元素伤害提高', '受到的伤害提高'],
    examplePhrases: ['造成的所有伤害提高15%', '全伤害提高12%'],
    notes: '覆盖物理与所有元素/法术伤害；不要用于“受到的伤害提高”。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'allElementDmgBonus',
    label: '全元素伤害加成（旧字段）',
    valueStyle: 'ratio',
    aliases: ['全元素增伤', '元素伤害提高', '元素增伤'],
    positivePatterns: ['全元素伤害提高', '元素伤害提高'],
    negativePatterns: ['物理伤害提高'],
    examplePhrases: ['元素伤害提高15%'],
    notes: '旧字段；新链路优先使用 magicDmgBonus 表达元素/法术总加成。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'skillDmgBonus',
    label: '战技伤害加成',
    valueStyle: 'ratio',
    aliases: ['战技增伤', '技能增伤'],
    positivePatterns: ['战技伤害提高', '战技增伤'],
    negativePatterns: ['连携技伤害提高', '终结技伤害提高', '全技能伤害提高'],
    examplePhrases: ['战技伤害提高20%'],
    notes: '只用于战技本身。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'chainSkillDmgBonus',
    label: '连携技伤害加成',
    valueStyle: 'ratio',
    aliases: ['连携技增伤', '连携伤害'],
    positivePatterns: ['连携技伤害提高', '连携技增伤'],
    negativePatterns: ['战技伤害提高', '全技能伤害提高'],
    examplePhrases: ['连携技伤害提高20%'],
    notes: '只用于连携技。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'ultimateDmgBonus',
    label: '终结技伤害加成',
    valueStyle: 'ratio',
    aliases: ['终结技增伤', '大招增伤'],
    positivePatterns: ['终结技伤害提高', '终结技增伤'],
    negativePatterns: ['战技伤害提高', '全技能伤害提高'],
    examplePhrases: ['终结技伤害提高25%'],
    notes: '只用于终结技。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'normalAttackDmgBonus',
    label: '普攻伤害加成',
    valueStyle: 'ratio',
    aliases: ['普攻增伤', '普通攻击增伤'],
    positivePatterns: ['普攻伤害提高', '普通攻击伤害提高'],
    negativePatterns: ['战技伤害提高', '全技能伤害提高'],
    examplePhrases: ['普攻伤害提高15%'],
    notes: '只用于普通攻击。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'allSkillDmgBonus',
    label: '全技能伤害加成',
    valueStyle: 'ratio',
    aliases: ['全技能增伤', '技能伤害提高'],
    positivePatterns: ['全技能伤害提高', '技能伤害提高'],
    negativePatterns: ['战技伤害提高', '终结技伤害提高', '连携技伤害提高'],
    examplePhrases: ['技能伤害提高12%'],
    notes: '仅在文本明确指向所有技能时使用。',
    canInferFromImplicitText: false,
  }),
  createEntry({
    id: 'physicalFragile',
    label: '物伤易伤',
    valueStyle: 'ratio',
    aliases: ['物伤易伤', '物理受伤增加'],
    positivePatterns: ['受到的物理伤害提高', '物伤易伤'],
    negativePatterns: ['物理伤害提高', '物理增幅'],
    examplePhrases: ['目标受到的物理伤害提高20%'],
    notes: '目标承伤类，不是己方增伤。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'fireFragile',
    label: '灼热脆弱',
    valueStyle: 'ratio',
    aliases: ['灼热脆弱', '火脆弱'],
    positivePatterns: ['灼热脆弱', '灼热抗性降低'],
    negativePatterns: ['灼热伤害提高'],
    examplePhrases: ['目标陷入灼热脆弱，受到灼热伤害提高20%'],
    notes: '偏向脆弱描述。',
    canInferFromImplicitText: false,
  }),
  createEntry({
    id: 'electricFragile',
    label: '电磁脆弱',
    valueStyle: 'ratio',
    aliases: ['电磁脆弱', '电脆弱'],
    positivePatterns: ['电磁脆弱', '电磁抗性降低'],
    negativePatterns: ['电磁伤害提高'],
    examplePhrases: ['电磁脆弱20%'],
    notes: '偏向脆弱描述。',
    canInferFromImplicitText: false,
  }),
  createEntry({
    id: 'iceFragile',
    label: '寒冷脆弱',
    valueStyle: 'ratio',
    aliases: ['寒冷脆弱', '冰脆弱'],
    positivePatterns: ['寒冷脆弱', '寒冷抗性降低'],
    negativePatterns: ['寒冷伤害提高'],
    examplePhrases: ['寒冷脆弱20%'],
    notes: '偏向脆弱描述。',
    canInferFromImplicitText: false,
  }),
  createEntry({
    id: 'natureFragile',
    label: '自然脆弱',
    valueStyle: 'ratio',
    aliases: ['自然脆弱'],
    positivePatterns: ['自然脆弱', '自然抗性降低'],
    negativePatterns: ['自然伤害提高'],
    examplePhrases: ['自然脆弱20%'],
    notes: '偏向脆弱描述。',
    canInferFromImplicitText: false,
  }),
  createEntry({
    id: 'magicFragile',
    label: '法术脆弱',
    valueStyle: 'ratio',
    aliases: ['法术脆弱', '法脆弱'],
    positivePatterns: ['法术脆弱', '法术抗性降低'],
    negativePatterns: ['法术伤害提高'],
    examplePhrases: ['法术脆弱20%'],
    notes: '偏向脆弱描述。',
    canInferFromImplicitText: false,
  }),
  createEntry({
    id: 'physicalVulnerability',
    label: '物理脆弱',
    valueStyle: 'ratio',
    aliases: ['物理脆弱', '物理易伤'],
    positivePatterns: ['物理脆弱', '物理易伤'],
    negativePatterns: ['物理伤害提高', '物理增幅'],
    examplePhrases: ['目标物理脆弱15%'],
    notes: '目标端的物理承伤提升。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'fireVulnerability',
    label: '灼热易伤',
    valueStyle: 'ratio',
    aliases: ['灼热易伤', '火易伤'],
    positivePatterns: ['灼热易伤', '受到的灼热伤害提高'],
    negativePatterns: ['灼热伤害提高'],
    examplePhrases: ['目标受到的灼热伤害提高18%'],
    notes: '目标端承伤。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'electricVulnerability',
    label: '电磁易伤',
    valueStyle: 'ratio',
    aliases: ['电磁易伤', '电易伤'],
    positivePatterns: ['电磁易伤', '受到的电磁伤害提高'],
    negativePatterns: ['电磁伤害提高'],
    examplePhrases: ['目标受到的电磁伤害提高18%'],
    notes: '目标端承伤。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'iceVulnerability',
    label: '寒冷易伤',
    valueStyle: 'ratio',
    aliases: ['寒冷易伤', '冰易伤'],
    positivePatterns: ['寒冷易伤', '受到的寒冷伤害提高'],
    negativePatterns: ['寒冷伤害提高'],
    examplePhrases: ['目标受到的寒冷伤害提高18%'],
    notes: '目标端承伤。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'natureVulnerability',
    label: '自然易伤',
    valueStyle: 'ratio',
    aliases: ['自然易伤'],
    positivePatterns: ['自然易伤', '受到的自然伤害提高'],
    negativePatterns: ['自然伤害提高'],
    examplePhrases: ['目标受到的自然伤害提高18%'],
    notes: '目标端承伤。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'magicTakenDmgBonus',
    label: '法术易伤',
    valueStyle: 'ratio',
    aliases: ['法术易伤', '法易伤'],
    positivePatterns: ['法术易伤', '受到的法术伤害提高'],
    negativePatterns: ['法术伤害提高'],
    examplePhrases: ['目标受到的法术伤害提高18%'],
    notes: '目标端法术承伤。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'physicalAmplify',
    label: '物理增幅',
    valueStyle: 'ratio',
    aliases: ['物理增幅', '物理放大'],
    positivePatterns: ['物理增幅', '物理伤害增幅'],
    negativePatterns: ['物理伤害提高', '物理易伤'],
    examplePhrases: ['物理增幅15%'],
    notes: '仅在文本明确写增幅时使用。',
    canInferFromImplicitText: false,
  }),
  createEntry({
    id: 'magicAmplify',
    label: '法术增幅',
    valueStyle: 'ratio',
    aliases: ['法术增幅', '法术放大'],
    positivePatterns: ['法术增幅', '法术伤害增幅'],
    negativePatterns: ['法术伤害提高', '法术易伤'],
    examplePhrases: ['法术增幅15%'],
    notes: '仅在文本明确写增幅时使用。',
    canInferFromImplicitText: false,
  }),
  createEntry({
    id: 'fireAmplify',
    label: '灼热增幅',
    valueStyle: 'ratio',
    aliases: ['灼热增幅', '火增幅'],
    positivePatterns: ['灼热增幅', '灼热伤害增幅'],
    negativePatterns: ['灼热伤害提高', '灼热易伤'],
    examplePhrases: ['灼热增幅15%'],
    notes: '仅在文本明确写增幅时使用。',
    canInferFromImplicitText: false,
  }),
  createEntry({
    id: 'electricAmplify',
    label: '电磁增幅',
    valueStyle: 'ratio',
    aliases: ['电磁增幅', '电增幅'],
    positivePatterns: ['电磁增幅', '电磁伤害增幅'],
    negativePatterns: ['电磁伤害提高', '电磁易伤'],
    examplePhrases: ['电磁增幅15%'],
    notes: '仅在文本明确写增幅时使用。',
    canInferFromImplicitText: false,
  }),
  createEntry({
    id: 'iceAmplify',
    label: '寒冷增幅',
    valueStyle: 'ratio',
    aliases: ['寒冷增幅', '冰增幅'],
    positivePatterns: ['寒冷增幅', '寒冷伤害增幅'],
    negativePatterns: ['寒冷伤害提高', '寒冷易伤'],
    examplePhrases: ['寒冷增幅15%'],
    notes: '仅在文本明确写增幅时使用。',
    canInferFromImplicitText: false,
  }),
  createEntry({
    id: 'natureAmplify',
    label: '自然增幅',
    valueStyle: 'ratio',
    aliases: ['自然增幅'],
    positivePatterns: ['自然增幅', '自然伤害增幅'],
    negativePatterns: ['自然伤害提高', '自然易伤'],
    examplePhrases: ['自然增幅15%'],
    notes: '仅在文本明确写增幅时使用。',
    canInferFromImplicitText: false,
  }),
  createEntry({
    id: 'comboDamageBonus',
    label: '连击伤害加成',
    valueStyle: 'ratio',
    aliases: ['连击增伤', '连击伤害提高'],
    positivePatterns: ['连击伤害提高', '连击伤害增加'],
    negativePatterns: ['连携技伤害提高'],
    examplePhrases: ['连击伤害提高12%'],
    notes: '仅映射连击本身。',
    canInferFromImplicitText: true,
  }),
  createEntry({
    id: 'multiplierBonus',
    label: '倍率加算',
    valueStyle: 'multiplier',
    aliases: ['倍率加算', '倍率增加', '倍率加成'],
    positivePatterns: ['倍率提高', '倍率增加', '技能倍率增加'],
    negativePatterns: ['倍率乘算', '最终倍率乘算'],
    examplePhrases: ['技能倍率增加0.3', '倍率提高30%'],
    notes: '只在文本明确提倍率、系数时使用。',
    canInferFromImplicitText: false,
  }),
  createEntry({
    id: 'multiplierMultiplier',
    label: '倍率乘算',
    valueStyle: 'multiplier',
    aliases: ['倍率乘算', '最终倍率提高'],
    positivePatterns: ['倍率乘算', '最终倍率提高'],
    negativePatterns: ['倍率加算', '倍率增加'],
    examplePhrases: ['最终倍率乘算提高20%'],
    notes: '只在文本明确写乘算时使用。',
    canInferFromImplicitText: false,
  }),
  createEntry({
    id: 'sourceSkillBoost',
    label: '源石技艺强度',
    valueStyle: 'ratio',
    aliases: ['源石技艺强度', '技艺强度', '记忆强度'],
    positivePatterns: ['源石技艺强度提升', '技艺强度提高'],
    negativePatterns: ['技能伤害提高'],
    examplePhrases: ['源石技艺强度提高15%'],
    notes: '只在文本明确指向源石技艺强度时使用。',
    canInferFromImplicitText: false,
  }),
] as const;

export const BUFF_TYPE_CATALOG_BY_ID: Readonly<Record<BuffModifierType, BuffTypeCatalogEntry>> =
  BUFF_TYPE_CATALOG.reduce((acc, entry) => {
    acc[entry.id] = entry;
    return acc;
  }, {} as Record<BuffModifierType, BuffTypeCatalogEntry>);

export const BUFF_MODIFIER_TYPE_IDS = BUFF_TYPE_CATALOG.map((entry) => entry.id) as readonly BuffModifierType[];

export const BUFF_EXTRA_HIT_RULE: BuffExtraHitCatalogRule = {
  trigger: 'physicalAbnormal',
  allowedDamageTypes: ['physical', 'magic', 'fire', 'electric', 'ice', 'nature'],
  positivePatterns: ['额外造成一次伤害', '追加一段伤害', '触发一次额外打击', '额外攻击段'],
  negativePatterns: ['伤害提高', '易伤', '增幅', '倍率提高'],
  notes: '只有文本明确存在额外伤害段时才允许使用 extraHit。',
};

export function buildBuffTypeCatalogPromptSection() {
  const header = [
    '硬性映射规则：',
    '1. effectKind=modifier 时，type 只能从以下白名单中严格选择，禁止输出空字符串。',
    '2. 如果某句效果无法稳定映射到白名单 type，直接舍弃该 effect，不要生成占位 effect，不要猜测，不要造新 type。',
    '3. 宁可少提取，也不能为了完整覆盖而输出白名单外机制。',
    '4. 伤害免疫、治疗/回血、技力回复、持续时间增加、能量消耗降低、无视抗性、概率触发类特殊机制，默认视为当前版本不支持，直接舍弃。',
    '5. 只有 effectKind=extraHit 时，type 才允许为空字符串。',
    '',
    'modifier.type 白名单：',
  ].join('\n');

  const catalog = BUFF_TYPE_CATALOG.map((entry) => {
    return [
      `${entry.id} | ${entry.label}`,
      `aliases: ${entry.aliases.join(' / ')}`,
      `positive: ${entry.positivePatterns.join(' / ')}`,
      `negative: ${entry.negativePatterns.join(' / ')}`,
      `notes: ${entry.notes}`,
    ].join('\n');
  }).join('\n\n');

  return [header, catalog].join('\n');
}
