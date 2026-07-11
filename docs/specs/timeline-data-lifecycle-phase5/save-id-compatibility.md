# `saveId` compatibility boundary

`timelineId` is the only document identity used by renderer commands, domain
types, Timeline Repository, and newly-created data.

The legacy name `saveId` remains temporarily in these boundaries only:

- `electron/ai-timeline-work-node-store.cjs`: columns and method arguments of
  the legacy `ai-timeline-worknodes.sqlite3` store.
- `electron/main.cjs` and `scripts/ai-cli-rest-server.mjs`: adapters between
  Timeline Repository/REST input and that legacy store.
- `src/vite-env.d.ts`: deprecated Electron bridge response fields. Renderer
  clients normalize the response to `timelineId` immediately.
- migration, backup/restore, preview and smoke scripts that deliberately read
  historical SQLite rows or JSON archives.

Removal conditions:

1. Legacy Work Node migration is idempotent and records completion.
2. New create, patch, commit, checkout, head and delete operations no longer
   dual-write the legacy store.
3. Backup/restore and Bundle V2 use Timeline Repository without consulting the
   old store.
4. A release migration confirms node, commit and checkout counts before the
   old database adapter is disabled.

Do not add `saveId` to renderer/domain types or new command payloads. Any new
occurrence must be confined to an adapter that reads historical data and must
normalize it to `timelineId` before returning to application code.
