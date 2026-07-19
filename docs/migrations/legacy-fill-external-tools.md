# Legacy external fill tools migration

The historical directory `/Users/sailstellar/Desktop/agent填表数据工具` remains read-only and unchanged. It is not copied into this repository, the app package, an MCP server, or DEF OpenCode. Archiving or deleting it requires separate user confirmation; this migration records an in-place, recoverable archive plan only.

## Replacement boundary

Codex or another standard MCP client connects directly to the standalone `legacy-fill-service`. DEF OpenCode does not register, host, route, or call this MCP server and is involved only as a regression target.

The former Python flow maps to:

1. `fill_get_current` and `fill_get_template` read a Host-published snapshot and core-generated schema;
2. `fill_validate` normalizes and validates the explicit draft;
3. `proposal_create` creates an owner-scoped, idempotent proposal;
4. a real user reviews and chooses **拒绝** or **确认并写入** in the main Web product at `/mcp-fill`; one confirmed Web action completes the protected local Host approval/save audit sequence.

`common_http.py` must not be ported as another REST wrapper. Use the private `LegacyFillMcpClientConfigV1` described in `docs/development/legacy-fill-mcp.md`, or run `scripts/legacy-fill-mcp-migration-demo.mjs`. The demo has no approval/save capability and never talks to port `17321`.

## Caller inventory

All 27 hard-coded REST callers are historical and remain `archived-in-place`; owner is `external legacy tooling`, replacement is `direct Codex MCP`, and none is packaged:

| Callers | Status | Owner | Replacement |
| --- | --- | --- | --- |
| `_fix_junwei.py`, `_fix_junwei_attrs.py`, `_fix_rerong.py`, `analyze_equip.py`, `chaoyong_fill.py`, `common_http.py`, `cy_fix.py`, `cy_submit.py`, `fill_bieli.py` | archived-in-place | external legacy tooling | direct Codex MCP |
| `fill_denghuo.py`, `fill_hongyuan.py`, `fill_junwei.py`, `fill_laevatain.py`, `fill_lifeng_attr.py`, `fill_tangtang_final.py`, `fill_tangtang_v2.py`, `fix_chenqianyu.py`, `fix_jiufeng.py` | archived-in-place | external legacy tooling | direct Codex MCP |
| `fix_tangtang.py`, `gen_equip.py`, `jiufeng_buff.py`, `jy_fill.py`, `niangu_fill.py`, `qb_fill.py`, `tuohuang_fill.py`, `verify_equip.py`, `yinglong_fill.py` | archived-in-place | external legacy tooling | direct Codex MCP |

There are no `active`, `migrated executable`, or unknown-owner callers. A future owner may mark a caller `migrated` only after replacing it with a standard MCP client workflow; the old executable still remains historical rather than becoming runtime code.

## Curated inputs and package policy

- `src/legacyFillService/resources/strategy-v1.json` is strategy, never protocol.
- `src/legacyFillService/resources/golden-v1.json` contains sanitized fixtures bound to schema version 1 and verified by the same core validator used by MCP.
- Core-generated schema/template is the sole protocol source. The copied `CLAUDE.md` and `golden-examples.md` files were removed from the DEF runtime Skill.
- Historical Python/MJS/JSON, request/response captures, personal libraries/drafts, caches, `__pycache__`, `.DS_Store`, `_req_*`, temporary outputs, Windows absolute-path residue, and malformed filenames are excluded from the release allowlist.
- Only the reviewed versioned JSON under `src/legacyFillService/resources` is included through the existing `src/**` package allowlist.

Run `npm run test:legacy-fill-curated` to validate the fixtures, scan for sensitive/path leakage, verify the Skill boundary, verify the package allowlist, and—when the external directory exists—confirm its frozen 78-file/27-caller inventory without writing it.

## Recoverable archive plan

After separate confirmation, create a dated, checksum-recorded archive outside the application package; preserve file names and bytes; mark it read-only; verify restore into a temporary directory; and only then consider removing the working copy. Until that confirmation, the exit condition is documentation plus a stable content hash, not a filesystem move or deletion.
