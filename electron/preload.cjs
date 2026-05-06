const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('desktopRuntime', {
  isElectron: true,
  platform: process.platform,
});
