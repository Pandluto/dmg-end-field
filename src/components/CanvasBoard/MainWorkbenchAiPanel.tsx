import { useMemo } from 'react';
import type { Character, SkillButton } from '../../types';
import { DefOpenCodeView } from '../def-opencode/DefOpenCodeView';
import type { WorkbenchSelectedNodeContext } from './WorkNodeTreePanel';

interface MainWorkbenchAiPanelProps {
  selectedCharacters: Character[];
  skillButtons: SkillButton[];
  timelineId: string;
  timelineLabel: string;
  selectedWorkbenchNode: WorkbenchSelectedNodeContext | null;
  onExit: () => void;
  onWorkNodeChanged?: () => void;
}

export function MainWorkbenchAiPanel({
  selectedCharacters,
  skillButtons,
  timelineId,
  timelineLabel,
  selectedWorkbenchNode,
  onExit,
}: MainWorkbenchAiPanelProps) {
  const workbenchContext = useMemo(() => ({
    schemaVersion: 1,
    source: 'main-workbench-react',
    timeline: {
      id: timelineId,
      name: timelineLabel,
    },
    selectedWorkbenchNode: selectedWorkbenchNode ? {
      id: selectedWorkbenchNode.nodeId,
      name: selectedWorkbenchNode.name,
      description: selectedWorkbenchNode.description,
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
  }), [selectedCharacters, selectedWorkbenchNode, skillButtons, timelineId, timelineLabel]);

  return (
    <DefOpenCodeView
      host="workbench"
      title="DEF 排轴助手"
      onClose={onExit}
      workbenchContext={workbenchContext}
    />
  );
}
