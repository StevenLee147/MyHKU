import type { CustomTask, CustomTaskCategory } from './customTasks'
import type { GpaStoredConfig, HkuGradeLetter } from './gpa'
import type { ThemeMode } from './hku'
import type { Locale } from './i18n'
import type { MoodleCoursePrefs } from './moodleCourses'

export type RuntimePlatform = 'windows' | 'macos' | 'android' | 'web'

export type ReleaseAssetItem = {
  name: string
  downloadUrl: string
  size?: number
}

export type UpdateCheckResult = {
  currentVersion: string
  latestVersion: string
  latestTag: string
  hasUpdate: boolean
  prerelease: boolean
  publishedAt?: string
  htmlUrl: string
  summary: string
  recommendedAsset: ReleaseAssetItem | null
  checksumAsset: ReleaseAssetItem | null
}

export type LearningBackupPayload = {
  schema: 'myhku-learning-backup-v1'
  exportedAt: string
  appVersion: string
  customTasks: CustomTask[]
  gpaConfig: GpaStoredConfig
  pinnedResources: string[]
  moodleCoursePrefs?: MoodleCoursePrefs
  storageOrganizeMode?: 'bglis' | 'course' | 'flat'
  themeMode?: ThemeMode
  locale?: Locale
}

export type RestoreBackupResult = {
  taskCount: number
  gpaCourseCount: number
  pinnedCount: number
  moodleCoursePrefs?: MoodleCoursePrefs
  themeMode?: ThemeMode
  locale?: Locale
}

const RELEASES_API_URL = 'https://api.github.com/repos/StevenLee147/MyHKU/releases?per_page=10'
const RELEASES_WEB_URL = 'https://github.com/StevenLee147/MyHKU/releases'

const CUSTOM_TASKS_KEY = 'myhku-custom-tasks'
const GPA_CONFIG_KEY = 'myhku-gpa-config'
const PINNED_RESOURCES_KEY = 'myhku-pinned-resources'
const MOODLE_COURSE_PREFS_KEY = 'myhku-moodle-course-prefs'
const THEME_KEY = 'myhku-theme-mode'
const LOCALE_KEY = 'myhku-locale'

function sanitizeMoodleCoursePrefs(raw: unknown): MoodleCoursePrefs {
  const cleanIds = (v: unknown) =>
    Array.isArray(v) ? [...new Set(v.map(x => String(x || '').trim().slice(0, 120)).filter(Boolean))].slice(0, 300) : []
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const hiddenCourseIds = cleanIds(obj.hiddenCourseIds)
  const hiddenSet = new Set(hiddenCourseIds)
  return {
    hiddenCourseIds,
    shownCourseIds: cleanIds(obj.shownCourseIds).filter(id => !hiddenSet.has(id)),
    pinnedCourseIds: cleanIds(obj.pinnedCourseIds),
    autoHideSubclasses: Boolean(obj.autoHideSubclasses),
    autoHideNonAcademic: Boolean(obj.autoHideNonAcademic),
  }
}

function getMoodleCoursePrefs(): MoodleCoursePrefs {
  if (typeof localStorage === 'undefined') return sanitizeMoodleCoursePrefs({})
  try {
    const raw = localStorage.getItem(MOODLE_COURSE_PREFS_KEY)
    return raw ? sanitizeMoodleCoursePrefs(JSON.parse(raw)) : sanitizeMoodleCoursePrefs({})
  } catch {
    return sanitizeMoodleCoursePrefs({})
  }
}

function saveMoodleCoursePrefs(next: MoodleCoursePrefs): MoodleCoursePrefs {
  const cleaned = sanitizeMoodleCoursePrefs(next)
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(MOODLE_COURSE_PREFS_KEY, JSON.stringify(cleaned))
  }
  return cleaned
}

const VALID_GRADES = new Set<string>(['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F', 'P'])
const VALID_TARGET_GRADES = new Set<string>(['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D'])

export function getCurrentAppVersion(): string {
  if (typeof __MYHKU_APP_VERSION__ === 'string' && __MYHKU_APP_VERSION__.trim()) {
    return __MYHKU_APP_VERSION__.trim().replace(/^v/i, '')
  }
  return '0.4.3-beta'
}

type ParsedSemver = {
  major: number
  minor: number
  patch: number
  prerelease: string[] | null
}

export function parseSemver(raw: string): ParsedSemver | null {
  const cleaned = String(raw || '').trim().replace(/^v/i, '')
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : null,
  }
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa && !pb) return 0
  if (!pa) return -1
  if (!pb) return 1
  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1
  if (!pa.prerelease && !pb.prerelease) return 0
  if (!pa.prerelease && pb.prerelease) return 1
  if (pa.prerelease && !pb.prerelease) return -1
  const len = Math.max(pa.prerelease!.length, pb.prerelease!.length)
  for (let i = 0; i < len; i += 1) {
    const ia = pa.prerelease![i]
    const ib = pb.prerelease![i]
    if (ia === undefined) return -1
    if (ib === undefined) return 1
    if (ia === ib) continue
    const na = /^\d+$/.test(ia) ? Number(ia) : null
    const nb = /^\d+$/.test(ib) ? Number(ib) : null
    if (na !== null && nb !== null) return na > nb ? 1 : -1
    if (na !== null) return -1
    if (nb !== null) return 1
    return ia.localeCompare(ib) > 0 ? 1 : -1
  }
  return 0
}

export function safeGithubReleaseUrl(raw?: string): string | null {
  if (!raw || typeof raw !== 'string') return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' || u.username || u.password) return null
    const host = u.hostname.toLowerCase()
    if (host === 'github.com' && u.pathname.startsWith('/StevenLee147/MyHKU/')) {
      return u.toString()
    }
    if (host === 'objects.githubusercontent.com' || host === 'release-assets.githubusercontent.com') {
      return u.toString()
    }
    return null
  } catch {
    return null
  }
}

export function detectRuntimePlatform(platformOverride?: string, uaOverride?: string): RuntimePlatform {
  const winObj = typeof window !== 'undefined' ? window : undefined
  if (!platformOverride && winObj?.myhkuAndroid) return 'android'
  const plat = (platformOverride ?? winObj?.myhkuDesktop?.platform ?? (typeof navigator !== 'undefined' ? navigator.platform : '') ?? '').toLowerCase()
  const ua = (uaOverride ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '') ?? '').toLowerCase()
  if (ua.includes('android')) return 'android'
  if (plat === 'win32' || plat.includes('win') || ua.includes('windows')) return 'windows'
  if (plat === 'darwin' || plat.includes('mac') || ua.includes('macintosh')) return 'macos'
  return 'web'
}

export function selectPlatformReleaseAsset(
  assets: ReleaseAssetItem[],
  platform: RuntimePlatform,
): { recommended: ReleaseAssetItem | null; checksum: ReleaseAssetItem | null } {
  const valid = assets.filter(a => Boolean(safeGithubReleaseUrl(a.downloadUrl)))
  const checksum = valid.find(a => a.name === 'SHA256SUMS.txt') || null
  let recommended: ReleaseAssetItem | null = null
  if (platform === 'windows') {
    recommended =
      valid.find(a => /^MyHKU[ .]Setup[ .].*\.exe$/i.test(a.name)) ||
      valid.find(a => /^MyHKU.*\.exe$/i.test(a.name)) ||
      null
  } else if (platform === 'macos') {
    recommended =
      valid.find(a => /^MyHKU-.*-arm64\.dmg$/i.test(a.name)) ||
      valid.find(a => /^MyHKU-.*-arm64-mac\.zip$/i.test(a.name)) ||
      null
  } else if (platform === 'android') {
    recommended = valid.find(a => a.name === 'app-release.apk') || null
  }
  return { recommended, checksum }
}

function summarizeReleaseBody(rawBody?: string): string {
  if (!rawBody) return ''
  const lines = rawBody
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.startsWith('- '))
    .slice(0, 4)
    .map(l => l.replace(/^-\s+/, '').replace(/\*\*/g, '').replace(/`/g, ''))
  if (lines.length > 0) return lines.join(' · ').slice(0, 320)
  return rawBody.replace(/[#*`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 240)
}

export async function checkGithubReleaseUpdate(options?: {
  currentVersion?: string
  platform?: RuntimePlatform
  fetchFn?: typeof fetch
}): Promise<UpdateCheckResult> {
  const currentVersion = (options?.currentVersion || getCurrentAppVersion()).replace(/^v/i, '')
  const platform = options?.platform || detectRuntimePlatform()
  const fetcher = options?.fetchFn || fetch
  const response = await fetcher(RELEASES_API_URL, {
    method: 'GET',
    headers: { Accept: 'application/vnd.github+json' },
    credentials: 'omit',
  })
  if (!response.ok) {
    throw new Error(`GitHub Releases HTTP ${response.status}`)
  }
  const rawList = (await response.json()) as unknown
  if (!Array.isArray(rawList)) {
    throw new Error('Invalid GitHub Releases response')
  }

  const candidates = rawList
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .filter(item => item.draft !== true && typeof item.tag_name === 'string' && parseSemver(item.tag_name) !== null)
    .sort((a, b) => {
      const cmp = compareSemver(String(b.tag_name), String(a.tag_name))
      if (cmp !== 0) return cmp
      return Date.parse(String(b.published_at || '')) - Date.parse(String(a.published_at || ''))
    })

  if (!candidates.length) {
    return {
      currentVersion,
      latestVersion: currentVersion,
      latestTag: `v${currentVersion}`,
      hasUpdate: false,
      prerelease: currentVersion.includes('-'),
      htmlUrl: RELEASES_WEB_URL,
      summary: '',
      recommendedAsset: null,
      checksumAsset: null,
    }
  }

  const top = candidates[0]
  const latestTag = String(top.tag_name)
  const latestVersion = latestTag.replace(/^v/i, '')
  const htmlUrl = safeGithubReleaseUrl(typeof top.html_url === 'string' ? top.html_url : '') || RELEASES_WEB_URL
  const rawAssets = Array.isArray(top.assets) ? top.assets : []
  const normalizedAssets: ReleaseAssetItem[] = rawAssets
    .filter((a): a is Record<string, unknown> => Boolean(a && typeof a === 'object'))
    .map(a => {
      const name = typeof a.name === 'string' ? a.name.trim() : ''
      const downloadUrl = safeGithubReleaseUrl(typeof a.browser_download_url === 'string' ? a.browser_download_url : '') || ''
      const size = typeof a.size === 'number' && Number.isFinite(a.size) ? a.size : undefined
      return name && downloadUrl ? { name, downloadUrl, ...(size !== undefined ? { size } : {}) } : null
    })
    .filter((a): a is ReleaseAssetItem => a !== null)

  const { recommended, checksum } = selectPlatformReleaseAsset(normalizedAssets, platform)
  const hasUpdate = compareSemver(latestVersion, currentVersion) > 0

  return {
    currentVersion,
    latestVersion,
    latestTag,
    hasUpdate,
    prerelease: Boolean(top.prerelease) || latestVersion.includes('-'),
    ...(typeof top.published_at === 'string' ? { publishedAt: top.published_at } : {}),
    htmlUrl,
    summary: summarizeReleaseBody(typeof top.body === 'string' ? top.body : ''),
    recommendedAsset: recommended,
    checksumAsset: checksum,
  }
}

function containsForbiddenSecretKeys(value: unknown): boolean {
  const forbidden = /^(?:password|passwd|cookie|set-cookie|authorization|access[_-]?token|refresh[_-]?token|client[_-]?secret|email)$/i
  const walk = (node: unknown): boolean => {
    if (!node || typeof node !== 'object') return false
    if (Array.isArray(node)) return node.some(walk)
    return Object.entries(node as Record<string, unknown>).some(([k, v]) => forbidden.test(k) || walk(v))
  }
  return walk(value)
}

function sanitizeCustomTasksArray(raw: unknown): CustomTask[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item, idx): CustomTask | null => {
      const title = typeof item.title === 'string' ? item.title.trim().slice(0, 160) : ''
      const due = typeof item.due === 'string' ? item.due.trim().slice(0, 60) : ''
      if (!title || !due) return null
      const catRaw = item.category
      const category: CustomTaskCategory =
        catRaw === 'assignment' || catRaw === 'quiz' || catRaw === 'exam' || catRaw === 'project' ? catRaw : 'assignment'
      const course = typeof item.course === 'string' && item.course.trim() ? item.course.trim().slice(0, 120) : '个人自建'
      const note = typeof item.note === 'string' && item.note.trim() ? item.note.trim().slice(0, 240) : undefined
      return {
        id: typeof item.id === 'string' && item.id.trim() ? item.id.trim().slice(0, 120) : `custom-restored-${idx}-${Date.now()}`,
        title,
        course,
        category,
        due,
        ...(note ? { note } : {}),
        completed: Boolean(item.completed),
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      }
    })
    .filter((x): x is CustomTask => x !== null)
    .slice(0, 500)
}

function sanitizeGpaConfigObject(raw: unknown): GpaStoredConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { rows: {}, courseWeights: {}, targetGrades: {} }
  }
  const obj = raw as Record<string, unknown>
  const rows: GpaStoredConfig['rows'] = {}
  if (obj.rows && typeof obj.rows === 'object' && !Array.isArray(obj.rows)) {
    for (const [courseId, val] of Object.entries(obj.rows as Record<string, unknown>)) {
      if (!val || typeof val !== 'object') continue
      const entry = val as Record<string, unknown>
      const credits = Number(entry.credits)
      const grade = typeof entry.grade === 'string' ? entry.grade.toUpperCase() : ''
      if (Number.isFinite(credits) && credits >= 0 && credits <= 30 && VALID_GRADES.has(grade)) {
        rows[courseId.slice(0, 120)] = { credits, grade: grade as HkuGradeLetter }
      }
    }
  }
  const courseWeights: GpaStoredConfig['courseWeights'] = {}
  if (obj.courseWeights && typeof obj.courseWeights === 'object' && !Array.isArray(obj.courseWeights)) {
    for (const [courseId, wMap] of Object.entries(obj.courseWeights as Record<string, unknown>)) {
      if (!wMap || typeof wMap !== 'object' || Array.isArray(wMap)) continue
      const cleanWeights: Record<string, number> = {}
      for (const [itemId, wVal] of Object.entries(wMap as Record<string, unknown>)) {
        const num = Number(wVal)
        if (Number.isFinite(num) && num >= 0 && num <= 100) cleanWeights[itemId.slice(0, 120)] = num
      }
      courseWeights[courseId.slice(0, 120)] = cleanWeights
    }
  }
  const targetGrades: GpaStoredConfig['targetGrades'] = {}
  if (obj.targetGrades && typeof obj.targetGrades === 'object' && !Array.isArray(obj.targetGrades)) {
    for (const [courseId, letter] of Object.entries(obj.targetGrades as Record<string, unknown>)) {
      if (typeof letter === 'string' && VALID_TARGET_GRADES.has(letter.toUpperCase())) {
        targetGrades[courseId.slice(0, 120)] = letter.toUpperCase() as Exclude<HkuGradeLetter, 'F' | 'P'>
      }
    }
  }
  return {
    priorCgpa: typeof obj.priorCgpa === 'string' ? obj.priorCgpa.slice(0, 16) : '',
    priorCredits: typeof obj.priorCredits === 'string' ? obj.priorCredits.slice(0, 16) : '',
    rows,
    courseWeights,
    targetGrades,
  }
}

export function buildLocalLearningBackup(currentVersion = getCurrentAppVersion()): LearningBackupPayload {
  let customTasks: CustomTask[] = []
  let gpaConfig: GpaStoredConfig = { rows: {}, courseWeights: {}, targetGrades: {} }
  let pinnedResources: string[] = []
  let themeMode: ThemeMode | undefined
  let locale: Locale | undefined

  try {
    customTasks = sanitizeCustomTasksArray(JSON.parse(localStorage.getItem(CUSTOM_TASKS_KEY) || '[]'))
  } catch { /* ignore */ }
  try {
    gpaConfig = sanitizeGpaConfigObject(JSON.parse(localStorage.getItem(GPA_CONFIG_KEY) || 'null'))
  } catch { /* ignore */ }
  try {
    const rawPinned = JSON.parse(localStorage.getItem(PINNED_RESOURCES_KEY) || '[]')
    if (Array.isArray(rawPinned)) {
      pinnedResources = rawPinned.filter((x): x is string => typeof x === 'string').slice(0, 1000)
    }
  } catch { /* ignore */ }
  try {
    const t = localStorage.getItem(THEME_KEY)
    if (t === 'light' || t === 'dark' || t === 'system') themeMode = t
    const l = localStorage.getItem(LOCALE_KEY)
    if (l === 'zh' || l === 'en') locale = l
  } catch { /* ignore */ }

  const moodleCoursePrefs = getMoodleCoursePrefs()

  return {
    schema: 'myhku-learning-backup-v1',
    exportedAt: new Date().toISOString(),
    appVersion: currentVersion,
    customTasks,
    gpaConfig,
    pinnedResources,
    moodleCoursePrefs,
    ...(themeMode ? { themeMode } : {}),
    ...(locale ? { locale } : {}),
  }
}

export function serializeLearningBackup(currentVersion = getCurrentAppVersion()): string {
  return JSON.stringify(buildLocalLearningBackup(currentVersion), null, 2) + '\n'
}

export function downloadLearningBackupJson(jsonText: string, filename = 'myhku-learning-backup.json'): void {
  const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function restoreLocalLearningBackup(
  rawJson: string,
  options?: { mode?: 'merge' | 'replace' },
): RestoreBackupResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch {
    throw new Error('备份文件不是有效的 JSON 格式')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('备份文件内容格式无效')
  }
  if (containsForbiddenSecretKeys(parsed)) {
    throw new Error('备份文件包含不允许的凭据或隐私字段，已拒绝导入')
  }
  const obj = parsed as Record<string, unknown>
  if (obj.schema !== 'myhku-learning-backup-v1') {
    throw new Error('不支持的备份版本（需要 myhku-learning-backup-v1）')
  }

  const mode = options?.mode || 'merge'
  const incomingTasks = sanitizeCustomTasksArray(obj.customTasks)
  const incomingGpa = sanitizeGpaConfigObject(obj.gpaConfig)
  const incomingPinned = Array.isArray(obj.pinnedResources)
    ? obj.pinnedResources.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(0, 1000)
    : []

  let finalTasks = incomingTasks
  if (mode === 'merge') {
    let existingTasks: CustomTask[] = []
    try {
      existingTasks = sanitizeCustomTasksArray(JSON.parse(localStorage.getItem(CUSTOM_TASKS_KEY) || '[]'))
    } catch { /* ignore */ }
    const byId = new Map<string, CustomTask>(existingTasks.map(t => [t.id, t]))
    for (const item of incomingTasks) byId.set(item.id, item)
    finalTasks = [...byId.values()].slice(0, 500)
  }

  let finalGpa = incomingGpa
  if (mode === 'merge') {
    let existingGpa: GpaStoredConfig = { rows: {}, courseWeights: {}, targetGrades: {} }
    try {
      existingGpa = sanitizeGpaConfigObject(JSON.parse(localStorage.getItem(GPA_CONFIG_KEY) || 'null'))
    } catch { /* ignore */ }
    finalGpa = {
      priorCgpa: incomingGpa.priorCgpa || existingGpa.priorCgpa || '',
      priorCredits: incomingGpa.priorCredits || existingGpa.priorCredits || '',
      rows: { ...existingGpa.rows, ...incomingGpa.rows },
      courseWeights: { ...existingGpa.courseWeights, ...incomingGpa.courseWeights },
      targetGrades: { ...existingGpa.targetGrades, ...incomingGpa.targetGrades },
    }
  }

  let finalPinned = incomingPinned
  if (mode === 'merge') {
    let existingPinned: string[] = []
    try {
      const raw = JSON.parse(localStorage.getItem(PINNED_RESOURCES_KEY) || '[]')
      if (Array.isArray(raw)) existingPinned = raw.filter((x): x is string => typeof x === 'string')
    } catch { /* ignore */ }
    finalPinned = [...new Set([...existingPinned, ...incomingPinned])].slice(0, 1000)
  }

  localStorage.setItem(CUSTOM_TASKS_KEY, JSON.stringify(finalTasks))
  localStorage.setItem(GPA_CONFIG_KEY, JSON.stringify(finalGpa))
  localStorage.setItem(PINNED_RESOURCES_KEY, JSON.stringify(finalPinned))

  let restoredCoursePrefs: MoodleCoursePrefs | undefined
  if (obj.moodleCoursePrefs && typeof obj.moodleCoursePrefs === 'object') {
    const incomingPrefs = sanitizeMoodleCoursePrefs(obj.moodleCoursePrefs)
    if (mode === 'merge') {
      const currentPrefs = getMoodleCoursePrefs()
      restoredCoursePrefs = saveMoodleCoursePrefs({
        hiddenCourseIds: [...new Set([...currentPrefs.hiddenCourseIds, ...incomingPrefs.hiddenCourseIds])],
        shownCourseIds: [...new Set([...currentPrefs.shownCourseIds, ...incomingPrefs.shownCourseIds])],
        pinnedCourseIds: [...new Set([...currentPrefs.pinnedCourseIds, ...incomingPrefs.pinnedCourseIds])],
        autoHideSubclasses: incomingPrefs.autoHideSubclasses || currentPrefs.autoHideSubclasses,
        autoHideNonAcademic: incomingPrefs.autoHideNonAcademic || currentPrefs.autoHideNonAcademic,
      })
    } else {
      restoredCoursePrefs = saveMoodleCoursePrefs(incomingPrefs)
    }
  }

  const themeMode: ThemeMode | undefined =
    obj.themeMode === 'light' || obj.themeMode === 'dark' || obj.themeMode === 'system' ? obj.themeMode : undefined
  const locale: Locale | undefined = obj.locale === 'zh' || obj.locale === 'en' ? obj.locale : undefined
  if (themeMode) localStorage.setItem(THEME_KEY, themeMode)
  if (locale) localStorage.setItem(LOCALE_KEY, locale)

  return {
    taskCount: finalTasks.length,
    gpaCourseCount: Object.keys(finalGpa.rows).length,
    pinnedCount: finalPinned.length,
    ...(restoredCoursePrefs ? { moodleCoursePrefs: restoredCoursePrefs } : {}),
    ...(themeMode ? { themeMode } : {}),
    ...(locale ? { locale } : {}),
  }
}
