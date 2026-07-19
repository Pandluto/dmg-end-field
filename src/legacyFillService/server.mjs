import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLegacyFillProposalRepository } from './proposal-repository.mjs';

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

export function createLegacyFillService(options = {}) {
  const host = options.host || '127.0.0.1';
  const port = Number(options.port || 17323);
  const hostToken = typeof options.hostToken === 'string' ? options.hostToken.trim() : '';
  if (!hostToken) throw new TypeError('LEGACY_FILL_HOST_TOKEN is required');
  const databasePath = path.resolve(options.databasePath);
  const registryPath = options.registryPath ? path.resolve(options.registryPath) : '';
  const repository = createLegacyFillProposalRepository({ databasePath });
  const domainRuntimePath = path.resolve(options.domainRuntimePath || path.resolve('dist', 'legacy-fill', 'domain-runtime.mjs'));
  const startedAt = new Date().toISOString();
  let domainRuntime = null;
  let domainRuntimeError = '';
  let compatibilityRequestCount = 0;
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
      mcp: { enabled: false },
      compatibilityRequestCount,
    };
  }

  function authorized(request) {
    return request.headers['x-legacy-fill-host-token'] === hostToken;
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

  function latestDomainSnapshot(domain) {
    const snapshot = repository.latestSnapshot(domain);
    if (!snapshot) {
      const error = new Error(`No Host snapshot is ready for ${domain}`);
      error.status = 503;
      error.code = 'legacy-fill-snapshot-unavailable';
      throw error;
    }
    return snapshot;
  }

  function compatibilityProposal(proposal) {
    return {
      id: proposal.proposalId,
      domain: proposal.domain,
      workflow: `${proposal.domain}.fill`,
      summary: proposal.summary,
      approval: proposal.approvalStatus,
      save: proposal.saveStatus,
      approvalStatus: proposal.approvalStatus,
      saveStatus: proposal.saveStatus,
      payload: proposal.normalized,
      createdAt: proposal.createdAt,
      updatedAt: proposal.updatedAt,
      revision: proposal.revision,
      staleBase: proposal.staleBase,
    };
  }

  async function handleCompatibilityRequest(method, url, body) {
    const domainMatch = /^\/api\/(buff|weapon|operator|equipment)\/(current|library|fill\/template|fill\/check|fill\/apply)(?:\/([^/]+))?$/.exec(url.pathname);
    if (domainMatch) {
      if (!domainRuntime) {
        const error = new Error(domainRuntimeError || 'Legacy fill domain runtime is unavailable');
        error.status = 503;
        error.code = 'legacy-fill-domain-runtime-unavailable';
        throw error;
      }
      const [, domain, operation, , rawReference] = domainMatch;
      const snapshot = latestDomainSnapshot(domain);
      const snapshotPayload = snapshot.payload || {};
      if (method === 'GET' && operation === 'current') {
        return { status: 200, body: { ok: true, protocolVersion: 1, domain, format: domain === 'equipment' ? 'EquipmentLibrary' : `${domain[0].toUpperCase()}${domain.slice(1)}Draft`, draft: snapshotPayload.current } };
      }
      if (method === 'GET' && operation === 'library') {
        const library = snapshotPayload.library || {};
        if (rawReference) {
          const reference = decodeURIComponent(rawReference);
          const lower = reference.toLowerCase();
          const entry = domain === 'equipment'
            ? Object.values(library.gearSets || {}).find((item) => item?.gearSetId === reference || item?.gearSetId?.toLowerCase() === lower || item?.name === reference)
            : Object.entries(library).find(([id, item]) => id === reference || id.toLowerCase() === lower || item?.name === reference)?.[1];
          if (!entry) return { status: 404, body: { ok: false, protocolVersion: 1, error: { code: 'not-found', message: `${domain} library entry not found: ${reference}` } } };
          return { status: 200, body: { ok: true, protocolVersion: 1, domain, entry, draft: entry } };
        }
        const count = domain === 'equipment' ? Object.keys(library.gearSets || {}).length : Object.keys(library).length;
        return { status: 200, body: { ok: true, protocolVersion: 1, domain, format: domain === 'equipment' ? 'EquipmentLibrary' : `${domain[0].toUpperCase()}${domain.slice(1)}DraftMap`, count, library } };
      }
      if (method === 'GET' && operation === 'fill/template') {
        const template = domainRuntime.getLegacyFillTemplate(domain);
        return { status: 200, body: { ok: true, protocolVersion: 1, domain, format: template.format, template: template.schema, data: template.data || { tool: `${domain}.fill`, schema: template.schema } } };
      }
      if (method === 'POST' && (operation === 'fill/check' || operation === 'fill/apply')) {
        const draft = body && Object.prototype.hasOwnProperty.call(body, 'draft') ? body.draft : body;
        const validation = domainRuntime.validateLegacyFillDraft(domain, draft);
        if (!validation.valid) {
          return { status: 400, body: { ok: false, protocolVersion: 1, validation, effects: { writes: false }, error: { code: 'validation-failed', message: 'Fill draft validation failed' } } };
        }
        if (operation === 'fill/check') {
          return { status: 200, body: { ok: true, protocolVersion: 1, validation, effects: { writes: false } } };
        }
        const ownerNamespace = 'legacy-rest:compat';
        const targetId = domainRuntime.targetLegacyFillProposal(domain, validation.normalized);
        const summary = domainRuntime.summarizeLegacyFillProposal(domain, validation.normalized);
        const created = repository.createProposal({
          ownerNamespace,
          idempotencyKey: typeof body?.requestId === 'string' && body.requestId.trim() ? body.requestId.trim() : `legacy-${crypto.randomUUID()}`,
          domain,
          schemaVersion: 1,
          baseSnapshot: { snapshotId: snapshot.snapshotId, revision: snapshot.revision, contentHash: snapshot.contentHash },
          baseIdentity: `${domain}:${targetId}`,
          targetId,
          normalized: validation.normalized,
          validation,
          summary,
          intent: 'legacy-rest-compatibility',
          evidence: [{ label: 'legacy client', text: url.searchParams.get('client') || body?.client || 'rest' }],
          rejectIfOwnerPending: true,
        });
        return { status: 200, body: { ok: true, protocolVersion: 1, validation, effects: { writes: false }, proposal: compatibilityProposal(created.proposal) } };
      }
    }

    if (method === 'POST' && url.pathname === '/api/ai-cli/run' && typeof body?.command === 'string') {
      const command = body.command.trim();
      const lower = command.toLowerCase();
      if (['y', 'n'].includes(lower) || /^(proposal\.(approve|reject|save|unsave))(?:\s|$)/i.test(command)) {
        return { status: 403, body: { ok: false, protocolVersion: 1, error: { code: 'forbidden', message: 'proposal approval/save commands are not allowed via REST. use Host review UI.' } } };
      }
      const ownerNamespace = 'legacy-rest:compat';
      if (/^proposal\.list(?:\s|$)/i.test(command)) {
        const proposals = repository.listProposals(ownerNamespace)
          .filter((proposal) => ['pending', 'claimed'].includes(proposal.lifecycleStatus))
          .map(compatibilityProposal);
        return { status: 200, body: { ok: true, protocolVersion: 1, data: { proposals }, lines: [`[info] proposals=${proposals.length}`], effects: { writes: false } } };
      }
      const show = /^proposal\.show\s+(.+)$/i.exec(command);
      if (show) {
        const proposal = repository.inspectProposal(ownerNamespace, show[1].trim());
        if (!proposal) return { status: 404, body: { ok: false, protocolVersion: 1, error: { code: 'proposal-not-found', message: 'Proposal not found' } } };
        return { status: 200, body: { ok: true, protocolVersion: 1, data: { proposal: compatibilityProposal(proposal) }, proposal: compatibilityProposal(proposal), effects: { writes: false } } };
      }
      if (/^proposal\.clear(?:\s|$)/i.test(command)) {
        let cleared = 0;
        for (const proposal of repository.listProposals(ownerNamespace)) {
          if (!['pending', 'claimed'].includes(proposal.lifecycleStatus)) continue;
          repository.updateProposal({
            ownerNamespace, proposalId: proposal.proposalId, expectedRevision: proposal.revision,
            eventType: 'proposal.compatibility-cleared',
            patch: { lifecycleStatus: 'cancelled', approvalStatus: 'No', saveStatus: 'No' },
            event: { source: 'legacy-rest-compatibility' },
          });
          cleared += 1;
        }
        return { status: 200, body: { ok: true, protocolVersion: 1, data: { cleared }, lines: [`[ok] cleared proposals=${cleared}`], effects: { writes: false } } };
      }
    }
    if (method === 'GET' && url.pathname === '/api/ai-cli/spec') {
      return { status: 200, body: { ok: true, protocolVersion: 1, service: 'legacy-fill-service', compatibility: true, domains: DOMAINS } };
    }
    return null;
  }

  server = http.createServer(async (request, response) => {
    const method = request.method || 'GET';
    const url = new URL(request.url || '/', `http://${host}:${port}`);
    try {
      if (method === 'GET' && url.pathname === '/health') return writeJson(response, 200, health());
      if (url.pathname.startsWith('/internal/') && !authorized(request)) {
        return writeJson(response, 403, { ok: false, error: { code: 'host-authority-required', message: 'Legacy Fill Host authority required' } });
      }
      if (method === 'POST' && url.pathname === '/internal/snapshots/publish') {
        const receipt = publishSnapshot(await readJson(request));
        return writeJson(response, 200, { ok: true, receipt });
      }
      if (method === 'GET' && url.pathname === '/internal/audit/export') {
        return writeJson(response, 200, { ok: true, audit: repository.exportAudit() });
      }
      if (method === 'POST' && url.pathname === '/internal/shutdown') {
        writeJson(response, 202, { ok: true, closing: true });
        setImmediate(() => void close());
        return;
      }
      const compatibility = await handleCompatibilityRequest(method, url, method === 'POST' ? await readJson(request) : undefined);
      if (compatibility) {
        compatibilityRequestCount += 1;
        return writeJson(response, compatibility.status, compatibility.body);
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
