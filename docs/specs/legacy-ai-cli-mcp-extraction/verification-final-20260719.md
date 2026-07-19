# Legacy Fill MCP extraction — final verification

Date: 2026-07-19 (Asia/Shanghai)

## Result and authority boundary

T0–T9 are implemented. The production boundary is now:

```text
Codex / standard MCP client
  -> authenticated Streamable HTTP or STDIO facade
  -> isolated legacy-fill-service (17323)
  -> canonical proposal SQLite + Host-published read-only snapshots

Electron Host review window
  -> Host-only claim / decision / save-begin / save-result
  -> domain-restricted browser/now-storage writer
  -> reread postcondition + audit + snapshot revision event

Legacy REST callers
  -> compatibility proxy in 17321
  -> the same legacy-fill-service/core/repository

DEF OpenCode
  -> unchanged DEF core (17321) / sidecar (17322) / native sessions
  -> no MCP registration, proxy, session, token, proposal, approval, or storage sharing
```

MCP and DEF OpenCode are parallel chains. Codex connected directly to MCP; DEF OpenCode was used only as a separate regression target. MCP exposes seven allowlisted tools and eight versioned resource templates. It has no approve, reject, save, Y/N, arbitrary file/script, localStorage, DEF tool, Work Node, Timeline, permission, or governance capability.

T10 (compatibility retirement) and T11 (DEF local-core rename) remain deliberately gated. The current product requirement is to retain compatibility, and the specification forbids those tasks until a later release window plus explicit product confirmation.

## Direct MCP migration and real Host UI

The live migration demo used the direct MCP client path:

```text
node scripts/legacy-fill-mcp-migration-demo.mjs \
  --domain weapon \
  --fixture-id weapon-stacking-chiying-v1 \
  --idempotency-key t9-live-migration-20260719-v1
```

Result: validation passed and `proposal_create` created `fill-proposal-2b6e0490-920c-453a-9080-9430c29258b4`, returning its versioned review resource URI. No DEF endpoint or session was involved.

The protected renderer bridge opened `/#/legacy-fill-review` in a dedicated Electron Host `BrowserWindow`. Computer Use confirmed the full manifest, field diff, evidence, revision and digest were visible. A real Host UI click claimed and rejected the synthetic proposal. Final state was `rejected`, revision 3, persistence `not-requested`, with save disabled. This safely exercised the user-authority boundary without writing product data.

The external `/Users/sailstellar/Desktop/agent填表数据工具` source remained read-only: 78 files, 27 hard-coded REST callers, tree-content SHA-256 `88dde779498917aa8dc31624e20567e7c167f6ae160d15af40f401ffb78db931`. Two curated, schema-versioned fixtures passed; no personal path, token, cache, request dump, or historical executable was packaged.

## DEF OpenCode separate blackbox regression

Protocol: `DefCodexInteropProtocol v1`. This section is regression evidence only, not an MCP route.

Readiness and identity:

- test run: `59a99866-71ce-4516-8b4b-a3179470e943`;
- native session: `ses_086c4f760ffeIOyxNfCTw1UjSt`;
- snapshot available, one real UI consumer, pending command `null`;
- checkout remained timeline `archive-1784310552222-f4e2134d1b7f`, node `ai-timeline-node-1784367673917-dgf6vv57`.

### Turn 1 — native session startup

- Prompt: `你好`
- Turn: `8f75969d-4e8c-4c61-a8bb-a08fc0fba42a`
- Client turn: `codex-1784451742913-3c28d304`
- Assistant created `1784451743157`; first visible text `1784451746085`; completed `1784451747346`
- Tool calls: none
- State change: none; pending command `null`
- Final answer: normal DEF Workbench greeting
- Judgment: pass

### Turn 2 — natural typed read

- Prompt: `现在工作台里选了哪些干员？`
- Turn: `2ea514c8-14fa-4ae5-bae0-b8b5ff32bbb2`
- Client turn: `codex-1784451793463-4a94a52f`
- User created `1784451793505`; first assistant phase `1784451793519`; completed `1784451799309`
- Tool: `def_workbench_context`, completed `1784451795026..1784451795041`
- State change: none; checkout/revision stayed unchanged; pending command `null`
- Final answer: accurately listed 莱万汀、狼卫、艾尔黛拉、秋栗 and the current timeline
- Judgment: pass

Computer Use confirmed the user prompt, native tool card and final table were visible in the real `DEF · 排轴助手` iframe. The protocol transcript/state are authoritative; Computer Use only confirms UI visibility. Mutation, renderer-result/postcondition, native permission, approval capability, stale/rollback and Work Node lifecycle were covered by the deterministic full matrix to avoid altering the user's live timeline during this extraction verification.

## Final command matrix

All commands below passed after the two packaging defects found by the release smoke were fixed:

- `npm run test:legacy-fill-core`
- `npm run test:legacy-fill-repository`
- `npm run test:legacy-fill-host`
- `npm run smoke:legacy-fill-service`
- `npm run test:legacy-fill-wire`
- `npm run test:legacy-fill-mcp`
- `npm run test:legacy-fill-curated`
- `npm run test:legacy-fill-review`
- `npm run test:def-core-baseline`
- `npm run test:def-core-router`
- `npm run test:def-workbench-binding`
- `npm run test:def-workbench-binding-rest`
- `npm run test:def-workbench-current-gate`
- `npm run test:def-workbench-tool-policy`
- `npm run test:def-workbench-raw-route-policy`
- `npm run test:def-interop-snapshot-auth`
- `npm run test:def-workbench-approval-capability`
- `npm run test:def-team-atomic-candidate`
- `npm run test:def-team-rollback`
- `npm run test:def-team-late-command`
- `npm run test:def-team-pending-reconciliation`
- `npm run test:def-workbench-projection-bridge`
- `npm run smoke:work-node-sqlite`
- `npm run smoke:timeline-bundle`
- `npm run smoke:data-management`
- `npm run check:knowledge`
- `npm run interop:check`
- `npm run harness:check`
- `npm run check:repo` (`REPOSITORY_CHECK_OK tracked=6803 syntax=89 docs=21 images=524` before this record)
- `npm run typecheck`
- `npm run build`
- `npm run electron:build:mac:dir`
- `npm run smoke:packaged-legacy-fill-service` (`PACKAGED_LEGACY_FILL_OK`)
- `npm run smoke:packaged-sidecar` (`PACKAGED_SIDECAR_OK`)

`smoke:work-node-sqlite` retained its known, teardown-only Vite transport-disconnect diagnostics but exited 0 and completed SQLite, REST, backup/restore and migration checks.

DEF frozen identities remained unchanged:

- registry SHA-256 `0f09ca7e1c84d90081c91ece18509639c7456f57bf6ea5f0e86143d87ce84ac3`;
- tool schema SHA-256 `cb0bad92f618e9bc24088506c5324a5995c9247f4163615984c3cbec578e788b`;
- route map SHA-256 `beb9ed4123e98ae71804ad4f638e3a5921149bc1f9415d12a850138110f85ae0`.

## Packaging defects found and closed

The release smoke first found that extracted `scripts/def-core/**` files were missing from `app.asar`; the package allowlist now includes them. It then found that Vite erased `dist/legacy-fill/domain-runtime.mjs` after it was built; the build order now generates the browser-neutral runtime after `build:web`. Both packaged services subsequently started from the actual macOS `.app` and shut down cleanly.

## Completion status

- T0–T9: complete, implemented, verified and committed.
- Unified DEF regression checklist: complete using live v1 blackbox plus deterministic mutation/permission/Work Node contracts.
- T10/T11: intentionally not executed; they require a future release window and explicit product confirmation, and would contradict the current requirement to preserve the legacy REST compatibility proxy.
