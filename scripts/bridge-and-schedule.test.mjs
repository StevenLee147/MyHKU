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

async function loadTsModule(relPath) {
  const source = fs.readFileSync(path.join(root, relPath), 'utf8')
  const js = stripTypeScriptTypes(source)
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}

async function startTestBridge() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myhku-bridge-test-'))
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
    cacheFile,
    async close() {
      child.kill()
      await new Promise(resolve => child.once('exit', resolve))
      fs.rmSync(tmpDir, { recursive: true, force: true })
    },
  }
}

test('bridge merges schedule by week range without wiping other weeks and wipes everything on /api/reset', async () => {
  const bridge = await startTestBridge()
  try {
    const postSis = async body => {
      const res = await fetch(`${bridge.baseUrl}/api/ingest/sis`, {
        method: 'POST',
        headers: { Origin: 'https://sweb.hku.hk', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      assert.equal(res.status, 200)
    }

    await postSis({
      scheduleWeek: { start: '2026-09-20', end: '2026-09-26' },
      scheduleWeeks: [{ start: '2026-09-20', end: '2026-09-26' }],
      replaceFields: ['schedule'],
      schedule: [
        { id: 'w1-mon', title: 'COMP7901', date: '2026-09-21', start: '09:30', end: '11:20' },
        { id: 'w1-wed', title: 'COMP7801', date: '2026-09-23', start: '14:30', end: '16:20' },
      ],
    })

    // Syncing week 2 with replaceFields: ['schedule'] must preserve week 1!
    await postSis({
      scheduleWeek: { start: '2026-09-27', end: '2026-10-03' },
      scheduleWeeks: [{ start: '2026-09-27', end: '2026-10-03' }],
      replaceFields: ['schedule'],
      schedule: [
        { id: 'w2-tue', title: 'COMP7103', date: '2026-09-29', start: '10:30', end: '12:20' },
      ],
    })

    let snap = await (await fetch(`${bridge.baseUrl}/api/snapshot`)).json()
    assert.equal(snap.schedule.length, 3)
    assert.deepEqual(snap.scheduleWeeks.map(w => w.start), ['2026-09-20', '2026-09-27'])
    assert.equal(fs.existsSync(bridge.cacheFile), true, 'encrypted cache written to disk')

    // If week 2 becomes an empty holiday week, only week 2's class is removed; week 1 remains intact.
    await postSis({
      scheduleWeek: { start: '2026-09-27', end: '2026-10-03' },
      scheduleWeeks: [{ start: '2026-09-27', end: '2026-10-03' }],
      replaceFields: ['schedule'],
      schedule: [],
    })

    snap = await (await fetch(`${bridge.baseUrl}/api/snapshot`)).json()
    assert.deepEqual(snap.schedule.map(c => c.id), ['w1-mon', 'w1-wed'])

    // Remote web origins must never be permitted to reset the bridge.
    const forbidden = await fetch(`${bridge.baseUrl}/api/reset`, {
      method: 'POST',
      headers: { Origin: 'https://moodle.hku.hk' },
    })
    assert.equal(forbidden.status, 403)

    // Trusted local reset clears memory snapshot, session state, and encrypted disk cache.
    const resetRes = await fetch(`${bridge.baseUrl}/api/reset`, { method: 'POST' })
    assert.equal(resetRes.status, 200)
    assert.equal(fs.existsSync(bridge.cacheFile), false, 'encrypted cache deleted on sign-out reset')
    const afterReset = await (await fetch(`${bridge.baseUrl}/api/snapshot`)).json()
    assert.equal(afterReset.fetchedAt, null)
    assert.equal(afterReset.schedule.length, 0)
    assert.equal(afterReset.scheduleWeeks.length, 0)
    const sisSession = await (await fetch(`${bridge.baseUrl}/api/session/sis`)).json()
    assert.equal(sisSession.connected, false)
  } finally {
    await bridge.close()
  }
})

test('schedule layout splits overlapping classes into side-by-side columns and preserves todayClasses across multi-week snapshots', async () => {
  const { layoutDayEvents, todayClasses, hongKongGreeting } = await loadTsModule('src/services/schedule.ts')

  const placed = layoutDayEvents([
    { item: { id: 'a', title: 'Lecture', start: '13:30', end: '15:20' }, start: 810, end: 920 },
    { item: { id: 'b', title: 'Lab Overlap', start: '14:30', end: '16:00' }, start: 870, end: 960 },
    { item: { id: 'c', title: 'Evening Seminar', start: '17:00', end: '18:00' }, start: 1020, end: 1080 },
  ])
  assert.equal(placed.length, 3)
  const a = placed.find(p => p.item.id === 'a')
  const b = placed.find(p => p.item.id === 'b')
  const c = placed.find(p => p.item.id === 'c')
  assert.equal(a.cols, 2)
  assert.equal(b.cols, 2)
  assert.notEqual(a.col, b.col)
  assert.equal(c.cols, 1)
  assert.equal(c.col, 0)

  // Even if scheduleWeek points to next week after browsing, todayClasses finds today's week in scheduleWeeks.
  const multiWeekSnapshot = {
    fetchedAt: '2026-09-23T02:00:00Z',
    scheduleWeek: { start: '2026-09-27', end: '2026-10-03' },
    scheduleWeeks: [
      { start: '2026-09-20', end: '2026-09-26' },
      { start: '2026-09-27', end: '2026-10-03' },
    ],
    schedule: [
      { id: 'today-1', title: 'GLIS1905', date: '2026-09-23', start: '09:00', end: '11:50' },
      { id: 'next-1', title: 'GLIS1905', date: '2026-09-30', start: '09:00', end: '11:50' },
    ],
    courses: [], assignments: [], resources: [], grades: [], announcements: [],
  }
  const todayList = todayClasses(multiWeekSnapshot, new Date('2026-09-23T03:00:00Z'))
  assert.equal(todayList.length, 1)
  assert.equal(todayList[0].id, 'today-1')

  // 2026-09-23T14:00:00Z is 22:00 HKT -> 晚上好
  assert.equal(hongKongGreeting(new Date('2026-09-23T14:00:00Z')), '晚上好')
})

test('notifications parse Moodle due strings, suppress baseline spam, and deduplicate 24h/1h reminders', async () => {
  const storage = new Map()
  globalThis.localStorage = {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, val) => storage.set(key, String(val)),
    removeItem: key => storage.delete(key),
  }
  try {
    const { parseDueTimestamp, evaluateSnapshotNotifications } = await loadTsModule('src/services/notifications.ts')
    const refNow = new Date('2026-09-22T10:00:00+08:00')
    const parsedToday = parseDueTimestamp('Today, 22 September, 11:59 PM', refNow)
    assert.equal(parsedToday, Date.parse('2026-09-22T23:59:00+08:00'))

    const baselineSnap = {
      fetchedAt: refNow.toISOString(),
      scheduleWeek: { start: '2026-09-20', end: '2026-09-26' },
      scheduleWeeks: [{ start: '2026-09-20', end: '2026-09-26' }],
      schedule: [{ id: 'c1', title: 'COMP7901', date: '2026-09-22', start: '09:30', end: '11:20' }],
      courses: [],
      assignments: [
        { id: 'a-existing', title: 'Existing Essay', course: 'COMP7901', due: '2026-09-22 20:00', completed: false },
      ],
      resources: [],
      grades: [],
      announcements: [],
    }
    // First baseline sync must never spam notifications.
    const initialAlerts = evaluateSnapshotNotifications(baselineSnap, undefined, refNow)
    assert.equal(initialAlerts.length, 0)

    // Subsequent sync adds a new assignment due within 18h and cancels class c1:
    const secondSnap = {
      ...baselineSnap,
      schedule: [],
      assignments: [
        ...baselineSnap.assignments,
        { id: 'a-new', title: 'New Lab Report', course: 'COMP7901', due: '2026-09-23 02:00', completed: false },
      ],
    }
    const secondAlerts = evaluateSnapshotNotifications(secondSnap, undefined, refNow)
    assert.equal(secondAlerts.some(a => a.title === '新作业待办'), true)
    assert.equal(secondAlerts.some(a => a.title === '作业将在 24 小时内截止'), true)
    assert.equal(secondAlerts.some(a => a.title === '课表课程取消或调整'), true)

    // Repeating the exact same sync does not emit duplicate 24h or diff alerts!
    const thirdAlerts = evaluateSnapshotNotifications(secondSnap, undefined, refNow)
    assert.equal(thirdAlerts.length, 0)
  } finally {
    delete globalThis.localStorage
  }
})
