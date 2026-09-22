import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

app.setPath('userData', mkdtempSync(join(tmpdir(), 'myhku-legal-test-')))
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 940, webPreferences: { sandbox: true, offscreen: true } })
  const index = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
  const js = readFileSync(new URL(`../dist/${index.match(/src="\.\/([^"\s]+\.js)"/)[1]}`, import.meta.url), 'utf8')
  const css = readFileSync(new URL(`../dist/${index.match(/href="\.\/([^"\s]+\.css)"/)[1]}`, import.meta.url), 'utf8')
  await win.webContents.session.protocol.handle('https', request => {
    if (request.url.endsWith('/brand/logo.svg')) return new Response(readFileSync(new URL('../public/brand/logo.svg', import.meta.url)), { headers: { 'Content-Type': 'image/svg+xml' } })
    return new Response(`<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>window.accountReads=0; window.myhkuDesktop={accountStatus:async()=>{window.accountReads++;return {configured:false}}};</script><script type="module">${js}</script>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  })
  const run = code => win.webContents.executeJavaScript(code)
  async function until(code) {
    for (let i = 0; i < 100; i++) { if (await run(code)) return; await new Promise(resolve => setTimeout(resolve, 60)) }
    throw new Error(`Timed out: ${code}`)
  }
  await win.loadURL('https://legal.example.test/')
  await until('document.querySelectorAll(".legal-consent input").length === 3')
  assert.equal(await run('window.accountReads'), 0)
  assert.equal(await run('document.querySelector(".account-submit").disabled'), true)
  await run('document.querySelector(".legal-actions .text-btn").click()')
  await until('document.querySelector("[role=status]") !== null')
  assert.equal(await run('window.accountReads'), 0, 'declining never mounts account or sync UI')
  writeFileSync(join(app.getPath('userData'), 'legal-desktop.png'), (await win.webContents.capturePage()).toPNG())
  win.setSize(390, 844)
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(await run('document.documentElement.scrollWidth <= window.innerWidth'), true, 'mobile agreement has no horizontal overflow')
  writeFileSync(join(app.getPath('userData'), 'legal-mobile.png'), (await win.webContents.capturePage()).toPNG())
  await run('document.querySelector(".legal-consent input").click()')
  assert.equal(await run('document.querySelector(".account-submit").disabled'), true)
  await run('[...document.querySelectorAll(".legal-consent input")].slice(1).forEach(input => input.click())')
  await until('!document.querySelector(".account-submit").disabled')
  await run('document.querySelector(".account-submit").click()')
  await until('document.querySelector(".account-form") !== null')
  const consent = await run('JSON.parse(localStorage.getItem("myhku-legal-consent"))')
  assert.ok(consent.acceptedAt)
  await win.reload()
  await until('document.querySelector(".account-form") !== null')
  await run('localStorage.setItem("myhku-legal-consent", JSON.stringify({version:"obsolete"}))')
  await win.reload()
  await until('document.querySelectorAll(".legal-consent input").length === 3')
  assert.equal(await run('window.accountReads'), 0, 'changed agreement requires fresh consent')
  console.log(`PASS agreements: decline, all three confirmations, persistence, version change, mobile layout; screenshots: ${app.getPath('userData')}`)
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
