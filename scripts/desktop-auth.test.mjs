import test from 'node:test'
import assert from 'node:assert/strict'
import { AuthCoordinator, serviceForUrl } from '../desktop/auth-flow.mjs'

test('redirected windows keep one service identity across repeated startup/login/refresh requests', () => {
  const starts = []
  const auth = new AuthCoordinator(record => {
    starts.push(record.site)
    record.window = { url: 'https://login.microsoftonline.com/authorize' }
  })
  for (let i = 0; i < 5; i++) {
    for (const site of ['portal', 'sis', 'moodle']) auth.request(site, { refresh: true })
  }
  assert.deepEqual(starts, ['portal'])
  auth.update('portal', 'connected')
  assert.deepEqual(starts, ['portal', 'sis'])
  auth.update('sis', 'connected')
  auth.update('moodle', 'connected')
  assert.deepEqual(starts, ['portal', 'sis', 'moodle'])
  for (const site of ['portal', 'sis', 'moodle']) auth.request(site, { show: true })
  assert.equal(starts.length, 3, 'already connected login buttons never start another session')
})

test('MFA releases the automatic queue and continue reveals the existing window', () => {
  const starts = []
  let shows = 0
  const auth = new AuthCoordinator(record => { starts.push(record.site); record.window = { show: () => shows++ } })
  auth.request('portal')
  auth.request('moodle')
  auth.update('portal', 'needs_2fa')
  auth.request('portal', { show: true })
  assert.deepEqual(starts, ['portal', 'moodle'])
  assert.equal(shows, 1)
  auth.update('portal', 'connected')
  assert.deepEqual(starts, ['portal', 'moodle'])
})

test('manual timeout releases the queue and a resumed flow never reloads or duplicates its turn', () => {
  const starts = []
  const auth = new AuthCoordinator(record => starts.push([record.site, Boolean(record.resume)]))
  auth.request('portal')
  auth.request('sis')
  auth.update('portal', 'manual_required')
  assert.equal(auth.active, 'sis')
  auth.request('portal', { resume: true })
  auth.request('portal', { resume: true })
  auth.update('sis', 'connected')
  assert.deepEqual(starts, [['portal', false], ['sis', false], ['portal', true]])
})

test('window startup failures release the queue, including asynchronous rejection', async () => {
  const auth = new AuthCoordinator(record => {
    if (record.site === 'portal') throw new Error('Window failed')
    if (record.site === 'sis') return Promise.reject(new Error('Navigation failed'))
  })
  for (const site of ['portal', 'sis', 'moodle']) auth.request(site)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(auth.snapshot().portal.state, 'error')
  assert.equal(auth.snapshot().sis.state, 'error')
  assert.equal(auth.active, 'moodle')
})

test('late failures from a reset account cannot modify a replacement login', async () => {
  let fail
  let first = true
  const auth = new AuthCoordinator(() => {
    if (!first) return
    first = false
    return new Promise((_, reject) => { fail = reject })
  })
  auth.request('portal')
  const previous = auth.snapshot().portal.revision
  auth.reset()
  assert.ok(auth.snapshot().portal.revision > previous)
  auth.request('portal')
  fail(new Error('Old window failed'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(auth.snapshot().portal.state, 'checking')
  auth.update('portal', 'connected')
  assert.ok(auth.snapshot().portal.revision > previous)
})

test('connection status is available before extraction and survives a dashboard reload', () => {
  const auth = new AuthCoordinator(() => {})
  auth.request('portal')
  auth.update('portal', 'connected', 'Session verified')
  assert.equal(auth.snapshot().portal.state, 'connected')
  assert.equal(auth.snapshot().sis.state, 'disconnected')
  assert.ok(auth.snapshot().portal.checkedAt)
  assert.equal(JSON.stringify(auth.snapshot()).includes('window'), false)
})

test('failure advances the queue, explicit retry is queued once, reset invalidates records', () => {
  const starts = []
  const auth = new AuthCoordinator(record => starts.push(record.site))
  auth.request('portal')
  auth.request('sis')
  auth.update('portal', 'error')
  auth.request('portal')
  auth.request('portal')
  auth.update('sis', 'connected')
  assert.deepEqual(starts, ['portal', 'sis', 'portal'])
  auth.reset()
  auth.update('portal', 'connected')
  assert.equal(auth.snapshot().portal.state, 'disconnected')
  assert.equal(auth.active, null)
})

test('SIS aliases map to SIS while identity and unrelated hosts prove no service session', () => {
  for (const host of ['sweb', 'sis-main', 'intraweb']) assert.equal(serviceForUrl(`https://${host}.hku.hk/`), 'sis')
  assert.equal(serviceForUrl('https://login.microsoftonline.com/'), null)
  assert.equal(serviceForUrl('https://studentportal.hku.hk.evil.test/'), null)
  assert.equal(serviceForUrl('http://studentportal.hku.hk/'), null)
})
