import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalLegacyFillJson,
  createLegacyFillDomainCore,
  createLegacyFillProposalManifest,
  createLegacyFillProposalPayload,
  createLegacyFillSchemaTemplate,
} from '../src/legacyFillCore/index.ts';

const sourceRoot = path.resolve('src/legacyFillCore');
const source = fs.readdirSync(sourceRoot, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
  .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8'))
  .join('\n');
for (const forbidden of ['window', 'localStorage', 'sessionStorage', 'electron', 'def-opencode', '/api/', '@modelcontextprotocol']) {
  assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false, `browser-neutral core contains ${forbidden}`);
}

assert.equal(canonicalLegacyFillJson({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');
const schema = createLegacyFillSchemaTemplate({
  domain: 'buff',
  schemaVersion: 1,
  payloadSchema: { type: 'object', required: ['id'] },
});
const domain = createLegacyFillDomainCore({
  domain: 'buff',
  schemaVersion: 1,
  schema: () => schema,
  normalize: (candidate) => candidate,
  validate: (candidate) => ({ ok: true, errors: [], normalized: candidate }),
  summarize: (payload) => `buff ${payload.id}`,
  targetId: (payload) => payload.id,
});
assert.equal(domain.schema(), schema);
assert.deepEqual(createLegacyFillProposalPayload({ rawCommand: 'fill.apply {}', normalized: { id: 'fixture' }, summary: 'buff fixture' }), {
  rawCommand: 'fill.apply {}',
  normalized: { id: 'fixture' },
  summary: 'buff fixture',
});

const manifestInput = {
  ownerNamespace: 'contract-client',
  proposalId: 'proposal-fixture',
  domain: 'buff',
  baseIdentity: 'buff:fixture',
  baseRevision: 'sha256:base',
  schemaVersion: 1,
  normalized: { z: 1, id: 'fixture' },
  summary: 'buff fixture',
  targetId: 'fixture',
  createdAt: '2026-07-19T00:00:00.000Z',
};
const first = await createLegacyFillProposalManifest(manifestInput);
const second = await createLegacyFillProposalManifest({ ...manifestInput, normalized: { id: 'fixture', z: 1 } });
assert.equal(first.manifestDigest, second.manifestDigest);
assert.equal(first.review.payloadDigest, second.review.payloadDigest);
assert.equal(first.approvalStatus, 'Wait');
assert.equal(first.saveStatus, 'Wait');
assert.equal(first.revision, 1);
process.stdout.write('[legacy-fill-core-contract] passed\n');
