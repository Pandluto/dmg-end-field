const { contextBridge, ipcRenderer } = require('electron');

const roleArgument = process.argv.find((value) => value.startsWith('--desktop-role='));
const roleFromArgs = roleArgument ? roleArgument.split('=')[1] : 'unknown';

contextBridge.exposeInMainWorld('desktopRuntime', {
  isElectron: true,
  platform: process.platform,
  role: roleFromArgs,
  getRole: () => ipcRenderer.invoke('desktop:get-role'),
  getShellState: () => ipcRenderer.invoke('desktop:get-shell-state'),
  quitApp: () => ipcRenderer.invoke('desktop:quit-app'),
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
  readEquipmentLibrary: () => ipcRenderer.invoke('desktop:read-equipment-library'),
  writeEquipmentLibrary: (payload) => ipcRenderer.invoke('desktop:write-equipment-library', payload),
  listLocalDataArchives: () => ipcRenderer.invoke('desktop:list-local-data-archives'),
  saveLocalDataArchive: (payload) => ipcRenderer.invoke('desktop:save-local-data-archive', payload),
  readLocalDataArchive: (payload) => ipcRenderer.invoke('desktop:read-local-data-archive', payload),
  deleteLocalDataArchive: (payload) => ipcRenderer.invoke('desktop:delete-local-data-archive', payload),
  revealLocalDataArchive: (payload) => ipcRenderer.invoke('desktop:reveal-local-data-archive', payload),
});
