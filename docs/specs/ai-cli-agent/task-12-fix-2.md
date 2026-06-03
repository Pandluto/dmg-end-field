# Task 12 Fix 2: Complete fill adapter contract and domain lookup

## Background

Task 12 introduced a horizontal fill framework for Buff and Weapon. The current implementation has a working registry keyed by `commandPrefix`, but the adapter contract is still thinner than the Task 12 spec.

Current gaps:

- `AgentFillDomainAdapter` does not expose `workflow`.
- `AgentFillDomainAdapter` does not expose `draftStorageKey`.
- `AgentFillDomainAdapter` does not expose `libraryStorageKey`.
- `AgentFillDomainAdapter` does not expose `summarizeProposal`.
- `proposal.approve` / `proposal.save` find adapters by hardcoded domain-to-prefix mapping:

```ts
proposal.domain === 'buff' ? 'fill' : `${proposal.domain}.fill`
```

This works for Buff and Weapon today, but it makes future `operator.fill` / `equipment.fill` depend on an implicit naming rule instead of the adapter registry.

## Goal

Make the fill adapter contract explicit enough for horizontal domains and remove hardcoded domain-to-prefix lookup from proposal state transitions.

After this fix:

- Each adapter declares its workflow and storage boundaries.
- Proposal approve/save can find an adapter by `proposal.domain`.
- Proposal approve/save no longer need to infer commandPrefix from domain names.
- Existing Buff and Weapon behavior stays unchanged.

## Scope

Modify:

- `src/aiCli/aiCliFillDomains.ts`
- `src/aiCli/buffFillAdapter.ts`
- `src/aiCli/weaponFillAdapter.ts`
- `src/aiCli/aiCliCommandService.ts`
- `src/aiCli/aiCliCommandService.test.ts`

Do not modify:

- proposal payload structure
- proposal storage cleanup policy
- `weapon.fill.task` schema/warning contents
- REST approval blocking behavior

Those are separate follow-up fixes.

## Required Adapter Contract

Update `AgentFillDomainAdapter` to include:

```ts
workflow: AiAgentWorkflow;
draftStorageKey: string;
libraryStorageKey: string;
summarizeProposal(payload: TPayload): string;
```

Expected Buff adapter values:

```ts
domain: 'buff'
workflow: 'buff.fill'
commandPrefix: 'fill'
draftStorageKey: BUFF_DRAFT_STORAGE_KEY
libraryStorageKey: BUFF_LIBRARY_STORAGE_KEY
```

Expected Weapon adapter values:

```ts
domain: 'weapon'
workflow: 'weapon.fill'
commandPrefix: 'weapon.fill'
draftStorageKey: WEAPON_DRAFT_STORAGE_KEY
libraryStorageKey: WEAPON_LIBRARY_STORAGE_KEY
```

## Registry Requirements

Keep the existing commandPrefix registry, and add domain lookup:

```ts
findFillDomainAdapter(commandPrefix: string): AgentFillDomainAdapter | null
findFillDomainAdapterByDomain(domain: AiAgentProposalDomain): AgentFillDomainAdapter | null
```

Implementation can either:

- maintain two maps, one by `commandPrefix` and one by `domain`; or
- derive domain lookup from the registered adapters.

The lookup must not rely on string concatenation like `${domain}.fill`.

## Command Service Requirements

### Fill command responses

Where current code does:

```ts
workflow: adapter.domain === 'weapon' ? 'weapon.fill' : 'buff.fill'
```

replace with:

```ts
workflow: adapter.workflow
```

### Proposal approve/save

Where current code does:

```ts
findFillDomainAdapter(proposal.domain === 'buff' ? 'fill' : `${proposal.domain}.fill`)
```

replace with:

```ts
findFillDomainAdapterByDomain(proposal.domain)
```

### Proposal approve effects

Where current code does:

```ts
const draftStorageKey = proposal.domain === 'weapon' ? WEAPON_DRAFT_STORAGE_KEY : BUFF_DRAFT_STORAGE_KEY;
```

replace with:

```ts
const draftStorageKey = adapter.draftStorageKey;
```

### Proposal save effects

Where current code uses domain-specific arrays, use adapter storage boundaries:

```ts
effects: {
  writes: true,
  storage: [adapter.draftStorageKey, adapter.libraryStorageKey],
}
```

For Buff, keep undo behavior and include `BUFF_UNDO_STORAGE_KEY` in save effects if the Buff adapter still creates an undo snapshot.

## summarizeProposal

Move proposal summary generation behind the adapter contract:

- `buffFillAdapter.summarizeProposal(payload)` should return the same Buff summary currently produced by `createProposalPayload`.
- `weaponFillAdapter.summarizeProposal(payload)` should return the same Weapon summary currently produced by `createProposalPayload`.
- `createProposalPayload` may call `summarizeProposal` internally.

This fix does not require changing the stored proposal payload shape.

## Tests

Add or update tests in `src/aiCli/aiCliCommandService.test.ts`.

Required assertions:

1. `weapon.fill.apply` still sets session `currentWorkflow === 'weapon.fill'`.
2. `proposal.approve` for Weapon uses adapter `draftStorageKey`, returning `def.weapon-sheet.draft.v1`.
3. `proposal.save` for Weapon uses adapter storage keys, returning both:
   - `def.weapon-sheet.draft.v1`
   - `def.weapon-sheet.library.v1`
4. Buff save still includes:
   - `def.buff-editor.draft.v1`
   - `def.buff-editor.library.v1`
   - `def.buff-editor.undo.v1`
5. No code path in `proposal.approve` or `proposal.save` uses hardcoded `${domain}.fill` mapping.

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

- Adapter contract includes workflow and storage boundary fields.
- Buff and Weapon adapters implement the complete contract.
- Proposal approve/save use domain lookup from the registry.
- Proposal approve/save effects use adapter storage boundaries.
- Existing Buff and Weapon behavior remains unchanged.
- Build, unit tests, and REST smoke pass.
