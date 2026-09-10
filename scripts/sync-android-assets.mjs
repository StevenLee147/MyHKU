import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'dist')
const target = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'dashboard-app')
fs.rmSync(target, { recursive: true, force: true })
fs.mkdirSync(target, { recursive: true })
fs.cpSync(source, target, { recursive: true })
console.log(`Copied dashboard assets to ${target}`)
