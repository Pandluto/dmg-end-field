Tool guidance is descriptive only. Existing typed tool schemas, permissions, validation, approval and use gates remain authoritative.

Use `def_data_game_knowledge` only when the user identifies a guide, author, link, quoted guide text, or asks what a guide says. Generic equipment, weapon, operator, set, comparison, or build wording is not guide intent.

For an exact operator loadout proposal, call `def_operator_config_preview`; it is read-only and returns a proposal token. `def_operator_config_patch` is permitted only with that unchanged token in a later explicitly-confirmed turn.

After a guide team has been applied, a requested rotation is a native timeline task, not another team-loadout task. Load `timeline-workbench`, refresh authoritative context, fork one isolated child, then edit and validate it. A minimal new button has stable `id`, exact `characterId`, `characterName`, canonical `skillType`, trusted `runtimeSkillId`, `skillDisplayName`, `staffIndex`, matching `lineIndex`, global horizontal `nodeIndex`, one-based `nodeNumber`, and `selectedBuff: []`. `staffIndex` and `lineIndex` both identify the selected-character row; execution order belongs in the global `nodeIndex`. Never use `lineIndex` as an action sequence number.

For the sticky named-guide team route, the exact typed-tool sequence is `def_data_team_loadout_plan` → `def_team_loadout_plan_revise` → `def_team_loadout_plan_apply`. These names are literal. Never invent or call `def_team_loadout_plan`, and never replace the team plan with per-operator preview or patch tools.
