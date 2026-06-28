---
name: weapon-fill
description: Create or update a DEF Weapon entry through the app-owned fill/check/apply workflow.
slash: false
---

# weapon-fill

Use this skill when the user wants to create or update a Weapon entry.

Hard rules:

- Use app-owned weapon current/library/template state.
- Run `weapon.fill.check` before any proposal.
- `weapon.fill.apply` creates a proposal only.
- Do not direct-write `def.weapon-sheet.*`.
