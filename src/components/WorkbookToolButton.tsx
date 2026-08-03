import type { MouseEventHandler, ReactNode } from 'react';

type WorkbookToolIcon = 'new' | 'save' | 'normalize' | 'protect' | 'export' | 'import';

const ICONS: Record<WorkbookToolIcon, ReactNode> = {
  new: <path d="M8 3.25v9.5M3.25 8h9.5" />,
  save: <><path d="M3.25 2.75h7.5l2.25 2.25v8.25H3.25z" /><path d="M5.25 2.75v3.5h4.5v-3.5M5.25 10.25h5.5" /></>,
  normalize: <><path d="M4 4.5h7.5M4 8h5.5M4 11.5h7.5" /><path d="M11 3.25l1.75 1.25L11 5.75" /></>,
  protect: <><path d="M8 2.5l4 1.5v3.25c0 2.5-1.5 4.75-4 6.25-2.5-1.5-4-3.75-4-6.25V4z" /><path d="M6.25 8.25L7.4 9.4l2.35-2.55" /></>,
  export: <><path d="M8 3v6.5" /><path d="M5.75 7.25L8 9.5l2.25-2.25" /><path d="M3.5 11.75h9" /></>,
  import: <><path d="M8 13V6.5" /><path d="M5.75 8.75L8 6.5l2.25 2.25" /><path d="M3.5 3.25h9" /></>,
};

interface WorkbookToolButtonProps {
  icon: WorkbookToolIcon;
  label: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
}

export function WorkbookToolButton({
  icon,
  label,
  title,
  active = false,
  disabled = false,
  onClick,
}: WorkbookToolButtonProps) {
  return (
    <button
      type="button"
      className={`buff-sheet-tool-button${active ? ' is-active' : ''}`}
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      <span className="buff-sheet-tool-icon" aria-hidden="true">
        <svg className="buff-sheet-tool-svg" viewBox="0 0 16 16" focusable="false">{ICONS[icon]}</svg>
      </span>
      <span className="buff-sheet-tool-text">{label}</span>
    </button>
  );
}
