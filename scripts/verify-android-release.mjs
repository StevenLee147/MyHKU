import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function verifyAndroidRelease({ apk, bundle, sdk, version, versionCode, certificate }, run = (command, args) => execFileSync(command, args, { encoding: 'utf8', windowsHide: true })) {
  if (!sdk || !version || !Number.isInteger(versionCode) || versionCode <= 0 || !/^[a-f\d]{64}$/i.test(certificate)) throw new Error('Android verification needs the SDK, version, versionCode and pinned signing certificate')
  const suffix = process.platform === 'win32' ? '.exe' : ''
  const javaTool = name => process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', `${name}${suffix}`) : `${name}${suffix}`
  const buildTools = join(sdk, 'build-tools', '35.0.0')
  const signature = run(javaTool('java'), ['-jar', join(buildTools, 'lib', 'apksigner.jar'), 'verify', '--verbose', '--print-certs', '--min-sdk-version', '26', apk])
  if (!/Verified using v2 scheme[^\r\n]*: true/.test(signature) || !/Number of signers: 1(?:\r?\n|$)/.test(signature)) throw new Error('APK must have one verified Android v2 signing identity')
  const actualCertificate = signature.match(/Signer #1 certificate SHA-256 digest:\s*([a-f\d]{64})/i)?.[1].toLowerCase()
  if (actualCertificate !== certificate.toLowerCase()) throw new Error('APK signing certificate changed; existing installations could not upgrade')
  run(join(buildTools, `zipalign${suffix}`), ['-c', '-P', '16', '4', apk])
  const metadata = run(join(buildTools, `aapt${suffix}`), ['dump', 'badging', apk])
  const identity = metadata.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m)
  if (!identity || identity[1] !== 'hk.my.myhku' || Number(identity[2]) !== versionCode || identity[3] !== version) throw new Error('APK package or version does not match this release')
  if (!/^sdkVersion:'26'$/m.test(metadata.replaceAll('\r', '')) || !/^targetSdkVersion:'35'$/m.test(metadata.replaceAll('\r', '')) || /application-debuggable/.test(metadata)) throw new Error('APK must be a non-debuggable Android 8.0+ release targeting API 35')
  const verifiedBundle = run(javaTool('jarsigner'), ['-J-Duser.language=en', '-J-Duser.country=US', '-verify', bundle])
  if (!/jar verified\./i.test(verifiedBundle)) throw new Error('Android App Bundle is not signed')
  const bundleCertificate = run(javaTool('keytool'), ['-J-Duser.language=en', '-printcert', '-jarfile', bundle]).match(/SHA256:\s*([a-f\d:]+)/i)?.[1].replaceAll(':', '').toLowerCase()
  if (bundleCertificate !== actualCertificate) throw new Error('APK and App Bundle signing certificates differ')
  return { packageName: identity[1], version, versionCode, certificate: actualCertificate }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [apk, bundle, code] = process.argv.slice(2)
    if (!apk || !bundle || !code) throw new Error('Usage: node scripts/verify-android-release.mjs <apk> <aab> <versionCode>')
    const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
    const certificate = readFileSync(new URL('../android/release-certificate.sha256', import.meta.url), 'utf8').trim()
    console.log(JSON.stringify(verifyAndroidRelease({ apk, bundle, version, versionCode: Number(code), certificate, sdk: process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT })))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
