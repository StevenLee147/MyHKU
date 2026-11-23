import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function loadMoodleCoursesService() {
  const hkuSrc = stripTypeScriptTypes(fs.readFileSync(path.join(root, 'src/services/hku.ts'), 'utf8'))
  const rawSvc = stripTypeScriptTypes(fs.readFileSync(path.join(root, 'src/services/moodleCourses.ts'), 'utf8'))
  const patchedSvc = rawSvc.replace(/from\s+['"]\.\/hku['"]/g, `from 'data:text/javascript;base64,${Buffer.from('export {}').toString('base64')}'`)
  void hkuSrc
  return import(`data:text/javascript;base64,${Buffer.from(patchedSvc).toString('base64')}`)
}

async function startTestBridge() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myhku-moodle-bridge-test-'))
  const cacheFile = path.join(tmpDir, 'cache.enc.json')
  const cacheKey = crypto.randomBytes(32).toString('base64')
  const child = spawn(process.execPath, [path.join(root, 'bridge', 'server.mjs')], {
    cwd: root,
    env: {
      ...process.env,
      MYHKU_BRIDGE_PORT: '0',
      MYHKU_BRIDGE_CACHE_FILE: cacheFile,
      MYHKU_BRIDGE_CACHE_KEY: cacheKey,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Bridge startup timed out')), 5000)
    child.stdout.on('data', chunk => {
      const match = String(chunk).match(/127\.0\.0\.1:(\d+)/)
      if (match) {
        clearTimeout(timer)
        resolve(Number(match[1]))
      }
    })
    child.once('error', err => { clearTimeout(timer); reject(err) })
  })
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      child.kill()
      await new Promise(resolve => child.once('exit', resolve))
      fs.rmSync(tmpDir, { recursive: true, force: true })
    },
  }
}

test('moodleCourses detects subclasses vs single-section main courses, filters snapshots, and supports multi-token code search', async () => {
  const {
    defaultMoodleCoursePrefs,
    enrichMoodleCourses,
    filterSnapshotByCoursePrefs,
    matchesMoodleQuery,
    setBatchCourseVisibility,
    setSingleCourseVisibility,
  } = await loadMoodleCoursesService()

  const rawCourses = [
    { id: '101', title: 'GLIS1901_1A_2026 Foundations of Global Studies [Section 1A, 2026]', shortname: 'GLIS1901_1A_2026' },
    { id: '201', title: 'COMP2113 Programming Technologies [2026]', code: 'COMP2113' },
    { id: '202', title: 'COMP2113_2B_2026 Programming Technologies (2B)', shortname: 'COMP2113_2B_2026' },
    { id: '203', title: 'CAES1001 Academic Communication Subclass 1C3', shortname: 'CAES1001_1C3' },
    { id: '301', title: 'HKU Library Orientation & Anti-Plagiarism Training 2026' },
  ]

  const enriched = enrichMoodleCourses(rawCourses, defaultMoodleCoursePrefs())
  const glis = enriched.find(c => c.id === '101')
  const compMain = enriched.find(c => c.id === '201')
  const compSub = enriched.find(c => c.id === '202')
  const caesSub = enriched.find(c => c.id === '203')
  const orient = enriched.find(c => c.id === '301')

  assert.equal(glis.code, 'GLIS1901', 'underscore-delimited HKU shortname extracts GLIS1901')
  assert.equal(glis.isSubclass, false, 'single-shell course with [Section 1A] is preserved as main course')
  assert.equal(compMain.isSubclass, false)
  assert.equal(compSub.isSubclass, true, 'sibling section shell alongside main COMP2113 shell is detected as subclass')
  assert.equal(caesSub.isSubclass, true, 'explicit Subclass keyword is detected as subclass')
  assert.equal(orient.isNonAcademic, true, 'orientation/anti-plagiarism shell is detected as non-academic')

  const snapshot = {
    fetchedAt: '2026-11-23T08:00:00Z',
    schedule: [{ id: 's1', title: 'CAES1001-1C3', code: 'CAES1001', date: '2026-11-23', start: '09:00', end: '11:50' }],
    courses: rawCourses,
    assignments: [
      { id: 'a1', title: 'Global Essay', course: 'GLIS1901_1A_2026 Foundations of Global Studies [Section 1A, 2026]', courseId: '101', completed: false },
      { id: 'a2', title: 'Tutorial Exercise 2B', course: 'COMP2113_2B_2026 Programming Technologies (2B)', courseId: '202', completed: false },
      { id: 'a3', title: 'Main Assignment 1', course: 'COMP2113 Programming Technologies [2026]', courseId: '201', completed: false },
    ],
    resources: [
      { id: 'r1', title: 'Sub Handout', course: 'CAES1001 Academic Communication Subclass 1C3', courseId: '203', url: 'https://moodle.hku.hk/mod/resource/view.php?id=55' },
    ],
    grades: [],
    announcements: [],
  }

  let prefs = { ...defaultMoodleCoursePrefs(), autoHideSubclasses: true, autoHideNonAcademic: true }
  let filtered = filterSnapshotByCoursePrefs(snapshot, prefs)
  assert.deepEqual(filtered.courses.map(c => c.id), ['101', '201'], 'subclasses and orientation hidden while main courses remain')
  assert.deepEqual(filtered.assignments.map(a => a.id), ['a1', 'a3'], 'hidden subclass assignments excluded without touching sibling main course')
  assert.equal(filtered.resources.length, 0)
  assert.equal(filtered.schedule.length, 1, 'SIS weekly timetable remains untouched')

  // Explicit user override shows a specific subclass even when autoHideSubclasses is enabled
  prefs = setSingleCourseVisibility(prefs, '203', true)
  filtered = filterSnapshotByCoursePrefs(snapshot, prefs)
  assert.deepEqual(filtered.courses.map(c => c.id), ['101', '201', '203'])
  assert.equal(filtered.resources.length, 1)

  // Batch hide
  prefs = setBatchCourseVisibility(prefs, ['101', '201'], false)
  filtered = filterSnapshotByCoursePrefs(snapshot, prefs)
  assert.deepEqual(filtered.courses.map(c => c.id), ['203'])

  // Enhanced multi-token & spaced-code search
  assert.equal(matchesMoodleQuery('glis 1901 essay', glis.title, glis.code, 'Global Essay'), true)
  assert.equal(matchesMoodleQuery('comp-2113 2b', compSub.title, compSub.shortname), true)
  assert.equal(matchesMoodleQuery('glis 9999', glis.title, glis.code), false)
})

test('bridge preserves Moodle course metadata, courseId, and retains earlier courses on partial non-authoritative ingest', async () => {
  const bridge = await startTestBridge()
  try {
    const postMoodle = async body => {
      const res = await fetch(`${bridge.baseUrl}/api/ingest/moodle`, {
        method: 'POST',
        headers: { Origin: 'https://moodle.hku.hk', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      assert.equal(res.status, 200)
    }

    await postMoodle({
      replaceFields: ['courses'],
      courses: [
        { id: '101', title: 'GLIS1901 Foundations', code: 'GLIS1901', term: '2026', starred: true },
        { id: '102', title: 'CAES1001 Subclass 1C3', code: 'CAES1001', section: '1C3', isSubclass: true },
      ],
      assignments: [
        { id: '501', title: 'Draft 1', course: 'CAES1001 Subclass 1C3', courseId: '102', completed: false },
      ],
    })

    // Partial page sync without replaceFields merges new course without wiping 101 & 102
    await postMoodle({
      courses: [{ id: '103', title: 'FINA1310 Corporate Finance', code: 'FINA1310' }],
    })

    const snap = await (await fetch(`${bridge.baseUrl}/api/snapshot`)).json()
    assert.deepEqual(snap.courses.map(c => c.id), ['101', '102', '103'])
    assert.equal(snap.courses.find(c => c.id === '102').isSubclass, true)
    assert.equal(snap.courses.find(c => c.id === '102').section, '1C3')
    assert.equal(snap.assignments[0].courseId, '102')
  } finally {
    await bridge.close()
  }
})
