export type WorkNodeTreeSource = 'manual-checkpoint' | 'ai-turn' | 'checkout' | 'restore' | 'discard';

export type WorkNodeTreeStatus = 'draft' | 'validated' | 'blocked' | 'checked-out' | 'restored' | 'discarded';

export type WorkNodeTreeNode = {
  nodeId: string;
  parentNodeId?: string;
  source: WorkNodeTreeSource;
  title: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  status: WorkNodeTreeStatus;
  summary: string;
  diffSummary: string;
  riskFlags: string[];
  conversationId?: string;
  messageId?: string;
  checkoutTouched: boolean;
  buttonCount: number;
  buffCount: number;
  basePayloadRef: string;
  workingPayloadRef: string;
  children: WorkNodeTreeNode[];
};

export type WorkNodeTreeViewModel = {
  nodes: WorkNodeTreeNode[];
  flatNodes: WorkNodeTreeNode[];
  latestNode?: WorkNodeTreeNode;
  nodeCount: number;
  riskCount: number;
};
