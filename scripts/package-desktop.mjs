import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const output = process.env.MYHKU_RELEASE_DIR || path.join(os.tmpdir(), 'MyHKU-release')
const command = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const child = spawn(command, ['electron-builder', ...process.argv.slice(2), `--config.directories.output=${output}`], { stdio: 'inherit', shell: process.platform === 'win32' })
child.on('exit', code => {
  console.log(`Desktop artifacts: ${output}`)
  process.exit(code ?? 1)
})
