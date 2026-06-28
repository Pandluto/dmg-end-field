---
name: operator-fill
description: Create or update a DEF Operator entry through the app-owned fill/check/apply workflow.
slash: false
---

# operator-fill

Use this skill when the user wants to create or update an Operator entry.

Procedure:

1. Read the operator template and current/library state.
2. Extract structured facts from the source text.
3. Generate an Operator fill draft.
4. Run `operator.fill.check`.
5. Repair validation errors.
6. Create a proposal only after check passes.

Hard rules:

- Do not save library directly.
- Do not use unsupported buff types.
- Do not guess fields without evidence.
