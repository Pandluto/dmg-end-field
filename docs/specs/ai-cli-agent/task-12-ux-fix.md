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
- Terminal output uses compact English-primary lines with short Chinese parenthetical annotations only where useful.
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

### English-primary, compact Chinese annotations

Terminal lines should keep English as the primary text and add short Chinese parenthetical annotations for decision points:

```text
[ok] proposal created: #1 proposal-... (提案已创建)
[next] Press Y to approve, N to reject (Y 批准，N 拒绝)
```

Do not translate every token. Ordinary telemetry may stay English-only; errors, handoff, proposal state, and next actions should include concise Chinese annotations.

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
#   Domain  Approval  Save     Summary
#1  buff    Pending (待审批)   Pending (待保存)  buff fill: items=1 effects=4
#2  weapon  Approved (已批准)  Pending (待保存)  weapon fill: name=...
```

Alias rules:

- `#1`, `#2`, ... are generated from the ordered pending proposal list.
- Aliases are accepted by:
  - `proposal.show #1`
  - `proposal.approve #1`
  - `proposal.reject #1`
  - `proposal.save #1`
  - `proposal.unsave #1`
  - `proposal.clear`
- Full proposal ids continue to work.
- If an alias is out of range, return `ok:false` with English primary error plus a short Chinese annotation.
- Alias resolution should be scoped to the current session when the command depends on current session UX.

Implementation suggestion:

```ts
resolveProposalReference(input: string, sessionId?: string): AiAgentProposal | null
```

### 2. Review-state labels

Map internal status values for display:

```text
approval=Wait -> Pending
approval=Yes  -> Approved
approval=No   -> Rejected

save=Wait -> Pending
save=Yes  -> Saved
save=No   -> Unsaved

Chinese annotation labels:

approval=Wait -> 待审批
approval=Yes  -> 已批准
approval=No   -> 已拒绝

save=Wait -> 待保存
save=Yes  -> 已保存
save=No   -> 未保存
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
[ok] proposal created: #1 proposal-... (提案已创建)
[state] approval=Pending save=Pending (审批=待审批 保存=待保存)
[next] Press Y to approve, N to reject (Y 批准，N 拒绝)
```

`response.proposal.nextAction` should also be explicit:

```ts
nextAction: 'reply Y/N in web-cli to approve or reject'
```

#### After `proposal.approve` or approval `Y`

Expected lines:

```text
[ok] approved and applied to working draft: #1 proposal-... (已批准并应用到当前草稿)
[state] approval=Approved save=Pending (审批=已批准 保存=待保存)
[next] Press Y to save, N to unsave (Y 保存，N 取消保存)
```

`response.proposal.nextAction`:

```ts
nextAction: 'reply Y/N in web-cli to save or unsave'
```

#### After `proposal.save` or save `Y`

Expected lines:

```text
[ok] saved to local truth: #1 proposal-... (已保存到本地主库)
[state] approval=Approved save=Saved (审批=已批准 保存=已保存)
[done] review flow complete (审核闭环完成)
```

#### After `proposal.reject` or reject `N`

Expected lines:

```text
[ok] rejected, draft unchanged: #1 proposal-... (已拒绝，草稿未修改)
[state] approval=Rejected save=Unsaved (审批=已拒绝 保存=未保存)
[done] review flow closed (审核闭环结束)
```

#### After `proposal.unsave` or unsave `N`

Expected lines:

```text
[ok] save cancelled, library unchanged: #1 proposal-... (已取消保存，主库未写入)
[state] approval=Approved save=Unsaved (审批=已批准 保存=未保存)
[done] review flow closed (审核闭环结束)
```

### 4. Bilingual `Y/N` error messages

No pending:

```text
[err] no pending proposals in current session (当前会话没有待处理提案)
```

Multiple pending:

```text
[err] 2 pending proposals in current session. Use proposal.list, explicit commands, or proposal.clear. (当前会话有 2 个待处理提案，请先查看列表、显式处理，或用 proposal.clear 清理)
```

`proposal.clear` is a Web CLI user action that rejects unsent proposals and marks approved-but-unsaved proposals as unsaved in the current session. It does not write domain library storage.

### 5. Human-readable `proposal.list`

`proposal.list` should:

- show short aliases
- show English headers and compact Chinese status annotations where useful
- show English approval/save labels with concise Chinese labels in parentheses
- show summary
- show full id only if space allows or in a final column

Example:

```text
#   Domain  Approval  Save     Summary                   id
#1  buff    Pending (待审批)  Pending (待保存)  buff fill: items=1 effects=4  proposal-...
```

### 6. Human-readable `proposal.show`

`proposal.show #1` should display an audit card:

```text
Proposal: #1 proposal-...
Domain: buff
Operation: fill.apply
Approval: Pending
Save: Pending
Summary: buff fill: items=1 effects=4
[next] Press Y to approve, N to reject (Y 批准，N 拒绝)
Payload: {...}
```

### 7. Bilingual Agent SSE logs

Current line is too terse:

```text
[agent] rest ok read fill.apply ...
```

Update Web CLI SSE display to keep ordinary reads compact and add Chinese annotations only for important states:

```text
[agent] rest ok read fill.apply <json:123 chars> proposal=#1 approval=Pending save=Pending (提案=#1 审批=待审批 保存=待保存)
```

For writes:

```text
[agent] web-cli ok write proposal.save #1 proposal=#1 approval=Approved save=Saved (写入 提案=#1 审批=已批准 保存=已保存)
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
proposal.clear
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
[info] completions: proposal.approve, proposal.reject (可补全)
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

- `fill.apply` lines include English prompt plus concise Chinese annotation and `Y/N`.
- `proposal.approve` lines include English save prompt plus concise Chinese annotation and `Y/N`.
- `proposal.save` lines include compact English/Chinese close message.
- `proposal.reject` lines include compact English/Chinese close message.
- `proposal.list` includes `#1` alias and compact bilingual status labels.
- `proposal.show #1` resolves alias and includes compact bilingual status/next-action labels.
- `Y` with no pending returns compact English/Chinese error.
- Multiple pending `Y` returns compact English/Chinese ambiguous error.

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
2. Confirm terminal shows `#1` and compact English/Chinese `Y/N` prompt.
3. Press `Y`; confirm draft apply message and save prompt.
4. Press `N`; confirm unsave/cancel message.
5. Create another proposal.
6. Use `proposal.show #1`.
7. Use Tab completion for `proposal.a`.
8. Use ArrowUp/ArrowDown command history.
9. Confirm agent SSE log stays English-only for ordinary reads, and adds concise Chinese annotations for errors/writes/proposal state.

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
[handoff] imported 1 external proposal (已导入 1 个外部提案)
[state] 1 pending proposal in current session (当前会话 1 个待处理提案)
[next] Use proposal.list or press Y (使用 proposal.list 查看，或按 Y 审批)
```

For multiple pending proposals:

```text
[handoff] imported 3 external proposals (已导入 3 个外部提案)
[state] 3 pending proposals in current session (当前会话 3 个待处理提案)
[next] Use proposal.list, explicit commands, or proposal.clear (先查看列表、显式处理，或清理旧提案)
```

### Agent-facing Prompt Rules

All agent-facing prompts (guide, spec, help, fill.task instruction, REST adapter) must express:

1. External agents can only create proposals, not approve/save.
2. REST `*.fill.apply` creates a proposal only; it does NOT save to library.
3. After REST apply, the proposal is handed off to Web CLI automatically.
4. Do NOT ask users to re-run `fill.apply` in the browser.
5. Single pending: user opens `/ai-cli` and presses `Y` to approve, then `Y` to save.
6. Multiple pending: user runs `proposal.list`, then `proposal.approve #1` / `proposal.save #1`, or `proposal.clear` to close stale pending proposals before a fresh apply.
7. External agents must not keep submitting `fill.apply` when multiple pending proposals block `Y/Y`; they should tell the user to clear or explicitly handle the backlog.
7. `ok:true` from REST apply only means proposal creation succeeded, not persistence.
8. REST approval/save commands returning 403 is expected behavior.

### Source / Reviewer Display

`proposal.show` displays:

```text
Source: rest
Reviewer: web-cli
```

## Done Criteria

- Review flow is understandable without reading docs.
- User can operate common proposal review flow with `Y/N`, `#1`, Tab, and arrow keys.
- Terminal lines use English-primary text with compact Chinese parenthetical annotations only where useful. Avoid noisy token-by-token bilingual output.
- Agent logs expose proposal id/alias and approval/save state.
- REST-created proposals are visible in Web CLI without re-running fill.apply.
- External agent prompts correctly describe the handoff and do not instruct users to re-run fill.apply.
- Existing Task 12 functional tests and smoke remain passing.
