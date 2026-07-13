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
