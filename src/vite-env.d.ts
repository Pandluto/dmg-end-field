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
  fileName: string;
  baseName: string;
  ext: string;
  relativePath: string;
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

interface DesktopRuntimeBridge {
  getLlmSettings: () => Promise<DesktopLlmSettingsPayload>;
  setLlmSettings: (payload: { apiKey: string; model: string }) => Promise<DesktopLlmSettingsPayload>;
  invokeArkResponses: (payload: DesktopArkResponsePayload) => Promise<DesktopArkResponseResult>;
  listImageAssets?: () => Promise<ImageAssetEntry[]>;
  importImageAssets?: () => Promise<ImageAssetEntry[]>;
  renameImageAsset?: (payload: ImageAssetRenamePayload) => Promise<ImageAssetOpResult>;
  deleteImageAsset?: (payload: ImageAssetDeletePayload) => Promise<ImageAssetOpResult>;
}

interface Window {
  desktopRuntime?: DesktopRuntimeBridge;
}
