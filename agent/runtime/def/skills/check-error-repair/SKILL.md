---
name: check-error-repair
description: Repair DEF fill/check validation errors using evidence and rerun validation safely.
slash: false
---

# check-error-repair

Use this skill when a fill/check operation fails and the user wants help fixing the draft.

Rules:

- Read the validation error first.
- Repair only fields explained by the error or backed by user-provided evidence.
- Run `fill.check` again after repair.
- Do not call `fill.apply` unless the user is clearly creating a proposal.
