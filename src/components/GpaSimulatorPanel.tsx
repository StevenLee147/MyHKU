import { useMemo, useState } from 'react'
import { Calculator } from 'lucide-react'
import {
  computeCourseWhatIf,
  computeSemesterAndCgpa,
  getGpaConfig,
  HKU_DEFAULT_CUTOFFS,
  HKU_GRADE_LETTERS,
  HKU_GRADE_POINTS,
  parseNumericPercentage,
  saveGpaConfig,
  type GpaStoredConfig,
  type HkuGradeLetter,
} from '../services/gpa'
import type { LiveCourse, LiveGrade } from '../services/hku'
import { tr, type Locale } from '../services/i18n'

type TargetGradeKey = Exclude<HkuGradeLetter, 'F' | 'P'>
const TARGET_OPTIONS = Object.keys(HKU_DEFAULT_CUTOFFS) as TargetGradeKey[]

export function GpaSimulatorPanel({
  locale = 'zh',
  courses,
  selectedCourse,
  courseGrades = [],
}: {
  locale?: Locale
  courses: LiveCourse[]
  selectedCourse: LiveCourse | null
  courseGrades?: LiveGrade[]
}) {
  const [config, setConfig] = useState<GpaStoredConfig>(() => getGpaConfig())
  const [manualScores, setManualScores] = useState<Record<string, string>>({})

  const updateConfig = (updater: (prev: GpaStoredConfig) => GpaStoredConfig) => {
    setConfig(prev => saveGpaConfig(updater(prev)))
  }

  const semSummary = useMemo(() => {
    const rows = courses.map(c => {
      const saved = config.rows[c.id]
      return {
        credits: saved?.credits ?? 6,
        grade: saved?.grade ?? ('A-' as HkuGradeLetter),
      }
    })
    const pCgpa = config.priorCgpa?.trim() ? Number(config.priorCgpa) : null
    const pCred = config.priorCredits?.trim() ? Number(config.priorCredits) : null
    return computeSemesterAndCgpa(rows, pCgpa, pCred)
  }, [courses, config])

  if (selectedCourse) {
    const courseKey = selectedCourse.id
    const weights = config.courseWeights[courseKey] || {}
    const targetGrade: TargetGradeKey = config.targetGrades[courseKey] || 'A'
    const defaultWeight = courseGrades.length > 0 ? Math.round(100 / Math.max(1, courseGrades.length)) : 20

    const items = courseGrades.map(g => {
      const parsed = g.released !== false ? parseNumericPercentage(g.value) : null
      const overrideRaw = manualScores[g.id]
      const effectiveScore =
        overrideRaw !== undefined && overrideRaw.trim() !== ''
          ? parseNumericPercentage(overrideRaw)
          : parsed
      const weightPct = weights[g.id] !== undefined ? weights[g.id] : defaultWeight
      return {
        id: g.id,
        title: g.title,
        rawDisplay: g.released === false ? tr(locale, '未发布', 'Unreleased') : g.value || '-',
        parsed,
        overrideRaw: overrideRaw ?? '',
        scorePct: effectiveScore,
        weightPct,
      }
    })

    const whatIf = computeCourseWhatIf(items, targetGrade)

    return (
      <div className="gpa-card course-whatif-card">
        <div className="subheading-row">
          <h3 className="subheading">
            <Calculator size={14} /> {tr(locale, '平时分加权与目标等级试算 (What-if)', 'Course Weight & Target Grade What-if')}
          </h3>
          <label className="gpa-target-select">
            <span>{tr(locale, '目标等级', 'Target')}</span>
            <select
              value={targetGrade}
              onChange={e => {
                const nextTarget = e.target.value as TargetGradeKey
                updateConfig(prev => ({
                  ...prev,
                  targetGrades: { ...prev.targetGrades, [courseKey]: nextTarget },
                }))
              }}
            >
              {TARGET_OPTIONS.map(letter => (
                <option key={letter} value={letter}>
                  {letter} (≥{HKU_DEFAULT_CUTOFFS[letter]}%)
                </option>
              ))}
            </select>
          </label>
        </div>

        {items.length > 0 ? (
          <>
            <div className="whatif-summary-banner">
              <span>
                {tr(locale, '已获加权分', 'Banked')}: <strong>{whatIf.bankedPoints}%</strong> ({whatIf.completedWeight}% {tr(locale, '权重', 'weight')})
              </span>
              {whatIf.currentAveragePct !== null && (
                <span>
                  {tr(locale, '当前得分率', 'Current Avg')}: <strong>{whatIf.currentAveragePct}%</strong>
                </span>
              )}
              <span className={whatIf.achievable ? 'whatif-ok' : 'whatif-warn'}>
                {whatIf.requiredOnRemainingPct === null
                  ? whatIf.achievable
                    ? tr(locale, `已达标 ${targetGrade}`, `Target ${targetGrade} reached`)
                    : tr(locale, `未达 ${targetGrade} 线 (${whatIf.targetCutoff}%)`, `Below ${targetGrade} (${whatIf.targetCutoff}%)`)
                  : whatIf.achievable
                    ? tr(
                        locale,
                        `剩余 ${whatIf.remainingWeight}% 权重需均分 ≥ ${whatIf.requiredOnRemainingPct}% 达成 ${targetGrade}`,
                        `Need ≥ ${whatIf.requiredOnRemainingPct}% on remaining ${whatIf.remainingWeight}% for ${targetGrade}`,
                      )
                    : tr(
                        locale,
                        `剩余权重即使满分也难以达到 ${targetGrade} (${whatIf.targetCutoff}%)`,
                        `${targetGrade} (${whatIf.targetCutoff}%) exceeds remaining weight cap`,
                      )}
              </span>
            </div>
            <div className="gpa-rows">
              {items.map(item => (
                <div className="gpa-row" key={item.id}>
                  <span className="gpa-course-name">
                    <strong>{item.title}</strong>
                    <small>{tr(locale, '原始成绩', 'Recorded')}: {item.rawDisplay}</small>
                  </span>
                  <label className="gpa-mini-input">
                    <span>{tr(locale, '得分%', 'Score%')}</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      placeholder={item.parsed !== null ? String(Math.round(item.parsed * 10) / 10) : '0-100'}
                      value={item.overrideRaw}
                      onChange={e => setManualScores(prev => ({ ...prev, [item.id]: e.target.value }))}
                    />
                  </label>
                  <label className="gpa-mini-input">
                    <span>{tr(locale, '权重%', 'Weight%')}</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={item.weightPct}
                      onChange={e => {
                        const nextWeight = Math.max(0, Math.min(100, Number(e.target.value) || 0))
                        updateConfig(prev => ({
                          ...prev,
                          courseWeights: {
                            ...prev.courseWeights,
                            [courseKey]: { ...(prev.courseWeights[courseKey] || {}), [item.id]: nextWeight },
                          },
                        }))
                      }}
                    />
                  </label>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="empty-state">
            {tr(locale, '该课程暂无成绩项可供试算；同步成绩后可在此设置各项平时分权重。', 'No grade items yet; sync Moodle grades to simulate assessment weights.')}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="gpa-card">
      <div className="subheading-row">
        <h3 className="subheading">
          <Calculator size={14} /> {tr(locale, 'HKU 4.3 制学期 GPA 与累计 CGPA 模拟器', 'HKU 4.3 Semester & Cumulative GPA Simulator')}
        </h3>
        <div className="gpa-prior-inputs">
          <label className="gpa-mini-input">
            <span>{tr(locale, '往期 CGPA', 'Prior CGPA')}</span>
            <input
              type="number"
              min={0}
              max={4.3}
              step={0.01}
              placeholder="3.60"
              value={config.priorCgpa || ''}
              onChange={e => updateConfig(prev => ({ ...prev, priorCgpa: e.target.value }))}
            />
          </label>
          <label className="gpa-mini-input">
            <span>{tr(locale, '已修学分', 'Prior Credits')}</span>
            <input
              type="number"
              min={0}
              max={300}
              step={3}
              placeholder="60"
              value={config.priorCredits || ''}
              onChange={e => updateConfig(prev => ({ ...prev, priorCredits: e.target.value }))}
            />
          </label>
        </div>
      </div>

      <div className="gpa-metrics-strip">
        <div>
          <small>{tr(locale, '预测本学期 GPA', 'Projected Sem GPA')}</small>
          <strong>{semSummary.semesterGpa !== null ? semSummary.semesterGpa.toFixed(2) : '—'}</strong>
        </div>
        <div>
          <small>{tr(locale, '计分学分', 'GPA Credits')}</small>
          <strong>{semSummary.semesterCredits}</strong>
        </div>
        <div>
          <small>{tr(locale, '预测累计 CGPA', 'Projected CGPA')}</small>
          <strong>{semSummary.projectedCgpa !== null ? semSummary.projectedCgpa.toFixed(2) : '—'}</strong>
        </div>
      </div>

      {courses.length > 0 ? (
        <div className="gpa-rows">
          {courses.map(course => {
            const saved = config.rows[course.id]
            const credits = saved?.credits ?? 6
            const grade = saved?.grade ?? 'A-'
            return (
              <div className="gpa-row" key={course.id}>
                <span className="gpa-course-name">
                  <strong>{course.code ? `${course.code} · ${course.title}` : course.title}</strong>
                </span>
                <label className="gpa-mini-input">
                  <span>{tr(locale, '学分', 'Credits')}</span>
                  <input
                    type="number"
                    min={0}
                    max={24}
                    step={3}
                    value={credits}
                    onChange={e => {
                      const nextCr = Math.max(0, Math.min(24, Number(e.target.value) || 0))
                      updateConfig(prev => ({
                        ...prev,
                        rows: { ...prev.rows, [course.id]: { credits: nextCr, grade } },
                      }))
                    }}
                  />
                </label>
                <label className="gpa-mini-input">
                  <span>{tr(locale, '预期等级', 'Grade')}</span>
                  <select
                    value={grade}
                    onChange={e => {
                      const nextGr = e.target.value as HkuGradeLetter
                      updateConfig(prev => ({
                        ...prev,
                        rows: { ...prev.rows, [course.id]: { credits, grade: nextGr } },
                      }))
                    }}
                  >
                    {HKU_GRADE_LETTERS.map(letter => (
                      <option key={letter} value={letter}>
                        {letter} ({HKU_GRADE_POINTS[letter] !== null ? HKU_GRADE_POINTS[letter]?.toFixed(1) : 'Pass'})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="empty-state">{tr(locale, '同步 Moodle 课程后可在此模拟学期 GPA。', 'Sync Moodle courses to simulate semester GPA.')}</p>
      )}
    </div>
  )
}
// end GpaSimulatorPanel
