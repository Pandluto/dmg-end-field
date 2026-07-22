---
name: harness-audit-assistant
description: 导出并审计 DEF OpenCode/Workbench 会话，识别 Harness、typed tool、知识读取、审批、持久化和工具路由问题，并生成可交给另一位 Codex 的证据化返修提示词。Use when the user says “harness 审计辅助”, provides a DEF Workbench UUID or native ses_ session ID, asks to pull/export a conversation locally, audit a hand-tested DEF session, compare passing and failing runs, or prepare a Codex repair handoff.
---

# Harness audit assistant

Turn a manually exercised DEF session into local evidence. Audit facts first, then issue a narrowly scoped repair handoff for another Codex.

## Boundaries

- This is a developer-Codex skill and belongs only in `.agents/skills/`.
- Do not copy, load, or reference it from `agent/runtime/def/skills/`; that directory is product runtime content for def-opencode. The two skill domains must not be mixed.
- An ordinary audit is read-only: do not send to the audited session, approve a request, change Harness, promote a candidate, or stop/restart a resident `electron:dev` process.
- A request to audit and prepare a handoff does not authorize an incidental product-code fix.

## Workflow

1. Read repository `AGENTS.md`, `.agents/skill-routing.md`, and `docs/testing/def-agent-blackbox.md`. Check `git status --short` and preserve pre-existing changes.
2. For a Spec 9 audit, also read the applicable responsibility/owner table and the current verification scenario before deciding an owner.
3. Accept a native `ses_...` id or Workbench UUID. Prefer `DefCodexInteropProtocol v1` for transcript, events, questions, and state. If offline preservation is needed or v1 is unavailable, run:

   ```bash
   node .agents/skills/harness-audit-assistant/scripts/export-session.mjs <session-id-or-workbench-uuid>
   ```

4. Preserve raw evidence under ignored `data/localdata/def-session-audits/<input-id>/`:

   - `conversation.md`: readable conversation, tool inputs/outputs, errors, and timestamps.
   - `trace.json`: structured messages, tool sequence, and counts.
   - Never export model reasoning or chain of thought.

5. Read the export and directly relevant implementation completely. Use the [audit rubric](references/audit-rubric.md), including its owner-routing and environment rules. Record tool count, order, important inputs/outputs, terminal state, and before/after state; a plausible final answer is not proof of success.
6. Write `audit.md`. For **every Finding**, use the mandatory Finding contract from the rubric: violated contract, one primary owner, evidence, allowed files, forbidden files, duplicate/overlap, and regressions. Record confirmed facts separately from hypotheses.
7. If a provider, sidecar, port, fixture, plugin, snapshot, or runtime is unavailable, create an `ENVIRONMENT` record. It is not a product Finding and must not be routed to a Harness, prompt, Tool, Service, or Runtime Skill patch without independent product evidence.
8. Use the [owner-routing examples](references/owner-routing-examples.md) as a check against cross-layer repairs. A cross-layer symptom still has one primary owner; other layers may only be necessary adapters or separately evidenced Findings.
9. Generate a fresh-session handoff using the [handoff template](references/handoff-template.md). It may authorize the primary owner and named necessary adapters only. It must remove any confirmed stale duplicate rule instead of adding a second prompt/skill/harness/tool workaround.

## Evidence rules

- v1 is the fact source for turns, tool activity, questions, and failures. Computer Use only confirms the real UI and never substitutes for protocol evidence.
- A deterministic Tool or Service error is not a Harness issue merely because it changes the final answer. A missing knowledge fact, an unavailable environment, and an agent-recognition failure are separately classified.
- State `confirmed` only when trace and/or code evidence supports the contract breach. With incomplete evidence, state `hypothesis`, list the missing observation, and authorize investigation only—not a repair.
- Do not re-submit a blocked request. Collect events, transcript, questions, state, and terminal result first. Run the regression in a fresh native session.
- Do not infer an owner from the easiest file to edit. The owner is the layer that owns the violated contract.

## Deliverable

The final response must provide:

1. Absolute clickable paths for `conversation.md`, `trace.json`, and `audit.md`.
2. A short plain-language diagnosis that distinguishes product Findings, hypotheses, and environmental blockers.
3. A complete, copyable repair handoff conforming to the template, including its single-owner authorization and regression checks.
4. Remaining unknowns or required human confirmation.
