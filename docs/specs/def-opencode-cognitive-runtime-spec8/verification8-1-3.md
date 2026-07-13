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

## UI evidence

Computer Use reopened the real macOS Workbench after the minimal process reload. `AI 模式` was enabled and the native `DEF · 排轴助手` iframe was visible for the original session. No UI mutation or message was sent during this verification; protocol truth remains v1 evidence above.

## Next decision

Do not promote automatically. A reviewer may decide from this evidence after a machine-checkable decision artifact is added; the candidate ref to review is:

```text
def-selected-catalog-teaching@1.0.0
19012b18e1e1182d1b7f453dceeda024e35b851016a345be199143ba0dca7426
```

Remaining Spec 8-1-3 work: independent promotion-decision execution, adjacent PASS_TO_PASS under this candidate, reviewer approval/rejection, and a user-visible replay message in a fresh UI session. No YZ/Knowledge Runtime integration is implied.
