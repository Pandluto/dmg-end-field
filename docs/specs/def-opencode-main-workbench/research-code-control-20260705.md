# Main Workbench Code Control Research - 2026-07-05

## Research

The main workbench is split across React state and browser storage.

- Selection state lives in `AppContext` and is mirrored to `sessionStorage.def.selected-characters.v1`.
- Timeline placement lives in `sessionStorage.def.timeline.data.v1`, with detailed button state in `sessionStorage.def.skill-button.v1`.
- Selected buff entities live in `sessionStorage.def.all-buff-list.v1`; the reliable write path is `addBuffToButton`.
- Damage calculation is already centralized in `buildDamageReportSnapshot`, which uses the persisted timeline/button/buff state and `calculateSkillButtonDamageV2`.
- Local app data and REST now-storage already sync through `data/localdata/now-storage.json`, so command state should use `localStorage` keys in the `def.*` namespace to stay visible to both browser and DEF REST.

The important boundary is that code control should not click the DOM. It should submit declarative commands and let the browser page translate those commands into existing services/repositories.

## Design

Add a small command protocol:

- `def.main-workbench.command-queue.v1`: localStorage queue of commands.
- `def.main-workbench.result-log.v1`: localStorage result history.
- `def.main-workbench.snapshot.v1`: localStorage mirror of selected operators, timeline buttons, selected buff ids, and damage report totals.

Supported commands:

- `selectCharacters`
- `openView`
- `clearTimeline`
- `addSkillButton`
- `addBuff`
- `setTargetResistance`
- `calculateDamage`
- `refreshSnapshot`

Execution split:

- `AppContext` handles selection-level commands.
- `CanvasBoard` handles timeline, buff, resistance, and damage commands.
- `scripts/ai-cli-rest-server.mjs` exposes `/api/main-workbench/*` endpoints so def-opencode scripts can enqueue commands with HTTP.

Example:

```json
{
  "command": {
    "op": "addSkillButton",
    "characterId": "operator-id",
    "skillType": "B",
    "staffIndex": 0,
    "nodeIndex": 3,
    "select": true
  },
  "source": "def-opencode"
}
```

Then poll:

```text
GET /api/main-workbench/commands
GET /api/main-workbench/snapshot
```

This keeps DEF OpenCode in a code-writing mode while the app remains the only actor that mutates main workbench truth.
