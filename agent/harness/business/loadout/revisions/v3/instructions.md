# Loadout Harness V3

## Business boundary

This Harness owns weapon, equipment, operator skill levels and configuration
inputs for a target operator or team. A character, weapon, set name, `3+1`,
guide or batch size is context inside this one business.

It never edits timeline button structure or BUFF binding, and never applies
configuration through Work Node JSON.

## Evidence discipline

Separate four fact classes:

1. current equipped state comes from the current team/loadout capability;
2. stable names, ids, slots, fixed stats and effects come from the current
   product catalog or its registered native artifact;
3. strategy and priorities come from a scoped guide or authorized fallback
   profile;
4. applied state comes only from the visible Operator Config postcondition.

The selected-team reader is allowed to return an incomplete record. When its
`complete` flag is false or it reports a requested operator under `missing`,
null weapon/skill values and empty equipment arrays mean “saved loadout
unavailable”, not “confirmed unequipped” or “default build”.

The selected-team reader accepts stable character ids only. When a user names
an operator in natural language, either let guide discovery resolve the stable
id first or read the whole selected team and match its returned
`characterName`. Never send a display name as `characterIds`.

Catalog browsing and selected-team state are different scopes. A blank
weapon/equipment resolver query may return a bounded catalog page; always
preserve `catalogCount`, `exhaustive` and `truncated`, and never call that page
the whole local library.

For operator-fit questions, discover the exact operator guide first. A complete
guide supplies an unchanged planner profile/capability. Only partial or missing
guides authorize the exact fallback token. Never replace this chain with generic
knowledge search.

For weapon fit, resolve combat conventions only when evidence requirements say
they are required. Preserve deterministic, high-probability, low-probability and
unknown edges. `READY_WITH_TRADEOFFS` is an unordered tradeoff matrix.

For `3+1`, the route must declare one mutually exclusive set mode. A named-set
request carries the exact set query and reads that set's facts directly. A
discover-set request carries no set query and may shortlist from the whole
catalog before choosing one returned set. The two flows never call each other's
set-selection phase.

Materialize one current equipment artifact and treat its session-bound
`artifactId` as opaque typed evidence. Pass that identifier directly between the
projected catalog, facts, shortlist and planner Tools. A generic file read is
not an intermediate phase and cannot be required to authorize the next typed
Tool.

Planning uses the same artifact/source revision and unchanged profile
capability. The profile is evidence, not a scratch object: never append the
user's set name, slot preference, or requested topology to its keywords or
preference groups. Harness Manager binds the artifact id, profile capability,
and exact planner profile into downstream planner calls. `3+1` means at least
three named-set memberships across four physical slots. Four pieces are legal;
an off-set is chosen only for a strict verified effect-key improvement. Return
only the planner's bounded shortlist, never its full topology.

Keep every conditional effect conditional. Repeat its returned condition
verbatim. Never claim that the target can apply, sustain, or reliably trigger
that condition unless an explicit typed result establishes that trigger
capability.

Planner state is part of the response contract. `READY` permits a ranking only
within the verified effect-key evidence returned by the planner; it is not a
universal or damage-simulated optimum. `PARTIAL` is a terminal evidence boundary:
preserve every missing key and ambiguity, do not create a proposal, and do not
claim that one candidate is optimal, higher damage, or makes another piece
unnecessary.

## Proposal transaction

A preview is one complete configuration. It binds:

- target operator;
- user constraints;
- Harness Revision;
- evidence reference/hash/applicability;
- catalog artifact/source revision;
- current scheme version;
- immutable proposal token.

Preview is read-only: it creates no branch and requests no approval. A later
plain confirmation resumes this same transaction. A correction, question,
comparison such as “为什么不用…”, changed slot or changed priority supersedes
the proposal and requires a fresh evidence/preview chain.

Apply consumes the unchanged proposal once, under native approval and current
scheme CAS. Completion requires the live Operator Config page to match every
reviewed field. Queue acknowledgement, Work Node checkout or model narration is
not success.

V1 deliberately reports loadout-only restore as unsupported because the
available whole-node restore could overwrite timeline or BUFF state.
