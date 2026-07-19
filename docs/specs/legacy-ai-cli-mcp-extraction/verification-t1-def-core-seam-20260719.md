# T1 DEF Core Composition Seam Verification

Date: 2026-07-19  
Baseline: `docs/specs/legacy-ai-cli-mcp-extraction/verification-t0-baseline-20260719.md`

This phase isolates the DEF-owned composition that must remain on `17321`. It does not
host, register, or route MCP through DEF OpenCode. The future Agent Fill MCP service is a
parallel process and has no access to these modules, tokens, sessions, or capabilities.

## Extracted boundary

- `scripts/def-core/runtime-composition.mjs`: lazy Work Node, Timeline Repository, and data-management ownership.
- `scripts/def-core/runtime-state.mjs`: process-local approval/prepared-plan state and raw transport policy.
- `scripts/def-core/tool-registry.mjs`: explicit typed-tool registry composition.
- `scripts/def-core/request-router.mjs`: dependency-injected DEF route-family dispatch.
- `scripts/def-core/transport-state.mjs`: Workbench command SSE client lifecycle.

`scripts/ai-cli-rest-server.mjs` remains the same executable entrypoint on the same host,
port, environment variables, and URL surface. Legacy fill fallback remains in place and
outside the DEF router.

## Deterministic evidence

| Command | Result |
| --- | --- |
| `node --check scripts/ai-cli-rest-server.mjs` and extracted modules | pass |
| `npm run test:def-core-router` | pass; route order, raw-token policy, isolated state, registry lookup, legacy route miss |
| `npm run test:def-core-baseline` | pass; all three frozen hashes unchanged |
| `npm run test:legacy-fill-wire` | pass; four domains and REST forbidden commands unchanged |
| binding/current gate/tool policy/raw route/approval/projection contracts | 7/7 pass |
| atomic team candidate/rollback/late-command/pending-reconciliation contracts | 4/4 pass |
| `npm run smoke:work-node-sqlite` | pass after repairing the stale native-token fixture |
| `npm run smoke:timeline-bundle` | pass |
| `npm run typecheck` | pass |
| `npm run check:repo` | pass; `REPOSITORY_CHECK_OK tracked=6764 syntax=76 docs=21 images=524` |

Frozen hashes remain:

- registry: `0f09ca7e1c84d90081c91ece18509639c7456f57bf6ea5f0e86143d87ce84ac3`;
- tool schema: `cb0bad92f618e9bc24088506c5324a5995c9247f4163615984c3cbec578e788b`;
- route map: `beb9ed4123e98ae71804ad4f638e3a5921149bc1f9415d12a850138110f85ae0`.

## Live-load gate

The current `npm run electron:dev` instance predates this source extraction. Per the
repository rule it was not restarted for an ordinary mechanical extraction. The T0 v1
Interop/UI record therefore remains the comparison baseline, while the post-change
natural read, low-risk mutation, native permission approve/reject/stale, renderer result,
and postcondition checks remain an explicit final controlled-load gate before overall
completion. No MCP acceptance may use that DEF route.
