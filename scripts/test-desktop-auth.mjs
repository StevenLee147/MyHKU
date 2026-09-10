import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const electron = createRequire(import.meta.url)('electron')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
for (const [command, args] of [
  [process.execPath, ['--test', 'scripts/desktop-auth.test.mjs']],
  [electron, ['scripts/desktop-auth-browser.mjs']],
  [electron, ['scripts/desktop-auth-ui.mjs']],
  [electron, ['scripts/desktop-auth-integration.mjs']],
]) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env, windowsHide: true })
    child.once('error', reject)
    child.once('exit', code => resolve(code ?? 1))
  })
  if (code !== 0) { process.exitCode = code; break }
}
