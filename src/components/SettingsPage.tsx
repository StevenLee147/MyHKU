import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Activity, AppWindow, Bell, CircleAlert, DatabaseBackup, Download, ExternalLink, Globe, KeyRound, Link2, LogIn, LogOut, Monitor, Moon, RefreshCw, ShieldCheck, Sparkles, Sun, Upload } from 'lucide-react'
import { LegalSettings } from '../legal'
import {
  checkAllConnections,
  checkConnection,
  getConnectionStates,
  HKU_SITES,
  openOfficialLogin,
  type ConnectionState,
  type DataMode,
  type HkuSite,
  type LiveSnapshot,
  type SiteConnection,
  type ThemeMode,
} from '../services/hku'
import { tr, type Locale } from '../services/i18n'
import {
  checkGithubReleaseUpdate,
  downloadLearningBackupJson,
  getCurrentAppVersion,
  restoreLocalLearningBackup,
  serializeLearningBackup,
  type RestoreBackupResult,
  type UpdateCheckResult,
} from '../services/updater'

export const connectionLabel: Record<ConnectionState, string> = {
  disconnected: '未连接',
  checking: '正在自动连接',
  login_pending: '等待完成登录',
  connected: '已连接',
  error: '检查失败',
}

const connectionLabelEn: Record<ConnectionState, string> = {
  disconnected: 'Disconnected',
  checking: 'Connecting automatically',
  login_pending: 'Awaiting sign-in',
  connected: 'Connected',
  error: 'Check failed',
}

export function SettingsPage({
  locale = 'zh',
  setLocale,
  mode,
  setMode,
  theme,
  setTheme,
  states,
  setStates,
  snapshot,
  customTasksCount = 0,
  account,
  onEditAccount,
  onSignOut,
  onNotice,
  onRebuildCache,
  onRestoredBackup,
}: {
  locale?: Locale
  setLocale?: (next: Locale) => void
  mode: DataMode
  setMode: (mode: DataMode) => void
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  states: Record<HkuSite, SiteConnection>
  setStates: (states: Record<HkuSite, SiteConnection>) => void
  snapshot?: LiveSnapshot | null
  customTasksCount?: number
  account: { username?: string; email?: string }
  onEditAccount: () => void
  onSignOut: () => Promise<void>
  onNotice: (message: string) => void
  onRebuildCache?: (scope: 'schedule' | 'moodle') => Promise<void>
  onRestoredBackup?: (result: RestoreBackupResult) => void
}) {
  const [checking, setChecking] = useState<HkuSite | 'all' | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [notifPerm, setNotifPerm] = useState<string>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  )
  const [minimizeToTray, setMinimizeToTray] = useState(false)
  const [traySupported, setTraySupported] = useState(() => Boolean(window.myhkuDesktop?.getDesktopPrefs))
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null)
  const [updateError, setUpdateError] = useState('')
  const [rebuildingScope, setRebuildingScope] = useState<'schedule' | 'moodle' | null>(null)
  const backupFileRef = useRef<HTMLInputElement>(null)
  const currentAppVer = getCurrentAppVersion()

  const handleCheckUpdates = async () => {
    setCheckingUpdate(true)
    setUpdateError('')
    try {
      const result = await checkGithubReleaseUpdate()
      setUpdateInfo(result)
      onNotice(
        result.hasUpdate
          ? tr(locale, `发现新版本 ${result.latestTag} 可供下载`, `New release ${result.latestTag} available`)
          : tr(locale, `当前已是最新版本 (v${result.currentVersion})`, `You are on the latest version (v${result.currentVersion})`),
      )
    } catch {
      setUpdateError(tr(locale, '无法连接 GitHub Releases，请检查网络后重试', 'Unable to reach GitHub Releases; check network and retry'))
    } finally {
      setCheckingUpdate(false)
    }
  }

  const handleRebuildScope = async (scope: 'schedule' | 'moodle') => {
    if (!onRebuildCache || rebuildingScope) return
    setRebuildingScope(scope)
    try {
      await onRebuildCache(scope)
    } finally {
      setRebuildingScope(null)
    }
  }

  const handleExportBackup = () => {
    const content = serializeLearningBackup(currentAppVer)
    const stamp = new Date().toISOString().slice(0, 10)
    downloadLearningBackupJson(content, `myhku-learning-backup-${stamp}.json`)
    onNotice(
      tr(
        locale,
        '已导出本地自建待办、GPA 模拟权重与星标资料配置 (.json)',
        'Exported custom tasks, GPA weights & pinned resources (.json)',
      ),
    )
  }

  const handleImportBackupChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const rawText = await file.text()
      const restored = restoreLocalLearningBackup(rawText, { mode: 'merge' })
      onRestoredBackup?.(restored)
      onNotice(
        tr(
          locale,
          `备份恢复成功：合并 ${restored.taskCount} 项自建待办与 ${restored.gpaCourseCount} 门课程 GPA 配置`,
          `Restored backup: ${restored.taskCount} custom tasks & ${restored.gpaCourseCount} GPA courses`,
        ),
      )
    } catch (error) {
      onNotice(error instanceof Error ? error.message : tr(locale, '导入备份失败', 'Failed to import backup'))
    }
  }

  useEffect(() => {
    let active = true
    const loadPrefs = async () => {
      if (!window.myhkuDesktop?.getDesktopPrefs) return
      try {
        const prefs = await window.myhkuDesktop.getDesktopPrefs()
        if (!active || !prefs) return
        setMinimizeToTray(Boolean(prefs.minimizeToTray))
        setTraySupported(true)
      } catch {
        /* ignore */
      }
    }
    void loadPrefs()
    return () => {
      active = false
    }
  }, [])

  const toggleMinimizeToTray = async () => {
    if (!window.myhkuDesktop?.setDesktopPrefs) return
    try {
      const next = await window.myhkuDesktop.setDesktopPrefs({ minimizeToTray: !minimizeToTray })
      setMinimizeToTray(Boolean(next?.minimizeToTray))
      onNotice(
        next?.minimizeToTray
          ? tr(locale, '已开启：关闭主窗口时将最小化至系统托盘后台守护', 'Enabled: Closing the window minimizes MyHKU to the system tray')
          : tr(locale, '已关闭：关闭主窗口将直接退出应用', 'Disabled: Closing the window quits MyHKU'),
      )
    } catch {
      onNotice(tr(locale, '无法保存系统托盘设置', 'Unable to update system tray preference'))
    }
  }

  const login = async (site: HkuSite) => {
    if (mode !== 'live') setMode('live')
    try {
      setStates(await openOfficialLogin(site))
      onNotice(
        tr(
          locale,
          `${HKU_SITES[site].label} 正在自动检查连接，需要操作时会显示官方窗口`,
          `Checking ${HKU_SITES[site].label}; an official window will appear if MFA is required`,
        ),
      )
    } catch {
      onNotice(tr(locale, '无法启动连接，请稍后重试', 'Unable to start connection, please retry'))
    }
  }

  const check = async (site: HkuSite) => {
    setChecking(site)
    try {
      await checkConnection(site)
      setStates(getConnectionStates())
    } catch {
      onNotice(tr(locale, '无法读取连接状态，请稍后重试', 'Unable to check connection status'))
    } finally {
      setChecking(null)
    }
  }

  const checkAll = async () => {
    setChecking('all')
    try {
      setStates(await checkAllConnections())
    } catch {
      onNotice(tr(locale, '无法读取连接状态，请稍后重试', 'Unable to check connection status'))
    } finally {
      setChecking(null)
    }
  }

  const requestNotificationPerm = async () => {
    if (typeof Notification === 'undefined') {
      onNotice(tr(locale, '当前运行环境不支持浏览器通知 API', 'Notifications are not supported in this runtime'))
      return
    }
    try {
      const result = await Notification.requestPermission()
      setNotifPerm(result)
      onNotice(
        result === 'granted'
          ? tr(locale, '本地提醒通知已开启', 'System notifications enabled')
          : tr(locale, '通知权限未开启，请在系统设置中授权', 'Notification permission denied'),
      )
    } catch {
      onNotice(tr(locale, '无法请求通知权限', 'Unable to request notification permission'))
    }
  }

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await onSignOut()
    } finally {
      setSigningOut(false)
    }
  }

  const statusMap = locale === 'en' ? connectionLabelEn : connectionLabel

  return (
    <div className="settings-stack">
      <section className="panel connections-panel">
        <div className="panel-head">
          <div>
            <h2>{tr(locale, 'HKU 服务连接', 'HKU Service Connections')}</h2>
            <p>{tr(locale, '账户凭据保存在本机系统安全存储，登录仍通过 HKU 官方页面完成', 'Credentials stay in OS secure storage; sign-in always runs on official HKU pages')}</p>
          </div>
          <button className="text-btn" onClick={() => void checkAll()} disabled={checking !== null}>
            <RefreshCw size={13} className={checking === 'all' ? 'spin' : ''} /> {tr(locale, '检查全部', 'Check All')}
          </button>
        </div>

        <div className="settings-switches">
          <div className="mode-switch" role="group" aria-label={tr(locale, '数据来源', 'Data Mode')}>
            <span>{tr(locale, '数据来源', 'Data')}</span>
            <button
              type="button"
              className={mode === 'demo' ? 'selected' : ''}
              onClick={() => {
                setMode('demo')
                onNotice(tr(locale, '已切换到演示数据（所有页面均使用隔离样例）', 'Switched to isolated demo data'))
              }}
            >
              {tr(locale, '演示数据', 'Demo')}
            </button>
            <button
              type="button"
              className={mode === 'live' ? 'selected' : ''}
              onClick={() => {
                setMode('live')
                onNotice(tr(locale, '真实模式已启用，将从已登录的 HKU 服务同步', 'Live HKU mode enabled'))
              }}
            >
              {tr(locale, '真实模式', 'Live')}
            </button>
          </div>

          <div className="mode-switch" role="group" aria-label={tr(locale, '界面外观', 'Theme')}>
            <span>{tr(locale, '外观主题', 'Theme')}</span>
            <button type="button" className={theme === 'system' ? 'selected' : ''} onClick={() => setTheme('system')}>
              <Monitor size={12} /> {tr(locale, '跟随系统', 'System')}
            </button>
            <button type="button" className={theme === 'light' ? 'selected' : ''} onClick={() => setTheme('light')}>
              <Sun size={12} /> {tr(locale, '浅色', 'Light')}
            </button>
            <button type="button" className={theme === 'dark' ? 'selected' : ''} onClick={() => setTheme('dark')}>
              <Moon size={12} /> {tr(locale, '深色', 'Dark')}
            </button>
          </div>

          {setLocale && (
            <div className="mode-switch" role="group" aria-label={tr(locale, '界面语言', 'Language')}>
              <span>
                <Globe size={12} /> {tr(locale, '语言', 'Language')}
              </span>
              <button type="button" className={locale === 'zh' ? 'selected' : ''} onClick={() => setLocale('zh')}>
                简体中文
              </button>
              <button type="button" className={locale === 'en' ? 'selected' : ''} onClick={() => setLocale('en')}>
                English
              </button>
            </div>
          )}
        </div>

        <div className="connection-list">
          {(Object.keys(HKU_SITES) as HkuSite[]).map(site => {
            const item = HKU_SITES[site]
            const state = states[site]
            const isChecking = checking === site || checking === 'all'
            return (
              <article className="connection-card" key={site}>
                <div className="connection-icon">
                  <ShieldCheck size={19} />
                </div>
                <div className="connection-copy">
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                  <small className={`connection-state ${state.state}`}>
                    <i />
                    {statusMap[state.state]}
                    {state.detail ? ` · ${state.detail}` : ''}
                  </small>
                </div>
                <div className="connection-actions">
                  <button
                    className="login-link"
                    disabled={state.state === 'checking' || state.state === 'connected'}
                    onClick={() => void login(site)}
                    aria-label={`${tr(locale, '连接', 'Connect')} ${item.label}`}
                  >
                    <LogIn size={14} />{' '}
                    {state.state === 'connected'
                      ? tr(locale, '已连接', 'Connected')
                      : state.state === 'checking'
                        ? tr(locale, '自动连接中…', 'Connecting…')
                        : state.state === 'login_pending'
                          ? tr(locale, '继续验证', 'Verify')
                          : tr(locale, '连接', 'Connect')}
                  </button>
                  <button className="check-link" onClick={() => void check(site)} disabled={isChecking}>
                    {isChecking ? <RefreshCw size={13} className="spin" /> : <Link2 size={13} />} {tr(locale, '检查连接', 'Check')}
                  </button>
                  <a href={item.url} target="_blank" rel="noreferrer" aria-label={`Open ${item.label}`}>
                    <ExternalLink size={14} />
                  </a>
                </div>
              </article>
            )
          })}
        </div>
        <div className="connection-note">
          <CircleAlert size={15} />
          <span>
            {tr(
              locale,
              '桌面版与 Android 端会复用持久化的 HKU 官方会话；首次登录或会话过期时会显示官方页面完成 2FA。MyHKU 只读取可见只读字段，密码与加密密钥由平台系统安全存储保护。',
              'Desktop and Android reuse persistent official HKU sessions and open the official window for 2FA when needed. MyHKU reads visible read-only fields only, protected by OS secure storage.',
            )}
          </span>
        </div>
      </section>

      {traySupported && (
        <section className="panel settings-card">
          <div className="panel-head">
            <div>
              <h2>{tr(locale, '桌面端系统托盘与后台守护', 'Desktop System Tray & Background Resident')}</h2>
              <p>
                {tr(
                  locale,
                  '在系统托盘菜单实时预览下一节课与近期截止事项；开启后点击窗口关闭按钮会隐藏至托盘继续按日刷新与提醒。',
                  'Preview your next class and upcoming deadline in the tray menu; keep MyHKU running in the tray when closing the window.',
                )}
              </p>
            </div>
            <button
              type="button"
              className={minimizeToTray ? 'primary-btn' : 'outline-btn'}
              onClick={() => void toggleMinimizeToTray()}
            >
              <AppWindow size={14} />{' '}
              {minimizeToTray
                ? tr(locale, '已开启：最小化到托盘', 'Minimize to Tray: ON')
                : tr(locale, '开启最小化到托盘', 'Enable Minimize to Tray')}
            </button>
          </div>
        </section>
      )}

      <section className="panel settings-card">
        <div className="panel-head">
          <div>
            <h2>{tr(locale, '本地提醒与通知', 'Local Reminders & Notifications')}</h2>
            <p>{tr(locale, '作业截止前 24 小时 / 1 小时自动提醒，并检测新作业、新公告及课表变化（不含成绩隐私）', '24h / 1h deadline alerts plus new assignment, announcement, and timetable diff notifications')}</p>
          </div>
          {notifPerm !== 'granted' && notifPerm !== 'unsupported' && (
            <button type="button" className="outline-btn" onClick={() => void requestNotificationPerm()}>
              <Bell size={14} /> {tr(locale, '开启系统通知', 'Enable Notifications')}
            </button>
          )}
        </div>
        <div className="settings-status-row">
          <span>
            {tr(locale, '当前通知状态：', 'Notification status: ')}
            <strong>
              {notifPerm === 'granted'
                ? tr(locale, '已授权系统通知', 'Granted')
                : notifPerm === 'denied'
                  ? tr(locale, '已被系统拒绝（仍可在顶部通知面板查看）', 'Blocked by OS (in-app feed active)')
                  : notifPerm === 'default'
                    ? tr(locale, '尚未授权（点击右上角开启）', 'Not yet requested')
                    : tr(locale, '使用应用内提醒面板', 'In-app feed only')}
            </strong>
          </span>
        </div>
      </section>

      <section className="panel settings-card updater-card">
        <div className="panel-head">
          <div>
            <h2>
              <Sparkles size={15} /> {tr(locale, '应用版本与更新检查', 'App Version & Update Checker')}
            </h2>
            <p>
              {tr(
                locale,
                `当前运行版本：v${currentAppVer} · 只读查询官方 GitHub Releases 并匹配当前系统安装包`,
                `Current version: v${currentAppVer} · Read-only check against GitHub Releases`,
              )}
            </p>
          </div>
          <button
            type="button"
            className="outline-btn check-updates-btn"
            disabled={checkingUpdate}
            onClick={() => void handleCheckUpdates()}
          >
            <RefreshCw size={14} className={checkingUpdate ? 'spin' : ''} />{' '}
            {checkingUpdate ? tr(locale, '正在检查…', 'Checking…') : tr(locale, '检查新版本', 'Check for Updates')}
          </button>
        </div>
        {updateError && (
          <div className="settings-status-row">
            <span className="urgent-text">{updateError}</span>
          </div>
        )}
        {updateInfo && (
          <div className="update-result-box">
            <div className="update-result-head">
              <strong>
                {updateInfo.hasUpdate
                  ? tr(locale, `发现新版本：${updateInfo.latestTag}`, `Update available: ${updateInfo.latestTag}`)
                  : tr(locale, `当前已是最新版本 (${updateInfo.latestTag})`, `Up to date (${updateInfo.latestTag})`)}
              </strong>
              {updateInfo.publishedAt && (
                <small>{new Date(updateInfo.publishedAt).toLocaleDateString(locale === 'en' ? 'en-US' : 'zh-CN')}</small>
              )}
            </div>
            {updateInfo.summary && <p className="update-summary-text">{updateInfo.summary}</p>}
            <div className="update-result-actions">
              {updateInfo.recommendedAsset && (
                <a
                  href={updateInfo.recommendedAsset.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="primary-btn update-download-link"
                >
                  <Download size={13} />{' '}
                  {tr(locale, `下载安装包 (${updateInfo.recommendedAsset.name})`, `Download (${updateInfo.recommendedAsset.name})`)}
                </a>
              )}
              {updateInfo.checksumAsset && (
                <a href={updateInfo.checksumAsset.downloadUrl} target="_blank" rel="noreferrer" className="outline-btn">
                  SHA256SUMS.txt <ExternalLink size={12} />
                </a>
              )}
              <a href={updateInfo.htmlUrl} target="_blank" rel="noreferrer" className="outline-btn">
                {tr(locale, '查看 Release 详情', 'Release Notes')} <ExternalLink size={12} />
              </a>
            </div>
          </div>
        )}
      </section>

      <section className="panel settings-card diagnostics-card">
        <div className="panel-head">
          <div>
            <h2>
              <Activity size={15} /> {tr(locale, '同步健康诊断与分区缓存自愈', 'Sync Health Diagnostics & Selective Cache Rebuild')}
            </h2>
            <p>
              {tr(
                locale,
                '无需退出登录即可按模块单独清理并重新拉取课表或 Moodle 数据，保留其余缓存与个人设置。',
                'Selectively rebuild timetable or Moodle cache without signing out or losing personal settings.',
              )}
            </p>
          </div>
          {onRebuildCache && (
            <div className="account-manage-actions">
              <button
                type="button"
                className="outline-btn"
                disabled={rebuildingScope !== null}
                onClick={() => void handleRebuildScope('schedule')}
              >
                <RefreshCw size={13} className={rebuildingScope === 'schedule' ? 'spin' : ''} />{' '}
                {tr(locale, '仅重建课表缓存', 'Rebuild Timetable Cache')}
              </button>
              <button
                type="button"
                className="outline-btn"
                disabled={rebuildingScope !== null}
                onClick={() => void handleRebuildScope('moodle')}
              >
                <RefreshCw size={13} className={rebuildingScope === 'moodle' ? 'spin' : ''} />{' '}
                {tr(locale, '仅重抓 Moodle 状态', 'Rebuild Moodle Cache')}
              </button>
            </div>
          )}
        </div>
        <div className="diag-metrics-grid">
          <div className="diag-metric">
            <small>{tr(locale, '已连接服务', 'Connected Services')}</small>
            <strong>{Object.values(states).filter(s => s.state === 'connected').length} / 3</strong>
          </div>
          <div className="diag-metric">
            <small>{tr(locale, '已缓存课表周数', 'Cached Weeks')}</small>
            <strong>{snapshot ? snapshot.scheduleWeeks?.length || (snapshot.scheduleWeek ? 1 : 0) : 0}</strong>
          </div>
          <div className="diag-metric">
            <small>{tr(locale, '课表课堂记录', 'Class Sessions')}</small>
            <strong>{snapshot ? snapshot.schedule.length : 0}</strong>
          </div>
          <div className="diag-metric">
            <small>{tr(locale, 'Moodle 课程 / 资料', 'Courses / Files')}</small>
            <strong>
              {snapshot ? snapshot.courses.length : 0} / {snapshot ? snapshot.resources.length : 0}
            </strong>
          </div>
          <div className="diag-metric">
            <small>{tr(locale, '官方作业 / 自建日程', 'Official / Custom Tasks')}</small>
            <strong>
              {snapshot ? snapshot.assignments.length : 0} / {customTasksCount}
            </strong>
          </div>
        </div>
      </section>

      <section className="panel settings-card backup-card">
        <div className="panel-head">
          <div>
            <h2>
              <DatabaseBackup size={15} /> {tr(locale, '本地学习配置备份与恢复 (JSON)', 'Local Learning Config Backup & Restore (JSON)')}
            </h2>
            <p>
              {tr(
                locale,
                '一键导出或合并恢复个人自建考试倒计时、HKU 4.3 GPA 模拟权重与星标资料；不包含账号密码或会话 Cookie。',
                'Export or merge-restore custom tasks, GPA weights, and pinned files; never includes passwords or cookies.',
              )}
            </p>
          </div>
          <div className="account-manage-actions">
            <button type="button" className="outline-btn export-backup-btn" onClick={handleExportBackup}>
              <Download size={14} /> {tr(locale, '导出配置 (.json)', 'Export (.json)')}
            </button>
            <button
              type="button"
              className="outline-btn import-backup-btn"
              onClick={() => backupFileRef.current?.click()}
            >
              <Upload size={14} /> {tr(locale, '导入恢复 (.json)', 'Import (.json)')}
            </button>
            <input
              ref={backupFileRef}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              aria-label={tr(locale, '选择学习配置备份 JSON 文件', 'Select learning backup JSON file')}
              onChange={e => void handleImportBackupChange(e)}
            />
          </div>
        </div>
      </section>

      <section className="panel settings-card">
        <div className="panel-head">
          <div>
            <h2>{tr(locale, '本地账户与缓存清理', 'Local Account & Cache Cleanup')}</h2>
            <p>
              {tr(locale, '当前账户：', 'Current account: ')}{account.username || tr(locale, '本机用户', 'Local User')}
              {account.email ? `（${account.email}）` : ''}
            </p>
          </div>
          <div className="account-manage-actions">
            {Boolean(window.myhkuDesktop?.saveAccount) && (
              <button type="button" className="outline-btn" onClick={onEditAccount}>
                <KeyRound size={14} /> {tr(locale, '修改账号凭据', 'Update Credentials')}
              </button>
            )}
            <button type="button" className="danger-btn" disabled={signingOut} onClick={() => void handleSignOut()}>
              <LogOut size={14} /> {signingOut ? tr(locale, '正在清理…', 'Clearing…') : tr(locale, '退出账号并清除缓存', 'Sign Out & Clear Cache')}
            </button>
          </div>
        </div>
        <div className="settings-status-row">
          <span>
            {tr(
              locale,
              '退出账号会立即清除保存的登录凭据、官方会话 Cookie、本机加密快照及提醒记录；已下载到系统的普通文件不会被删除。',
              'Signing out immediately wipes stored credentials, official session cookies, encrypted snapshots, and local alerts; downloaded files remain untouched.',
            )}
          </span>
        </div>
      </section>

      <LegalSettings />
    </div>
  )
}
// end SettingsPage
