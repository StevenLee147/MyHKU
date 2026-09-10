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

test('MFA holds the shared SSO queue and continue reveals the existing window', () => {
  const starts = []
  let shows = 0
  const auth = new AuthCoordinator(record => { starts.push(record.site); record.window = { show: () => shows++ } })
  auth.request('portal')
  auth.request('moodle')
  auth.update('portal', 'needs_2fa')
  auth.request('portal', { show: true })
  assert.deepEqual(starts, ['portal'])
  assert.equal(shows, 1)
  auth.update('portal', 'connected')
  assert.deepEqual(starts, ['portal', 'moodle'])
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
})
