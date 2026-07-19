# T7 verification — direct Legacy Fill MCP

Date: 2026-07-19 (Asia/Shanghai)

## Boundary result

T7 exposes MCP directly from the isolated `legacy-fill-service` at loopback `/mcp`. Codex and standard MCP clients connect to that daemon, either with Streamable HTTP or through the STDIO forwarding facade. No MCP request, token, owner, tool, resource, or transport is registered in or routed through DEF OpenCode. DEF was exercised only as an unchanged regression target.

The daemon remains the single owner of the proposal SQLite and Host-published snapshots. The STDIO facade uses an official MCP client to forward to the daemon and never opens a database. MCP authentication maps a private per-client token to a stable owner namespace; transport sessions do not establish ownership. MCP, Host, and DEF authority tokens are distinct.

## MCP contract evidence

`npm run test:legacy-fill-mcp` passed with:

- exact allowlists of seven tools and eight versioned resource templates;
- input and output schemas plus structured errors for every tool;
- two Streamable HTTP clients and one STDIO client sharing one daemon proposal state;
- owner isolation for tool and resource reads;
- deterministic validation, cursor pagination, proposal idempotency, audit persistence, and daemon restart;
- absent/invalid auth, illegal Host, illegal Origin, oversized body, forbidden tool-name probing, and arbitrary-resource negative cases;
- all allowed calls leaving the four Host snapshot content hashes unchanged;
- STDIO producing MCP protocol on stdout with no facade diagnostics on stderr;
- exact `@modelcontextprotocol/sdk` pin at `1.29.0` and packaged facade/fixture allowlist entries.

The MCP server registers no approval, rejection, save, unsave, browser/now-storage writer, file/script execution, Host internal writer, or DEF proxy. It does not enable MCP Tasks, sampling, or elicitation.

## Commands and results

| Command | Result |
| --- | --- |
| `npm run check:repo` | pass; `REPOSITORY_CHECK_OK tracked=6790 syntax=86 docs=21 images=524` |
| `npm run typecheck` | pass |
| `npm run test:legacy-fill-core` | pass |
| `npm run test:legacy-fill-repository` | pass |
| `npm run test:legacy-fill-host` | pass |
| `npm run smoke:legacy-fill-service` | pass |
| `npm run test:legacy-fill-wire` | pass for four domains and REST negative commands |
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
| `npm run smoke:work-node-sqlite` | pass; expected Vite transport-disconnect teardown diagnostics remained non-fatal |
| `npm run build:web` | pass |
| `npm run audit:dependencies` | pass at configured high threshold; two pre-existing/moderate `exceljs -> uuid` advisories remain and require a breaking downgrade to auto-fix |

DEF frozen identities remained:

- registry SHA-256: `0f09ca7e1c84d90081c91ece18509639c7456f57bf6ea5f0e86143d87ce84ac3`
- tool schema SHA-256: `cb0bad92f618e9bc24088506c5324a5995c9247f4163615984c3cbec578e788b`
- route map SHA-256: `beb9ed4123e98ae71804ad4f638e3a5921149bc1f9415d12a850138110f85ae0`

The running development Electron instance intentionally was not restarted for this commit. The final controlled-load Mac Desktop Interop v1 + Computer Use blackbox remains the release gate after T8/T9, so it observes the complete integrated build once rather than repeatedly disturbing the user's long-running development instance.

Codex connection instructions and private config locations are in `docs/development/legacy-fill-mcp.md`.
