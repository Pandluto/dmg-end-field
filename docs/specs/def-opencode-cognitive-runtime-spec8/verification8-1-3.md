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

## Addendum — content revision import and final native default-level regression

This addendum replaces the preceding pending-preview wording for the focused
default-level regression. It does not promote any Harness candidate or close
the remaining checkout-change/promotion-decision work.

### Repository repair

`timeline_work_nodes.content_revision` is now preserved by document-bundle
import. A v3 bundle imports its explicit `contentRevision`; an older bundle
without that field deterministically seeds it from the persisted `updatedAt`
(falling back to `createdAt`). All `timeline_work_nodes` INSERT/UPSERT paths
were audited: the bundle import and repository work-node import both supply
the non-null column. Approval/audit timestamps remain separate from this
content revision, so they cannot invalidate their own compare-and-swap.

The custom OpenCode plugin also now imports the vendored plugin tool entrypoint
by its real workspace file path. The former bare subpath could not be resolved
by Bun, which meant that `def_operator_config_patch` was absent even though the
data-resource guidance was visible in the prompt. A focused Bun load confirms
the native tool and optional Zod level fields are registered.

### Final approved default-card run

The final Pure Blackbox run used `testRunId`
`dd5fa8ab-d328-4fe3-8ddb-54c326741d9a`, session
`ses_09f254c1effeeYkmiEvrsPntRJ`, turn
`fdacd560-2e96-4e1b-a2f3-5af049c05a93`, and client turn
`task813-native-default-final-1784036391`. `rawUserText` equalled
`providerVisibleUserText` exactly. v1 recorded accepted, UI prompt consumed,
the `def_operator_config_patch` tool start, and completed terminal state.

Computer Use saw the real native card in `DEF · 排轴助手` before approval. It
displayed the reviewed child `ai-timeline-node-1784036403156-xp81hrpv`, its
checkout parent/revision, 弭弗, 昔日精品 `Lv90 · 0潜 · 9/9/4`, all four 潮涌
pieces, every actual entry at `Lv3` with its computed value, and `A L9 / B M3
/ E L9 / Q M3`. After `允许一次`:

- commit `ai-timeline-commit-1784036449905-sa8259bz` became
  `checkoutApplied` for the same child;
- live mirror, child `workingPayload`, and that commit's `appliedPayload`
  agree on the exact weapon, its three levels, all twelve equipment-entry
  levels, four slot ids, and the operator skill map;
- Computer Use exited AI mode and opened `#/operator-config` twice, returning
  to the main workbench between entries. Both entries visibly retained
  昔日精品 `Lv90`, `9/9/4`, the four 潮涌 pieces and set effects, and the
  `A L9 / B M3 / E L9 / Q M3` skill states.

### Final rejection run

The independent correct-default rejection card used the same test run/session,
turn `70b2deb4-a28a-4b2f-a89c-4f74a5479dad`, client turn
`task813-native-default-reject-final-1784037280`, and temporary child
`ai-timeline-node-1784037286324-eqhvgstc`. Its native card displayed the same
fully resolved Lv90/9-9-4 and all-Lv3 review values. After an explicit
desktop confirmation, Computer Use chose `拒绝`.

The child then returned HTTP 404. Before/after assertions show the active head
still `ai-timeline-node-1784036403156-xp81hrpv`, commit count still 16, node
count still 33, and the normalized live 弭弗 configuration unchanged. Thus a
rejection leaves no applied commit, checkout change, or renderer mutation.

Focused checks after the repair all passed:

```text
node scripts/timeline-repository-smoke.mjs
node scripts/ai-timeline-work-node-rest-smoke.mjs
node --check (changed JS/CJS/MJS files)
npm run harness:check
npm run interop:check
git diff --check
```

The v1 event stream currently records the tool lifecycle and UI-prompt
consumption for this native card; the visible native permission choice remains
the Computer Use evidence in this run. That observability distinction is
documented here rather than being treated as a Harness promotion signal.

## Addendum — tool routing efficiency (read-only, no promotion)

Two read-only native data resources now compact the common current-team
planning path without changing any operator-config mutation, approval, or
checkout/commit rule:

- `def_data_team_loadouts` returns `DefSelectedTeamLoadoutsV1`: one current
  Workbench snapshot, exact selected ids, configured values, structured
  weapon types, checkout revision, and explicit missing records. It never
  creates a Work Node or fills absent values with defaults.
- `def_data_loadout_candidates` returns `DefLoadoutCandidateBundleV1`: one
  snapshot-derived team view, one structured-weaponType library read, one
  equipment-library read, up to four candidates per operator, shared
  four-piece set details once, and at most three bounded allowlisted evidence
  excerpts. It returns only candidates and missing reasons; it never applies.

Workbench routing now treats current-four/team/everyone loadout questions as
batch-only. A configuration question calls only `def_data_team_loadouts`.
A read-only current-team recommendation calls `def_data_team_loadouts` then
`def_data_loadout_candidates`; after that bundle it must not call context,
individual operator/weapon/equipment/knowledge resources, native file tools,
permissions, or Work Node operations. The same exception is present in the
timeline-workbench Skill so the generic canvas-context rule cannot override
it.

### Live v1 evidence

| Scenario | Stable ids | Tool sequence | Result |
| --- | --- | --- | --- |
| current configuration | run `0e994ab2-40a1-461d-81f7-ca06feb1221f`; session `ses_09f254c1effeeYkmiEvrsPntRJ`; turn `3aa2b77d-3885-4f03-bd43-ada12b7921ff`; client `task813-team-loadouts-20260714-a` | `def_data_team_loadouts` ×1 | PASS: no individual operator/catalog/Work Node call; raw text equals provider-visible text. |
| four weapon candidates | same run/session; turn `18189a64-070d-4f91-be56-aa5676ccd57b`; client `task813-team-candidates-20260714-b` | `def_data_team_loadouts` ×1 → `def_data_loadout_candidates` ×1 | PASS: structured weaponType grouping, no mutation/permission/alias search. |
| four-person weapon/equipment proposal | run `bc28aa8a-1061-4a9c-8fa2-f5ddb1f31ea7`; isolated session `ses_09edd574affekQ0Nj2GRvICUcY`; turn `e70d1366-150c-4173-86c0-b397eff4b795`; client `task813-team-recommendation-compact-20260714-i` | `def_data_team_loadouts` ×1 → `def_data_loadout_candidates` ×1 | PASS: evidence-backed proposal, no context, knowledge, file, permission, or mutation call. The owned clone-current runner/fixture was cleaned. |

Computer Use confirmed the real `DEF · 排轴助手` iframe rendered the first
four-person configuration table (弭弗：昔日精品 Lv90 and four 潮涌 pieces;
陈千语、埃特拉、阿列什 were explicitly empty) and the second response's
weapon candidates. The table matched the current real role configuration.

Compared with the historical traces (47 weapon-heavy, 33 unconfigured-team,
29 equipment-heavy, and 5 current-config calls), the accepted routes use 2,
2, and 1 data calls respectively. Exact duplicate queries, alias fishing,
permission requests, and read-only Work Node mutations were all zero in the
passing traces. The deliberately stopped intermediate oversized-output and
old-session runs are failure evidence only and are not counted as passes.

Known limits: `complete=false` is expected while three selected characters
have no saved loadout; candidate ranking remains a model judgment over the
bounded compatibility/evidence bundle, rather than a product-owned optimizer.
No Harness candidate was promoted.

## Addendum — game-knowledge exact-section contract (2026-07-15, no promotion)

This addendum replaces neither the prior routing evidence nor the task status.
It records a targeted repair only; Spec 8-1-3 remains **实施中** and no
Harness candidate is promoted.

### Historical evidence kept as failures

- The first native knowledge-routing attempt made 59 tool calls and failed.
- The second made 36 tool calls, did not completely read the 阿列什 portion,
  and mixed conclusions not explicitly supplied by the requested guide. It is
  **not PASS**.
- A further pre-repair probe read both `一、阵容概述` and
  `三、装备养成推荐`; it is failure evidence because it exceeded the one-section
  route, even though its final answer looked plausible.

### Repair

`DefGameKnowledgeReferenceSearchV1` now searches only the realpath-checked
allowlisted `game-knowledge/references/*.md` files. It returns a stable
`referenceId`, complete heading index, `recommendedSection`, and a
single-section `exactReadPolicy`. The companion
`DefGameKnowledgeSectionReadV1` accepts only that allowlisted filename and a
stable section id, returns continuous bounded Markdown rather than isolated
keyword lines, and reports `truncated`, `nextSection`, and
`availableSections`. It has its own 12,000-character bound and bypasses the
generic 600-character resource string truncation.

The resource rejects path traversal, unknown references and unknown headings
with stable errors. Batch loadout-candidate evidence now points at structured
reference/section facts rather than presenting a fixed file-prefix excerpt.

For a named four-person guide, the route is exactly one reference search then
one exact section read. The guide title is the roster source, so there is no
unnecessary current-team read. It may not open an overview section, run
per-person/catalog/file tools, request permission, create a Work Node, or
prepare/apply a mutation. It preserves source notation (including `专1+`) and
marks facts absent from the requested section as 待确认.

### Focused contract check

`node scripts/def-game-knowledge-contract-check.mjs` checks the target
`【萌新推荐】弭弗x陈千语x埃特拉x阿列什 低配高伤&无脑循环打法教学.md` reference,
continuous `三、装备养成推荐` content through 3.1–3.4, the >600-character
contract path, truncation metadata, path traversal, unknown reference, and
unknown heading.

### Final native v1 evidence

| Case | Stable ids | Data-tool sequence | Terminal / evidence |
| --- | --- | --- | --- |
| A — `你知道 YZ 的新手碎冰队吗？四个人分别是谁，攻略里怎么配装备？` | run `e6686e69-32b9-4cb1-a0b3-f29ec9f69d29`; session `ses_09e8c8360ffeJxn3k1HXgva473`; turn `dd4b8b59-340a-40c9-99a0-3d6aeda6e59d`; client `codex-1784046396519-d320b113` | `def_data_game_knowledge` → `def_data_game_knowledge_section(h2-三-装备养成推荐)` | completed in 21,828 ms; raw text exactly equals provider-visible text; answer covers 弭弗、陈千语、埃特拉、阿列什 and source-only equipment facts. |
| B — `按他那篇新手碎冰队攻略给当前四人出配装方案，先让我确认。` | run `e30d2588-9b02-4473-a9e4-0b43fdf8508b`; session `ses_09e88ebecffeQyvHwP3XM0Uxh0`; turn `10282bdb-761e-4da9-98e9-50253f65a967`; client `codex-1784046630334-e77ef4be` | `def_data_game_knowledge` → `def_data_game_knowledge_section(h2-三-装备养成推荐)` | completed in 28,909 ms; raw text exactly equals provider-visible text; source-faithful proposal stops at confirmation, with omitted values marked 待确认. |

Both paths selected the exact requested reference and read the entire 3.1–3.4
equipment chapter, including 阿列什. No transcript contains `direct read`,
`glob`, catalog/per-person lookup, permission, Work Node, or mutation tool.
Computer Use confirmed the real `DEF · 排轴助手` iframe visibly rendered the
complete final A answer and the final B confirmation draft. The v1 transcript,
not UI pixels, remains the authority for tool order and terminal state.

Known limit: this repair provides guide-faithful recommendations, not a
product-catalog id resolution or an apply flow; those are deliberately out of
scope for this route and this addendum.

## Addendum — team plan focused checks and native blocker (2026-07-15)

Focused direct contract checks before the desktop bridge became unavailable:

- remembered target reference/section/content produced `REQUIRES_CONFIRMATION`;
  an invalid decision was rejected and the returned Alesh decision produced a
  distinct READY plan hash;
- exact selected ids were `mifu`, `chenqianyu`, `chr_0021_whiten`, and
  `chr_0024_deepfin`; derived charge came from product effects (not a literal
  `174.76`), including 206.8 for the two charge-focused products;
- a different allowlisted guide returned
  `guide-plan-manifest-unavailable`, with no ice-team fallback; cross-session
  plan preparation returned 409; and the approval preview contained 37 full
  diff pattern lines.

Checks: `node --check` for all changed JS files, `git diff --check`,
`node scripts/def-game-knowledge-contract-check.mjs`, and
`npm run interop:check` passed. `npm run harness:check` currently fails before
these changes are exercised with `HARNESS_IMMUTABLE_CONFLICT` for existing
`def-stable@0.0.0` package evidence.

Native v1 record is intentionally incomplete: after opening fresh visible
sessions `ses_09b847cc3ffevy7XeFyD0rN0Ru` and
`ses_09b7e280affeeRiSIXsbMbGiYh`, the local sidecar opened thousands
of `SYN_SENT` connections to port 17321. `GET /def-agent/interop/v1/status`,
`/state`, and the snapshot endpoint then timed out. The old prohibited session
received no prompt; its outstanding native run was only stopped to remove the
stale execution, without resolving the connection storm. Therefore there are
no new testRunId/turnId, no rejection/approval claim, no persistence claim,
and no commit for this addendum.

## Native team-plan follow-up (2026-07-15)

This supersedes only the connection-storm statement above; historical failed
runs remain failures.

| Path | v1 evidence | Result |
| --- | --- | --- |
| Reject | run `1f3d9754-091e-487b-8def-780d08a2c144`; session `ses_09b3aa6c0ffe5564rwBhMbguYL`; turns `2585deda-3e20-448f-a969-33e0cd5f50d0`, `aca4ed7f-d8bf-4d57-a9b0-8ec49235c0b0`, `400f699a-5e83-4f75-8fb4-5f3dcb34c330`, `73f7952a-63c3-40d7-a76b-1d58f38f1ecf` | Exact source read, one prepare, immutable revise `91d467…6645c8` → READY `998a20…5f3c2b`; visible native full-team approval card was rejected. Apply reports explicit user rejection; four-person config before/after SHA-256 is identical: `1597699d5c7635bf49ccb322d9af9f7e10063c4abe3ae1942f7ce42043461446`. |
| Approve | run `11cc10dd-ff08-4e5a-80a7-03bd0aa84d15`; session `ses_09b35aa4effenWrjYFagGXS3hp`; READY `a9d0be…756fcf` | Visible Allow once card was clicked, but the first internal serial prepare stopped before mutation with `checkout-changed` / HTTP 409. The model made three prohibited retries; there were zero `def_operator_config_patch` calls and the four-person config hash did not change. This is **FAIL**, not APPLIED or persistent. |

The failure identified a real contract mismatch: a team plan used UI checkout
`updatedAt`, while `executeDefOperatorConfigPrepare` correctly CAS-checks the
repository Work Node `contentRevision`. Source now uses that same node revision
for plan creation and apply verification. `node --check` and `git diff --check`
pass for the repair, but the already-running REST process has not loaded it.
The remaining native approval/postcondition/persistence replay requires an
explicitly authorized minimal REST/sidecar reload; no extra restart was made.

## Minimal approval closure (2026-07-15)

The prior reject proof above remains the authoritative zero-change evidence;
it was not replayed. The historical approval run remains a failure record. Its
first real error was a plan that had expired after its native permission card
was shown, so the apply continuation pruned the unconsumed in-memory plan and
returned HTTP 409. The repair keeps only that reviewed, session-bound plan
capability alive for a bounded four-hour native-approval grace period. The
original plan TTL, session binding, checkout CAS, sidecar-restart invalidation,
and single-use apply semantics are unchanged.

After a controlled REST reload, one fresh native session completed the minimal
approval path:

| Check | Evidence | Result |
| --- | --- | --- |
| native run | run `b0fb732f-4b3a-4258-87cd-094e0aec3197`; session `ses_09a76cfc3ffe2sB8M5PrKy180s`; approval turn `3698c7f0-a38f-41fc-92d9-bf0112823c50`; client `codex-1784114989977-67ac7b8e` | PASS |
| tool route | knowledge search → exact `h2-三-装备养成推荐` section → prepare ×1 → revise ×1 → team apply ×1 | one READY plan `ffb0fd6b…77ba048`; the pre-revise plan was `7d4b2924…43e696`; no per-operator model patch calls or retries |
| native approval | real full-team card was visible and **允许一次** was clicked once | PASS |
| apply | returned `APPLIED`, same READY/apply hash `ffb0fd6b2afecb54cc3911113c2e14b49396694d5bae12d3fb93639ce77ba048`, aggregate and all four operator postconditions true | PASS, no HTTP 409 |
| persistence | Computer Use exited the real role configuration page and entered it once again; 弭弗 still showed 典范 and the 旧锋 configuration | PASS |

The apply returned four explicit serial commit results (弭弗
`ai-timeline-commit-1784115024044-ek7guuy7`, 陈千语
`ai-timeline-commit-1784115026432-y9rgrwoy`, 埃特拉
`ai-timeline-commit-1784115030027-anux3evp`, 阿列什
`ai-timeline-commit-1784115033580-mmgx76dh`). Each has a passing live,
checkout-payload, and commit-payload postcondition. This verifies the approved
plan hash against the live four-person result; it is not a repeat rejection,
full regression, or second page round-trip.

## Full equipment catalog and ASR-aware resolver (2026-07-20)

The hand-tested source session `ses_0825b8d7bffezuXCo9cWbCy0q4` exposed a
typed-tool contract failure, not stale Operator Configuration data. The page
and resolver both read `def.equipment-sheet.library.v1`, but the REST resolver
searched only the first eight items of each gear set and the OpenCode adapter
displayed only four. Neither layer truthfully reported that truncation. The
session therefore made 20 equipment calls and incorrectly claimed that
`长息轻护甲·壹型` and `拓荒增量供氧栓·壹型` were absent.

The resolver now searches a flattened full catalog before any display bound,
falls back from the saved library to the page's draft storage with the same
precedence as Operator Configuration, and returns V2 single/batch contracts
with stable ids, match method, confidence, ambiguity, catalog count,
exhaustive and truncated. Ranking is exact, normalized/phonetic, substring,
then bounded fuzzy matching over all names. Public catalog-only equipment
queries no longer require a matching current Workbench projection; current
selection and every mutation/approval/postcondition gate remain unchanged.

Focused contract evidence uses 18 sets / 158 equipment items:

- `长息轻护甲·壹型` resolves to `equipment-c-h-a-n-g-x-i-2` from the same
  page library, even though the item occurs after the old slice boundary.
- `拓荒增量供氧栓一型` resolves to `equipment-g-6-1` through phonetic
  normalization at confidence `0.96`.
- `链结点` resolves to weapon `联结点` in one call through the shared ranking
  helper rather than three fragment retries.
- the ASR-like `长息轻护甲板·壹型` returns
  `equipment-c-h-a-n-g-x-i-2` as a fuzzy `0.84` candidate with ambiguity and
  is not silently promoted to an exact match.

Candidate Harness `def-equipment-catalog-resolution@1.0.2`, content hash
`ce0e00e0c7b9c032de7dca2c674813740b9e6dfcb0ce74df3f204cdba3753bb2`,
teaches full-noun batch resolution, no fragment retry, honest absence claims,
catalog-only routing, and mandatory confirmation below `0.90` or while
ambiguous. It is registered only at
`candidate/equipment-catalog-resolution`; stable remains
`def-stable@0.0.0` / `90c89aa…71f16` and was not promoted.

An intermediate native run after only the REST reload remained a **FAIL**:
the running DEF sidecar still held the old OpenCode adapter, omitted
`catalogOnly`, and returned `blocked-session-mismatch`. After a controlled
DEF-agent-only reload, the final Pure Blackbox run passed the intended
contract:

| Evidence | Value |
| --- | --- |
| run / session | `native-harness-run-29f53923-195a-4f11-a3eb-bb62b1358180` / `ses_0822c54c3ffe1CalP3rK8rNbss` |
| testRunId / turnId | `2c57c6ce-f5f3-4d4d-89e0-d0e3fb619cab` / `6dfa1c77-d415-4b5d-9f69-86ba2c14a07f` |
| tools | one `def_data_weapon` exact query; one `def_data_equipment` four-name batch; both completed |
| response | three exact/phonetic items confirmed; fuzzy `0.84` item explicitly left unconfirmed and one clarification requested |
| terminal | `completed`; no native questions, mutation, permission or error; fixture cleanup completed |
| state | main Workbench revision unchanged and `pending: null` before/after |

Computer Use confirmed the real Chrome page at `127.0.0.1:3030`, AI mode,
the embedded DEF OpenCode session, and the preserved original failure text.
The v1 protocol remains authoritative for the new run; UI inspection was used
only to establish that the real iframe was visible.

Passing checks: `npm run test:def-equipment-resource`,
`npm run test:def-workbench-tool-policy` (50 current/tree tools),
`npm run interop:check`, `npm run harness:check`, `npm run typecheck`,
`npm run check:repo`, focused `node --check`, and `git diff --check`.

## Atomic operator configuration and fail-fast recovery (2026-07-20)

The hand-tested source session `ses_0820bbb0cffer7Cm9uk26BvG9O` resolved the
requested operator, weapon and four equipment items, but every approved
configuration failed before apply. Six native approvals returned normally and
then hit `approval is not defined`: the OpenCode adapter declared `approval`
inside its `try` block and read it outside that scope. Because the exception
also occurred outside the rejection cleanup block, six prepared operator-config
children remained open. A seventh invalid patch, Work Node materialization,
seven file reads and an attempted `inputs.json` edit followed instead of a
bounded failure report. Checkout remained on the original node and no apply
postcondition passed.

The adapter now delegates to an isolated atomic helper whose approval
capability remains in scope from prepare through apply and whose approval
failure path discards the exact prepared child. The typed schema exposes a
maximum-four `equipments` array, so one reviewed weapon and all equipment slots
enter one preview, one permission and one apply. The focused contract verifies
the full four-piece input mapping, one prepare/approval/apply sequence,
approval-capability propagation, rejection cleanup and absence of partial
mutation.

Candidate Harness `def-operator-config-atomic-failfast@1.0.3`, content hash
`e45c58b06c16d7b606eda83639eadabed65d408aec168e825171d4074ddb9340`,
is registered only at `candidate/operator-config-atomic-failfast`. It teaches
one batched catalog resolution, exact max-level fields, one atomic patch and a
hard stop after any patch error. It forbids context/bind/materialize/read/edit
fallbacks and unsupported causal guesses. Stable was not promoted.

Final Pure Blackbox failure-path evidence:

| Evidence | Value |
| --- | --- |
| run / session | `native-harness-run-756cbb24-2aac-480b-b3e3-e92174c944b1` / `ses_081f4d99dffeqxJIFT1hLx92cc` |
| testRunId / turns | `35e7ec80-b9f5-4bab-af96-735a144a2b82`; `e73039f8-5540-4b24-80c2-db6331627306`, `48ee80c9-eeaa-4549-b5b7-dbc90a956b75` |
| preview tools | one operator catalog lookup, one exact weapon lookup and one four-name equipment batch; preview included Lv90, 9/9/4, PMAX and equipment Lv3 |
| mutation | exactly one `def_operator_config_patch` containing the weapon and all four stable equipment ids/slots; no split mutation |
| terminal | hidden fixture returned `blocked-session-mismatch`; the error was the final tool event and the assistant immediately reported the supported next action |
| forbidden recovery | zero context, bind, materialize, read, edit or retry calls |
| state | both turns completed, questions empty, fixture cleanup passed, revision unchanged and `pending:null` before/after |

This is a PASS for the atomic input contract and fail-fast Harness policy, not
evidence of an approved real mutation. The candidate fixture is intentionally
not the active visible Workbench projection, and no native permission was
accepted on the user's behalf. A fresh visible-session replay must still prove
one approval, the exact live/checkout/commit postcondition, rejection cleanup
against the running adapter, and persistence after leaving and reopening the
configuration page. The six historical open children were not deleted because
that cleanup requires a separate user decision.

Passing checks: `npm run test:def-operator-config-atomic`,
`npm run test:def-equipment-resource`, `npm run test:def-workbench-tool-policy`
(50 current/tree tools), `npm run interop:check`, `npm run harness:check`,
`npm run typecheck`, `npm run check:repo`, focused `node --check`, and
`git diff --check`.

## Horizontal configuration branches and Agent-written node metadata (2026-07-20)

The hand-tested source session `ses_081eaa36fffeaNxppoPQUJwLTm` had no
configuration failure: five tools completed without error and the single
`def_operator_config_patch` returned `applied` with exact live, checkout and
commit postconditions. Its node behavior nevertheless confirmed three product
contract regressions. The applied node was a child of the then-current
checkout, its label was the fixed `[ai] 赛希 operator config`, its description
was empty, and the former custom hover detail card had been removed.

Configuration mutations now separate two identities that were previously
overloaded in `parentNodeId`: the current checkout remains the immutable
base/CAS anchor, while the persisted tree parent is the checkout node's own
parent. The resulting operator/team configuration is therefore a horizontal
sibling branch (or a sibling root when the checkout is a root) without
weakening session, revision, working-hash, permission, apply or discard
checks. Ordinary timeline edits remain children; replacement of a selected
operator explicitly requests `placement=horizontal-branch` from
`def_node_fork`.

Both single-operator and team typed mutation tools require a concise
Agent-written `nodeTitle` and one-sentence `nodeDescription`. The native
approval summary/diff, node and commit preserve those values; `[ai]`, ids,
timestamps and fixed operator-config formats are prohibited by the prompt and
Harness teaching. Work Node create/update now persist description. The node
rectangle remains title-only, while a custom tooltip appears after 420 ms and
shows the full title plus description.

Candidate Harness `def-operator-config-atomic-failfast@1.1.0`, content hash
`b1720dcd44ed5a69ed498ca7845fd3abbb6de6dbe77ff17f392186664315965d`,
is registered only at `candidate/operator-config-horizontal-metadata`; stable
was not promoted. Its package check passed.

The isolated Pure Blackbox run was
`native-harness-run-d15a0673-32ef-4e71-824f-6a897fa2e5b1`, session
`ses_081d1cef3ffeaEPIQWHl7QAZ12`, test run
`1a804640-5ef0-4ae2-a1e3-9592f1c09eb2`. Both turns completed and the fixture
was cleaned. The confirmed turn called `def_operator_config_patch` exactly
once with title `赛希骑士精神3长息1拓荒满配`, a complete Agent-written
description, the exact weapon and all four equipment ids/slots. Its expected
hidden-fixture `blocked-session-mismatch` was the final tool event: there was
no retry or context/bind/materialize/read/edit recovery. Questions remained
empty and the real Workbench state stayed at `pending:null` before and after.
This proves the candidate tool-argument and fail-fast behavior without
approving or changing the user's visible configuration.

After macOS was unlocked, Computer Use opened the real Chrome Work Node tree
at `127.0.0.1:3030` and moved the pointer onto the `长息蓄电核` node. About
0.4 seconds later the separate hover card visibly showed the complete title
and `暂无描述`, while the node rectangle itself remained title-only. This
passes the restored hover/fallback UI check for a historical empty-description
node. No real permission was accepted on the user's behalf, so an approved
visible-session horizontal node remains a deliberate human verification item
rather than a claimed pass.

Passing checks: focused JavaScript syntax checks,
`npm run test:def-operator-config-atomic`,
`npm run test:def-team-atomic-candidate`,
`npm run test:def-equipment-resource`,
`npm run test:def-workbench-tool-policy`, `npm run interop:check`,
`npm run harness:check`, `npm run typecheck`, `npm run check:repo`,
`node scripts/timeline-repository-smoke.mjs`,
`node scripts/ai-timeline-work-node-rest-smoke.mjs`, and
`git diff --check`.
