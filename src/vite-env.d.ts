/// <reference types="vite/client" />

declare module '*.mjs' {
  export const buildMainWorkbenchEvidence: (
    snapshot: unknown,
    options?: {
      prompt?: string;
      previousFocus?: unknown;
      previousButtonId?: string;
      focusState?: unknown;
      inferredGoal?: unknown;
    },
  ) => unknown;
  export const resolveMainWorkbenchSnapshotFocus: (
    snapshot: unknown,
    prompt?: string,
    previousFocusOrButtonId?: unknown,
  ) => unknown;
  export const buildMainWorkbenchButtonEvidence: (button: unknown, reason?: string) => unknown;
  export const buildAiTimelineCheckoutDecision: (input?: {
    approvalPolicy?: string;
    riskFlags?: unknown[];
    diff?: unknown;
  }) => unknown;
  export const MAIN_WORKBENCH_SUPPORTED_OPS: readonly string[];
  export const isMainWorkbenchCommandOp: (op: unknown) => boolean;
  export const normalizeMainWorkbenchCommand: (command: unknown) => unknown;
  export const validateMainWorkbenchCommand: (command: unknown) => unknown;
  export const validateMainWorkbenchCommands: (commands: unknown[]) => unknown;
}

interface ImageAssetEntry {
  kind?: 'file' | 'dir';
  fileName: string;
  baseName: string;
  ext: string;
  relativePath: string;
  /** 'builtin' = 项目自带只读素材, 'release' = 发布更新素材, 'user' = 图片根目录素材, 'legacy' = 旧 AppData 素材 */
  source?: 'builtin' | 'release' | 'user' | 'legacy';
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

interface ImageAssetRenamePayload {
  relativePath: string;
  newName: string;
}

interface ImageAssetDeletePayload {
  relativePath: string;
}

interface ImageAssetOpResult {
  ok: boolean;
  error?: string;
}

interface ImageAssetImportItem {
  fileName: string;
  data: string;
}

interface ImageAssetImportFromBrowserPayload {
  items: ImageAssetImportItem[];
  targetDir?: string;
}

interface ImageAssetBatchOpResult {
  ok: boolean;
  results: { fileName: string; ok: boolean; error?: string }[];
  error?: string;
}

interface ImageAssetCreateDirPayload {
  dirName: string;
  parentDir?: string;
}

interface ImageAssetDeleteDirPayload {
  relativePath: string;
}

interface ImageAssetDirOpResult {
  ok: boolean;
  error?: string;
  createdPath?: string;
  lockedFiles?: string[];
}

interface ImageAssetRenameDirPayload {
  dirPath: string;
  newName: string;
}

interface ImageAssetRenameDirResult {
  ok: boolean;
  error?: string;
  newPath?: string;
}

type ImageAssetRevealPayload =
  | { kind: 'file'; relativePath: string }
  | { kind: 'dir'; dirPath: string };

interface ImageAssetRevealResult {
  ok: boolean;
  error?: string;
}

interface EquipmentLibraryFileOpResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  path?: string;
}

type LocalDataSection = 'operators' | 'weapons' | 'equipments' | 'buffs' | 'timeline' | 'runtime' | 'all';
type LocalDataStorageScope = 'local' | 'share';

interface LocalDataArchivePayload {
  type: 'def.localdata.archive.v1';
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  exportedAt: string;
  sections: LocalDataSection[];
  storage: {
    local: Record<string, unknown>;
    session: Record<string, unknown>;
  };
}

interface LocalDataArchiveMeta {
  id: string;
  name: string;
  description?: string;
  fileName: string;
  storageScope: LocalDataStorageScope;
  archiveKey: string;
  directory: string;
  path: string;
  createdAt?: string;
  exportedAt?: string;
  sections: LocalDataSection[];
  localKeys: number;
  sessionKeys: number;
  size: number;
  updatedAt: string;
}

interface LocalDataOpResult {
  ok: boolean;
  error?: string;
  archive?: LocalDataArchivePayload;
  archives?: LocalDataArchiveMeta[];
  meta?: LocalDataArchiveMeta;
  path?: string;
  state?: {
    activeFileName: string | null;
    activeStorageScope?: LocalDataStorageScope;
    updatedAt: string | null;
  };
  sections?: LocalDataSection[];
  localKeys?: number;
  sessionKeys?: number;
  removedLocalKeys?: number;
  removedSessionKeys?: number;
  origin?: string;
  href?: string;
  localKeyNames?: string[];
  sessionKeyNames?: string[];
}

type AiTimelineWorkNodeStatus = 'open' | 'ready' | 'committed' | 'applied' | 'abandoned';
type AiTimelineApprovalPolicy = 'auto-low-risk' | 'ask-on-risk' | 'manual';
type AiTimelineRiskSeverity = 'info' | 'warning' | 'blocker';

interface AiTimelinePayloadSummary {
  characterCount: number;
  buttonCount: number;
  buffCount: number;
}

interface AiTimelineRiskFlagBridge {
  id?: string;
  severity: AiTimelineRiskSeverity;
  code: string;
  message: string;
  path?: string;
}

interface AiTimelineApprovalBridge {
  mode: 'auto' | 'manual';
  approvedAt?: number;
  approvedBy: 'ai' | 'user' | 'system';
  rationale: string;
}

interface AiTimelineWorkNodeBridge {
  id: string;
  parentNodeId?: string;
  timelineId: string;
  /** @deprecated Legacy Electron bridge alias; do not consume in renderer domain code. */
  saveId: string;
  branchId: string;
  createdAt: number;
  updatedAt: number;
  label: string;
  description: string;
  status: AiTimelineWorkNodeStatus;
  basePayload: unknown;
  workingPayload: unknown;
  baseSummary: AiTimelinePayloadSummary;
  workingSummary: AiTimelinePayloadSummary;
  approvalPolicy: AiTimelineApprovalPolicy;
  riskFlags: AiTimelineRiskFlagBridge[];
  logs: unknown[];
}

interface AiTimelineWorkNodeCommitBridge {
  id: string;
  nodeId: string;
  timelineId: string;
  /** @deprecated Legacy Electron bridge alias; do not consume in renderer domain code. */
  saveId: string;
  branchId: string;
  createdAt: number;
  label: string;
  summary: unknown;
  basePayload: unknown;
  appliedPayload: unknown;
  riskFlags: AiTimelineRiskFlagBridge[];
  approval: AiTimelineApprovalBridge;
  checkoutApplied: boolean;
  checkout?: {
    appliedAt: number;
    appliedBy: 'ai' | 'user' | 'system';
    rationale: string;
  };
}

interface AiTimelineWorkNodeArchiveBridge {
  type: 'def.ai-timeline.worknodes.v1';
  schemaVersion: 1;
  nodes: AiTimelineWorkNodeBridge[];
  commits: AiTimelineWorkNodeCommitBridge[];
  heads?: Record<string, { nodeId: string; revision: number }>;
  headNodeId?: string;
  revision?: number;
}

interface AiTimelineWorkNodeOpResult {
  ok: boolean;
  error?: string;
  path?: string;
  archive?: AiTimelineWorkNodeArchiveBridge;
  node?: AiTimelineWorkNodeBridge;
  commit?: AiTimelineWorkNodeCommitBridge;
  nodeId?: string;
  timelineId?: string;
  /** @deprecated Legacy Electron bridge alias; read only at the bridge boundary. */
  saveId?: string;
  branchId?: string;
  status?: AiTimelineWorkNodeStatus;
  diff?: unknown;
  riskFlags?: AiTimelineRiskFlagBridge[];
  readyToCheckout?: boolean;
  checkoutDecision?: unknown;
}

interface ImageAssetImportToDirPayload {
  targetDir?: string;
}

interface ImageAssetImportToDirResult {
  ok: boolean;
  error?: string;
  imported?: string[];
}

interface DesktopRuntimeBridge {
  role?: 'main' | 'shell' | string;
  listImageAssets?: () => Promise<ImageAssetEntry[]>;
  importImageAssets?: () => Promise<ImageAssetEntry[]>;
  importImageAssetsToDir?: (payload: ImageAssetImportToDirPayload) => Promise<ImageAssetImportToDirResult>;
  renameImageAsset?: (payload: ImageAssetRenamePayload) => Promise<ImageAssetOpResult>;
  renameImageDirectory?: (payload: ImageAssetRenameDirPayload) => Promise<ImageAssetRenameDirResult>;
  deleteImageAsset?: (payload: ImageAssetDeletePayload) => Promise<ImageAssetOpResult>;
  importImageAssetsFromBrowser?: (payload: ImageAssetImportFromBrowserPayload) => Promise<ImageAssetBatchOpResult>;
  createImageDirectory?: (payload: ImageAssetCreateDirPayload) => Promise<ImageAssetDirOpResult>;
  deleteImageDirectory?: (payload: ImageAssetDeleteDirPayload) => Promise<ImageAssetDirOpResult>;
  revealInExplorer?: (payload: ImageAssetRevealPayload) => Promise<ImageAssetRevealResult>;
  readEquipmentLibrary?: () => Promise<EquipmentLibraryFileOpResult>;
  writeEquipmentLibrary?: (payload: unknown) => Promise<EquipmentLibraryFileOpResult>;
  getUserWorkspaceState?: () => Promise<{
    ok: boolean;
    workspace?: { values: Record<string, string | null>; updatedAt: number } | null;
    error?: string;
    code?: string;
  }>;
  putUserWorkspaceState?: (payload: { values: Record<string, string | null>; updatedAt?: number }) => Promise<{
    ok: boolean;
    workspace?: { values: Record<string, string | null>; updatedAt: number };
    error?: string;
    code?: string;
  }>;
  restoreUserWorkspaceSnapshot?: (payload: { timelineId: string; snapshotId: string; updatedAt?: number }) => Promise<{
    ok: boolean;
    payload?: unknown;
    checkoutRef?: unknown;
    error?: string;
    code?: string;
  }>;
  migrateBrowserLegacyArchive?: (payload: { sourceName?: string; archive: unknown }) => Promise<{
    ok: boolean;
    results?: unknown[];
    error?: string;
    code?: string;
  }>;
  runDataManagementLegacyMigration?: () => Promise<{
    ok: boolean;
    results?: unknown[];
    state?: unknown;
    error?: string;
    code?: string;
  }>;
  listLocalDataArchives?: () => Promise<LocalDataOpResult>;
  saveLocalDataArchive?: (payload: LocalDataArchivePayload & { storageScope?: LocalDataStorageScope }) => Promise<LocalDataOpResult>;
  readLocalDataArchive?: (payload: { id?: string; fileName?: string; storageScope?: LocalDataStorageScope }) => Promise<LocalDataOpResult>;
  prepareDataPackageApply?: (payload: { id?: string; fileName?: string; storageScope?: LocalDataStorageScope }) => Promise<LocalDataOpResult & { sharedArchives?: unknown }>;
  writeSharedArchivesToDataPackage?: (payload: { id?: string; fileName?: string; storageScope?: LocalDataStorageScope }) => Promise<LocalDataOpResult & { result?: { archiveCount?: number } }>;
  deleteLocalDataArchive?: (payload: { id?: string; fileName?: string; storageScope?: LocalDataStorageScope }) => Promise<LocalDataOpResult>;
  revealLocalDataArchive?: (payload?: { id?: string; fileName?: string; storageScope?: LocalDataStorageScope }) => Promise<LocalDataOpResult>;
  listAiTimelineWorkNodes?: () => Promise<AiTimelineWorkNodeOpResult>;
  createAiTimelineWorkNode?: (payload: unknown) => Promise<AiTimelineWorkNodeOpResult>;
  readAiTimelineWorkNode?: (payload: { id: string } | string) => Promise<AiTimelineWorkNodeOpResult>;
  diffAiTimelineWorkNode?: (payload: { id: string } | string) => Promise<AiTimelineWorkNodeOpResult>;
  updateAiTimelineWorkNode?: (payload: { id: string; [key: string]: unknown }) => Promise<AiTimelineWorkNodeOpResult>;
  commitAiTimelineWorkNode?: (payload: { id: string; [key: string]: unknown }) => Promise<AiTimelineWorkNodeOpResult>;
  markAiTimelineWorkNodeCheckoutApplied?: (payload: { id: string; [key: string]: unknown }) => Promise<AiTimelineWorkNodeOpResult>;
  markAiTimelineWorkNodeRollbackApplied?: (payload: { id: string; [key: string]: unknown }) => Promise<AiTimelineWorkNodeOpResult>;
  deleteAiTimelineWorkNode?: (payload: { id: string } | string) => Promise<AiTimelineWorkNodeOpResult>;
}

interface Window {
  desktopRuntime?: DesktopRuntimeBridge;
}
