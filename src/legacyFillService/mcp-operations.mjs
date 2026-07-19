import crypto from 'node:crypto';
import { canonicalJson, sha256Digest } from './canonical-json.mjs';

export const LEGACY_FILL_DOMAINS = Object.freeze(['buff', 'weapon', 'operator', 'equipment']);
export const LEGACY_FILL_MCP_TOOL_NAMES = Object.freeze([
  'fill_get_current',
  'fill_search_library',
  'fill_get_template',
  'fill_validate',
  'proposal_create',
  'proposal_list',
  'proposal_inspect',
]);
export const LEGACY_FILL_MCP_RESOURCE_TEMPLATES = Object.freeze([
  'legacy-fill://snapshot/{snapshotId}/{domain}/current',
  'legacy-fill://snapshot/{snapshotId}/{domain}/library',
  'legacy-fill://schema/{schemaVersion}/{domain}',
  'legacy-fill://template/{schemaVersion}/{domain}',
  'legacy-fill://guides/strategy/{guideVersion}',
  'legacy-fill://examples/{fixtureVersion}/{domain}',
  'legacy-fill://proposals/{ownerNamespace}/{proposalId}/review',
  'legacy-fill://proposals/{ownerNamespace}/{proposalId}/status',
]);

const MAX_DRAFT_BYTES = 1024 * 1024;
const MAX_EVIDENCE_ITEMS = 20;
const MAX_EVIDENCE_TEXT = 10_000;
const MAX_QUERY_LENGTH = 200;
const MAX_PAGE_SIZE = 100;
const OWNER_PATTERN = /^[a-z0-9][a-z0-9._:-]{2,159}$/i;
const DEF_ID_PATTERN = /(?:^|[:._-])(ses_[a-z0-9]+|axis[_-]|timeline[_-]|workbench[_-]|def[_-]opencode)(?:$|[:._-])/i;

export class LegacyFillMcpError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'LegacyFillMcpError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new LegacyFillMcpError(code, message, details);
}

export function assertLegacyFillOwnerNamespace(value) {
  if (typeof value !== 'string' || !OWNER_PATTERN.test(value) || DEF_ID_PATTERN.test(value)) {
    fail('invalid-owner-namespace', 'ownerNamespace must be a configured MCP client/workspace identity and must not contain DEF identifiers');
  }
  return value;
}

function assertOwner(authenticatedOwner, requestedOwner) {
  const owner = assertLegacyFillOwnerNamespace(authenticatedOwner);
  if (requestedOwner !== undefined && requestedOwner !== owner) {
    fail('owner-isolation-violation', 'The requested ownerNamespace does not match the authenticated MCP client');
  }
  return owner;
}

function assertDomain(domain) {
  if (!LEGACY_FILL_DOMAINS.includes(domain)) fail('invalid-domain', `Unsupported fill domain: ${domain}`);
  return domain;
}

function assertSchemaVersion(snapshot, requested) {
  const version = Number(requested);
  if (!Number.isInteger(version) || version < 1 || snapshot && snapshot.schemaVersion !== version) {
    fail('schema-version-mismatch', `Unsupported schema version: ${requested}`);
  }
  return version;
}

function assertSize(value, limit, code, label) {
  const bytes = Buffer.byteLength(canonicalJson(value));
  if (bytes > limit) fail(code, `${label} exceeds ${limit} bytes`, { bytes, limit });
}

function encodeCursor(offset) {
  return Buffer.from(JSON.stringify({ v: 1, offset }), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return 0;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (decoded?.v !== 1 || !Number.isInteger(decoded.offset) || decoded.offset < 0) throw new Error('invalid');
    return decoded.offset;
  } catch {
    fail('invalid-cursor', 'cursor is not a valid Legacy Fill cursor');
  }
}

function page(items, cursor, requestedLimit) {
  const limit = Math.max(1, Math.min(Number(requestedLimit || 25), MAX_PAGE_SIZE));
  const offset = decodeCursor(cursor);
  const values = items.slice(offset, offset + limit);
  const nextOffset = offset + values.length;
  return { items: values, nextCursor: nextOffset < items.length ? encodeCursor(nextOffset) : null, total: items.length };
}

function libraryEntries(domain, library) {
  const source = domain === 'equipment' ? library?.gearSets || {} : library || {};
  return Object.entries(source).map(([id, value]) => ({
    id,
    name: typeof value?.name === 'string' ? value.name : '',
    summary: typeof value?.description === 'string' ? value.description.slice(0, 500) : '',
    entry: value,
  })).sort((a, b) => a.id.localeCompare(b.id, 'en'));
}

function proposalSummary(proposal, latestSnapshot) {
  const staleBase = !latestSnapshot
    || latestSnapshot.revision !== proposal.baseRevision
    || latestSnapshot.contentHash !== proposal.baseContentHash;
  return {
    proposalId: proposal.proposalId,
    domain: proposal.domain,
    summary: proposal.summary,
    proposalRevision: proposal.revision,
    lifecycleStatus: proposal.lifecycleStatus,
    approvalStatus: proposal.approvalStatus,
    saveStatus: proposal.saveStatus,
    baseStale: proposal.staleBase || staleBase,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
  };
}

function diffValues(before, after, path = '', output = []) {
  if (canonicalJson(before) === canonicalJson(after)) return output;
  const beforeObject = before && typeof before === 'object' && !Array.isArray(before);
  const afterObject = after && typeof after === 'object' && !Array.isArray(after);
  if (beforeObject && afterObject) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      const escaped = key.replaceAll('~', '~0').replaceAll('/', '~1');
      const nextPath = `${path}/${escaped}`;
      if (!Object.hasOwn(before, key)) output.push({ path: nextPath, kind: 'add', after: after[key] });
      else if (!Object.hasOwn(after, key)) output.push({ path: nextPath, kind: 'remove', before: before[key] });
      else diffValues(before[key], after[key], nextPath, output);
      if (output.length > 5000) fail('review-diff-too-large', 'proposal diff exceeds 5000 field changes');
    }
    return output;
  }
  if (before === undefined) output.push({ path: path || '/', kind: 'add', after });
  else if (after === undefined) output.push({ path: path || '/', kind: 'remove', before });
  else output.push({ path: path || '/', kind: 'replace', before, after });
  return output;
}

function baseTarget(domain, snapshotValue, normalized, targetId) {
  const library = snapshotValue.payload?.library || {};
  if (domain !== 'equipment') return library[targetId];
  const targetIds = targetId.split('|').filter(Boolean);
  const gearSets = library.gearSets || {};
  return {
    ...(normalized && typeof normalized === 'object' ? normalized : {}),
    gearSets: Object.fromEntries(targetIds.filter((id) => Object.hasOwn(gearSets, id)).map((id) => [id, gearSets[id]])),
  };
}

export function createLegacyFillMcpOperations({ repository, domainRuntime, guide, examples }) {
  if (!repository || !domainRuntime) throw new TypeError('repository and domainRuntime are required');

  function snapshot(domain, snapshotId) {
    assertDomain(domain);
    const value = snapshotId ? repository.getSnapshot(snapshotId) : repository.latestSnapshot(domain);
    if (!value || value.domain !== domain) fail('snapshot-not-found', 'The requested Host-published snapshot does not exist for this domain');
    return value;
  }

  function getCurrent({ domain, snapshotId }) {
    const value = snapshot(domain, snapshotId);
    return {
      snapshotId: value.snapshotId,
      schemaVersion: value.schemaVersion,
      revision: value.revision,
      contentHash: value.contentHash,
      current: value.payload?.current ?? null,
    };
  }

  function searchLibrary({ domain, query = '', cursor, limit, snapshotId, inspectId }) {
    if (typeof query !== 'string' || query.length > MAX_QUERY_LENGTH) fail('invalid-query', `query must be at most ${MAX_QUERY_LENGTH} characters`);
    const value = snapshot(domain, snapshotId);
    const normalizedQuery = query.trim().toLocaleLowerCase();
    let entries = libraryEntries(domain, value.payload?.library);
    if (normalizedQuery) entries = entries.filter((entry) => `${entry.id}\n${entry.name}\n${entry.summary}`.toLocaleLowerCase().includes(normalizedQuery));
    if (inspectId) {
      const entry = entries.find((candidate) => candidate.id === inspectId);
      if (!entry) fail('library-entry-not-found', `Library entry not found: ${inspectId}`);
      entries = [entry];
    }
    const result = page(entries.map((entry) => inspectId ? entry : ({ id: entry.id, name: entry.name, summary: entry.summary })), cursor, limit);
    return { snapshotId: value.snapshotId, schemaVersion: value.schemaVersion, revision: value.revision, contentHash: value.contentHash, ...result };
  }

  function getTemplate({ domain, schemaVersion }) {
    const latest = snapshot(domain);
    const version = assertSchemaVersion(latest, schemaVersion ?? latest.schemaVersion);
    const template = domainRuntime.getLegacyFillTemplate(domain);
    return {
      schemaVersion: version,
      schemaUri: `legacy-fill://schema/${version}/${domain}`,
      templateUri: `legacy-fill://template/${version}/${domain}`,
      format: template.format,
      schema: template.schema,
      template: template.data || { tool: `${domain}.fill`, schema: template.schema },
      separation: { schemaSource: 'legacy-fill-core', strategyIsProtocol: false },
    };
  }

  function validate({ domain, draft, schemaVersion, baseSnapshot }) {
    assertDomain(domain);
    assertSize(draft, MAX_DRAFT_BYTES, 'draft-too-large', 'draft');
    const baseline = baseSnapshot?.snapshotId ? snapshot(domain, baseSnapshot.snapshotId) : snapshot(domain);
    const version = assertSchemaVersion(baseline, schemaVersion);
    if (baseSnapshot && (baseline.revision !== baseSnapshot.revision || baseline.contentHash !== baseSnapshot.contentHash)) {
      fail('snapshot-identity-mismatch', 'baseSnapshot revision/contentHash does not match the Host-published snapshot');
    }
    const result = domainRuntime.validateLegacyFillDraft(domain, draft);
    const digest = sha256Digest({ domain, schemaVersion: version, baseSnapshot: baseSnapshot || null, normalized: result.normalized ?? null, errors: result.errors || [], warnings: result.warnings || [] });
    return { ...result, schemaVersion: version, validationDigest: digest };
  }

  function createProposal(authenticatedOwner, input) {
    const ownerNamespace = assertOwner(authenticatedOwner, input.ownerNamespace);
    if (!Array.isArray(input.evidence || [])) fail('invalid-evidence', 'evidence must be an array');
    if ((input.evidence || []).length > MAX_EVIDENCE_ITEMS) fail('evidence-too-large', `evidence supports at most ${MAX_EVIDENCE_ITEMS} items`);
    for (const evidence of input.evidence || []) {
      if (typeof evidence?.label !== 'string' || typeof evidence?.text !== 'string' || evidence.text.length > MAX_EVIDENCE_TEXT) {
        fail('invalid-evidence', `each evidence item requires label/text and text must be at most ${MAX_EVIDENCE_TEXT} characters`);
      }
    }
    const validation = validate(input);
    if (!validation.valid) fail('validation-failed', 'The draft does not satisfy the Legacy Fill schema', { validation });
    const targetId = domainRuntime.targetLegacyFillProposal(input.domain, validation.normalized);
    const summary = domainRuntime.summarizeLegacyFillProposal(input.domain, validation.normalized);
    const snapshotValue = snapshot(input.domain, input.baseSnapshot.snapshotId);
    const before = baseTarget(input.domain, snapshotValue, validation.normalized, targetId);
    const createdAt = new Date().toISOString();
    const proposalId = `fill-proposal-${crypto.randomUUID()}`;
    const validationManifest = {
      valid: true,
      errors: (validation.errors || []).map((message) => ({ code: 'validation-error', message: typeof message === 'string' ? message : JSON.stringify(message) })),
      warnings: (validation.warnings || []).map((message) => ({ code: 'validation-warning', message: typeof message === 'string' ? message : JSON.stringify(message) })),
      digest: validation.validationDigest,
    };
    const reviewWithoutDigest = {
      contract: 'ProposalReviewManifestV1',
      manifestVersion: 1,
      proposalId,
      proposalRevision: 1,
      ownerNamespace,
      domain: input.domain,
      operation: 'upsert',
      createdAt,
      summary,
      schemaVersion: input.schemaVersion,
      baseSnapshot: input.baseSnapshot,
      target: {
        id: targetId,
        ...(typeof validation.normalized?.name === 'string' ? { displayName: validation.normalized.name } : {}),
        existsInBase: before !== undefined && (input.domain !== 'equipment' || Object.keys(before.gearSets || {}).length > 0),
      },
      intent: input.intent || '',
      normalizedDraft: validation.normalized,
      diff: diffValues(before, validation.normalized),
      validation: validationManifest,
      evidence: input.evidence || [],
      requestedWrites: [{ storageDomain: input.domain, targetId }],
      review: { status: 'pending' },
      persistence: { status: 'not-requested' },
    };
    const manifestDigest = sha256Digest(reviewWithoutDigest);
    const review = { ...reviewWithoutDigest, manifestDigest };
    const created = repository.createProposal({
      proposalId,
      createdAt,
      ownerNamespace,
      idempotencyKey: input.idempotencyKey,
      domain: input.domain,
      schemaVersion: input.schemaVersion,
      baseSnapshot: input.baseSnapshot,
      baseIdentity: `${input.domain}:${targetId}`,
      targetId,
      normalized: validation.normalized,
      validation,
      review,
      manifestDigest,
      summary,
      intent: input.intent || '',
      evidence: input.evidence || [],
    });
    const proposal = created.proposal;
    return {
      proposalId: proposal.proposalId,
      proposalRevision: proposal.revision,
      reviewManifestUri: `legacy-fill://proposals/${encodeURIComponent(ownerNamespace)}/${proposal.proposalId}/review`,
      statusUri: `legacy-fill://proposals/${encodeURIComponent(ownerNamespace)}/${proposal.proposalId}/status`,
      result: created.duplicate ? 'duplicate' : 'created',
      created: !created.duplicate,
      duplicate: Boolean(created.duplicate),
      validationDigest: validation.validationDigest,
    };
  }

  function listProposals(authenticatedOwner, input) {
    const ownerNamespace = assertOwner(authenticatedOwner, input.ownerNamespace);
    let proposals = repository.listProposals(ownerNamespace, { limit: 500 });
    if (input.domain) proposals = proposals.filter((proposal) => proposal.domain === input.domain);
    if (input.status) proposals = proposals.filter((proposal) => proposal.lifecycleStatus === input.status);
    const result = page(proposals.map((proposal) => proposalSummary(proposal, repository.latestSnapshot(proposal.domain))), input.cursor, input.limit);
    return { ownerNamespace, ...result };
  }

  function inspectProposal(authenticatedOwner, input) {
    const ownerNamespace = assertOwner(authenticatedOwner, input.ownerNamespace);
    const proposal = repository.inspectProposal(ownerNamespace, input.proposalId);
    if (!proposal) fail('proposal-not-found', 'Proposal not found for the authenticated owner');
    if (input.expectedRevision !== undefined && proposal.revision !== input.expectedRevision) {
      fail('proposal-revision-conflict', 'Proposal revision changed', { expectedRevision: input.expectedRevision, actualRevision: proposal.revision });
    }
    return {
      proposal,
      reviewManifest: proposal.review,
      validation: proposal.validation,
      audit: repository.proposalEvents(ownerNamespace, proposal.proposalId),
      status: proposalSummary(proposal, repository.latestSnapshot(proposal.domain)),
    };
  }

  function readResource(authenticatedOwner, uri) {
    const value = new URL(uri);
    const segments = value.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (value.protocol !== 'legacy-fill:') fail('resource-not-found', 'Unsupported resource scheme');
    if (value.hostname === 'snapshot' && segments.length === 3 && ['current', 'library'].includes(segments[2])) {
      const [snapshotId, domain, kind] = segments;
      const current = snapshot(domain, snapshotId);
      return kind === 'current' ? getCurrent({ domain, snapshotId }) : {
        snapshotId: current.snapshotId, schemaVersion: current.schemaVersion, revision: current.revision,
        contentHash: current.contentHash, library: current.payload?.library ?? {},
      };
    }
    if (value.hostname === 'schema' && segments.length === 2) return getTemplate({ schemaVersion: Number(segments[0]), domain: segments[1] }).schema;
    if (value.hostname === 'template' && segments.length === 2) return getTemplate({ schemaVersion: Number(segments[0]), domain: segments[1] });
    if (value.hostname === 'guides' && segments[0] === 'strategy' && segments[1] === guide.version) return guide;
    if (value.hostname === 'examples' && segments.length === 2 && segments[0] === examples.version) {
      assertDomain(segments[1]);
      const example = examples.domains[segments[1]];
      if (!example) fail('resource-not-found', 'Golden fixture not found');
      return { fixtureVersion: examples.version, schemaVersion: example.schemaVersion, domain: segments[1], draft: example.draft };
    }
    if (value.hostname === 'proposals' && segments.length === 3 && ['review', 'status'].includes(segments[2])) {
      const [ownerNamespace, proposalId, kind] = segments;
      const inspected = inspectProposal(authenticatedOwner, { ownerNamespace, proposalId });
      return kind === 'review' ? inspected : { proposal: inspected.status, audit: inspected.audit };
    }
    fail('resource-not-found', 'Resource URI does not match the Legacy Fill allowlist');
  }

  function listResources(authenticatedOwner) {
    const ownerNamespace = assertOwner(authenticatedOwner);
    const resources = [];
    for (const domain of LEGACY_FILL_DOMAINS) {
      const latest = repository.latestSnapshot(domain);
      if (latest) {
        resources.push(`legacy-fill://snapshot/${latest.snapshotId}/${domain}/current`);
        resources.push(`legacy-fill://snapshot/${latest.snapshotId}/${domain}/library`);
        resources.push(`legacy-fill://schema/${latest.schemaVersion}/${domain}`);
        resources.push(`legacy-fill://template/${latest.schemaVersion}/${domain}`);
      }
      resources.push(`legacy-fill://examples/${examples.version}/${domain}`);
    }
    resources.push(`legacy-fill://guides/strategy/${guide.version}`);
    for (const proposal of repository.listProposals(ownerNamespace, { limit: 500 })) {
      const base = `legacy-fill://proposals/${encodeURIComponent(ownerNamespace)}/${proposal.proposalId}`;
      resources.push(`${base}/review`, `${base}/status`);
    }
    return resources;
  }

  return Object.freeze({
    getCurrent,
    searchLibrary,
    getTemplate,
    validate,
    createProposal,
    listProposals,
    inspectProposal,
    readResource,
    listResources,
    requestDigest: (input) => sha256Digest(input),
    randomRequestId: () => crypto.randomUUID(),
  });
}
