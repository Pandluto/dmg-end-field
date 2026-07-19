# MCP Fill product UI verification

Date: 2026-07-19 (Asia/Shanghai)

## Result

The fill review surface is now a dedicated product route at `/#/mcp-fill`, exposed from the bottom tool navigation as **MCP 填表**. It replaces the old review component and follows the repository's Office/Excel product layout rather than the AI CLI or DEF OpenCode layout.

The historical `/#/legacy-fill-review` page path remains a compatibility alias. The old `/open-mcp-fill` and `/open-legacy-fill-review` bridge endpoints now return the canonical Web route and do not create an Electron product window.

## Product and authority boundary

```text
Codex / standard MCP client
  -> 17323/mcp
  -> read, validate, create/inspect proposal only

MCP 填表 page in the main browser Web app
  -> protected loopback Web Host bridge
  -> short-lived trusted interaction capability
  -> claim + internal approval/save transitions
  -> restricted domain writer + reread postcondition
  -> proposal audit + Host snapshot revision

DEF OpenCode
  -> separate parallel runtime
  -> not registered, called, or involved in this UI workflow
```

The visible page explicitly says that it is a Web product page rather than the MCP protocol UI, and that Codex can only read, validate, and create proposals. The page shows the service state and canonical `http://127.0.0.1:17323/mcp` endpoint without exposing either bearer or Host tokens. Electron remains a background supervisor/Host bridge only.

## Interaction model

The product now exposes exactly two proposal actions:

- **拒绝**: opens a confirmation and closes the proposal without writing product data.
- **确认并写入**: opens one confirmation. The single trusted click drives the internal approve, save-begin, domain-restricted write, reread/postcondition, snapshot publication, and save-result audit sequence.

There is no Y/Y flow and no separate user-facing approve/save step. The internal transitions remain distinct CAS-protected audit records. Browser actions require the protected renderer capability plus a two-second one-use action capability, and save result still requires the short-lived continuation created by save-begin. MCP and ordinary REST callers have no access to those Host-only operations. The MCP Fill methods are not exposed through the Electron preload product API.

## Computer Use record

Computer Use opened the authorized main Web app in Chrome, clicked the visible **MCP 填表** navigation entry, and confirmed that the same browser tab navigated to `http://127.0.0.1:3030/#/mcp-fill`. No Electron MCP Fill product window was created. The accessibility tree confirmed:

- service ready at `17323/mcp`;
- proposal queue and status filters;
- structured field Diff;
- validation result, evidence, requested write target, base revision/hash, manifest digest, and normalized content;
- only **拒绝** and **确认并写入** actions;
- a full confirmation dialog describing the Host write and stale-revision safety boundary.

A direct standard MCP migration demo created synthetic proposal `fill-proposal-b2116d3f-237d-4f69-b8e3-a0424d6e5fae` with idempotency key `mcp-web-ui-20260719-correction`. In Chrome, the **确认并写入** dialog was opened and cancelled, proving cancellation caused no write. The **拒绝** dialog was then confirmed through the Web Host bridge. Final UI state was `rejected`, proposal revision 3, persistence `not-requested`, and the product notice stated that product data did not change.

An unauthenticated request to `http://127.0.0.1:31457/mcp-fill-host/state` returned HTTP 403 with `denied-renderer-transport`, while the Shell-authorized Chrome tab loaded the same state successfully. This proves the bridge is not an ordinary local REST approval surface.

## Verification commands

The implementation passed:

- `npm run check:repo` (`REPOSITORY_CHECK_OK tracked=6806 syntax=90 docs=21 images=524`)
- `npm run typecheck`
- `npm run test:legacy-fill-mcp`
- `npm run test:legacy-fill-curated`
- `npm run test:legacy-fill-review`
- `npm run test:legacy-fill-host`
- `npm run build:web`
- `npm run build`
- `npm run electron:build:mac:dir`
- `npm run smoke:packaged-legacy-fill-service` (`PACKAGED_LEGACY_FILL_OK`)
- `npm run smoke:packaged-sidecar` (`PACKAGED_SIDECAR_OK`)
- `git diff --check`

The Host contract additionally verifies that the page contains the complete review fields, does not expose Y/Y, uses the trusted one-click confirm bridge, cannot write before approval, rejects stale revision/digest/base identities, rolls back writer/postcondition failure, and permits an approved compatibility proposal to be explicitly rejected before save.
