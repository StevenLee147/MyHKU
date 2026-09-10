import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDirectories = ['src', 'bridge', 'desktop', 'extension', 'scripts', 'docs', '.github', 'android'];
const buildDirectories = ['dist', 'android/app/src/main/assets/dashboard-app'];
const excludedDirectories = new Set(['node_modules', '.git', '.myhku', '.gradle', 'build']);
const excludedFiles = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'gradlew', 'gradlew.bat']);
const textExtensions = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json', '.css', '.html', '.md',
  '.xml', '.kt', '.kts', '.properties', '.yml', '.yaml', '.toml', '.txt', '.map',
]);
const exampleDomains = new Set(['example.test', 'example.com']);

// Match complete literal addresses, so domain-only validation strings and npm
// scopes are allowed. Runtime data and dependency metadata are not inputs.
export function findPrivateEmailLines(content) {
  const address = /[A-Z0-9_][A-Z0-9._%+-]*@(?:[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?\.)+[A-Z]{2,63}/gi;
  const lines = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if ([...line.matchAll(address)].some(([match]) => !exampleDomains.has(match.split('@').at(-1).toLowerCase()))) {
      lines.push(index + 1);
    }
  }
  return lines;
}

function isTextFile(name) {
  return textExtensions.has(path.extname(name).toLowerCase()) ||
    ['.gitignore', '.gitattributes', '.env.example', '.npmrc', '.nvmrc'].includes(name);
}

async function directoryEntries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function scanPrivacy(root, { includeBuild = false, includeAndroidBuild = false } = {}) {
  const files = new Set();
  async function walk(relativeDirectory, generated = false) {
    for (const entry of await directoryEntries(path.join(root, relativeDirectory))) {
      const relative = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        if (excludedDirectories.has(entry.name) || relative === 'android/gradle') continue;
        if (!generated && buildDirectories.includes(relative)) continue;
        await walk(relative, generated);
      } else if (entry.isFile() && !excludedFiles.has(entry.name) && isTextFile(entry.name)) {
        files.add(relative);
      }
    }
  }
  for (const entry of await directoryEntries(root)) {
    if (entry.isFile() && !excludedFiles.has(entry.name) && isTextFile(entry.name)) files.add(entry.name);
  }
  for (const directory of sourceDirectories) await walk(directory);
  if (includeBuild) await walk('dist', true);
  if (includeAndroidBuild) await walk('android/app/src/main/assets/dashboard-app', true);

  const findings = [];
  for (const file of [...files].sort()) {
    for (const line of findPrivateEmailLines(await readFile(path.join(root, file), 'utf8'))) {
      findings.push({ file, line });
    }
  }
  return findings;
}

export async function main(args = process.argv.slice(2), root = process.cwd()) {
  if (args.some((argument) => !['--include-build', '--include-android-build'].includes(argument))) {
    console.error('Usage: node scripts/check-privacy.mjs [--include-build] [--include-android-build]');
    return 2;
  }
  const findings = await scanPrivacy(root, {
    includeBuild: args.includes('--include-build'),
    includeAndroidBuild: args.includes('--include-android-build'),
  });
  if (findings.length) {
    console.error('Privacy check failed: replace personal email literals with reserved example addresses.');
    for (const { file, line } of findings) console.error(`${file}:${line}`);
    return 1;
  }
  console.log('Privacy check passed.');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch {
    // Never echo file contents or an error payload into public release logs.
    console.error('Privacy check could not read its inputs.');
    process.exitCode = 1;
  }
}
