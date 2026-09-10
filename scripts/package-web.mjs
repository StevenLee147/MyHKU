import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.resolve(process.env.MYHKU_RELEASE_DIR || path.join(root, 'release'))
const target = path.join(output, 'web')
fs.rmSync(target, { recursive: true, force: true })
fs.mkdirSync(target, { recursive: true })
fs.cpSync(path.join(root, 'dist'), target, { recursive: true })
fs.writeFileSync(path.join(target, 'VERSION'), `${JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version}\n`)
console.log(`Web artifact: ${target}`)
