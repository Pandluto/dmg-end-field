import assert from 'node:assert/strict'
import {
  createSitesMobileShareHandler,
  type SitesMobileShareRepository,
} from '../../../worker/mobileShareApi'

type ShareMetadata = NonNullable<Awaited<ReturnType<SitesMobileShareRepository['findByPayloadHash']>>>
type ShareCreationEvent = Parameters<SitesMobileShareRepository['create']>[2]

class MemoryShareRepository implements SitesMobileShareRepository {
  private readonly secrets = new Map<string, string>()
  private readonly shares = new Map<string, { metadata: ShareMetadata; serializedPayload: string }>()
  private readonly hashToId = new Map<string, string>()
  private events: ShareCreationEvent[] = []

  async ensureReady(): Promise<void> {}

  async getOrCreateSecret(key: string): Promise<string> {
    const existing = this.secrets.get(key)
    if (existing) return existing
    const value = key === 'device_secret' ? '11'.repeat(32) : '22'.repeat(32)
    this.secrets.set(key, value)
    return value
  }

  async deleteRateEventsBefore(timestamp: number): Promise<void> {
    this.events = this.events.filter((event) => event.createdAt >= timestamp)
  }

  async findByPayloadHash(payloadHash: string): Promise<ShareMetadata | null> {
    const id = this.hashToId.get(payloadHash)
    return id ? this.shares.get(id)?.metadata ?? null : null
  }

  async countRateEvents(
    windowStart: number,
    ipHash: string,
    deviceHash: string,
  ): Promise<{ device: number; ip: number; global: number }> {
    const recent = this.events.filter((event) => event.createdAt >= windowStart)
    return {
      device: recent.filter((event) => event.deviceHash === deviceHash).length,
      ip: recent.filter((event) => event.ipHash === ipHash).length,
      global: recent.length,
    }
  }

  async create(
    metadata: ShareMetadata,
    serializedPayload: string,
    event: ShareCreationEvent,
  ): ReturnType<SitesMobileShareRepository['create']> {
    const existingId = this.hashToId.get(metadata.payloadHash)
    if (existingId) {
      const existing = this.shares.get(existingId)
      assert.ok(existing)
      return { status: 'reused', metadata: existing.metadata }
    }
    if (this.shares.has(metadata.id)) return { status: 'id-conflict' }
    this.shares.set(metadata.id, { metadata, serializedPayload })
    this.hashToId.set(metadata.payloadHash, metadata.id)
    this.events.push(event)
    return { status: 'created', metadata }
  }

  async get(id: string): ReturnType<SitesMobileShareRepository['get']> {
    const stored = this.shares.get(id)
    if (!stored) return null
    return {
      id,
      createdAt: stored.metadata.createdAt,
      expiresAt: null,
      permanent: true,
      payload: JSON.parse(stored.serializedPayload) as unknown,
    }
  }

  async stats(windowStart: number): Promise<{ permanent: number; createdLast24Hours: number }> {
    return {
      permanent: this.shares.size,
      createdLast24Hours: this.events.filter((event) => event.createdAt >= windowStart).length,
    }
  }
}

function mobilePayload(seed: number) {
  return {
    schemaVersion: 2,
    source: 'mobile',
    dataVersion: 'test-data',
    imageVersion: 'test-images',
    draft: {
      schemaVersion: 1,
      selectedOperatorIds: ['operator-1'],
      operatorConfigs: {},
      slots: [],
      reportNotes: { summary: `seed-${seed}` },
      activePage: 'report',
      activeOperatorId: 'operator-1',
      updatedAt: seed,
    },
  }
}

const now = 1_786_462_000_000
const repository = new MemoryShareRepository()
const handler = createSitesMobileShareHandler(repository, {
  now: () => now,
  perDeviceLimit: 1,
})
const createResponse = await handler(new Request('https://dmgendfield.online/api/mobile-shares', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Origin': 'https://dmgendfield.online',
    'CF-Connecting-IP': '203.0.113.7',
  },
  body: JSON.stringify(mobilePayload(1)),
}))
assert.equal(createResponse.status, 201)
assert.equal(createResponse.headers.get('Access-Control-Allow-Origin'), 'https://dmgendfield.online')
assert.match(createResponse.headers.get('Set-Cookie') ?? '', /Secure/)
const created = await createResponse.json() as { id: string; reused: boolean }
assert.match(created.id, /^[A-Za-z0-9_-]{16}$/)
assert.equal(created.reused, false)

const readResponse = await handler(new Request(
  `https://dmgendfield.online/api/mobile-shares/${created.id}`,
  { headers: { Origin: 'http://150.158.133.176' } },
))
assert.equal(readResponse.status, 200)
assert.equal(readResponse.headers.get('Access-Control-Allow-Origin'), 'http://150.158.133.176')
const readRecord = await readResponse.json() as { permanent: boolean; payload: ReturnType<typeof mobilePayload> }
assert.equal(readRecord.permanent, true)
assert.deepEqual(readRecord.payload, mobilePayload(1))

const cookie = (createResponse.headers.get('Set-Cookie') ?? '').split(';')[0]
const reusedResponse = await handler(new Request('https://dmgendfield.online/api/mobile-shares', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Origin': 'https://dmgendfield.online',
    'CF-Connecting-IP': '203.0.113.7',
    Cookie: cookie,
  },
  body: JSON.stringify(mobilePayload(1)),
}))
assert.equal(reusedResponse.status, 200)
assert.deepEqual(await reusedResponse.json(), {
  id: created.id,
  createdAt: now,
  expiresAt: null,
  permanent: true,
  reused: true,
})

const limitedResponse = await handler(new Request('https://dmgendfield.online/api/mobile-shares', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Origin': 'https://dmgendfield.online',
    'CF-Connecting-IP': '203.0.113.7',
    Cookie: cookie,
  },
  body: JSON.stringify(mobilePayload(2)),
}))
assert.equal(limitedResponse.status, 429)
assert.equal((await limitedResponse.json() as { code: string }).code, 'DEVICE_DAILY_LIMIT')

const healthResponse = await handler(new Request(
  'https://dmgendfield.online/api/mobile-shares/health',
))
assert.deepEqual(await healthResponse.json(), {
  ok: true,
  active: 1,
  permanent: 1,
  createdLast24Hours: 1,
})

const forbiddenResponse = await handler(new Request(
  `https://dmgendfield.online/api/mobile-shares/${created.id}`,
  { headers: { Origin: 'https://untrusted.example' } },
))
assert.equal(forbiddenResponse.status, 403)
assert.equal((await forbiddenResponse.json() as { code: string }).code, 'ORIGIN_NOT_ALLOWED')

const smallHandler = createSitesMobileShareHandler(new MemoryShareRepository(), {
  now: () => now,
  maxPayloadBytes: 32,
})
const oversizedResponse = await smallHandler(new Request('https://dmgendfield.online/api/mobile-shares', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(mobilePayload(3)),
}))
assert.equal(oversizedResponse.status, 413)

console.log('Sites D1/R2 mobile share API contract: PASS')
