import assert from 'node:assert/strict'
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { verifyApp as verifyReleaseApp, verifyMacosRelease as verifyReleaseArtifacts } from './verify-macos-release.mjs'

// Keep full Developer ID and notarization regression coverage for the opt-in mode.
const verifyApp = (app, run) => verifyReleaseApp(app, run, { notarized: true })
const verifyMacosRelease = options => verifyReleaseArtifacts({ ...options, notarized: true })
const adHocSignature = 'Signature=adhoc\nTeamIdentifier=not set\nCodeDirectory flags=0x2(adhoc)'

const developerId = [
  'Authority=Developer ID Application: Example Developer (ABCDEFGHIJ)',
  'TeamIdentifier=ABCDEFGHIJ',
  'CodeDirectory v=20500 size=123 flags=0x10000(runtime) hashes=123+7 location=embedded',
  'Timestamp=Sep 10, 2026 at 10:00:00 AM',
].join('\n')

async function fixture(t, names = ['MyHKU-arm64.dmg', 'MyHKU-arm64-mac.zip']) {
  const artifactsDir = await mkdtemp(path.join(os.tmpdir(), 'myhku-verify-test-'))
  t.after(() => rm(artifactsDir, { recursive: true, force: true }))
  for (const name of names) await writeFile(path.join(artifactsDir, name), 'test artifact')
  return artifactsDir
}

function commands({ fail, signature = developerId, assessment, apps = ['MyHKU.app'] } = {}) {
  const calls = []
  const temporaryDirectories = []
  const run = async (command, args) => {
    calls.push({ command, args })
    if (command === 'hdiutil' && args[0] === 'attach') {
      const mountpoint = args[args.indexOf('-mountpoint') + 1]
      temporaryDirectories.push(path.dirname(mountpoint))
      for (const app of apps) await mkdir(path.join(mountpoint, app))
    }
    if (command === 'ditto') {
      const destination = args.at(-1)
      temporaryDirectories.push(destination)
      for (const app of apps) await mkdir(path.join(destination, app))
    }
    await fail?.(command, args)
    if (command === 'codesign' && args[0] === '--display') return { stdout: '', stderr: signature }
    if (command === 'spctl') return { stdout: '', stderr: assessment ?? `${args.at(-1)}: accepted\nsource=Notarized Developer ID\n` }
    return { stdout: '', stderr: '' }
  }
  return { run, calls, temporaryDirectories }
}

async function assertCleaned(directories) {
  for (const directory of directories) await assert.rejects(access(directory), { code: 'ENOENT' })
}

test('checks shipped contents of every architecture and both container formats', async t => {
  const names = ['MyHKU-arm64.dmg', 'MyHKU-arm64-mac.zip', 'MyHKU-x64.dmg', 'MyHKU-x64-mac.zip']
  const artifactsDir = await fixture(t, [...names, 'alpha-mac.yml', 'MyHKU-arm64.dmg.blockmap'])
  const mock = commands()
  const verified = await verifyMacosRelease({ artifactsDir, platform: 'darwin', run: mock.run })
  assert.equal(verified.length, 4)
  for (const name of names) assert.ok(verified.includes(path.join(artifactsDir, name)))
  const verifiedApps = mock.calls.filter(({ command, args }) => command === 'codesign' && args[0] === '--verify' && args.at(-1).endsWith('.app'))
  assert.equal(verifiedApps.length, 4)
  assert.ok(verifiedApps.every(({ args }) => args.includes('--deep') && args.includes('--strict')))
  for (const { args } of verifiedApps) {
    const target = args.at(-1)
    assert.ok(mock.calls.some(call => call.command === 'xcrun' && call.args[1] === 'validate' && call.args.at(-1) === target))
    assert.ok(mock.calls.some(call => call.command === 'spctl' && call.args.includes('execute') && call.args.at(-1) === target))
  }
  assert.equal(mock.calls.filter(({ command, args }) => command === 'spctl' && args.includes('context:primary-signature')).length, 2)
  assert.equal(mock.calls.filter(({ command, args }) => command === 'hdiutil' && args[0] === 'detach').length, 2)
  await assertCleaned(mock.temporaryDirectories)
})

test('missing either required artifact format fails before any platform commands', async t => {
  for (const names of [[], ['MyHKU.dmg'], ['MyHKU-mac.zip']]) {
    const artifactsDir = await fixture(t, names)
    const mock = commands()
    await assert.rejects(verifyMacosRelease({ artifactsDir, platform: 'darwin', run: mock.run }), /Missing required macOS/)
    assert.equal(mock.calls.length, 0)
  }
})

test('cannot silently skip verification on another platform', async () => {
  await assert.rejects(verifyMacosRelease({ artifactsDir: '.', platform: 'win32' }), /must run on macOS/)
  await assert.rejects(verifyMacosRelease({ platform: 'darwin' }), /explicit macOS artifacts directory/)
})

test('rejects ad-hoc, non-hardened and untimestamped signatures even if codesign verification succeeds', async () => {
  const cases = [
    ['Signature=adhoc\nTeamIdentifier=not set', /Developer ID Application/],
    [developerId.replace('flags=0x10000(runtime)', 'flags=0x0(none)'), /Hardened runtime/],
    [developerId.replace(/Timestamp=.+/, ''), /secure signing timestamp/],
  ]
  for (const [signature, expected] of cases) {
    await assert.rejects(verifyApp('/test/MyHKU.app', commands({ signature }).run), expected)
  }
})

test('rejects a disabled or non-notarized Gatekeeper assessment despite a successful exit', async () => {
  for (const assessment of ['assessments disabled\n', '/test/MyHKU.app: accepted\nsource=Developer ID\n']) {
    await assert.rejects(verifyApp('/test/MyHKU.app', commands({ assessment }).run), /Gatekeeper must accept the notarized/)
  }
})

test('rejects a DMG without a stapled ticket before mounting it', async t => {
  const artifactsDir = await fixture(t)
  const mock = commands({ fail(command, args) {
    if (command === 'xcrun' && args.at(-1).endsWith('.dmg')) throw new Error('ticket is missing')
  } })
  await assert.rejects(verifyMacosRelease({ artifactsDir, platform: 'darwin', run: mock.run }), /MyHKU-arm64.dmg:.*ticket is missing/)
  assert.ok(!mock.calls.some(({ command, args }) => command === 'hdiutil' && args[0] === 'attach'))
  await assertCleaned(mock.temporaryDirectories)
})

test('detaches and removes temporary files when the DMG app fails strict verification', async t => {
  const artifactsDir = await fixture(t)
  const mock = commands({ fail(command, args) {
    if (command === 'codesign' && args[0] === '--verify' && args.at(-1).includes('myhku-verify-dmg-')) throw new Error('bundle seal is broken')
  } })
  await assert.rejects(verifyMacosRelease({ artifactsDir, platform: 'darwin', run: mock.run }), /bundle seal is broken/)
  assert.ok(mock.calls.some(({ command, args }) => command === 'hdiutil' && args[0] === 'detach'))
  await assertCleaned(mock.temporaryDirectories)
})

test('checks the ZIP app independently and cleans extraction after a missing ticket', async t => {
  const artifactsDir = await fixture(t)
  const mock = commands({ fail(command, args) {
    if (command === 'xcrun' && args.at(-1).includes('myhku-verify-zip-')) throw new Error('ZIP app ticket is missing')
  } })
  await assert.rejects(verifyMacosRelease({ artifactsDir, platform: 'darwin', run: mock.run }), /MyHKU-arm64-mac.zip:.*ZIP app ticket is missing/)
  await assertCleaned(mock.temporaryDirectories)
})

test('cleans extraction when a ZIP is corrupt', async t => {
  const artifactsDir = await fixture(t)
  const mock = commands({ fail(command) {
    if (command === 'ditto') throw new Error('archive is corrupt')
  } })
  await assert.rejects(verifyMacosRelease({ artifactsDir, platform: 'darwin', run: mock.run }), /archive is corrupt/)
  await assertCleaned(mock.temporaryDirectories)
})

test('rejects archives without an application or with ambiguous application bundles', async t => {
  for (const apps of [[], ['MyHKU.app', 'Unexpected.app']]) {
    const artifactsDir = await fixture(t)
    const mock = commands({ apps })
    await assert.rejects(verifyMacosRelease({ artifactsDir, platform: 'darwin', run: mock.run }), /Expected exactly one application bundle/)
    await assertCleaned(mock.temporaryDirectories)
  }
})

test('retries a busy volume with forced detach before deleting the mount directory', async t => {
  const artifactsDir = await fixture(t)
  const mock = commands({ fail(command, args) {
    if (command === 'hdiutil' && args[0] === 'detach' && !args.includes('-force')) throw new Error('volume busy')
  } })
  await verifyMacosRelease({ artifactsDir, platform: 'darwin', run: mock.run })
  assert.ok(mock.calls.some(({ command, args }) => command === 'hdiutil' && args[0] === 'detach' && args.includes('-force')))
  await assertCleaned(mock.temporaryDirectories)
})

test('cleans an unsuccessful attach when no volume is mounted', async t => {
  const artifactsDir = await fixture(t)
  const mock = commands({ fail(command, args) {
    if (command === 'hdiutil' && args[0] === 'attach') throw new Error('cannot mount image')
  } })
  await assert.rejects(verifyMacosRelease({ artifactsDir, platform: 'darwin', run: mock.run }), /cannot mount image/)
  await assertCleaned(mock.temporaryDirectories)
})

test('preserves the mount directory if both detach attempts fail', async t => {
  const artifactsDir = await fixture(t)
  const mock = commands({ fail(command, args) {
    if (command === 'hdiutil' && args[0] === 'detach') throw new Error('cannot detach image')
  } })
  // This runner only creates fixture directories; no real volume is mounted.
  t.after(async () => {
    for (const directory of mock.temporaryDirectories) await rm(directory, { recursive: true, force: true })
  })
  await assert.rejects(verifyMacosRelease({ artifactsDir, platform: 'darwin', run: mock.run }), /cannot detach image/)
  const mounted = mock.temporaryDirectories.find(directory => directory.includes('myhku-verify-dmg-'))
  await access(path.join(mounted, 'mounted', 'MyHKU.app'))
})

test('ad-hoc release verifies both shipped app signatures and DMG integrity without Apple trust checks', async t => {
  const artifactsDir = await fixture(t)
  const mock = commands({ signature: adHocSignature })
  const verified = await verifyReleaseArtifacts({ artifactsDir, platform: 'darwin', run: mock.run, notarized: false })
  assert.equal(verified.length, 2)
  const appChecks = mock.calls.filter(({ command, args }) => command === 'codesign' && args[0] === '--verify')
  assert.equal(appChecks.length, 2)
  assert.ok(appChecks.every(({ args }) => args.at(-1).endsWith('.app') && args.includes('--deep') && args.includes('--strict')))
  assert.ok(mock.calls.some(({ command, args }) => command === 'hdiutil' && args[0] === 'verify' && args.at(-1).endsWith('.dmg')))
  assert.ok(!mock.calls.some(({ command }) => command === 'xcrun' || command === 'spctl'))
  await assertCleaned(mock.temporaryDirectories)
})

test('ad-hoc release still blocks a broken signature in either shipped container', async t => {
  for (const format of ['dmg', 'zip']) {
    const artifactsDir = await fixture(t)
    const mock = commands({ signature: adHocSignature, fail(command, args) {
      if (command === 'codesign' && args[0] === '--verify' && args.at(-1).includes(`myhku-verify-${format}-`)) {
        throw new Error(`${format} bundle seal is broken`)
      }
    } })
    await assert.rejects(verifyReleaseArtifacts({ artifactsDir, platform: 'darwin', run: mock.run, notarized: false }), /bundle seal is broken/)
    await assertCleaned(mock.temporaryDirectories)
  }
})

test('ad-hoc release rejects an unsigned app instead of trusting successful tool execution', async () => {
  await assert.rejects(verifyReleaseApp('/test/MyHKU.app', commands({ signature: 'TeamIdentifier=not set' }).run, {
    notarized: false,
  }), /ad-hoc application signature is required/)
})

test('ad-hoc release rejects a damaged DMG before mounting it', async t => {
  const artifactsDir = await fixture(t)
  const mock = commands({ signature: adHocSignature, fail(command, args) {
    if (command === 'hdiutil' && args[0] === 'verify') throw new Error('DMG checksum mismatch')
  } })
  await assert.rejects(verifyReleaseArtifacts({ artifactsDir, platform: 'darwin', run: mock.run, notarized: false }), /DMG checksum mismatch/)
  assert.ok(!mock.calls.some(({ command, args }) => command === 'hdiutil' && args[0] === 'attach'))
  await assertCleaned(mock.temporaryDirectories)
})
