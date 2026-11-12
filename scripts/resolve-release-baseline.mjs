const kind = process.argv[2]
const repo = process.env.GITHUB_REPOSITORY || 'StevenLee147/MyHKU'
const currentTag = process.env.CURRENT_TAG || ''

const matcher = kind === 'windows'
  ? name => /^MyHKU\.Setup\..*\.exe$/i.test(name)
  : kind === 'android'
    ? name => name === 'app-release.apk'
    : null

if (!matcher) {
  console.error('Usage: node scripts/resolve-release-baseline.mjs <windows|android>')
  process.exit(2)
}

const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'MyHKU-CI',
}
if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`

const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=25`, { headers })
if (!response.ok) {
  console.error(`GitHub Releases API failed: HTTP ${response.status}`)
  process.exit(1)
}
const releases = await response.json()
for (const release of releases) {
  if (release.draft || release.tag_name === currentTag) continue
  const asset = (release.assets || []).find(item => matcher(item.name) && item.browser_download_url)
  if (asset) {
    process.stdout.write(asset.browser_download_url)
    process.exit(0)
  }
}

console.error(`No previous ${kind} release baseline asset found in ${repo}`)
process.exit(1)
