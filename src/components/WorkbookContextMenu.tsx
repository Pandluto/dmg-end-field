export type WorkbookContextMenuIcon = 'new' | 'delete' | 'collapse' | 'expand' | 'open' | 'copy';

export interface WorkbookContextMenuAction {
  key: string;
  label: string;
  icon: WorkbookContextMenuIcon;
  onClick: () => void;
}

interface WorkbookContextMenuProps {
  x: number;
  y: number;
  actions: readonly WorkbookContextMenuAction[];
  onClose: () => void;
  presentation?: 'workbook' | 'equipment';
}

const WORKBOOK_ICON_PATHS: Record<WorkbookContextMenuIcon, readonly string[]> = {
  new: ['M8 3.25v9.5M3.25 8h9.5'],
  delete: ['M4.25 5.25h7.5', 'M6.25 2.75h3.5', 'M5.25 5.25v6.5M8 5.25v6.5M10.75 5.25v6.5', 'M4.75 5.25l.5 7h5.5l.5-7'],
  collapse: ['M3.25 5.25h9.5', 'M5.75 8h6.5', 'M8.25 10.75h4'],
  expand: ['M3.25 5.25h9.5', 'M3.25 8h9.5', 'M3.25 10.75h9.5'],
  open: ['M3.25 4.25h3l1.25 1.5h5.25v6.5H3.25z', 'M7.5 5.75h5.25'],
  copy: ['M5.25 4.25h5.5v7.5h-5.5z', 'M8.75 4.25V3.25h-4.5v6.5h1'],
};

const EQUIPMENT_ICON_PATHS: Record<WorkbookContextMenuIcon, readonly string[]> = {
  ...WORKBOOK_ICON_PATHS,
  collapse: ['M4 8h8'],
  expand: ['M8 4v8M4 8h8'],
  open: ['M5.75 4.25h6v6M11.75 4.25L4.25 11.75'],
};

function renderIconPaths(icon: WorkbookContextMenuIcon, presentation: 'workbook' | 'equipment') {
  const paths = presentation === 'equipment' ? EQUIPMENT_ICON_PATHS[icon] : WORKBOOK_ICON_PATHS[icon];
  return paths.map((path) => <path key={path} d={path} />);
}

export function WorkbookContextMenu({
  x,
  y,
  actions,
  onClose,
  presentation = 'workbook',
}: WorkbookContextMenuProps) {
  const isEquipment = presentation === 'equipment';

  return (
    <div
      className="buff-sheet-context-menu"
      style={isEquipment ? { left: x, top: y } : { left: `${x}px`, top: `${y}px` }}
      onClick={isEquipment ? (event) => event.stopPropagation() : undefined}
      onPointerDown={isEquipment ? undefined : (event) => event.stopPropagation()}
      onContextMenu={isEquipment ? undefined : (event) => event.preventDefault()}
    >
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          className="buff-sheet-context-menu-item"
          onClick={() => {
            action.onClick();
            onClose();
          }}
        >
          {isEquipment ? (
            <svg className="buff-sheet-context-menu-svg" viewBox="0 0 16 16" focusable="false">
              {renderIconPaths(action.icon, 'equipment')}
            </svg>
          ) : (
            <span className="buff-sheet-context-menu-icon" aria-hidden="true">
              <svg className="buff-sheet-context-menu-svg" viewBox="0 0 16 16" focusable="false">
                {renderIconPaths(action.icon, 'workbook')}
              </svg>
            </span>
          )}
          <span className={isEquipment ? undefined : 'buff-sheet-context-menu-label'}>{action.label}</span>
        </button>
      ))}
    </div>
  );
}
