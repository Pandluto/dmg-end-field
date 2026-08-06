import { isDesktopWebHost } from './desktopWebHost';

const DESKTOP_MCP_BRIDGE_ORIGIN = 'http://127.0.0.1:31457';
const PUBLISHER_QUERY = '__mcp_fill_publisher';
const REVIEW_GRANT_QUERY = '__mcp_fill_review_grant';
const CAPABILITY_HEADER = 'x-dmg-mcp-fill-capability';
const PUBLISHER_STORAGE_KEY = 'dmg.desktop.mcp-fill-publisher.v1';
const REVIEW_GRANT_STORAGE_KEY = 'dmg.desktop.mcp-fill-review-grant.v1';
const REVIEW_SESSION_STORAGE_KEY = 'dmg.desktop.mcp-fill-review-session.v1';

type McpFillBridgePayload = Record<string, unknown>;

function validCapability(value: string | null): value is string {
  return Boolean(value && /^[a-zA-Z0-9_-]{20,200}$/.test(value));
}

export function captureDesktopMcpCapability(): boolean {
  if (typeof window === 'undefined' || !isDesktopWebHost()) return false;
  const url = new URL(window.location.href);
  const publisher = url.searchParams.get(PUBLISHER_QUERY);
  if (validCapability(publisher)) {
    window.sessionStorage.setItem(PUBLISHER_STORAGE_KEY, publisher);
    url.searchParams.delete(PUBLISHER_QUERY);
  }
  const rawHash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  const queryOffset = rawHash.indexOf('?');
  if (queryOffset >= 0) {
    const route = rawHash.slice(0, queryOffset);
    const hashQuery = new URLSearchParams(rawHash.slice(queryOffset + 1));
    const reviewGrant = hashQuery.get(REVIEW_GRANT_QUERY);
    if (validCapability(reviewGrant)) {
      window.sessionStorage.setItem(REVIEW_GRANT_STORAGE_KEY, reviewGrant);
      window.sessionStorage.removeItem(REVIEW_SESSION_STORAGE_KEY);
      hashQuery.delete(REVIEW_GRANT_QUERY);
    }
    url.hash = `#${route}${hashQuery.size ? `?${hashQuery}` : ''}`;
  }
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  return hasDesktopMcpCapability();
}

export function hasDesktopMcpCapability(): boolean {
  if (typeof window === 'undefined' || !isDesktopWebHost()) return false;
  return validCapability(window.sessionStorage.getItem(PUBLISHER_STORAGE_KEY))
    || hasDesktopMcpReviewAuthority();
}

export function hasDesktopMcpReviewAuthority(): boolean {
  if (typeof window === 'undefined' || !isDesktopWebHost()) return false;
  return validCapability(window.sessionStorage.getItem(REVIEW_GRANT_STORAGE_KEY))
    || validCapability(window.sessionStorage.getItem(REVIEW_SESSION_STORAGE_KEY));
}

async function reviewSessionCapability(): Promise<string> {
  const current = window.sessionStorage.getItem(REVIEW_SESSION_STORAGE_KEY);
  if (validCapability(current)) return current;
  const reviewLaunchGrant = window.sessionStorage.getItem(REVIEW_GRANT_STORAGE_KEY);
  if (!validCapability(reviewLaunchGrant)) {
    throw new Error('MCP 填表审核页必须由 Electron Shell 打开。');
  }
  const response = await fetch(`${DESKTOP_MCP_BRIDGE_ORIGIN}/mcp-fill-host/session`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reviewLaunchGrant }),
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; sessionCapability?: unknown; error?: { message?: unknown } } | null;
  const sessionCapability = typeof payload?.sessionCapability === 'string' ? payload.sessionCapability : null;
  if (!response.ok || !payload?.ok || !validCapability(sessionCapability)) {
    throw new Error(typeof payload?.error?.message === 'string' ? payload.error.message : 'MCP 填表审核授权失败。');
  }
  window.sessionStorage.removeItem(REVIEW_GRANT_STORAGE_KEY);
  window.sessionStorage.setItem(REVIEW_SESSION_STORAGE_KEY, sessionCapability);
  return sessionCapability;
}

async function requestMcpFillHostBridge(
  pathname: string,
  method: 'GET' | 'POST' = 'GET',
  body?: McpFillBridgePayload,
) {
  const reviewRequired = !['/state', '/snapshots/publish'].includes(pathname);
  const capability = reviewRequired
    ? await reviewSessionCapability()
    : window.sessionStorage.getItem(PUBLISHER_STORAGE_KEY)
      || window.sessionStorage.getItem(REVIEW_SESSION_STORAGE_KEY);
  if (!validCapability(capability)) {
    throw new Error('MCP 填表页面必须由 Electron Shell 打开。');
  }
  const response = await fetch(`${DESKTOP_MCP_BRIDGE_ORIGIN}/mcp-fill-host${pathname}`, {
    method,
    cache: 'no-store',
    headers: {
      [CAPABILITY_HEADER]: capability,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({
    ok: false,
    error: { code: 'invalid-host-response', message: `MCP Host 返回了非 JSON 响应（${response.status}）。` },
  })) as McpFillBridgePayload;
  if (!response.ok && typeof payload.ok !== 'boolean') {
    throw new Error(`MCP Fill Host bridge failed: ${response.status}`);
  }
  return payload;
}

export function getMcpFillWebServiceState() {
  return requestMcpFillHostBridge('/state');
}

export function listMcpFillWebProposals() {
  return requestMcpFillHostBridge('/proposals');
}

export function claimMcpFillWebProposal(payload: McpFillBridgePayload) {
  return requestMcpFillHostBridge('/proposals/claim', 'POST', payload);
}

export async function issueMcpFillWebAction(action: 'confirm' | 'reject', binding: {
  proposalId: string;
  reviewSessionId: string;
  expectedRevision: number;
  expectedManifestDigest: string;
}) {
  const response = await requestMcpFillHostBridge('/actions/issue', 'POST', { action, ...binding });
  return String(response.actionCapability || '');
}

export function decideMcpFillWebProposal(payload: McpFillBridgePayload, actionCapability: string) {
  return requestMcpFillHostBridge('/proposals/decision', 'POST', { ...payload, actionCapability });
}

export function confirmAndBeginSaveMcpFillWebProposal(payload: McpFillBridgePayload, actionCapability: string) {
  return requestMcpFillHostBridge('/proposals/confirm', 'POST', { ...payload, actionCapability });
}

export function recordSaveMcpFillWebProposal(payload: McpFillBridgePayload, saveCapability: string) {
  return requestMcpFillHostBridge('/proposals/save-result', 'POST', { ...payload, saveCapability });
}

export function reconcileMcpFillWebSave(payload: McpFillBridgePayload) {
  return requestMcpFillHostBridge('/proposals/save/reconcile', 'POST', payload);
}

export function publishMcpFillWebSnapshot(snapshot: unknown) {
  return requestMcpFillHostBridge('/snapshots/publish', 'POST', { snapshot });
}
