# Legacy Fill / DEF Core Frozen Inventory

Recorded: 2026-07-19  
Source commit: `8e375a3`  
Scope: T0 read-only inventory. This file records the pre-migration boundary; it is not a new protocol source.

## Hard process boundary

The future Agent Fill MCP is a parallel client surface for Codex and other standard MCP clients. It must not be hosted by, routed through, or registered in DEF OpenCode. DEF OpenCode remains a separate regression target only.

| State/capability | DEF core (`17321` + sidecar) | Legacy Fill/MCP target |
| --- | --- | --- |
| OpenCode/native session, axis binding, current checkout | owns | forbidden |
| typed tools, Work Node, Timeline, approval capability, governance token | owns | forbidden |
| fill schema/normalization/validation | legacy Vite-loaded code today | canonical pure core target |
| fill proposal/session/log state | browser/now-storage shim today | isolated proposal DB target |
| product library write | legacy browser writer | Electron Host-only target |
| MCP transport/session | none | isolated daemon; never a DEF session |

## Frozen legacy HTTP surface

Source: `src/aiCli/aiCliRestAdapter.ts::AI_CLI_REST_ENDPOINTS` plus the script routes owned directly by `scripts/ai-cli-rest-server.mjs`.

- Agent metadata: `GET /api/agent/guide`, `GET /api/agent/skills`, `GET /api/agent/sessions`, `GET /api/agent/logs`, `GET /api/agent/records`, `GET /api/agent/events` (SSE).
- Command compatibility: `GET /api/ai-cli/spec`, `POST /api/ai-cli/run`.
- Buff: `GET /api/buff/current`, `GET /api/buff/library`, `GET /api/buff/library/<id>`, `GET /api/buff/fill/template`, `POST /api/buff/fill/check`, `POST /api/buff/fill/apply`.
- Weapon: `GET /api/weapon/current`, `GET /api/weapon/library`, `GET /api/weapon/library/<id-or-name>`, `GET /api/weapon/fill/template`, `POST /api/weapon/fill/check`, `POST /api/weapon/fill/apply`.
- Operator: `GET /api/operator/current`, `GET /api/operator/library`, `GET /api/operator/library/<id-or-name>`, `GET /api/operator/fill/template`, `POST /api/operator/fill/check`, `POST /api/operator/fill/apply`.
- Equipment: `GET /api/equipment/current`, `GET /api/equipment/library`, `GET /api/equipment/library/<id-or-name>`, `GET /api/equipment/fill/template`, `POST /api/equipment/fill/check`, `POST /api/equipment/fill/apply`.
- Temporary script API: `GET /api/agent/scripts`, `GET /api/agent/scripts/<name>`, `POST /api/agent/scripts/write`, `POST /api/agent/scripts/run`, `POST /api/agent/scripts/delete`.
- Proposal compatibility is carried by `POST /api/ai-cli/run` commands `proposal.list`, `proposal.show`, and `proposal.clear`.

The synthetic, path-free four-domain wire inputs and replay assertions are in `fixtures/legacy-fill-wire-v1.json` and `scripts/legacy-fill-wire-contract.mjs`.

## Frozen storage and state

Product editor keys:

- Buff: `def.buff-editor.draft.v1`, `def.buff-editor.library.v1`, `def.buff-editor.undo.v1`.
- Weapon: `def.weapon-sheet.draft.v1`, `def.weapon-sheet.library.v1`.
- Operator: `def.operator-editor.draft.v1`, `def.operator-editor.library.v1`.
- Equipment: `def.equipment-sheet.draft.v1`, `def.equipment-sheet.library.v1`.

Legacy Agent keys:

- `def.ai-agent.sessions.v1`, `def.ai-agent.active-session-id.v1`, `def.ai-agent.session.v1`.
- `def.ai-agent.operation-logs.v1`, `def.ai-agent.permission-profiles.v1`, `def.ai-agent.proposals.v1`.

Legacy proposal state is two-stage: `Wait/Wait -> Yes/Wait -> Yes/Yes`; rejection is `No/No`, and unsave is `Yes/No`. REST forbids `proposal.approve`, `proposal.reject`, `proposal.save`, `proposal.unsave`, `Y`, and `N` with HTTP 403. A pending `Wait/*` or `Yes/Wait` proposal blocks every new domain apply with HTTP 409 `pending-proposals-blocking`. `fill.apply` itself reports `effects.writes=false` and only creates a proposal.

## Current `/ai-cli` and proposal reachability

- `src/components/AiCliPage.tsx` renders only `DefOpenCodeView host="ai-cli"`; there is no legacy terminal/review UI on this route.
- `src/aiCli/aiCliCommandService.ts` still contains browser-only approve/reject/save/Y/N handlers, but no current product component invokes them as a proposal review surface.
- `importExternalProposals()` exists in `src/aiCli/aiCliAgentInfrastructure.ts`; the repository has no production call site.
- `/api/agent/events` still streams legacy Agent records, but no current Host UI imports those proposals.

Therefore the old Web CLI Y/Y handoff text is frozen as wire compatibility, not asserted as a currently reachable product review flow.

## now-storage and browser direction

`src/utils/localDataBridge.ts` preserves the existing direction:

- normal startup (`forceApply=false`): browser storage is saved to now-storage, except when the SQLite workspace preservation guard applies;
- explicit package apply (`forceApply=true`): now-storage is applied to browser storage, the flag is cleared, and a bounded reload is scheduled;
- browser library writers emit `def:local-library-changed`; `AppContext` and `SelectionPanel` listen and re-read their local product data.

The MCP target must not read or write either storage directly. The Host gateway will publish versioned snapshots and continue to leave this bridge direction unchanged.

## Frozen DEF core surface and callers

Machine baseline: `fixtures/def-core-baseline-v1.json`; deterministic verifier: `scripts/def-core-baseline-check.mjs`.

- 64 legacy tool definitions/registry records, 60 model-exposed, 4 internal-only, 37 native targets.
- Frozen SHA-256: registry `0f09ca7e...84ac3`, schemas `cb0bad92...788b`, route map `beb9ed41...5ae0`.
- Route families: `/api/def-tools/*`, `/api/main-workbench/*`, `/api/timeline-*`, `/api/ai-timeline-worknodes*`, `/api/def-contract-test/*`.
- Required health fields are recorded separately so volatile PID/path/time values are never treated as a stable hash.

Callers of `17321`:

| Caller | Dependency |
| --- | --- |
| `electron/main.cjs` | startup/health, Workbench raw transport proxy, snapshot, process lifecycle |
| `agent/dev-agent.cjs` | development startup/health, Workbench proxy and snapshot |
| `agent/server/def-agent-server.cjs` | `DEF_REST_BASE_URL`, native session context and typed tool backend |
| `agent/runtime/def-tools/opencode/def.js` | canonical `POST /api/def-tools/call` plugin path |
| renderer bridge | snapshot, command result/SSE, Timeline/Work Node raw transport via Electron token |
| `scripts/def-*.mjs`, Work Node/Timeline smoke | binding/current/policy/approval/repository contracts |
| legacy external clients | domain REST, `/api/ai-cli/run`; these are the only callers targeted for migration |

No MCP resource/tool may proxy any of the DEF rows above.

## External `agent填表数据工具` read-only audit

The source directory was inspected but not modified. It has 78 files: 34 Python, 28 JSON, 4 Markdown, 3 text, 1 MJS, 1 shell file, 6 `pyc`, and `.DS_Store`. Exactly 27 files hard-code `127.0.0.1:17321`.

Migration classes:

| Class | Examples | Product treatment |
| --- | --- | --- |
| strategy candidates | selected prose from `CLAUDE.md` | curate as versioned strategy, explicitly non-protocol |
| golden fixtures | selected cases from `golden-examples.md` | sanitize, bind to schema version, validate before publish |
| legacy callers | `common_http.py`, `fill_*.py`, `*_submit.py`, MJS | document MCP replacement; never ship as executable MCP capability |
| historical evidence | issues, old specs, request/response captures | archive inventory only; not a truth source |
| excluded/private/transient | `__pycache__`, `.DS_Store`, `_req_*`, library dumps, drafts, Windows absolute-path residue, malformed filename | never copy or package |

The 27 hard-coded callers are: `_fix_junwei.py`, `_fix_junwei_attrs.py`, `_fix_rerong.py`, `analyze_equip.py`, `chaoyong_fill.py`, `common_http.py`, `cy_fix.py`, `cy_submit.py`, `fill_bieli.py`, `fill_denghuo.py`, `fill_hongyuan.py`, `fill_junwei.py`, `fill_laevatain.py`, `fill_lifeng_attr.py`, `fill_tangtang_final.py`, `fill_tangtang_v2.py`, `fix_chenqianyu.py`, `fix_jiufeng.py`, `fix_tangtang.py`, `gen_equip.py`, `jiufeng_buff.py`, `jy_fill.py`, `niangu_fill.py`, `qb_fill.py`, `tuohuang_fill.py`, `verify_equip.py`, and `yinglong_fill.py`.

## Packaging exclusion baseline

The future curated package allowlist must exclude the entire Desktop source directory by default and include only reviewed versioned guides/fixtures copied into the repository. It must also exclude arbitrary scripts/file access, DEF tokens/session data, absolute paths, caches, request dumps, personal libraries, and temporary outputs.
