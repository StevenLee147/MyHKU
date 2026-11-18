export type Locale = 'zh' | 'en'

export const LOCALE_STORAGE_KEY = 'myhku-locale'

export function getLocale(): Locale {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (raw === 'en' || raw === 'zh') return raw
  } catch {
    /* ignore */
  }
  return 'zh'
}

export function applyDocumentLocale(locale: Locale): void {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN'
  }
}

export function setLocale(locale: Locale): Locale {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    /* ignore */
  }
  applyDocumentLocale(locale)
  return locale
}

export function tr(locale: Locale, zh: string, en: string): string {
  return locale === 'en' ? en : zh
}

export function localizedGreeting(locale: Locale, now = new Date()): string {
  const hourStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now)
  const hour = Number(hourStr)
  if (locale === 'en') {
    if (hour < 12) return 'Good morning'
    if (hour < 18) return 'Good afternoon'
    return 'Good evening'
  }
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

export const NAV_LABELS: Record<Locale, Record<'overview' | 'calendar' | 'moodle' | 'materials' | 'settings', string>> = {
  zh: {
    overview: '概览',
    calendar: '我的课表',
    moodle: 'Moodle',
    materials: '课程资料',
    settings: '设置',
  },
  en: {
    overview: 'Overview',
    calendar: 'Timetable',
    moodle: 'Moodle & GPA',
    materials: 'Materials',
    settings: 'Settings',
  },
}
