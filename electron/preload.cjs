'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function readFeatureFlag(name) {
  const prefix = `--dmg-desktop-feature-${name}=`;
  const values = process.argv
    .filter((argument) => argument.startsWith(prefix))
    .map((argument) => argument.slice(prefix.length));
  return values.length === 1 && values[0] === '1';
}

const desktopFeatureFlags = Object.freeze({
  agentEntry: readFeatureFlag('agent-entry'),
  resourcePackagerEntry: readFeatureFlag('resource-packager-entry'),
});

function invoke(channel, payload) {
  return ipcRenderer.invoke(channel, payload);
}

const desktopHost = {
  getCapabilities: () => invoke('desktop:get-capabilities'),
  getAppInfo: () => invoke('desktop:get-app-info'),
  getSettings: () => invoke('desktop:get-settings'),
  setScale: (scale) => invoke('desktop:set-scale', { scale }),
  openBrowser: () => invoke('desktop:open-browser'),
  getMcpState: () => invoke('desktop:get-mcp-state'),
  openMcpFill: () => invoke('desktop:open-mcp-fill'),
  quit: () => invoke('desktop:quit'),
  ...(desktopFeatureFlags.agentEntry ? {
    getAgentState: () => invoke('desktop:get-agent-state'),
    getAgentProfile: () => invoke('desktop:get-agent-profile'),
    testAgentProfile: (profile) => invoke('desktop:test-agent-profile', profile),
    saveAgentProfile: (profile) => invoke('desktop:save-agent-profile', profile),
    openAgentMode: () => invoke('desktop:open-agent-mode'),
  } : {}),
  ...(desktopFeatureFlags.resourcePackagerEntry ? {
    pickImageReleaseSource: () => invoke('desktop:pick-image-release-source'),
    pickShareDataSource: () => invoke('desktop:pick-share-data-source'),
    pickReleaseOutput: () => invoke('desktop:pick-release-output'),
    buildResourceRelease: () => invoke('desktop:build-resource-release'),
    revealPath: (targetPath) => invoke('desktop:reveal-path', { path: targetPath }),
  } : {}),
};

contextBridge.exposeInMainWorld('desktopHost', Object.freeze(desktopHost));
