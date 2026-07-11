# Spec 5 Task 2 DEF Agent blackbox record — 2026-07-11

Entry: `POST /def-agent/workbench-test/prompt`

Runtime: existing `electron:dev`, bridge `31457`, DEF REST `17321`, agent `17322`, Chrome workbench `3030`. Services were not restarted.

## Complex WorkNode flow

Initial prompt: `给洛茜在第十八格加一个普攻按钮`

- Session: `ses_0aec1e86bffez5bOcqDwYCht1V`
- First response: 85 ms
- Completion: 10,370 ms
- Tool activity: describe/call `def.worknode.patch_and_validate`
- State change: none; persisted node `ai-timeline-node-1783774458788-vg3b7dol` remained staged, pending commands 0
- Result: Agent reported validate/diff evidence and `checkout:false`
- Judgment: routing was overly conservative for a single mutation, but the WorkNode staging invariant passed

Continuation: `再确认一下，直接应用`

- Same session
- First response: 65 ms
- Completion: 10,347 ms
- Tool activity: `def.worknode.checkout_and_verify`
- Timeline: 26 → 27 buttons
- Command: `mw-rest-1783774699831-v33j7g51`, `done`, `reload:false`
- WorkNode: `ready` → `applied`
- Commit: `ai-timeline-commit-1783774700067-p6qlfpgv`
- CheckoutRef: `current-main-workbench` → the applied WorkNode
- Pending commands: 0
- Observable UI: the user prompt, tool activity, final answer, new `1-18` button, `DEF OpenCode`, and the `输入排轴操作` textbox were visible in MainWorkbenchAiPanel
- Judgment: pass; canvas working copy, WorkNode status, commit and CheckoutRef aligned

## Low-risk live controlled flow

Prompt: `给洛茜第二组第十五格加个普攻，直接应用`

- Session: `ses_0aebc69c0ffeg811Fb8D2M7Ske`
- First response: 73 ms
- Completion: 25,157 ms
- Tool activity: resolve/list plus `def.workbench.add_skill_button_and_verify`
- Timeline: 28 → 29 buttons
- New button: `u8c0le7g5`, `staffIndex=1`, `nodeIndex=14`, `nodeNumber=15`
- Pending commands: 0
- Final answer: reported `2-15`, new id and done state
- Judgment: pass; one explicit low-risk mutation used the live controlled tool and applied immediately

## Additional defect found and repaired

Prompt: `给洛茜在第十九格加个普攻，直接应用`

- Session: `ses_0aebd802fffeaqJN3gTA2ALQJ3`
- First response: 80 ms
- Completion: 27,708 ms
- Timeline changed 27 → 28, but the tool placed the button at `1-14`
- Judgment: fail; an out-of-range user position was silently changed
- Repair: command schema and WorkNode patch DSL now require `nodeIndex` 0–14; agent policy explicitly requires a clarification for user positions beyond 15
- Regression evidence: REST smoke expects `invalid-main-workbench-node-index` for an out-of-range typed-tool call

An earlier prompt whose Chinese body reached the bridge as question marks was excluded as invalid test transport. Subsequent requests used an explicit UTF-8 byte body.
