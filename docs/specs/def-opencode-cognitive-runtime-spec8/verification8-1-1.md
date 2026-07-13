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
