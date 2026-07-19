# T9 caller migration verification — 2026-07-19

## Boundary under test

Legacy Fill MCP is connected directly by Codex or another standard MCP client to the isolated service on `17323`. It is not registered in, hosted by, proxied through, configured by, or called by DEF OpenCode. DEF checks below are separate regression evidence only.

The historical `/Users/sailstellar/Desktop/agent填表数据工具` directory was read but never written. Its current frozen inventory is 78 files, 27 hard-coded REST callers, and tree-content SHA-256 `88dde779498917aa8dc31624e20567e7c167f6ae160d15af40f401ffb78db931`.

## Curated resources and migration

- `strategy-v1.json` is explicitly `strategy-not-protocol`; protocol truth remains core-generated schema/tool definitions.
- `golden-v1.json` contains weapon and operator fixtures bound to schema version 1; both pass the daemon's core runtime validator.
- The copied DEF Skill protocol and golden files were removed. The remaining Skill is a temporary boundary notice plus a separately reviewable removal proposal; it contains no schema, old REST endpoint, external absolute path, MCP client configuration, or executable route.
- All 27 callers are documented as `archived-in-place`, owner `external legacy tooling`, with `direct Codex MCP` as replacement. `common_http.py` is not ported.
- `scripts/legacy-fill-mcp-migration-demo.mjs` performs only direct MCP current/template → validate → proposal creation and hands off to Electron Host review. It has no approve/reject/save or DEF operation.
- The existing `src/**` package allowlist includes the two reviewed resources and contains no external directory, cache, request dump, or historical caller entry.

## Commands and results

```text
npm run test:legacy-fill-curated
PASS — 2 fixtures; no path/token/cache leakage; package boundary; 78 files/27 callers; external tree hash recorded.

npm run test:legacy-fill-mcp
PASS — exact direct MCP tool/resource allowlists, owner isolation, restart/idempotency, HTTP and STDIO transports.

npm run test:legacy-fill-review
PASS — Host-only claim/decision/save contracts and trusted renderer gateway.

npm run test:def-core-baseline
PASS — registry 0f09ca7e…84ac3; schema cb0bad92…788b; route beb9ed41…5ae0.

npm run check:knowledge
PASS — DEF knowledge allowlist contract unchanged.
```

The final controlled Electron load, direct live MCP migration demo, and `DefCodexInteropProtocol v1` blackbox regression are recorded separately in the final verification record so the already-running development instance is not restarted during this coding task.

## Rollback

Restore the prior Skill boundary documents and remove the versioned resource files/client demo. No external file move, delete, archive, or product data write occurred. The legacy REST compatibility proxy remains present.
