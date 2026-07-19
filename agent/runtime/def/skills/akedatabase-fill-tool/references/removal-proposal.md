# Removal proposal: `akedatabase-fill-tool`

Status: proposed, not executed.

The Skill no longer contains domain knowledge or an executable route. Its only remaining value is to prevent old DEF prompts from mistaking Legacy Fill MCP for a DEF capability.

Remove the Skill in a separately confirmed retirement after:

1. external Codex/standard MCP client configuration is documented and exercised;
2. historical prompt/caller scans show no dependency on the Skill name;
3. a release window confirms the standalone MCP + Electron Host review flow;
4. DEF agent blackbox passes without this compatibility notice.

Removal must not register Legacy Fill MCP in DEF as a substitute.
