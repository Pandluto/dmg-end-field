# 赛希附着与辅助武器触发约定

概率只保留人工确认的定性等级；没有来源时不得换算为百分比。

```def-convention
{
  "ruleId": "saixi.ice-application-creates-arts-attachment",
  "title": "赛希冰附着形成法术附着",
  "entities": ["saixi", "赛希", "arts-attachment", "法术附着"],
  "intents": ["rotation", "trigger-analysis", "weapon-fit"],
  "when": {"allOf": ["target.ice-application.added"]},
  "then": ["target.arts-attachment.present"],
  "certainty": "deterministic",
  "dependsOn": ["saixi.combo-heal-and-ice-application"],
  "nonImplications": ["法术附着本身不等于已经触发法术爆发或法术异常"],
  "provenance": "teacher-curated",
  "versionScope": "current-local-catalog"
}
```

```def-convention
{
  "ruleId": "saixi.ice-application-high-probability-magic-burst",
  "title": "赛希冰附着大概率形成法术爆发",
  "entities": ["saixi", "赛希", "magic-burst", "法术爆发"],
  "intents": ["rotation", "trigger-analysis", "weapon-fit"],
  "when": {"allOf": ["target.arts-attachment.present"]},
  "then": ["saixi.magic-burst.high-probability"],
  "certainty": "high-probability",
  "dependsOn": ["saixi.ice-application-creates-arts-attachment"],
  "nonImplications": ["high-probability 不是确定触发", "没有数值来源时不得编造百分比"],
  "provenance": "teacher-curated",
  "versionScope": "current-local-catalog"
}
```

```def-convention
{
  "ruleId": "saixi.ice-application-low-probability-magic-anomaly",
  "title": "赛希冰附着小概率形成法术异常",
  "entities": ["saixi", "赛希", "magic-anomaly", "法术异常"],
  "intents": ["rotation", "trigger-analysis", "weapon-fit"],
  "when": {"allOf": ["target.arts-attachment.present"]},
  "then": ["saixi.magic-anomaly.low-probability"],
  "certainty": "low-probability",
  "dependsOn": ["saixi.ice-application-creates-arts-attachment"],
  "nonImplications": ["low-probability 不能作为稳定排轴前置", "没有数值来源时不得编造百分比"],
  "provenance": "teacher-curated",
  "versionScope": "current-local-catalog"
}
```

```def-convention
{
  "ruleId": "saixi.knights-spirit-heal-trigger",
  "title": "赛希连携治疗可触发骑士精神团队攻击增益",
  "entities": ["saixi", "赛希", "wpn_funnel_0010", "骑士精神"],
  "intents": ["weapon-fit", "trigger-analysis", "support-build"],
  "when": {"allOf": ["controller.healed-by-saixi-skill"]},
  "then": ["weapon.wpn_funnel_0010.skill3.team-atk-condition-reachable"],
  "certainty": "deterministic",
  "dependsOn": ["saixi.combo-heal-and-ice-application"],
  "profilePreferences": [
    {"key": "reachable-team-buff", "label": "可触发的全队增益", "kind": "other", "acceptedTypeKeys": ["atkPercentBoost", "magicVulnerability"], "priority": 10}
  ],
  "catalogMatchers": [
    {"weaponId": "wpn_funnel_0010", "skillKey": "skill3", "effectType": "atkPercentBoost", "requiredFact": "controller.healed-by-saixi-skill", "utilityKey": "reachable-team-buff"}
  ],
  "nonImplications": ["骑士精神的意志和生命词条不因此自动成为赛希团队收益"],
  "provenance": "teacher-curated",
  "versionScope": "current-local-catalog"
}
```

```def-convention
{
  "ruleId": "saixi.explosive-unit-magic-burst-trigger",
  "title": "赛希法术爆发可触发爆破单元法术易伤",
  "entities": ["saixi", "赛希", "wpn_funnel_0008", "爆破单元"],
  "intents": ["weapon-fit", "trigger-analysis", "support-build"],
  "when": {"allOf": ["saixi.magic-burst.high-probability"]},
  "then": ["weapon.wpn_funnel_0008.skill3.magic-vulnerability-condition-reachable"],
  "certainty": "high-probability",
  "dependsOn": ["saixi.ice-application-high-probability-magic-burst"],
  "profilePreferences": [
    {"key": "reachable-team-buff", "label": "可触发的全队增益", "kind": "other", "acceptedTypeKeys": ["atkPercentBoost", "magicVulnerability"], "priority": 10}
  ],
  "catalogMatchers": [
    {"weaponId": "wpn_funnel_0008", "skillKey": "skill3", "effectType": "magicVulnerability", "requiredFact": "saixi.magic-burst.high-probability", "utilityKey": "reachable-team-buff"}
  ],
  "nonImplications": ["high-probability 不等于每轮必定触发"],
  "provenance": "teacher-curated",
  "versionScope": "current-local-catalog"
}
```

```def-convention
{
  "ruleId": "saixi.explosive-unit-substat-maps-intelligence",
  "title": "爆破单元副能力被动对赛希映射为智识",
  "entities": ["saixi", "赛希", "wpn_funnel_0008", "爆破单元"],
  "intents": ["weapon-fit", "operator-fit", "support-build"],
  "when": {"allOf": ["weapon.wpn_funnel_0008.skill3.passive.subStatBoost", "operator.saixi.subStat.intelligence"]},
  "then": ["weapon.wpn_funnel_0008.skill3.passive.intelligenceBoost"],
  "certainty": "deterministic",
  "dependsOn": ["saixi.ultimate-intelligence-team-scaling"],
  "profilePreferences": [
    {"key": "secondary-intelligence", "label": "智识", "kind": "secondary-attribute", "acceptedTypeKeys": ["intelligenceBoost", "subStatBoost"], "priority": 30}
  ],
  "catalogMatchers": [
    {"weaponId": "wpn_funnel_0008", "skillKey": "skill3", "effectType": "subStatBoost", "requiredFact": "operator.saixi.subStat.intelligence", "utilityKey": "secondary-intelligence"}
  ],
  "nonImplications": ["爆破单元 skill1 的主能力提升对赛希映射为意志而不是智识", "源石技艺强度不因此获得辅助收益"],
  "provenance": "teacher-curated",
  "versionScope": "current-local-catalog"
}
```
