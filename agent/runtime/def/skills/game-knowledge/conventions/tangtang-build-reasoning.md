# 汤汤配装口头约定

这些规则只记录经过教学确认的作用域与非推论。当前装备名称、套装效果、武器数值和技能倍率仍以 typed catalog 为准。

```def-convention
{
  "ruleId": "tangtang.caster-hybrid-role",
  "title": "汤汤的术师职业不排除辅助与输出并存",
  "entities": ["tangtang", "汤汤"],
  "intents": ["operator-fit", "weapon-fit", "support-build"],
  "when": {"allOf": ["operator.id=tangtang"]},
  "then": ["operator.role.hybrid-caster-support-damage"],
  "certainty": "deterministic",
  "nonImplications": ["职业为术师不等于只能输出", "单篇特定队伍攻略不能覆盖汤汤的全局配装身份"],
  "provenance": "teacher-curated",
  "versionScope": "current-local-catalog"
}
```

```def-convention
{
  "ruleId": "tangtang.q-water-spout-is-b",
  "title": "汤汤终结技生成的水龙卷命中按战技类型归类",
  "entities": ["tangtang", "汤汤"],
  "intents": ["operator-fit", "weapon-fit", "rotation", "trigger-analysis"],
  "when": {"allOf": ["tangtang.skill.Q.water-spout.hit"]},
  "then": ["hit.skillType=B"],
  "certainty": "deterministic",
  "profilePreferences": [
    {"key": "battle-skill-damage", "label": "战技伤害", "kind": "skill-damage", "acceptedTypeKeys": ["skillDmgBonus"], "priority": 20}
  ],
  "nonImplications": ["水龙卷由终结技生成不等于该段命中属于终结技伤害", "单段倍率不能证明完整循环中的伤害占比"],
  "provenance": "teacher-curated",
  "versionScope": "current-local-catalog"
}
```

```def-convention
{
  "ruleId": "tangtang.signature-weapon-is-not-universal-optimum",
  "title": "落草汤汤是专属关联武器但不自动等于所有场景最优",
  "entities": ["tangtang", "汤汤", "落草汤汤"],
  "intents": ["operator-fit", "weapon-fit"],
  "when": {"allOf": ["weapon.name=落草汤汤", "operator.id=tangtang"]},
  "then": ["weapon.signature-association=true"],
  "certainty": "deterministic",
  "nonImplications": ["专属关联不自动证明伤害最优", "没有属性总值与阈值证据时不能声称敏捷已经够用", "碾骨类条件不得视为必然触发"],
  "provenance": "teacher-curated",
  "versionScope": "current-local-catalog"
}
```
