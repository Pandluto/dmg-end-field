# Contributing

## Environment

- Node.js 24.x
- npm 11.x
- Bun 1.3.14 only when building vendored OpenCode/runtime packages

Install the root workspace with the committed npm lockfile:

```bash
npm ci
npm run check
```

The repository uses one root package manager. Do not add `pnpm-lock.yaml` or `yarn.lock`. The vendored OpenCode workspace keeps its own `bun.lock` and must be treated as an upstream boundary.

## Change discipline

1. Keep product facts in product data/repositories, not Harness prompts.
2. Keep developer-only Skills under `.agents/skills/`; DEF runtime Skills belong under `agent/runtime/def/skills/` and must not cross-reference the developer directory.
3. A mutation requires typed prepare, native approval, revision/CAS protection and postcondition evidence.
4. Update the relevant Spec verification for behavior changes. Cross-Spec architectural changes also update `docs/architecture/` or add an ADR.
5. Do not commit local session transcripts, tokens, `.runtime/`, build outputs or machine-absolute paths.

## Verification

`npm run check` is the deterministic merge gate. DEF Agent, typed tool, Harness and persistence changes additionally require the [native blackbox route](./docs/testing/def-agent-blackbox.md). Record what was actually observed; a package check or mock is not a native replay.

Release packaging and manual desktop validation are described in [CI/CD](./docs/architecture/ci-cd.md) and the [verification matrix](./docs/architecture/verification-matrix.md).
