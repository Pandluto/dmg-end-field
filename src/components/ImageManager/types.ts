export interface ImageAssetEntry {
  kind?: 'file' | 'dir';
  fileName: string;
  baseName: string;
  ext: string;
  relativePath: string;
  /** 'builtin' = 项目自带只读素材, 'user' = 图片根目录素材, 'legacy' = 旧 AppData 素材 */
  source?: 'builtin' | 'user' | 'legacy';
  /** Canonical browser-facing path. New references should prefer user-images/<fileName>. */
  canonicalPath?: string;
  publicUrl?: string;
  rootId?: string;
  rootLabel?: string;
  rootDirectory?: string;
  rootPriority?: number;
  conflictCount?: number;
  mappingWinner?: boolean;
  mappingKey?: string;
  writable: boolean;
  sizeBytes: number;
  updatedAt: number;
}

/** Recursive directory tree node for IDE-style explorer. */
export interface TreeNode {
  name: string;
  path: string;
  isManaged: boolean;
  count: number;
  children: TreeNode[];
}

/** Discriminated context-menu target. */
export type CtxTarget =
  | { kind: 'dir'; dir: string; label: string; isRoot: boolean; isManaged: boolean }
  | { kind: 'file'; relativePath: string; fileName: string; isManaged: boolean };

/** Action capabilities for a directory context menu. */
export interface DirActions {
  canCreateDir: boolean;
  canImport: boolean;
  canRenameDir: boolean;
  canDeleteDir: boolean;
  canReveal: boolean;
  reason?: string;
}

/** Action capabilities for a file context menu. */
export interface FileActions {
  canRename: boolean;
  canDelete: boolean;
  canReveal: boolean;
  canCopyPath: boolean;
  reason?: string;
}
