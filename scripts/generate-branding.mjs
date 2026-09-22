import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'

// One original vector produces every platform's icon; no font dependencies.
const root = new URL('../', import.meta.url)
async function write(file, bytes) {
  const url = new URL(file, root)
  await fs.mkdir(path.dirname(fileURLToPath(url)), { recursive: true })
  await fs.writeFile(url, bytes)
}
const svg = await fs.readFile(new URL('public/brand/logo.svg', root))
const png = size => sharp(svg).resize(size, size).png().toBuffer()
await write('build/icon.png', await png(1024))
await write('public/brand/icon-192.png', await png(192))
await write('public/brand/icon-512.png', await png(512))
const sizes = [16, 24, 32, 48, 64, 128, 256]
const frames = await Promise.all(sizes.map(png))
const header = Buffer.alloc(6 + sizes.length * 16)
header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
let offset = header.length
frames.forEach((frame, index) => {
  const position = 6 + index * 16
  header[position] = header[position + 1] = sizes[index] % 256
  header.writeUInt16LE(1, position + 4); header.writeUInt16LE(32, position + 6)
  header.writeUInt32LE(frame.length, position + 8); header.writeUInt32LE(offset, position + 12)
  offset += frame.length
})
await write('build/icon.ico', Buffer.concat([header, ...frames]))
const chunks = []
for (const [type, size] of [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]) {
  const bytes = await png(size)
  const chunk = Buffer.alloc(8); chunk.write(type); chunk.writeUInt32BE(bytes.length + 8, 4)
  chunks.push(chunk, bytes)
}
const icns = Buffer.alloc(8); icns.write('icns'); icns.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4)
await write('build/icon.icns', Buffer.concat([icns, ...chunks]))
for (const size of [16, 32, 48, 128]) await write(`extension/icons/icon-${size}.png`, await png(size))
for (const [density, size] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
  await write(`android/app/src/main/res/mipmap-${density}/ic_launcher.png`, await png(size))
}
const legal = JSON.parse(await fs.readFile(new URL('public/legal/agreements.json', root), 'utf8'))
const text = `MyHKU · 用户协议、隐私说明与免责声明\n协议版本：${legal.version}\n\n` + legal.documents.map(doc => `${doc.title}\n\n${doc.paragraphs.join('\n\n')}`).join('\n\n────────────\n\n')
await write('public/legal/agreements.txt', text + '\n')
// NSIS detects UTF-8 via BOM; DMG consumes the UTF-8 source explicitly.
await write('build/license.txt', '\uFEFF' + text + '\n')
// DMG's localized TEXT resource uses legacy GB2312. ASCII RTF with Unicode
// escapes preserves the complete Chinese agreement and punctuation instead.
let rtf = ''
for (let index = 0; index < text.length; index++) {
  const char = text[index], code = text.charCodeAt(index)
  rtf += char === '\n' ? '\\par\n' : /[\\{}]/.test(char) ? `\\${char}` : code > 127 ? `\\u${code > 32767 ? code - 65536 : code}?` : char
}
await write('build/agreement.rtf', `{\\rtf1\\ansi\\ansicpg1252\\uc1\\deff0{\\fonttbl{\\f0 Helvetica;}}\\f0\\fs24\n${rtf}\n}`)
console.log('Generated Windows, macOS, Android, web and extension branding and installation agreements.')
