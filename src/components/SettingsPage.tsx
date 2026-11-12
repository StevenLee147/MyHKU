import { useState } from 'react'
import { Bell, CircleAlert, ExternalLink, KeyRound, Link2, LogIn, LogOut, Monitor, Moon, RefreshCw, ShieldCheck, Sun } from 'lucide-react'
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

export const connectionLabel: Record<ConnectionState, string> = {
  disconnected: '未连接',
  checking: '正在自动连接',
  login_pending: '等待完成登录',
  connected: '已连接',
  error: '检查失败',
}

export function SettingsPage({
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
      onNotice(`${HKU_SITES[site].label} 正在自动检查连接，需要操作时会显示官方窗口`)
    } catch {
      onNotice('无法启动连接，请稍后重试')
    }
  }

  const check = async (site: HkuSite) => {
    setChecking(site)
    try {
      await checkConnection(site)
      setStates(getConnectionStates())
    } catch {
      onNotice('无法读取连接状态，请稍后重试')
    } finally {
      setChecking(null)
    }
  }

  const checkAll = async () => {
    setChecking('all')
    try {
      setStates(await checkAllConnections())
    } catch {
      onNotice('无法读取连接状态，请稍后重试')
    } finally {
      setChecking(null)
    }
  }

  const requestNotificationPerm = async () => {
    if (typeof Notification === 'undefined') {
      onNotice('当前运行环境不支持浏览器通知 API')
      return
    }
    try {
      const result = await Notification.requestPermission()
      setNotifPerm(result)
      onNotice(result === 'granted' ? '本地提醒通知已开启' : '通知权限未开启，请在系统设置中授权')
    } catch {
      onNotice('无法请求通知权限')
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

  return (
    <div className="settings-stack">
      <section className="panel connections-panel">
        <div className="panel-head">
          <div>
            <h2>HKU 服务连接</h2>
            <p>账户凭据保存在本机系统安全存储，登录仍通过 HKU 官方页面完成</p>
          </div>
          <button className="text-btn" onClick={() => void checkAll()} disabled={checking !== null}>
            <RefreshCw size={13} className={checking === 'all' ? 'spin' : ''} /> 检查全部
          </button>
        </div>

        <div className="settings-switches">
          <div className="mode-switch" role="group" aria-label="数据来源">
            <span>数据来源</span>
            <button
              type="button"
              className={mode === 'demo' ? 'selected' : ''}
              onClick={() => {
                setMode('demo')
                onNotice('已切换到演示数据（所有页面均使用隔离样例）')
              }}
            >
              演示数据
            </button>
            <button
              type="button"
              className={mode === 'live' ? 'selected' : ''}
              onClick={() => {
                setMode('live')
                onNotice('真实模式已启用，将从已登录的 HKU 服务同步')
              }}
            >
              真实模式
            </button>
          </div>

          <div className="mode-switch" role="group" aria-label="界面外观">
            <span>外观主题</span>
            <button type="button" className={theme === 'system' ? 'selected' : ''} onClick={() => setTheme('system')}>
              <Monitor size={12} /> 跟随系统
            </button>
            <button type="button" className={theme === 'light' ? 'selected' : ''} onClick={() => setTheme('light')}>
              <Sun size={12} /> 浅色
            </button>
            <button type="button" className={theme === 'dark' ? 'selected' : ''} onClick={() => setTheme('dark')}>
              <Moon size={12} /> 深色
            </button>
          </div>
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
                    {connectionLabel[state.state]}
                    {state.detail ? ` · ${state.detail}` : ''}
                  </small>
                </div>
                <div className="connection-actions">
                  <button
                    className="login-link"
                    disabled={state.state === 'checking' || state.state === 'connected'}
                    onClick={() => void login(site)}
                    aria-label={`连接 ${item.label}`}
                  >
                    <LogIn size={14} />{' '}
                    {state.state === 'connected'
                      ? '已连接'
                      : state.state === 'checking'
                        ? '自动连接中…'
                        : state.state === 'login_pending'
                          ? '继续验证'
                          : '连接'}
                  </button>
                  <button className="check-link" onClick={() => void check(site)} disabled={isChecking}>
                    {isChecking ? <RefreshCw size={13} className="spin" /> : <Link2 size={13} />} 检查连接
                  </button>
                  <a href={item.url} target="_blank" rel="noreferrer" aria-label={`打开 ${item.label}`}>
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
            桌面版与 Android 端会复用持久化的 HKU 官方会话；首次登录或会话过期时会显示官方页面完成 2FA。MyHKU 只读取可见只读字段，密码与加密密钥由平台系统安全存储保护。
          </span>
        </div>
      </section>

      <section className="panel settings-card">
        <div className="panel-head">
          <div>
            <h2>本地提醒与通知</h2>
            <p>作业截止前 24 小时 / 1 小时自动提醒，并检测新作业、新公告及课表变化（不含成绩隐私）</p>
          </div>
          {notifPerm !== 'granted' && notifPerm !== 'unsupported' && (
            <button type="button" className="outline-btn" onClick={() => void requestNotificationPerm()}>
              <Bell size={14} /> 开启系统通知
            </button>
          )}
        </div>
        <div className="settings-status-row">
          <span>
            当前通知状态：
            <strong>
              {notifPerm === 'granted'
                ? '已授权系统通知'
                : notifPerm === 'denied'
                  ? '已被系统拒绝（仍可在顶部通知面板查看）'
                  : notifPerm === 'default'
                    ? '尚未授权（点击右上角开启）'
                    : '使用应用内提醒面板'}
            </strong>
          </span>
        </div>
      </section>

      <section className="panel settings-card">
        <div className="panel-head">
          <div>
            <h2>本地账户与缓存清理</h2>
            <p>
              当前账户：{account.username || '本机用户'}
              {account.email ? `（${account.email}）` : ''}
            </p>
          </div>
          <div className="account-manage-actions">
            {Boolean(window.myhkuDesktop?.saveAccount) && (
              <button type="button" className="outline-btn" onClick={onEditAccount}>
                <KeyRound size={14} /> 修改账号凭据
              </button>
            )}
            <button type="button" className="danger-btn" disabled={signingOut} onClick={() => void handleSignOut()}>
              <LogOut size={14} /> {signingOut ? '正在清理…' : '退出账号并清除缓存'}
            </button>
          </div>
        </div>
        <div className="settings-status-row">
          <span>退出账号会立即清除保存的登录凭据、官方会话 Cookie、本机加密快照及提醒记录；已下载到系统的普通文件不会被删除。</span>
        </div>
      </section>

      <LegalSettings />
    </div>
  )
}
