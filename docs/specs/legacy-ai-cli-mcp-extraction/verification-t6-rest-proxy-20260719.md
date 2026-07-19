# T6 Legacy REST Single-Writer Proxy Verification

Date: 2026-07-19

`17321` retains only a narrow compatibility proxy for the four fill domains,
`/api/ai-cli/spec`, and proposal list/show/clear/forbidden commands. DEF routes are
resolved first by the local DEF router and cannot fall through to `17323`.

## Single fact source

- The compatibility service loads a prebuilt Node bundle, not Vite SSR at request time.
- check is read-only; apply validates again and writes exactly one row to
  `legacy-fill.sqlite3`.
- owner is the compatibility namespace; requestId is the idempotency key and client is
  retained as evidence.
- Same requestId and digest returns the same proposal even while it is pending.
- A different request while pending returns `409 pending-proposals-blocking`.
- clear appends a compatibility-cancel audit event and sets No/No; it does not approve,
  save, or delete audit history.
- service timeout/unavailability returns `503 legacy-fill-service-unavailable`; the old
  localStorage writer is not used as a fallback.

## Evidence

`npm run test:legacy-fill-wire` passed through two real child processes (`17321` proxy +
isolated fill service) for all four current/library/template/check/apply flows,
idempotent retry, pending block, list/show/clear, and REST approve/reject/save/unsave/Y/N
denial. Every reported proposal list count remained one. A DEF route-map request left the
service compatibility request counter unchanged.

Also passed:

- proposal repository contract;
- DEF router/baseline/binding/current/raw-route/approval contracts;
- Work Node SQLite/REST/backup/migration smoke;
- TypeScript check and repository check (`tracked=6784 syntax=84 docs=21 images=524`).

No MCP client is routed through DEF. The compatibility proxy is only the temporary old
REST surface; the next phase exposes MCP directly from the isolated service.
