import type { MainWorkbenchSnapshot } from '../../utils/mainWorkbenchControl';

export type MainWorkbenchSnapshotEvidenceFocus = {
  kind: 'skillButton';
  reason: string;
  buttonId: string;
  label?: string;
  characterName?: string;
  skillType?: string;
  skillDisplayName?: string;
  staffIndex?: number;
  lineIndex?: number;
  nodeIndex?: number;
  position?: string;
  buffCount?: number;
  buffs?: string[];
  stale?: boolean;
};

export type MainWorkbenchSnapshotEvidenceFocusState = {
  focus?: MainWorkbenchSnapshotEvidenceFocus | null;
  previousFocus?: MainWorkbenchSnapshotEvidenceFocus | null;
};

export type MainWorkbenchSnapshotEvidence = {
  source: 'current-checkout-snapshot';
  readonly: true;
  note: string[];
  prompt: string;
  inferredGoal?: unknown;
  selectedCharacters: Array<{
    id: string;
    name: string;
    element?: string;
    profession?: string;
  }>;
  focus: MainWorkbenchSnapshotEvidenceFocus | null;
  previousFocus: MainWorkbenchSnapshotEvidenceFocus | null;
  buttons: MainWorkbenchSnapshotEvidenceFocus[];
  mentionedCharacterButtons: MainWorkbenchSnapshotEvidenceFocus[];
  equipment: unknown[];
  damageReport: unknown;
  lastCommand: unknown;
};

export function buildMainWorkbenchButtonEvidence(button: MainWorkbenchSnapshot['skillButtons'][number], reason?: string): MainWorkbenchSnapshotEvidenceFocus;

export function resolveMainWorkbenchSnapshotFocus(
  snapshot: MainWorkbenchSnapshot | null,
  prompt?: string,
  previousFocusOrButtonId?: MainWorkbenchSnapshotEvidenceFocus | string | null,
): MainWorkbenchSnapshotEvidenceFocusState;

export function buildMainWorkbenchEvidence(
  snapshot: MainWorkbenchSnapshot | null,
  options?: {
    prompt?: string;
    previousFocus?: MainWorkbenchSnapshotEvidenceFocus | null;
    previousButtonId?: string;
    focusState?: MainWorkbenchSnapshotEvidenceFocusState;
    inferredGoal?: unknown;
  },
): MainWorkbenchSnapshotEvidence;
