import { normalizeMobileDraft } from './mobileDraft';
import type { MobileDraft } from './model';
import type { TimelineBundleV2 } from '../utils/timelineSnapshotStorage';

export const MOBILE_SHARE_SCHEMA_VERSION = 1 as const;
export const TACTICAL_SHARE_SCHEMA_VERSION = 2 as const;
export const TACTICAL_SHARE_ROUTE_PREFIX = '/share';
export const TACTICAL_SHARE_NODE_ORIGINS = [
  'https://dmgendfield.cloud',
  'https://dmgendfield.online',
] as const;
const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;
const SHARE_API_PATH = '/api/mobile-shares';
const SHARE_FETCH_TIMEOUT_MS = 8_000;

export interface LegacyMobileSharePayload {
  schemaVersion: typeof MOBILE_SHARE_SCHEMA_VERSION;
  dataVersion: string;
  imageVersion: string;
  draft: MobileDraft;
}

export interface MobileSnapshotSharePayload {
  schemaVersion: typeof TACTICAL_SHARE_SCHEMA_VERSION;
  source: 'mobile';
  dataVersion: string;
  imageVersion: string;
  draft: MobileDraft;
}

export interface DesktopWorktreeSharePayload {
  schemaVersion: typeof TACTICAL_SHARE_SCHEMA_VERSION;
  source: 'desktop';
  dataVersion: string;
  imageVersion: string;
  bundle: TimelineBundleV2;
  presentedDraft: MobileDraft;
}

export type MobileSharePayload =
  | LegacyMobileSharePayload
  | MobileSnapshotSharePayload
  | DesktopWorktreeSharePayload;

export interface MobileShareRecord {
  id: string;
  createdAt: number;
  expiresAt: number | null;
  permanent: boolean;
  reused: boolean;
  payload: MobileSharePayload;
}

interface QrCodeModule {
  toDataURL: (text: string, options: Record<string, unknown>) => Promise<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

class MobileShareHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'MobileShareHttpError';
  }
}

function currentOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

function apiUrl(path = '', origin = currentOrigin()): string {
  return new URL(`${SHARE_API_PATH}${path}`, origin).toString();
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => null);
  if (response.ok) return body;
  const message = isRecord(body) && typeof body.message === 'string'
    ? body.message
    : `分享服务暂时不可用（HTTP ${response.status}）。`;
  throw new MobileShareHttpError(response.status, message);
}

function normalizeShareRecord(value: unknown): MobileShareRecord {
  if (!isRecord(value) || !SHARE_ID_PATTERN.test(String(value.id || ''))) {
    throw new Error('分享数据格式不正确。');
  }
  const payload = value.payload;
  if (!isRecord(payload)) {
    throw new Error('该分享版本无法由当前手机版读取。');
  }
  let normalizedPayload: MobileSharePayload;
  if (payload.schemaVersion === MOBILE_SHARE_SCHEMA_VERSION && isRecord(payload.draft)) {
    normalizedPayload = {
      schemaVersion: MOBILE_SHARE_SCHEMA_VERSION,
      dataVersion: typeof payload.dataVersion === 'string' ? payload.dataVersion : '',
      imageVersion: typeof payload.imageVersion === 'string' ? payload.imageVersion : '',
      draft: normalizeMobileDraft(payload.draft),
    };
  } else if (
    payload.schemaVersion === TACTICAL_SHARE_SCHEMA_VERSION
    && payload.source === 'mobile'
    && isRecord(payload.draft)
  ) {
    normalizedPayload = {
      schemaVersion: TACTICAL_SHARE_SCHEMA_VERSION,
      source: 'mobile',
      dataVersion: typeof payload.dataVersion === 'string' ? payload.dataVersion : '',
      imageVersion: typeof payload.imageVersion === 'string' ? payload.imageVersion : '',
      draft: normalizeMobileDraft(payload.draft),
    };
  } else if (
    payload.schemaVersion === TACTICAL_SHARE_SCHEMA_VERSION
    && payload.source === 'desktop'
    && isRecord(payload.bundle)
    && isRecord(payload.presentedDraft)
    && payload.bundle.type === 'dmg.timeline-bundle.v2'
    && payload.bundle.schemaVersion === 2
  ) {
    normalizedPayload = {
      schemaVersion: TACTICAL_SHARE_SCHEMA_VERSION,
      source: 'desktop',
      dataVersion: typeof payload.dataVersion === 'string' ? payload.dataVersion : '',
      imageVersion: typeof payload.imageVersion === 'string' ? payload.imageVersion : '',
      bundle: payload.bundle as unknown as TimelineBundleV2,
      presentedDraft: normalizeMobileDraft(payload.presentedDraft),
    };
  } else {
    throw new Error('该分享版本无法由当前应用读取。');
  }
  const permanent = value.permanent === true || value.expiresAt === null;
  const expiresAt = Number(value.expiresAt);
  return {
    id: String(value.id),
    createdAt: Number(value.createdAt) || Date.now(),
    expiresAt: permanent ? null : (Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : Date.now()),
    permanent,
    reused: value.reused === true,
    payload: normalizedPayload,
  };
}

export function isMobileShareEnabled(): boolean {
  return __DEF_MOBILE_SHARE_ENABLED__;
}

export function buildMobileShareUrl(shareId: string): string {
  if (!SHARE_ID_PATTERN.test(shareId)) throw new Error('分享编号无效。');
  const url = new URL(`${TACTICAL_SHARE_ROUTE_PREFIX}/${shareId}`, TACTICAL_SHARE_NODE_ORIGINS[0]);
  return url.toString();
}

export function parseMobileShareId(value: string): string | null {
  const trimmed = value.trim();
  if (SHARE_ID_PATTERN.test(trimmed)) return trimmed;
  if (trimmed.startsWith('DEFMS1:')) {
    const encodedId = trimmed.slice('DEFMS1:'.length);
    return SHARE_ID_PATTERN.test(encodedId) ? encodedId : null;
  }
  try {
    const url = new URL(trimmed, currentOrigin() || TACTICAL_SHARE_NODE_ORIGINS[0]);
    const pathMatch = url.pathname.match(/^\/share\/([A-Za-z0-9_-]{16})\/?$/);
    if (pathMatch) return pathMatch[1];
    const hashPath = url.hash.replace(/^#/, '').split('?')[0];
    const hashMatch = hashPath.match(/^\/share\/([A-Za-z0-9_-]{16})\/?$/);
    if (hashMatch) return hashMatch[1];
    const shareId = url.searchParams.get('share') || '';
    return SHARE_ID_PATTERN.test(shareId) ? shareId : null;
  } catch {
    return null;
  }
}

export async function createMobileShare(
  draft: MobileDraft,
  dataVersion: string,
  imageVersion: string,
): Promise<MobileShareRecord> {
  const payload: MobileSnapshotSharePayload = {
    schemaVersion: TACTICAL_SHARE_SCHEMA_VERSION,
    source: 'mobile',
    dataVersion,
    imageVersion,
    draft: normalizeMobileDraft(draft),
  };
  return createShare(payload);
}

export async function createDesktopShare(
  bundle: TimelineBundleV2,
  presentedDraft: MobileDraft,
  dataVersion: string,
  imageVersion: string,
): Promise<MobileShareRecord> {
  return createShare({
    schemaVersion: TACTICAL_SHARE_SCHEMA_VERSION,
    source: 'desktop',
    dataVersion,
    imageVersion,
    bundle,
    presentedDraft: normalizeMobileDraft(presentedDraft),
  });
}

async function createShare(payload: MobileSharePayload): Promise<MobileShareRecord> {
  const response = await fetch(apiUrl('', TACTICAL_SHARE_NODE_ORIGINS[0]), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await readJsonResponse(response);
  if (!isRecord(result)) throw new Error('分享服务没有返回有效结果。');
  return normalizeShareRecord({
    ...result,
    payload,
  });
}

export function isMobileSnapshotSharePayload(
  payload: MobileSharePayload,
): payload is LegacyMobileSharePayload | MobileSnapshotSharePayload {
  return payload.schemaVersion === MOBILE_SHARE_SCHEMA_VERSION || payload.source === 'mobile';
}

export function isDesktopWorktreeSharePayload(
  payload: MobileSharePayload,
): payload is DesktopWorktreeSharePayload {
  return payload.schemaVersion === TACTICAL_SHARE_SCHEMA_VERSION && payload.source === 'desktop';
}

export function getMobileShareReadOrigins(): string[] {
  return [currentOrigin(), ...TACTICAL_SHARE_NODE_ORIGINS]
    .filter(Boolean)
    .filter((origin, index, origins) => origins.indexOf(origin) === index);
}

async function fetchShareFromOrigin(
  shareId: string,
  origin: string,
  signal: AbortSignal,
): Promise<MobileShareRecord> {
  const response = await fetch(apiUrl(`/${encodeURIComponent(shareId)}`, origin), {
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal,
  });
  return normalizeShareRecord(await readJsonResponse(response));
}

export async function fetchMobileShare(
  shareId: string,
  origins = getMobileShareReadOrigins(),
): Promise<MobileShareRecord> {
  if (!SHARE_ID_PATTERN.test(shareId)) throw new Error('二维码中的分享编号无效。');
  const candidates = origins
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)
    .filter((origin, index, values) => values.indexOf(origin) === index);
  if (candidates.length === 0) throw new Error('没有可用的分享节点。');

  return new Promise<MobileShareRecord>((resolve, reject) => {
    const controllers = candidates.map(() => new AbortController());
    const errors: unknown[] = [];
    let settled = false;
    let pending = candidates.length;

    const finishFailure = () => {
      if (settled || pending > 0) return;
      const httpErrors = errors.filter((error): error is MobileShareHttpError => (
        error instanceof MobileShareHttpError
      ));
      if (httpErrors.length === errors.length && httpErrors.every((error) => error.status === 404)) {
        reject(new Error('国内、海外分享节点均未找到该内容。'));
        return;
      }
      const formatError = errors.find((error) => (
        error instanceof Error
        && !(error instanceof MobileShareHttpError)
        && error.name !== 'AbortError'
        && error.name !== 'TimeoutError'
        && !(error instanceof TypeError)
      ));
      reject(formatError instanceof Error
        ? formatError
        : new Error('国内、海外分享节点暂时都无法读取，请检查网络后重试。'));
    };

    candidates.forEach((origin, index) => {
      const controller = controllers[index];
      const timeout = globalThis.setTimeout(() => controller.abort('timeout'), SHARE_FETCH_TIMEOUT_MS);
      void fetchShareFromOrigin(shareId, origin, controller.signal).then((share) => {
        if (settled) return;
        settled = true;
        controllers.forEach((candidate, candidateIndex) => {
          if (candidateIndex !== index) candidate.abort('share-found');
        });
        resolve(share);
      }).catch((error) => {
        errors.push(error);
        pending -= 1;
        finishFailure();
      }).finally(() => globalThis.clearTimeout(timeout));
    });
  });
}

export async function createMobileShareQrDataUrl(shareUrl: string): Promise<string> {
  const imported = await import('qrcode');
  const generator = imported as unknown as QrCodeModule;
  return generator.toDataURL(shareUrl, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 320,
    color: { dark: '#172d32', light: '#ffffff' },
  });
}

async function loadImage(file: File): Promise<{ image: HTMLImageElement; release: () => void }> {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  image.src = objectUrl;
  try {
    if (typeof image.decode === 'function') await image.decode();
    else {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('图片读取失败。'));
      });
    }
    return { image, release: () => URL.revokeObjectURL(objectUrl) };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function drawImageRegion(
  image: HTMLImageElement,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
): ImageData | null {
  const maxDimension = 2400;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

export async function decodeMobileShareIdFromImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('请选择 PNG、JPG 或其他图片文件。');
  if (file.size > 24 * 1024 * 1024) throw new Error('图片超过 24MB，请压缩后重试。');

  const { default: jsQr } = await import('jsqr');
  const { image, release } = await loadImage(file);
  try {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height) throw new Error('图片尺寸无效。');

    const regions: Array<[number, number, number, number]> = [
      [0, 0, width, height],
      [Math.floor(width * 0.6), 0, Math.ceil(width * 0.4), height],
      [Math.floor(width * 0.5), Math.floor(height * 0.45), Math.ceil(width * 0.5), Math.ceil(height * 0.55)],
    ];
    for (const region of regions) {
      const imageData = drawImageRegion(image, ...region);
      if (!imageData) continue;
      const result = jsQr(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth',
      });
      const shareId = result?.data ? parseMobileShareId(result.data) : null;
      if (shareId) return shareId;
    }
    throw new Error('图片中没有识别到有效的战术报告二维码。');
  } finally {
    release();
  }
}
