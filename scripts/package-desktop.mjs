import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const output = process.env.MYHKU_RELEASE_DIR || path.join(os.tmpdir(), 'MyHKU-release')
const command = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const env = { ...process.env }
// GitHub supplies unset optional secrets as empty strings. electron-builder
// treats an empty CSC_LINK as a certificate path, so omit those empty values.
for (const name of ['CSC_LINK', 'CSC_INSTALLER_LINK']) {
  if (env[name]?.trim() === '') delete env[name]
}
const child = spawn(command, ['electron-builder', ...process.argv.slice(2), `--config.directories.output=${output}`], { env, stdio: 'inherit', shell: process.platform === 'win32' })
child.on('exit', code => {
  console.log(`Desktop artifacts: ${output}`)
  process.exit(code ?? 1)
})
