# Contributing

## Environment

- Node.js 24.x
- npm 11.x

Install the root workspace with the committed npm lockfile:

```bash
npm ci
npm run check
```

The repository uses one root package manager. Do not add `pnpm-lock.yaml` or `yarn.lock`.

## Change discipline

1. Keep product facts in product data and repositories, not UI fallbacks.
2. Preserve SQLite workspace identity, revision/CAS checks and visible postconditions when changing checkout or restore flows.
3. Update the relevant Spec verification for behavior changes. Cross-Spec architectural changes also update `docs/architecture/` or add an ADR.
4. Do not add Electron, localhost bridges, server-side user storage or old desktop database migration paths.
5. Do not commit local user data, image package archives, `.runtime/`, build outputs or machine-absolute paths.

## Verification

`npm run check` is the deterministic merge gate. Browser SQLite, data-package, PWA and single-writer changes should additionally be exercised in a real Chromium session and record what was actually observed.

Local packaging and browser validation are described in [CI/CD](./docs/architecture/ci-cd.md) and the [verification matrix](./docs/architecture/verification-matrix.md).
