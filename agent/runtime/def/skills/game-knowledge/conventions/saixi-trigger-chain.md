# 赛希条件触发链

以下规则采用 DEF canonical skill mapping：B 为战技，E 为连携技。

```def-convention
{
  "ruleId": "saixi.combo-after-two-heavy",
  "title": "赛希战技后两次主控重击触发连携",
  "entities": ["saixi", "赛希"],
  "intents": ["rotation", "trigger-analysis", "operator-fit", "weapon-fit"],
  "when": {"allOf": ["saixi.skill.B.active", "controller.heavy-attack.count>=2"]},
  "then": ["saixi.skill.E.available"],
  "certainty": "deterministic",
  "nonImplications": ["重击不等于下落攻击或处决"],
  "provenance": "teacher-curated",
  "versionScope": "current-local-catalog"
}
```

```def-convention
{
  "ruleId": "saixi.combo-heal-and-ice-application",
  "title": "赛希连携治疗主控并施加冰附着",
  "entities": ["saixi", "赛希"],
  "intents": ["rotation", "trigger-analysis", "operator-fit", "weapon-fit"],
  "when": {"allOf": ["saixi.skill.E.used"]},
  "then": ["controller.healed-by-saixi-skill", "target.ice-application.added"],
  "certainty": "deterministic",
  "dependsOn": ["saixi.combo-after-two-heavy"],
  "provenance": "teacher-curated",
  "versionScope": "current-local-catalog"
}
```

```def-convention
{
  "ruleId": "saixi.ultimate-intelligence-team-scaling",
  "title": "赛希终结技团队增幅受智识缩放",
  "entities": ["saixi", "赛希"],
  "intents": ["operator-fit", "weapon-fit", "support-build"],
  "when": {"allOf": ["saixi.skill.Q.team-amplification"]},
  "then": ["operator.ultimate.has-team-utility", "profile.intelligence-relevant"],
  "certainty": "deterministic",
  "profilePreferences": [
    {"key": "secondary-intelligence", "label": "智识", "kind": "secondary-attribute", "acceptedTypeKeys": ["intelligenceBoost", "subStatBoost"], "priority": 30}
  ],
  "nonImplications": ["意志和个人攻击不因职业为辅助而自动产生团队收益", "源石技艺强度不自动提高法术增幅"],
  "provenance": "teacher-curated",
  "versionScope": "current-local-catalog"
}
```

