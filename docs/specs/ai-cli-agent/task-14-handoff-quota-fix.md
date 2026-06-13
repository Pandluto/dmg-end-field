# Task 14 Handoff Fix: SSE fallback and proposal storage compaction

## Background

REST `equipment.fill.apply` can create a pending proposal successfully while Web CLI (`/ai-cli`) still shows no pending proposal.

Observed failure:

```text
[err] agent SSE event parse failed: Failed to execute 'setItem' on 'Storage':
Setting the value of 'def.ai-agent.proposals.v1' exceeded the quota.
```

This is not a JSON parse failure. The SSE payload is valid, but Web CLI fails while importing REST proposals into browser `localStorage`.

Root cause:

- REST proposals live in the REST/now-storage side until imported.
- Web CLI proposal review reads browser `localStorage`.
- SSE handoff imports REST proposals into browser `localStorage`.
- `proposal.clear` previously closed proposals but retained their full payloads.
- Large historical resolved proposals could grow `def.ai-agent.proposals.v1` beyond browser quota.
- Once quota is exceeded, import fails and Web CLI cannot see the REST proposal.

## Fix

### Proposal storage compaction

`src/aiCli/aiCliAgentInfrastructure.ts` now writes proposal storage through a compaction path:

- Always preserve pending proposals.
- Preserve only the latest resolved proposal records.
- On quota failure, retry with pending proposals only.
- Apply this write path to create, update, clear, and external import.

### Web CLI handoff fallback

`src/components/AiCliPage.tsx` now pulls `GET /api/agent/records` as a snapshot fallback:

- on Web CLI startup;
- when SSE parse fails;
- when SSE import fails;
- when SSE reconnect/error fires.

SSE handling now distinguishes:

- JSON parse failure;
- proposal import/storage failure.

The UI logs raw SSE data prefix only for diagnosis and does not require the user to re-run `fill.apply` in Web CLI.

## Required behavior

- REST `*.fill.apply` still creates a proposal only.
- Web CLI remains the only approval/save surface for normal users.
- SSE is best-effort handoff, not the only handoff mechanism.
- Snapshot fallback must import pending REST proposals into the active Web CLI session.
- Web CLI must not silently approve, save, or discard proposals during fallback.
- Storage compaction must never drop pending proposals.
- Resolved proposal history is diagnostic only and may be truncated.

## Verification

Run:

```text
npm run build
```

Expected:

- TypeScript build passes.
- Vite build passes.
- Existing Vite chunk warnings are acceptable.

Manual check:

1. Submit one REST `*.fill.apply`.
2. Open or refresh `/ai-cli`.
3. Run `proposal.list`.
4. The pending proposal should be visible even if SSE had a prior parse/import failure.
5. Use `proposal.approve #1`, then `proposal.save #1`.

