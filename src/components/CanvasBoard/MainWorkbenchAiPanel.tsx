import type { Character, SkillButton } from '../../types';
import { DefOpenCodeView } from '../def-opencode/DefOpenCodeView';

interface MainWorkbenchAiPanelProps {
  selectedCharacters: Character[];
  skillButtons: SkillButton[];
  onExit: () => void;
  onOpenWorkNodePanel?: () => void;
  onWorkNodeChanged?: () => void;
}

export function MainWorkbenchAiPanel({ onExit, onOpenWorkNodePanel }: MainWorkbenchAiPanelProps) {
  return (
    <DefOpenCodeView
      host="workbench"
      title="DEF 节点工作台"
      onClose={onExit}
      onOpenWorkNodePanel={onOpenWorkNodePanel}
    />
  );
}
