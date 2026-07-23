# Spec 9-2 Migration Ledger

## Purpose

This ledger separates business teaching from product-enforced contracts before the
Workbench runtime is switched to the five-business Harness Manager.

The status values used below are:

- `planned`: target owner is known but the old owner is still active during migration;
- `migrated`: the target owner exists and the old owner no longer supplies the rule;
- `deleted`: the old runtime source is no longer reachable from a formal Workbench turn;
- `retained-hard-contract`: the rule remains code-enforced and is not copied into Harness
  instructions as its source of authority.

## Product hard contracts

These contracts are frozen as executable product boundaries. Harness revisions may explain
that a boundary exists, but cannot implement, weaken, or replace it.

| Contract | Executing owner | Regression evidence | Migration status |
| --- | --- | --- | --- |
| Workbench Session is immutably bound to one timeline axis and converges on the current checkout | `agent/server/def-agent-server.cjs`, timeline repository session-axis APIs, `def.workbench.bind_session_axis` | `scripts/def-workbench-binding-contract-test.mjs`, `scripts/def-workbench-binding-rest-contract-test.mjs` | retained-hard-contract |
| The live page projection is authoritative and must converge before a mutation is considered applied | Workbench snapshot bridge and `scripts/ai-cli-rest-server.mjs` visible-postcondition checks | `scripts/def-workbench-projection-bridge-contract-test.mjs` | retained-hard-contract |
| Canonical Tool host/workspace exposure is code-defined | `agent/runtime/def-tools/registry.mjs`, REST invocation policy | `scripts/def-workbench-tool-policy-contract-test.mjs`, `scripts/def-workbench-raw-route-policy-contract-test.mjs` | retained-hard-contract |
| Native permission and user approval are required for protected mutation | OpenCode permission cards, DEF native wrappers, approval capability store | `scripts/def-workbench-approval-capability-contract-test.mjs` | retained-hard-contract |
| Proposal, plan, artifact and apply capabilities bind the reviewed object and are not reconstructed from chat | typed Tool handlers and `scripts/ai-cli-rest-server.mjs` capability stores | `scripts/def-operator-config-atomic-contract-test.mjs`, `scripts/def-team-atomic-candidate-contract-test.mjs` | retained-hard-contract |
| Revision/CAS prevents stale writes | Work Node repository, operator/team apply handlers and checkout revision checks | `scripts/def-team-late-command-contract-test.mjs`, `scripts/def-team-pending-reconciliation-rest-contract-test.mjs` | retained-hard-contract |
| Work Node rebuild, validation, semantic diff, use and restore are real state transitions | `agent/runtime/def-node-workspace/**`, DEF node Tools and REST handlers | `agent/runtime/def-node-workspace/codec.test.mjs`, Work Node smoke suites | retained-hard-contract |
| Product commands remain schema-validated | `src/agentKernel/mainWorkbench/commandSchemaRuntime.mjs` and REST dispatch | repository TypeScript tests and Workbench command contract tests | retained-hard-contract |
| Damage formulas and recomputation remain product-owned | existing calculator/report pipeline | numeric tests and damage Tool contracts | retained-hard-contract |
| AI CLI cannot host DEF OpenCode | retired host routes and route validation | `scripts/def-opencode-host-retirement-contract-test.mjs` | retained-hard-contract |

No full-text snapshot of the legacy Workbench prompt is a protected contract.

## Fixed Workbench Agent Prompt

Source: `agent/runtime/def-opencode-adapter/index.cjs`,
`buildAgentPrompt("workbench")`.

| Legacy rule summary | Target owner | Target file | Status | Removal evidence |
| --- | --- | --- | --- | --- |
| Agent identity, Chinese default, no fabricated hidden state | Host Kernel | minimal Workbench agent prompt in `agent/runtime/def-opencode-adapter/index.cjs` | migrated | formal Workbench branch returns `MINIMAL_WORKBENCH_AGENT_PROMPT` before any historical teaching |
| Session/timeline/checkout and rebind facts | Host Kernel plus product gate | `agent/runtime/def-harness-manager/host-kernel.cjs` and Server axis sync | migrated | fixed prompt has no business Tool order |
| Current selection inspection and exact operator resolution | selection Harness | `agent/harness/business/selection/revisions/v1/` | migrated | selection instructions/manifest own the phases |
| Selection add/remove/replace/reorder/application workflow | selection Harness | `agent/harness/business/selection/revisions/v1/` | migrated | fixed prompt no longer names selection workflow |
| Team/loadout read, guide-first, weapon/equipment fit and source-only guide routes | loadout Harness | `agent/harness/business/loadout/revisions/v1/` | migrated | fixed prompt no longer contains guide/planner ordering |
| 3+1 set shortlist, facts, planner and bounded answer policy | loadout Harness | `agent/harness/business/loadout/revisions/v1/` | migrated | fixed prompt no longer contains 3+1 teaching |
| Config preview, later confirmation, apply and correction invalidation | loadout Harness plus typed proposal enforcement | `agent/harness/business/loadout/revisions/v1/`, existing Tool handlers | migrated | fixed prompt no longer owns proposal workflow |
| Timeline checkout/bind, fork, coordinate lookup, skill identity, edit, validate/diff/use/restore | timeline Harness | `agent/harness/business/timeline/revisions/v1/` | migrated | fixed prompt no longer contains node workflow |
| BUFF lookup, ranking, binding and Work Node mutation | buff Harness | `agent/harness/business/buff/revisions/v1/` | migrated | fixed prompt no longer owns BUFF workflow |
| Damage/report sequencing and result wording | calculation Harness | `agent/harness/business/calculation/revisions/v1/` | migrated | fixed prompt no longer owns calculation flow |
| Failure repetition stop policy and final-answer formatting per operation | respective business Harness; stable Tool errors remain local | five V1 revisions and Tool local contracts | migrated | fixed prompt contains no cross-Tool flow |

## Per-turn Host Prompt

Sources: `agent/server/def-agent-server.cjs`,
`buildWorkbenchCheckoutSystemPrompt()` and
`buildWorkbenchContextSystemPrompt()`.

| Legacy rule summary | Target owner | Target file | Status | Removal evidence |
| --- | --- | --- | --- | --- |
| Session/timeline/checkout identity, transition and projection facts | Host Kernel | `agent/runtime/def-harness-manager/host-kernel.cjs` | migrated | retained as facts in prepared turn |
| Rebind is required when checkout changed | Product gate; Harness sees only the gate state | Server axis sync, node bind handler, Manager context | migrated | execution cannot bypass bind; no duplicated workflow |
| Direct current-node reply recipe | timeline inspect operation | timeline V1 | migrated | Host emits node facts without answer choreography |
| Which Tool must be called first after a transition | business Harness phase | relevant V1 manifest | migrated | Host contains no Tool sequence |
| Failure response and stop wording | business Harness plus typed error | relevant V1 instructions/Tool result | migrated | Host contains no final-answer command |

## Legacy eight-slot Harness package

Sources: `agent/harness/def-harness.cjs`,
`agent/harness/baseline/stable-v0/**`, and legacy examples/scenarios.

| Legacy rule summary | Target owner | Target file | Status | Removal evidence |
| --- | --- | --- | --- | --- |
| Package manifest/hash validation | historical training material only | archived legacy files; not formal loader | deleted | formal runtime has no package ref or legacy loader import |
| Role, routing, workflow, Skill, Tool guidance, knowledge and response policy are composed globally | five business revisions or deletion when duplicated | `agent/harness/business/**` | deleted | `composeHarnessSystem()` is unreachable from UI/Interop/session restore |
| Session is pinned to a whole package | per-business transaction revision pin | `agent/runtime/def-harness-manager/transactions.cjs` | deleted | schema-v5 Session binding contains no package/hash and recovery strips old fields |
| Channel-level promote/rollback of the whole package | per-business Revision Controller | `agent/runtime/def-harness-manager/registry.cjs` | migrated | active/previous state is stored by business id |

Legacy baselines/examples/scenarios may remain only as historical or migration fixtures. They
must not be discoverable by the formal Workbench loader after Task 14.

## Timeline Workbench Skill

Source: `agent/runtime/def/skills/timeline-workbench/SKILL.md`.

| Legacy rule summary | Target owner | Target file | Status | Removal evidence |
| --- | --- | --- | --- | --- |
| Global Workbench routing | Manager Router/Plan | `agent/runtime/def-harness-manager/router.cjs`, `plans.cjs` | deleted | formal OpenCode config has no Skill path and phase projection never exposes `skill` |
| Selection workflow | selection Harness | selection V1 | migrated | selection V1 owns the executable phases |
| Loadout/guide/catalog/proposal workflow | loadout Harness | loadout V1 | migrated | loadout V1 owns the executable phases |
| Timeline Work Node workflow | timeline Harness | timeline V1 | migrated | timeline V1 owns the executable phases |
| BUFF workflow | buff Harness | buff V1 | migrated | buff V1 owns the executable phases |
| Calculation/report workflow | calculation Harness | calculation V1 | migrated | calculation V1 owns the executable phases |
| Approval, CAS and postcondition claims | product hard contracts | existing handlers/tests | migrated | Harness refers to outcomes; code remains authority |

## Legacy turn router

Source: `agent/runtime/def-opencode-adapter/harness-turn-router.cjs`.

| Legacy rule summary | Target owner | Target file | Status | Removal evidence |
| --- | --- | --- | --- | --- |
| Exact skill-fact request recognition | timeline/calculation operation routing where unambiguous | new Router route schema and relevant V1 | migrated | narrow deterministic recognition now creates `calculation.skill_fact` |
| Timeline intent overrides config candidate | structured ambiguity/operation resolution | new Router | deleted | no candidate selector or regex override exists |
| Harness selector result | deleted | none | deleted | old router file and selector result were removed |

## Tool descriptions

Source: `agent/runtime/def-tools/opencode/def.js`; canonical identity and exposure remain in
`agent/runtime/def-tools/registry.mjs`.

| Legacy rule summary | Target owner | Target file | Status | Removal evidence |
| --- | --- | --- | --- | --- |
| Input schema, structured result, side effect, capability source and typed error | Tool local contract | `def.js` plus Registry local contract view | migrated | plugin exposes `DEF_TOOL_LOCAL_CONTRACTS` descriptions |
| “Must be first”, “do not call X before/after” and evidence ordering | respective business phase | five V1 manifests/instructions | migrated | exposed description has no cross-Tool sequence |
| Which Tool to call next | respective business phase | five V1 manifests | migrated | exposed description does not route |
| How the whole operation ends or what final answer says | respective Harness completion/response phase | five V1 instructions | migrated | exposed description is not a workflow |
| Host/workspace exposure, approval/capability and typed execution | product hard contract | Registry, plugin and REST handlers | retained-hard-contract | enforced independently of model text |

## Deletion gate

Task 14 may close this ledger only when all of the following searches are clean for the formal
Workbench ingress:

1. Server ingress calls only `prepareWorkbenchTurn()`, not `getNativeHarnessSystem()`.
2. Session create/recover does not call `resolveNativeHarness()` or
   `createSessionBinding()`.
3. Formal request construction does not call `composeHarnessSystem()`.
4. The Workbench agent does not load `timeline-workbench`.
5. The old turn router does not select a Harness for a formal request.
6. Exposed Tool descriptions contain only local contracts.
7. Every migrated row above has a V1 owner and executable phase reference.

Task 14 closed this gate. `formal-switch.test.mjs` exercises route/business
projection, deterministic narrow routes, schema-v5 Session migration, and the
absence of legacy loader/Skill/selector ingress.
