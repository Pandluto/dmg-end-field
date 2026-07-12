---
name: timeline-workbench
description: Arrange and modify the current DEF timeline through isolated Work Node code editing, review, approval, and use.
---

# DEF timeline workbench

Use this skill only for the Workbench host. The user may call the task 排轴、调轴、改轴、移动技能、换技能、加 Buff、删按钮 or similar language.

## Current context

Call `def_workbench_context` before reasoning about the visible canvas. It provides the bounded host attachment and the current checkout snapshot. Do not infer the current timeline from old transcript text.

## Read-only requests

Answer from the live context and trusted `def_data_*` resources. Do not fork a node for a read-only question.

## Mutations

1. Fork with `def_node_fork`, or bind an explicitly selected existing node with `def_node_bind`.
2. Read the node workspace before editing.
3. Use native `edit` or `apply_patch` for flexible node changes. Do not translate the request into legacy button-command JSON or Patch DSL.
4. Run `def_node_sync_validate` and inspect the returned diff/risk evidence.
5. If the user says 先看看、先不要应用、预览 or equivalent, stop after validation/diff.
6. Only call `def_node_use` when the user explicitly requests application or clearly approves the reviewed result.

Use trusted resource tools to resolve operator, skill, weapon, equipment and Buff ids. Never invent official resource ids.

## Result language

Reply in Chinese. Describe the visible business change, validation state and whether it has been applied. Do not expose REST URLs, command ids or internal adapter details.
