# Owner-routing examples

These examples demonstrate the Finding contract; they do not authorize changes by themselves. In a real audit, replace illustrative paths with evidence-backed exact paths.

## 1. Promised typed result field is absent — Tool Contract

- **Observed facts:** v1 records `def_data_equipment_3plus1_facts` returning `status: READY` without the contract-promised typed `source.exhaustive` field. The transcript then guesses that the catalog is complete.
- **Violated contract:** The model-visible typed result must provide the promised field and truthful result semantics; a result may not force the agent to invent it.
- **Primary owner:** Tool Contract.
- **Owner evidence:** The contradiction is between the published tool schema/result and the emitted tool part. It is not a Runtime Skill recognition failure. If the source itself lacks catalog coverage, that is a separate Knowledge Finding, not a reason to fabricate the field.
- **Allowed files:** the evidence-named tool definition, native target/route serializer, OpenCode typed export, and a contract test for that result.
- **Forbidden files:** Base Prompt, `agent/runtime/def/skills/`, Harness teaching packages, and Domain Service ranking as a field-substitution workaround.
- **Duplicate / overlap:** Remove any confirmed prompt/skill/harness prose that tells the agent to assume the missing field; otherwise record `none evidenced` and do not add such prose.
- **Regressions:** In a fresh session assert the returned typed field and that the agent reports absent source facts truthfully. Also assert the adjacent catalog query keeps its source/truncation markers and that the read-only path leaves state unchanged.

## 2. Exact node id is rejected before approval — Domain Service

- **Observed facts:** A request carrying a valid exact node id terminates as `blocked-session-mismatch` before a native approval question is created. Trace and service evidence show the deterministic node-ownership validation compares the request against the wrong session stage.
- **Violated contract:** The domain process must validate node ownership against the correct request stage before it declares the request blocked; this is not an approval-UI display contract.
- **Primary owner:** Domain Service.
- **Owner evidence:** The fixed stage/node validation chose the rejection. Host is only an unproven interface hypothesis unless binding evidence shows the UI or session bridge supplied the wrong session id. Harness cannot own deterministic ownership validation.
- **Allowed files:** the evidence-named domain-service node/stage validator, its focused service test, and the necessary request adapter only if trace proves it transports the wrong identifier.
- **Forbidden files:** Harness package, Base Prompt, Runtime Skill, tool-description workaround, and Host UI code unless the separate binding hypothesis is confirmed.
- **Duplicate / overlap:** Delete a confirmed pre-approval prompt/harness retry rule that tries to evade the stage check; otherwise record `none evidenced`.
- **Regressions:** Reproduce the exact node request in a fresh native session and retain events/questions/state. Verify its valid path reaches the expected approval boundary, invalid ownership remains rejected, and refusal produces zero mutation.

## 3. Capability works but fresh sessions do not recognize it — Runtime Skill

- **Observed facts:** Direct Tool/Service traces return complete typed results for the requested capability, yet multiple fresh normal-language sessions consistently choose a different capability or cannot explain the returned result.
- **Violated contract:** The Runtime Skill must recognize its supported intent and explain the already-correct capability result; it must not require service/tool behavior to be rewritten.
- **Primary owner:** Runtime Skill.
- **Owner evidence:** The contract boundary and deterministic domain result already pass in isolated evidence. The recurring failure is agent recognition/explanation across fresh sessions, not a single experimental teaching variant.
- **Allowed files:** the evidence-named product runtime skill and its focused recognition/blackbox verification artifact.
- **Forbidden files:** Tool schema, Domain Service, Knowledge source, Base Prompt, and Harness package unless a separate audit proves one is at fault.
- **Duplicate / overlap:** Remove any confirmed Harness or prompt fallback that hard-codes this capability selection; otherwise record `none evidenced`.
- **Regressions:** Test the original natural-language request in a fresh session and an adjacent supported intent. Confirm the tool order/result explanation remains truthful and the read-only path has no approval or state change.

## 4. One bounded teaching experiment changes only tone — Harness

- **Observed facts:** Tool, Service, Runtime Skill, and Host traces satisfy their contracts. Only a named experimental package makes the answer exceed its approved teaching length/style, while the same capability remains correct.
- **Violated contract:** The experiment’s bounded teaching policy, not a permanent product capability contract.
- **Primary owner:** Harness.
- **Owner evidence:** The failing behavior is isolated to one experiment binding and disappears with the baseline while capability evidence is unchanged. This is not evidence to change Tool/Service/Runtime Skill behavior.
- **Allowed files:** the evidence-named Harness candidate/teaching rule and its experiment comparison verification.
- **Forbidden files:** Base Prompt, product Runtime Skill, Tool Contract, Domain Service, Knowledge, Permission/Mutation, and Host.
- **Duplicate / overlap:** Delete a confirmed second teaching rule that conflicts with the selected candidate; otherwise record `none evidenced`.
- **Regressions:** Compare a passing baseline and the repaired candidate in fresh sessions, retain their bindings and traces, and ensure the answer remains accurate without introducing tool-order or state changes.

## 5. The audit handoff itself assigns several owners — Teacher Audit

- **Observed facts:** `audit.md` labels one trace symptom as Tool, Harness, and Host at once, supplies no contract citations, and authorizes all three code areas.
- **Violated contract:** Teacher Audit must choose one primary owner from evidence and constrain the repair scope; it must not manufacture a cross-layer patch plan.
- **Primary owner:** Teacher Audit.
- **Owner evidence:** The defect is in the audit/repair-routing artifact. No product behavior has been shown to violate a runtime contract.
- **Allowed files:** `.agents/skills/harness-audit-assistant/` and the specific audit/handoff artifact being corrected.
- **Forbidden files:** `agent/runtime/def/skills/`, Harness product code, Tool/Service/Host code, Base Prompt, and package configuration.
- **Duplicate / overlap:** Remove the confirmed multi-owner repair instruction; do not replace it with a product runtime rule.
- **Regressions:** Re-route the same trace to one evidence-backed owner and check the resulting handoff permits only that owner plus a necessary adapter. Check a separate `ENVIRONMENT` record receives no product-file authorization.
