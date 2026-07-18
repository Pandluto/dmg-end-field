import { useMemo } from 'react';
import type { Character, SkillButton } from '../../types';
import { DefOpenCodeView } from '../def-opencode/DefOpenCodeView';
import type { WorkbenchSelectedNodeContext } from './WorkNodeTreePanel';

interface MainWorkbenchAiPanelProps {
  selectedCharacters: Character[];
  skillButtons: SkillButton[];
  timelineId: string;
  timelineLabel: string;
  timelineIsTemporary: boolean;
  checkoutWorkbenchNode: WorkbenchSelectedNodeContext | null;
  onExit: () => void;
  onWorkNodeChanged?: () => void;
}

export function MainWorkbenchAiPanel({
  selectedCharacters,
  skillButtons,
  timelineId,
  timelineLabel,
  timelineIsTemporary,
  checkoutWorkbenchNode,
  onExit,
}: MainWorkbenchAiPanelProps) {
  const workbenchContext = useMemo(() => ({
    schemaVersion: 1,
    source: 'main-workbench-react',
    timeline: {
      id: timelineId,
      name: timelineLabel,
    },
    selectedWorkbenchNode: checkoutWorkbenchNode ? {
      id: checkoutWorkbenchNode.nodeId,
      name: checkoutWorkbenchNode.name,
      description: checkoutWorkbenchNode.description,
    } : null,
    selectedCharacters: selectedCharacters.map((character) => ({
      id: character.id,
      name: character.name,
      element: character.element,
      profession: character.profession,
    })),
    skillButtons: skillButtons.map((button) => ({
      id: button.id,
      characterId: button.characterId,
      characterName: button.characterName,
      skillType: button.skillType,
      skillDisplayName: button.skillDisplayName,
      runtimeSkillId: button.runtimeSkillId,
      staffIndex: button.staffIndex,
      lineIndex: button.lineIndex,
      nodeIndex: button.nodeIndex,
      nodeNumber: button.nodeNumber,
      position: button.position,
    })),
  }), [checkoutWorkbenchNode, selectedCharacters, skillButtons, timelineId, timelineLabel]);

  return (
    <DefOpenCodeView
      key={`workbench-${timelineId}`}
      host="workbench"
      title="DEF 排轴助手"
      onClose={onExit}
      workbenchContext={workbenchContext}
      timelineId={timelineId}
      workbenchIsTemporary={timelineIsTemporary}
    />
  );
}
