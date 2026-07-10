import type { WorkNodeTreeNode } from './workNodeTreeTypes';

export const WORK_NODE_CARD_WIDTH = 168;
export const WORK_NODE_CARD_HEIGHT = 64;

const HORIZONTAL_GAP = 40;
const CONNECTOR_LENGTH = 14;
const CANVAS_PADDING = 32;

export type WorkNodeTreeLayoutNode = {
  node: WorkNodeTreeNode;
  x: number;
  y: number;
};

export type WorkNodeTreeConnector = {
  parentX: number;
  parentBottom: number;
  childXs: number[];
  childTop: number;
};

export type WorkNodeTreeLayout = {
  width: number;
  height: number;
  nodes: WorkNodeTreeLayoutNode[];
  connectors: WorkNodeTreeConnector[];
};

/**
 * Tree geometry is calculated before rendering. Every connector and card uses
 * these coordinates, so nested branches cannot introduce local CSS offsets.
 */
export function buildWorkNodeTreeLayout(roots: WorkNodeTreeNode[]): WorkNodeTreeLayout {
  const nodes: WorkNodeTreeLayoutNode[] = [];
  const connectors: WorkNodeTreeConnector[] = [];
  let nextLeaf = 0;
  let maxDepth = 0;

  const place = (node: WorkNodeTreeNode, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    const childXs = node.children.map((child) => place(child, depth + 1));
    const x = childXs.length
      ? (childXs[0] + childXs[childXs.length - 1]) / 2
      : CANVAS_PADDING + WORK_NODE_CARD_WIDTH / 2 + nextLeaf++ * (WORK_NODE_CARD_WIDTH + HORIZONTAL_GAP);
    const y = CANVAS_PADDING + depth * (WORK_NODE_CARD_HEIGHT + CONNECTOR_LENGTH * 2);

    nodes.push({ node, x, y });
    if (childXs.length) {
      connectors.push({
        parentX: x,
        parentBottom: y + WORK_NODE_CARD_HEIGHT,
        childXs,
        childTop: CANVAS_PADDING + (depth + 1) * (WORK_NODE_CARD_HEIGHT + CONNECTOR_LENGTH * 2),
      });
    }
    return x;
  };

  roots.forEach((root) => place(root, 0));
  const leafCount = Math.max(nextLeaf, 1);
  return {
    width: CANVAS_PADDING * 2 + WORK_NODE_CARD_WIDTH + (leafCount - 1) * (WORK_NODE_CARD_WIDTH + HORIZONTAL_GAP),
    height: CANVAS_PADDING * 2 + (maxDepth + 1) * WORK_NODE_CARD_HEIGHT + maxDepth * CONNECTOR_LENGTH * 2,
    nodes,
    connectors,
  };
}
