---
name: timeline-workbench
description: Arrange and modify the current DEF timeline through isolated Work Node code editing, review, approval, and use.
---

# DEF timeline workbench

Use this skill only for the Workbench host. The user may call the task 排轴、调轴、改轴、移动技能、换技能、加 Buff、删按钮 or similar language.

## Current context

Call `def_workbench_context` before reasoning about the visible canvas. It provides the bounded host attachment and the current checkout snapshot. Do not infer the current timeline from old transcript text.

This rule does **not** apply to a read-only request about “当前四人 / 全队 / 他们 / 每个人” and their weapons or equipment. Do not call `def_workbench_context` for those requests: use `def_data_team_loadouts` once for current configuration only if that identity is needed. `def_data_native_catalog_materialize` is optional session-local evidence for equipment/weapon full-field matching or exhaustive comparisons; it is not a Harness route. Native-read its manifest before `read`/`grep` under the returned `retrieval/<artifactId>` root. Use the narrowest trusted typed resource for simple facts; a legacy summary never proves fields it omits. Do not edit files, request permission, or use a Work Node for read-only research.

Only when a request judges which weapon or equipment better fits a specific operator—an operator-specific recommendation, optimization, or suitability comparison—begin with `def_data_operator_build_guide`, even when the user did not name an author. Pure catalog facts, field/ID/slot/effect lookups, and comparisons unrelated to operator fit use the narrowest trusted typed catalog resource and do not require guide discovery. For the applicable operator-fit flow, structured discovery must resolve an exact operator identity and returns one of these states:

- `GUIDE_FOUND`: exact operator-specific guide evidence gives one bounded build section plus a server-compiled `plannerProfile` and same-turn `plannerProfileCapability`. Pass that pair unchanged to the planner; never transcribe or edit it. Do not call the fallback profile, legacy knowledge search, or section reader.
- `PARTIAL_GUIDE_FOUND`: a relevant section supports only part of the priorities. Preserve the supported part and derive only the missing part from trusted operator and skill facts.
- `GUIDE_NOT_FOUND`: no exact operator build evidence exists. Only then derive the profile from trusted operator facts and skill data.

Do not classify or promote an arbitrary generic knowledge-search hit into one of these states. Call `def_data_operator_build_profile` only with the fallback token returned by `PARTIAL_GUIDE_FOUND` or `GUIDE_NOT_FOUND`; it may fill only the missing profile fields authorized by that token. Do not call it after `GUIDE_FOUND`. A source-only request such as “这篇攻略怎么说” still uses `def_data_game_knowledge` plus one exact `def_data_game_knowledge_section` and then stops. A build recommendation is different: the guide supplies strategy, while the current typed catalog or native artifact must verify every equipment name, stable id, slot, `fixedStat`, effect and set membership before recommendation. Never copy stale guide ids or treat a catalog record as proof of a strategy.

Guide strategy is evidence, not a universal operator identity. A statement tied to one named team, rotation, potential level, or equipment mode stays scoped to that condition: never turn “在这个阵容里输出占比约 10%” into a general claim that the operator is support-oriented. Keep guide context separate from current-catalog facts and leave planner-marked conditional effects unresolved.

Follow guide discovery's `evidenceRequirements` literally. If a `GUIDE_FOUND` result says `combatConvention=not-required`, call `def_data_weapon_fit_plan` directly with the unchanged profile capability and omit `conventionBundleHash`. Only when combat conventions are required call `def_data_combat_conventions` before the role-aware fallback profile and pass its exact `bundleHash`. This separate branch supplies reviewed trigger/utility rules, not guide prose or product facts. The planner evaluates every compatible current-catalog weapon and complete skill1/2/3 facts. Never select from truncated `def_data_weapon` or `def_data_loadout_candidates` output. A typed planner failure is terminal for that recommendation turn: report its structured `nextAction`; do not probe legacy weapon/loadout, generic skill, damage, Buff, or native artifacts to assemble a fallback ranking. A result marked `READY_WITH_TRADEOFFS` is unordered: present dimensions and trigger certainty without first/second labels, overall scores, or a unique optimum.

The authorized `def_data_operator_build_profile` result is the complete fallback evidence boundary: element, trusted primary/secondary operator attributes, skill categories actually emphasized by trusted multipliers or mechanics, and the only authorized `plannerProfile`/`plannerProfileCapability` pair. Pass that pair unchanged; do not convert, add, remove, or reorder its effect groups, and do not bypass its fallback token with generic operator or skill resources. Do not infer an attribute from profession, element, equipment `fixedStat`, or common player lore. If it returns no profile capability because evidence is incomplete, do not call the planner; ask one minimal question or mark the missing fact unverified.

## Composite 3+1 recommendation

Recognize a request for an operator-specific `3+1` equipment recommendation, including a named set, an unspecified set, or a correction such as “为什么不用……”. Call `def_data_equipment_3plus1_recommend` exactly once for that user turn. It is a read-only recommendation, not a configuration application.

- `READY`: explain the returned evidence-backed recommendation, close alternatives, comparisons, and any marked missing evidence without claiming it has been equipped.
- `NEEDS_INPUT`: ask the one returned bounded follow-up question; do not guess the missing choice.
- `UNRESOLVED`: state which returned evidence or identity could not be resolved and do not fabricate a plan.

For a correction, make a fresh composite recommendation in the new turn and address the challenged choice. Do not treat the correction as approval or reuse a prior recommendation as the current result.

`@N-L` always means `nodeIndex=N-1` and `lineIndex=L-1`. Before editing a coordinate or claiming it is empty, call `def_workbench_buttons` with both exact indices. If no candidate is returned, report the coordinate as empty; never reinterpret it as an ordinal or select another button.

For questions about which skill has the most Buffs, call `def_workbench_buff_ranking` for the named character and report its first result. Do not count Buffs manually or restrict the answer to an inferred visible range.

## Read-only requests

Answer from the live context and trusted `def_data_*` resources. Do not fork a node for a read-only question.
For a capability question such as “你可以排轴吗”, answer directly and briefly; do not dump the full current timeline unless the user asks to inspect it.

## Mutations

Explicit roster selection is its own typed transition, not a node-code edit. Resolve each requested operator through `def_data_operator_catalog`, then call `def_team_selection_apply` once with a concise Agent-written title and description. The policy is exact: the same ordered roster is a no-op; reorder/add/remove/replace operations that retain at least one current operator create a horizontal Work Node in the current SQLite; only a complete four-person result with zero overlap creates a new temporary SQLite, after which this DEF session is detached. Never edit `node/working/selection.json`, call `def_node_fork`, or use a generic command for roster selection. Native approval plus the tool's visible postcondition are required before saying it succeeded.

1. Fork with `def_node_fork`, or bind an explicitly selected existing node with `def_node_bind`. An explicitly named ready draft may differ from the current checkout: binding it only materializes its isolated workspace and records the checkout as its anchor; it does not apply the draft. If a checkout transition guard is active, first bind `nodeId=""`, refresh context, then bind the explicitly named draft before validation/use. Never list nodes and bind an arbitrary/latest node just because it exists; if the user did not name a node, fork from the current checkout.
2. Read `node/working/*.json` before editing. Files below `node/base`, `node/context`, `node/generated`, and the manifest are read-only.
3. Use native `edit` or `apply_patch` on the normalized working source for flexible node changes. The codec rebuilds storage mirrors; do not translate the request into legacy button-command JSON or Patch DSL.
   Every new timeline button must carry the exact trusted `characterId`, `characterName`, canonical `skillType` (`A/B/E/Q/Dot`), persistent `staffIndex`, matching `lineIndex`, and global `nodeIndex`. `skillKey` is never a substitute for `skillType`. If an exact identity cannot be resolved, stop and report that the draft was not applied.
   DEF 术语是固定合同：`A=普通重击/普通攻击`、`B=战技`、`E=连携技`、`Q=终结技/大招`、`Dot=持续伤害`。绝不可将 B/E 对调。处决和下落攻击是独立的 A 变体，用户说“重击”时绝不能用它们代替普通重击。对“战技/连携/大招/重击”等语义词，先调用一次 `def_data_skill`，只采用其返回的同干员可信语义候选；普通重击候选不唯一或不存在时发 native question，不能猜测。
   Prefer the live Workbench snapshot `skillCatalog` for timeline identity: an exact `characterId + skillType + skillDisplayName` entry is trusted, and its `skillId` is the required `runtimeSkillId`. Do not call `def_data_skill` merely to place an exact skill already resolved there; the preceding semantic-term rule is the exception. `customHits`, icon URLs, runtime snapshots, damage multipliers, and other calculation metadata are optional only for timeline placement. For read-only questions about a skill's multiplier, hit composition, element, or damage classification, call `def_data_skill` exactly once with the exact operator and the user's complete skill id/name; never shorten it, split out the hit term, or probe operator/knowledge/buttons first. Exact skill/hit names take priority over semantic aliases: `图腾下落` is a named Q skill, not the A-type `下落攻击` variant. Use its hit-level facts: a parent `Q` skill may contain a water-tornado hit whose `skillType` is `B`, and the hit-level classification wins. Never say exact values are unavailable before making that query. A working timeline button follows this minimal shape: `{ "id": "agent-short-id", "characterId": "stable-operator-id", "characterName": "干员名", "skillType": "A|B|E|Q|Dot", "runtimeSkillId": "trusted-skill-id", "skillDisplayName": "可信技能名", "staffIndex": 0, "lineIndex": 0, "nodeIndex": 0, "nodeNumber": 1, "selectedBuff": [] }`. `staffIndex` and `lineIndex` are the selected-character row; `nodeIndex` is the global horizontal slot.
4. Run `def_node_sync_validate` and inspect the returned diff/risk evidence.
5. If the user says 先看看、先不要应用、预览 or equivalent, stop after validation/diff.
6. Only call `def_node_use` when the user explicitly requests application or clearly approves the reviewed result.

Create Agent-authored timeline mutation nodes with `approvalPolicy=manual`. “重新发出审核”, “重新提交审批”, “提交审核” and equivalent language always require a fresh native pending approval. Never reuse an auto-approved checkout or describe a queue state/button count as approval or visible success.
After validation succeeds for one of those approval phrases, call `def_node_use` in the same turn so the native approval request is actually created and blocks for the user's decision. Do not stop at a textual “待审批” summary, and do not call a separate approval resource. If interop state still reports `pending=null`, say the approval was not issued.

Use trusted resource tools to resolve operator, skill, weapon, equipment and Buff ids. Never invent official resource ids.

Treat checkout, UI selection, and the session-axis bound node as one guarded identity. If `def_workbench_context` reports a checkout transition, `requiresRebind`, or a selection/checkout mismatch, call `def_node_bind` with an empty node id and read context again before any mutation. After convergence, an existing draft that the user explicitly named may be bound for review/use; do not materialize an arbitrary or inferred older node to work around the mismatch.

Retry one typed-tool failure at most once after changing the failing input or refreshing authoritative context. If the same failure code occurs twice, stop all tool calls and tell the user the change was not applied, which stage failed, and the single next recovery action. Do not continue until max-step.

The native `skill` tool already returns this complete Skill. Never inspect the runtime Skill directory with `read`, `glob`, or `grep`. Generic file tools are only for the current session's `node/working/*.json`, plus read/grep-only access to the exact `retrieval/<artifactId>` returned by `def_data_native_catalog_materialize`; after one outside-session permission denial, do not try another path or file tool for that resource. A retrieval artifact is immutable evidence, never a node input or generated payload.

Weapon and equipment assignment does not use `node/working/inputs.json`. Resolve exact candidates through the trusted weapon/equipment resources, show the loadout first, then only after the user explicitly asks to apply use `def_operator_config_patch` once per selected operator. Its native approval and live operator-config postcondition are the completion proof; a Work Node validation, diff, checkout, or queued command is never proof that the visible loadout changed.

An unambiguous mutation request already authorizes creating the isolated child-node draft. Do not ask whether to fork, bind, edit, rebuild, validate, or produce a preview. “先看看” explicitly means perform those draft steps now and stop before approval/use. Ask a native question only when the business target or requested value is genuinely ambiguous.

When a requested slot is occupied and the user did not specify replace/move/swap behavior, do not leave the workspace invalid and do not ask only in assistant prose. Restore the last valid draft if necessary, then call OpenCode's native `question` tool with a small set of business choices such as “交换两个技能”, “选择其他空位”, and “取消本次调整”.

If the live Workbench context already supplies the exact button id, operator id, skill id and vacant target slot, do not call a data-resource tool merely to reconfirm those same facts.

## Result language

Reply in Chinese. Describe the visible business change, validation state and whether it has been applied. For a loadout, only say it has been applied after the typed tool reports its matching live postcondition. Do not expose REST URLs, command ids or internal adapter details.

For a read-only loadout recommendation, return one best evidence-backed combination and at most two genuinely close alternatives. Show the matched operator-attribute/effect keys and any missing evidence; do not enumerate the solver's full topology or candidate pool. A user correction, a suitability comparison that challenges the reviewed loadout, or “为什么不用……” requires the Agent to discard the affected conclusion and any prior proposal token and never reuse them; do not claim that this Agent-side rule revoked the token on the server. For a `3+1` correction, make a new composite recommendation; otherwise re-evaluate the affected trusted evidence. Address the correction directly, and never merely restate the old plan or treat the correction as approval.
