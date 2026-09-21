export const SERVICE_URLS = {
  portal: 'https://studentportal.hku.hk/',
  sis: 'https://sis-main.hku.hk/psp/sisprod/EMPLOYEE/PSFT_CS/c/SA_LEARNER_SERVICES.SSR_SSENRL_SCHD_W.GBL?pslnkid=Z_HC_SSR_SSENRL_SCHD_W_LNK',
  moodle: 'https://moodle.hku.hk/my/',
}

export const AUTH_TIMING = { settle: 250, poll: 500, inspect: 3000, manual: 20_000, timeout: 90_000 }

export function serviceForUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return null
    const host = url.hostname
    if (host === 'studentportal.hku.hk') return 'portal'
    if (host === 'moodle.hku.hk') return 'moodle'
    if (['sis-main.hku.hk', 'sweb.hku.hk', 'intraweb.hku.hk'].includes(host)) return 'sis'
  } catch { /* not a service URL */ }
  return null
}

// Keep identity stable across HKU -> Microsoft -> ADFS redirects. Only one
// service performs automatic SSO actions at a time. Windows awaiting user
// input remain observable without holding up the remaining services.
export class AuthCoordinator {
  constructor(start, changed = () => {}) {
    this.start = start
    this.changed = changed
    this.records = new Map()
    this.active = null
    this.revision = 0
    this.resetRevision = 0
  }

  touch(record) {
    Object.assign(record, { revision: ++this.revision, checkedAt: new Date().toISOString() })
  }

  request(site, { show = false, refresh = false, resume = false } = {}) {
    if (!Object.hasOwn(SERVICE_URLS, site)) throw new Error('Unknown HKU service')
    let record = this.records.get(site)
    if (!record) {
      record = { site, state: 'queued', show, detail: '等待前一个服务完成自动登录' }
      this.touch(record)
      this.records.set(site, record)
    } else {
      record.show ||= show
      if (show && ['manual_required', 'needs_2fa'].includes(record.state)) record.window?.show()
      if (record.state === 'error' || record.state === 'disconnected' || (refresh && record.state === 'connected') ||
        (resume && ['manual_required', 'needs_2fa'].includes(record.state))) {
        Object.assign(record, { refresh: refresh && record.state === 'connected', state: 'queued', detail: '等待前一个服务完成自动登录', resume })
        this.touch(record)
      }
    }
    this.changed()
    this.pump()
    return record
  }

  pump() {
    if (this.active) return
    const record = [...this.records.values()].find(item => item.state === 'queued')
    if (!record) return
    this.active = record.site
    this.update(record.site, 'checking', '正在自动检查并恢复登录')
    const run = record.run = (record.run || 0) + 1
    const failed = () => {
      if (this.records.get(record.site) === record && record.run === run && this.active === record.site) {
        this.update(record.site, 'error', '无法打开官方登录页面，请重试')
      }
    }
    try { Promise.resolve(this.start(record)).catch(failed) } catch { failed() }
  }

  update(site, state, detail = '') {
    const record = this.records.get(site)
    if (!record) return
    if (record.state !== state || record.detail !== detail) {
      Object.assign(record, { state, detail })
      this.touch(record)
      this.changed()
    }
    if (['connected', 'error', 'disconnected', 'manual_required', 'needs_2fa'].includes(state) && this.active === site) {
      this.active = null
      this.pump()
    }
  }

  snapshot() {
    return Object.fromEntries(Object.keys(SERVICE_URLS).map(site => {
      const record = this.records.get(site)
      return [site, record ? { state: record.state, detail: record.detail, checkedAt: record.checkedAt, revision: record.revision } : { state: 'disconnected', revision: this.resetRevision }]
    }))
  }

  reset() { this.records.clear(); this.active = null; this.resetRevision = ++this.revision; this.changed() }
}

// Serialized into the official page. Inspect rendered DOM, never cookies or
// tokens. Actions are guarded per document so overlapping load events cannot
// submit the same form twice. Passwords are accepted only by identity hosts.
export function inspectAuthPage(credentials = null, act = false, targetSite = null) {
  const host = location.hostname.toLowerCase()
  const identity = ['login.microsoftonline.com', 'login.microsoft.com', 'login.windows.net', 'login.live.com', 'account.live.com', 'account.microsoft.com', 'adfs.connect.hku.hk', 'hkuportal.hku.hk'].includes(host)
  const service = ['studentportal.hku.hk', 'sis-main.hku.hk', 'sweb.hku.hk', 'intraweb.hku.hk', 'moodle.hku.hk'].includes(host)
  if (location.protocol !== 'https:' || (!identity && !service)) return { state: 'waiting' }
  const visible = node => node && !node.disabled && node.getClientRects().length > 0 && node.ownerDocument.defaultView.getComputedStyle(node).visibility !== 'hidden'
  const documents = [document]
  for (const doc of documents) {
    for (const frame of doc.querySelectorAll('iframe,frame')) {
      try { if (visible(frame) && frame.contentDocument && !documents.includes(frame.contentDocument)) documents.push(frame.contentDocument) } catch { /* cross-origin frames are inspected by the main process */ }
    }
  }
  const nodes = selector => documents.flatMap(doc => [...doc.querySelectorAll(selector)])
  const inputs = nodes('input').filter(visible)
  const controls = nodes('a,button,input[type=submit],input[type=button]').filter(visible)
  const label = node => `${node.innerText || node.textContent || ''} ${node.value || ''} ${node.getAttribute('aria-label') || ''}`.trim()
  const text = documents.map(doc => doc.body?.innerText || '').join(' ').slice(0, 30_000)
  const password = inputs.find(node => node.type === 'password')
  const email = inputs.find(node => /^(email|text)$/.test(node.type) && /email|user|login|account|loginfmt/i.test(`${node.name} ${node.id} ${node.autocomplete} ${node.placeholder}`))
  const once = (key, action) => {
    const done = window.__myhkuAuthActions ||= new Set()
    if (done.has(key)) return { state: 'waiting' }
    if (!act) return { state: 'automatic', action: key }
    done.add(key)
    action()
    return { state: 'submitted', action: key }
  }
  // Authenticated UI takes precedence over search boxes, announcements and
  // optional navigation. Login forms and Moodle's guest marker still win.
  const logout = controls.some(node => /^(?:log\s*out|sign\s*out|退出|登出|注销|登出系統)$/i.test(label(node))) ||
    nodes('a[href]').some(node => {
      try {
        const url = new URL(node.getAttribute('href'), `https://${host}${location.pathname}`)
        if (url.protocol !== 'https:' || ![host, 'hkuportal.hku.hk'].includes(url.hostname)) return false
        return /(?:\/logout(?:\/|\.|$)|\/signout(?:\/|\.|$)|\/Account\/Login\/LogOff(?:\/|$)|\/cas\/servlet\/edu\.yale\.its\.tp\.cas\.servlet\.PortalLogout\/?$)/i.test(url.pathname) ||
          url.searchParams.get('cmd')?.toLowerCase() === 'logout'
      } catch { return false }
    })
  const guest = host === 'moodle.hku.hk' && documents.some(doc => doc.body?.classList.contains('notloggedin'))
  const moodle = host === 'moodle.hku.hk' && nodes('.usermenu .userbutton,[data-region="myoverview"]').some(visible)
  const sis = /^(?:sis-main|sweb|intraweb)\.hku\.hk$/.test(host) && nodes('[name="DERIVED_CLASS_S_SSR_NEXT_WEEK"],[name="DERIVED_CLASS_S_SSR_PREV_WEEK"],#WEEKLY_SCHED_HTMLAREA,table[summary*="Weekly Schedule"],.bkgCalViewWDHeader,.bkgCalViewwdheader').some(visible)
  const sisShell = host === 'sis-main.hku.hk' && nodes('#pthdr2signout').some(node => /^(?:Sign Out|退出|登出|注销)$/i.test(node.textContent.trim()))
  if (service && !password && !guest && (logout || moodle || sis || sisShell)) {
    if (host === 'studentportal.hku.hk' && targetSite === 'sis') {
      const entry = controls.find(node => /\bSIS\b|Student Information System|学生信息系统|學生資訊系統/i.test(label(node)))
      if (entry) return once('sis-entry', () => entry.click())
      return { state: 'manual_required', detail: 'Portal 已登录，请从 Portal 的 SIS 入口进入学生信息系统' }
    }
    if (targetSite === 'sis' && sisShell && !sis) {
      const timetable = controls.find(node => /^My Weekly Schedule$/i.test(label(node)))
      if (timetable) {
        const next = once('sis-timetable', () => timetable.click())
        return { state: 'authenticated', ...(next.action ? { action: next.action } : {}) }
      }
    }
    return { state: 'authenticated' }
  }
  // SIS rejects direct deep links without a Portal launch. Its error page
  // can also be served by CAS; recover through the real Portal entry.
  if (targetSite === 'sis' && ((host === 'hkuportal.hku.hk' && /^\/cas\/login_error\.html$/i.test(location.pathname)) ||
    (/^(?:sis-main|sweb|intraweb)\.hku\.hk$/.test(host) && /not.{0,40}(?:login|sign.on).{0,20}page|(?:please|must).{0,60}(?:login|log in|sign in).{0,40}portal|不是.{0,30}(?:登录|登錄|登入)|请从.{0,20}portal/i.test(text)))) {
    return once('sis-portal', () => location.assign('https://studentportal.hku.hk/'))
  }
  // Portal Login takes precedence over the adjacent SIS/Moodle guest form.
  const portal = controls.find(node => /^(?:(?:HKU\s*)?Portal\s*(?:User|Login|Log\s*in)|Log\s*in\s*(?:via|with)\s*(?:HKU\s*)?Portal)$/i.test(label(node)) ||
    (host === 'sis-main.hku.hk' && /^https:\/\/hkuportal\.hku\.hk\/?$/i.test(node.getAttribute('href') || '') && /hkuportal\.hku\.hk|^HKU Portal$/i.test(label(node))))
  if (portal) return once('portal', () => portal.click())
  const error = nodes('[role=alert],.error,.alert-danger,#errorText,#passwordError,#usernameError').find(node => visible(node) && /incorrect|invalid|failed|wrong|try again|错误|不正确/i.test(node.textContent))
  if ((identity || password) && error) return { state: 'manual_required', immediate: true, detail: '官方页面提示登录失败，请检查账户或完成页面提示' }
  if ((identity && !password && !email && /approve (?:the |a )?(?:sign.in|request)|enter (?:the )?(?:verification |security )?code|verify your identity|authenticator|two.factor|验证码|批准.*登录/i.test(text)) || inputs.some(node => /otc|otp|one-time-code|ProofConfirmation/i.test(`${node.name} ${node.id} ${node.autocomplete}`))) {
    return { state: 'needs_2fa', detail: '请在官方窗口完成身份验证，完成后会自动更新连接' }
  }
  if (identity && (password || email)) {
    if (!credentials) return { state: 'manual_required', immediate: true, detail: '请在官方窗口登录' }
    const field = password || email
    const form = field.form || field.closest('form')
    const submit = controls.find(node => node.id === 'idSIButton9' || node.id === 'submitButton' ||
      (host === 'hkuportal.hku.hk' && node.id === 'login_btn')) || (form && [...form.querySelectorAll('button[type=submit],input[type=submit],button:not([type])')].find(visible))
    if (!submit && !form?.requestSubmit) return { state: 'waiting' }
    return once(password ? 'password' : 'email', () => {
      const set = (input, value) => {
        if (!input) return
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }
      const portalUid = host === 'hkuportal.hku.hk' && email &&
        !/email|loginfmt/i.test(`${email.type} ${email.name} ${email.id} ${email.autocomplete} ${email.placeholder}`)
      set(email, portalUid ? credentials.email.split('@')[0] : credentials.email)
      if (password) set(password, credentials.password)
      if (submit) submit.click()
      else form.requestSubmit()
    })
  }
  // Reuse the selected account without opening another identity flow.
  if (identity && credentials) {
    const account = [...document.querySelectorAll('[role=button],button,a')].find(node => visible(node) && label(node).toLowerCase().includes(credentials.email.toLowerCase()))
    if (account) return once('account', () => account.click())
  }
  if (identity && /stay signed in|保持登录/i.test(text)) {
    const skip = controls.find(node => node.id === 'idBtn_Back')
    if (skip) return once('stay-signed-in', () => skip.click())
  }
  if (host === 'moodle.hku.hk' && password) {
    return once('moodle-cas', () => location.assign('https://moodle.hku.hk/login/index.php?authCAS=CAS'))
  }
  if (password || (identity && email)) return { state: 'manual_required', detail: '请使用官方 Portal 登录入口；不会向访客表单填写账户' }
  // A business URL or an empty page alone is never authentication evidence.
  const casSuccess = host === 'hkuportal.hku.hk' && /^\/cas(?:\/|$)/i.test(location.pathname) &&
    /\bLog\s*In Successful\b|\bYou have successfully logged into the Central Authentication Service\b|登录成功|登入成功|登錄成功/i.test(text)
  if (host === 'hkuportal.hku.hk' && (logout || casSuccess)) return { state: 'sso_authenticated' }
  if (/\b(?:you have|you are now)\s+(?:successfully\s+)?(?:logged|signed)\s+out\b|\b(?:log\s*out|sign\s*out)\s+(?:successful|complete)\b|[您你]已(?:成功)?(?:登出|注销|註銷|退出)/i.test(text)) {
    return { state: 'signed_out', detail: '已退出官方登录，请重新连接' }
  }
  return { state: 'waiting' }
}
