import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const requiredSecrets = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']

export function isNotarizedRelease(env = process.env) {
  return env.MYHKU_MAC_NOTARIZE === '1'
}

export function checkSigningEnvironment(env = process.env) {
  const missing = requiredSecrets.filter(name => !env[name]?.trim())
  if (missing.length) {
    throw new Error(`macOS release signing is required. Missing: ${missing.join(', ')}. See docs/macos-release.md.`)
  }
  if (env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') {
    throw new Error('macOS release signing cannot disable CSC_IDENTITY_AUTO_DISCOVERY.')
  }
}

export function beforePack(context, { env = process.env, platform = process.platform } = {}) {
  if (context.electronPlatformName !== 'darwin') return
  if (platform !== 'darwin') throw new Error('Build macOS releases on a macOS runner.')
  const notarized = isNotarizedRelease(env)
  if (notarized) checkSigningEnvironment(env)
  const mac = context.packager.platformSpecificBuildOptions
  if (notarized && mac.identity === null) {
    throw new Error('A notarized macOS release cannot disable its Developer ID signing identity.')
  }
  // Ad-hoc signing seals the rebuilt Electron bundle, including arm64 binaries,
  // without claiming Developer ID trust or requiring Apple credentials.
  const settings = {
    type: 'distribution',
    identity: notarized ? (mac.identity === '-' ? undefined : mac.identity) : '-',
    forceCodeSigning: notarized,
    hardenedRuntime: notarized,
    notarize: notarized,
  }
  Object.assign(mac, settings)
  Object.assign(context.packager.config.mac, settings)
  // Mutate the existing DMG options because the target retains this object.
  Object.assign(context.packager.config.dmg, { sign: notarized, writeUpdateInfo: false })
}

export async function afterSign(context, { env = process.env, run } = {}) {
  if (context.electronPlatformName !== 'darwin') return
  // Check the rebuilt bundle before ZIP/DMG creation. In notarized mode,
  // electron-builder also staples the app before this hook runs.
  const { verifyApp } = await import('./verify-macos-release.mjs')
  await verifyApp(path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`), run, {
    notarized: isNotarizedRelease(env),
  })
}

async function runAppleTool(command, args) {
  try {
    return await execFileAsync(command, args, { timeout: 35 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 })
  } catch {
    // execFile errors contain the complete command, including credentials.
    throw new Error(`${command} ${args[0]} failed. Check Apple credentials, service availability, and the signing configuration.`)
  }
}

export async function notarizeDmg(file, { env = process.env, run = runAppleTool } = {}) {
  checkSigningEnvironment(env)
  const { stdout } = await run('xcrun', [
    'notarytool', 'submit', path.resolve(file),
    '--apple-id', env.APPLE_ID,
    '--password', env.APPLE_APP_SPECIFIC_PASSWORD,
    '--team-id', env.APPLE_TEAM_ID,
    '--wait', '--timeout', '30m', '--output-format', 'json',
  ])
  let result
  try { result = JSON.parse(stdout) } catch { throw new Error('Apple notarization returned an invalid response; release blocked.') }
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Apple notarization returned an invalid response; release blocked.')
  }
  if (result.status !== 'Accepted') {
    // Keep diagnostics useful without echoing the command or authentication.
    const id = /^[\da-f-]{36}$/i.test(result.id || '') ? ` (submission ${result.id})` : ''
    throw new Error(`Apple did not accept the DMG notarization${id}; release blocked. Inspect this submission with notarytool log.`)
  }
  // Tickets can take a short time to propagate after Apple accepts a submission.
  let stapled = false
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await run('xcrun', ['stapler', 'staple', '-v', path.resolve(file)])
      stapled = true
      break
    } catch (error) {
      if (attempt === 2) throw error
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
  }
  if (stapled) await run('xcrun', ['stapler', 'validate', '-v', path.resolve(file)])
}

export async function artifactBuildCompleted(event, { env = process.env, run } = {}) {
  if (!event.file?.endsWith('.dmg') || !isNotarizedRelease(env)) return
  // Stapling changes the DMG bytes. dmg.writeUpdateInfo=false prevents stale
  // pre-staple blockmaps/hashes; macOS updater metadata continues to use ZIP.
  // This hook finishes before electron-builder hands the DMG to a publisher.
  if (event.packager.config.dmg?.writeUpdateInfo !== false) {
    throw new Error('Disable dmg.writeUpdateInfo before notarizing the final DMG.')
  }
  console.log(`Notarizing DMG: ${path.basename(event.file)}`)
  await notarizeDmg(event.file, { env, run })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== '--check') throw new Error('Usage: node scripts/macos-release.mjs --check')
    if (isNotarizedRelease()) {
      checkSigningEnvironment()
      console.log('macOS Developer ID signing and notarization selected; credentials are present.')
    } else {
      console.log('macOS ad-hoc signing selected; no Apple credentials are required. First launch needs the README installation steps.')
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
