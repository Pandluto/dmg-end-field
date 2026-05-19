/// <reference types="vite/client" />

interface DesktopArkResponsePayload {
  apiKey: string;
  model: string;
  prompt: string;
}

interface DesktopArkResponseResult {
  ok: boolean;
  status: number;
  durationMs: number;
  timeoutMs: number;
  data: unknown;
}

interface DesktopLlmSettingsPayload {
  apiKey: string;
  model: string;
  hasApiKey: boolean;
}

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

interface ImageAssetImportToDirPayload {
  targetDir?: string;
}

interface ImageAssetImportToDirResult {
  ok: boolean;
  error?: string;
  imported?: string[];
}

interface DesktopRuntimeBridge {
  getLlmSettings: () => Promise<DesktopLlmSettingsPayload>;
  setLlmSettings: (payload: { apiKey: string; model: string }) => Promise<DesktopLlmSettingsPayload>;
  invokeArkResponses: (payload: DesktopArkResponsePayload) => Promise<DesktopArkResponseResult>;
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
}

interface Window {
  desktopRuntime?: DesktopRuntimeBridge;
}
