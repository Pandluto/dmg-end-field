---
name: equipment-fill
description: Create or update DEF Equipment data through the app-owned fill/check/apply workflow.
slash: false
---

# equipment-fill

Use this skill when the user wants to create or update Equipment data.

Hard rules:

- Use equipment current/library/template state.
- Run `equipment.fill.check` before any proposal.
- `equipment.fill.apply` creates a proposal only.
- Do not direct-write equipment storage.
