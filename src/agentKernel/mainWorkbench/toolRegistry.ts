import type { MainWorkbenchCommand } from '../../utils/mainWorkbenchControl';

export type MainWorkbenchToolRiskLevel = 'read' | 'low' | 'medium' | 'high';
export type MainWorkbenchToolApproval = 'none' | 'auto' | 'ai-review' | 'user-confirm';
export type MainWorkbenchToolVerification = 'schema' | 'snapshot' | 'diff' | 'damage-report';
export type MainWorkbenchToolRollback = 'none' | 'optional' | 'required';

export type MainWorkbenchToolDefinition = {
  name: MainWorkbenchCommand['op'];
  title: string;
  scope: 'current-checkout' | 'appdata-work-node';
  riskLevel: MainWorkbenchToolRiskLevel;
  approval: MainWorkbenchToolApproval;
  verification: MainWorkbenchToolVerification[];
  rollback: MainWorkbenchToolRollback;
  description: string;
};

export const MAIN_WORKBENCH_TOOL_REGISTRY: MainWorkbenchToolDefinition[] = [
  {
    name: 'refreshSnapshot',
    title: 'Read current main workbench snapshot',
    scope: 'current-checkout',
    riskLevel: 'read',
    approval: 'none',
    verification: ['schema'],
    rollback: 'none',
    description: 'Read-only evidence for answering questions about the current checkout.',
  },
  {
    name: 'selectCharacters',
    title: 'Replace selected characters',
    scope: 'current-checkout',
    riskLevel: 'high',
    approval: 'ai-review',
    verification: ['snapshot'],
    rollback: 'required',
    description: 'Replace the selected team in the current checkout.',
  },
  {
    name: 'addSkillButton',
    title: 'Add skill button to current checkout',
    scope: 'current-checkout',
    riskLevel: 'low',
    approval: 'auto',
    verification: ['snapshot'],
    rollback: 'optional',
    description: 'Small direct edit for adding one skill button.',
  },
  {
    name: 'removeSkillButton',
    title: 'Remove skill button from current checkout',
    scope: 'current-checkout',
    riskLevel: 'medium',
    approval: 'ai-review',
    verification: ['snapshot'],
    rollback: 'optional',
    description: 'Direct edit for removing an exactly identified skill button.',
  },
  {
    name: 'addBuff',
    title: 'Attach buff to current checkout button',
    scope: 'current-checkout',
    riskLevel: 'medium',
    approval: 'auto',
    verification: ['snapshot'],
    rollback: 'optional',
    description: 'Direct edit for attaching a concrete buff object to one button.',
  },
  {
    name: 'addBuffToButtons',
    title: 'Attach one buff to multiple current checkout buttons',
    scope: 'current-checkout',
    riskLevel: 'medium',
    approval: 'ai-review',
    verification: ['snapshot', 'damage-report'],
    rollback: 'optional',
    description: 'Batch edit for attaching the same concrete buff object to explicit buttonIds.',
  },
  {
    name: 'removeBuff',
    title: 'Remove buff from current checkout button',
    scope: 'current-checkout',
    riskLevel: 'medium',
    approval: 'ai-review',
    verification: ['snapshot'],
    rollback: 'optional',
    description: 'Direct edit for removing an exactly identified buff.',
  },
  {
    name: 'setTargetResistance',
    title: 'Set button target resistance',
    scope: 'current-checkout',
    riskLevel: 'low',
    approval: 'auto',
    verification: ['snapshot', 'damage-report'],
    rollback: 'optional',
    description: 'Direct edit for resistance inputs on one identified button.',
  },
  {
    name: 'createAiTimelineWorkNodeFromCurrent',
    title: 'Create appdata timeline work node',
    scope: 'appdata-work-node',
    riskLevel: 'medium',
    approval: 'auto',
    verification: ['schema'],
    rollback: 'required',
    description: 'Create an appdata/localdata work node from the current checkout.',
  },
  {
    name: 'patchAiTimelineWorkNode',
    title: 'Patch appdata timeline work node',
    scope: 'appdata-work-node',
    riskLevel: 'high',
    approval: 'ai-review',
    verification: ['schema', 'diff'],
    rollback: 'required',
    description: 'Apply a constrained domain patch to node.workingPayload without touching current checkout.',
  },
  {
    name: 'diffAiTimelineWorkNode',
    title: 'Diff appdata timeline work node',
    scope: 'appdata-work-node',
    riskLevel: 'read',
    approval: 'none',
    verification: ['diff'],
    rollback: 'none',
    description: 'Read base/working diff and checkoutDecision from an appdata/localdata work node.',
  },
  {
    name: 'checkoutAiTimelineWorkNode',
    title: 'Checkout appdata timeline work node',
    scope: 'appdata-work-node',
    riskLevel: 'high',
    approval: 'ai-review',
    verification: ['schema', 'diff', 'snapshot'],
    rollback: 'required',
    description: 'Apply a validated work node workingPayload to the current checkout.',
  },
  {
    name: 'restoreAiTimelineWorkNodeBase',
    title: 'Rollback from appdata timeline work node base',
    scope: 'appdata-work-node',
    riskLevel: 'high',
    approval: 'ai-review',
    verification: ['schema', 'snapshot'],
    rollback: 'required',
    description: 'Restore the current checkout from a work node basePayload.',
  },
];

export function summarizeMainWorkbenchToolsForAgent() {
  return MAIN_WORKBENCH_TOOL_REGISTRY.map((tool) => (
    `${tool.name}: scope=${tool.scope}; risk=${tool.riskLevel}; approval=${tool.approval}; verification=${tool.verification.join('+')}; rollback=${tool.rollback}`
  ));
}
