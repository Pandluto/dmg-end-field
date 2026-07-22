# Owner-routed Codex repair handoff template

Fill this template as a self-contained prompt for a new Codex session. Delete non-applicable placeholders; do not leave blank headings or turn a hypothesis into an asserted bug.

```markdown
You are working in `<repository-root>`. Repair exactly the Finding below; do not broaden the change into a cross-layer workaround.

## Read first

- `AGENTS.md`
- `docs/testing/def-agent-blackbox.md`
- `<absolute-path>/conversation.md`
- `<absolute-path>/trace.json`
- `<absolute-path>/audit.md`
- The contract, owner implementation, and verification files named below

## Finding identity and evidence state

- Finding id: `<id>`
- Evidence state: `<confirmed | hypothesis>`
- Classification: `<product category | ENVIRONMENT>`
- Severity / user impact: `<P1/P2/P3 and impact>`

### Observed facts and evidence

- Session/run, timestamp, user request, and Harness binding/hash when available: `<facts>`
- Exact v1 events, tool inputs/outputs, questions, errors, terminal state, and before/after state: `<facts with file/event citations>`
- Relevant code/contract citations: `<paths and lines>`

### Violated contract and owner

- Violated contract: `<specific promise contradicted by the evidence>`
- Primary owner: `<exactly one owner>`
- Owner evidence: `<why this layer owns the contract; why a tempting other layer does not>`

If the evidence state is `hypothesis`, stop after the smallest stated investigation. Do not ship a repair until the contract and owner are confirmed.

## Scope authorization

- Allowed files: `<exact primary-owner paths and only necessary adapter/test paths>`
- Necessary adapter, if any: `<path + reason, or none>`
- Forbidden files/layers: `<exact paths or layers>`
- Duplicate / overlap to remove: `<confirmed stale rule/workaround and path, or “none evidenced”>`

Only edit the primary owner and the named necessary adapter. Do **not** add or preserve a duplicate fix in Base Prompt, Harness, Runtime Skill, Tool surface, Domain Service, Permission/Mutation, or Host unless this Finding explicitly authorizes that layer. Delete the named stale duplicate rather than keeping it as fallback prose.

## Required result

- `<minimal behavior change that restores the violated contract>`
- Preserve `<named passing capability and safety boundary>`.
- Non-goals: no unrelated refactor, no promotion, no re-submission of the original blocked session, and no simulated route presented as a native Agent replay.

## Regression verification

1. Fresh native-session minimal reproduction: `<prompt and v1 evidence to retain>`.
2. Original regression assertion: `<exact contract/tool/order/error/postcondition assertion>`.
3. Adjacent ability regression: `<nearby behavior that must remain valid>`.
4. Safety regression: `<read-only no-state-change OR approval/CAS/persistence assertion>`.
5. Run the proportionate repository checks plus `git diff --check`; report actual failures as failures.

## Handoff result

Report changed files, evidence before/after, the two regression results, unresolved risks, and the commit. Follow repository commit rules; do not push unless separately authorized.
```

## Environment-only handoff

For `classification: ENVIRONMENT`, do not issue a product repair prompt. Produce a recovery/investigation handoff that names the unavailable dependency, availability evidence, affected case, and the prerequisite to retry. State explicitly that no product owner or product file has been authorized until a ready environment yields independent product evidence.
