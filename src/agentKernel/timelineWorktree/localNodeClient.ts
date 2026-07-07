import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import type {
  AiTimelineApproval,
  AiTimelineApprovalPolicy,
  AiTimelineRiskFlag,
  AiTimelineWorkNode,
  AiTimelineWorkNodeCommit,
  AiTimelineWorkNodeStatus,
} from './types';

const DEFAULT_REST_BASE_URL = 'http://127.0.0.1:17321';

export type AiTimelineWorkNodeListResponse = {
  ok: true;
  protocolVersion: 1;
  path: string;
  nodes: AiTimelineWorkNode[];
  commits: AiTimelineWorkNodeCommit[];
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

export type CreateAiTimelineWorkNodeInput = {
  saveId: string;
  branchId?: string;
  id?: string;
  label?: string;
  basePayload: TimelineSnapshotPayload;
  workingPayload?: TimelineSnapshotPayload;
  approvalPolicy?: AiTimelineApprovalPolicy;
  riskFlags?: AiTimelineRiskFlag[];
};

export type UpdateAiTimelineWorkNodeInput = {
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

export function createAiTimelineWorkNodeClient(baseUrl = DEFAULT_REST_BASE_URL) {
  return {
    async list(): Promise<AiTimelineWorkNodeListResponse> {
      const desktopRuntime = getDesktopRuntime();
      if (desktopRuntime?.listAiTimelineWorkNodes) {
        const result = readDesktopResult(await desktopRuntime.listAiTimelineWorkNodes());
        return {
          ok: true,
          protocolVersion: 1,
          path: result.path || '',
          nodes: (result.archive?.nodes || []) as AiTimelineWorkNode[],
          commits: (result.archive?.commits || []) as AiTimelineWorkNodeCommit[],
        };
      }
      const response = await fetch(buildUrl(baseUrl, '/api/ai-timeline-worknodes'));
      return readJsonResponse<AiTimelineWorkNodeListResponse>(response);
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
      const response = await fetch(buildUrl(baseUrl, `/api/ai-timeline-worknodes/${encodeURIComponent(id)}`));
      return readJsonResponse<AiTimelineWorkNodeResponse>(response);
    },

    async create(input: CreateAiTimelineWorkNodeInput): Promise<AiTimelineWorkNodeResponse> {
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
      return postJson<AiTimelineWorkNodeResponse>(baseUrl, '/api/ai-timeline-worknodes/create', input);
    },

    async update(id: string, input: UpdateAiTimelineWorkNodeInput): Promise<AiTimelineWorkNodeResponse> {
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
      return postJson<AiTimelineWorkNodeResponse>(
        baseUrl,
        `/api/ai-timeline-worknodes/${encodeURIComponent(id)}/update`,
        input,
      );
    },

    async commit(id: string, input: CommitAiTimelineWorkNodeInput = {}): Promise<AiTimelineWorkNodeCommitResponse> {
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
      return postJson<AiTimelineWorkNodeCommitResponse>(
        baseUrl,
        `/api/ai-timeline-worknodes/${encodeURIComponent(id)}/commit`,
        input,
      );
    },
  };
}
