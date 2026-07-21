---
name: timeline-workbench
description: Arrange and modify the current DEF timeline through isolated Work Node code editing, review, approval, and use.
---

# DEF timeline workbench

Use this skill only for the Workbench host. The user may call the task 排轴、调轴、改轴、移动技能、换技能、加 Buff、删按钮 or similar language.

## Current context

Call `def_workbench_context` before reasoning about the visible canvas. It provides the bounded host attachment and the current checkout snapshot. Do not infer the current timeline from old transcript text.

This rule does **not** apply to a read-only request about “当前四人 / 全队 / 他们 / 每个人” and their weapons or equipment. Do not call `def_workbench_context` for those requests: use `def_data_team_loadouts` once for current configuration, then `def_data_loadout_candidates` once for ordinary team-wide planning. Do not use node, file, or permission tools in that turn. A named-guide/author request is a hard override, including “按他那篇攻略…先让我确认”: use `def_data_team_loadouts` only if current-team identity is needed, then `def_data_game_knowledge` once and `def_data_game_knowledge_section` once for its exact equipment/养成 section. Stop data-tool use and return a source-faithful proposal; do not resolve guide names against equipment/weapon catalogs, create a Work Node, or prepare an application.

`@N-L` always means `nodeIndex=N-1` and `lineIndex=L-1`. Before editing a coordinate or claiming it is empty, call `def_workbench_buttons` with both exact indices. If no candidate is returned, report the coordinate as empty; never reinterpret it as an ordinal or select another button.

For questions about which skill has the most Buffs, call `def_workbench_buff_ranking` for the named character and report its first result. Do not count Buffs manually or restrict the answer to an inferred visible range.

## Read-only requests

Answer from the live context and trusted `def_data_*` resources. Do not fork a node for a read-only question.
For a capability question such as “你可以排轴吗”, answer directly and briefly; do not dump the full current timeline unless the user asks to inspect it.

## Mutations

1. Fork with `def_node_fork`, or bind an explicitly selected existing node with `def_node_bind`. An explicitly named ready draft may differ from the current checkout: binding it only materializes its isolated workspace and records the checkout as its anchor; it does not apply the draft. If a checkout transition guard is active, first bind `nodeId=""`, refresh context, then bind the explicitly named draft before validation/use. Never list nodes and bind an arbitrary/latest node just because it exists; if the user did not name a node, fork from the current checkout.
2. Read `node/working/*.json` before editing. Files below `node/base`, `node/context`, `node/generated`, and the manifest are read-only.
3. Use native `edit` or `apply_patch` on the normalized working source for flexible node changes. The codec rebuilds storage mirrors; do not translate the request into legacy button-command JSON or Patch DSL.
   Every new timeline button must carry the exact trusted `characterId`, `characterName`, canonical `skillType` (`A/B/E/Q/Dot`), persistent `staffIndex`, matching `lineIndex`, and global `nodeIndex`. `skillKey` is never a substitute for `skillType`. If an exact identity cannot be resolved, stop and report that the draft was not applied.
   DEF 术语是固定合同：`A=普通重击/普通攻击`、`B=战技`、`E=连携技`、`Q=终结技/大招`、`Dot=持续伤害`。绝不可将 B/E 对调。处决和下落攻击是独立的 A 变体，用户说“重击”时绝不能用它们代替普通重击。对“战技/连携/大招/重击”等语义词，先调用一次 `def_data_skill`，只采用其返回的同干员可信语义候选；普通重击候选不唯一或不存在时发 native question，不能猜测。
   Prefer the live Workbench snapshot `skillCatalog`: an exact `characterId + skillType + skillDisplayName` entry is already trusted, and its `skillId` is the required `runtimeSkillId`. Do not call `def_data_skill` for an exact skill already resolved in that catalog; the preceding semantic-term rule is the exception. `customHits`, icon URLs, runtime snapshots, damage multipliers, and other calculation metadata are optional for timeline placement and must never block button creation. A working timeline button follows this minimal shape: `{ "id": "agent-short-id", "characterId": "stable-operator-id", "characterName": "干员名", "skillType": "A|B|E|Q|Dot", "runtimeSkillId": "trusted-skill-id", "skillDisplayName": "可信技能名", "staffIndex": 0, "lineIndex": 0, "nodeIndex": 0, "nodeNumber": 1, "selectedBuff": [] }`. `staffIndex` and `lineIndex` are the selected-character row; `nodeIndex` is the global horizontal slot.
4. Run `def_node_sync_validate` and inspect the returned diff/risk evidence.
5. If the user says 先看看、先不要应用、预览 or equivalent, stop after validation/diff.
6. Only call `def_node_use` when the user explicitly requests application or clearly approves the reviewed result.

Create Agent-authored timeline mutation nodes with `approvalPolicy=manual`. “重新发出审核”, “重新提交审批”, “提交审核” and equivalent language always require a fresh native pending approval. Never reuse an auto-approved checkout or describe a queue state/button count as approval or visible success.
After validation succeeds for one of those approval phrases, call `def_node_use` in the same turn so the native approval request is actually created and blocks for the user's decision. Do not stop at a textual “待审批” summary, and do not call a separate approval resource. If interop state still reports `pending=null`, say the approval was not issued.

Use trusted resource tools to resolve operator, skill, weapon, equipment and Buff ids. Never invent official resource ids.

Treat checkout, UI selection, and the session-axis bound node as one guarded identity. If `def_workbench_context` reports a checkout transition, `requiresRebind`, or a selection/checkout mismatch, call `def_node_bind` with an empty node id and read context again before any mutation. After convergence, an existing draft that the user explicitly named may be bound for review/use; do not materialize an arbitrary or inferred older node to work around the mismatch.

Retry one typed-tool failure at most once after changing the failing input or refreshing authoritative context. If the same failure code occurs twice, stop all tool calls and tell the user the change was not applied, which stage failed, and the single next recovery action. Do not continue until max-step.

The native `skill` tool already returns this complete Skill. Never inspect the runtime Skill directory with `read`, `glob`, or `grep`. Generic file tools are only for the current session's `node/working/*.json`; after one outside-session permission denial, do not try another path or file tool for that resource.

Weapon and equipment assignment does not use `node/working/inputs.json`. Resolve exact candidates through the trusted weapon/equipment resources, show the loadout first, then only after the user explicitly asks to apply use `def_operator_config_patch` once per selected operator. Its native approval and live operator-config postcondition are the completion proof; a Work Node validation, diff, checkout, or queued command is never proof that the visible loadout changed.

An unambiguous mutation request already authorizes creating the isolated child-node draft. Do not ask whether to fork, bind, edit, rebuild, validate, or produce a preview. “先看看” explicitly means perform those draft steps now and stop before approval/use. Ask a native question only when the business target or requested value is genuinely ambiguous.

When a requested slot is occupied and the user did not specify replace/move/swap behavior, do not leave the workspace invalid and do not ask only in assistant prose. Restore the last valid draft if necessary, then call OpenCode's native `question` tool with a small set of business choices such as “交换两个技能”, “选择其他空位”, and “取消本次调整”.

If the live Workbench context already supplies the exact button id, operator id, skill id and vacant target slot, do not call a data-resource tool merely to reconfirm those same facts.

## Result language

Reply in Chinese. Describe the visible business change, validation state and whether it has been applied. For a loadout, only say it has been applied after the typed tool reports its matching live postcondition. Do not expose REST URLs, command ids or internal adapter details.
