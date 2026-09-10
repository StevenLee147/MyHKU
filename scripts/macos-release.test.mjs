import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { afterSign, artifactBuildCompleted, beforePack, checkSigningEnvironment, isNotarizedRelease, notarizeDmg } from './macos-release.mjs'

const credentials = {
  CSC_LINK: 'synthetic-certificate-content',
  CSC_KEY_PASSWORD: 'synthetic-certificate-password',
  APPLE_ID: 'release@example.test',
  APPLE_APP_SPECIFIC_PASSWORD: 'synthetic-apple-password',
  APPLE_TEAM_ID: 'SYNTHETIC1',
}

function assertNoCredentials(message) {
  for (const value of Object.values(credentials)) assert.ok(!message.includes(value))
}

test('missing and blank credentials block release without exposing configured values', async () => {
  for (const name of Object.keys(credentials)) {
    for (const value of [undefined, '', ' \t ']) {
      const env = { ...credentials, [name]: value }
      assert.throws(() => checkSigningEnvironment(env), error => {
        assert.match(error.message, /macOS release signing is required/)
        assert.ok(error.message.includes(name))
        assertNoCredentials(error.message)
        return true
      })
      await assert.rejects(notarizeDmg('release/MyHKU.dmg', {
        env,
        run: async () => assert.fail('Apple tools must not run without complete credentials'),
      }))
    }
  }
})

test('disabled signing identity discovery blocks release even with complete credentials', () => {
  assert.throws(() => checkSigningEnvironment({ ...credentials, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }), error => {
    assert.match(error.message, /cannot disable CSC_IDENTITY_AUTO_DISCOVERY/)
    assertNoCredentials(error.message)
    return true
  })
  assert.doesNotThrow(() => checkSigningEnvironment(credentials))
})

test('only an Accepted notarization result can reach stapling', async t => {
  const responses = [
    ['invalid JSON', 'not JSON'],
    ['null response', 'null'],
    ['array response', '[]'],
    ['missing status', '{}'],
    ['Invalid', JSON.stringify({ status: 'Invalid' })],
    ['In Progress', JSON.stringify({ status: 'In Progress' })],
    ['lowercase accepted', JSON.stringify({ status: 'accepted' })],
    ['unsafe submission id', JSON.stringify({ status: 'Invalid', id: credentials.APPLE_APP_SPECIFIC_PASSWORD })],
  ]
  for (const [name, stdout] of responses) {
    await t.test(name, async () => {
      const calls = []
      await assert.rejects(notarizeDmg('release/MyHKU.dmg', {
        env: credentials,
        run: async (command, args) => {
          calls.push([command, args])
          return { stdout }
        },
      }), error => {
        assertNoCredentials(error.message)
        return true
      })
      assert.equal(calls.length, 1, 'a rejected submission must never be stapled or validated')
      assert.equal(calls[0][0], 'xcrun')
      assert.deepEqual(calls[0][1].slice(0, 2), ['notarytool', 'submit'])
    })
  }
})

test('Accepted submission is stapled and validated in sequence', async () => {
  const file = path.resolve('release/MyHKU with spaces.dmg')
  const calls = []
  await notarizeDmg(file, {
    env: credentials,
    run: async (command, args) => {
      calls.push([command, args])
      return { stdout: args[0] === 'notarytool' ? JSON.stringify({ status: 'Accepted' }) : '' }
    },
  })
  assert.deepEqual(calls.map(([command, args]) => [command, ...args.slice(0, 2)]), [
    ['xcrun', 'notarytool', 'submit'],
    ['xcrun', 'stapler', 'staple'],
    ['xcrun', 'stapler', 'validate'],
  ])
  const submit = calls[0][1]
  assert.equal(submit[2], file)
  assert.ok(submit.includes('--wait'))
  assert.equal(submit[submit.indexOf('--output-format') + 1], 'json')
  assert.equal(submit[submit.indexOf('--apple-id') + 1], credentials.APPLE_ID)
  assert.equal(submit[submit.indexOf('--password') + 1], credentials.APPLE_APP_SPECIFIC_PASSWORD)
  assert.equal(submit[submit.indexOf('--team-id') + 1], credentials.APPLE_TEAM_ID)
  assert.deepEqual(calls.slice(1).map(([, args]) => args.at(-1)), [file, file])
})

test('failed ticket validation blocks an otherwise Accepted and stapled DMG', async () => {
  await assert.rejects(notarizeDmg('release/MyHKU.dmg', {
    env: credentials,
    run: async (_command, args) => {
      if (args[0] === 'notarytool') return { stdout: JSON.stringify({ status: 'Accepted' }) }
      if (args[1] === 'validate') throw new Error('Ticket validation failed')
      return { stdout: '' }
    },
  }), /Ticket validation failed/)
})

test('non-mac packaging hooks and non-DMG artifacts require no Apple setup', async () => {
  for (const electronPlatformName of ['win32', 'linux']) {
    assert.doesNotThrow(() => beforePack({ electronPlatformName }))
    await afterSign({ electronPlatformName })
  }
  for (const file of [undefined, 'MyHKU.zip', 'MyHKU.exe', 'MyHKU.dmg.blockmap', 'latest-mac.yml']) {
    await artifactBuildCompleted({ file })
  }
})

test('DMG hook blocks configurations that would produce stale pre-staple update metadata', async () => {
  for (const dmg of [undefined, {}, { writeUpdateInfo: true }]) {
    await assert.rejects(artifactBuildCompleted({
      file: 'release/MyHKU.dmg',
      packager: { config: { dmg } },
    }, { env: { MYHKU_MAC_NOTARIZE: '1' } }), /Disable dmg.writeUpdateInfo/)
  }
})

function macContext() {
  return {
    electronPlatformName: 'darwin',
    appOutDir: '/release/mac-arm64',
    packager: {
      appInfo: { productFilename: 'MyHKU' },
      platformSpecificBuildOptions: { identity: '-' },
      config: { mac: { identity: '-' }, dmg: { sign: false, writeUpdateInfo: false } },
    },
  }
}

test('macOS builds default to ad-hoc signing without any Apple credentials', () => {
  assert.equal(isNotarizedRelease({}), false)
  const context = macContext()
  beforePack(context, { env: {}, platform: 'darwin' })
  for (const mac of [context.packager.platformSpecificBuildOptions, context.packager.config.mac]) {
    assert.equal(mac.identity, '-')
    assert.equal(mac.forceCodeSigning, false)
    assert.equal(mac.hardenedRuntime, false)
    assert.equal(mac.notarize, false)
  }
  assert.equal(context.packager.config.dmg.sign, false)
})

test('notarized mode requires credentials and replaces the default ad-hoc configuration', () => {
  assert.equal(isNotarizedRelease({ MYHKU_MAC_NOTARIZE: '1' }), true)
  assert.throws(() => beforePack(macContext(), { env: { MYHKU_MAC_NOTARIZE: '1' }, platform: 'darwin' }), /Missing:/)
  const context = macContext()
  beforePack(context, { env: { ...credentials, MYHKU_MAC_NOTARIZE: '1' }, platform: 'darwin' })
  for (const mac of [context.packager.platformSpecificBuildOptions, context.packager.config.mac]) {
    assert.equal(mac.identity, undefined)
    assert.equal(mac.forceCodeSigning, true)
    assert.equal(mac.hardenedRuntime, true)
    assert.equal(mac.notarize, true)
  }
  assert.equal(context.packager.config.dmg.sign, true)
  assert.equal(context.packager.config.dmg.writeUpdateInfo, false)
})

test('ad-hoc signing hook checks bundle integrity and skips unavailable Apple notarization tools', async () => {
  const calls = []
  await afterSign(macContext(), { env: {}, run: async (command, args) => {
    calls.push([command, args])
    return { stderr: 'Signature=adhoc\nTeamIdentifier=not set' }
  } })
  assert.equal(calls.length, 2)
  assert.ok(calls.every(([command]) => command === 'codesign'))
  assert.ok(calls[0][1].includes('--deep'))
  assert.ok(calls[0][1].includes('--strict'))
  await artifactBuildCompleted({ file: '/release/MyHKU.dmg' }, {
    env: {}, run: async () => assert.fail('An ad-hoc DMG must not be submitted to Apple'),
  })
})

test('signing preflight CLI succeeds without credentials by default and fails for incomplete notarized mode', () => {
  const script = fileURLToPath(new URL('./macos-release.mjs', import.meta.url))
  const env = { ...process.env }
  for (const name of Object.keys(credentials)) delete env[name]
  delete env.MYHKU_MAC_NOTARIZE
  const fallback = spawnSync(process.execPath, [script, '--check'], { env, encoding: 'utf8' })
  assert.equal(fallback.status, 0)
  assert.match(fallback.stdout, /ad-hoc signing selected/)
  const notarized = spawnSync(process.execPath, [script, '--check'], {
    env: { ...env, MYHKU_MAC_NOTARIZE: '1' }, encoding: 'utf8',
  })
  assert.equal(notarized.status, 1)
  assert.match(notarized.stderr, /Missing:/)
})
