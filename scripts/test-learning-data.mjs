import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const electron = createRequire(import.meta.url)('electron')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, ['scripts/learning-data-browser.mjs'], { stdio: 'inherit', env, windowsHide: true })
child.on('exit', code => { process.exitCode = code ?? 1 })
child.on('error', error => { console.error(error); process.exitCode = 1 })
