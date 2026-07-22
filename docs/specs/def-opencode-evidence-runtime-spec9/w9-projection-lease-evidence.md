# W9 Harness projection lease evidence

Baseline: `codex/def-opencode-spec9@e6d08bb`.

This package adds two development-only Harness read modes without weakening the
ordinary Workbench canonical-current gate.

- `clone-current` provisions a hidden fixture and an in-memory
  `HarnessReadProjectionLeaseV1`. The synthetic `harness-fixture` projection
  is used only inside the gate; it never writes the visible Canvas mirror.
- `active-current-readonly` creates a fresh binding to the real visible
  checkout. Activation blocks before provider ingress if the formal owner or
  visible projection cannot prove that candidate session. Its
  `HarnessReadSessionPolicyV1` permits only Scenario-derived, explicitly
  audited read tools.
- Provision and activation require both the development enable flag and the
  internal governance token. The provision token is one-shot and is never
  emitted in runner or model-visible output. Native Harness and AgentRelease
  commitments are read from the sealed native session file, registered over
  internal transport, and consumed on activation.
- Cleanup revokes before native cleanup and fixture deletion. Lease/policy
  state is process-local: restart, expiry, revocation, mismatch, or a failed
  cleanup retry all fail closed.

Focused evidence:

```text
npm run test:def-harness-projection
npm run test:def-workbench-current-gate
npm run test:def-interop-snapshot-auth
npm run test:def-workbench-tool-policy
git diff --check
```

No provider was invoked and no long-running development service was started or
restarted by this package.
