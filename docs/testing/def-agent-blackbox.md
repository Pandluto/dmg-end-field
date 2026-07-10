# DEF Agent Blackbox Testing

## Purpose

Use this when checking whether DEF agent / typed tools work from the user's point of view.

The test target is the agent behavior, not just whether a tool exists.

## Entry

Use the project workbench backdoor:

```http
POST /def-agent/workbench-test/prompt
```

This path should simulate a real main workbench AI input turn and preserve the chain:

```text
prompt -> ui-events -> MainWorkbenchAiPanel
```

Do not replace it with an ad hoc smoke script that bypasses the workbench prompt path.

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
