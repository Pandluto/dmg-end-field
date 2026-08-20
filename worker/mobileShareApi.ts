import { MOBILE_SHARE_SCHEMA_STATEMENTS } from '../db/schema'

export const SITES_MOBILE_SHARE_RATE_WINDOW_MS = 24 * 60 * 60 * 1000
export const SITES_MOBILE_SHARE_PER_DEVICE_LIMIT = 3
export const SITES_MOBILE_SHARE_PER_IP_LIMIT = 10
export const SITES_MOBILE_SHARE_GLOBAL_LIMIT = 100
export const SITES_MOBILE_SHARE_MAX_PAYLOAD_BYTES = 8 * 1024 * 1024

const MOBILE_SHARE_DEVICE_COOKIE = 'dmg_share_device'
const MOBILE_SHARE_DEVICE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60
const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/
const DEVICE_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/
const MOBILE_SHARE_API_PATH = '/api/mobile-shares'
const ALLOWED_ORIGINS = new Set([
  'https://dmgendfield.cloud',
  'https://dmgendfield.online',
  'https://dmgendfield-online.hf233666.chatgpt.site',
  'https://150.158.133.176',
  'http://150.158.133.176',
  'http://127.0.0.1:3030',
  'http://localhost:3030',
])

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike
  first<T = Record<string, unknown>>(): Promise<T | null>
  run<T = unknown>(): Promise<T>
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike
  batch<T = unknown>(statements: D1PreparedStatementLike[]): Promise<T[]>
}

export interface R2ObjectBodyLike {
  text(): Promise<string>
}

export interface R2BucketLike {
  get(key: string): Promise<R2ObjectBodyLike | null>
  put(
    key: string,
    value: string,
    options?: {
      httpMetadata?: { contentType?: string }
      customMetadata?: Record<string, string>
    },
  ): Promise<unknown>
  delete(key: string): Promise<void>
}

export interface SitesMobileShareEnv {
  DB: D1DatabaseLike
  MOBILE_SHARES: R2BucketLike
}

type MobileShareMetadata = {
  id: string
  payloadHash: string
  payloadBytes: number
  createdAt: number
}

type MobileShareRecord = {
  id: string
  createdAt: number
  expiresAt: null
  permanent: true
  payload: unknown
}

type MobileShareRateCounts = {
  device: number
  ip: number
  global: number
}

type MobileShareCreation =
  | { status: 'created'; metadata: MobileShareMetadata }
  | { status: 'reused'; metadata: MobileShareMetadata }
  | { status: 'id-conflict' }

export interface SitesMobileShareRepository {
  ensureReady(): Promise<void>
  getOrCreateSecret(key: string): Promise<string>
  deleteRateEventsBefore(timestamp: number): Promise<void>
  findByPayloadHash(payloadHash: string): Promise<MobileShareMetadata | null>
  countRateEvents(windowStart: number, ipHash: string, deviceHash: string): Promise<MobileShareRateCounts>
  create(
    metadata: MobileShareMetadata,
    serializedPayload: string,
    event: { id: string; ipHash: string; deviceHash: string; createdAt: number },
  ): Promise<MobileShareCreation>
  get(id: string): Promise<MobileShareRecord | null>
  stats(windowStart: number): Promise<{ permanent: number; createdLast24Hours: number }>
}

type SitesMobileShareHandlerOptions = {
  now?: () => number
  maxPayloadBytes?: number
  rateWindowMs?: number
  perDeviceLimit?: number
  perIpLimit?: number
  globalLimit?: number
}

export class SitesMobileShareError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'SitesMobileShareError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validateMobileDraft(draft: unknown): void {
  if (
    !isRecord(draft)
    || draft.schemaVersion !== 1
    || !Array.isArray(draft.selectedOperatorIds)
    || draft.selectedOperatorIds.length > 4
    || !Array.isArray(draft.slots)
    || draft.slots.length > 128
    || !isRecord(draft.operatorConfigs)
    || !isRecord(draft.reportNotes ?? {})
  ) {
    throw new SitesMobileShareError(400, 'INVALID_DRAFT', '工作区快照格式不正确。')
  }
  const notes = Object.values(draft.reportNotes ?? {})
  if (notes.length > 128 || notes.some((note) => typeof note !== 'string' || note.length > 160)) {
    throw new SitesMobileShareError(400, 'INVALID_NOTES', '报表批注数量或长度超出限制。')
  }
}

function validateTimelinePayload(payload: unknown, index: number): void {
  if (
    !isRecord(payload)
    || !Array.isArray(payload.selectedCharacters)
    || payload.selectedCharacters.length > 4
    || !isRecord(payload.timelineData)
    || !Array.isArray(payload.timelineData.staffLines)
    || payload.timelineData.staffLines.length > 4
    || !isRecord(payload.skillButtonTable)
    || !Array.isArray(payload.allBuffList)
    || payload.allBuffList.length > 2048
    || !Array.isArray(payload.anomalyStateSnapshots ?? [])
  ) {
    throw new SitesMobileShareError(
      400,
      'INVALID_TIMELINE_PAYLOAD',
      `桌面工作树的第 ${index + 1} 份恢复数据格式不正确。`,
    )
  }
  const buttonCount = Object.keys(payload.skillButtonTable).length
  const timelineButtonCount = payload.timelineData.staffLines.reduce<number>((count, line) => (
    count + (isRecord(line) && Array.isArray(line.buttons) ? line.buttons.length : 0)
  ), 0)
  if (buttonCount > 2048 || timelineButtonCount > 2048) {
    throw new SitesMobileShareError(400, 'TIMELINE_TOO_LARGE', '桌面工作树中的排轴项目过多。')
  }
}

function validateDesktopBundle(bundle: unknown): void {
  if (
    !isRecord(bundle)
    || bundle.type !== 'dmg.timeline-bundle.v2'
    || bundle.schemaVersion !== 2
    || !isRecord(bundle.manifest)
    || !isRecord(bundle.document)
    || !Array.isArray(bundle.payloads)
    || bundle.payloads.length === 0
    || bundle.payloads.length > 512
    || !Array.isArray(bundle.snapshots)
    || bundle.snapshots.length > 1024
    || (bundle.workNodes !== undefined && (!Array.isArray(bundle.workNodes) || bundle.workNodes.length > 1024))
    || (bundle.commits !== undefined && (!Array.isArray(bundle.commits) || bundle.commits.length > 2048))
  ) {
    throw new SitesMobileShareError(400, 'INVALID_DESKTOP_BUNDLE', '桌面工作树格式不正确。')
  }
  bundle.payloads.forEach(validateTimelinePayload)
}

export function validateSitesMobileSharePayload(payload: unknown): asserts payload is Record<string, unknown> {
  if (!isRecord(payload)) {
    throw new SitesMobileShareError(400, 'INVALID_SHARE', '分享数据格式不正确。')
  }
  if (payload.schemaVersion === 1) {
    validateMobileDraft(payload.draft)
  } else if (payload.schemaVersion === 2 && payload.source === 'mobile') {
    validateMobileDraft(payload.draft)
  } else if (payload.schemaVersion === 2 && payload.source === 'desktop') {
    validateDesktopBundle(payload.bundle)
    validateMobileDraft(payload.presentedDraft)
  } else {
    throw new SitesMobileShareError(400, 'INVALID_SHARE', '分享来源或版本不受支持。')
  }
  if (
    typeof payload.dataVersion !== 'string'
    || payload.dataVersion.length > 80
    || typeof payload.imageVersion !== 'string'
    || payload.imageVersion.length > 80
  ) {
    throw new SitesMobileShareError(400, 'INVALID_VERSION', '分享版本信息不正确。')
  }
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function cryptoBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

async function sha256Hex(value: string): Promise<string> {
  return bytesToHex(new Uint8Array(
    await crypto.subtle.digest('SHA-256', cryptoBuffer(utf8Bytes(value))),
  ))
}

async function signDeviceId(deviceId: string, secretHex: string): Promise<string> {
  const secretBytes = new Uint8Array(secretHex.match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) ?? [])
  const key = await crypto.subtle.importKey(
    'raw',
    cryptoBuffer(secretBytes),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return bytesToBase64Url(new Uint8Array(
    await crypto.subtle.sign('HMAC', key, cryptoBuffer(utf8Bytes(deviceId))),
  ))
}

function constantTimeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return difference === 0
}

function hashablePayloadJson(payload: Record<string, unknown>, serialized: string): string {
  if (
    payload.schemaVersion !== 2
    || payload.source !== 'desktop'
    || !isRecord(payload.bundle)
    || !isRecord(payload.bundle.manifest)
  ) return serialized
  return JSON.stringify({
    ...payload,
    bundle: {
      ...payload.bundle,
      manifest: {
        ...payload.bundle.manifest,
        exportedAt: 0,
      },
    },
  })
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, '')
}

function applyCors(request: Request, headers: Headers): void {
  const origin = normalizeOrigin(request.headers.get('Origin') ?? '')
  if (!origin) return
  if (!ALLOWED_ORIGINS.has(origin)) {
    throw new SitesMobileShareError(403, 'ORIGIN_NOT_ALLOWED', '当前网页来源不能访问分享服务。')
  }
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Accept, Content-Type')
  headers.set('Access-Control-Max-Age', '600')
  headers.set('Vary', 'Origin')
}

function jsonResponse(status: number, body: unknown, extraHeaders?: Headers): Response {
  const headers = new Headers(extraHeaders)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(JSON.stringify(body), { status, headers })
}

function readCookie(request: Request, name: string): string {
  const cookieHeader = request.headers.get('Cookie') ?? ''
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(separator + 1).trim())
    } catch {
      return ''
    }
  }
  return ''
}

function buildDeviceCookie(token: string): string {
  return [
    `${MOBILE_SHARE_DEVICE_COOKIE}=${encodeURIComponent(token)}`,
    `Path=${MOBILE_SHARE_API_PATH}`,
    `Max-Age=${MOBILE_SHARE_DEVICE_COOKIE_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
    'Secure',
  ].join('; ')
}

async function resolveDevice(
  request: Request,
  repository: SitesMobileShareRepository,
): Promise<{ id: string; token: string }> {
  const secret = await repository.getOrCreateSecret('device_secret')
  const [deviceId, signature, extra] = readCookie(request, MOBILE_SHARE_DEVICE_COOKIE).split('.')
  if (
    extra === undefined
    && DEVICE_ID_PATTERN.test(deviceId ?? '')
    && DEVICE_SIGNATURE_PATTERN.test(signature ?? '')
  ) {
    const expected = await signDeviceId(deviceId, secret)
    if (constantTimeEqual(expected, signature)) {
      return { id: deviceId, token: `${deviceId}.${expected}` }
    }
  }
  const id = bytesToBase64Url(randomBytes(16))
  return { id, token: `${id}.${await signDeviceId(id, secret)}` }
}

function resolveClientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP')?.trim()
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown'
}

function rowToMetadata(row: Record<string, unknown> | null): MobileShareMetadata | null {
  if (!row) return null
  return {
    id: String(row.id),
    payloadHash: String(row.payloadHash ?? row.payload_hash),
    payloadBytes: Number(row.payloadBytes ?? row.payload_bytes),
    createdAt: Number(row.createdAt ?? row.created_at),
  }
}

const schemaPromises = new WeakMap<object, Promise<void>>()

async function ensureD1Schema(database: D1DatabaseLike): Promise<void> {
  const existing = schemaPromises.get(database as object)
  if (existing) return existing
  const pending = database.batch(
    MOBILE_SHARE_SCHEMA_STATEMENTS.map((statement) => database.prepare(statement)),
  ).then(() => undefined)
  schemaPromises.set(database as object, pending)
  try {
    await pending
  } catch (error) {
    schemaPromises.delete(database as object)
    throw error
  }
}

function shareObjectKey(id: string): string {
  return `mobile-shares/${id}.json`
}

export class D1R2SitesMobileShareRepository implements SitesMobileShareRepository {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly bucket: R2BucketLike,
  ) {}

  async ensureReady(): Promise<void> {
    await ensureD1Schema(this.database)
  }

  async getOrCreateSecret(key: string): Promise<string> {
    await this.ensureReady()
    const existing = await this.database.prepare(
      'SELECT value FROM mobile_share_meta WHERE key = ?',
    ).bind(key).first<{ value: string }>()
    if (existing?.value) return existing.value
    const candidate = bytesToHex(randomBytes(32))
    await this.database.prepare(
      'INSERT OR IGNORE INTO mobile_share_meta (key, value) VALUES (?, ?)',
    ).bind(key, candidate).run()
    const stored = await this.database.prepare(
      'SELECT value FROM mobile_share_meta WHERE key = ?',
    ).bind(key).first<{ value: string }>()
    if (!stored?.value) throw new Error(`Unable to initialize ${key}.`)
    return stored.value
  }

  async deleteRateEventsBefore(timestamp: number): Promise<void> {
    await this.database.prepare(
      'DELETE FROM mobile_share_creation_events WHERE created_at < ?',
    ).bind(timestamp).run()
  }

  async findByPayloadHash(payloadHash: string): Promise<MobileShareMetadata | null> {
    const row = await this.database.prepare(`
      SELECT id, payload_hash AS payloadHash, payload_bytes AS payloadBytes, created_at AS createdAt
      FROM mobile_shares WHERE payload_hash = ?
    `).bind(payloadHash).first<Record<string, unknown>>()
    return rowToMetadata(row)
  }

  async countRateEvents(
    windowStart: number,
    ipHash: string,
    deviceHash: string,
  ): Promise<MobileShareRateCounts> {
    const [device, ip, global] = await Promise.all([
      this.database.prepare(`
        SELECT COUNT(*) AS count FROM mobile_share_creation_events
        WHERE device_hash = ? AND created_at >= ?
      `).bind(deviceHash, windowStart).first<{ count: number }>(),
      this.database.prepare(`
        SELECT COUNT(*) AS count FROM mobile_share_creation_events
        WHERE ip_hash = ? AND created_at >= ?
      `).bind(ipHash, windowStart).first<{ count: number }>(),
      this.database.prepare(`
        SELECT COUNT(*) AS count FROM mobile_share_creation_events
        WHERE created_at >= ?
      `).bind(windowStart).first<{ count: number }>(),
    ])
    return {
      device: Number(device?.count ?? 0),
      ip: Number(ip?.count ?? 0),
      global: Number(global?.count ?? 0),
    }
  }

  async create(
    metadata: MobileShareMetadata,
    serializedPayload: string,
    event: { id: string; ipHash: string; deviceHash: string; createdAt: number },
  ): Promise<MobileShareCreation> {
    const key = shareObjectKey(metadata.id)
    const existingObject = await this.bucket.get(key)
    if (existingObject) return { status: 'id-conflict' }
    await this.bucket.put(key, serializedPayload, {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
      customMetadata: {
        payloadHash: metadata.payloadHash,
        createdAt: String(metadata.createdAt),
      },
    })
    try {
      await this.database.batch([
        this.database.prepare(`
          INSERT INTO mobile_shares (id, payload_hash, payload_bytes, created_at)
          VALUES (?, ?, ?, ?)
        `).bind(metadata.id, metadata.payloadHash, metadata.payloadBytes, metadata.createdAt),
        this.database.prepare(`
          INSERT INTO mobile_share_creation_events (id, ip_hash, device_hash, created_at)
          VALUES (?, ?, ?, ?)
        `).bind(event.id, event.ipHash, event.deviceHash, event.createdAt),
      ])
      return { status: 'created', metadata }
    } catch (error) {
      await this.bucket.delete(key).catch(() => undefined)
      const existing = await this.findByPayloadHash(metadata.payloadHash)
      if (existing) return { status: 'reused', metadata: existing }
      if (String(error).toLowerCase().includes('unique')) return { status: 'id-conflict' }
      throw error
    }
  }

  async get(id: string): Promise<MobileShareRecord | null> {
    const row = await this.database.prepare(`
      SELECT id, payload_hash AS payloadHash, payload_bytes AS payloadBytes, created_at AS createdAt
      FROM mobile_shares WHERE id = ?
    `).bind(id).first<Record<string, unknown>>()
    const metadata = rowToMetadata(row)
    if (!metadata) return null
    const stored = await this.bucket.get(shareObjectKey(id))
    if (!stored) {
      throw new SitesMobileShareError(503, 'SHARE_STORAGE_MISSING', '分享内容暂时无法读取。')
    }
    let payload: unknown
    try {
      payload = JSON.parse(await stored.text())
    } catch {
      throw new SitesMobileShareError(503, 'SHARE_STORAGE_INVALID', '分享内容暂时无法读取。')
    }
    return {
      id,
      createdAt: metadata.createdAt,
      expiresAt: null,
      permanent: true,
      payload,
    }
  }

  async stats(windowStart: number): Promise<{ permanent: number; createdLast24Hours: number }> {
    const [shares, events] = await Promise.all([
      this.database.prepare('SELECT COUNT(*) AS count FROM mobile_shares').first<{ count: number }>(),
      this.database.prepare(`
        SELECT COUNT(*) AS count FROM mobile_share_creation_events WHERE created_at >= ?
      `).bind(windowStart).first<{ count: number }>(),
    ])
    return {
      permanent: Number(shares?.count ?? 0),
      createdLast24Hours: Number(events?.count ?? 0),
    }
  }
}

export function createSitesMobileShareHandler(
  repository: SitesMobileShareRepository,
  options: SitesMobileShareHandlerOptions = {},
): (request: Request) => Promise<Response> {
  const now = options.now ?? (() => Date.now())
  const maxPayloadBytes = options.maxPayloadBytes ?? SITES_MOBILE_SHARE_MAX_PAYLOAD_BYTES
  const rateWindowMs = options.rateWindowMs ?? SITES_MOBILE_SHARE_RATE_WINDOW_MS
  const perDeviceLimit = options.perDeviceLimit ?? SITES_MOBILE_SHARE_PER_DEVICE_LIMIT
  const perIpLimit = options.perIpLimit ?? SITES_MOBILE_SHARE_PER_IP_LIMIT
  const globalLimit = options.globalLimit ?? SITES_MOBILE_SHARE_GLOBAL_LIMIT

  return async (request: Request): Promise<Response> => {
    const headers = new Headers()
    let deviceCookie = ''
    try {
      applyCors(request, headers)
      const url = new URL(request.url)
      if (request.method === 'OPTIONS') {
        headers.set('Cache-Control', 'no-store')
        return new Response(null, { status: 204, headers })
      }

      await repository.ensureReady()
      if (request.method === 'GET' && url.pathname === `${MOBILE_SHARE_API_PATH}/health`) {
        const timestamp = now()
        await repository.deleteRateEventsBefore(timestamp - rateWindowMs)
        const stats = await repository.stats(timestamp - rateWindowMs)
        return jsonResponse(200, {
          ok: true,
          active: stats.permanent,
          permanent: stats.permanent,
          createdLast24Hours: stats.createdLast24Hours,
        }, headers)
      }

      if (request.method === 'POST' && url.pathname === MOBILE_SHARE_API_PATH) {
        const contentType = request.headers.get('Content-Type')?.split(';')[0]?.trim()
        if (contentType !== 'application/json') {
          throw new SitesMobileShareError(415, 'JSON_REQUIRED', '分享接口只接受 JSON。')
        }
        const announcedLength = Number(request.headers.get('Content-Length'))
        if (Number.isFinite(announcedLength) && announcedLength > maxPayloadBytes + 16 * 1024) {
          throw new SitesMobileShareError(413, 'REQUEST_TOO_LARGE', '分享内容过大。')
        }
        const requestText = await request.text()
        if (utf8Bytes(requestText).byteLength > maxPayloadBytes + 16 * 1024) {
          throw new SitesMobileShareError(413, 'REQUEST_TOO_LARGE', '分享内容过大。')
        }
        let payload: unknown
        try {
          payload = JSON.parse(requestText)
        } catch {
          throw new SitesMobileShareError(400, 'INVALID_JSON', '分享请求不是有效的 JSON。')
        }
        validateSitesMobileSharePayload(payload)
        const serialized = JSON.stringify(payload)
        const payloadBytes = utf8Bytes(serialized).byteLength
        if (payloadBytes > maxPayloadBytes) {
          throw new SitesMobileShareError(413, 'PAYLOAD_TOO_LARGE', '分享内容过大，请减少排轴项目后重试。')
        }

        const device = await resolveDevice(request, repository)
        deviceCookie = buildDeviceCookie(device.token)
        const identitySalt = await repository.getOrCreateSecret('identity_salt')
        const ipHash = await sha256Hex(`${identitySalt}:${resolveClientIp(request)}`)
        const deviceHash = await sha256Hex(`${identitySalt}:device:${device.id}`)
        const payloadHash = await sha256Hex(hashablePayloadJson(payload, serialized))
        const existing = await repository.findByPayloadHash(payloadHash)
        if (existing) {
          headers.set('Set-Cookie', deviceCookie)
          return jsonResponse(200, {
            id: existing.id,
            createdAt: existing.createdAt,
            expiresAt: null,
            permanent: true,
            reused: true,
          }, headers)
        }

        const timestamp = now()
        const windowStart = timestamp - rateWindowMs
        await repository.deleteRateEventsBefore(windowStart)
        const counts = await repository.countRateEvents(windowStart, ipHash, deviceHash)
        if (counts.device >= perDeviceLimit) {
          throw new SitesMobileShareError(
            429,
            'DEVICE_DAILY_LIMIT',
            `当前浏览器 24 小时内最多创建 ${perDeviceLimit} 份永久分享。`,
          )
        }
        if (counts.ip >= perIpLimit) {
          throw new SitesMobileShareError(
            429,
            'IP_DAILY_LIMIT',
            `当前网络 24 小时内最多创建 ${perIpLimit} 份永久分享。`,
          )
        }
        if (counts.global >= globalLimit) {
          throw new SitesMobileShareError(
            429,
            'DAILY_LIMIT',
            `服务器 24 小时内最多创建 ${globalLimit} 份永久分享，请稍后再试。`,
          )
        }

        for (let attempt = 0; attempt < 4; attempt += 1) {
          const id = bytesToBase64Url(randomBytes(12))
          const metadata: MobileShareMetadata = {
            id,
            payloadHash,
            payloadBytes,
            createdAt: timestamp,
          }
          const creation = await repository.create(metadata, serialized, {
            id: bytesToBase64Url(randomBytes(12)),
            ipHash,
            deviceHash,
            createdAt: timestamp,
          })
          if (creation.status === 'id-conflict') continue
          headers.set('Set-Cookie', deviceCookie)
          return jsonResponse(creation.status === 'reused' ? 200 : 201, {
            id: creation.metadata.id,
            createdAt: creation.metadata.createdAt,
            expiresAt: null,
            permanent: true,
            reused: creation.status === 'reused',
          }, headers)
        }
        throw new Error('Unable to allocate a share id.')
      }

      const match = url.pathname.match(/^\/api\/mobile-shares\/([A-Za-z0-9_-]{16})$/)
      if (request.method === 'GET' && match && SHARE_ID_PATTERN.test(match[1])) {
        const share = await repository.get(match[1])
        if (!share) throw new SitesMobileShareError(404, 'SHARE_NOT_FOUND', '分享不存在。')
        return jsonResponse(200, share, headers)
      }
      throw new SitesMobileShareError(404, 'NOT_FOUND', '分享接口不存在。')
    } catch (error) {
      if (deviceCookie) headers.set('Set-Cookie', deviceCookie)
      if (error instanceof SitesMobileShareError) {
        return jsonResponse(error.status, { code: error.code, message: error.message }, headers)
      }
      console.error('[sites-mobile-share]', error)
      return jsonResponse(500, { code: 'INTERNAL_ERROR', message: '分享服务暂时不可用。' }, headers)
    }
  }
}

export async function handleSitesMobileShareRequest(
  request: Request,
  env: SitesMobileShareEnv,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (
    url.pathname !== MOBILE_SHARE_API_PATH
    && !url.pathname.startsWith(`${MOBILE_SHARE_API_PATH}/`)
  ) return null
  const repository = new D1R2SitesMobileShareRepository(env.DB, env.MOBILE_SHARES)
  return createSitesMobileShareHandler(repository)(request)
}
