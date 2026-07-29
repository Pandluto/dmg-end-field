# Security Policy

## Reporting

Please use GitHub private vulnerability reporting. Include the affected version or commit, browser, minimal reproduction, impact, and whether the report concerns the access gate, browser database, package verification, import/export, or cross-tab writer lease.

If GitHub is unavailable, contact `190052366@qq.com` without attaching live credentials or private user exports.

## Supported versions

Security fixes target `main` and the latest published Web LTS release. Older experimental branches are not maintained as separate security releases.

## Security assumptions

- Private timelines and custom assets remain in the browser profile unless the user explicitly exports them.
- SQLite WASM/OPFS and Cache Storage inherit the browser profile’s confidentiality and deletion model.
- The 30-day `zmd` client-side gate is a local deployment convenience. Its verifier is shipped to the browser and it is not strong authentication.
- A public or shared deployment that needs real access control must add HTTPS and server-side authentication before the static app.
- Resource packages are accepted only after their declared size and SHA-256 hashes match.
- Only one tab holds the writer lease. Takeover is explicit, but a malicious same-origin script is outside that boundary.
- Imported JSON, SQLite backups and images are untrusted inputs and must remain schema-, path- and size-validated.

See [security boundaries](./docs/architecture/security-boundaries.md) for the full model.
