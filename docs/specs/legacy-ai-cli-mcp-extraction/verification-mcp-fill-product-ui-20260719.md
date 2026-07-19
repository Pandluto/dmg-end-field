# MCP Fill product UI verification

Date: 2026-07-19 (Asia/Shanghai)

## Result

The fill review surface is now a dedicated product route at `/#/mcp-fill`, exposed from the bottom tool navigation as **MCP 填表**. It uses a lightweight two-column Web flow: select a proposal, read its domain-specific product result, then confirm or reject it.

The historical `/#/legacy-fill-review` page path remains a compatibility alias. The old `/open-mcp-fill` and `/open-legacy-fill-review` bridge endpoints now return the canonical Web route and do not create an Electron product window.

## Product and authority boundary

```text
Codex / standard MCP client
  -> 17323/mcp
  -> read, validate, create/inspect proposal only

MCP 填表 page in the main browser Web app
  -> protected loopback Web Host bridge
  -> short-lived, review-bound Host action capability
  -> claim + internal approval/save transitions
  -> restricted domain writer + reread postcondition
  -> proposal audit + Host snapshot revision

DEF OpenCode
  -> separate parallel runtime
  -> not registered, called, or involved in this UI workflow
```

The page shows only the MCP service state; it does not expose bearer tokens, Host tokens, process identities, digests, or storage internals. Electron remains a background supervisor/Host bridge only.

## Interaction model

The product now exposes exactly two proposal actions:

- **拒绝**: opens a confirmation and closes the proposal without writing product data.
- **确认并写入**: opens one confirmation. The protected main Web renderer requests a one-use action capability bound to the current proposal, review session, revision, and manifest digest, then drives the internal approve, save-begin, domain-restricted write, reread/postcondition, snapshot publication, and save-result audit sequence.

There is no Y/Y flow and no separate user-facing approve/save step. The internal transitions remain distinct CAS-protected audit records. `Event.isTrusted` is a product-flow guard rather than server-attested proof of a click; Host authority comes from the protected main Web renderer capability. Browser actions additionally require a two-second, one-use capability bound to proposal/session/revision/digest, and save result still requires the short-lived continuation created by save-begin. MCP and ordinary REST callers have no access to those Host-only operations. The MCP Fill methods are not exposed through the Electron preload product API. A durable local outbox reconciles a successful product write if snapshot publication or save-result auditing is interrupted.

## Computer Use record

Computer Use opened the authorized main Web app in Chrome, clicked the visible **MCP 填表** navigation entry, and confirmed that the same browser tab navigated to `http://127.0.0.1:3030/#/mcp-fill`. No Electron MCP Fill product window was created. The accessibility tree confirmed:

- service ready at `17323/mcp`;
- a minimal searchable proposal queue with **待处理 / 全部** filters;
- one of four reusable read-only result components for weapon, operator, Buff, or equipment proposals instead of a generic spreadsheet, Markdown field tree, or raw JSON;
- a compact content-check and stale-version message next to the final actions;
- only **拒绝** and **确认并写入** actions;
- a full confirmation dialog describing the Host write and stale-revision safety boundary.

A follow-up Computer Use pass verified the lightweight layout in Chrome at `http://127.0.0.1:3030/#/mcp-fill`: the old overview ribbon and inspector remain removed, and a weapon proposal is rendered by the extracted weapon result component. The fixture value `sword` is shown as the product label **单手剑**; nine weapon effect levels are compressed to `Lv.1 → Lv.9`; the page presents one weapon, three skills, and four effects as the result rather than exposing the normalized payload. Separate operator, Buff, and equipment TSX components use their corresponding normalized localStorage models and product terminology. Product copy does not show the proposal owner namespace, process PID, `postcondition`, revision/digest labels, normalized payload, or Host evidence internals in the primary review flow.

A direct standard MCP migration demo created synthetic proposal `fill-proposal-b2116d3f-237d-4f69-b8e3-a0424d6e5fae` with idempotency key `mcp-web-ui-20260719-correction`. In Chrome, the **确认并写入** dialog was opened and cancelled, proving cancellation caused no write. The **拒绝** dialog was then confirmed through the Web Host bridge. Final UI state was `rejected`, proposal revision 3, persistence `not-requested`, and the product notice stated that product data did not change.

A follow-up standard MCP check created weapon proposal `fill-proposal-019ce3ab-ee37-4dba-a860-39c6a2220ab4` with a flat agility range `20 → 156` and a legacy `critRate` range `0.025 → 0.195`. The real Chrome product page rendered them as `Lv.1 20 → Lv.9 156` and `Lv.1 2.5% → Lv.9 19.5%`, including the product label **暴击率**. The proposal was then rejected through the visible Web confirmation; pending count returned to zero and the product notice confirmed that product data had not changed. This workflow used the direct standard MCP client and Web product route only; DEF OpenCode was not involved.

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
