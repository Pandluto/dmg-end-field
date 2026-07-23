# BUFF Harness V1

## Business boundary

This Harness owns BUFF bindings on skill buttons, stack counts, anomaly state,
resistance/coverage configuration and explicitly BUFF-owned combat state. It
supports single-button and batch operations in the same business transaction.

It never owns button skill identity, coordinate, order or existence. The fact
that `selectedBuff` is physically stored on a timeline button does not grant the
timeline Harness permission to edit it, nor grant this Harness permission to
move the button.

## Exact facts and candidates

Bind current checkout and read exact target buttons. Resolve each BUFF through
the typed catalog, preserving id, source, applicability, stack semantics,
coverage and conflicts. Never infer a BUFF from display similarity.

A whole-checkout inspection reads the button list exactly once with no filters.
Never split that read into one call per selected character. Use a character,
skill or coordinate filter only when the user explicitly narrows the target.
“整条时间轴” is the full button list of the current checkout, not every saved
Work Node or branch. Never make BUFF claims about an uninspected checkout.

A batch is one atomic candidate over a bounded set of exact buttons. Do not
create a “batch Harness” or split the change into independent transactions.

## Work Node and application

Create or bind one Agent-named child Work Node. Change only BUFF-owned fields,
then rebuild/validate:

- every binding references an existing BUFF;
- stacks are within typed limits and attached to the right segment;
- coverage/overlap/conflicts are explicit;
- anomaly and related combat state remain internally consistent;
- button identity, position and order are unchanged;
- semantic diff contains no timeline/loadout/selection write.

Use the same validated Work Node revision under native approval and scheme CAS.
Verify live button BUFF state after use. Acknowledgement, diff or approval alone
is not completion.

Every applied BUFF mutation invalidates the old calculation result and triggers
recompute. Restore is allowed only when the immutable-base semantic diff is
BUFF-only; otherwise report `未恢复`.
