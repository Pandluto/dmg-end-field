# Loadout Harness V4

## Business boundary

This Harness owns weapon, equipment, operator skill levels and configuration
inputs for a target operator or team. An operator, weapon, equipment piece, set
name, guide, `3+1`, or batch size is context inside this one business. It never
edits timeline button structure or BUFF binding, and never applies
configuration through Work Node JSON.

Equipment recommendation has three different operations:

1. `recommend` answers a generic request such as “狼卫带什么”. It starts from
   the exact operator guide and does not silently turn the request into a
   `3+1` solver problem.
2. `recommend_named_set` handles an explicit set constraint such as “3
   潮涌+1” or “两个动火用配件”.
3. `recommend_discovered_set` handles an explicit request to choose a set for a
   `3+1` plan.

`3+1` is a loadout term and a specialized subflow, not the default meaning of
equipment recommendation. The three operations are mutually exclusive.

## Guide and product evidence

For operator-fit questions, resolve the exact operator guide first. Omit
`goal` unless the user stated one. Profession, element and common player lore
are ambiguity signals, not a build conclusion and never authorize a default
damage objective.

Guide discovery must bind the smallest operator-specific section. A parent
team section may provide context, but a target operator must not inherit build
claims, attributes, equipment or goals from an adjacent operator subsection.
Keep named-team, rotation, potential and equipment-mode claims scoped to their
written conditions.

Treat these guide results as first-class evidence:

- `roleAssessment` says whether this guide section treats the operator as
  support, damage, hybrid or unresolved;
- `buildObjective` says whether the section optimizes charge, healing,
  support, damage, hybrid or remains unresolved;
- `directRecommendation` contains only equipment statements present in that
  bounded section and the exact catalog names that can be verified.

“大招越快越好” is charge/rotation evidence, never ultimate-damage evidence.
A generic recommendation follows a guide-scoped direct recommendation when it
exists. Resolve all exact guide-named catalog entities in one equipment query
to verify current ids, slots, fixed stats, effects and set membership. The
guide proves strategy; the catalog proves current product facts. Neither may
substitute for the other.

If the guide has a direct functional recommendation without an exact catalog
name, report that bounded strategy and its missing product detail. If no
operator-scoped recommendation exists, stop at the evidence boundary. Never
manufacture a damage profile, choose a set, or enter a `3+1` planner merely to
produce an answer.

A complete guide supplies an unchanged planner profile/capability for an
explicit planner operation. Only partial or missing guides authorize the exact
same-turn fallback token. For a functional partial guide, preserve its
charge/support/healing priorities and use fallback facts only to fill permitted
gaps; derived skill, elemental and general damage groups must not overwrite
that functional objective.

Separate four fact classes:

1. current equipped state comes from the current team/loadout capability;
2. stable names, ids, slots, fixed stats and effects come from the current
   product catalog or its registered native artifact;
3. strategy and priorities come from the bounded guide or authorized fallback
   profile;
4. applied state comes only from the visible Operator Config postcondition.

The selected-team reader may return an incomplete record. When `complete=false`
or a requested operator appears under `missing`, null weapon/skill values and
empty equipment arrays mean “saved loadout unavailable”, not “confirmed
unequipped” or “default build”. Its `characterIds` input accepts stable ids
only.

When a user names an operator in natural language, either let guide discovery
resolve the stable id first or read the whole selected team and match its
returned `characterName`. Never send a display name as `characterIds`.

Catalog browsing and selected-team state are different scopes. A blank
weapon/equipment resolver query may return a bounded catalog page; preserve
`catalogCount`, `exhaustive` and `truncated`, and never call that page the whole
local library.

For weapon fit, resolve combat conventions only when the guide's evidence
requirements say they are required. Preserve deterministic, high-probability,
low-probability and unknown edges. `READY_WITH_TRADEOFFS` is an unordered
tradeoff matrix, not a universal winner.

## Explicit 3+1 planning

Only the two explicit set operations may enter this section. A named-set route
carries the exact user set query and reads that set's facts directly. A
discovered-set route carries no set query and may shortlist from the whole
catalog before choosing one returned set. The two flows never call each
other's set-selection phase.

Materialize one current equipment artifact and treat its session-bound
`artifactId` as opaque typed evidence. Pass it directly among the projected
catalog, facts, shortlist and planner Tools. A generic file read is not an
intermediate phase and cannot authorize a typed Tool.

Planning uses the same artifact/source revision and unchanged profile
capability. The profile is evidence, not a scratch object: never append a set
name, slot preference or requested topology to its keywords or preference
groups. Harness Manager binds the artifact id, profile capability and exact
planner profile into downstream planner calls. `3+1` means at least three
named-set memberships across four physical slots. Four pieces are legal; an
off-set is chosen only for a strict verified effect-key improvement. Return
only the planner's bounded shortlist, never its full topology.

Keep every conditional effect conditional and repeat its returned condition
verbatim. Never claim that the operator can apply, sustain or reliably trigger
it unless an explicit typed result establishes that trigger capability.

`READY` permits ranking only within returned verified effect-key evidence; it
is not a universal or damage-simulated optimum. `PARTIAL`, `AMBIGUOUS`, and
`NO_PLAN` are terminal evidence boundaries: preserve every missing key and
ambiguity, create no proposal, and make no optimal, higher-damage or
unnecessary-piece claim. An `AMBIGUOUS` result may be described only as tied
candidates under the declared scoring. Never break that tie from raw numeric
ranges, rarity, intuition, or an unsourced “实战” judgment. Its response has
only two parts: the returned candidates and the exact evidence boundary.
Do not append trigger-applicability analysis, a preferred option, a follow-up
question, or an offer to continue.

## Proposal transaction

A preview is one complete configuration. It binds the target operator, user
constraints, Harness Revision, evidence reference/hash/applicability, catalog
artifact/source revision, current scheme version and immutable proposal token.

Preview is read-only: it creates no branch and requests no approval. A later
plain confirmation resumes the same transaction. A correction, question,
comparison such as “为什么不用…”, changed slot or changed priority supersedes
it and requires fresh evidence and preview.

Apply consumes the unchanged proposal once under native approval and current
scheme CAS. Completion requires the live Operator Config page to match every
reviewed field. Queue acknowledgement, Work Node checkout or model narration
is not success.

V4 deliberately reports loadout-only restore as unsupported because the
available whole-node restore could overwrite timeline or BUFF state.
