import { resolvePublicPath } from '../../utils/assetResolver';
import {
  normalizeResourceChannel,
  normalizeResourceDeployment,
  type ResourceChannelManifest,
  type ResourceDeploymentManifest,
  type ResourceFileDescriptor,
} from './resourceReleaseCore.ts';
import { sha256Hex } from './resourceIntegrity';
import {
  resolveOfficialResourcePath,
  shouldFallbackToBundledResources,
} from './resourceTransport';

const CHANNEL_PATH = 'resources/stable.json';
const CONTEXT_TTL_MS = 30_000;

export type ResourceReleaseContext = {
  channel: ResourceChannelManifest | null;
  deployment: ResourceDeploymentManifest | null;
  dataManifest: unknown;
  imageManifest: unknown;
  source: 'server' | 'bundled';
  legacy: boolean;
};

let cachedContext: { expiresAt: number; promise: Promise<ResourceReleaseContext> } | null = null;
let requestSequence = 0;

function appendFreshQuery(path: string, key: string): string {
  requestSequence += 1;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}${key}=${Date.now()}${String(requestSequence).padStart(3, '0')}`;
}

async function responseBytes(
  response: Response,
  label: string,
  maxBytes = 8 * 1024 * 1024,
): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`${label}加载失败：HTTP ${response.status}`);
  const declaredBytes = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    throw new Error(`${label}体积超出限制。`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error(`${label}体积超出限制。`);
  return bytes;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes).replace(/^\uFEFF/, '')) as unknown;
  } catch {
    throw new Error(`${label}不是有效 JSON。`);
  }
}

async function fetchVerifiedJson(
  descriptor: ResourceFileDescriptor,
  label: string,
): Promise<unknown> {
  if (descriptor.size > 8 * 1024 * 1024) throw new Error(`${label}体积超出限制。`);
  const url = appendFreshQuery(resolveOfficialResourcePath(descriptor.path), 'sha256');
  const bytes = await responseBytes(await fetch(url, { cache: 'no-store' }), label);
  if (bytes.byteLength !== descriptor.size || await sha256Hex(bytes) !== descriptor.sha256) {
    throw new Error(`${label}校验失败。`);
  }
  return parseJson(bytes, label);
}

async function fetchLegacyContext(): Promise<ResourceReleaseContext> {
  const [dataResponse, imageResponse] = await Promise.all([
    fetch(resolvePublicPath('web-data-manifest.json')),
    fetch(resolvePublicPath('web-image-manifest.json')),
  ]);
  const [dataBytes, imageBytes] = await Promise.all([
    responseBytes(dataResponse, '本地数据清单'),
    responseBytes(imageResponse, '本地图片清单'),
  ]);
  return {
    channel: null,
    deployment: null,
    dataManifest: parseJson(dataBytes, '本地数据清单'),
    imageManifest: parseJson(imageBytes, '本地图片清单'),
    source: 'bundled',
    legacy: true,
  };
}

async function loadChannelContext(): Promise<ResourceReleaseContext> {
  const channelUrl = appendFreshQuery(resolveOfficialResourcePath(CHANNEL_PATH), 'channel');
  let channelResponse: Response;
  try {
    channelResponse = await fetch(channelUrl, { cache: 'no-store' });
  } catch {
    throw new Error('服务器资源通道网络请求失败，请检查网络连接。');
  }
  if (channelResponse.status === 404) return fetchLegacyContext();
  const channelBytes = await responseBytes(channelResponse, '服务器资源通道', 64 * 1024);
  const channel = normalizeResourceChannel(parseJson(channelBytes, '服务器资源通道'));
  const deployment = normalizeResourceDeployment(await fetchVerifiedJson(
    channel.releaseManifest,
    '服务器资源版本清单',
  ));
  if (deployment.releaseVersion !== channel.releaseVersion) {
    throw new Error('服务器资源通道与资源版本不一致。');
  }
  const [dataManifest, imageManifest] = await Promise.all([
    fetchVerifiedJson(deployment.delivery.dataManifest, '服务器数据清单'),
    fetchVerifiedJson(deployment.delivery.imageManifest, '服务器图片清单'),
  ]);
  return {
    channel,
    deployment,
    dataManifest,
    imageManifest,
    source: 'server',
    legacy: false,
  };
}

async function loadContext(): Promise<ResourceReleaseContext> {
  try {
    return await loadChannelContext();
  } catch (error) {
    if (!shouldFallbackToBundledResources()) throw error;
    return fetchLegacyContext();
  }
}

export function fetchCurrentResourceRelease(
  options: { fresh?: boolean } = {},
): Promise<ResourceReleaseContext> {
  const now = Date.now();
  if (!options.fresh && cachedContext && cachedContext.expiresAt > now) {
    return cachedContext.promise;
  }
  const promise = loadContext().catch((error) => {
    if (cachedContext?.promise === promise) cachedContext = null;
    throw error;
  });
  cachedContext = { expiresAt: now + CONTEXT_TTL_MS, promise };
  return promise;
}

export async function fetchLatestResourceReleaseVersion(): Promise<string> {
  const context = await fetchCurrentResourceRelease({ fresh: true });
  if (context.channel) return context.channel.releaseVersion;
  const data = context.dataManifest as { version?: unknown };
  const images = context.imageManifest as { version?: unknown };
  return [data.version, images.version].filter((value): value is string => typeof value === 'string').join(':');
}
