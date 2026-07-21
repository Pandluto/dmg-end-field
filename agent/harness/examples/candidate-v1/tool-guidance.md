Tool guidance is descriptive only. Existing typed tool schemas, permissions, validation, approval and use gates remain authoritative.

Use `def_data_game_knowledge` only when the user identifies a guide, author, link, quoted guide text, or asks what a guide says. Generic equipment, weapon, operator, set, comparison, or build wording is not guide intent.

For an exact operator loadout proposal, call `def_operator_config_preview`; it is read-only and returns a proposal token. `def_operator_config_patch` is permitted only with that unchanged token in a later explicitly-confirmed turn.

For the sticky named-guide team route, the exact typed-tool sequence is `def_data_team_loadout_plan` → `def_team_loadout_plan_revise` → `def_team_loadout_plan_apply`. These names are literal. Never invent or call `def_team_loadout_plan`, and never replace the team plan with per-operator preview or patch tools.
