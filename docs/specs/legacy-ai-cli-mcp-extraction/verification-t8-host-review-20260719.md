# T8 verification — Host-owned review and save

Date: 2026-07-19 (Asia/Shanghai)

## Result

The product now has a standalone `/legacy-fill-review` page. It is separate from `DefOpenCodeView` and presents the complete `ProposalReviewManifestV1`: target/base identity, normalized draft, field-level diff, validation and warnings, evidence, requested writes, review/persistence state, proposal revision, and manifest digest.

The first release keeps the two-step product intent:

1. a real user click approves or rejects the claimed proposal;
2. after approval, a separate real user click begins save.

The preload isolated world only issues a two-second, one-use action capability while capturing a trusted approve/reject/save click. Save result additionally requires a 30-second, one-use continuation derived from save begin. Renderer code cannot directly invoke the decision/save IPC methods without those capabilities. These fill capabilities are unrelated to and do not reuse DEF native permission/approval capability.

Host claim, decision, save-begin, and save-result are all Host-token-only daemon routes. Every transition uses expected proposal revision, manifest digest, and independent review session. Save begin also checks the current Host library revision/content hash. The browser Host gateway performs only domain-specific merges, rereads current/library, verifies postconditions, rolls back failures, publishes a new snapshot/revision, emits `legacy-fill.library.changed`, and then records the result in the proposal audit.

## State-path evidence

`npm run test:legacy-fill-review` passed:

- pending → claim → approve → save-started → saved;
- explicit reject with persistence remaining not-requested;
- stale base fail-closed after a newer Host snapshot;
- proposal revision/digest CAS conflicts;
- unapproved save rejection;
- writer failure and postcondition failure with rollback;
- failed persistence audit state;
- REST/MCP retry returning the existing proposal instead of reusing an old confirmation for new content;
- only the target domain revision changing after successful write;
- ordinary transports denied from Host internal list/claim routes;
- UI/source contract proving full manifest visibility and no `DefOpenCodeView` dependency.

Computer Use opened the real Vite/Chrome product at `http://127.0.0.1:3030/#/legacy-fill-review` from the visible “填表审查” bottom navigation. The accessibility tree and captured screenshot showed the independent page, “Electron Host authority” heading, and the message that MCP can only create proposals. The long-running Electron process was intentionally not restarted, so its old preload reported `Legacy Fill Host method unavailable: listLegacyFillProposals`; the final one-time controlled load remains the integration gate for the new preload/daemon endpoints.

## Full matrix

| Command | Result |
| --- | --- |
| `npm run check:repo` | pass; `REPOSITORY_CHECK_OK tracked=6794 syntax=87 docs=21 images=524` |
| `npm run typecheck` | pass |
| `npm run test:legacy-fill-core` | pass |
| `npm run test:legacy-fill-repository` | pass |
| `npm run test:legacy-fill-review` | pass |
| `npm run smoke:legacy-fill-service` | pass |
| `npm run test:legacy-fill-wire` | pass |
| `npm run test:legacy-fill-mcp` | pass |
| `npm run test:def-core-baseline` | pass; registry/schema/route-map hashes unchanged |
| `npm run test:def-core-router` | pass |
| `npm run test:def-workbench-binding` | pass |
| `npm run test:def-workbench-binding-rest` | pass |
| `npm run test:def-workbench-current-gate` | pass |
| `npm run test:def-workbench-tool-policy` | pass; 50 current/tree tools |
| `npm run test:def-workbench-raw-route-policy` | pass |
| `npm run test:def-interop-snapshot-auth` | pass |
| `npm run test:def-workbench-approval-capability` | pass |
| `npm run smoke:work-node-sqlite` | pass; known teardown-only Vite transport diagnostics remained non-fatal |
| `npm run build:web` | pass |
| `npm run audit:dependencies` | pass at high threshold; two moderate `exceljs -> uuid` advisories remain because automatic repair is a breaking downgrade |

DEF frozen identities remained:

- registry SHA-256: `0f09ca7e1c84d90081c91ece18509639c7456f57bf6ea5f0e86143d87ce84ac3`
- tool schema SHA-256: `cb0bad92f618e9bc24088506c5324a5995c9247f4163615984c3cbec578e788b`
- route map SHA-256: `beb9ed4123e98ae71804ad4f638e3a5921149bc1f9415d12a850138110f85ae0`

The deterministic DEF checks are regression evidence only. No fill review state, token, event, or tool entered DEF OpenCode, native permission/questions, Timeline, Work Node, or DEF SQLite.
