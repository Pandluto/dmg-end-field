# DEF Agent Blackbox Testing

## Purpose

Use this when checking whether DEF agent / typed tools work from the user's point of view.

The test target is the agent behavior, not just whether a tool exists.

## Entry

Use `DefCodexInteropProtocol v1` through the project workbench bridge:

```http
GET  /def-agent/interop/v1/status
POST /def-agent/interop/v1/authorize
POST /def-agent/interop/v1/turns
```

`POST /def-agent/workbench-test/prompt` remains a compatibility alias, but it requires
the same local teacher authorization and uses the same v1 handler. New checks should use
the v1 routes so that `testRunId/sessionId/turnId/clientTurnId/cursor` are recorded.

The path must preserve the current native DEF OpenCode Workbench chain:

```text
turn.start -> native Workbench OpenCode session -> DefOpenCodeView iframe -> visible UI
```

Do not replace it with an ad hoc smoke script that bypasses the native Workbench session.
`MainWorkbenchAiPanel` is only the React host for `DefOpenCodeView`; it is not a second
chat renderer and must not consume a legacy `ui.prompt` event.

## Mac Desktop Interop Route

This is the current Mac testing route for DEF OpenCode. It supersedes treating the old
`/def-agent/workbench-test/prompt` backdoor as a test protocol. Use the v1 bridge as the
authoritative observation channel; use Computer Use only to verify that the current
desktop Workbench is visible to a user.

```text
Mac Computer Use
  -> open 127.0.0.1:3030 -> Workbench -> AI 模式 -> DEF · 排轴助手

DefCodexInteropProtocol v1
  -> status -> authorize -> turn.start / continue / stop
  -> events + transcript + questions + state
```

### Readiness and normal route

1. Call `GET /def-agent/interop/v1/status` first. It must report a ready bridge and
   sidecar. A UI-visible test additionally needs `snapshotAvailable=true` and one
   Workbench consumer after AI mode is opened.
2. In the real Chrome Workbench, enter `AI 模式`. The current product surface is the
   native iframe titled `DEF · 排轴助手`; do not restore or test the retired legacy chat
   consumer.
3. Obtain the short-lived loopback authorization through `POST .../authorize`, then send
   a normal-language Pure Blackbox turn through `POST .../turns`. Keep
   `rawUserText` and `providerVisibleUserText` identical.
4. Use the returned `testRunId`, `sessionId`, `turnId`, `clientTurnId`, and event cursor
   to read the results below. The protocol, rather than Computer Use, is the authority
   for what OpenCode invoked and whether it succeeded.
5. Use Computer Use to confirm the user message and answer are visible in the native
   iframe. Leave AI mode with its `返回` control when the case is finished; do not use a
   browser refresh as a normal test step.

When Computer Use identifies the visible iframe session before its first protocol turn,
use `start-session <sessionId> <text>` (or `POST /turns` with that `sessionId`) rather
than guessing from a stale session list. A normal bare `start` targets the one currently
registered Workbench consumer; consumer registration is intentionally single-active.

### What the backdoor can observe without Computer Use

| Need | v1 route / evidence |
| --- | --- |
| accepted, first reply, terminal state, tool start/result/error | `GET /sessions/:sessionId/events?cursor=:seq` |
| provider-visible messages and native tool parts | `GET /sessions/:sessionId/transcript` |
| native option/permission cards, choices and resolution state | `GET /sessions/:sessionId/questions` |
| checkout, selected operators and pending command/node | `GET /state` |
| UI-consumer/session lifecycle only | `GET /ui-events?cursor=:seq` |

An absent `ui-rendered` callback is not a failure of an OpenCode turn and is not a
blackbox acceptance gate. Do not spend a normal Agent capability test debugging that
optional frontend acknowledgement. A visible message in the real iframe is the UI check;
events/transcript/questions/state are the diagnostic record.

### Blocked-case rule

If a turn is blocked, stalls, or produces unexpected repeated tool activity, do not send
the same prompt again. First collect the session's events, transcript, questions and
state, then record the observed tool calls, error/permission status, pending command and
terminal state. Fix a confirmed process/bridge defect before starting a fresh case.

Do not delete native sessions during a normal test. Closing the extra visible session is
allowed only when it is clearly not the active case and the action has been confirmed.

## Windows Chrome UI Route

When the test must verify that the main workbench UI is actually usable on Windows, use the Chrome plugin path:

```text
Chrome Extension + node_repl JavaScript control
```

This is not desktop-level Computer Use. It only controls Chrome through the Codex Chrome Extension.

Required setup:

1. Use the `control-chrome` skill.
2. Search for `node_repl js JavaScript execution` with `tool_search`.
3. Use the exposed `mcp__node_repl.js` tool.
4. Bootstrap Chrome with `browser-client.mjs` and `agent.browsers.get('extension')`.

Reference bootstrap:

```js
if (!globalThis.agent) {
  const { setupBrowserRuntime } = await import(
    'file:///C:/Users/zsk86/.codex/plugins/cache/openai-bundled/chrome/26.527.31326/scripts/browser-client.mjs'
  );
  await setupBrowserRuntime({ globals: globalThis });
}

if (!globalThis.browser) {
  globalThis.browser = await agent.browsers.get('extension');
}
```

For the local workbench:

1. Open `http://127.0.0.1:3030/`.
2. If `3030` is already listening, do not stop or restart `npm run electron:dev`.
3. If `3030` is not listening and the test requires the main UI, it is acceptable to start `npm run electron:dev`.
4. Select local operators in the selection page until `开始排轴` is enabled.
5. Enter the main workbench and click the right-side `AI 模式` button.
6. Treat the UI route as ready only after the `输入排轴操作` textbox is visible and the panel shows `DEF OpenCode` in a waiting/ready state.

When the browser tab is the handoff artifact, finalize the Chrome session with that tab kept as `deliverable`.

## Prompt Rules

Blackbox prompts must look like normal user messages.

Allowed examples:

- `加个...`
- `换个...`
- `减个...`
- `查个...`
- `这个怎么样`
- `那个是什么`
- `为什么这样`

Do not include any of these in the prompt sent to the tested agent:

- `这是测试`
- case numbers
- expected tool names
- expected behavior
- validation criteria
- safety instructions
- implementation details

Keep test intent, expected result, and judgment outside the prompt, in the test record only.

## Multi-Turn Rule

If the tested agent asks a normal follow-up question, continue like a real user.

Example:

```text
佩丽卡加个普攻
```

If the agent asks who to replace and which attack to use, continue with a natural answer:

```text
把卡缪换掉，用协议α·突破，先看一下
```

Do not stop at the first refusal or clarification request when the real user would continue.

## Observable UI Rule

For observable front/back integration tests, avoid actions that refresh the main UI unless that is the specific thing being tested.

Commands such as these may trigger `window.location.reload()` by default:

- `checkoutAiTimelineWorkNode`
- `restoreAiTimelineWorkNodeBase`
- `restoreTimelineSnapshot`

If a test must cover checkout or restore, call that out separately and prefer `reload:false` where supported, or mark the case as breaking visual continuity.

## Required Record

Each blackbox turn should record:

- prompt text
- session id
- first response time
- completion time
- tool calls
- whether current timeline state changed
- pending command count
- final answer summary
- pass/fail/unclear judgment

Without timing, the result is only qualitative and should not be treated as a complete performance assessment.

## Test Scope

Choose natural-language prompts and the number of turns according to the behavior
being checked. Prefer a short multi-turn conversation when the behavior depends on
clarification or retained context; a focused single turn is sufficient for an
isolated capability.

## Read-only equipment 3+1 regression

For the natural-language case `为别礼挑选一套装备，3 潮涌+1，需要主副属性都对`, retain the v1
transcript and verify this read-only route:

1. Call `def_data_equipment_3plus1_recommend` exactly once for the turn.
2. Do not call a legacy guide/profile/catalog/shortlist/facts/plan model route, generic
   game-knowledge, generic operator or skill fallback, Workbench/node tools, mutation, or
   approval.
3. Record the tool result's terminal state, questions, transcript, and before/after product
   state. Checkout, selection, pending command, branch, commit, and approval state must remain
   unchanged.

Interpret the typed result rather than recreating its internal reasoning. `READY` may present
the returned evidence-backed recommendation, returned comparisons, and one best combination
with at most two returned close alternatives. `NEEDS_INPUT` must ask only the returned bounded
question. `UNRESOLVED` must identify returned missing or ambiguous evidence and must not invent a
plan. The answer must not reinterpret equipment `fixedStat` as an operator attribute or invent a
drop main stat, elemental trigger, or damage benefit.

For a request without a named target set, the same single composite call remains required. Do
not assemble an alternate route from catalog or legacy equipment tools.

If the Workbench AI panel reports an unavailable SQLite workspace instead of mounting its
iframe, record it as a transport/session-topology failure, not as a catalog result. Confirm
that the Electron-owned REST child and any sidecar-recovered REST child use the same local
SQLite paths before opening a fresh native session; do not bypass the panel with a direct
OpenCode page and call that a UI pass.

For a configuration proposal, record the `def_operator_config_preview` result and verify that
it changes neither branch, checkout nor approval state. A later explicit user application turn
must carry the unchanged proposal token into `def_operator_config_patch`; native approval and
the visible postcondition remain required. A comparison, correction, or question such as
“为什么不用两个悬河供氧栓” is a fresh read-only recommendation turn: it must call
`def_data_equipment_3plus1_recommend` exactly once, must not call the patch tool, and still
requires a fresh preview before any later application.

## Support weapon convention regression

For the natural-language case `给赛希挑把武器，重点考虑她给队伍带来的收益`, keep the turn
read-only and retain the v1 transcript. The expected evidence order is:

1. `def_data_operator_build_guide` resolves whether an exact operator guide exists.
2. When the guide is partial or absent, `def_data_combat_conventions` resolves one reviewed
   `weapon-fit` bundle before `def_data_operator_build_profile`; pass the exact fallback token
   and `bundleHash` unchanged.
3. `def_data_weapon_fit_plan` receives the unchanged typed profile capability and exact
   convention hash. It must evaluate every compatible current-catalog weapon with complete
   skill1/2/3 facts.

This route must not use generic game-knowledge search, generic operator/skill fallback,
truncated `def_data_weapon`, loadout candidates, mutation, node, or approval tools. Record the
guide state, convention rule ids and qualitative certainty, profile derivation, compatible and
evaluated catalog counts, complete shortlisted facts, questions, and before/after state.

The answer must preserve the difference between deterministic, high-probability and
low-probability edges. For 赛希, it may explain that two controller heavy attacks after her
combat skill make her combo skill available; that combo skill heals the controller and applies
ice; the reviewed chain then treats magic burst as high-probability and magic anomaly as
low-probability. It must not turn either edge into certainty or a percentage. 骑士精神 should
be discussed through its reachable post-heal team attack effect. 爆破单元 should be discussed
through the reviewed magic-burst vulnerability condition and its intelligence-linked passive.
If the planner returns `READY_WITH_TRADEOFFS`, report an unordered tradeoff matrix: do not use
first/second labels, convert evidence dimensions into an overall score, call one candidate more
comprehensive, or name a universal winner. Personal attack, elemental damage, survivability,
weapon element, or will are not team benefits unless the returned profile and reviewed rules
explicitly authorize them. Claims such as “稀有乘区” also require explicit returned evidence.

## Damage weapon and nested skill-hit regression

For `汤汤该选什么武器`, retain the v1 transcript and require exactly one
`def_data_operator_build_guide` followed by one `def_data_weapon_fit_plan` when the guide result is
`GUIDE_FOUND` with `combatConvention=not-required`. The planner call must preserve the exact profile
and capability and omit `conventionBundleHash`. The turn must not call combat conventions, fallback
profile, selected-team/loadout candidates, legacy weapon summaries, native catalog materialization,
generic skill/damage/Buff probes, Workbench/node tools, mutation, or approval. If the planner returns a
terminal typed error, no later DEF data tool may execute in that turn; record the structured
`nextAction` and do not accept a fallback ranking.

For `图腾下落-2层里的水龙卷算什么伤害`, call `def_data_skill` once with exact operator `汤汤`
or `tangtang` plus the exact skill id/name. The result must resolve one candidate from the selected
operator catalog and expose complete per-hit facts. Verify that the parent skill is `Q`, while the
`3个水龙卷总倍率(含天赋)` hit is independently classified as `B`, is ice, and retains its complete
level table. A parent button type never overrides a hit-level damage type. Do not use combat
conventions, generic knowledge, current buttons, damage reports, native artifacts, mutation, or
approval for this catalog fact question. Both cases are read-only and must keep checkout, selection,
pending command, branch, commit, and approval state unchanged.
