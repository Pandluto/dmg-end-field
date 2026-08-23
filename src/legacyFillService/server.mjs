import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createLegacyFillProposalRepository } from './proposal-repository.mjs';
import { createLegacyFillMcpOperations } from './mcp-operations.mjs';
import { createLegacyFillMcpServer } from './mcp-server.mjs';

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const DOMAINS = ['buff', 'weapon', 'operator', 'equipment'];

function writeJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body too large');
      error.status = 413;
      error.code = 'request-body-too-large';
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch {
    const error = new Error('Request body must be valid JSON');
    error.status = 400;
    error.code = 'invalid-json';
    throw error;
  }
}

function loadVersionedResource(primaryPath, filePattern) {
  const resolvedPrimaryPath = path.resolve(primaryPath);
  const primary = JSON.parse(fs.readFileSync(resolvedPrimaryPath, 'utf8'));
  const directory = path.dirname(resolvedPrimaryPath);
  const history = fs.readdirSync(directory)
    .filter((fileName) => filePattern.test(fileName))
    .sort((left, right) => left.localeCompare(right, 'en'))
    .map((fileName) => path.join(directory, fileName))
    .filter((candidatePath) => path.resolve(candidatePath) !== resolvedPrimaryPath)
    .map((candidatePath) => JSON.parse(fs.readFileSync(candidatePath, 'utf8')))
    .filter((entry) => entry && typeof entry.version === 'string' && entry.version !== primary.version);
  return { primary, history };
}

export function createLegacyFillService(options = {}) {
  const host = options.host || '127.0.0.1';
  const port = Number(options.port || 17323);
  const hostToken = typeof options.hostToken === 'string' ? options.hostToken.trim() : '';
  if (!hostToken) throw new TypeError('LEGACY_FILL_HOST_TOKEN is required');
  const databasePath = path.resolve(options.databasePath);
  const registryPath = options.registryPath ? path.resolve(options.registryPath) : '';
  const repository = createLegacyFillProposalRepository({ databasePath });
  const mcpClients = new Map(Object.entries(options.mcpClients || {}));
  const domainRuntimePath = path.resolve(options.domainRuntimePath || path.resolve('dist', 'legacy-fill', 'domain-runtime.mjs'));
  const onShutdown = typeof options.onShutdown === 'function' ? options.onShutdown : () => undefined;
  const startedAt = new Date().toISOString();
  let domainRuntime = null;
  let domainRuntimeError = '';
  let mcpOperations = null;
  let mcpRequestCount = 0;
  let server;
  let closing = false;

  function health() {
    const snapshots = Object.fromEntries(DOMAINS.map((domain) => [domain, repository.latestSnapshot(domain)]));
    return {
      ok: true,
      service: 'legacy-fill-service',
      protocolVersion: 1,
      pid: process.pid,
      host,
      port,
      startedAt,
      database: repository.diagnostics(),
      domainRuntime: { ready: Boolean(domainRuntime), path: domainRuntimePath, error: domainRuntimeError || null },
      snapshotReady: DOMAINS.every((domain) => Boolean(snapshots[domain])),
      snapshots: Object.fromEntries(DOMAINS.map((domain) => [domain, snapshots[domain] ? {
        snapshotId: snapshots[domain].snapshotId,
        revision: snapshots[domain].revision,
        contentHash: snapshots[domain].contentHash,
        schemaVersion: snapshots[domain].schemaVersion,
      } : null])),
      mcp: mcpOperations && mcpClients.size
        ? { enabled: true, endpoint: '/mcp', authenticatedClients: mcpClients.size, requestCount: mcpRequestCount }
        : { enabled: false },
    };
  }

  function authorized(request) {
    return request.headers['x-legacy-fill-host-token'] === hostToken;
  }

  function validateMcpRequestAuthority(request) {
    const hostHeader = String(request.headers.host || '').toLowerCase();
    const allowedHosts = new Set([`${host}:${port}`.toLowerCase(), `localhost:${port}`, `127.0.0.1:${port}`]);
    if (!allowedHosts.has(hostHeader)) {
      const error = new Error('MCP Host header is not an allowed loopback authority');
      error.status = 403;
      error.code = 'mcp-invalid-host';
      throw error;
    }
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : '';
    if (origin) {
      let parsed;
      try { parsed = new URL(origin); } catch { parsed = null; }
      if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
        const error = new Error('MCP Origin must be absent or loopback');
        error.status = 403;
        error.code = 'mcp-invalid-origin';
        throw error;
      }
    }
    const authorization = String(request.headers.authorization || '');
    const bearer = /^Bearer\s+(.+)$/i.exec(authorization)?.[1] || '';
    const headerToken = typeof request.headers['x-legacy-fill-mcp-token'] === 'string' ? request.headers['x-legacy-fill-mcp-token'] : '';
    const suppliedToken = bearer || headerToken;
    for (const [token, ownerNamespace] of mcpClients) {
      const left = Buffer.from(suppliedToken);
      const right = Buffer.from(token);
      if (left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right)) return ownerNamespace;
    }
    const error = new Error('A valid Legacy Fill MCP client token is required');
    error.status = 401;
    error.code = 'mcp-client-auth-required';
    throw error;
  }

  async function handleMcpRequest(request, response, method) {
    if (!mcpOperations || !mcpClients.size) {
      return writeJson(response, 503, { jsonrpc: '2.0', error: { code: -32001, message: 'Legacy Fill MCP is unavailable' }, id: null });
    }
    const ownerNamespace = validateMcpRequestAuthority(request);
    if (method !== 'POST') {
      response.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }));
      return;
    }
    const body = await readJson(request);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const mcpServer = createLegacyFillMcpServer({ operations: mcpOperations, ownerNamespace });
    mcpRequestCount += 1;
    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(request, response, body);
    } finally {
      response.once('close', () => void mcpServer.close().catch(() => {}));
    }
  }

  function publishSnapshot(payload) {
    if (!payload || payload.contract !== 'LegacyFillSnapshotV1' || !payload.domains || typeof payload.domains !== 'object') {
      const error = new Error('Host snapshot must satisfy LegacyFillSnapshotV1');
      error.status = 400;
      error.code = 'invalid-host-snapshot';
      throw error;
    }
    const published = {};
    for (const domain of DOMAINS) {
      const incoming = payload.domains[domain];
      if (!incoming || incoming.domain !== domain || typeof incoming.contentHash !== 'string') {
        const error = new Error(`Host snapshot is missing ${domain}`);
        error.status = 400;
        error.code = 'invalid-host-snapshot-domain';
        throw error;
      }
      const latest = repository.latestSnapshot(domain);
      if (latest?.contentHash === incoming.contentHash) {
        published[domain] = latest;
        continue;
      }
      const revision = (latest?.revision || 0) + 1;
      published[domain] = repository.publishSnapshot({
        snapshotId: `${payload.snapshotId}-${domain}-r${revision}`,
        domain,
        schemaVersion: Number(incoming.schemaVersion || 1),
        revision,
        contentHash: incoming.contentHash,
        payload: { current: incoming.current ?? null, library: incoming.library ?? {} },
        createdAt: payload.publishedAt || new Date().toISOString(),
      });
    }
    return { contract: 'LegacyFillSnapshotReceiptV1', sourceSnapshotId: payload.snapshotId, domains: published };
  }

  function requireProposal(input) {
    const ownerNamespace = typeof input?.ownerNamespace === 'string' ? input.ownerNamespace : '';
    const proposalId = typeof input?.proposalId === 'string' ? input.proposalId : '';
    const proposal = repository.inspectProposal(ownerNamespace, proposalId);
    if (!proposal) {
      const error = new Error('Legacy Fill proposal not found');
      error.status = 404;
      error.code = 'proposal-not-found';
      throw error;
    }
    return proposal;
  }

  function requireReviewSession(proposal, reviewSessionId) {
    const claim = repository.proposalEvents(proposal.ownerNamespace, proposal.proposalId)
      .filter((event) => event.eventType === 'proposal.review-claimed').at(-1);
    if (!claim || claim.event?.reviewSessionId !== reviewSessionId) {
      const error = new Error('Legacy Fill review session is stale or unknown');
      error.status = 409;
      error.code = 'review-session-conflict';
      throw error;
    }
  }

  function claimReview(input) {
    const proposal = requireProposal(input);
    if (!['pending', 'claimed', 'approved'].includes(proposal.lifecycleStatus)) {
      const error = new Error(`Proposal cannot be reviewed from ${proposal.lifecycleStatus}`);
      error.status = 409;
      error.code = 'proposal-not-reviewable';
      throw error;
    }
    if (proposal.revision !== Number(input.expectedRevision) || proposal.manifestDigest !== input.expectedManifestDigest) {
      const error = new Error('Proposal revision or manifest digest changed before claim');
      error.status = 409;
      error.code = 'proposal-review-cas-conflict';
      throw error;
    }
    return repository.updateProposal({
      ownerNamespace: proposal.ownerNamespace,
      proposalId: proposal.proposalId,
      expectedRevision: proposal.revision,
      eventType: 'proposal.review-claimed',
      patch: { lifecycleStatus: proposal.approvalStatus === 'Yes' ? 'approved' : 'claimed' },
      event: { reviewSessionId: input.reviewSessionId, manifestDigest: proposal.manifestDigest },
    });
  }

  function decideReview(input) {
    const proposal = requireProposal(input);
    requireReviewSession(proposal, input.reviewSessionId);
    if (proposal.revision !== Number(input.expectedRevision) || proposal.manifestDigest !== input.expectedManifestDigest) {
      const error = new Error('Proposal revision or manifest digest changed before decision');
      error.status = 409;
      error.code = 'proposal-review-cas-conflict';
      throw error;
    }
    if (!['approved', 'rejected'].includes(input.decision)) {
      const error = new Error('Review decision must be approved or rejected');
      error.status = 400;
      error.code = 'invalid-review-decision';
      throw error;
    }
    return repository.updateProposal({
      ownerNamespace: proposal.ownerNamespace,
      proposalId: proposal.proposalId,
      expectedRevision: proposal.revision,
      eventType: input.decision === 'approved' ? 'proposal.review-approved' : 'proposal.review-rejected',
      patch: input.decision === 'approved'
        ? { lifecycleStatus: 'approved', approvalStatus: 'Yes', saveStatus: 'Wait' }
        : { lifecycleStatus: 'rejected', approvalStatus: 'No', saveStatus: 'No' },
      event: { reviewSessionId: input.reviewSessionId, manifestDigest: proposal.manifestDigest },
    });
  }

  function beginSave(input) {
    const proposal = requireProposal(input);
    requireReviewSession(proposal, input.reviewSessionId);
    if (proposal.lifecycleStatus !== 'approved' || proposal.approvalStatus !== 'Yes') {
      const error = new Error('Proposal must be approved before save');
      error.status = 409;
      error.code = 'proposal-not-approved';
      throw error;
    }
    if (proposal.revision !== Number(input.expectedRevision) || proposal.manifestDigest !== input.expectedManifestDigest) {
      const error = new Error('Proposal revision or manifest digest changed before save');
      error.status = 409;
      error.code = 'proposal-save-cas-conflict';
      throw error;
    }
    const latest = repository.latestSnapshot(proposal.domain);
    if (!latest || latest.revision !== proposal.baseRevision || latest.contentHash !== proposal.baseContentHash) {
      return repository.markStale({
        ownerNamespace: proposal.ownerNamespace,
        proposalId: proposal.proposalId,
        expectedRevision: proposal.revision,
        reason: 'Host library revision changed before save',
      });
    }
    return repository.updateProposal({
      ownerNamespace: proposal.ownerNamespace,
      proposalId: proposal.proposalId,
      expectedRevision: proposal.revision,
      eventType: 'proposal.save-started',
      patch: { lifecycleStatus: 'approved', approvalStatus: 'Yes', saveStatus: 'Wait' },
      event: { reviewSessionId: input.reviewSessionId, manifestDigest: proposal.manifestDigest },
    });
  }

  function recordSaveResult(input) {
    const proposal = requireProposal(input);
    if (input.ok === true && proposal.lifecycleStatus === 'applied' && proposal.approvalStatus === 'Yes' && proposal.saveStatus === 'Yes') {
      const savedEvent = repository.proposalEvents(proposal.ownerNamespace, proposal.proposalId)
        .filter((event) => event.eventType === 'proposal.saved').at(-1);
      if (proposal.manifestDigest === input.expectedManifestDigest
        && savedEvent?.event?.reviewSessionId === input.reviewSessionId
        && savedEvent?.proposalRevision === Number(input.expectedRevision) + 1) {
        return proposal;
      }
    }
    requireReviewSession(proposal, input.reviewSessionId);
    if (proposal.revision !== Number(input.expectedRevision) || proposal.manifestDigest !== input.expectedManifestDigest) {
      const error = new Error('Proposal revision or manifest digest changed before save result');
      error.status = 409;
      error.code = 'proposal-save-result-cas-conflict';
      throw error;
    }
    const ok = input.ok === true;
    return repository.updateProposal({
      ownerNamespace: proposal.ownerNamespace,
      proposalId: proposal.proposalId,
      expectedRevision: proposal.revision,
      eventType: ok ? 'proposal.saved' : 'proposal.save-failed',
      patch: ok
        ? { lifecycleStatus: 'applied', approvalStatus: 'Yes', saveStatus: 'Yes' }
        : { lifecycleStatus: 'approved', approvalStatus: 'Yes', saveStatus: 'No' },
      event: {
        reviewSessionId: input.reviewSessionId,
        manifestDigest: proposal.manifestDigest,
        result: input.result || null,
      },
    });
  }

  server = http.createServer(async (request, response) => {
    const method = request.method || 'GET';
    const url = new URL(request.url || '/', `http://${host}:${port}`);
    try {
      if (method === 'GET' && url.pathname === '/health') return writeJson(response, 200, health());
      if (url.pathname === '/mcp') return await handleMcpRequest(request, response, method);
      if (url.pathname.startsWith('/internal/') && !authorized(request)) {
        return writeJson(response, 403, { ok: false, error: { code: 'host-authority-required', message: 'Legacy Fill Host authority required' } });
      }
      if (method === 'POST' && url.pathname === '/internal/snapshots/publish') {
        const receipt = publishSnapshot(await readJson(request));
        return writeJson(response, 200, { ok: true, receipt });
      }
      if (method === 'GET' && url.pathname === '/internal/proposals') {
        return writeJson(response, 200, { ok: true, proposals: repository.listAllProposals({ limit: Number(url.searchParams.get('limit') || 500) }) });
      }
      const internalProposalMatch = /^\/internal\/proposals\/([^/]+)$/.exec(url.pathname);
      if (method === 'GET' && internalProposalMatch) {
        const proposal = requireProposal({ ownerNamespace: url.searchParams.get('ownerNamespace'), proposalId: decodeURIComponent(internalProposalMatch[1]) });
        return writeJson(response, 200, { ok: true, proposal, audit: repository.proposalEvents(proposal.ownerNamespace, proposal.proposalId) });
      }
      if (method === 'POST' && url.pathname === '/internal/proposals/claim') {
        return writeJson(response, 200, { ok: true, proposal: claimReview(await readJson(request)) });
      }
      if (method === 'POST' && url.pathname === '/internal/proposals/decision') {
        return writeJson(response, 200, { ok: true, proposal: decideReview(await readJson(request)) });
      }
      if (method === 'POST' && url.pathname === '/internal/proposals/save/begin') {
        return writeJson(response, 200, { ok: true, proposal: beginSave(await readJson(request)) });
      }
      if (method === 'POST' && url.pathname === '/internal/proposals/save/result') {
        return writeJson(response, 200, { ok: true, proposal: recordSaveResult(await readJson(request)) });
      }
      if (method === 'GET' && url.pathname === '/internal/audit/export') {
        return writeJson(response, 200, { ok: true, audit: repository.exportAudit() });
      }
      if (method === 'POST' && url.pathname === '/internal/shutdown') {
        writeJson(response, 202, { ok: true, closing: true });
        setImmediate(() => void close().then(onShutdown));
        return;
      }
      return writeJson(response, 404, { ok: false, error: { code: 'not-found', message: `Route not found: ${url.pathname}` } });
    } catch (error) {
      return writeJson(response, error?.status || 500, { ok: false, error: {
        code: error?.code || 'legacy-fill-service-error', message: error instanceof Error ? error.message : String(error),
      } });
    }
  });

  async function listen() {
    try {
      domainRuntime = await import(`${pathToFileURL(domainRuntimePath).href}?v=${fs.statSync(domainRuntimePath).mtimeMs}`);
      const strategyPath = path.resolve(options.strategyPath || path.resolve('src', 'legacyFillService', 'resources', 'strategy-v2.json'));
      const goldenPath = path.resolve(options.goldenPath || path.resolve('src', 'legacyFillService', 'resources', 'golden-v2.json'));
      const guides = loadVersionedResource(strategyPath, /^strategy-v\d+\.json$/u);
      const exampleSets = loadVersionedResource(goldenPath, /^golden-v\d+\.json$/u);
      mcpOperations = createLegacyFillMcpOperations({
        repository,
        domainRuntime,
        guide: guides.primary,
        examples: exampleSets.primary,
        guideHistory: guides.history,
        exampleHistory: exampleSets.history,
      });
    } catch (error) {
      domainRuntimeError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.off('error', reject); resolve(); });
    });
    if (registryPath) {
      fs.mkdirSync(path.dirname(registryPath), { recursive: true });
      const tempPath = `${registryPath}.${process.pid}.tmp`;
      fs.writeFileSync(tempPath, `${JSON.stringify({
        contract: 'LegacyFillServiceRegistryV1', pid: process.pid, host, port, url: `http://${host}:${port}`,
        startedAt, databasePath,
      }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tempPath, registryPath);
    }
    return health();
  }

  async function close() {
    if (closing) return;
    closing = true;
    await new Promise((resolve) => server.close(() => resolve()));
    repository.close();
    if (registryPath) {
      try {
        const current = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
        if (current?.pid === process.pid) fs.rmSync(registryPath, { force: true });
      } catch { /* registry already absent */ }
    }
  }

  return Object.freeze({ listen, close, health, publishSnapshot, repository });
}
