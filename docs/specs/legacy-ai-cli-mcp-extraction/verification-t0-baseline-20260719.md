# T0 Legacy Fill / DEF Baseline Verification

Date: 2026-07-19  
Source commit: `8e375a3`  
Test run: `070b2aa0-bb24-442b-8ac1-f4efab2df3dc`

## Deterministic contract evidence

| Command | Result |
| --- | --- |
| `npm run test:legacy-fill-wire` | pass; four domains current/library/template/check/apply, proposal list/show, pending limit, REST forbidden commands |
| `npm run test:def-core-baseline` | pass; 64 definitions/records, registry/schema/route hashes match |
| `npm run check:repo` | pass; `REPOSITORY_CHECK_OK tracked=6759 syntax=72 docs=21 images=524` |

Fixtures are synthetic and contain no personal library data or absolute paths. The test server uses an isolated temporary storage, Work Node DB, Timeline DB, governance path, and script directory, then removes only that temporary directory.

## DEF Mac Desktop Interop baseline

This is a separate regression record. It is not an MCP transport or MCP client path.

Readiness:

- Protocol: `DefCodexInteropProtocol v1`.
- Bridge: ready (`electron-main`).
- Agent: ready (`def-agent-sidecar`).
- Workbench: `snapshotAvailable=true`, `uiConnected=true`, one UI consumer.
- Native session: `ses_086d32c7effeZiLi1qMsVEIGjq`.
- Harness: `def-stable`, content hash `90c89aadd8797fdbcf5b6db1ae39944d6be6efd828be129fe06fcb1d96571f16`.
- Existing session recovery was confirmed by selecting the same native session in the real iframe. Opening AI mode also exposed a new native session entry, without deleting or replacing the baseline session.
- Questions: none.

### Turn 1 — typed read

- Prompt: `请概括当前排轴的队伍与主要动作，并告诉我当前绑定的工作节点；只读取，不要修改任何内容。`
- Session: `ses_086d32c7effeZiLi1qMsVEIGjq`.
- Turn: `b91d5ced-15ff-47e9-bf86-766cdc7a4f49`.
- Accepted: 2026-07-19 epoch `1784444437320`.
- First native assistant activity: `1784444437424` (104 ms after accepted user message).
- Completion: `1784444455548` (18.228 s after accepted user message).
- Native tool calls:
  - `def_workbench_context`, completed, `1784444440694..1784444440701`;
  - `def_workbench_current_node`, completed, `1784444440828..1784444440833`.
- State change: none. Checkout remained timeline `archive-1784310552222-f4e2134d1b7f`, node `ai-timeline-node-1784367673917-dgf6vv57`, revision `1784367778216`.
- Pending command: none (`pending=null`).
- Final answer: summarized the four-person team, current timeline actions and damage snapshot, and reported the applied checkout node.
- Judgment: pass.

### Turn 2 — session-context read

- Prompt: `当前工作节点叫什么，当前队伍有哪些人？`
- Session: `ses_086d32c7effeZiLi1qMsVEIGjq`.
- Turn: `00a9ee0b-3e0b-4d5c-9097-71d5690daaed`.
- Accepted: epoch `1784445281013`.
- First native assistant activity: `1784445281021` (8 ms).
- Completion: `1784445284846` (3.833 s).
- Native tool calls: none; the same pinned native session correctly reused the immediately preceding typed context.
- State change: none; checkout and revision remained identical.
- Pending command: none.
- Final answer: named the applied Work Node and the same four operators.
- Judgment: pass.

## Real UI evidence

Computer Use inspected Chrome at `127.0.0.1:3030`, entered `AI 模式`, selected native iframe session `ses_086d32c7effeZiLi1qMsVEIGjq`, and confirmed:

- iframe title `DEF · 排轴助手`;
- both user messages are visible;
- native tool cards for `def_workbench_context` and `def_workbench_current_node` are visible;
- both final answers are visible;
- the current node/team match protocol transcript and state.

The protocol transcript/state are authoritative; Computer Use supplies only visibility evidence.

## T0 conclusion

Legacy fill wire behavior and DEF registry/session/current-read behavior are now comparable baselines. No production route, storage, product data, native tool, or running process was changed by T0.
