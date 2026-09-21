import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyAndroidRelease } from './verify-android-release.mjs'

const certificate = 'ab'.repeat(32)
const settings = { apk: 'app-release.apk', bundle: 'app-release.aab', sdk: '/fixture/sdk', version: '0.1.4-alpha', versionCode: 4, certificate }
function fixture(overrides = {}) {
  return (command, args) => {
    if (args.includes('apksigner.jar') || args.some(arg => arg.endsWith('apksigner.jar'))) {
      if (overrides.unsigned) throw new Error('DOES NOT VERIFY')
      return `Verified using v2 scheme (APK Signature Scheme v2): true\nNumber of signers: 1\nSigner #1 certificate SHA-256 digest: ${overrides.certificate || certificate}\n`
    }
    if (command.includes('zipalign')) return ''
    if (command.includes('aapt')) return overrides.metadata || "package: name='hk.my.myhku' versionCode='4' versionName='0.1.4-alpha'\nsdkVersion:'26'\ntargetSdkVersion:'35'\n"
    if (command.includes('jarsigner')) return overrides.bundle || 'jar verified.\n'
    if (command.includes('keytool')) return `SHA256: ${(overrides.bundleCertificate || certificate).match(/../g).join(':')}`
    throw new Error('Unexpected verifier command')
  }
}
test('validates the signed APK and bundle against the pinned identity and release version', () => {
  assert.deepEqual(verifyAndroidRelease(settings, fixture()), { packageName: 'hk.my.myhku', version: '0.1.4-alpha', versionCode: 4, certificate })
})
test('unsigned APKs and changed signing keys cannot be published', () => {
  assert.throws(() => verifyAndroidRelease(settings, fixture({ unsigned: true })), /DOES NOT VERIFY/)
  assert.throws(() => verifyAndroidRelease(settings, fixture({ certificate: 'cd'.repeat(32) })), /certificate changed/)
})
test('rejects wrong version, package, unsupported minimum Android version, and debug APKs', () => {
  const metadata = fixture()('aapt', [])
  for (const invalid of [metadata.replace("versionCode='4'", "versionCode='2'"), metadata.replace('hk.my.myhku', 'hk.my.myhku.debug'), metadata.replace("sdkVersion:'26'", "sdkVersion:'35'"), `${metadata}application-debuggable\n`]) {
    assert.throws(() => verifyAndroidRelease(settings, fixture({ metadata: invalid })), /package or version|non-debuggable/)
  }
})
test('unsigned or differently signed bundles cannot accompany the APK', () => {
  assert.throws(() => verifyAndroidRelease(settings, fixture({ bundle: 'jar is unsigned.' })), /Bundle is not signed/)
  assert.throws(() => verifyAndroidRelease(settings, fixture({ bundleCertificate: 'cd'.repeat(32) })), /certificates differ/)
})
