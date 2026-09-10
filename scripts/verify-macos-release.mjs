import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

async function runCommand(command, args) {
  try {
    return await execFileAsync(command, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  } catch (error) {
    throw new Error(`${command} failed: ${error.stderr || error.stdout || error.message}`, { cause: error })
  }
}

function output(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`
}

async function verifySignature(target, { app, run, notarized }) {
  await run('codesign', ['--verify', ...(app ? ['--deep'] : []), '--strict', '--verbose=4', target])
  const details = output(await run('codesign', ['--display', '--verbose=4', target]))
  if (!notarized) {
    if (!/^Signature=adhoc$/m.test(details)) throw new Error(`An ad-hoc application signature is required: ${target}`)
    return
  }
  if (!/^Authority=Developer ID Application: .+$/m.test(details)
    || !/^TeamIdentifier=[A-Z0-9]{10}$/m.test(details)) {
    throw new Error(`A Developer ID Application signature is required: ${target}`)
  }
  if (app && !/\bflags=0x[\da-f]+\([^\r\n)]*\bruntime\b/i.test(details)) {
    throw new Error(`Hardened runtime is required: ${target}`)
  }
  if (app && !/^Timestamp=.+$/m.test(details)) {
    throw new Error(`A secure signing timestamp is required: ${target}`)
  }
}

async function verifyGatekeeper(target, { app, run }) {
  const args = ['--assess', '--type', app ? 'execute' : 'open', '--verbose=4']
  if (!app) args.push('--context', 'context:primary-signature')
  const assessment = output(await run('spctl', [...args, target]))
  if (!/\baccepted\s*$/m.test(assessment) || !/^source=Notarized Developer ID\s*$/m.test(assessment)) {
    throw new Error(`Gatekeeper must accept the notarized Developer ID artifact: ${target}\n${assessment.trim()}`)
  }
}

export async function verifyApp(app, run = runCommand, { notarized = process.env.MYHKU_MAC_NOTARIZE === '1' } = {}) {
  await verifySignature(app, { app: true, run, notarized })
  if (notarized) {
    await run('xcrun', ['stapler', 'validate', app])
    await verifyGatekeeper(app, { app: true, run })
  }
}

async function verifyApplication(directory, run, notarized) {
  // Do not follow the DMG's /Applications symlink or descend into nested helper apps.
  const entries = await readdir(directory, { withFileTypes: true })
  const apps = entries.filter(entry => entry.isDirectory() && entry.name.endsWith('.app'))
  if (apps.length !== 1) {
    throw new Error(`Expected exactly one application bundle in ${directory}; found ${apps.length}`)
  }
  await verifyApp(path.join(directory, apps[0].name), run, { notarized })
}

async function verifyDmg(artifact, run, notarized) {
  await run('hdiutil', ['verify', artifact])
  if (notarized) {
    await verifySignature(artifact, { app: false, run, notarized })
    await run('xcrun', ['stapler', 'validate', artifact])
    await verifyGatekeeper(artifact, { app: false, run })
  }

  const temporary = await mkdtemp(path.join(os.tmpdir(), 'myhku-verify-dmg-'))
  const mountpoint = path.join(temporary, 'mounted')
  let attached = false
  let attachAttempted = false
  let safeToRemove = true
  try {
    await mkdir(mountpoint)
    attachAttempted = true
    await run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mountpoint, artifact])
    attached = true
    await verifyApplication(mountpoint, run, notarized)
  } finally {
    if (attachAttempted) safeToRemove = false
    try {
      // A failed attach can still leave a volume mounted. Check its device before cleanup.
      const mounted = attached || (attachAttempted && (await stat(mountpoint)).dev !== (await stat(temporary)).dev)
      if (mounted) {
        try {
          await run('hdiutil', ['detach', mountpoint])
        } catch {
          await run('hdiutil', ['detach', '-force', mountpoint])
        }
      }
      safeToRemove = true
    } finally {
      // Never recursively remove a volume if both detach attempts failed.
      if (safeToRemove) await rm(temporary, { recursive: true, force: true })
    }
  }
}

async function verifyZip(artifact, run, notarized) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'myhku-verify-zip-'))
  try {
    // ditto preserves the bundle metadata and stapled ticket present in the shipped ZIP.
    await run('ditto', ['-x', '-k', artifact, temporary])
    await verifyApplication(temporary, run, notarized)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

export async function verifyMacosRelease({ artifactsDir, platform = process.platform, run = runCommand, notarized = process.env.MYHKU_MAC_NOTARIZE === '1' }) {
  if (platform !== 'darwin') throw new Error('macOS release verification must run on macOS.')
  if (!artifactsDir) throw new Error('An explicit macOS artifacts directory is required.')
  const directory = path.resolve(artifactsDir)
  const entries = await readdir(directory, { withFileTypes: true })
  const artifacts = entries.filter(entry => entry.isFile() && /\.(dmg|zip)$/i.test(entry.name))
    .map(entry => path.join(directory, entry.name)).sort()
  for (const extension of ['.dmg', '.zip']) {
    if (!artifacts.some(artifact => path.extname(artifact).toLowerCase() === extension)) {
      throw new Error(`Missing required macOS ${extension} artifact in ${directory}`)
    }
  }
  for (const artifact of artifacts) {
    try {
      if (path.extname(artifact).toLowerCase() === '.dmg') await verifyDmg(artifact, run, notarized)
      else await verifyZip(artifact, run, notarized)
    } catch (error) {
      throw new Error(`macOS release verification failed for ${path.basename(artifact)}: ${error.message}`, { cause: error })
    }
  }
  return artifacts
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2].startsWith('-')) {
    console.error('Usage: node scripts/verify-macos-release.mjs <artifacts-directory>')
    process.exitCode = 1
  } else {
    try {
      const artifacts = await verifyMacosRelease({ artifactsDir: process.argv[2] })
      console.log(process.env.MYHKU_MAC_NOTARIZE === '1'
        ? `Verified ${artifacts.length} macOS release artifacts: Developer ID signatures, notarization tickets, and Gatekeeper acceptance.`
        : `Verified ${artifacts.length} macOS release artifacts: archive integrity and ad-hoc app signatures. These builds are not Apple-notarized; follow the README for first launch.`)
    } catch (error) {
      console.error(error.message)
      process.exitCode = 1
    }
  }
}
