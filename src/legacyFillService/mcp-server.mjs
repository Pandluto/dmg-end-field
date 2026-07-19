import * as z from 'zod/v4';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  LEGACY_FILL_DOMAINS,
  LEGACY_FILL_MCP_RESOURCE_TEMPLATES,
  LegacyFillMcpError,
} from './mcp-operations.mjs';

const domain = z.enum(LEGACY_FILL_DOMAINS);
const ownerNamespace = z.string().min(3).max(160);
const snapshotIdentity = z.object({
  snapshotId: z.string().min(1).max(240),
  revision: z.number().int().min(1),
  contentHash: z.string().min(16).max(256),
});
const errorShape = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
const outputSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: errorShape.optional(),
});

function jsonResult(structuredContent, isError = false) {
  return {
    isError,
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function errorResult(error) {
  const structured = {
    ok: false,
    error: {
      code: typeof error?.code === 'string' ? error.code : 'legacy-fill-mcp-error',
      message: error instanceof Error ? error.message : String(error),
      ...(error?.details === undefined ? {} : { details: error.details }),
    },
  };
  return jsonResult(structured, true);
}

function wrapTool(handler) {
  return async (input) => {
    try {
      return jsonResult({ ok: true, data: await handler(input) });
    } catch (error) {
      return errorResult(error);
    }
  };
}

function resourceObject(uri) {
  return { uri, name: uri, mimeType: 'application/json' };
}

function matchesTemplate(template, uri) {
  const parsed = new URL(uri);
  if (template.includes('snapshot/{snapshotId}/{domain}/current')) return parsed.hostname === 'snapshot' && parsed.pathname.endsWith('/current');
  if (template.includes('snapshot/{snapshotId}/{domain}/library')) return parsed.hostname === 'snapshot' && parsed.pathname.endsWith('/library');
  if (template.includes('schema/{schemaVersion}/{domain}')) return parsed.hostname === 'schema';
  if (template.includes('template/{schemaVersion}/{domain}')) return parsed.hostname === 'template';
  if (template.includes('guides/strategy/{guideVersion}')) return parsed.hostname === 'guides';
  if (template.includes('examples/{fixtureVersion}/{domain}')) return parsed.hostname === 'examples';
  if (template.includes('/review')) return parsed.hostname === 'proposals' && parsed.pathname.endsWith('/review');
  if (template.includes('/status')) return parsed.hostname === 'proposals' && parsed.pathname.endsWith('/status');
  return false;
}

export function createLegacyFillMcpServer({ operations, ownerNamespace: authenticatedOwner }) {
  const server = new McpServer({
    name: 'legacy-fill-service',
    version: '1.0.0',
  }, {
    capabilities: {},
    instructions: 'Read Host-published fill snapshots, validate drafts, and create/review proposals. Approval and product storage writes are Host-only and are not MCP capabilities.',
  });

  server.registerTool('fill_get_current', {
    title: 'Get current fill draft',
    description: 'Read the latest or specified Host-published current draft. Never reads DEF checkout state.',
    inputSchema: { domain, snapshotId: z.string().min(1).max(240).optional() },
    outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, wrapTool((input) => operations.getCurrent(input)));

  server.registerTool('fill_search_library', {
    title: 'Search fill library snapshot',
    description: 'Search one immutable Host-published library snapshot with stable cursor pagination.',
    inputSchema: {
      domain,
      query: z.string().max(200).default(''),
      cursor: z.string().max(500).optional(),
      limit: z.number().int().min(1).max(100).default(25),
      snapshotId: z.string().min(1).max(240).optional(),
      inspectId: z.string().min(1).max(240).optional(),
    },
    outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, wrapTool((input) => operations.searchLibrary(input)));

  server.registerTool('fill_get_template', {
    title: 'Get fill schema and template',
    description: 'Return the core-generated schema/template; strategy remains separately versioned.',
    inputSchema: { domain, schemaVersion: z.number().int().min(1).optional() },
    outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, wrapTool((input) => operations.getTemplate(input)));

  server.registerTool('fill_validate', {
    title: 'Validate a fill draft',
    description: 'Normalize and validate a draft without creating a proposal or writing product storage.',
    inputSchema: {
      domain,
      draft: z.unknown(),
      schemaVersion: z.number().int().min(1),
      baseSnapshot: snapshotIdentity.optional(),
    },
    outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, wrapTool((input) => operations.validate(input)));

  server.registerTool('proposal_create', {
    title: 'Create fill proposal',
    description: 'Revalidate and create an idempotent review proposal. Does not approve, save, or write product storage.',
    inputSchema: {
      ownerNamespace,
      idempotencyKey: z.string().min(1).max(240),
      domain,
      schemaVersion: z.number().int().min(1),
      baseSnapshot: snapshotIdentity,
      draft: z.unknown(),
      intent: z.string().max(2000).optional(),
      evidence: z.array(z.object({ label: z.string().min(1).max(240), text: z.string().max(10_000), source: z.string().max(500).optional() })).max(20).optional(),
    },
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, wrapTool((input) => operations.createProposal(authenticatedOwner, input)));

  server.registerTool('proposal_list', {
    title: 'List fill proposals',
    description: 'List proposals belonging to the authenticated owner only.',
    inputSchema: {
      ownerNamespace,
      status: z.enum(['pending', 'claimed', 'approved', 'rejected', 'applied', 'cancelled', 'stale']).optional(),
      domain: domain.optional(),
      cursor: z.string().max(500).optional(),
      limit: z.number().int().min(1).max(100).default(25),
    },
    outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, wrapTool((input) => operations.listProposals(authenticatedOwner, input)));

  server.registerTool('proposal_inspect', {
    title: 'Inspect fill proposal',
    description: 'Read the complete review manifest, validation and audit summary without claiming or deciding it.',
    inputSchema: {
      ownerNamespace,
      proposalId: z.string().min(1).max(240),
      expectedRevision: z.number().int().min(1).optional(),
    },
    outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, wrapTool((input) => operations.inspectProposal(authenticatedOwner, input)));

  for (const [index, template] of LEGACY_FILL_MCP_RESOURCE_TEMPLATES.entries()) {
    server.registerResource(`legacy-fill-resource-${index + 1}`, new ResourceTemplate(template, {
      list: async () => ({
        resources: (await operations.listResources(authenticatedOwner)).filter((uri) => matchesTemplate(template, uri)).map(resourceObject),
      }),
    }), {
      title: template,
      description: 'Versioned, path-free Legacy Fill resource',
      mimeType: 'application/json',
    }, async (uri) => {
      try {
        const value = await operations.readResource(authenticatedOwner, uri.href);
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(value) }] };
      } catch (error) {
        if (error instanceof LegacyFillMcpError || error instanceof Error) throw error;
        throw new Error(String(error));
      }
    });
  }

  return server;
}
