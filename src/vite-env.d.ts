/// <reference types="vite/client" />

interface ImageAssetEntry {
  kind?: 'file' | 'dir';
  fileName: string;
  baseName: string;
  ext: string;
  relativePath: string;
  /** 'builtin' = 项目自带只读素材, 'user' = 用户可写素材 */
  source?: 'builtin' | 'user';
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
  listLocalDataArchives?: () => Promise<LocalDataOpResult>;
  saveLocalDataArchive?: (payload: LocalDataArchivePayload & { storageScope?: LocalDataStorageScope }) => Promise<LocalDataOpResult>;
  readLocalDataArchive?: (payload: { id?: string; fileName?: string; storageScope?: LocalDataStorageScope }) => Promise<LocalDataOpResult>;
  deleteLocalDataArchive?: (payload: { id?: string; fileName?: string; storageScope?: LocalDataStorageScope }) => Promise<LocalDataOpResult>;
  revealLocalDataArchive?: (payload?: { id?: string; fileName?: string; storageScope?: LocalDataStorageScope }) => Promise<LocalDataOpResult>;
}

interface Window {
  desktopRuntime?: DesktopRuntimeBridge;
}
