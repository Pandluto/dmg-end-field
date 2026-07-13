# Spec 8-1-1 verification — DefCodexInteropProtocol v1

## Result

Implemented and verified against the current native DEF OpenCode Workbench UI.
Protocol: `def-codex-interop`, major `1`.

## Route map

| Capability | Route |
| --- | --- |
| handshake/status | `GET /def-agent/interop/v1/status` |
| temporary local authorization | `POST /def-agent/interop/v1/authorize` |
| start | `POST /def-agent/interop/v1/turns` |
| continue | `POST /def-agent/interop/v1/sessions/:sessionId/turns` |
| stop | `POST /def-agent/interop/v1/sessions/:sessionId/turns/:turnId/stop` |
| events | `GET /def-agent/interop/v1/sessions/:sessionId/events?from=:seq` |
| transcript | `GET /def-agent/interop/v1/sessions/:sessionId/transcript` |
| state | `GET /def-agent/interop/v1/state` |
| UI events | `GET /def-agent/interop/v1/ui-events?from=:seq` |

The former `/def-agent/workbench-test/prompt` is a v1 compatibility alias. The old
`ui.prompt`/`workbench-test/ui-events` transport and prompt wrapper were removed: the
current consumer is the native OpenCode session hosted by `DefOpenCodeView`.

## Local integration entry

The npm entry only calls the v1 allowlisted routes; it adds no file, terminal, or
permission-bypass capability.

```bash
npm run interop -- status
npm run interop:hello
npm run interop -- continue <sessionId> "请继续"
npm run interop -- transcript <sessionId>
npm run interop:check
```

On 2026-07-13, `npm run interop:hello` accepted Pure Blackbox `你好` with
`testRunId=fd1eb37d-d597-4e1a-93e6-d865864e6546`,
`sessionId=ses_0a5e6e05effeuiCzouD1v3IlLY`,
`turnId=8bd6955d-6bb1-4cc1-be2f-7e74d5d59bd7`, and
`clientTurnId=codex-1783924323924-6e9b8523`. The returned
`rawUserText` and `providerVisibleUserText` were both exactly `你好`.
Computer Use then observed that same user message and its native response in the
visible Workbench iframe; the turn completed in about 3 seconds with no tool call,
pending command, or mutation.

## 2026-07-13 stale-draft regression and retest

An initial four-operator preview exposed a safe failure: an old session had an
unsynchronized draft while the Workbench checkout had changed. `def_node_bind`
correctly rejected replacement of that draft, but the agent then retried unrelated
node tools. The Workbench wrapper now provides **新建 DEF 会话**, which creates an
independent native workspace and re-registers the real UI consumer; bind-rejection
guidance now tells the agent to stop tool activity and ask the user to review the
preserved draft or start that new session.

Computer Use created the new visible native session
`ses_0a5cb4a7bffeWFs8iii5OIuWZ1` and completed a Pure Blackbox mutation-preview
run `testRunId=8b671b25-f3fa-49c7-bc4b-0b9204cf39f7`. The initially requested
replacement could not select four *other* operators because the local catalog has
only the four already present. A natural continuation then retained those four and
previewed one skill each: 莱万汀 Q 黄昏, 狼卫 E 连携, 艾尔黛拉 E 火山蘑菇云,
and 卡缪 Q 猩红坠雨. `turnId=1ffeabb5-81f2-4441-92fe-32e4f6d61dc1` completed
after `def_node_sync_validate` with 23 buttons reduced to 4, no blocker, two
warnings, and no `def_node_use`/apply. The validation table and “未应用” notice
were visibly rendered in the desktop Workbench UI.

## Client sketch

```js
const base = 'http://127.0.0.1:31457/def-agent/interop/v1'
const { token } = await fetch(`${base}/authorize`, { method: 'POST' }).then((r) => r.json())
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
const { turn } = await fetch(`${base}/turns`, {
  method: 'POST', headers,
  body: JSON.stringify({ protocolVersion: 1, ingressMode: 'pure-blackbox', rawUserText: '这个怎么样', clientTurnId: 'codex-readonly-01' }),
}).then((r) => r.json())
```

## Boundary and security

- Pure Blackbox stores and sends identical `rawUserText` and `providerVisibleUserText`.
  Host, agent and current Workbench facts are supplied as native session system/context,
  never concatenated into the user message.
- Diagnostic is explicit and records its purpose/scope/mutation allowance and the final
  provider-visible messages. It does not count as a Pure Blackbox result.
- Teacher routes require a short-lived in-memory loopback authorization, reject non-local
  Host/Origin, write token-free JSONL audit records, and reject release/profile ingress
  with `teacher-ingress-disabled`.
- The sidecar adapter exposes only fixed native-session prompt/transcript/stop operations.
  It adds no terminal, arbitrary-file or permission-bypass capability.

## Desktop Computer Use evidence

Computer Use opened the actual Chrome Workbench, selected four local operators, entered
AI mode, and observed the native iframe titled `DEF · 排轴助手` with a ready composer.
For run `bbfec316-f0d2-4110-92a0-ab32ce90d552`, session
`ses_0a5e6e05effeuiCzouD1v3IlLY`, the UI visibly rendered:

- `这个怎么样`, then a streamed answer with `def_workbench_context` and
  `def_workbench_current_node` cards;
- continuation `那就先看看佩丽卡的技能`, its native tool cards and final answer;
- stop test `再说详细点`, whose native UI state became `已中断`;
- mutation preview `佩丽卡加个普攻，先看一下`, including the visible validation/tool flow.

This is desktop-visible evidence, not an API/transcript/DOM substitute.

## Blackbox record

| Case | Prompt | Correlation / result |
| --- | --- | --- |
| readonly start | `这个怎么样` | `turnId=ff4a2ded-014f-496d-8b33-6ccbefec7b24`; accepted immediately, UI first visible while streaming, completed in about 14 s; tools `def_workbench_context`, `def_workbench_current_node`; no pending command or state mutation. |
| natural continue | `那就先看看佩丽卡的技能` | `turnId=4d816ae6-e375-4665-abe7-65550d9a3caf`; same testRun/session, completed in about 45 s; native data/workbench read tools, no mutation. |
| stop | `再说详细点` | `turnId=7c7f761a-983c-4df4-b569-85c989940745`; stopped immediately after accepted; UI displayed `已中断`; no pending command or state mutation. |
| mutation preview | `佩丽卡加个普攻，先看一下` | `turnId=375beac9-9829-43ba-8dad-88872b0e06f0`; isolated draft edit and `def_node_sync_validate` were visible; preview reported validation/no-risk and did not call use/apply. |
| snapshot unavailable | focused protocol check | diagnostic mutation with unavailable snapshot returns `409 snapshot-unavailable`; it never calls the sidecar. |
| UI consumer unavailable | focused protocol check | start without a registered Workbench consumer returns `409 ui-consumer-unavailable`; it never calls the sidecar. |

## Focused checks

`node scripts/def-codex-interop-check.mjs` covers protocol version validation,
handshake, UI-unavailable failure, Pure Blackbox exact text equality, stable-id idempotent
retry, bounded state, and release ingress rejection. Syntax checks passed for the bridge,
sidecar and shared contract. Repository-wide `tsc --noEmit` remains blocked by pre-existing
test typing errors in `aiCliCommandService.test.ts` and missing `node:assert/strict` types.

## Refresh behavior

Electron bridge changes require restarting `npm run electron:dev`; the UI consumer must
then remount (toggle Workbench AI mode is sufficient). Normal sidecar/UI changes only need
the smallest relevant refresh. No token, trace dump or screenshot is committed.

## 2026-07-13 — native checkout repaint repair

The native `def_node_use` route already reached the renderer checkout command with
`reload:false`, but the checkout completion path only hydrated its data stores. Stateful
Canvas and skill-sandbox children could therefore retain pre-approval layout state until a
browser refresh. `CanvasBoard` now increments a checkout-only render revision after a
successful checkout hydration. That re-mounts only the data-bound canvas and right-side
tool/sandbox once and refreshes the Work Node tree; it does not call
`window.location.reload()` and does not recreate the native OpenCode session.

Computer Use verified the real Chrome Workbench after native session
`ses_0a5ba5e3dffeFbiCIEFn870gQ3` reviewed node
`ai-timeline-node-1783926199949-8i1p4ubr` (`替换四人新干员各一技`). After the
checkout path completed, leaving AI mode without reloading still showed the four visible
operator cards 弭弗、陈千语、洛茜、黎风 and exactly four visible canvas skills
Q 绝心、E 见天河、B 血红之影、A 摧破. Opening the Work Node tree in the same page
showed the applied node as the current protected path with `4 干员 / 4 按钮`.

The draft's display labels (`怒鸣/凝冰/迅影/破风`) are normalized to the local
runtime templates during hydration; the visible canonical labels above are therefore the
expected renderer result, not a failed checkout. Chrome's reload control was never used.

## 2026-07-13 — four-operator loadout blocked-run record

This is a failure record, not a passing loadout result. After the user requested suitable
weapons and equipment for 弭弗 (`mifu`), 陈千语 (`chenqianyu`), 洛茜 (`luoxi`), and
黎风 (`lifeng`), the native conversation logs were collected instead of retrying the
blocked request.

- Initial session `ses_0a5ba5e3dffeFbiCIEFn870gQ3`, prompt at 15:18:
  `Configure suitable weapons and full equipment for all four current operators: mifu, Chen Qianyu, Luoxi, and Lifeng. Create an isolated draft, validate the diff, then apply it to the Workbench after the native confirmation.`
  It called context, weapon and equipment resources, then stated that weapons were not
  available in the trusted data store. It forked a draft but was stopped before the
  write/validation sequence completed; the visible UI recorded `write 失败` and
  `已中断`. No `def_node_use` call occurred.
- Fresh session `ses_0a5a44d9effe14YCi5KM5tSnf3`, prompt at 15:23:
  `For the four current operators only (mifu, chenqianyu, luoxi, lifeng), inspect the current trusted weapon and equipment candidates. Create a draft assigning each operator one valid weapon and a complete valid equipment set. Do not invent data. Validate the diff and show the four exact loadouts. Do not apply anything yet.`
  The transcript records `weapon: null` and `equipmentCount: 0` for all four operator
  resources, and every `def_data_weapon` query returned an empty candidate list.
  Equipment candidates were found: 旧锋, 碾骨, 50式应龙, and M.I.警用.
- The stopped session nevertheless has an in-flight isolated child node
  `ai-timeline-node-1783927517234-b99xdwv2` (`为四人配装武器与装备`). Its final
  recorded tool was `def_node_sync_validate`: `validation.ok=true`, no blocker, and
  `currentCheckoutTouched=false`. Its diff was incorrectly `no diff` even though the
  generated payload contained three equipment ids per operator in `characterInputMap`.
  No `def_node_use` or checkout route appears in the transcript.
- Computer Use then left AI mode and opened the real Work Node tree. It visibly showed
  the `AI 校验` child with `4 按钮 / 0 Buff`; the main canvas still visibly showed the
  same four cards and four skills. No browser reload was used.

The record exposes two follow-up defects: semantic diff/risk analysis does not include
`characterInputMap` loadout changes, and the agent can describe a weapon assignment even
when the trusted weapon query returns no candidates. The child-node validation that was
already in flight also completes after the user stops the turn; the stop state must be
correlated with tool completion so the UI cannot represent that partial draft as a
completed loadout. These are not accepted as a successful weapon/equipment test.

### Recorded repair (no prompt replay)

The loadout diff now includes `characterInputMap` changes as
`changedCharacterInputCount` / `changedCharacterInputs` in both the renderer worktree
model and the Electron bridge. Consequently, a loadout-only child node has a non-empty
diff summary and an approval rationale that counts the affected operators. The embedded
Workbench agent now has a hard instruction that an empty `def_data_weapon` result blocks
a full weapon-and-equipment draft: it must neither mutate that draft nor claim a weapon
assignment. A focused `diff.test.ts` check, the existing checkout lifecycle check,
`node --check` for Electron/adapter, and `npx vite build` passed. Per the blocked-run
instruction, the native loadout prompt was not replayed after this repair.

## 2026-07-13 — four-operator loadout retry

Computer Use retried the original full-loadout intent in a new visible native session
`ses_0a596edb2ffe3QCfvN0tqizaZ8` at 15:37:

`Give all four current operators (mifu, chenqianyu, luoxi, lifeng) suitable weapons and complete equipment sets. Use only trusted current data. Create a validated preview, do not apply it.`

The native transcript first completed Workbench/operator/weapon/equipment reads. Every
weapon lookup for the four operators and physical/guard variants returned no trusted
candidate. Instead of forking or editing a complete loadout draft, the real Workbench UI
rendered a single native business question with two choices: equipment-only preview or
cancel. It visibly presented the equipment recommendations 旧锋 (弭弗), 碾骨 (陈千语),
50式应龙 (洛茜), and M.I.警用 (黎风), while explicitly stating that it could not claim a
weapon assignment or fork a weapon-and-equipment draft.

The test selected `取消本次请求` to preserve the requested full-loadout boundary. The
visible final result said the current axis was unchanged and all four operators had no
weapon or equipment. The transcript contains no `def_node_fork`, edit/write,
`def_node_sync_validate`, or `def_node_use`; completion took about 1 minute 54 seconds.
This is a successful blocked-path result, not a successful application of equipment.

## 2026-07-13 — delegated backdoor blackbox audit

A delegated, read-only blackbox run used the stable v1 backdoor while the primary agent
audited the protocol state machine. It did not change code, start or stop services, use
the UI, trigger mutation, or use Teacher ingress.

- Handshake/status and state were ready: bridge, sidecar, snapshot and one Workbench UI
  consumer were available; state reported the four current operators and no pending
  command.
- Pure Blackbox `你好` used `testRunId=8a37137f-97c0-4ee9-9893-cb16aeb8507a`,
  `sessionId=ses_0a596edb2ffe3QCfvN0tqizaZ8`,
  `turnId=49df0db6-8859-431a-b892-8bbef02e21e0`, and
  `clientTurnId=blackbox-hello-1783929233608-e79039`. It was accepted at cursor 3,
  first response at cursor 6 (about 6.1 s), and completed at cursor 7. The raw and
  provider-visible text were both exactly `你好`; no tool ran.
- Continue `现在的排轴状态怎么样？` used turn
  `e75deea7-2ec8-4ac1-9af8-9887598e5a70`; it produced accepted, UI-consumed,
  first-response and completed events (cursors 8–11), with no tool or pending command.
- The initial stop test exposed an architecture bug: turn
  `307297a1-c021-4ba8-8b2b-75e6bffc2ffb` returned `stopped` at cursor 14, but the
  observer later emitted `completed` at cursor 15 from an upstream
  `MessageAbortedError: Aborted` message with zero tokens. Cursor replay from 7 was
  otherwise correct (`headCursor=15`, `earliestCursor=1`, `gap=false`); UI replay had
  stable `uiEventId` values and no `ui-rendered` because that delegated run did not use
  the desktop UI.

### Stop terminal-state repair

`observeTurn` now rechecks the protocol record after every sleep, transcript fetch and
tool iteration before it emits an event or reconciles a provider completion. A focused
in-process regression creates an aborted upstream transcript after a stop and asserts
that the transcript status remains `stopped` after the observer wakeup.

After restarting the Electron bridge, a real backdoor start/stop run verified the fix:
`testRunId=0114211a-7556-4507-ae30-956ee2423bd6`,
`sessionId=ses_0a596edb2ffe3QCfvN0tqizaZ8`,
`turnId=43a05a6a-65d5-4625-bf2d-87cb09094e69`, and
`clientTurnId=stop-regression-1783929541560`. The raw and provider-visible text were
identical. The replay sequence was `accepted` (2), `session-created` (3),
`ui-prompt-consumed` (4), `ui-rendered` (5), `stopped` (6); after 1.4 seconds the
transcript still reported `stopped` and no `completed` event existed for that turn.

The audit also found a remaining architecture item: `ui-rendered` is currently emitted
by the outer Workbench consumer immediately after it receives `ui-prompt-consumed`; the
iframe does not independently attest that a particular native message was painted. This
is a protocol/UI-consumer semantics issue to repair in the current architecture, not a
future Harness concern. Until then, `ui-rendered` is dispatch acknowledgement rather
than sufficient visual proof; Computer Use remains the visual proof source.

## 2026-07-13 — native iframe render-attestation investigation

The immediate outer-consumer acknowledgement was removed from the active path. The
consumer now has a scoped render secret, verifies it before reading the exact turn text,
and closes its registration when AI mode closes; a close/reopen was observed to move
`uiConsumerCount` from `1` to `0` and back to `1`. The protocol rejects unverified
render-target reads and unverified `ui/rendered` acknowledgements in the focused check.

The sidecar additionally injects a same-origin external bridge script into proxied native
session HTML and waits for a matching text node before it would acknowledge rendering.
The script was fetched from the real `17322` session route and its served JavaScript
parsed successfully. However, repeated live Pure Blackbox runs still produced only
`ui-prompt-consumed`, `response-first-token`, and `completed`; no matching
`ui-rendered` event was received. The real desktop UI visibly rendered every tested
prompt, including:

- `你好，最终验证原生 UI 渲染事件。`
  (`turnId=37ee5cab-2cbc-4f64-8c8d-2c13aa57e7b0`), and
- `你好，确认 load 后的真实 UI 渲染事件。`
  (`turnId=ff7117da-a86e-420a-8e12-ef1e97f10bf1`).

Both were attached to `sessionId=ses_0a57a08d5ffe8uLlvzjVYBjSoi`; raw and
provider-visible text were exactly equal. Computer Use visibly showed the real native
messages and the current four-button canvas (弭弗/Q绝心, 陈千语/E见天河,
洛茜/B血红之影, 黎风/A摧破), without a browser refresh.

This is an unresolved current architecture defect in the iframe-to-parent attestation
path, not a Harness item. `ui-rendered` must remain absent rather than be fabricated;
Computer Use is the valid visual evidence until the cross-frame callback is made
observable end-to-end.

## 2026-07-13 — OpenCode-native observation hardening

The v1 protocol now exposes `questions.read` at
`GET /def-agent/interop/v1/sessions/:sessionId/questions`. It reads the native
OpenCode question queue through the sidecar, preserves each `requestId`, question text,
options, answer/status and runtime status, and associates observed questions with the
owning protocol turn. It is strictly read-only: it does not add a teacher route to
answer, approve or bypass a native question.

`observeTurn` now normalizes a tool's stable call id, name, bounded/redacted input,
result summary and structured failure payload. It emits each `tool-start`,
`tool-result` or `tool-error` state once. A completed provider message carrying
`info.error` now becomes `provider-error` (or `stopped` for an abort), instead of being
silently reported as `completed`. Open native questions emit `permission`; their later
state changes emit `permission-resolved`.

Focused in-process protocol checks passed after the sidecar/bridge restart. They cover
a completed native tool with a redacted token input, an open two-option native question
card, a provider network timeout mapped to `provider-error`, idempotent render
acknowledgement, cursor replay and the pre-existing stopped-turn regression. The
restarted live bridge reported protocol version 1 and the new `questions.read`
capability. At the time of this check no Workbench AI consumer was open
(`uiConnected=false`), so no live model turn or UI claim is made for this entry.

## 2026-07-13 — blocked live protocol observation (17:19 +0800)

This was a deliberately single-attempt real desktop preparation for the new OpenCode
observation contract. Computer Use selected 弭弗、陈千语、洛茜、黎风, entered the
Workbench, opened AI mode, and confirmed the native session
`ses_0a57a08d5ffe8uLlvzjVYBjSoi` with an actual input box. The visible current canvas
contained Q-绝心, E-见天河, B-血红之影 and A-摧破. AI mode was then exited using its
`返回` button; the main page was not refreshed and no session was deleted.

No prompt, `testRunId`, `turnId`, tool call, pending command, provider response or
question was created for this case. Before a backdoor turn was sent,
`127.0.0.1:17321` (the Workbench snapshot service) stopped responding. Its Electron
process was listening but consuming about 92–97% CPU. As a recovery attempt, the stale
snapshot process and duplicate starter were stopped, then the sidecar's normal
`POST /api/runtime/ensure` path reported `defTools.running=true, owned=true`; the new
snapshot process again listened yet timed out after 3 seconds. The sidecar health route
remained `200`, while bridge status again blocked waiting for the snapshot dependency.

Judgment: **blocked before turn submission**. This is a snapshot-process defect, not a
model/tool/option-card result and not a reason to retry the same prompt. The next valid
live protocol test starts only after `17321/health` responds promptly; it should then
use one read-only natural-language turn and record the resulting ids, tool events,
questions and terminal state.
