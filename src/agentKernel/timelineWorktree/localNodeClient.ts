import type { TimelineSnapshotPayload } from '../../utils/timelineSnapshotStorage';
import {
  commitWorkNode,
  createWorkNode,
  deleteWorkNode,
  diffWorkNode,
  getWorkNode,
  listAllWorkNodeCommits,
  listAllWorkNodes,
  listWorkNodeHeads,
  markWorkNodeCheckoutApplied,
  markWorkNodeRollbackApplied,
  updateWorkNode,
} from '../../platform/timeline/browserTimelineStore';
import { webDatabase } from '../../platform/database/webDatabase';
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

const BROWSER_REPOSITORY_PATH = 'browser-sqlite://timeline-work-nodes';

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
  timelineId: string;
  branchId: string;
  status: AiTimelineWorkNodeStatus;
  diff: TimelinePayloadDiff;
  riskFlags: AiTimelineRiskFlag[];
  readyToCheckout: boolean;
  checkoutDecision: AiTimelineCheckoutDecision;
};

export type CreateAiTimelineWorkNodeInput = {
  timelineId: string;
  branchId?: string;
  id?: string;
  parentNodeId?: string | null;
  label?: string;
  description?: string;
  basePayload: TimelineSnapshotPayload;
  workingPayload?: TimelineSnapshotPayload;
  approvalPolicy?: AiTimelineApprovalPolicy;
  riskFlags?: AiTimelineRiskFlag[];
};

export type UpdateAiTimelineWorkNodeInput = {
  parentNodeId?: string;
  label?: string;
  description?: string;
  workingPayload?: TimelineSnapshotPayload;
  expectedContentRevision?: number;
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

function toNodeListItem(node: AiTimelineWorkNode): AiTimelineWorkNodeListItem {
  const { basePayload: _basePayload, workingPayload: _workingPayload, ...item } = node;
  return item;
}

function toCommitListItem(
  commit: AiTimelineWorkNodeCommit,
): AiTimelineWorkNodeCommitListItem {
  const { basePayload: _basePayload, appliedPayload: _appliedPayload, ...item } = commit;
  return item;
}

async function buildListResponse(): Promise<AiTimelineWorkNodeListResponse> {
  const [nodes, commits, headState] = await Promise.all([
    listAllWorkNodes(),
    listAllWorkNodeCommits(),
    listWorkNodeHeads(),
  ]);
  return {
    ok: true,
    protocolVersion: 1,
    path: BROWSER_REPOSITORY_PATH,
    nodes: nodes.map(toNodeListItem),
    commits: commits.map(toCommitListItem),
    ...headState,
  };
}

export async function probeAiTimelineWorkNodeRuntime(
  _baseUrl?: string,
  _timeoutMs?: number,
): Promise<void> {
  await webDatabase.initialize();
}

/**
 * Browser-native Work Node client.
 *
 * The optional base URL remains accepted so older callers keep compiling, but
 * the Web LTS never performs a native or server-side transport request.
 */
export function createAiTimelineWorkNodeClient(_baseUrl?: string) {
  return {
    list: buildListResponse,

    async get(id: string): Promise<AiTimelineWorkNodeResponse> {
      return {
        ok: true,
        protocolVersion: 1,
        path: BROWSER_REPOSITORY_PATH,
        node: await getWorkNode(id),
      };
    },

    async delete(id: string): Promise<AiTimelineWorkNodeListResponse> {
      await deleteWorkNode(id);
      return buildListResponse();
    },

    async diff(id: string): Promise<AiTimelineWorkNodeDiffResponse> {
      const result = await diffWorkNode(id);
      return {
        ok: true,
        protocolVersion: 1,
        path: BROWSER_REPOSITORY_PATH,
        nodeId: result.node.id,
        timelineId: result.node.timelineId,
        branchId: result.node.branchId,
        status: result.node.status,
        diff: result.diff,
        riskFlags: result.riskFlags,
        readyToCheckout: result.readyToCheckout,
        checkoutDecision: result.checkoutDecision,
      };
    },

    async create(
      input: CreateAiTimelineWorkNodeInput,
    ): Promise<AiTimelineWorkNodeResponse> {
      return {
        ok: true,
        protocolVersion: 1,
        path: BROWSER_REPOSITORY_PATH,
        node: await createWorkNode(input),
      };
    },

    async update(
      id: string,
      input: UpdateAiTimelineWorkNodeInput,
    ): Promise<AiTimelineWorkNodeResponse> {
      return {
        ok: true,
        protocolVersion: 1,
        path: BROWSER_REPOSITORY_PATH,
        node: await updateWorkNode(id, input),
      };
    },

    async commit(
      id: string,
      input: CommitAiTimelineWorkNodeInput = {},
    ): Promise<AiTimelineWorkNodeCommitResponse> {
      const result = await commitWorkNode(id, input);
      return {
        ok: true,
        protocolVersion: 1,
        path: BROWSER_REPOSITORY_PATH,
        ...result,
      };
    },

    async markCheckoutApplied(
      id: string,
      input: MarkAiTimelineWorkNodeCheckoutAppliedInput = {},
    ): Promise<AiTimelineWorkNodeCommitResponse> {
      const result = await markWorkNodeCheckoutApplied(id, input);
      return {
        ok: true,
        protocolVersion: 1,
        path: BROWSER_REPOSITORY_PATH,
        ...result,
      };
    },

    async markRollbackApplied(
      id: string,
      input: MarkAiTimelineWorkNodeRollbackAppliedInput = {},
    ): Promise<AiTimelineWorkNodeResponse> {
      return {
        ok: true,
        protocolVersion: 1,
        path: BROWSER_REPOSITORY_PATH,
        node: await markWorkNodeRollbackApplied(id, input),
      };
    },
  };
}
