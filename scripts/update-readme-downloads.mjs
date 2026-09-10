import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function updateReadme(readme, release) {
  const assets = release.assets || []
  const required = (pattern) => {
    const asset = assets.find(({ name }) => pattern.test(name))
    if (!asset) throw new Error(`Release ${release.tag_name} is missing ${pattern}`)
    return asset
  }
  const row = (device, asset, label, hint) =>
    `| ${device} | \`${asset.name}\` | [${label}](${asset.browser_download_url}) | ${hint} |`
  const apk = required(/^app-release(?:-unsigned)?\.apk$/)
  const unsigned = apk.name.includes('-unsigned')
  const repoUrl = release.html_url.split('/releases/')[0]
  const block = [
    '## 下载与设备对应',
    '',
    `当前最新可下载版本：**[${release.tag_name}（${release.prerelease ? '预发布版' : '正式版'}）](${release.html_url})**。按设备选择下表中的安装包，无需下载源码。`,
    '',
    '| 设备 | 对应安装包 | 最新版本下载 | 安装提示 |',
    '| --- | --- | --- | --- |',
    row('Windows 64 位电脑（Intel / AMD x64）', required(/^MyHKU[ .]Setup[ .].*\.exe$/), '下载安装版 EXE', '推荐；运行安装向导。'),
    row('Windows 64 位电脑（免安装）', required(/^MyHKU[ .](?!Setup[ .]).*\.exe$/), '下载便携版 EXE', '下载后直接运行。'),
    row('Mac Apple Silicon（M 系列芯片 / arm64）', required(/^MyHKU-.*-arm64\.dmg$/), '下载 DMG', '推荐；打开磁盘映像，将应用拖入 Applications。'),
    row('Mac Apple Silicon（ZIP 备用包）', required(/^MyHKU-.*-arm64-mac\.zip$/), '下载 ZIP', '解压后将应用移入 Applications。'),
    row('Android 8.0 及以上手机 / 平板', apk, unsigned ? '下载 APK（未签名）' : '下载 APK', unsigned ? '当前包未签名，不能直接安装；需签名后安装。' : '下载后打开 APK，按系统提示允许安装此来源的应用。'),
    row('Android 应用商店分发 / 开发者', required(/^app-release\.aab$/), '下载 AAB', '用于商店分发或生成 APK，不能直接点击安装。'),
    '',
    '当前未提供 Intel Mac（x64）、Windows ARM64 原生包或 iPhone / iPad 安装包。Mac 可在「关于本机」查看芯片类型；Windows 可在「设置 → 系统 → 系统信息」查看系统类型。',
    '',
    `本节由 CI/CD 在发布成功后自动更新，包含预发布版，按发布时间选择最新版本。查看[全部版本](${repoUrl}/releases)；[Latest 正式版入口](${repoUrl}/releases/latest)仅包含正式版，没有正式版时不可用。`,
    '',
    `可下载 [SHA256SUMS.txt](${required(/^SHA256SUMS\.txt$/).browser_download_url}) 校验文件完整性；\`.blockmap\`、\`latest.yml\` 和 \`latest-mac.yml\` 是更新元数据，无需手动安装。`,
    '',
  ].join('\n')
  const section = /^## 下载与设备对应\r?\n[\s\S]*?(?=^## |$(?![\s\S]))/m
  if (!section.test(readme)) throw new Error('README download section not found')
  const newline = readme.includes('\r\n') ? '\r\n' : '\n'
  return readme.replace(section, () => (block + '\n').replaceAll('\n', newline))
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY || 'StevenLee147/MyHKU'
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'MyHKU-release-docs' }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const releases = []
  for (let page = 1; ; page++) {
    const response = await fetch(`${process.env.GITHUB_API_URL || 'https://api.github.com'}/repos/${repository}/releases?per_page=100&page=${page}`, { headers })
    if (!response.ok) throw new Error(`GitHub releases API: ${response.status}`)
    const batch = await response.json()
    releases.push(...batch)
    if (batch.length < 100) break
  }
  const release = releases.filter(r => !r.draft && r.published_at && /^v\d/.test(r.tag_name))
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0]
  if (!release) {
    console.log('No published release found; README unchanged.')
    return
  }
  const readme = readFileSync('README.md', 'utf8')
  const updated = updateReadme(readme, release)
  if (updated !== readme) writeFileSync('README.md', updated)
  console.log(`README downloads: ${release.tag_name}; ${updated === readme ? 'unchanged' : 'updated'}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
