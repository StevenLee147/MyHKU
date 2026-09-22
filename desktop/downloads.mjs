import { open, mkdir, unlink } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export function moodleDownloadUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== 'moodle.hku.hk' || url.username || url.password ||
      !/^\/(?:pluginfile\.php\/|mod\/(?:resource|folder)\/(?:view|download_folder)\.php$)/.test(url.pathname)) {
    throw new Error('此链接不是 Moodle 文件资料')
  }
  return url
}

// Runs in an isolated DOM parser. No remote HTML is inserted into the page.
export function fileLinksFromHtml(html, base) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  if (doc.querySelector('input[type="password"]')) return []
  const candidates = [...doc.querySelectorAll('a[href], object[data], embed[src], iframe[src]')]
    .map(node => node.getAttribute('href') || node.getAttribute('data') || node.getAttribute('src'))
    .map(value => { try { return new URL(value, base).href } catch { return '' } })
    .filter(value => {
      try {
        const url = new URL(value)
        return url.protocol === 'https:' && url.hostname === 'moodle.hku.hk' &&
          /^\/(?:pluginfile\.php\/|mod\/folder\/download_folder\.php$)/.test(url.pathname)
      } catch { return false }
    })
  return [...new Set(candidates)]
}

async function fetchMoodleFile(value, fetchPage) {
  let target = moodleDownloadUrl(value)
  let response
  for (let hop = 0; hop < 6; hop++) {
    response = await fetchPage(target.href)
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    const next = response.headers.get('location')
    await response.body?.cancel()
    try { if (!next) throw new Error('missing redirect'); target = moodleDownloadUrl(new URL(next, target).href) }
    catch { throw new Error('Moodle 会话已过期，请在设置中重新连接') }
  }
  if (!response.ok) throw new Error(`资料读取失败（HTTP ${response.status}）`)
  // A redirected login page must never be saved as a document.
  // Electron's custom protocol responses may omit Response.url. Requests use
  // manual redirects, so target remains the verified final request address.
  const finalUrl = response.url || target.href
  try { moodleDownloadUrl(finalUrl) } catch { throw new Error('Moodle 会话已过期，请在设置中重新连接') }
  return { response, finalUrl }
}

export async function resolveMoodleDownloads(value, fetchPage, parseHtml) {
  const url = moodleDownloadUrl(value)
  if (url.pathname.startsWith('/pluginfile.php/') || url.pathname.endsWith('/download_folder.php')) {
    url.searchParams.set('forcedownload', '1')
    return [url.href]
  }
  const { response, finalUrl } = await fetchMoodleFile(url.href, fetchPage)
  const type = response.headers.get('content-type') || ''
  if (!/text\/html|application\/xhtml/i.test(type)) {
    await response.body?.cancel()
    return [moodleDownloadUrl(finalUrl).href]
  }
  const links = await parseHtml(await response.text(), finalUrl)
  const files = links.map(link => moodleDownloadUrl(link)).map(link => {
    link.searchParams.set('forcedownload', '1')
    return link.href
  })
  if (!files.length) throw new Error('未找到可下载文件，请确认 Moodle 登录状态或刷新资料')
  return files
}

export async function saveMoodleDownload(url, directory, fetchPage) {
  const { response, finalUrl } = await fetchMoodleFile(url, fetchPage)
  if (/text\/html|application\/xhtml/i.test(response.headers.get('content-type') || '') || !response.body) {
    await response.body?.cancel()
    throw new Error('服务器未返回文件，请确认 Moodle 登录状态后重试')
  }
  const disposition = response.headers.get('content-disposition') || ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  let filename = disposition.match(/filename="([^"]+)"|filename=([^;]+)/i)?.slice(1).find(Boolean)
  try { filename = encoded ? decodeURIComponent(encoded) : filename || decodeURIComponent(new URL(finalUrl).pathname.split('/').at(-1)) } catch { /* use the plain filename */ }
  filename = (filename || 'download').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 180) || 'download'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) filename = `_${filename}`
  await mkdir(directory, { recursive: true })
  const extension = extname(filename)
  const stem = filename.slice(0, filename.length - extension.length)
  let handle; let path
  for (let index = 0; index < 1000; index++) {
    path = join(directory, index ? `${stem} (${index})${extension}` : filename)
    try { handle = await open(path, 'wx'); break } catch (error) { if (error.code !== 'EEXIST') throw error }
  }
  if (!handle) throw new Error('无法创建下载文件')
  try {
    await pipeline(Readable.fromWeb(response.body), handle.createWriteStream())
  } catch (error) {
    await handle.close().catch(() => {})
    await unlink(path).catch(() => {})
    throw error
  }
  return path
}
