# AI CLI Buff Fill Spec

## Goal

Build an in-app AI CLI workspace for one workflow first: `buff.fill`.

The app stays in control. Codex or Claude only returns structured JSON. The app validates, previews, asks the user to confirm, then writes data.

## First release scope

Included:

- A route: `/ai-cli`
- A page title: `AI CLI`
- A terminal-style text UI: one output stream and one command input
- One AI workflow command: `buff.fill`
- Draft CRUD commands for Codex/Claude-driven smoke testing
- Operator test-fixture commands for creating/selecting a test operator
- Export current Buff context for an external agent
- Paste an external agent result with `fill.apply <json>`
- Validate the result with the existing Buff fill validator
- Apply the result to the current Buff draft

Not included:

- Desktop-clickable AI CLI entry
- Local-data desktop/web dual-end storage sync
- MCP
- Local HTTP tool server
- Direct Claude/Codex process control
- Automatic model calls
- Cross-draft patching
- Reorder operations

## Desktop and storage-sync boundary

AI CLI is a standalone development/test surface.

The web main page may expose an `AI CLI` entry. The desktop app may render the same entry, but it must be disabled and must not navigate into AI CLI from the desktop UI. The route may still be opened directly in development or by Playwright.

AI CLI is unrelated to the previously completed local-data dual-end storage sync. It does not participate in that archive/import/export bridge, and it must not be treated as a replacement or extension of that storage-sync workflow.

## User flow

1. User opens `AI CLI`.
2. User types commands in the terminal input.
3. `fill.task` builds a task package containing:
   - command name
   - current draft
   - supported modifier catalog
   - strict output contract
   - source text area content
4. User copies the task package to Codex or Claude.
5. Codex or Claude returns one JSON object using `BuffFillAiDraft`.
6. User or automation runs `fill.apply <json>` in `AI CLI`.
7. App validates the JSON. Use `fill.check <json>` for dry-run validation.
8. App replaces current draft `items`, keeps the current draft id/name/source fields, writes local storage, and creates an undo snapshot.

## Output rules

The terminal is intentionally plain text:

- Every entered command is echoed as `def:<draftId>> <command>`.
- Long JSON input is summarized as `fill.apply <json:N chars>` or `fill.check <json:N chars>`.
- Success lines start with `[ok]`.
- Recoverable validation or usage failures start with `[err]`.
- Informational lines start with `[info]`.
- Tables use fixed-width text columns.
- No panels, cards, modal overlays, gradients, or decorative UI.

## Terminal command surface

Read commands:

- `help`
- `/purpose`
- `spec`
- `operator.show [operatorId]`
- `draft.show`
- `item.list`
- `effect.list <itemKey>`
- `fill.task`
- `fill.task.copy`

Create commands:

- `operator.add <operatorId> <name> [weapon=] [potential=满潜|0潜] [skillLevel=M3|L9]`
- `item.add <itemKey> <name> [sourceName=] [desc=]`
- `effect.add <itemKey> <effectKey> type=<modifierType> value=<number> [name=] [display=] [desc=] [condition=]`

Update commands:

- `draft.rename <name>`
- `item.set <itemKey> [name=] [sourceName=] [desc=]`
- `effect.set <itemKey> <effectKey> [type=] [value=] [name=] [display=] [desc=] [condition=]`

Delete commands:

- `operator.delete <operatorId>`
- `item.delete <itemKey>`
- `effect.delete <itemKey> <effectKey>`

AI workflow commands:

- `fill.source <text>`
- `fill.task`
- `fill.task.copy`
- `fill.check <BuffFillAiDraft JSON>`
- `fill.apply <BuffFillAiDraft JSON>`

Command parsing:

- Tokens are separated by whitespace.
- Use quotes for values containing spaces: `item.add item-1 "测试天赋" desc="长描述"`.
- Option format is `key=value`.
- Percent values must already be decimal numbers, for example `0.2`, not `20%`.

## External agent contract

The agent must output only one JSON object. No Markdown, no explanation.

Root shape:

```ts
interface BuffFillAiDraft {
  id: string;
  name: string;
  sourceName: string;
  source: string;
  description: string;
  items: BuffFillAiItem[];
}
```

Item shape:

```ts
interface BuffFillAiItem {
  name: string;
  sourceName: string;
  description: string;
  effects: BuffFillAiEffect[];
}
```

Effect shape:

```ts
interface BuffFillAiEffect {
  displayName: string;
  name: string;
  level: string;
  source: string;
  sourceName: string;
  description: string;
  condition: string;
  effectKind: 'modifier' | 'extraHit';
  type: string;
  value: number;
  evidenceText: string;
  confidence: number;
}
```

Rules:

- `modifier.type` must be in the catalog.
- `extraHit.type` must be `""`.
- `extraHit.value` must be `0`.
- `value` must be a number, not a string like `"20%"`.
- Use `0.2` for `20%`.
- Drop unsupported effects instead of inventing fields.
- Keep `evidenceText` copied from the source text.

## App validation rules

The app must reject:

- Empty response
- Invalid JSON
- Missing root fields
- Non-array `items`
- Non-array `effects`
- Unknown `effectKind`
- Unknown modifier type
- Invalid extra hit config
- Confidence outside `0..1`

## Apply behavior

When applying a valid result:

- Keep current draft `id`, `name`, `sourceName`, and `source`.
- Use the AI result `description` only when it is non-empty.
- Replace current draft `items` with validated converted items.
- Write:
  - `def.buff-editor.draft.v1`
  - `def.buff-editor.library.v1`
- Add one undo entry to `def.buff-editor.undo.v1`.
- Tell the user to reopen or navigate to the Buff editor if the current page does not live-refresh.

Operator fixture behavior:

- `operator.add` writes `def.operator-config.character-input-map.v3` in `sessionStorage`.
- `operator.add` also appends the operator id to `def.selected-characters.v1` in `sessionStorage`.
- `operator.delete` removes both the input-map entry and the selected-character id.
- These commands are for AI CLI fixture setup and smoke testing, not a replacement for the full Operator editor.

## Done checklist

- `/ai-cli` route opens a usable page.
- UI is terminal-like: text output stream plus command input.
- Web main navigation exposes an `AI CLI` entry; desktop navigation renders it disabled.
- Page can copy a `buff.fill` task package.
- `operator.add`, `operator.show`, `operator.delete`, `draft.show`, `item.add`, `item.set`, `item.delete`, `effect.add`, `effect.set`, `effect.delete` run from the command input.
- `help`, `/purpose`, and `spec` document the exposed surface in the terminal itself.
- `fill.check` validates valid and invalid payloads without writing.
- Page can parse and validate `fill.apply <BuffFillAiDraft JSON>`.
- Page shows errors in the terminal output when validation fails.
- Page can apply valid output to the current Buff draft with an undo snapshot.
- Playwright smoke test covers operator setup, CRUD, `fill.check`, and `fill.apply`.
