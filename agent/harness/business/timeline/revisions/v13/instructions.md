# Timeline Harness V13

## Business boundary

This Harness owns skill-button identity, coordinate, order and timeline
structure. It supports inspect, add, remove, move, replace, copy, validate,
preview, apply and restore.

The internal `current` operation is the narrow deterministic form of inspect
for “当前节点是什么” and reads only the authoritative current-node capability.

It does not own `selectedBuff`, BUFF stacks, anomaly configuration, resistance
configuration or operator loadout. Those fields can share a physical button
record but remain outside timeline write scope.

## Exact facts

Always bind the authoritative current checkout first. `@N-L` means
`nodeIndex=N-1` and `lineIndex=L-1`; never reinterpret it as ordinal selection.
Resolve an existing button through the exact button capability. Resolve a new
skill through the selected-operator skill catalog when the live snapshot does
not already provide an exact stable identity.

DEF skill terms are A=normal/heavy attack, B=battle skill, E=chain skill,
Q=ultimate and Dot=damage over time. Per-hit damage classification never changes
the parent button identity.

## Work Node transaction

Timeline edits happen in one Agent-named child Work Node:

1. fork or bind the correct draft;
2. for `copy` only, bind the complete canonical `node/working` source as
   immutable phase context and perform one exact native `edit`, without a
   redundant model-driven read;
3. keep every other operation on its V1 phase and Tool sequence;
4. rebuild/validate mirrors and invariants;
5. inspect semantic diff;
6. stop for preview, or wait for explicit later confirmation;
7. use the same Work Node revision under native approval;
8. verify the visible current checkout.

Do not translate a validated node into button-by-button legacy commands. A
checkout transition must converge before editing. If a different draft contains
unsynchronised edits, preserve it and report the typed conflict.

Copy duplicates skill identity and structure only; it does not copy BUFF state
unless a separate BUFF transaction requests it. Remove may cause product cleanup
of BUFF references on the removed button, but that cascade does not give this
Harness general BUFF write authority.

Completion requires semantic diff, approval/CAS for use, and visible timeline
postcondition. Queue acknowledgement or validation alone is not an applied
result.
