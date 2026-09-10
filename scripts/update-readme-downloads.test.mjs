import test from 'node:test'
import assert from 'node:assert/strict'
import { updateReadme } from './update-readme-downloads.mjs'

function release(signed = false) {
  return {
    tag_name: 'v0.2.0', prerelease: false,
    html_url: 'https://github.com/example/app/releases/tag/v0.2.0',
    assets: ['MyHKU.Setup.0.2.0.exe', 'MyHKU.0.2.0.exe', 'MyHKU-0.2.0-arm64.dmg',
      'MyHKU-0.2.0-arm64-mac.zip', signed ? 'app-release.apk' : 'app-release-unsigned.apk',
      'app-release.aab', 'SHA256SUMS.txt'].map(name => ({ name,
      browser_download_url: `https://github.com/example/app/releases/download/v0.2.0/${name}` })),
  }
}

test('updates only downloads, preserves CRLF and is idempotent', () => {
  const source = '# App\r\n\r\n## 下载与设备对应\r\nold\r\n\r\n## 运行\r\nkeep this\r\n'
  const updated = updateReadme(source, release())
  assert.ok(updated.startsWith('# App\r\n\r\n'))
  assert.ok(updated.endsWith('## 运行\r\nkeep this\r\n'))
  assert.match(updated, /v0\.2\.0（正式版）/)
  assert.match(updated, /不能直接安装/)
  assert.equal(updateReadme(updated, release()), updated)
  assert.equal(updated.replaceAll('\r\n', '').includes('\n'), false)
})

test('signed APK updates installation instructions and prerelease label', () => {
  const data = { ...release(true), prerelease: true }
  const result = updateReadme('## 下载与设备对应\nold\n', data)
  assert.match(result, /预发布版/)
  assert.match(result, /下载后打开 APK/)
  assert.doesNotMatch(result, /未签名/)
})

test('missing release assets or section fail instead of publishing broken links', () => {
  assert.throws(() => updateReadme('## 下载与设备对应\n', { ...release(), assets: [] }), /missing/)
  assert.throws(() => updateReadme('# unrelated\n', release()), /section not found/)
})
