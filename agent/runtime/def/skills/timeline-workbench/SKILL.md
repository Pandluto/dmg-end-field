---
name: timeline-workbench
description: Arrange and modify the current DEF timeline through isolated Work Node code editing, review, approval, and use.
---

# DEF timeline workbench

Use this skill only for the Workbench host. The user may call the task 排轴、调轴、改轴、移动技能、换技能、加 Buff、删按钮 or similar language.

## Current context

Call `def_workbench_context` before reasoning about the visible canvas. It provides the bounded host attachment and the current checkout snapshot. Do not infer the current timeline from old transcript text.

`@N-L` always means `nodeIndex=N-1` and `lineIndex=L-1`. Before editing a coordinate or claiming it is empty, call `def_workbench_buttons` with both exact indices. If no candidate is returned, report the coordinate as empty; never reinterpret it as an ordinal or select another button.

For questions about which skill has the most Buffs, call `def_workbench_buff_ranking` for the named character and report its first result. Do not count Buffs manually or restrict the answer to an inferred visible range.

## Read-only requests

Answer from the live context and trusted `def_data_*` resources. Do not fork a node for a read-only question.
For a capability question such as “你可以排轴吗”, answer directly and briefly; do not dump the full current timeline unless the user asks to inspect it.

## Mutations

1. Fork with `def_node_fork`, or bind an explicitly selected existing node with `def_node_bind`. Never list nodes and bind an arbitrary/latest node just because it exists; if the user did not name a node, fork from the current checkout.
2. Read `node/working/*.json` before editing. Files below `node/base`, `node/context`, `node/generated`, and the manifest are read-only.
3. Use native `edit` or `apply_patch` on the normalized working source for flexible node changes. The codec rebuilds storage mirrors; do not translate the request into legacy button-command JSON or Patch DSL.
4. Run `def_node_sync_validate` and inspect the returned diff/risk evidence.
5. If the user says 先看看、先不要应用、预览 or equivalent, stop after validation/diff.
6. Only call `def_node_use` when the user explicitly requests application or clearly approves the reviewed result.

Use trusted resource tools to resolve operator, skill, weapon, equipment and Buff ids. Never invent official resource ids.

An unambiguous mutation request already authorizes creating the isolated child-node draft. Do not ask whether to fork, bind, edit, rebuild, validate, or produce a preview. “先看看” explicitly means perform those draft steps now and stop before approval/use. Ask a native question only when the business target or requested value is genuinely ambiguous.

When a requested slot is occupied and the user did not specify replace/move/swap behavior, do not leave the workspace invalid and do not ask only in assistant prose. Restore the last valid draft if necessary, then call OpenCode's native `question` tool with a small set of business choices such as “交换两个技能”, “选择其他空位”, and “取消本次调整”.

If the live Workbench context already supplies the exact button id, operator id, skill id and vacant target slot, do not call a data-resource tool merely to reconfirm those same facts.

## Result language

Reply in Chinese. Describe the visible business change, validation state and whether it has been applied. Do not expose REST URLs, command ids or internal adapter details.
