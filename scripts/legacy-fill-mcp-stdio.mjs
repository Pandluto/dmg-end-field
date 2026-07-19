#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createLegacyFillMcpServer } from '../src/legacyFillService/mcp-server.mjs';
import { LegacyFillMcpError } from '../src/legacyFillService/mcp-operations.mjs';

function loadConfig() {
  const configPath = path.resolve(process.env.LEGACY_FILL_MCP_CLIENT_CONFIG || path.resolve('.runtime', 'legacy-fill-service', 'mcp-client.json'));
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (config?.contract !== 'LegacyFillMcpClientConfigV1' || typeof config.url !== 'string'
    || typeof config.token !== 'string' || typeof config.ownerNamespace !== 'string') {
    throw new TypeError('Legacy Fill MCP client config is invalid');
  }
  return config;
}

function remoteError(result) {
  const structured = result?.structuredContent;
  if (structured?.ok === false) throw new LegacyFillMcpError(structured.error?.code || 'remote-tool-error', structured.error?.message || 'Remote Legacy Fill MCP tool failed', structured.error?.details);
  if (structured?.ok !== true) throw new LegacyFillMcpError('invalid-remote-result', 'Remote Legacy Fill MCP tool did not return structured output');
  return structured.data;
}

async function listAllResources(client) {
  const resources = [];
  let cursor;
  do {
    const result = await client.listResources(cursor ? { cursor } : undefined);
    resources.push(...result.resources.map((resource) => resource.uri));
    cursor = result.nextCursor;
  } while (cursor);
  return resources;
}

async function main() {
  const config = loadConfig();
  const remote = new Client({ name: 'legacy-fill-stdio-facade', version: '1.0.0' }, { capabilities: {} });
  const remoteTransport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers: { Authorization: `Bearer ${config.token}` } },
  });
  await remote.connect(remoteTransport);
  const resourceUris = await listAllResources(remote);
  const call = async (name, args) => remoteError(await remote.callTool({ name, arguments: args }));
  const proxyOperations = {
    getCurrent: (input) => call('fill_get_current', input),
    searchLibrary: (input) => call('fill_search_library', input),
    getTemplate: (input) => call('fill_get_template', input),
    validate: (input) => call('fill_validate', input),
    createProposal: (_owner, input) => call('proposal_create', input),
    listProposals: (_owner, input) => call('proposal_list', input),
    inspectProposal: (_owner, input) => call('proposal_inspect', input),
    listResources: async () => resourceUris,
    readResource: async (_owner, uri) => {
      const result = await remote.readResource({ uri });
      const content = result.contents[0];
      if (!content || typeof content.text !== 'string') throw new LegacyFillMcpError('invalid-remote-resource', 'Remote resource did not contain JSON text');
      return JSON.parse(content.text);
    },
  };
  const server = createLegacyFillMcpServer({ operations: proxyOperations, ownerNamespace: config.ownerNamespace });
  const stdio = new StdioServerTransport();
  await server.connect(stdio);
  process.once('SIGTERM', () => void Promise.allSettled([server.close(), remote.close()]).finally(() => process.exit(0)));
  process.once('SIGINT', () => void Promise.allSettled([server.close(), remote.close()]).finally(() => process.exit(0)));
}

main().catch((error) => {
  process.stderr.write(`[legacy-fill-mcp-stdio] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
