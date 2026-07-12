import { useMemo } from 'react';
import type { Character, SkillButton } from '../../types';
import { DefOpenCodeView } from '../def-opencode/DefOpenCodeView';

interface MainWorkbenchAiPanelProps {
  selectedCharacters: Character[];
  skillButtons: SkillButton[];
  onExit: () => void;
  onWorkNodeChanged?: () => void;
}

export function MainWorkbenchAiPanel({ selectedCharacters, skillButtons, onExit }: MainWorkbenchAiPanelProps) {
  const workbenchContext = useMemo(() => ({
    schemaVersion: 1,
    source: 'main-workbench-react',
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
  }), [selectedCharacters, skillButtons]);

  return (
    <DefOpenCodeView
      host="workbench"
      title="DEF 节点工作台"
      onClose={onExit}
      workbenchContext={workbenchContext}
    />
  );
}
