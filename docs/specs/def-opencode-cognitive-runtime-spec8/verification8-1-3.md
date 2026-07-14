# Spec 8-1-3 verification — first live teaching replay

## Result

`RECOMMEND_PROMOTION` 尚未给出，candidate 也未 promotion。首次真实 failure 已被最小修复并在 candidate 上完成目标 replay；但 promotion 仍要求人工 reviewer 复核本记录，并补上可机器执行的 promotion decision artifact。

## Root cause tree

```text
用户要求从选人界面找当前未选角色并排轴
├─ primary/runtime-tool: def.character.resolve 只查询 selectedCharacters，未暴露选人目录
├─ contributing/contract: def_data_operator 的广义描述与 scoped empty result 允许错误全局推断
├─ contributing/permission: Skill 可加载，但 direct read/glob/grep 到外部 Skill root 被 default deny + external_directory deny 拒绝
├─ contributing/Harness: 未要求 correction 后切换入口，亦未约束等价 permission retry
└─ verifier gap: 原先没有 catalog/reference/replan Scenario
```

Primary evidence is the original read-only session `ses_0a4070d5cffe9GZb23OY0RtKCm`: it repeatedly used the selected resolver and permission-denied file tools before falsely asserting a global absence. No source transcript or exposed reasoning is committed.

## Minimal repair

- `def.character.resolve` remains selected-only and now returns `scope=selected`, `source=current-workbench-selection`, `exhaustive=false` and an explicit scoped-empty explanation.
- New `def.operator.catalog.search` / `def_data_operator_catalog` uses the same local catalog source as `SelectionPanel`: `def.operator-editor.library.v1`. It returns only bounded structured character fields plus source/scope/count/ambiguity/exhaustive and never mutates selection.
- New `def.knowledge.game.search` / `def_data_game_knowledge` only reads Markdown inside the fixed `game-knowledge/references` root and returns bounded excerpts. It does not accept a path, expose localStorage, or grant filesystem permission. Direct `read/glob/grep` remain denied by design.
- `game-knowledge` now instructs the Worker to use that typed resource. This resolves the apparent Skill-load/Skill-read conflict without enabling project or external-directory reads.

## Candidate

Candidate `def-selected-catalog-teaching@1.0.0` is fully materialized with eight slots and remains on `candidate/selected-catalog`:

- content hash: `19012b18e1e1182d1b7f453dceeda024e35b851016a345be199143ba0dca7426`
- source commit: `8f93f0c297cb365aac0dd45073bed673dc46c036`, clean at build time
- modified teaching slots: `agentContract`, `knowledgePacks`, `skills`, `routingPolicy`, `toolGuidance`, `responsePolicy`, `workflows`; `roleCards` remains baseline-equivalent.

It teaches scoped evidence, catalog routing after user correction, one materially different fallback after permission failure, reference-backed claims, and preview/approval boundaries. It does not change tool schemas, permission policy, verifier, or safety gates.

## Native evidence

| Case | Harness / run | Native facts | Judgment |
| --- | --- | --- | --- |
| baseline failure | stable original `ses_0a4070d5cffe9GZb23OY0RtKCm` | selected-only resolver repeatedly queried; Skill direct reads denied; global-absence claim | FAIL_TO_PASS baseline failure |
| repaired stable comparison | `native-harness-run-6478a6ba-c833-4b1e-b79c-480b76f43064` | new `ses_0a3ec6d4dffeIJKfdmFil7w3zj`; catalog found targets but direct read/glob path and draft attempt led to timeout | `INCOMPLETE`, not candidate pass |
| candidate selected/catalog/replan | `native-harness-run-49d765e1-bd55-4ffd-a003-ffef07a72cb7` | new `ses_0a3effeebffefBz2wxndyg4g2S`; test run `a9e8817a-4ba1-42c8-967a-67ea3d81ab21`; turns `c2cd2eb6-06b2-49f9-bb9f-633aaf7e2073`, `e47e97c0-f22f-453f-b2a5-2c3821733142`; completed; catalog + knowledge tools; cleanup | PASS |
| candidate Skill references | `native-harness-run-6978ac40-4b4a-4d5d-b5d7-bcccebe22838` | new `ses_0a3ed9acfffeo4Frlul1inEV68`; test run `24593a49-d0d4-4cba-b6f2-b0dbb7b13e75`; turn `ca9cd317-85bd-4379-97bb-23030dabde56`; completed; game knowledge resource returned glossary and guide evidence; cleanup | PASS |

Both candidate runs have equal v1 state before/after and no `def_node_use`. The target catalog result reported `source=selection-screen-local-library`, `scope=catalog`, `catalogCount=28`; its selected resolver counterpart reported `scope=selected`, `exhaustive=false`, and zero matches. The resource rejected a path-like `.env` query with zero candidates.

One accidental duplicate runner execution timed out and cleaned its owned fixture/session. It is retained only as `INCOMPLETE` runtime evidence and is not used as a pass.

## Addendum — second real failure: weapon-library scope

The later real Workbench session correctly showed that the Operator Configuration page has its own local weapon truth: `localStorage.def.weapon-sheet.library.v1`. The prior `def.weapon.resolve` instead searched only `snapshot.operatorConfigs[*].weapon`, so an unconfigured roster returned an empty result for every query and DEF falsely concluded that the weapon library was empty.

This major runtime/tool-contract bug is fixed. `def.weapon.resolve` now searches the same local library as the Operator Configuration picker and returns bounded `scope=catalog`, `source=operator-config-weapon-library`, `catalogCount`, `exhaustive`, and `truncated` facts. `def_data_weapon` and the typed-tool definition now explicitly describe that source. The repair is read-only: it neither writes the library nor equips a weapon. No Harness candidate was changed or promoted for this runtime correction.

## Addendum — second real Harness failure: Work Node loadout was not a configuration mutation

### Classification and root cause

This is a runtime/tool-contract failure, not a Harness-only failure. The original real session wrote guessed `weaponId`, `weaponSkillKey`, `gearSetId`, and `equipmentIds` fields into a Work Node `inputs.json`, then treated validate/apply as proof that the character configuration page changed. The actual product contract is `CharacterInputConfig` plus the `ConfigSnapshot` cache used by the Operator Configuration page; `CanvasBoard` owns the renderer commands that update it.

There was a second contributing source-loss defect: the server-side mirror reader serialized both `characterInputMap` and `operatorConfigPageCache` as empty objects. The real sources are `sessionStorage.def.operator-config.character-input-map.v3` and `sessionStorage.def.operator-config.page-cache.v1`. Thus a Work Node could discard a real UI configuration even when it had been rendered correctly.

### Minimal repair

- Work Node payload capture now reads those two current session-storage sources and semantically validates their exact supported shapes. Unknown guessed loadout fields fail closed with `invalid-current-payload`; they cannot be validated or used as a successful loadout application.
- `def.operator.config.patch` is a typed renderer route, exposed to OpenCode as native `def_operator_config_patch`. A combined weapon/loadout request becomes one CanvasBoard `setOperatorConfig` command: it preflights the active Work Node checkout, resolves one exact selected target, writes the page cache once, and persists the complete snapshot to that checkout once. Legacy narrow commands remain only for compatibility.
- The tool is a mutation, not a data resource. `def_operator_config_patch` explicitly overrides the broad `def_*` permission with `ask`; native approval is therefore required every time. Its approval record deliberately has no fake Work Node id, while the renderer command itself must have a real checked-out Work Node to persist into.
- The result now contains stable renderer error codes, a live `postcondition.pass`, and a checkout-payload postcondition. A missing/ambiguous target or id/name mismatch fails closed; no command falls back to the first selected operator. No queued command, Work Node validation, diff, or immediate page-cache read is treated as configuration success.

### Candidate and replay status

`def-operator-config-postcondition@1.0.1` remains a non-promoted candidate (`candidate/operator-config-postcondition`, content hash `a605e92a97388815da87c1b7697b8efefabdb355d5a1c1d2580d1a1a1679cfb0`). The focused explicit preview scenario completed without mutation. The broad prompt asking for four independently suitable loadouts remained incomplete because the stable stack expands into knowledge/skill exploration; this is a known Harness limitation, not a candidate pass or promotion basis.

### Corrected live v1 + UI regression

The former “赤缨/点剑通过” statement is invalidated: it only observed the immediate page mirror, the broad `def_*: allow` rule could auto-approve the native request, and it did not prove checkout hydration or a route round-trip. It is retained as failure evidence, not acceptance evidence.

The corrected validation used Pure Blackbox text only. First, a rejection run (`testRunId` `ff5446d7-abf5-4542-b9c0-22632d5d8b07`, session `ses_0a1268f98ffecU6baydB4QHct6`, turn `b8a0058b-1d2f-4922-9c41-0658e8c45b52`) showed the native `需要权限 operator-config` card. Computer Use chose `拒绝`; v1 recorded `def_operator_config_patch` as rejected and both the live mifu config and current checkout payload remained `null` before/after.

The corrected approval run was `testRunId` `c2db3ea3-ad9d-4c43-a25a-9524c168c01b`, session `ses_0a11f31ebffeOgg4LD0z75Q9M8`, turn `ce4f636e-6f58-486d-b6dc-b60d07acb955`, client turn `codex-1784003224916-f7d605d0`. `rawUserText` and `providerVisibleUserText` were identical. The real native permission card appeared and Computer Use chose `允许一次`. The completed tool result was cross-checked against both sources:

- live mirror: `昔日精品`; `落潮轻甲` (armor), `潮涌手甲` (glove), `悬河供氧栓` (accessory1), `浊流切割炬` (accessory2); both 潮涌 three-piece effects;
- checked-out Work Node `ai-timeline-node-1783998441575-8wxmn31x` payload: the identical weapon, four pieces, and effects.

Computer Use then exited AI mode, opened real `#/operator-config`, returned to the main workbench, and opened `#/operator-config` again. Both entries visibly showed weapon `昔日精品` (`6★ / 双手剑 / Lv.90 / ATK 495`) and the two 潮涌 effects. This is the acceptance evidence for approval, four-slot expansion, checkout persistence, and hydration round-trip. The prior first attempt that only applied the armor exposed the `fillSlots` expansion defect and was fixed before this final run.

## UI evidence

Computer Use reopened the real macOS Workbench after the minimal process reload. `AI 模式` was enabled and the native `DEF · 排轴助手` iframe was visible for the original session. No UI mutation or message was sent during this verification; protocol truth remains v1 evidence above.

## Next decision

Do not promote automatically. A reviewer may decide from this evidence after a machine-checkable decision artifact is added; the candidate ref to review is:

```text
def-selected-catalog-teaching@1.0.0
19012b18e1e1182d1b7f453dceeda024e35b851016a345be199143ba0dca7426
```

Remaining Spec 8-1-3 work: independent promotion-decision execution, adjacent PASS_TO_PASS under this candidate, reviewer approval/rejection, and a user-visible replay message in a fresh UI session. No YZ/Knowledge Runtime integration is implied.

## Addendum — operator config consistency and level contract return fix (not a promotion)

The former name-only postcondition is withdrawn. A configuration is now reported as applied only when the normalized, full value object is identical in all three authoritative locations:

```text
live Workbench mirror
  = approved child Work Node workingPayload
  = latest checkoutApplied commit appliedPayload
```

The reviewed configuration is first resolved without mutating the live page. It is stored in a new manual child of the exact checkout parent. Before commit, the bridge compares both parent and child revisions with the review values. It then commits the child, applies its payload in the renderer, waits for the live mirror, marks the exact commit checkout-applied, and finally synchronizes the renderer checkout ref to that child. A stale parent/child/check-out returns `checkout-changed`; the retired direct overwrite helper now fails closed.

The typed `def_operator_config_patch` contract now carries weapon level and three skills, per-entry equipment levels, and operator A/B/E/Q levels. Defaults are centralized in the operator-config snapshot service: a newly selected weapon is Lv90/9-9-4, a newly selected equipment entry is Lv3, and a missing operator skill is M3. `??` is used for levels so explicit `0` is retained. The weapon skill-3 input is the base level and the existing potential rule is applied exactly once.

Focused explicit-level live regression, 2026-07-14:

- direct reviewed child: `ai-timeline-node-1784029600555-iz458hgr`
- checkoutApplied commit: `ai-timeline-commit-1784029600587-gz1pdxix`
- final values: 弭弗 / 昔日精品 Lv60 / 0潜 / 7-8-3; 潮涌四件的每条词条 0-1-2; A=L9, B=M3, E=L9, Q=M3.
- protocol postcondition returned `liveMirror=true`, `checkoutPayload=true`, `commitPayload=true`, and the finalize command switched the active checkout to the child.
- Computer Use opened `#/operator-config`, returned to the workbench, and re-entered it twice. Both re-entries visibly retained Lv60, 7/8/3, the 0/1/2 entry levels, the four pieces, the set effects, and A/E L9.

Native preview evidence is a separate Pure Blackbox v1 turn: `testRunId` `c2db3ea3-ad9d-4c43-a25a-9524c168c01b`, session `ses_0a11f31ebffeOgg4LD0z75Q9M8`, turn `c4dd989c-14a4-469c-8e00-a9fe68d9913e`, client turn `task813-default-approval-1784029771`. Its raw and provider-visible text are identical. Chrome showed the actual `DEF · 排轴助手` permission card with the resolved default card values: Lv90/9-9-4, all twelve real equipment entries at Lv3 with computed values, A/B/E/Q, plus exact node and checkout revisions. This turn remains pending native decision while the reviewer controls the destructive reject test; it is not an application pass and no Harness candidate was promoted.
