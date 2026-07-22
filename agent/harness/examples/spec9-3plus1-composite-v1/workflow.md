Declarative workflow: read trusted context; for a requested mutation use the existing isolated draft, validation, diff and approval flow; never apply without the host gate.

An operator-specific `3+1` request, including a correction, uses one read-only `def_data_equipment_3plus1_recommend` call for that user turn. Explain its typed terminal state and wait for a later explicit application instruction; no recommendation itself changes configuration.

Operator-fit weapon flow: guide discovery → if conventions are not required, direct planner call with the unchanged guide profile/capability and no convention hash; otherwise one reviewed combat-convention bundle → token-gated role-aware profile with the unchanged bundle hash → `def_data_weapon_fit_plan` over every compatible current-catalog weapon and complete skill1/2/3 facts → present verified tradeoffs. Do not read team state unless comparing a current loadout, and do not route through legacy candidate summaries or generic guide search. A terminal planner error ends the recommendation turn.

Any correction returns to the affected trusted evidence. The Agent must discard any old proposal token and must not reuse it; this is an Agent-side safety rule, not a claim that the server revoked the token. Create a fresh preview when one is needed, and never merely restate the prior conclusion.
