# Task 12 Fix 1: Correct proposal.approve effects/storage audit

## Background

Task 12 moved `*.fill.apply` into a proposal-first flow.

After a proposal is created, `proposal.approve` calls the domain adapter's `applyToWorkingState` method. This does not write the domain library/local truth, but it does update the active working draft:

- Buff approval writes `def.buff-editor.draft.v1`.
- Weapon approval writes `def.weapon-sheet.draft.v1`.

The current response still uses the default:

```ts
effects: { writes: false, storage: [] }
```

This makes the operation log inaccurate: the approve command mutates working state but is logged as a non-writing command with no touched storage.

## Goal

Make `proposal.approve` report working-state writes accurately while preserving the proposal-first boundary:

- `proposal.approve` may write only the active draft / working state.
- `proposal.approve` must not write the domain library/local truth.
- `proposal.save` remains the only step that writes the domain library/local truth.

## Scope

Modify:

- `src/aiCli/aiCliCommandService.ts`
- `src/aiCli/aiCliCommandService.test.ts`

Do not modify:

- `proposal.save` semantics
- `fill.apply` semantics
- domain library save behavior
- REST approval blocking behavior

## Required Behavior

### Buff proposal.approve

When approving a Buff proposal:

```ts
effects: {
  writes: true,
  storage: [BUFF_DRAFT_STORAGE_KEY],
}
```

Acceptance criteria:

- `ok === true`
- `proposal.approval === 'Yes'`
- `proposal.save === 'Wait'`
- `effects.writes === true`
- `effects.storage` contains `def.buff-editor.draft.v1`
- `effects.storage` does not contain `def.buff-editor.library.v1`

### Weapon proposal.approve

When approving a Weapon proposal:

```ts
effects: {
  writes: true,
  storage: [WEAPON_DRAFT_STORAGE_KEY],
}
```

Acceptance criteria:

- `ok === true`
- `proposal.approval === 'Yes'`
- `proposal.save === 'Wait'`
- `effects.writes === true`
- `effects.storage` contains `def.weapon-sheet.draft.v1`
- `effects.storage` does not contain `def.weapon-sheet.library.v1`

### Failure Behavior

If `adapter.applyToWorkingState` fails:

- return `ok: false`
- do not mark `approval=Yes`
- do not return `effects.writes=true`
- keep the proposal state unchanged

## Implementation Notes

In the `proposal.approve` branch:

1. Find the domain adapter as before.
2. Call `adapter.applyToWorkingState(proposal.payload)`.
3. If the adapter call fails, return the existing failure response.
4. After a successful adapter call and successful `approveAgentProposal`, determine the working draft storage key:
   - `proposal.domain === 'buff'` -> `BUFF_DRAFT_STORAGE_KEY`
   - `proposal.domain === 'weapon'` -> `WEAPON_DRAFT_STORAGE_KEY`
5. Include `effects: { writes: true, storage: [draftStorageKey] }` in the success response.

Do not include library keys in approve effects.

## Tests

Add or update tests in `src/aiCli/aiCliCommandService.test.ts`.

Required assertions:

1. Buff `proposal.approve`:
   - returns `ok: true`
   - returns `effects.writes === true`
   - includes `def.buff-editor.draft.v1`
   - excludes `def.buff-editor.library.v1`
   - library remains unwritten before save

2. Weapon `proposal.approve`:
   - create a `weapon.fill.apply` proposal
   - approve it
   - returns `ok: true`
   - returns `effects.writes === true`
   - includes `def.weapon-sheet.draft.v1`
   - excludes `def.weapon-sheet.library.v1`
   - weapon library remains unwritten before save

## Verification

Run:

```sh
npm run build
node scripts/run-ts-test.mjs src/aiCli/aiCliCommandService.test.ts
node scripts/run-ts-test.mjs src/aiCli/aiCliAgentInfrastructure.test.ts
npm run smoke:ai-cli-rest
```

All commands must pass.

## Done Criteria

- `proposal.approve` audit effects accurately reflect working draft writes.
- `proposal.approve` still does not write library/local truth.
- `proposal.save` remains the library/local truth write step.
- Buff and Weapon approval paths are both covered by tests.
- Build, unit tests, and REST smoke pass.
