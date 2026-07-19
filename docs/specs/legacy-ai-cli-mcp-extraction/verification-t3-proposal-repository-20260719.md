# T3 Isolated Proposal Repository Verification

Date: 2026-07-19

`src/legacyFillService/proposal-repository.mjs` owns a dedicated SQLite database. It has
no import, token, path, table, or foreign key relationship with DEF OpenCode, Timeline
Repository, or Work Node storage.

## Contract evidence

`npm run test:legacy-fill-repository` passed and covered:

- all five required tables and transactional schema migration;
- injected migration failure leaving no partial `fill_*` schema;
- WAL, foreign keys, and configured busy timeout;
- restart persistence and two repository connections;
- owner-scoped list/inspect isolation;
- same-owner idempotency duplicate and different-digest conflict;
- expected-revision CAS success and conflict;
- transaction rollback after a state constraint failure;
- stale-base state without any product write;
- append-only audit ordering plus update/delete triggers;
- deterministic request/review manifest digests;
- auditable export without direct external DB access.

Additional regression results:

- `npm run smoke:work-node-sqlite`: pass;
- `npm run test:def-core-baseline`: pass, frozen hashes unchanged;
- `npm run typecheck`: pass;
- `npm run check:repo`: pass (`tracked=6773 syntax=80 docs=21 images=524`).

These DEF checks were repository regressions only. No MCP path or proposal repository
call entered DEF OpenCode, and the running desktop instance was not restarted or used.
