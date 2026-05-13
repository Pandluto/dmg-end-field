const { contextBridge, ipcRenderer } = require('electron');

const roleArgument = process.argv.find((value) => value.startsWith('--desktop-role='));
const roleFromArgs = roleArgument ? roleArgument.split('=')[1] : 'unknown';

contextBridge.exposeInMainWorld('desktopRuntime', {
  isElectron: true,
  platform: process.platform,
  role: roleFromArgs,
  getRole: () => ipcRenderer.invoke('desktop:get-role'),
  getShellState: () => ipcRenderer.invoke('desktop:get-shell-state'),
  openWeb: () => ipcRenderer.invoke('desktop:open-web'),
  quitApp: () => ipcRenderer.invoke('desktop:quit-app'),
  runAction: (action) => ipcRenderer.invoke('desktop:run-action', action),
});
