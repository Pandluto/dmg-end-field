# Legacy Fill MCP development guide

Legacy Fill MCP is a direct Codex/standard-MCP-client integration. It is hosted by the isolated `legacy-fill-service` on loopback port `17323`; it is not registered in, routed through, or hosted by DEF OpenCode. DEF remains a separate runtime and is only a regression target for this extraction.

## Runtime boundary

- The authoritative Streamable HTTP endpoint is `http://127.0.0.1:17323/mcp`.
- The daemon is the only owner of `legacy-fill.sqlite3` and Host-published read-only snapshots.
- `scripts/legacy-fill-mcp-stdio.mjs` is a protocol facade: it launches no database and forwards every allowed resource/tool call to the daemon.
- Electron creates a private `LegacyFillMcpClientConfigV1` file with mode `0600`. In development it is `.runtime/legacy-fill-service/mcp-client.json`; in a packaged app it is under `<userData>/runtime/legacy-fill-service/mcp-client.json`.
- The MCP bearer token, Host authority token, and DEF internal token are distinct. The MCP token is never written to health responses or logs.

The authenticated token selects a stable `ownerNamespace`. MCP transport session IDs are transport-only and never become proposal owners. Names that contain DEF session, axis, timeline, Workbench, or DEF OpenCode identities are rejected as owners.

## Codex connection

The STDIO facade is the simplest local Codex registration because Codex only needs the private config path:

```sh
codex mcp add legacy-fill \
  --env LEGACY_FILL_MCP_CLIENT_CONFIG=/absolute/path/to/.runtime/legacy-fill-service/mcp-client.json \
  -- node /absolute/path/to/scripts/legacy-fill-mcp-stdio.mjs
```

For direct Streamable HTTP, load the token from the private config into an environment variable without placing it in command history, then register:

```sh
codex mcp add legacy-fill-http \
  --url http://127.0.0.1:17323/mcp \
  --bearer-token-env-var LEGACY_FILL_MCP_TOKEN
```

The desktop app must be running so its independently supervised `legacy-fill-service` is available. A failed/unavailable MCP endpoint never prevents DEF core or DEF OpenCode from starting.

## Capability allowlist

Tools are limited to `fill_get_current`, `fill_search_library`, `fill_get_template`, `fill_validate`, `proposal_create`, `proposal_list`, and `proposal_inspect`. Resources are the eight versioned templates in the extraction Spec. They expose only Host snapshots, core schema/template, curated strategy/examples, and owner-scoped proposal review/status.

There is deliberately no approve, reject, save, unsave, localStorage/now-storage write, file read, script execution, Host internal writer, or DEF proxy capability. The MCP server does not use MCP Tasks, sampling, or elicitation. A real user must review and decide a proposal in the Electron Host UI.

## Verification

Run:

```sh
npm run test:legacy-fill-mcp
```

The contract uses two Streamable HTTP clients and one STDIO client, verifies shared daemon state and owner isolation, checks the exact tool/resource allowlists, exercises pagination and structured errors, rejects DNS-rebinding/Origin/auth failures, proves product snapshot hashes remain unchanged, and verifies persistence/idempotency across daemon restart.
