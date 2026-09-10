export const SERVICE_URLS = {
  portal: 'https://studentportal.hku.hk/',
  sis: 'https://sweb.hku.hk/student/servlet/MyWeekly/showTimetable',
  moodle: 'https://moodle.hku.hk/my/',
}

export const AUTH_TIMING = { settle: 1800, poll: 1000, manual: 20_000, timeout: 90_000 }

export function serviceForUrl(value) {
  try {
    const host = new URL(value).hostname
    if (host === 'studentportal.hku.hk') return 'portal'
    if (host === 'moodle.hku.hk') return 'moodle'
    if (['sis-main.hku.hk', 'sweb.hku.hk', 'intraweb.hku.hk'].includes(host)) return 'sis'
  } catch { /* not a service URL */ }
  return null
}

// Keep identity stable across HKU -> Microsoft -> ADFS redirects. Only one
// service negotiates the shared SSO session at a time.
export class AuthCoordinator {
  constructor(start, changed = () => {}) {
    this.start = start
    this.changed = changed
    this.records = new Map()
    this.active = null
  }

  request(site, { show = false, refresh = false } = {}) {
    if (!Object.hasOwn(SERVICE_URLS, site)) throw new Error('Unknown HKU service')
    let record = this.records.get(site)
    if (!record) {
      record = { site, state: 'queued', show, checkedAt: new Date().toISOString() }
      this.records.set(site, record)
    } else {
      record.show ||= show
      if (show && ['manual_required', 'needs_2fa'].includes(record.state)) record.window?.show()
      if (record.state === 'error' || record.state === 'disconnected' || (refresh && record.state === 'connected')) {
        Object.assign(record, { state: 'queued', detail: '等待前一个服务完成登录', checkedAt: new Date().toISOString() })
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
    this.start(record)
  }

  update(site, state, detail = '') {
    const record = this.records.get(site)
    if (!record) return
    Object.assign(record, { state, detail, checkedAt: new Date().toISOString() })
    this.changed()
    if (['connected', 'error', 'disconnected'].includes(state) && this.active === site) {
      this.active = null
      this.pump()
    }
  }

  snapshot() {
    return Object.fromEntries(Object.keys(SERVICE_URLS).map(site => {
      const record = this.records.get(site)
      return [site, record ? { state: record.state, detail: record.detail, checkedAt: record.checkedAt } : { state: 'disconnected' }]
    }))
  }

  reset() { this.records.clear(); this.active = null; this.changed() }
}

// Serialized into the official page. Inspect rendered DOM, never cookies or
// tokens. Actions are guarded per document so overlapping load events cannot
// submit the same form twice. Passwords are accepted only by identity hosts.
export function inspectAuthPage(credentials = null, act = false) {
  const host = location.hostname.toLowerCase()
  const identity = ['login.microsoftonline.com', 'login.microsoft.com', 'login.windows.net', 'login.live.com', 'account.live.com', 'account.microsoft.com', 'adfs.connect.hku.hk', 'hkuportal.hku.hk'].includes(host)
  const service = ['studentportal.hku.hk', 'sis-main.hku.hk', 'sweb.hku.hk', 'intraweb.hku.hk', 'moodle.hku.hk'].includes(host)
  if (location.protocol !== 'https:' || (!identity && !service)) return { state: 'waiting' }
  const visible = node => node && !node.disabled && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden'
  const documents = [document]
  for (const frame of document.querySelectorAll('iframe')) {
    try { if (visible(frame) && frame.contentDocument) documents.push(frame.contentDocument) } catch { /* cross-origin frame */ }
  }
  const nodes = selector => documents.flatMap(doc => [...doc.querySelectorAll(selector)])
  const inputs = nodes('input').filter(visible)
  const controls = nodes('a,button,input[type=submit],input[type=button]').filter(visible)
  const label = node => `${node.innerText || node.textContent || ''} ${node.value || ''} ${node.getAttribute('aria-label') || ''}`.trim()
  const text = documents.map(doc => doc.body?.innerText || '').join(' ').slice(0, 30_000)
  const once = (key, action) => {
    const done = window.__myhkuAuthActions ||= new Set()
    if (done.has(key)) return { state: 'waiting' }
    if (!act) return { state: 'automatic', action: key }
    done.add(key)
    action()
    return { state: 'submitted', action: key }
  }
  // Portal Login takes precedence over the adjacent SIS/Moodle guest form.
  const portal = controls.find(node => /^(?:(?:HKU\s*)?Portal\s*(?:User|Login|Log\s*in)|Log\s*in\s*(?:via|with)\s*(?:HKU\s*)?Portal)$/i.test(label(node)) ||
    (host === 'sis-main.hku.hk' && /^https:\/\/hkuportal\.hku\.hk\/?$/i.test(node.getAttribute('href') || '') && /hkuportal\.hku\.hk|^HKU Portal$/i.test(label(node))))
  if (portal) return once('portal', () => portal.click())
  const password = inputs.find(node => node.type === 'password')
  const email = inputs.find(node => /^(email|text)$/.test(node.type) && /email|user|login|account|loginfmt/i.test(`${node.name} ${node.id} ${node.autocomplete} ${node.placeholder}`))
  const error = nodes('[role=alert],.error,.alert-danger,#errorText,#passwordError,#usernameError').find(node => visible(node) && node.textContent.trim())
  if (error && /incorrect|invalid|failed|wrong|try again|错误|不正确/i.test(error.textContent)) return { state: 'manual_required', detail: '官方页面提示登录失败，请检查账户或完成页面提示' }
  if ((!password && !email && /approve (?:the |a )?(?:sign.in|request)|enter (?:the )?(?:verification |security )?code|verify your identity|authenticator|two.factor|验证码|批准.*登录/i.test(text)) || inputs.some(node => /otc|otp|one-time-code|ProofConfirmation/i.test(`${node.name} ${node.id} ${node.autocomplete}`))) {
    return { state: 'needs_2fa', detail: '请在官方窗口完成身份验证，完成后会自动更新连接' }
  }
  if (identity && (password || email)) {
    if (!credentials) return { state: 'manual_required', detail: '请在官方窗口登录' }
    const field = password || email
    const form = field.form || field.closest('form')
    const submit = controls.find(node => node.id === 'idSIButton9' || node.id === 'submitButton') || (form && [...form.querySelectorAll('button[type=submit],input[type=submit],button:not([type])')].find(visible))
    if (!submit && !form?.requestSubmit) return { state: 'waiting' }
    return once(password ? 'password' : 'email', () => {
      const set = (input, value) => {
        if (!input) return
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }
      set(email, host === 'hkuportal.hku.hk' && email?.type !== 'email' ? credentials.email.split('@')[0] : credentials.email)
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
  if (password || email) return { state: 'manual_required', detail: '请使用官方 Portal 登录入口；不会向访客表单填写账户' }
  // A business URL or an empty page alone is never authentication evidence.
  const logout = controls.some(node => /^(?:log\s*out|sign\s*out|退出|登出|注销)$/i.test(label(node))) ||
    nodes('a[href]').some(node => /(?:\/logout(?:[/?#.]|$)|\/signout(?:[/?#.]|$)|\/Account\/Login\/LogOff|[?&]cmd=logout)/i.test(node.getAttribute('href') || ''))
  const moodle = host === 'moodle.hku.hk' && nodes('body:not(.notloggedin) .usermenu .userbutton,body:not(.notloggedin) [data-region="myoverview"]').some(visible)
  const sis = /^(?:sis-main|sweb|intraweb)\.hku\.hk$/.test(host) && nodes('[name="DERIVED_CLASS_S_SSR_NEXT_WEEK"],[name="DERIVED_CLASS_S_SSR_PREV_WEEK"],#WEEKLY_SCHED_HTMLAREA,table[summary*="Weekly Schedule"],.bkgCalViewWDHeader,.bkgCalViewwdheader').some(visible)
  if (service && (logout || moodle || sis)) return { state: 'authenticated' }
  if (host === 'hkuportal.hku.hk' && logout) return { state: 'sso_authenticated' }
  return { state: 'waiting' }
}
