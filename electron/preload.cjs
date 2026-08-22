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
  getAgentState: () => invoke('desktop:get-agent-state'),
  getAgentProfile: () => invoke('desktop:get-agent-profile'),
  testAgentProfile: (profile) => invoke('desktop:test-agent-profile', profile),
  saveAgentProfile: (profile) => invoke('desktop:save-agent-profile', profile),
  openAgentMode: () => invoke('desktop:open-agent-mode'),
  quit: () => invoke('desktop:quit'),
  pickImageReleaseSource: () => invoke('desktop:pick-image-release-source'),
  pickShareDataSource: () => invoke('desktop:pick-share-data-source'),
  pickReleaseOutput: () => invoke('desktop:pick-release-output'),
  buildResourceRelease: () => invoke('desktop:build-resource-release'),
  revealPath: (targetPath) => invoke('desktop:reveal-path', { path: targetPath }),
}));
