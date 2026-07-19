# T5 Isolated Legacy Fill Service Verification

Date: 2026-07-19

`scripts/legacy-fill-service.mjs` is a production Node entrypoint with no Vite or dynamic
`src/**` SSR loading. It listens on loopback port `17323`, writes an owner-only registry,
and owns `legacy-fill.sqlite3`.

## Process boundary

- Electron starts the service as an independent child and records PID/start time.
- Startup is scheduled alongside, not inside, the existing DEF warmup. Fill failure is
  logged as unavailable and cannot throw into the `17321 → 17322 → runtime/ensure` chain.
- The child environment removes every `DEF_*` and `OPENCODE_*` variable. It receives only
  the fill port, DB path, registry path, and a separate `LEGACY_FILL_HOST_TOKEN`.
- Browser Host snapshots cross Electron IPC; Electron adds the Host token. The service
  never receives a DEF token or a renderer-selected filesystem path.
- Graceful shutdown removes only the matching registry; Electron falls back to process
  tree termination and does not delete the proposal DB.

## Evidence

`npm run smoke:legacy-fill-service` passed:

- independent start, health, PID and registry identity;
- unauthorized Host publish denied;
- four-domain snapshot publish/readiness;
- graceful shutdown and registry cleanup;
- restart persistence;
- MCP explicitly disabled in this phase;
- package manifest includes service/core and excludes the external desktop tool path.

Also passed: syntax checks, `npm run typecheck`, `npm run test:def-core-baseline`, and
`npm run check:repo` (`tracked=6781 syntax=83 docs=21 images=524`).

`npm run smoke:packaged-sidecar` currently stops before launching because the repository
has no built packaged OpenCode binary (`found 0`). This is an existing release-artifact
precondition and remains a final release-build gate; no assertion was weakened.

This service is the future Codex/standard MCP host. It is parallel to DEF OpenCode and is
not started by the DEF sidecar.
