import { normalizeMobileDraft } from './mobileDraft';
import type { MobileDraft } from './model';

export const MOBILE_SHARE_SCHEMA_VERSION = 1 as const;
const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;
const SHARE_API_PATH = '/api/mobile-shares';

export interface MobileSharePayload {
  schemaVersion: typeof MOBILE_SHARE_SCHEMA_VERSION;
  dataVersion: string;
  imageVersion: string;
  draft: MobileDraft;
}

export interface MobileShareRecord {
  id: string;
  createdAt: number;
  expiresAt: number;
  payload: MobileSharePayload;
}

interface QrCodeModule {
  toDataURL: (text: string, options: Record<string, unknown>) => Promise<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function apiUrl(path = ''): string {
  return new URL(`${SHARE_API_PATH}${path}`, window.location.origin).toString();
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => null);
  if (response.ok) return body;
  const message = isRecord(body) && typeof body.message === 'string'
    ? body.message
    : `分享服务暂时不可用（HTTP ${response.status}）。`;
  throw new Error(message);
}

function normalizeShareRecord(value: unknown): MobileShareRecord {
  if (!isRecord(value) || !SHARE_ID_PATTERN.test(String(value.id || ''))) {
    throw new Error('分享数据格式不正确。');
  }
  const payload = value.payload;
  if (
    !isRecord(payload)
    || payload.schemaVersion !== MOBILE_SHARE_SCHEMA_VERSION
    || !isRecord(payload.draft)
  ) {
    throw new Error('该分享版本无法由当前手机版读取。');
  }
  return {
    id: String(value.id),
    createdAt: Number(value.createdAt) || Date.now(),
    expiresAt: Number(value.expiresAt) || Date.now(),
    payload: {
      schemaVersion: MOBILE_SHARE_SCHEMA_VERSION,
      dataVersion: typeof payload.dataVersion === 'string' ? payload.dataVersion : '',
      imageVersion: typeof payload.imageVersion === 'string' ? payload.imageVersion : '',
      draft: normalizeMobileDraft(payload.draft),
    },
  };
}

export function isMobileShareEnabled(): boolean {
  return __DEF_MOBILE_SHARE_ENABLED__;
}

export function buildMobileShareUrl(shareId: string): string {
  const url = new URL('/mobile', window.location.origin);
  url.searchParams.set('share', shareId);
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
    const url = new URL(trimmed, window.location.origin);
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
  const payload: MobileSharePayload = {
    schemaVersion: MOBILE_SHARE_SCHEMA_VERSION,
    dataVersion,
    imageVersion,
    draft: normalizeMobileDraft(draft),
  };
  const response = await fetch(apiUrl(), {
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

export async function fetchMobileShare(shareId: string): Promise<MobileShareRecord> {
  if (!SHARE_ID_PATTERN.test(shareId)) throw new Error('二维码中的分享编号无效。');
  const response = await fetch(apiUrl(`/${encodeURIComponent(shareId)}`), {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  return normalizeShareRecord(await readJsonResponse(response));
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
