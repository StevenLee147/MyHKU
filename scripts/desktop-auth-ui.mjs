import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

app.setPath('userData', mkdtempSync(join(tmpdir(), 'myhku-auth-ui-')))
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) && !details.url.startsWith('https://dashboard.example.test/') }))
  const index = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
  const bundle = index.match(/src="\.\/([^"\s]+\.js)"/)[1]
  const source = readFileSync(new URL(`../dist/${bundle}`, import.meta.url), 'utf8')
  const mock = `
    window.sessions = Object.fromEntries(['portal', 'sis', 'moodle'].map(site => [site, { state: 'checking', revision: 1 }]));
    window.myhkuDesktop = {
      accountStatus: async () => ({ configured: true, localUsername: 'Fixture', email: 'student@example.test', sessions: window.sessions }),
      authSessions: async () => {
        if (window.failReads) throw new Error('Fixture IPC unavailable');
        if (window.holdNextRead) {
          window.holdNextRead = false;
          const captured = structuredClone(window.sessions);
          return new Promise(resolve => { window.releaseRead = () => resolve(captured) });
        }
        return window.sessions;
      },
      onAuthStatus: callback => { window.authChanged = callback; return () => {} },
      onHkuUpdated: callback => { window.dataChanged = callback; return () => {} },
      refreshHku: async () => 3
    };
    window.fetch = async () => new Response(JSON.stringify(window.snapshotReady ? {
      fetchedAt: new Date().toISOString(), schedule: [], courses: [], assignments: [], resources: [], grades: [], announcements: []
    } : {}), { headers: { 'Content-Type': 'application/json' } });
  `
  await win.webContents.session.protocol.handle('https', () => new Response(`<meta charset="utf-8"><div id="root"></div><script>${mock}</script><script type="module">${source}</script>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
  await win.loadURL('https://dashboard.example.test/')
  const run = code => win.webContents.executeJavaScript(code)
  async function until(code) {
    for (let i = 0; i < 120; i++) {
      if (await run(code)) return
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`UI assertion timed out: ${code}`)
  }
  await until('document.body.innerText.includes("正在自动连接 HKU")')
  assert.equal(await run('document.body.innerText.includes("真实数据尚未连接")'), false)
  assert.equal(await run('document.body.innerText.includes("等待完成 2FA")'), false)
  await run(`window.sessions.portal = { state: 'needs_2fa', revision: 2 }; window.authChanged({ state: 'needs_2fa', sessions: window.sessions }); window.holdNextRead = true`)
  await until('document.querySelector(".auth-banner") !== null && typeof window.releaseRead === "function"')
  await run(`window.sessions = Object.fromEntries(['portal', 'sis', 'moodle'].map(site => [site, { state: 'connected', revision: 3 }])); window.authChanged({ state: 'connected', sessions: window.sessions })`)
  await until('document.body.innerText.includes("HKU 已连接，正在读取数据")')
  await run('window.releaseRead()')
  await new Promise(resolve => setTimeout(resolve, 200))
  assert.equal(await run('document.querySelector(".auth-banner") === null && document.body.innerText.includes("已安全连接")'), true, 'late polling response cannot undo a newer login event')
  await run(`window.sessions.portal = { state: 'needs_2fa', revision: 4 }; window.authChanged({ state: 'needs_2fa', sessions: window.sessions })`)
  await until('document.querySelector(".auth-banner") !== null')
  await run(`window.sessions.portal = { state: 'connected', revision: 5 }`)
  await until('document.querySelector(".auth-banner") === null && document.body.innerText.includes("已安全连接")')
  assert.equal(await run('document.body.innerText.includes("重新检查")'), false, 'already logged in never asks for another login/check')
  await run('window.snapshotReady = true; window.dataChanged()')
  await until('document.body.innerText.includes("今日课程")')
  await run('[...document.querySelectorAll("nav button")].find(node => node.innerText.includes("设置")).click()')
  await until('document.querySelectorAll(".connection-state.connected").length === 3')
  assert.equal(await run('[...document.querySelectorAll(".login-link")].every(node => node.disabled && node.innerText.includes("已连接"))'), true)
  await run('window.failReads = true; document.querySelector(".check-link").click()')
  await until('document.body.innerText.includes("无法读取连接状态") && !document.querySelector(".check-link").disabled')
  await run(`window.failReads = false; window.sessions = Object.fromEntries(['portal', 'sis', 'moodle'].map(site => [site, { state: 'disconnected', revision: 6 }])); window.authChanged({ state: 'signed_out', configured: false, sessions: window.sessions })`)
  await until('document.querySelector(".account-form") !== null')
  console.log('PASS dashboard UI: stale-response protection, missed-event recovery, MFA banner recovery, status/data separation, IPC failure recovery, sign-out')
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
