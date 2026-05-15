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

interface DesktopRuntimeBridge {
  getLlmSettings: () => Promise<DesktopLlmSettingsPayload>;
  setLlmSettings: (payload: { apiKey: string; model: string }) => Promise<DesktopLlmSettingsPayload>;
  invokeArkResponses: (payload: DesktopArkResponsePayload) => Promise<DesktopArkResponseResult>;
}

interface Window {
  desktopRuntime?: DesktopRuntimeBridge;
}
