# Security Policy

## Reporting

Please use GitHub private vulnerability reporting for this repository. Do not open a public issue containing provider credentials, bearer tokens, native session transcripts, user data or a working local exploit.

Include the affected version/commit, platform, minimal reproduction, impact and whether the report involves the loopback bridge, typed mutation tools, Work Node persistence, Harness promotion or packaged application.

## Supported versions

Security fixes target `main` and the latest published release. Older development snapshots are not maintained as separate security branches.

## Security assumptions

- Local services bind to loopback and are not designed for LAN/public exposure.
- Observation APIs and mutation APIs require the local authorization boundary; localhost alone is not authentication.
- Agent mutations must retain native approval, capability binding, revision CAS and postcondition checks.
- CI release artifacts are unsigned drafts unless the release notes explicitly state signing/notarization status.

See the full [security boundary and known-risk record](./docs/architecture/security-boundaries.md).
