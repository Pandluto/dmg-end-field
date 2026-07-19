---
name: akedatabase-fill-tool
description: Boundary notice for legacy AKEDatabase fill requests; the replacement is a direct external Codex MCP connection, not a DEF OpenCode capability.
slash: false
---

# akedatabase-fill-tool

This skill is a temporary compatibility notice only. It does not provide a fill protocol or a tool route inside DEF OpenCode.

## Boundary

- Legacy Fill MCP is a separate local service for Codex and standard MCP clients.
- DEF OpenCode does not register, host, proxy, or call that MCP server.
- Never translate a fill request into a DEF typed tool, Work Node mutation, permission question, Timeline event, or DEF session action.
- Never use the old REST scripts, copied schema prose, or historical request JSON as a protocol source.

## What to tell the user

For fill work, direct the user to connect Codex to the standalone `legacy-fill-service` MCP configuration documented by the desktop product. The external Codex workflow is:

1. read a versioned snapshot/schema/template resource;
2. call `fill_validate`;
3. call `proposal_create` with a stable idempotency key;
4. let the real user review and save in the Electron Host page.

MCP cannot approve, reject, save, write storage, read arbitrary files, execute scripts, or proxy DEF tools. Do not attempt to perform these steps from this DEF runtime Skill.

The copied legacy protocol/schema references were removed. This notice should itself be removed in a separately confirmed retirement once no historical prompt depends on the Skill name; see `references/removal-proposal.md`.
