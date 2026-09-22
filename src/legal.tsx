import { useEffect, useState, type ReactNode } from 'react'
import agreements from '../public/legal/agreements.json'

export const LEGAL_VERSION = agreements.version
const storageKey = 'myhku-legal-consent'

export function LegalDocuments() {
  return <div className="legal-documents">{agreements.documents.map(document => <section key={document.id} aria-labelledby={`legal-${document.id}`}>
    <h2 id={`legal-${document.id}`}>{document.title}</h2>
    {document.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
  </section>)}</div>
}

export function LegalSettings() {
  const [open, setOpen] = useState(false)
  return <section className="panel legal-settings"><h2>关于 MyHKU</h2><p>独立开发的学习工具 · 非 HKU 官方应用</p><button className="text-btn" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? '收起协议' : '查看用户协议、隐私说明及免责声明'}</button>{open && <><p>协议版本：{LEGAL_VERSION}</p><LegalDocuments /></>}</section>
}

export function LegalGate({ children }: { children: ReactNode }) {
  const [accepted, setAccepted] = useState<boolean | null>(null)
  const [checked, setChecked] = useState<string[]>([])
  const [error, setError] = useState('')
  const [declined, setDeclined] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const load = async () => {
      if (window.myhkuDesktop?.legalStatus) return (await window.myhkuDesktop.legalStatus()).accepted
      if (window.myhkuAndroid?.hasAcceptedLegal) return window.myhkuAndroid.hasAcceptedLegal()
      try { return JSON.parse(localStorage.getItem(storageKey) || 'null')?.version === LEGAL_VERSION } catch { return false }
    }
    load().then(setAccepted).catch(() => { setAccepted(false); setError('无法读取协议确认记录，请重新确认。') })
  }, [])
  const accept = async () => {
    if (checked.length !== agreements.documents.length) return
    setBusy(true); setError('')
    try {
      if (window.myhkuDesktop?.acceptLegal) await window.myhkuDesktop.acceptLegal(LEGAL_VERSION)
      else localStorage.setItem(storageKey, JSON.stringify({ version: LEGAL_VERSION, acceptedAt: new Date().toISOString() }))
      setAccepted(true)
    } catch { setError('无法保存确认记录，请检查本机存储权限后重试。') }
    finally { setBusy(false) }
  }
  if (accepted === null) return <div className="account-gate">正在读取使用协议…</div>
  if (accepted) return children
  return <main className="legal-gate"><div className="legal-card">
    <header className="legal-heading"><img src="./brand/logo.svg" alt="MyHKU" width="64" height="64"/><div><p className="eyebrow">MYHKU · 你的学习空间</p><h1>开始之前，请了解这些约定</h1></div></header>
    <p className="legal-intro">MyHKU 是独立开发的学习工具。请阅读以下条款，并逐项确认后继续。协议版本：{LEGAL_VERSION}</p>
    <LegalDocuments />
    <div className="legal-consent">{agreements.documents.map(document => <label key={document.id}><input type="checkbox" checked={checked.includes(document.id)} onChange={event => setChecked(current => event.target.checked ? [...current, document.id] : current.filter(id => id !== document.id))}/>我已阅读并同意《{document.title}》</label>)}</div>
    {error && <p role="alert" className="account-error">{error}</p>}
    {declined && <p role="status">你尚未同意协议，登录和同步功能未开启。可以关闭此页面，或阅读后重新选择。</p>}
    <div className="legal-actions"><button className="text-btn" onClick={() => { if (window.myhkuDesktop?.declineLegal) void window.myhkuDesktop.declineLegal(); else setDeclined(true) }}>不同意并退出</button><button className="account-submit" disabled={busy || checked.length !== agreements.documents.length} onClick={() => void accept()}>{busy ? '正在保存…' : '同意并继续'}</button></div>
  </div></main>
}
