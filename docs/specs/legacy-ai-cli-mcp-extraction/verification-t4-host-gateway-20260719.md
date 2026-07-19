# T4 Legacy Fill Host Gateway Verification

Date: 2026-07-19

The browser Host gateway is bootstrapped only after the existing local-data bridge has
finished. It reads the four real product draft/library keys and publishes
`LegacyFillSnapshotV1`; it does not read Timeline, checkout, DEF session, governance,
command queue, or Work Node state.

## Security and write boundary

- Public gateway surface is snapshot publication only.
- Claim, decision, apply, and force-apply invalidation require the exact in-process Host
  authority object.
- Writers select one of four fixed domain mappings and derive the target from the
  normalized proposal. They cannot receive an arbitrary storage key.
- Apply checks Host review approval, proposal revision, manifest digest, live base
  revision/hash, and target identity.
- Writes reread both library and current values; mismatch or writer failure fails closed
  and attempts restoration.
- Success emits one `legacy-fill.library.changed` and republishes a monotonic snapshot.
- A now-storage force-apply invalidation epoch advances all domain identities without
  changing the existing browser-to-now-storage direction.

## Contract evidence

`npm run test:legacy-fill-host` passed, including stable/changed revisions, restricted
authority, approve/apply, stale base, digest mismatch, fixed target, postcondition,
writer rollback, and force-apply invalidation.

Also passed:

- `npm run typecheck`;
- `npm run test:legacy-fill-core`;
- `npm run test:legacy-fill-repository`;
- `npm run test:legacy-fill-wire`;
- `npm run test:def-core-baseline` (all frozen hashes unchanged);
- `npm run check:repo` (`tracked=6777 syntax=81 docs=21 images=524`).

MCP is not implemented or routed here; DEF OpenCode is only a frozen regression hash.
