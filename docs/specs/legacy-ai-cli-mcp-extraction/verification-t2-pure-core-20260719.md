# T2 pure Legacy Fill core verification — 2026-07-19

## Result

Buff, Weapon, Operator, and Equipment domain types/schema/normalizers/validators now live under `src/legacyFillCore`. Operator and Equipment browser adapters retain only localStorage reads/writes, existing image preservation against browser state, incremental storage merge, and the legacy task-package wrapper.

Operator and Equipment schema/template payloads are created by `createOperatorFillDraftSchema()` and `createEquipmentFillDraftSchema()` in the pure core. Both the domain core schema and legacy adapter task package call those functions; there is no second hand-maintained field schema in the browser adapter.

The direct MCP/runtime architecture remains separate from DEF OpenCode. DEF appears below only as a deterministic regression baseline.

## Commands

```text
npm run typecheck
PASS

npm run legacy-fill-runtime:build
PASS — Node ESM bundle imports without window/Electron/Vite.

npm run test:legacy-fill-core
PASS — static browser/HTTP/MCP/DEF exclusion, deterministic manifest, Operator/Equipment schema-source identity.

npm run test:legacy-fill-wire
PASS — four-domain current/library/template/check/apply/proposal responses; apply writes=false; forbidden approve/save/Y/N unchanged.

npm run test:legacy-fill-mcp
PASS

npm run test:legacy-fill-curated
PASS — versioned fixtures validate through the extracted runtime.

npm run test:def-core-baseline
PASS — registry/schema/route hashes unchanged.
```

## Rollback

Move the pure Operator/Equipment definitions back into their adapters and restore the previous imports. Storage keys, proposal database, compatibility proxy, snapshots, and product data require no migration or rollback.
