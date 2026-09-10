import { contextBridge, ipcRenderer } from 'electron'

// Keep the renderer isolated. The dashboard does not receive Node.js or
// authentication APIs; official login happens in a separate BrowserWindow.
contextBridge.exposeInMainWorld('myhkuDesktop', {
  platform: process.platform,
  version: process.versions.electron,
  refreshHku: () => ipcRenderer.invoke('myhku-refresh-hku'),
})
