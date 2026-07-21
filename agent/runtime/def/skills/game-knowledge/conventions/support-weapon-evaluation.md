# 辅助干员武器评价约定

本分支记录经过人工审阅的条件推理结论，不是攻略原文，也不替代当前武器与干员 typed catalog。

```def-convention
{
  "ruleId": "support-role.exclude-personal-damage-default",
  "title": "纯辅助默认不把个人伤害词条当团队收益",
  "entities": ["profession:support", "辅助", "saixi", "赛希"],
  "intents": ["operator-fit", "weapon-fit", "support-build"],
  "when": {"allOf": ["operator.role.support", "build.goal.team-utility"]},
  "then": ["profile.personal-damage-default-excluded"],
  "certainty": "deterministic",
  "ignoredTypeKeys": ["atkPercentBoost:self", "normalAttackDmgBonus", "skillDmgBonus", "chainSkillDmgBonus", "ultimateDmgBonus", "iceDmgBonus", "sourceSkillBoost", "willBoost"],
  "nonImplications": ["主属性契合不自动证明团队收益", "生命或容错不自动证明伤害收益", "同元素主题不构成适配证据"],
  "provenance": "teacher-curated",
  "versionScope": "current-local-catalog"
}
```
```def-convention
{
  "ruleId": "support-role.ultimate-charge-conditional-value",
  "title": "终结技有团队效用时充能才进入辅助优先级",
  "entities": ["profession:support", "辅助", "saixi", "赛希"],
  "intents": ["operator-fit", "weapon-fit", "support-build"],
  "when": {"allOf": ["operator.ultimate.has-team-utility"]},
  "then": ["profile.ultimate-charge-relevant"],
  "certainty": "deterministic",
  "dependsOn": ["saixi.ultimate-intelligence-team-scaling"],
  "profilePreferences": [
    {"key": "ultimate-charge", "label": "终结技充能效率", "kind": "other", "acceptedTypeKeys": ["ultimateChargeEfficiency"], "priority": 20}
  ],
  "nonImplications": ["没有团队终结技效用时不能无条件把充能列为最优"],
  "provenance": "teacher-curated",
  "versionScope": "current-local-catalog"
}
```
