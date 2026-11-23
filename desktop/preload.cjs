const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('myhkuDesktop', {
  legalStatus: () => ipcRenderer.invoke('myhku-legal-status'),
  acceptLegal: version => ipcRenderer.invoke('myhku-accept-legal', String(version)),
  declineLegal: () => ipcRenderer.invoke('myhku-decline-legal'),
  platform: process.platform,
  version: process.versions.electron,
  refreshHku: () => ipcRenderer.invoke('myhku-refresh-hku'),
  downloadResource: (url) => ipcRenderer.invoke('myhku-download-resource', String(url)),
  downloadResourceDetailed: (request) => ipcRenderer.invoke(
    'myhku-download-resource-detailed',
    request && typeof request === 'object'
      ? {
          url: String(request.url || ''),
          course: typeof request.course === 'string' ? request.course : '',
          title: typeof request.title === 'string' ? request.title : '',
          organizeMode: typeof request.organizeMode === 'string' ? request.organizeMode : '',
          replaceExisting: Boolean(request.replaceExisting),
          targetFilePath: typeof request.targetFilePath === 'string' ? request.targetFilePath : '',
        }
      : String(request || ''),
  ),
  getDownloadedIndex: () => ipcRenderer.invoke('myhku-get-downloaded-index'),
  getStorageConfig: () => ipcRenderer.invoke('myhku-get-storage-config'),
  setStorageConfig: (config) => ipcRenderer.invoke('myhku-set-storage-config', {
    ...(typeof config?.storageDir === 'string' ? { storageDir: config.storageDir } : {}),
    ...(typeof config?.organizeMode === 'string' ? { organizeMode: config.organizeMode } : {}),
  }),
  chooseStorageDirectory: (options) => ipcRenderer.invoke('myhku-choose-storage-dir', {
    apply: options?.apply !== false,
    organizeMode: typeof options?.organizeMode === 'string' ? options.organizeMode : undefined,
  }),
  openStorageDirectory: () => ipcRenderer.invoke('myhku-open-storage-dir'),
  scanStorageDirectory: () => ipcRenderer.invoke('myhku-scan-storage-dir'),
  checkResourceUpdates: (items) => ipcRenderer.invoke(
    'myhku-check-resource-updates',
    Array.isArray(items)
      ? items.slice(0, 60).map(item => ({
          id: String(item?.id || ''),
          url: String(item?.url || ''),
          localSize: typeof item?.localSize === 'number' ? item.localSize : undefined,
          localMtimeMs: typeof item?.localMtimeMs === 'number' ? item.localMtimeMs : undefined,
        }))
      : [],
  ),
  getDesktopPrefs: () => ipcRenderer.invoke('myhku-get-desktop-prefs'),
  setDesktopPrefs: (prefs) => ipcRenderer.invoke('myhku-set-desktop-prefs', { minimizeToTray: Boolean(prefs?.minimizeToTray) }),
  updateTraySummary: (summary) => ipcRenderer.invoke('myhku-update-tray-summary', {
    nextClass: typeof summary?.nextClass === 'string' ? summary.nextClass : '',
    nextDdl: typeof summary?.nextDdl === 'string' ? summary.nextDdl : '',
  }),
  openDownloadedFile: (filePath) => ipcRenderer.invoke('myhku-open-downloaded-file', String(filePath)),
  revealDownloadedFile: (filePath) => ipcRenderer.invoke('myhku-reveal-downloaded-file', String(filePath)),
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
  changeScheduleWeek: (request) => ipcRenderer.invoke(
    'myhku-schedule-week',
    request && typeof request === 'object'
      ? {
          offset: Number(request.offset) || 0,
          ...(typeof request.targetStartIso === 'string' ? { targetStartIso: request.targetStartIso } : {}),
        }
      : Number(request) || 0,
  ),
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
