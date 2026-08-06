'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function invoke(channel, payload) {
  return ipcRenderer.invoke(channel, payload);
}

contextBridge.exposeInMainWorld('desktopHost', Object.freeze({
  getCapabilities: () => invoke('desktop:get-capabilities'),
  getAppInfo: () => invoke('desktop:get-app-info'),
  getSettings: () => invoke('desktop:get-settings'),
  setScale: (scale) => invoke('desktop:set-scale', { scale }),
  openBrowser: () => invoke('desktop:open-browser'),
  getMcpState: () => invoke('desktop:get-mcp-state'),
  openMcpFill: () => invoke('desktop:open-mcp-fill'),
  quit: () => invoke('desktop:quit'),
  pickImageReleaseSource: () => invoke('desktop:pick-image-release-source'),
  pickDataReleaseSource: () => invoke('desktop:pick-data-release-source'),
  pickReleaseOutput: () => invoke('desktop:pick-release-output'),
  buildImageRelease: (options) => invoke('desktop:build-image-release', options),
  buildDataRelease: (options) => invoke('desktop:build-data-release', options),
  revealPath: (targetPath) => invoke('desktop:reveal-path', { path: targetPath }),
}));
