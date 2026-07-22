# Harness session audit rubric

## Evidence priority

1. `DefCodexInteropProtocol v1`: primary source for turns, transcript, tools, questions, permissions, errors, and terminal state.
2. Native OpenCode SQLite: read-only offline corroboration when v1 is unavailable; it does not replace live bridge state.
3. Computer Use: proves real Workbench visibility, approval cards, or persistence after reload only.
4. Documentation and agent narration: intent only, never proof of runtime behavior.

## Mandatory Finding contract

Write this complete record for every product Finding. Do not collapse it into a generic “root cause” paragraph.

| Field | Required content |
| --- | --- |
| `observed facts` | Session/run ids, user request, exact trace events, tool inputs/outputs, terminal state, and before/after state. Cite paths and event/line identifiers. |
| `evidence` | The primary v1/export/code observations that prove those facts, with absolute/local evidence paths and event or line references. |
| `violated contract` | The named contract and the precise promised behavior that evidence contradicts. |
| `primary owner` | Exactly one owner: Knowledge, Tool Contract, Domain Service, Permission/Mutation, Host, Runtime Skill, Harness, Teacher Audit, Agent Release, or Scenario/Verifier. |
| `owner evidence` | Why that owner owns the violated contract; also name evidence that rules out a tempting cross-layer owner when relevant. |
| `allowed files` | Exact, minimal paths for the primary owner and any necessary adapter/test. “Any related files” is invalid. |
| `forbidden files` | Exact layers or paths where this repair must not be duplicated, including Prompt, Harness, Runtime Skill, Tool, Service, or Host when they are not authorized. |
| `duplicate / overlap` | Existing duplicate rule/workaround to delete, or `none evidenced`. Never create a second rule to mask a missing contract. |
| `regressions` | A fresh-session minimal reproduction, the original failure check, and an adjacent ability or safety check. |

Use `confirmed` only for a breach supported by trace and/or code. If the owner or breach cannot be determined, label the record `hypothesis`, identify the missing evidence and the smallest investigation, and do **not** assert a repair plan.

## Environment records are not product Findings

Use a separate record with `classification: ENVIRONMENT` for unavailable provider, sidecar, port, plugin, fixture, snapshot, workspace, or test runtime. It must contain the observed availability evidence, affected test, retry/recovery prerequisite, and whether product behavior could be observed. It has no product primary owner and cannot justify a Harness/Prompt/Tool/Service/Skill patch.

If a deterministic product error appears after the environment becomes ready, record it as a separate product Finding with its own owner. Never merge the two records.

## Classification labels

Use one evidence-backed product classification to organize the audit: `HARNESS_ROUTING`, `TOOL_CONTRACT`, `DATA_SOURCE`, `KNOWLEDGE_RETRIEVAL`, `MUTATION_SAFETY`, `PROTOCOL_UI`, or `AGENT_POLICY`. Classification describes the failure type; `primary owner` still selects the one layer authorized to repair it. `ENVIRONMENT` is reserved for the separate non-product record above.

## Owner routing

Choose the owner of the violated contract, not the location most convenient to patch.

| Evidence points to | Primary owner | Do not default to |
| --- | --- | --- |
| Missing/misleading visible tool field, schema, risk/scope, error, or result semantics | Tool Contract | Harness or Runtime Skill prose |
| Fixed stage, node/revision validation, ordering, ranking, retry, postcondition, or deterministic branch | Domain Service | Host or Harness |
| Source fact, alias, catalog, or truthfulness of a source | Knowledge | Tool result fabrication |
| Approval, CAS, reservation, commit/applied/live durability | Permission/Mutation | Host presentation |
| Session binding, workspace, checkout, consumer, iframe, or visible UI after a pending request exists | Host | Service validation without evidence |
| Capability is complete but fresh sessions fail to recognize/describe it reliably | Runtime Skill | Tool/Service rewrites |
| Only a bounded experimental teaching/tone hypothesis remains after capability evidence is complete | Harness | Permanent product contract |
| Audit itself lacks evidence, assigns multiple owners, or authorizes cross-layer work | Teacher Audit | Product runtime skill |
| Release/component identity cannot be attributed | Agent Release | A guessed code patch |
| Expected behavior/owner is not fixed yet | Scenario/Verifier | A product repair |

Consult [owner-routing examples](owner-routing-examples.md) before drafting a repair handoff.

## Required audit dimensions

| Dimension | Evidence question | Common failure signal |
| --- | --- | --- |
| Harness routing | Was the correct experiment/teaching rule selected and free of conflicts? | Same request differs without an evidence-backed binding difference. |
| Tool contract | Are scope, source, exhaustive/truncated status, missing reasons, schema, and errors truthful? | Selected-only data presented as full data; promised typed field absent. |
| Knowledge retrieval | Was the correct reference and exact section read? | Generic excerpt, stale mirror, or unsupported fact. |
| Efficiency | Is the batch/one-pass path used without repeated equivalent calls? | N+1 or identical retry after a terminal error. |
| Mutation safety | Are approval, refusal, CAS, rollback, and persistence correct? | State changes before approval or after refusal. |
| Protocol/UI | Are v1 session bindings stable and does UI merely show verified state? | Screenshot used instead of trace evidence; wrong session. |
| Completion claim | Does “done” have the required postcondition? | Failed/unregistered tool followed by success claim. |

## Severity and verification

- **P1:** approval bypass, unauthorized mutation, data loss/bad persistence, cross-session leak, or repeated side effect.
- **P2:** core path fails, wrong source/tool contract causes systematic misinformation, or severe N+1 prevents use.
- **P3:** lower-frequency quality/efficiency issue with a safe fallback.

Every Finding’s regression record must include:

1. A fresh native-session reproduction of the original request with v1 evidence.
2. The original contract assertion (including tool/order/error/postcondition as applicable).
3. An adjacent capability check that the repair must preserve.
4. A safety check for read-only state or for approval/CAS/persistence when mutation is in scope.

For intermittent behavior, compare at least one passing and one failing run and identify the input, binding, Harness hash, session pin, or tool-trace difference. Do not treat a single pass as promotion evidence.
