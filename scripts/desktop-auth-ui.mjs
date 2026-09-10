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
    window.sessions = Object.fromEntries(['portal', 'sis', 'moodle'].map(site => [site, { state: 'checking' }]));
    window.myhkuDesktop = {
      accountStatus: async () => ({ configured: true, localUsername: 'Fixture', email: 'student@example.test', sessions: window.sessions }),
      authSessions: async () => window.sessions,
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
  await run(`window.sessions = Object.fromEntries(['portal', 'sis', 'moodle'].map(site => [site, { state: 'connected' }])); window.authChanged({ state: 'connected', sessions: window.sessions })`)
  await until('document.body.innerText.includes("HKU 已连接，正在读取数据")')
  assert.equal(await run('document.body.innerText.includes("重新检查")'), false, 'already logged in never asks for another login/check')
  await run('window.snapshotReady = true; window.dataChanged()')
  await until('document.body.innerText.includes("今日课程")')
  await run('[...document.querySelectorAll("nav button")].find(node => node.innerText.includes("设置")).click()')
  await until('document.querySelectorAll(".connection-state.connected").length === 3')
  assert.equal(await run('[...document.querySelectorAll(".login-link")].every(node => node.disabled && node.innerText.includes("已连接"))'), true)
  console.log('PASS dashboard UI: automatic connection, logged-in data loading, automatic data arrival, connected service buttons')
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
