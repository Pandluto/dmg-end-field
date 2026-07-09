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

## Minimum Coverage

For a meaningful pass, run at least 15 natural user turns across mixed intents:

- read/query
- why/explain
- preview add
- preview move
- preview remove
- ambiguous edit
- follow-up clarification
- invalid target
- cross-character or lineup change
- buff add/remove
- damage check
- equipment/config query

Prefer multi-turn sessions over isolated one-shot prompts when judging real usability.
