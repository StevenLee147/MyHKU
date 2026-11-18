import { useState } from 'react'
import { Bell, CircleAlert, ExternalLink, Globe, KeyRound, Link2, LogIn, LogOut, Monitor, Moon, RefreshCw, ShieldCheck, Sun } from 'lucide-react'
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
  type SiteConnection,
  type ThemeMode,
} from '../services/hku'
import { tr, type Locale } from '../services/i18n'

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
  account,
  onEditAccount,
  onSignOut,
  onNotice,
}: {
  locale?: Locale
  setLocale?: (next: Locale) => void
  mode: DataMode
  setMode: (mode: DataMode) => void
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  states: Record<HkuSite, SiteConnection>
  setStates: (states: Record<HkuSite, SiteConnection>) => void
  account: { username?: string; email?: string }
  onEditAccount: () => void
  onSignOut: () => Promise<void>
  onNotice: (message: string) => void
}) {
  const [checking, setChecking] = useState<HkuSite | 'all' | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [notifPerm, setNotifPerm] = useState<string>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  )

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
