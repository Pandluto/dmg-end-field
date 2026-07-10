import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import type {
  AiTimelineApproval,
  AiTimelineApprovalPolicy,
  AiTimelineCheckoutDecision,
  AiTimelineRiskFlag,
  AiTimelineWorkNode,
  AiTimelineWorkNodeCommit,
  AiTimelineWorkNodeCommitListItem,
  AiTimelineWorkNodeListItem,
  AiTimelineWorkNodeStatus,
  TimelinePayloadDiff,
} from './types';

const DEFAULT_REST_BASE_URL = 'http://127.0.0.1:17321';
const DEFAULT_BRIDGE_BASE_URL = 'http://127.0.0.1:31457';
const LIST_CACHE_TTL_MS = 1500;

let listRequestInFlight: Promise<AiTimelineWorkNodeListResponse> | null = null;
let listCachedResponse: AiTimelineWorkNodeListResponse | null = null;
let listCachedAt = 0;
let listCacheGeneration = 0;

export type AiTimelineWorkNodeHead = {
  nodeId: string;
  revision: number;
};

export type AiTimelineWorkNodeListResponse = {
  ok: true;
  protocolVersion: 1;
  path: string;
  nodes: AiTimelineWorkNodeListItem[];
  commits: AiTimelineWorkNodeCommitListItem[];
  heads: Record<string, AiTimelineWorkNodeHead>;
  headNodeId: string;
  revision: number;
};

export type AiTimelineWorkNodeResponse = {
  ok: true;
  protocolVersion: 1;
  path: string;
  node: AiTimelineWorkNode;
};

export type AiTimelineWorkNodeCommitResponse = AiTimelineWorkNodeResponse & {
  commit: AiTimelineWorkNodeCommit;
};

export type AiTimelineWorkNodeDiffResponse = {
  ok: true;
  protocolVersion: 1;
  path: string;
  nodeId: string;
  saveId: string;
  branchId: string;
  status: AiTimelineWorkNodeStatus;
  diff: TimelinePayloadDiff;
  riskFlags: AiTimelineRiskFlag[];
  readyToCheckout: boolean;
  checkoutDecision: AiTimelineCheckoutDecision;
};

export type CreateAiTimelineWorkNodeInput = {
  saveId: string;
  branchId?: string;
  id?: string;
  parentNodeId?: string | null;
  label?: string;
  basePayload: TimelineSnapshotPayload;
  workingPayload?: TimelineSnapshotPayload;
  approvalPolicy?: AiTimelineApprovalPolicy;
  riskFlags?: AiTimelineRiskFlag[];
};

export type UpdateAiTimelineWorkNodeInput = {
  parentNodeId?: string;
  workingPayload?: TimelineSnapshotPayload;
  status?: AiTimelineWorkNodeStatus;
  riskFlags?: AiTimelineRiskFlag[];
};

export type CommitAiTimelineWorkNodeInput = {
  commitId?: string;
  label?: string;
  riskFlags?: AiTimelineRiskFlag[];
  approval?: AiTimelineApproval;
};

export type MarkAiTimelineWorkNodeCheckoutAppliedInput = {
  commitId?: string;
  appliedAt?: number;
  appliedBy?: 'ai' | 'user' | 'system';
  rationale?: string;
};

export type MarkAiTimelineWorkNodeRollbackAppliedInput = {
  appliedAt?: number;
  appliedBy?: 'ai' | 'user' | 'system';
  rationale?: string;
};

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok || !payload?.ok) {
    const message = payload?.error?.message || `AI timeline work node request failed: ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

function buildUrl(baseUrl: string, pathname: string) {
  return `${baseUrl.replace(/\/$/, '')}${pathname}`;
}

function isFetchTransportError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!(error instanceof Error)) return false;
  return /failed to fetch|networkerror|load failed|connection/i.test(error.message);
}

function getDesktopRuntime() {
  return typeof window !== 'undefined' ? window.desktopRuntime : undefined;
}

function readDesktopResult<T extends { ok: boolean; error?: string }>(payload: T | undefined): T {
  if (!payload?.ok) {
    throw new Error(payload?.error || 'Desktop AI timeline work node request failed.');
  }
  return payload;
}

async function postJson<T>(baseUrl: string, pathname: string, body: unknown): Promise<T> {
  const response = await fetch(buildUrl(baseUrl, pathname), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readJsonResponse<T>(response);
}

function toWorkNodeListItem(value: unknown): AiTimelineWorkNodeListItem {
  const node = value as AiTimelineWorkNode;
  const { basePayload: _basePayload, workingPayload: _workingPayload, ...item } = node;
  return item as AiTimelineWorkNodeListItem;
}

function toWorkNodeCommitListItem(value: unknown): AiTimelineWorkNodeCommitListItem {
  const commit = value as AiTimelineWorkNodeCommit;
  const { basePayload: _basePayload, appliedPayload: _appliedPayload, ...item } = commit;
  return item as AiTimelineWorkNodeCommitListItem;
}

function toListResponse(input: {
  path?: string;
  archive?: {
    nodes?: unknown[];
    commits?: unknown[];
    heads?: Record<string, AiTimelineWorkNodeHead>;
    headNodeId?: string;
    revision?: number;
  };
}): AiTimelineWorkNodeListResponse {
  return {
    ok: true,
    protocolVersion: 1,
    path: input.path || '',
    nodes: (input.archive?.nodes || []).map(toWorkNodeListItem),
    commits: (input.archive?.commits || []).map(toWorkNodeCommitListItem),
    heads: input.archive?.heads || {},
    headNodeId: input.archive?.headNodeId || '',
    revision: Number(input.archive?.revision || 0),
  };
}

function cacheListResponse(response: AiTimelineWorkNodeListResponse) {
  listCachedResponse = response;
  listCachedAt = Date.now();
  return response;
}

function invalidateListCache() {
  listCacheGeneration += 1;
  listCachedResponse = null;
  listCachedAt = 0;
  listRequestInFlight = null;
}

async function getBridgeJson<T>(pathname: string): Promise<T | null> {
  try {
    const response = await fetch(buildUrl(DEFAULT_BRIDGE_BASE_URL, pathname), {
      cache: 'no-store',
    });
    return await readJsonResponse<T>(response);
  } catch (error) {
    if (isFetchTransportError(error)) return null;
    throw error;
  }
}

async function postBridgeJson<T>(pathname: string, body: unknown): Promise<T | null> {
  try {
    return await postJson<T>(DEFAULT_BRIDGE_BASE_URL, pathname, body);
  } catch (error) {
    if (isFetchTransportError(error)) return null;
    throw error;
  }
}

export async function probeAiTimelineWorkNodeRuntime(baseUrl = DEFAULT_REST_BASE_URL, timeoutMs = 3500): Promise<void> {
  const desktopRuntime = getDesktopRuntime();
  if (desktopRuntime?.listAiTimelineWorkNodes) return;
  const bridgeProbe = await getBridgeJson<{ ok: true }>('/local-data/ai-timeline-worknodes');
  if (bridgeProbe) return;
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(buildUrl(baseUrl, '/api/ai-timeline-worknodes'), {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`AI timeline work node runtime probe failed: ${response.status}`);
    }
  } catch (error) {
    const errorName = typeof error === 'object' && error && 'name' in error
      ? String((error as { name?: unknown }).name)
      : '';
    if (errorName === 'AbortError') {
      throw new Error('AI timeline work node runtime probe timed out.');
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export function createAiTimelineWorkNodeClient(baseUrl = DEFAULT_REST_BASE_URL) {
  return {
    async list(): Promise<AiTimelineWorkNodeListResponse> {
      if (listCachedResponse && Date.now() - listCachedAt < LIST_CACHE_TTL_MS) {
        return listCachedResponse;
      }
      if (listRequestInFlight) return listRequestInFlight;

      const generation = listCacheGeneration;
      const request = (async () => {
        const desktopRuntime = getDesktopRuntime();
        if (desktopRuntime?.listAiTimelineWorkNodes) {
          const result = readDesktopResult(await desktopRuntime.listAiTimelineWorkNodes());
          return toListResponse(result);
        }
        const bridgeResult = await getBridgeJson<{
          ok: true;
          path?: string;
          archive?: {
            nodes?: unknown[];
            commits?: unknown[];
            heads?: Record<string, AiTimelineWorkNodeHead>;
            headNodeId?: string;
            revision?: number;
          };
        }>('/local-data/ai-timeline-worknodes');
        if (bridgeResult) {
          return toListResponse(bridgeResult);
        }
        const response = await fetch(buildUrl(baseUrl, '/api/ai-timeline-worknodes'));
        const result = await readJsonResponse<{
          ok: true;
          path?: string;
          archive?: { nodes?: unknown[]; commits?: unknown[] };
          nodes?: unknown[];
          commits?: unknown[];
          heads?: Record<string, AiTimelineWorkNodeHead>;
          headNodeId?: string;
          revision?: number;
        }>(response);
        return toListResponse({
          path: result.path,
          archive: result.archive || {
            nodes: result.nodes,
            commits: result.commits,
            heads: result.heads,
            headNodeId: result.headNodeId,
            revision: result.revision,
          },
        });
      })().then((response) => generation === listCacheGeneration ? cacheListResponse(response) : response).finally(() => {
        if (listRequestInFlight === request) listRequestInFlight = null;
      });
      listRequestInFlight = request;
      return request;
    },

    async get(id: string): Promise<AiTimelineWorkNodeResponse> {
      const desktopRuntime = getDesktopRuntime();
      if (desktopRuntime?.readAiTimelineWorkNode) {
        const result = readDesktopResult(await desktopRuntime.readAiTimelineWorkNode({ id }));
        return {
          ok: true,
          protocolVersion: 1,
          path: result.path || '',
          node: result.node as AiTimelineWorkNode,
        };
      }
      const bridgeResult = await getBridgeJson<{
        ok: true;
        path?: string;
        node?: unknown;
      }>(`/local-data/ai-timeline-worknodes/${encodeURIComponent(id)}`);
      if (bridgeResult) {
        return {
          ok: true,
          protocolVersion: 1,
          path: bridgeResult.path || '',
          node: bridgeResult.node as AiTimelineWorkNode,
        };
      }
      const response = await fetch(buildUrl(baseUrl, `/api/ai-timeline-worknodes/${encodeURIComponent(id)}`));
      return readJsonResponse<AiTimelineWorkNodeResponse>(response);
    },

    async delete(id: string): Promise<AiTimelineWorkNodeListResponse> {
      invalidateListCache();
      const desktopRuntime = getDesktopRuntime();
      if (desktopRuntime?.deleteAiTimelineWorkNode) {
        const result = readDesktopResult(await desktopRuntime.deleteAiTimelineWorkNode({ id }));
        return toListResponse(result);
      }
      const bridgeResult = await postBridgeJson<{
        ok: true;
        path?: string;
        archive?: {
          nodes?: unknown[];
          commits?: unknown[];
          heads?: Record<string, AiTimelineWorkNodeHead>;
          headNodeId?: string;
          revision?: number;
        };
      }>(`/local-data/ai-timeline-worknodes/${encodeURIComponent(id)}/delete`, {});
      if (bridgeResult) {
        return toListResponse(bridgeResult);
      }
      const result = await postJson<{
        ok: true;
        path?: string;
        archive?: { nodes?: unknown[]; commits?: unknown[] };
        nodes?: unknown[];
        commits?: unknown[];
        heads?: Record<string, AiTimelineWorkNodeHead>;
        headNodeId?: string;
        revision?: number;
      }>(
        baseUrl,
        `/api/ai-timeline-worknodes/${encodeURIComponent(id)}/delete`,
        {},
      );
      return toListResponse({
        path: result.path,
        archive: result.archive || {
          nodes: result.nodes,
          commits: result.commits,
          heads: result.heads,
          headNodeId: result.headNodeId,
          revision: result.revision,
        },
      });
    },

    async diff(id: string): Promise<AiTimelineWorkNodeDiffResponse> {
      const desktopRuntime = getDesktopRuntime();
      if (desktopRuntime?.diffAiTimelineWorkNode) {
        const result = readDesktopResult(await desktopRuntime.diffAiTimelineWorkNode({ id }));
        return {
          ok: true,
          protocolVersion: 1,
          path: result.path || '',
          nodeId: String(result.nodeId || id),
          saveId: String(result.saveId || ''),
          branchId: String(result.branchId || ''),
          status: (result.status || 'open') as AiTimelineWorkNodeStatus,
          diff: result.diff as TimelinePayloadDiff,
          riskFlags: (result.riskFlags || []) as AiTimelineRiskFlag[],
          readyToCheckout: Boolean(result.readyToCheckout),
          checkoutDecision: result.checkoutDecision as AiTimelineCheckoutDecision,
        };
      }
      const bridgeResult = await getBridgeJson<AiTimelineWorkNodeDiffResponse>(
        `/local-data/ai-timeline-worknodes/${encodeURIComponent(id)}/diff`,
      );
      if (bridgeResult) return bridgeResult;
      const response = await fetch(buildUrl(baseUrl, `/api/ai-timeline-worknodes/${encodeURIComponent(id)}/diff`));
      return readJsonResponse<AiTimelineWorkNodeDiffResponse>(response);
    },

    async create(input: CreateAiTimelineWorkNodeInput): Promise<AiTimelineWorkNodeResponse> {
      invalidateListCache();
      const desktopRuntime = getDesktopRuntime();
      if (desktopRuntime?.createAiTimelineWorkNode) {
        const result = readDesktopResult(await desktopRuntime.createAiTimelineWorkNode(input));
        return {
          ok: true,
          protocolVersion: 1,
          path: result.path || '',
          node: result.node as AiTimelineWorkNode,
        };
      }
      const bridgeResult = await postBridgeJson<{
        ok: true;
        path?: string;
        node?: unknown;
      }>('/local-data/ai-timeline-worknodes/create', input);
      if (bridgeResult) {
        return {
          ok: true,
          protocolVersion: 1,
          path: bridgeResult.path || '',
          node: bridgeResult.node as AiTimelineWorkNode,
        };
      }
      return postJson<AiTimelineWorkNodeResponse>(baseUrl, '/api/ai-timeline-worknodes/create', input);
    },

    async update(id: string, input: UpdateAiTimelineWorkNodeInput): Promise<AiTimelineWorkNodeResponse> {
      invalidateListCache();
      const desktopRuntime = getDesktopRuntime();
      if (desktopRuntime?.updateAiTimelineWorkNode) {
        const result = readDesktopResult(await desktopRuntime.updateAiTimelineWorkNode({ id, ...input }));
        return {
          ok: true,
          protocolVersion: 1,
          path: result.path || '',
          node: result.node as AiTimelineWorkNode,
        };
      }
      const bridgeResult = await postBridgeJson<{
        ok: true;
        path?: string;
        node?: unknown;
      }>(`/local-data/ai-timeline-worknodes/${encodeURIComponent(id)}/update`, input);
      if (bridgeResult) {
        return {
          ok: true,
          protocolVersion: 1,
          path: bridgeResult.path || '',
          node: bridgeResult.node as AiTimelineWorkNode,
        };
      }
      return postJson<AiTimelineWorkNodeResponse>(
        baseUrl,
        `/api/ai-timeline-worknodes/${encodeURIComponent(id)}/update`,
        input,
      );
    },

    async commit(id: string, input: CommitAiTimelineWorkNodeInput = {}): Promise<AiTimelineWorkNodeCommitResponse> {
      invalidateListCache();
      const desktopRuntime = getDesktopRuntime();
      if (desktopRuntime?.commitAiTimelineWorkNode) {
        const result = readDesktopResult(await desktopRuntime.commitAiTimelineWorkNode({ id, ...input }));
        return {
          ok: true,
          protocolVersion: 1,
          path: result.path || '',
          node: result.node as AiTimelineWorkNode,
          commit: result.commit as AiTimelineWorkNodeCommit,
        };
      }
      const bridgeResult = await postBridgeJson<{
        ok: true;
        path?: string;
        node?: unknown;
        commit?: unknown;
      }>(`/local-data/ai-timeline-worknodes/${encodeURIComponent(id)}/commit`, input);
      if (bridgeResult) {
        return {
          ok: true,
          protocolVersion: 1,
          path: bridgeResult.path || '',
          node: bridgeResult.node as AiTimelineWorkNode,
          commit: bridgeResult.commit as AiTimelineWorkNodeCommit,
        };
      }
      return postJson<AiTimelineWorkNodeCommitResponse>(
        baseUrl,
        `/api/ai-timeline-worknodes/${encodeURIComponent(id)}/commit`,
        input,
      );
    },

    async markCheckoutApplied(
      id: string,
      input: MarkAiTimelineWorkNodeCheckoutAppliedInput = {},
    ): Promise<AiTimelineWorkNodeCommitResponse> {
      invalidateListCache();
      const desktopRuntime = getDesktopRuntime();
      if (desktopRuntime?.markAiTimelineWorkNodeCheckoutApplied) {
        const result = readDesktopResult(await desktopRuntime.markAiTimelineWorkNodeCheckoutApplied({ id, ...input }));
        return {
          ok: true,
          protocolVersion: 1,
          path: result.path || '',
          node: result.node as AiTimelineWorkNode,
          commit: result.commit as AiTimelineWorkNodeCommit,
        };
      }
      const bridgeResult = await postBridgeJson<{
        ok: true;
        path?: string;
        node?: unknown;
        commit?: unknown;
      }>(`/local-data/ai-timeline-worknodes/${encodeURIComponent(id)}/checkout-applied`, input);
      if (bridgeResult) {
        return {
          ok: true,
          protocolVersion: 1,
          path: bridgeResult.path || '',
          node: bridgeResult.node as AiTimelineWorkNode,
          commit: bridgeResult.commit as AiTimelineWorkNodeCommit,
        };
      }
      return postJson<AiTimelineWorkNodeCommitResponse>(
        baseUrl,
        `/api/ai-timeline-worknodes/${encodeURIComponent(id)}/checkout-applied`,
        input,
      );
    },

    async markRollbackApplied(
      id: string,
      input: MarkAiTimelineWorkNodeRollbackAppliedInput = {},
    ): Promise<AiTimelineWorkNodeResponse> {
      invalidateListCache();
      const desktopRuntime = getDesktopRuntime();
      if (desktopRuntime?.markAiTimelineWorkNodeRollbackApplied) {
        const result = readDesktopResult(await desktopRuntime.markAiTimelineWorkNodeRollbackApplied({ id, ...input }));
        return {
          ok: true,
          protocolVersion: 1,
          path: result.path || '',
          node: result.node as AiTimelineWorkNode,
        };
      }
      const bridgeResult = await postBridgeJson<{
        ok: true;
        path?: string;
        node?: unknown;
      }>(`/local-data/ai-timeline-worknodes/${encodeURIComponent(id)}/rollback-applied`, input);
      if (bridgeResult) {
        return {
          ok: true,
          protocolVersion: 1,
          path: bridgeResult.path || '',
          node: bridgeResult.node as AiTimelineWorkNode,
        };
      }
      return postJson<AiTimelineWorkNodeResponse>(
        baseUrl,
        `/api/ai-timeline-worknodes/${encodeURIComponent(id)}/rollback-applied`,
        input,
      );
    },
  };
}
