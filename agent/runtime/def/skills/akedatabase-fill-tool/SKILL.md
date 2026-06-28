---
name: akedatabase-fill-tool
description: Use the installed AKEDatabase agent fill data tool reference for DEF operator, weapon, equipment, check, apply, and proposal workflows.
slash: false
---

# akedatabase-fill-tool

Use this skill when the task needs the external AKEDatabase fill-data tool knowledge base.

Installed source:

`C:\Users\zsk86\Desktop\AKEDatabase-main\agent填表数据工具`

Trust order:

1. Current app adapters in `C:\Users\zsk86\Desktop\dmg\dmg-end-field\src\aiCli`.
2. `GET /api/ai-cli/spec`.
3. This installed skill.
4. Historical examples and scripts in the installed source directory.

Core rules:

- Prefer structured REST fill endpoints over command-string emulation.
- `fill.check` validates only.
- `fill.apply` creates a proposal only.
- Proposal approval and save stay in Web CLI `/ai-cli`.
- Do not direct-write application storage.
- Do not expose implementation details to shallow users unless asked.

Reference files copied from the installed source:

- `references/CLAUDE.md`: current truth manual from the external tool directory.
- `references/golden-examples.md`: examples for common correct fills and mistakes.

When using this skill, load only the relevant section from the references and produce a compact next action or draft proposal.
