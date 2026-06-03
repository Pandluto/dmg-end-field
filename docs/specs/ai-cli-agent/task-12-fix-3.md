# Task 12 Fix 3: Weapon CRUD and source-data read surface

## Background

Task 12 introduced the horizontal fill/proposal framework and connected `weapon.fill.task/check/apply`.

The current Weapon branch is not yet equivalent to the Buff branch. Buff already has a practical command and REST surface for agents to inspect existing business state before proposing changes:

- `buff.list`
- `buff.show <id>`
- `buff.search <keyword>`
- `draft.show`
- Buff REST current/library/template/check/apply endpoints
- `fill.source <text>` source input path

Weapon currently only exposes the fill tail:

- `weapon.fill.task`
- `weapon.fill.check`
- `weapon.fill.apply`

This means an external agent can be asked to fill a weapon such as `赫拉芬格`, but the harness does not provide a stable app-controlled way to read the actual weapon data from:

- `public/data/weapons/<weapon>/<weapon>.json`
- `public/data/weapons/<weapon>/<weapon>max.json`
- `public/data/weapons/<weapon>/<weapon>buff.json`
- `public/data/weapons/<weapon>/<weapon>.md`
- `public/data/weapons/weapons-list.json`

As a result, agents either guess, rely on filesystem access outside the app contract, or produce proposals based only on the current draft and a small library summary.

## Goal

Complete the Weapon domain read/CRUD surface so it follows the same harness shape as Buff:

- Agents can list/search/show local Weapon library entries.
- Agents can inspect the current Weapon working draft.
- Agents can open a library Weapon into the working draft.
- Agents can read official/static Weapon source data by name or id.
- `weapon.fill.task` advertises the source-data read path and includes a source data index.
- `weapon.fill.check/apply` remains proposal-first and does not write library/local truth.

This fix closes the missing business loop:

```text
read source weapon data -> generate WeaponFillAiDraft -> check -> apply proposal -> user approve -> user save
```

## Non-goals

Do not implement:

- `operator.fill` or `equipment.fill`.
- A new general file browser.
- External agent direct writes to `def.weapon-sheet.*`.
- Automatic approval or save from REST/Codex/Claude.
- Hidden undo behavior for Weapon.
- New visual UI for Weapon CRUD beyond the existing Web CLI output.
- A permanent `url/sourceUrl/referenceUrl` field unless the Sheet-Weapon model is explicitly expanded in a separate spec.

## Scope

Modify as needed:

- `src/aiCli/aiCliCommandService.ts`
- `src/aiCli/aiCliRestAdapter.ts`
- `src/aiCli/weaponFillAdapter.ts`
- new or existing Weapon data helper module under `src/aiCli` or `src/utils`
- `src/aiCli/aiCliCommandService.test.ts`
- REST smoke scripts if needed
- `docs/ai-cli-agent-spec.md`
- `docs/specs/ai-cli-agent/tasks.md`

Do not change:

- proposal approval/save state machine
- REST approval/save blocking behavior
- Buff command semantics
- Buff storage keys
- Weapon save boundary: only `proposal.save` writes `def.weapon-sheet.library.v1`

## Data Sources

### App Weapon library

Weapon local truth remains:

```text
def.weapon-sheet.library.v1
```

Weapon working draft remains:

```text
def.weapon-sheet.draft.v1
```

### Official/static Weapon source data

The static source data lives under:

```text
public/data/weapons/
```

Required known files:

```text
public/data/weapons/weapons-list.json
public/data/weapons/<weapon-name>/<weapon-name>.json
public/data/weapons/<weapon-name>/<weapon-name>max.json
public/data/weapons/<weapon-name>/<weapon-name>buff.json
public/data/weapons/<weapon-name>/<weapon-name>.md
```

Some file names may contain punctuation or historical inconsistencies. The implementation must not assume every weapon folder has every file.

For example, a read response for `赫拉芬格` should include whichever of these files exist and clearly mark missing files.

## Required CLI Commands

### 1. `weapon.list [limit]`

List app local Weapon library entries from `def.weapon-sheet.library.v1`.

Expected output:

```text
id  name  rarity  type  skills  effects
```

Requirements:

- Read-only command.
- Does not read official/static data.
- Empty library returns a clear `[info] no weapon library entries` line.
- `limit` defaults to a reasonable number such as `20`.

### 2. `weapon.search <keyword>`

Search app local Weapon library entries and official/static source index.

Requirements:

- Read-only command.
- Search by id, name, type, pinyin-friendly text if an existing helper is available.
- Results must identify source:
  - `library`
  - `official`
- If both library and official data match the same weapon, show both or show one row with both source labels.

### 3. `weapon.show <id|name>`

Read one app local Weapon library entry.

Requirements:

- Read-only command.
- Returns the full normalized Weapon draft payload in `data`.
- Lines should include a compact summary.
- If no local library entry matches, suggest `weapon.data.show <name>` for official/static source data.

### 4. `weapon.draft.show`

Read current Weapon working draft from `def.weapon-sheet.draft.v1`.

Requirements:

- Read-only command.
- Returns full draft in `data`.
- Must use the same fallback behavior as `weapon.fill.task`.

### 5. `weapon.open <id|name>`

Open a local library Weapon into the working draft.

Requirements:

- Write command because it updates `def.weapon-sheet.draft.v1`.
- Must not write `def.weapon-sheet.library.v1`.
- Must be blocked for readonly external clients.
- Web CLI / trusted writer behavior should follow existing permission rules.
- Response effects:

```ts
effects: {
  writes: true,
  storage: ['def.weapon-sheet.draft.v1']
}
```

### 6. `weapon.data.list [limit]`

List official/static Weapon source index from `public/data/weapons/weapons-list.json` plus discovered folders if needed.

Requirements:

- Read-only command.
- Returns `data.weapons` array.
- Each row should include:
  - `name`
  - `id` if available
  - `folder`
  - available file flags: `base/max/buff/md`
- Must not require browser localStorage.
- Must work in REST/server context where filesystem data is available.

### 7. `weapon.data.show <id|name>`

Read official/static Weapon source data for one weapon.

Requirements:

- Read-only command.
- Supports names such as `赫拉芬格`.
- Returns a structured `data` object:

```ts
{
  name: string;
  folder: string;
  files: {
    base?: unknown;
    max?: unknown;
    buff?: unknown;
    markdown?: string;
  };
  missingFiles: string[];
}
```

- Lines should summarize available and missing files.
- Must not mutate `def.weapon-sheet.draft.v1` or `def.weapon-sheet.library.v1`.
- If multiple matches exist, return `ok:false` and list candidates.
- If no match exists, return `ok:false` and suggest `weapon.data.list` or `weapon.search <keyword>`.

## REST Requirements

Add REST endpoints that call the same command service or shared helpers.

Required endpoints:

```text
GET /api/weapon/current
GET /api/weapon/library
GET /api/weapon/library/<id-or-name>
GET /api/weapon/data
GET /api/weapon/data/<id-or-name>
```

Behavior:

- REST endpoints are read-only.
- They must not approve/save proposals.
- They must not write `def.weapon-sheet.*`.
- Response shapes should be stable enough for external agents.
- Errors should include an error code and a human-readable message.

Optional but useful:

```text
POST /api/weapon/fill/check
POST /api/weapon/fill/apply
```

If implemented, these must follow the same proposal-first behavior as command `weapon.fill.check/apply`.

## `weapon.fill.task` Changes

Update `weapon.fill.task` so external agents know how to get source data before generating a proposal.

Required `data` additions:

```ts
{
  tool: 'weapon.fill';
  currentDraft: WeaponDraft;
  librarySummary: Array<...>;
  sourceDataIndex: Array<{
    name: string;
    id?: string;
    folder: string;
    files: {
      base: boolean;
      max: boolean;
      buff: boolean;
      markdown: boolean;
    };
  }>;
  sourceReadCommands: {
    list: 'weapon.data.list';
    show: 'weapon.data.show <name>';
  };
  sourceReadRestEndpoints: {
    list: 'GET /api/weapon/data';
    show: 'GET /api/weapon/data/<name>';
  };
}
```

Instruction text must explicitly say:

1. Before generating a `WeaponFillAiDraft` for a named official weapon, call `weapon.data.show <name>` or `GET /api/weapon/data/<name>`.
2. Do not invent weapon data when source data is available through the app.
3. If `imgUrl` is not present in source data, leave `imgUrl` empty.
4. Only `skill3.effects` is preserved by Sheet-Weapon.
5. Use `condition/passive` for Weapon effect category.
6. `weapon.fill.apply` creates a proposal only; it does not save library/local truth.

## Permission Requirements

Read-only clients may run:

```text
weapon.list
weapon.search
weapon.show
weapon.draft.show
weapon.data.list
weapon.data.show
weapon.fill.task
weapon.fill.check
proposal.list
proposal.show
proposal.clear
```

Read-only clients must not run:

```text
weapon.open
weapon.fill.apply
proposal.approve
proposal.reject
proposal.save
proposal.unsave
Y
N
```

`weapon.open` is a working-draft write and must follow the same write permission policy as other write commands.

## Validation and Contract Requirements

Keep the corrected Weapon fill contract:

- `url` is not accepted as an image fallback.
- Missing `imgUrl` becomes `imgUrl: ''`.
- `skill1.effects` and `skill2.effects` are rejected because Sheet-Weapon does not preserve them.
- `skill3.effects.*.category` must be `condition` or `passive`.
- Effect types must come from the Weapon supported effect type list or explicit alias normalization.
- Numeric fields must be numbers, not string numbers.

## Tests

Update or add tests in `src/aiCli/aiCliCommandService.test.ts`.

Required command tests:

1. `weapon.data.list`
   - returns `ok:true`
   - includes `赫拉芬格` or another known weapon from static data
   - returns file availability flags
   - does not write storage

2. `weapon.data.show 赫拉芬格`
   - returns `ok:true`
   - returns available `base/max/buff/markdown` fields when files exist
   - reports missing files without failing if optional files are absent
   - does not write `def.weapon-sheet.draft.v1`
   - does not write `def.weapon-sheet.library.v1`

3. `weapon.list`
   - reads local Weapon library
   - returns empty info when library is empty

4. `weapon.show <id|name>`
   - returns a full local library Weapon entry
   - does not return official/static source data by accident

5. `weapon.draft.show`
   - returns current draft/fallback draft

6. `weapon.open <id|name>`
   - writes only `def.weapon-sheet.draft.v1`
   - does not write `def.weapon-sheet.library.v1`
   - is blocked for readonly clients

7. `weapon.search <keyword>`
   - can find official/static source entries
   - can find local library entries

8. `weapon.fill.task`
   - includes `sourceDataIndex`
   - includes source read commands/endpoints
   - instruction tells agents to read source data first

9. `weapon.fill.check`
   - rejects `url` if the schema disallows extra fields, or ignores it only if the schema explicitly permits unknown fields. The preferred behavior is to reject ambiguous `url`.
   - rejects `skill1.effects`
   - rejects `category: value/effect`
   - accepts `skill3.effects` with `category: condition/passive`

Required REST/smoke tests:

1. `GET /api/weapon/current`
2. `GET /api/weapon/library`
3. `GET /api/weapon/data`
4. `GET /api/weapon/data/赫拉芬格`

Each should return structured JSON and avoid writes.

## Verification

Run:

```sh
npm run build
node scripts/run-ts-test.mjs src/aiCli/aiCliCommandService.test.ts
node scripts/run-ts-test.mjs src/aiCli/aiCliAgentInfrastructure.test.ts
npm run smoke:ai-cli-rest
```

Manual verification:

1. Open `/ai-cli`.
2. Run `weapon.data.show 赫拉芬格`.
3. Confirm the terminal shows available source files.
4. Run `weapon.fill.task`.
5. Confirm task package tells the agent to read weapon source data first.
6. Submit a valid `weapon.fill.apply` payload.
7. Press `Y` to approve and confirm only the working draft is updated.
8. Press `Y` again to save and confirm the Weapon library is updated.

## Done Criteria

- Weapon has a Buff-like read/CRUD command surface.
- External agents can read official/static Weapon source data through the app harness.
- `weapon.fill.task` no longer asks agents to fill weapons blind.
- `weapon.fill.check/apply` stay proposal-first.
- Read-only external clients cannot write or approve/save.
- `赫拉芬格` or another known static weapon can be read through CLI and REST without filesystem guessing.
- Build, command tests, agent infrastructure tests, and REST smoke pass.
