# Legacy Fill MCP development guide

Legacy Fill MCP is a direct Codex/standard-MCP-client integration. It is hosted by the isolated `legacy-fill-service` on loopback port `17323`; it is not registered in, routed through, or hosted by DEF OpenCode. DEF remains a separate runtime and is only a regression target for this extraction.

## Runtime boundary

- The authoritative Streamable HTTP endpoint is `http://127.0.0.1:17323/mcp`.
- The daemon is the only owner of `legacy-fill.sqlite3` and Host-published read-only snapshots.
- `scripts/legacy-fill-mcp-stdio.mjs` is a protocol facade: it launches no database and forwards every allowed resource/tool call to the daemon.
- Electron creates a private `LegacyFillMcpClientConfigV1` file with mode `0600`. In development it is `.runtime/legacy-fill-service/mcp-client.json`; in a packaged app it is under `<userData>/runtime/legacy-fill-service/mcp-client.json`.
- The MCP bearer token, Host authority token, and DEF internal token are distinct. The MCP token is never written to health responses or logs.

The authenticated token selects a stable `ownerNamespace`. MCP transport session IDs are transport-only and never become proposal owners. Names that contain DEF session, axis, timeline, Workbench, or DEF OpenCode identities are rejected as owners.

## Product review workspace

The canonical product route is `/#/mcp-fill` inside the main browser Web app. The historical `/#/legacy-fill-review` URL remains a compatibility alias. The old protected `/open-mcp-fill` and `/open-legacy-fill-review` bridge calls now resolve the Web route without creating an Electron product window. New callers and documentation must use the MCP name.

The page follows the product's Office/Excel workspace layout: proposal queue on the left, field Diff in the center, and validation, evidence, requested writes, base identity, and normalized content in the Host inspector on the right. It is a browser product page, not an MCP protocol inspector and not a DEF OpenCode page. Electron remains a headless local supervisor/Host bridge for the browser; it does not render a separate MCP Fill window.

The user flow has two actions only:

1. **拒绝** ends the proposal without changing product data.
2. **确认并写入** opens one interactive Web confirmation. The protected main Web renderer requests a short-lived, one-use local Host capability bound to the proposal id, review session, revision, and manifest digest, then performs the internal approve → save-begin → restricted domain write → reread/postcondition → save-result audit sequence.

There is no Y/Y interaction and no separate user-facing approve/save step. `Event.isTrusted` is a product-flow guard, not server-side click attestation; the protected renderer capability is the Host authority boundary. The internal transitions remain separate revision- and digest-bound audit events, and MCP still cannot invoke any of them. Cancelling the confirmation has no side effect. An already-approved compatibility proposal can be rejected or completed through the same two product actions. If the product write succeeds but snapshot/audit publication is interrupted, a durable browser outbox reconciles that result on the next authorized page bootstrap.

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

To exercise the migrated external workflow with an explicit JSON draft:

```sh
node scripts/legacy-fill-mcp-migration-demo.mjs \
  --domain weapon \
  --fixture-id weapon-stacking-chiying-v1 \
  --idempotency-key workspace-task-stable-key
```

Use `--draft /absolute/path/to/draft.json` instead of `--fixture-id` for an external workflow. This uses MCP read → template → validate → proposal creation and then stops. The printed next step is review in the main Web product; the script cannot approve, reject, or save.

## Capability allowlist

Tools are limited to `fill_get_current`, `fill_search_library`, `fill_get_template`, `fill_validate`, `proposal_create`, `proposal_list`, and `proposal_inspect`. Resources are the eight versioned templates in the extraction Spec. They expose only Host snapshots, core schema/template, curated strategy/examples, and owner-scoped proposal review/status.

There is deliberately no approve, reject, save, unsave, localStorage/now-storage write, file read, script execution, Host internal writer, or DEF proxy capability. The MCP server does not use MCP Tasks, sampling, or elicitation. A user reviews and decides a proposal in the protected main Web UI; MCP and ordinary REST callers cannot access that renderer-authorized Host bridge.

## Verification

Run:

```sh
npm run test:legacy-fill-mcp
npm run test:legacy-fill-curated
```

The contract uses two Streamable HTTP clients and one STDIO client, verifies shared daemon state and owner isolation, checks the exact tool/resource allowlists, exercises pagination and structured errors, rejects DNS-rebinding/Origin/auth failures, proves product snapshot hashes remain unchanged, and verifies persistence/idempotency across daemon restart.
