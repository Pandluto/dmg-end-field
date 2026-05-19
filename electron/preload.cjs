const { contextBridge, ipcRenderer } = require('electron');

const roleArgument = process.argv.find((value) => value.startsWith('--desktop-role='));
const roleFromArgs = roleArgument ? roleArgument.split('=')[1] : 'unknown';

contextBridge.exposeInMainWorld('desktopRuntime', {
  isElectron: true,
  platform: process.platform,
  role: roleFromArgs,
  getRole: () => ipcRenderer.invoke('desktop:get-role'),
  getShellState: () => ipcRenderer.invoke('desktop:get-shell-state'),
  getLlmSettings: () => ipcRenderer.invoke('desktop:get-llm-settings'),
  setLlmSettings: (payload) => ipcRenderer.invoke('desktop:set-llm-settings', payload),
  getDesktopSettings: () => ipcRenderer.invoke('desktop:get-settings'),
  setDesktopScale: (scaleKey) => ipcRenderer.invoke('desktop:set-scale', scaleKey),
  openWeb: () => ipcRenderer.invoke('desktop:open-web'),
  quitApp: () => ipcRenderer.invoke('desktop:quit-app'),
  listCapturePresets: () => ipcRenderer.invoke('desktop:list-capture-presets'),
  bindCaptureSource: (sourceId, presetName) => ipcRenderer.invoke('desktop:bind-capture-source', sourceId, presetName),
  startCaptureSession: (intervalMs) => ipcRenderer.invoke('desktop:start-capture-session', intervalMs),
  stopCaptureSession: () => ipcRenderer.invoke('desktop:stop-capture-session'),
  getCaptureSession: () => ipcRenderer.invoke('desktop:get-capture-session'),
  getLatestCaptureFrame: () => ipcRenderer.invoke('desktop:get-latest-capture-frame'),
  listCaptureSources: () => ipcRenderer.invoke('desktop:list-capture-sources'),
  captureSourceFrame: (sourceId) => ipcRenderer.invoke('desktop:capture-source-frame', sourceId),
  invokeArkResponses: (payload) => ipcRenderer.invoke('desktop:invoke-ark-responses', payload),
  runAction: (action) => ipcRenderer.invoke('desktop:run-action', action),
  listImageAssets: () => ipcRenderer.invoke('desktop:list-image-assets'),
  importImageAssets: () => ipcRenderer.invoke('desktop:import-image-assets'),
  importImageAssetsToDir: (payload) => ipcRenderer.invoke('desktop:import-image-assets-to-dir', payload),
  renameImageAsset: (payload) => ipcRenderer.invoke('desktop:rename-image-asset', payload),
  renameImageDirectory: (payload) => ipcRenderer.invoke('desktop:rename-image-directory', payload),
  deleteImageAsset: (payload) => ipcRenderer.invoke('desktop:delete-image-asset', payload),
  importImageAssetsFromBrowser: (payload) => ipcRenderer.invoke('desktop:import-image-assets-from-browser', payload),
  createImageDirectory: (payload) => ipcRenderer.invoke('desktop:create-image-directory', payload),
  deleteImageDirectory: (payload) => ipcRenderer.invoke('desktop:delete-image-directory', payload),
  revealInExplorer: (payload) => ipcRenderer.invoke('desktop:reveal-in-explorer', payload),
});
