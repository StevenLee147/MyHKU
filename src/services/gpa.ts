export type HkuGradeLetter = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'F' | 'P'

export const HKU_GRADE_LETTERS: HkuGradeLetter[] = [
  'A+', 'A', 'A-',
  'B+', 'B', 'B-',
  'C+', 'C', 'C-',
  'D+', 'D', 'F', 'P',
]

export const HKU_GRADE_POINTS: Record<HkuGradeLetter, number | null> = {
  'A+': 4.3,
  'A': 4.0,
  'A-': 3.7,
  'B+': 3.3,
  'B': 3.0,
  'B-': 2.7,
  'C+': 2.3,
  'C': 2.0,
  'C-': 1.7,
  'D+': 1.3,
  'D': 1.0,
  'F': 0.0,
  'P': null,
}

export const HKU_DEFAULT_CUTOFFS: Record<Exclude<HkuGradeLetter, 'F' | 'P'>, number> = {
  'A+': 90,
  'A': 85,
  'A-': 80,
  'B+': 75,
  'B': 70,
  'B-': 65,
  'C+': 60,
  'C': 55,
  'C-': 50,
  'D+': 45,
  'D': 40,
}

export const GPA_CONFIG_KEY = 'myhku-gpa-config'

export type SemesterSimRow = {
  courseId: string
  title: string
  credits: number
  grade: HkuGradeLetter
}

export type GpaStoredConfig = {
  priorCgpa?: string
  priorCredits?: string
  rows: Record<string, { credits: number; grade: HkuGradeLetter }>
  courseWeights: Record<string, Record<string, number>>
  targetGrades: Record<string, Exclude<HkuGradeLetter, 'F' | 'P'>>
}

export function parseNumericPercentage(rawValue?: string): number | null {
  if (!rawValue) return null
  const clean = rawValue.trim()
  if (!clean) return null
  const pct = clean.match(/^(\d+(?:\.\d+)?)\s*%$/)
  if (pct) {
    const v = Number(pct[1])
    return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null
  }
  const ratio = clean.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/)
  if (ratio) {
    const num = Number(ratio[1])
    const den = Number(ratio[2])
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
      return Math.max(0, Math.min(100, (num / den) * 100))
    }
  }
  const upper = clean.toUpperCase() as HkuGradeLetter
  if (upper in HKU_DEFAULT_CUTOFFS) {
    return HKU_DEFAULT_CUTOFFS[upper as Exclude<HkuGradeLetter, 'F' | 'P'>]
  }
  if (/^\d+(?:\.\d+)?$/.test(clean)) {
    const v = Number(clean)
    if (Number.isFinite(v) && v >= 0 && v <= 100) return v
  }
  return null
}

export type WhatIfComponent = {
  id: string
  title: string
  scorePct: number | null
  weightPct: number
}

export type WhatIfSummary = {
  completedWeight: number
  remainingWeight: number
  bankedPoints: number
  currentAveragePct: number | null
  targetCutoff: number
  requiredOnRemainingPct: number | null
  achievable: boolean
}

export function computeCourseWhatIf(
  components: Array<{ scorePct: number | null; weightPct: number }>,
  targetGrade: Exclude<HkuGradeLetter, 'F' | 'P'> = 'A',
): WhatIfSummary {
  const targetCutoff = HKU_DEFAULT_CUTOFFS[targetGrade] ?? 85
  let completedWeight = 0
  let bankedPoints = 0
  let totalConfiguredWeight = 0

  for (const item of components) {
    const w = Number.isFinite(item.weightPct) && item.weightPct > 0 ? item.weightPct : 0
    totalConfiguredWeight += w
    if (w > 0 && item.scorePct !== null && Number.isFinite(item.scorePct)) {
      completedWeight += w
      bankedPoints += (item.scorePct * w) / 100
    }
  }

  const remainingWeight = Math.max(0, 100 - completedWeight)
  const currentAveragePct = completedWeight > 0 ? (bankedPoints / completedWeight) * 100 : null

  if (remainingWeight <= 0) {
    return {
      completedWeight: round2(completedWeight),
      remainingWeight: 0,
      bankedPoints: round2(bankedPoints),
      currentAveragePct: currentAveragePct !== null ? round2(currentAveragePct) : null,
      targetCutoff,
      requiredOnRemainingPct: null,
      achievable: bankedPoints >= targetCutoff && totalConfiguredWeight > 0,
    }
  }

  const needed = ((targetCutoff - bankedPoints) / remainingWeight) * 100
  return {
    completedWeight: round2(completedWeight),
    remainingWeight: round2(remainingWeight),
    bankedPoints: round2(bankedPoints),
    currentAveragePct: currentAveragePct !== null ? round2(currentAveragePct) : null,
    targetCutoff,
    requiredOnRemainingPct: round2(Math.max(0, needed)),
    achievable: needed <= 100,
  }
}

export function computeSemesterAndCgpa(
  courses: Array<{ credits: number; grade: HkuGradeLetter }>,
  priorCgpa?: number | null,
  priorCredits?: number | null,
): {
  semesterCredits: number
  semesterGpa: number | null
  totalCredits: number
  projectedCgpa: number | null
} {
  let semCredits = 0
  let semQuality = 0
  for (const row of courses) {
    const gp = HKU_GRADE_POINTS[row.grade]
    const cr = Number.isFinite(row.credits) && row.credits > 0 ? row.credits : 0
    if (gp === null || gp === undefined || cr <= 0) continue
    semCredits += cr
    semQuality += gp * cr
  }
  const semesterGpa = semCredits > 0 ? round2(semQuality / semCredits) : null
  const pCr = priorCredits && Number.isFinite(priorCredits) && priorCredits > 0 ? priorCredits : 0
  const pGpa = priorCgpa !== null && priorCgpa !== undefined && Number.isFinite(priorCgpa) && priorCgpa >= 0 && priorCgpa <= 4.3 ? priorCgpa : null

  if (pCr > 0 && pGpa !== null) {
    const totalCredits = pCr + semCredits
    const projectedCgpa = totalCredits > 0 ? round2((pGpa * pCr + semQuality) / totalCredits) : null
    return { semesterCredits: semCredits, semesterGpa, totalCredits, projectedCgpa }
  }
  return {
    semesterCredits: semCredits,
    semesterGpa,
    totalCredits: semCredits,
    projectedCgpa: semesterGpa,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function getGpaConfig(): GpaStoredConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(GPA_CONFIG_KEY) || 'null')
    if (!raw || typeof raw !== 'object') {
      return { rows: {}, courseWeights: {}, targetGrades: {} }
    }
    return {
      priorCgpa: typeof raw.priorCgpa === 'string' ? raw.priorCgpa : '',
      priorCredits: typeof raw.priorCredits === 'string' ? raw.priorCredits : '',
      rows: raw.rows && typeof raw.rows === 'object' ? raw.rows : {},
      courseWeights: raw.courseWeights && typeof raw.courseWeights === 'object' ? raw.courseWeights : {},
      targetGrades: raw.targetGrades && typeof raw.targetGrades === 'object' ? raw.targetGrades : {},
    }
  } catch {
    return { rows: {}, courseWeights: {}, targetGrades: {} }
  }
}

export function saveGpaConfig(config: GpaStoredConfig): GpaStoredConfig {
  try {
    localStorage.setItem(GPA_CONFIG_KEY, JSON.stringify(config))
  } catch {
    /* ignore */
  }
  return config
}
