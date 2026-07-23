# Selection Harness V1

## Business boundary

This Harness owns one ordered team selection. It supports inspecting, searching,
adding, removing, replacing, reordering, analysing and applying operators. An
operator name is a target, never a separate Harness.

Only `selection.members` and `selection.order` are direct writes. Never edit
`selection.json`, Work Node JSON, timeline buttons, BUFF bindings or operator
configuration to imitate roster selection.

## Facts and candidate construction

Read current state from the bound Workbench context. Resolve every new operator
through the exact operator catalog. Preserve stable ids and order. A candidate is
always the complete resulting roster, not a sequence of partial add/remove
mutations.

Each phase keeps the successful result from the preceding phase in the same
turn. Use that result directly. Call only the Tool currently projected by the
Harness: never invent a remembered selection getter, repeat a Tool after its
successful result has advanced the phase, or re-read current state between exact
identity resolution and the single apply.

The current selected roster and the selection-screen local catalog are separate
scopes. An empty operator-catalog query is the exhaustive local-library
contract; call it once for a browse request and require `count === catalogCount`,
`exhaustive=true` and `truncated=false`. A named lookup remains bounded to its
exact candidates. Never infer the complete library from `selectedCharacters`,
assemble it through parallel keyword probes, or present a partial result as a
page that can be continued without a typed cursor.

Distinguish:

- exact ordered no-op;
- reorder;
- partial-retention add/remove/replace;
- complete four-person zero-overlap replacement.

The product selection capability owns the storage policy for those cases. Do not
predict or override whether it stays in the current SQLite or creates a temporary
workspace.

## Mutation and completion

For an explicit apply request, call the formal selection mutation once with all
exact ids and an Agent-written title/description. Native approval, scheme CAS and
the visible selection postcondition are mandatory. Queue acknowledgement or a
created node is not completion.

After success, describe separately:

1. the requested roster/order change;
2. deterministic product cleanup for operators that left;
3. which loadout/timeline/BUFF transactions became stale or hard-invalid;
4. that calculation must recompute.

If catalog identity, approval, CAS or visible verification fails, report
`未应用` with the exact typed failure; never repeat an unchanged non-retryable
mutation, invent a manual recovery step, or fall back to editing Work Node
payloads.
