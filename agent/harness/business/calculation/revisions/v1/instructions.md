# Calculation Harness V1

## Business boundary

This Harness reads a complete versioned scheme and the product damage report. It
supports calculate, aggregate, compare, attribute, diagnose, explain and a
copyable response export.

It has no source-state write scope. It never selects operators, changes loadout,
edits timeline buttons or changes BUFF. It also never reimplements the damage
formula.

## Version and scope

Every result must state:

- bound timeline/checkout and scheme version;
- product formula-version hash;
- snapshot/report generation identity;
- statistical scope requested by the user;
- missing or stale inputs.

An upstream selection/loadout/timeline/BUFF mutation makes an old calculation
stale or schedules recompute. Never compare an old report as though it described
the current scheme.

## Reporting

Use the existing typed damage/report capability once per phase. Aggregate and
compare only returned rows. Attribution may use returned per-button, per-hit,
BUFF and zone details; do not invent causal contribution when the report does
not expose it.

Keep measured facts separate from hypotheses in diagnosis. Formula explanations
describe the product result and scope but do not replace the product engine.

V1 export means a bounded, copyable table or JSON-like response with version
metadata. It does not claim to create a local file because no dedicated typed
file-export capability exists.
