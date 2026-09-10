import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const output = path.resolve(process.env.MYHKU_RELEASE_DIR || path.join(root, 'release'))
const stage = path.join(output, `MyHKU-${pkg.version}`)
fs.mkdirSync(stage, { recursive: true })
const candidates = [path.join(root, 'dist-electron'), path.join(root, 'android', 'app', 'build', 'outputs')]
for (const source of candidates) {
  if (!fs.existsSync(source)) continue
  const destination = path.join(stage, path.basename(source))
  fs.cpSync(source, destination, { recursive: true, force: true })
}
const files = []
function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (entry.name !== 'SHA256SUMS.txt') files.push(full) } }
walk(stage)
const sums = files.sort().map(file => `${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}  ${path.relative(stage, file).replaceAll('\\', '/')}`).join('\n') + '\n'
fs.writeFileSync(path.join(stage, 'SHA256SUMS.txt'), sums)
console.log(`Release staged at ${stage}`)
