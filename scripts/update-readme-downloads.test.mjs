import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { updateReadme, updateReleaseBody } from './update-readme-downloads.mjs'

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

function withApks(...names) {
  const data = release()
  data.assets = data.assets.filter(asset => !asset.name.endsWith('.apk'))
  data.assets.push(...names.map(name => ({ name,
    browser_download_url: `https://github.com/example/app/releases/download/v0.2.0/${name}` })))
  return data
}

test('prefers signed release APK over debug and unsigned APK regardless of asset order', () => {
  const result = updateReadme('## 下载与设备对应\nold\n',
    withApks('app-release-unsigned.apk', 'app-debug.apk', 'app-release.apk'))
  assert.match(result, /`app-release\.apk`/)
  assert.doesNotMatch(result, /`app-debug\.apk`|`app-release-unsigned\.apk`/)
  assert.match(result, /下载后打开 APK/)
})

test('offers installable debug APK when no signed release APK is available', () => {
  const result = updateReadme('## 下载与设备对应\nold\n',
    withApks('app-release-unsigned.apk', 'app-debug.apk'))
  assert.match(result, /`app-debug\.apk`/)
  assert.match(result, /下载测试 APK（可安装）/)
  assert.match(result, /使用调试签名/)
  assert.doesNotMatch(result, /`app-release-unsigned\.apk`/)
})

test('release updates preserve the permanent installation guide and its commands', () => {
  const guide = '## 各设备安装指南\n\n### Windows\n更多信息 → 仍要运行\n\n### macOS\n```bash\nxattr -dr com.apple.quarantine /Applications/MyHKU.app\n```\n\n## 运行\nnpm run dev\n'
  const source = `# App\n\n## 下载与设备对应\nold\n\n${guide}`
  const updated = updateReadme(source, withApks('app-debug.apk'))
  assert.ok(updated.endsWith(guide))
  assert.match(updated, /\[各设备安装指南\]\(#各设备安装指南\)/)
  assert.equal(updateReadme(updated, withApks('app-debug.apk')), updated)
})

test('missing release assets or section fail instead of publishing broken links', () => {
  assert.throws(() => updateReadme('## 下载与设备对应\n', { ...release(), assets: [] }), /missing/)
  assert.throws(() => updateReadme('# unrelated\n', release()), /section not found/)
})

test('release guide points to the living README instead of the previous-version tag snapshot', () => {
  const data = { ...release(), body: '安装指南 [README](https://github.com/example/app/blob/v0.2.0/README.md#各设备安装指南)。\n\nKeep these release notes.\n' }
  const updated = updateReleaseBody(data, 'develop')
  assert.equal(updated, '安装指南 [README](https://github.com/example/app/blob/develop/README.md#各设备安装指南)。\n\nKeep these release notes.\n')
  assert.equal(updateReleaseBody({ ...data, body: updated }, 'develop'), updated)
})

test('release guide repair preserves unrelated links, notes, and empty bodies', () => {
  const body = '[asset](https://github.com/example/app/releases/download/v0.2.0/app-release.apk)\n[source](https://github.com/example/app/blob/v0.2.0/package.json)\n[other](https://github.com/other/app/blob/v0.2.0/README.md)'
  assert.equal(updateReleaseBody({ ...release(), body }, 'main'), body)
  assert.equal(updateReleaseBody(release(), 'main'), '')
  assert.throws(() => updateReleaseBody(release(), ''), /Default branch/)
})

test('CLI updates the README and release guide; API write failures fail the job', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'myhku-readme-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const data = { ...release(), id: 42, published_at: '2026-09-10T12:00:00Z',
    body: '[Guide](https://github.com/example/app/blob/v0.2.0/README.md#各设备安装指南)' }
  const writes = []
  let rejectWrite = false
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.method === 'GET' && request.url === '/repos/example/app/releases?per_page=100&page=1') {
      response.end(JSON.stringify([data]))
    } else if (request.method === 'PATCH' && request.url === '/repos/example/app/releases/42') {
      let body = ''
      for await (const chunk of request) body += chunk
      writes.push(JSON.parse(body))
      response.statusCode = rejectWrite ? 403 : 200
      response.end('{}')
    } else {
      response.statusCode = 404
      response.end('{}')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const options = { cwd: directory, env: { ...process.env,
    GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
    GITHUB_REPOSITORY: 'example/app', GITHUB_TOKEN: 'test-token', DEFAULT_BRANCH: 'main' } }
  const script = fileURLToPath(new URL('./update-readme-downloads.mjs', import.meta.url))
  const run = () => promisify(execFile)(process.execPath, [script, '--sync-release-notes'], options)
  writeFileSync(join(directory, 'README.md'), '## 下载与设备对应\nold\n\n## Guide\nKeep me.\n')
  await run()
  assert.match(readFileSync(join(directory, 'README.md'), 'utf8'), /releases\/download\/v0\.2\.0\//)
  assert.deepEqual(writes, [{ body: '[Guide](https://github.com/example/app/blob/main/README.md#各设备安装指南)' }])
  rejectWrite = true
  await assert.rejects(run(), error => error.code === 1 && /Update release notes v0.2.0: 403/.test(error.stderr))
})
