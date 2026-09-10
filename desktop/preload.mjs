import { contextBridge, ipcRenderer } from 'electron'

// Keep the renderer isolated. The dashboard does not receive Node.js or
// authentication APIs; official login happens in a separate BrowserWindow.
contextBridge.exposeInMainWorld('myhkuDesktop', {
  platform: process.platform,
  version: process.versions.electron,
  refreshHku: () => ipcRenderer.invoke('myhku-refresh-hku'),
  accountStatus: () => ipcRenderer.invoke('myhku-account-status'),
  authSessions: () => ipcRenderer.invoke('myhku-auth-sessions'),
  loginSite: (site) => ipcRenderer.invoke('myhku-login-site', site),
  saveAccount: (value) => ipcRenderer.invoke('myhku-save-account', {
    localUsername: String(value?.localUsername || ''),
    email: String(value?.email || ''),
    password: String(value?.password || ''),
  }),
  beginLogin: (show = true) => ipcRenderer.invoke('myhku-begin-login', Boolean(show)),
  clearAccount: () => ipcRenderer.invoke('myhku-clear-account'),
  changeScheduleWeek: (offset) => ipcRenderer.invoke('myhku-schedule-week', Number(offset) || 0),
  // Main sends this after an authenticated Portal/SIS/Moodle page has been
  // parsed into the local bridge. The renderer only receives a small marker;
  // it fetches the normalized snapshot through the existing loopback API.
  onHkuUpdated: (listener) => {
    if (typeof listener !== 'function') return () => {}
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('myhku-hku-updated', handler)
    return () => ipcRenderer.removeListener('myhku-hku-updated', handler)
  },
  onAuthStatus: (listener) => {
    if (typeof listener !== 'function') return () => {}
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('myhku-auth-status', handler)
    return () => ipcRenderer.removeListener('myhku-auth-status', handler)
  },
})
