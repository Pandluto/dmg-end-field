# Task 12 UX Fix: Proposal review operation experience

## Background

Task 12 completed the functional proposal-first flow:

```text
*.fill.apply -> proposal created
Y / proposal.approve -> apply to working draft
Y / proposal.save -> save to local truth
N / reject / unsave -> cancel the current step
```

The flow is functionally closed, but the Web CLI experience is still too close to a developer debug console:

- Proposal ids are long and hard to type.
- The moment requiring `Y/N` is not clearly prompted in Chinese.
- Agent logs are mostly English and do not surface approval/save state clearly.
- `proposal.list` and `proposal.show` are readable by engineers, not by users.
- The input has no command history, tab completion, or keyboard shortcuts.

This fix focuses on operation experience. It does not change the proposal state machine.

## Goals

Make `/ai-cli` usable as a proposal review console:

- Users can identify proposals by short readable aliases.
- Users always know whether the next action is approve/reject or save/unsave.
- Terminal output is Chinese-first with English fallback.
- Agent log lines expose proposal status clearly.
- Keyboard interaction supports common CLI behavior.

## Non-goals

Do not implement:

- New business domains beyond Buff/Weapon.
- Proposal payload schema changes.
- Proposal cleanup policy.
- Visual autocomplete dropdown.
- Full proposal diff rendering.
- Authentication or REST token design.

Those belong to later tasks.

## Scope

Modify as needed:

- `src/aiCli/aiCliCommandService.ts`
- `src/aiCli/aiCliAgentInfrastructure.ts`
- `src/components/AiCliPage.tsx`
- `src/aiCli/aiCliCommandService.test.ts`
- Optional: `scripts/ai-cli-rest-smoke.mjs` if REST-visible lines need coverage

Do not change:

- approval/save state transitions
- REST approval blocking
- storage write boundaries
- adapter validation behavior

## UX Principles

### Chinese-first, English-fallback

Terminal lines should be Chinese-first and include enough English for external agents and debugging:

```text
[ok] 提案已创建 / proposal created: #1 proposal-...
[next] 输入 Y 批准并应用到草稿，输入 N 拒绝 / Press Y to approve, N to reject
```

Avoid English-only lines at review decision points.

### Always show the next action

Any command that creates or transitions a proposal must include the next expected action:

- After `*.fill.apply`: approve or reject.
- After `proposal.approve` / `Y` approval: save or unsave.
- After `proposal.save`: flow closed.
- After `proposal.reject`: flow closed.
- After `proposal.unsave`: flow closed.

### Short aliases are display aliases, not stored ids

The full proposal id remains the source of truth. Short aliases like `#1` are generated from the current pending proposal list and resolved at command time.

## Required Features

### 1. Proposal short aliases

Add short aliases for pending proposals in the current view/session.

Expected display:

```text
编号  领域/domain  审批/approval  保存/save  摘要/summary
#1    buff         待审批/Wait     待保存/Wait  buff fill: items=1 effects=4
#2    weapon       已审批/Yes      待保存/Wait  weapon fill: name=...
```

Alias rules:

- `#1`, `#2`, ... are generated from the ordered pending proposal list.
- Aliases are accepted by:
  - `proposal.show #1`
  - `proposal.approve #1`
  - `proposal.reject #1`
  - `proposal.save #1`
  - `proposal.unsave #1`
- Full proposal ids continue to work.
- If an alias is out of range, return `ok:false` with a Chinese-first error.
- Alias resolution should be scoped to the current session when the command depends on current session UX.

Implementation suggestion:

```ts
resolveProposalReference(input: string, sessionId?: string): AiAgentProposal | null
```

### 2. Review-state labels

Map internal status values for display:

```text
approval=Wait -> 待审批/Wait
approval=Yes  -> 已审批/Yes
approval=No   -> 已拒绝/No

save=Wait -> 待保存/Wait
save=Yes  -> 已保存/Yes
save=No   -> 未保存/No
```

Use these labels in:

- `proposal.list`
- `proposal.show`
- Agent SSE log lines
- proposal transition responses

### 3. Bilingual proposal transition responses

#### After `*.fill.apply`

Expected lines:

```text
[ok] 提案已创建 / proposal created: #1 proposal-...
[state] 审批=待审批/Wait 保存=待保存/Wait
[next] 输入 Y 批准并应用到草稿，输入 N 拒绝 / Press Y to approve, N to reject
```

`response.proposal.nextAction` should also be explicit:

```ts
nextAction: 'reply Y/N in web-cli to approve or reject'
```

#### After `proposal.approve` or approval `Y`

Expected lines:

```text
[ok] 已批准并应用到当前草稿 / approved and applied to working draft: #1 proposal-...
[state] 审批=已审批/Yes 保存=待保存/Wait
[next] 输入 Y 保存到本地主库，输入 N 取消保存 / Press Y to save, N to unsave
```

`response.proposal.nextAction`:

```ts
nextAction: 'reply Y/N in web-cli to save or unsave'
```

#### After `proposal.save` or save `Y`

Expected lines:

```text
[ok] 已保存到本地主库 / saved to local truth: #1 proposal-...
[state] 审批=已审批/Yes 保存=已保存/Yes
[done] 审核闭环完成 / review flow complete
```

#### After `proposal.reject` or reject `N`

Expected lines:

```text
[ok] 已拒绝提案，未修改草稿 / rejected, draft unchanged: #1 proposal-...
[state] 审批=已拒绝/No 保存=未保存/No
[done] 审核闭环结束 / review flow closed
```

#### After `proposal.unsave` or unsave `N`

Expected lines:

```text
[ok] 已取消保存，主库未写入 / save cancelled, library unchanged: #1 proposal-...
[state] 审批=已审批/Yes 保存=未保存/No
[done] 审核闭环结束 / review flow closed
```

### 4. Bilingual `Y/N` error messages

No pending:

```text
[err] 当前会话没有待处理提案 / no pending proposals in current session
```

Multiple pending:

```text
[err] 当前会话有 2 个待处理提案，请使用 proposal.list 查看，再用 proposal.approve #1 等显式命令处理 / multiple pending proposals; use proposal.list and explicit commands
```

### 5. Human-readable `proposal.list`

`proposal.list` should:

- show short aliases
- use bilingual headers
- show localized approval/save labels
- show summary
- show full id only if space allows or in a final column

Example:

```text
编号  领域/domain  审批/approval  保存/save  摘要/summary                  id
#1    buff         待审批/Wait     待保存/Wait  buff fill: items=1 effects=4  proposal-...
```

### 6. Human-readable `proposal.show`

`proposal.show #1` should display an audit card:

```text
提案 / Proposal: #1 proposal-...
领域 / Domain: buff
操作 / Operation: fill.apply
审批 / Approval: 待审批/Wait
保存 / Save: 待保存/Wait
摘要 / Summary: buff fill: items=1 effects=4
下一步 / Next: 输入 Y 批准并应用到草稿，输入 N 拒绝
Payload: {...}
```

### 7. Bilingual Agent SSE logs

Current line is too terse:

```text
[agent] rest ok read fill.apply ...
```

Update Web CLI SSE display to include bilingual status and proposal state:

```text
[agent] rest 成功/ok 命令/command fill.apply <json:123 chars> 审批=待审批/Wait 保存=待保存/Wait 提案=#1
```

For writes:

```text
[agent] web-cli 成功/ok 写入/write proposal.save #1 审批=已审批/Yes 保存=已保存/Yes 提案=#1
```

Requirements:

- Include `approval/save` when available.
- Include proposal alias or id when available.
- Keep command summary.
- Keep `errorCode` when present, bilingual prefix is enough.

### 8. Command history

`AiCliPage` input should support:

- `ArrowUp`: previous command
- `ArrowDown`: next command
- preserve current draft input while browsing history where practical
- do not store command history permanently

### 9. Tab completion

Implement lightweight tab completion in `AiCliPage`.

Minimum command completions:

```text
help
spec
agent.logs
agent.sessions
proposal.list
proposal.show
proposal.approve
proposal.reject
proposal.save
proposal.unsave
fill.task
fill.task.copy
fill.check
fill.apply
weapon.fill.task
weapon.fill.check
weapon.fill.apply
```

Minimum behavior:

- `prop<Tab>` -> complete to common prefix or list candidates.
- `proposal.a<Tab>` -> `proposal.approve `
- `proposal.show <Tab>` -> fill first pending alias, e.g. `proposal.show #1`
- if multiple candidates exist, append a line:

```text
[info] 可补全 / completions: proposal.approve, proposal.reject
```

Do not implement a dropdown in this fix.

### 10. Basic keyboard shortcuts

Implement:

- `Ctrl+L`: clear terminal output
- `Esc`: clear current input
- `Tab`: completion
- `ArrowUp` / `ArrowDown`: history

Keep `Enter` as submit.

### 11. Prompt pending state

The prompt should hint the current pending state when possible:

```text
def:custom-buff-001 pending=#1 approve>
def:custom-buff-001 pending=#1 save>
```

If no pending proposal exists:

```text
def:custom-buff-001>
```

## Tests

Update or add tests for command service:

- `fill.apply` lines include Chinese prompt and `Y/N`.
- `proposal.approve` lines include Chinese save prompt and `Y/N`.
- `proposal.save` lines include saved/done bilingual close message.
- `proposal.reject` lines include rejected/done bilingual close message.
- `proposal.list` includes `#1` alias and Chinese headers.
- `proposal.show #1` resolves alias and includes Chinese labels.
- `Y` with no pending returns Chinese-first error.
- Multiple pending `Y` returns Chinese-first ambiguous error.

Update or add component-level tests if this repo already has a pattern for them:

- ArrowUp / ArrowDown history.
- Tab command completion.
- Tab proposal alias completion.
- Ctrl+L clear.
- Esc clear input.

If no component test pattern exists, add focused pure helper tests for completion/history helpers and manually verify in Web CLI.

## Verification

Run:

```sh
npm run build
node scripts/run-ts-test.mjs src/aiCli/aiCliCommandService.test.ts
node scripts/run-ts-test.mjs src/aiCli/aiCliAgentInfrastructure.test.ts
npm run smoke:ai-cli-rest
```

Manual Web CLI verification:

1. Create a Buff proposal.
2. Confirm terminal shows `#1` and Chinese `Y/N` prompt.
3. Press `Y`; confirm draft apply message and save prompt.
4. Press `N`; confirm unsave/cancel message.
5. Create another proposal.
6. Use `proposal.show #1`.
7. Use Tab completion for `proposal.a`.
8. Use ArrowUp/ArrowDown command history.
9. Confirm agent SSE log is bilingual and includes proposal status.

## Cross-store Proposal Handoff (Task 12 UX Fix 2)

### Problem

REST agent creates proposals in `now-storage.json`. Web CLI reads from browser `localStorage`. These two stores are not synchronized, so after REST `fill.apply` the user cannot see pending proposals in `/ai-cli` and is forced to re-run `fill.apply` in the browser.

### Solution

- REST server broadcasts proposals through SSE `agent.records`.
- Web CLI (`AiCliPage`) receives SSE and imports external pending proposals into browser `localStorage` via `importExternalProposals()`.
- Imported proposals keep original `client` (rest/codex/claude) and get `reviewedBy='web-cli'`.
- `sessionId` is reassigned to the current Web CLI session so `Y/N` shortcuts work.
- Browser-side state wins: if a local proposal is already saved/rejected/unsaved, it is not overwritten by external pending state.

### Handoff UX

After import, the terminal shows:

```text
[handoff] 已接收外部待审批提案 / imported external pending proposals: 1
[next] 输入 proposal.list 查看，或输入 Y 审批当前唯一提案 / Use proposal.list or press Y when only one proposal is pending
```

For multiple pending proposals:

```text
[handoff] 已接收外部待审批提案 / imported external pending proposals: 3
[next] 当前有 3 个待处理提案，请使用 proposal.list 查看，再用 proposal.approve #1 等显式命令处理 / 3 pending proposals; use proposal.list and explicit commands
```

### Agent-facing Prompt Rules

All agent-facing prompts (guide, spec, help, fill.task instruction, REST adapter) must express:

1. External agents can only create proposals, not approve/save.
2. REST `*.fill.apply` creates a proposal only; it does NOT save to library.
3. After REST apply, the proposal is handed off to Web CLI automatically.
4. Do NOT ask users to re-run `fill.apply` in the browser.
5. Single pending: user opens `/ai-cli` and presses `Y` to approve, then `Y` to save.
6. Multiple pending: user runs `proposal.list`, then `proposal.approve #1` / `proposal.save #1`.
7. `ok:true` from REST apply only means proposal creation succeeded, not persistence.
8. REST approval/save commands returning 403 is expected behavior.

### Source / Reviewer Display

`proposal.show` displays:

```text
来源 / Source: rest
审核 / Reviewer: web-cli
```

## Done Criteria

- Review flow is understandable without reading docs.
- User can operate common proposal review flow with `Y/N`, `#1`, Tab, and arrow keys.
- Terminal lines are Chinese-first with English fallback at decision points.
- Agent logs expose proposal id/alias and approval/save state.
- REST-created proposals are visible in Web CLI without re-running fill.apply.
- External agent prompts correctly describe the handoff and do not instruct users to re-run fill.apply.
- Existing Task 12 functional tests and smoke remain passing.
