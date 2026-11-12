import { useState, type FormEvent } from 'react'
import { LogIn, RefreshCw, ShieldCheck, X } from 'lucide-react'

function isValidHkuEmail(raw: string): boolean {
  const lower = raw.trim().toLowerCase()
  return /^[^\s@]+@(?:connect\.hku\.hk|hku\.hk)$/.test(lower)
}

export function AccountSetup({
  initialUsername = '',
  initialEmail = '',
  modal = false,
  onCancel,
  onReady,
}: {
  initialUsername?: string
  initialEmail?: string
  modal?: boolean
  onCancel?: () => void
  onReady: (account: { username: string; email: string }) => void
}) {
  const [username, setUsername] = useState(initialUsername)
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!username.trim() || !email.trim() || !password) {
      setError('请填写本地用户名、HKU 邮箱和密码')
      return
    }
    if (!isValidHkuEmail(email)) {
      setError('请输入以 @connect.hku.hk 或 @hku.hk 结尾的学校邮箱')
      return
    }
    const save = window.myhkuDesktop?.saveAccount
    if (!save) {
      setError('请在 MyHKU 桌面版中管理本地加密账户')
      return
    }
    setBusy(true)
    try {
      const result = await save({ localUsername: username.trim(), email: email.trim(), password })
      await window.myhkuDesktop?.beginLogin?.()
      onReady({ username: result.localUsername || username.trim(), email: result.email || email.trim() })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '账户保存失败')
    } finally {
      setBusy(false)
      setPassword('')
    }
  }

  const card = (
    <div className="account-card" role={modal ? 'dialog' : undefined} aria-modal={modal || undefined}>
      {modal && onCancel && (
        <button type="button" className="modal-close" onClick={onCancel} aria-label="关闭窗口">
          <X size={18} />
        </button>
      )}
      <img className="account-mark" src="./brand/logo.svg" alt="MyHKU" />
      <p className="eyebrow">{modal ? '更新本地安全凭据' : '第一次使用 MyHKU'}</p>
      <h1>{modal ? '修改 HKU 账户' : '创建你的 HKU 账户'}</h1>
      <p className="account-intro">
        保存后，MyHKU 会在后台复用官方登录会话。首次登录或会话过期时仍需在 HKU 官方窗口完成 2FA。
      </p>
      <form onSubmit={submit} className="account-form">
        <label>
          本地用户名
          <input
            value={username}
            onChange={event => setUsername(event.target.value)}
            placeholder="请输入显示昵称或姓名"
            autoComplete="username"
            autoFocus
          />
        </label>
        <label>
          HKU 邮箱（支持 @connect.hku.hk / @hku.hk）
          <input
            value={email}
            onChange={event => setEmail(event.target.value)}
            type="email"
            placeholder="请输入学校邮箱"
            autoComplete="email"
          />
        </label>
        <label>
          HKU 密码
          <input
            value={password}
            onChange={event => setPassword(event.target.value)}
            type="password"
            placeholder="请输入 Portal 登录密码"
            autoComplete="current-password"
          />
        </label>
        {error && <p className="account-error" role="alert">{error}</p>}
        <div className="account-form-actions">
          {modal && onCancel && (
            <button type="button" className="outline-btn" onClick={onCancel} disabled={busy}>
              取消
            </button>
          )}
          <button type="submit" className="account-submit" disabled={busy}>
            {busy ? (
              <>
                <RefreshCw size={15} className="spin" /> 正在保存…
              </>
            ) : (
              <>
                <LogIn size={15} /> {modal ? '保存并重新连接' : '保存并开始首次登录'}
              </>
            )}
          </button>
        </div>
      </form>
      <p className="account-footnote">
        <ShieldCheck size={14} /> 密码只交给桌面版的系统安全存储，不会进入网页缓存或同步数据。
      </p>
    </div>
  )

  return modal ? <div className="modal-backdrop">{card}</div> : <div className="account-gate">{card}</div>
}
