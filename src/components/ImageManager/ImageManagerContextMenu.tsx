import { createPortal } from 'react-dom';
import type { CtxTarget, DirActions, FileActions } from './types';

interface ImageManagerContextMenuProps {
  ctxMenu: { x: number; y: number; target: CtxTarget } | null;
  dirActions?: DirActions;
  fileActions?: FileActions;
  onClose: () => void;
  onCreateFolder: (dir: string) => void;
  onImportToDir: (dir: string) => void;
  onRenameDir: (target: CtxTarget) => void;
  onDeleteDir: (dir: string) => void;
  onReveal: (target: CtxTarget) => void;
  onRenameFile: (target: CtxTarget) => void;
  onDeleteFile: (target: CtxTarget) => void;
  onCopyPath: (target: CtxTarget) => void;
}

export function ImageManagerContextMenu(props: ImageManagerContextMenuProps) {
  const {
    ctxMenu,
    dirActions,
    fileActions,
    onClose,
    onCreateFolder,
    onImportToDir,
    onRenameDir,
    onDeleteDir,
    onReveal,
    onRenameFile,
    onDeleteFile,
    onCopyPath,
  } = props;

  if (!ctxMenu || typeof document === 'undefined') return null;

  const { x, y, target } = ctxMenu;

  const menu = (
    <div className="operator-draft-modal-overlay image-manager-ctx-menu-overlay" onClick={onClose}>
      {target.kind === 'dir' ? (
        <div
          className="image-manager-ctx-menu"
          style={{ left: x, top: y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="image-manager-ctx-menu-header">{target.label}</div>
          <button
            type="button"
            disabled={!dirActions?.canCreateDir}
            title={!dirActions?.canCreateDir ? (dirActions?.reason || '不可用') : `在 ${target.label} 下新建文件夹`}
            onClick={() => onCreateFolder(target.dir)}
          >
            新建文件夹
          </button>
          <button
            type="button"
            disabled={!dirActions?.canImport}
            title={!dirActions?.canImport ? (dirActions?.reason || '不可用') : `导入图片到 ${target.label}`}
            onClick={() => onImportToDir(target.dir)}
          >
            导入图片到此处
          </button>
          <button
            type="button"
            disabled={!dirActions?.canRenameDir}
            title={!dirActions?.canRenameDir ? (dirActions?.reason || '根目录不可重命名') : `重命名 ${target.label}`}
            onClick={() => onRenameDir(target)}
          >
            重命名文件夹
          </button>
          <button
            type="button"
            disabled={!dirActions?.canDeleteDir}
            title={!dirActions?.canDeleteDir ? '根目录或非管理目录不可删除' : `删除 ${target.label}`}
            onClick={() => onDeleteDir(target.dir)}
          >
            删除文件夹
          </button>
          <button
            type="button"
            disabled={!dirActions?.canReveal}
            title={!dirActions?.canReveal ? (dirActions?.reason || '不可用') : '在系统资源管理器中打开'}
            onClick={() => onReveal(target)}
          >
            在资源管理器中打开
          </button>
        </div>
      ) : (
        <div
          className="image-manager-ctx-menu"
          style={{ left: x, top: y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="image-manager-ctx-menu-header">{target.fileName}</div>
          <button
            type="button"
            disabled={!fileActions?.canRename}
            title={!fileActions?.canRename ? (fileActions?.reason || '不可用') : `重命名 ${target.fileName}`}
            onClick={() => onRenameFile(target)}
          >
            重命名
          </button>
          <button
            type="button"
            disabled={!fileActions?.canDelete}
            title={!fileActions?.canDelete ? (fileActions?.reason || '不可用') : `删除 ${target.fileName}`}
            onClick={() => onDeleteFile(target)}
          >
            删除
          </button>
          <button
            type="button"
            disabled={!fileActions?.canReveal}
            title={!fileActions?.canReveal ? (fileActions?.reason || '不可用') : '在系统资源管理器中显示'}
            onClick={() => onReveal(target)}
          >
            在资源管理器中显示
          </button>
          <button
            type="button"
            disabled={!fileActions?.canCopyPath}
            title="复制可用于头像/技能输入的路径"
            onClick={() => onCopyPath(target)}
          >
            复制可用路径
          </button>
        </div>
      )}
    </div>
  );

  return createPortal(menu, document.body);
}
