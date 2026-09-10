import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { findPrivateEmailLines, scanPrivacy } from './check-privacy.mjs';

const syntheticAddress = ['student', 'school.example.test'].join('@');

test('finds full literal addresses and reports each affected line once', () => {
  const content = `safe\r\n${syntheticAddress} ${syntheticAddress.toUpperCase()}\r\nsafe\nmailto:${syntheticAddress}`;
  assert.deepEqual(findPrivateEmailLines(content), [2, 4]);
});

test('allows exact reserved example domains, bare domains, npm scopes and CSS rules', () => {
  const content = [
    'student@example.test', 'STUDENT@EXAMPLE.COM',
    '@connect.hku.hk', '@hku.hk', '@school.example.test',
    "account.endsWith('@connect.hku.hk')", 'account.endsWith("@connect.hku.hk")',
    '@vitejs/plugin-react', '@types/react', '@media screen { }', '@font-face { }',
  ].join('\n');
  assert.deepEqual(findPrivateEmailLines(content), []);
});

async function fixture(t, entries) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'myhku-privacy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(entries)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  return root;
}

test('scans source, docs and config while excluding local data and dependencies', async (t) => {
  const root = await fixture(t, {
    'src/main.tsx': `placeholder\n${syntheticAddress}`,
    'docs/setup.md': syntheticAddress,
    '.env.example': syntheticAddress,
    '.github/workflows/release.yml': syntheticAddress,
    'android/app/src/main/java/MainActivity.kt': syntheticAddress,
    '.myhku/account.json': syntheticAddress,
    'User_Files/account.txt': syntheticAddress,
    'node_modules/dependency/index.js': syntheticAddress,
    'package-lock.json': syntheticAddress,
    'android/app/build/generated.js': syntheticAddress,
    'android/gradle/wrapper/metadata.properties': syntheticAddress,
  });
  assert.deepEqual(await scanPrivacy(root), [
    { file: '.env.example', line: 1 },
    { file: '.github/workflows/release.yml', line: 1 },
    { file: 'android/app/src/main/java/MainActivity.kt', line: 1 },
    { file: 'docs/setup.md', line: 1 },
    { file: 'src/main.tsx', line: 2 },
  ]);
});

test('optionally catches addresses embedded in both generated release asset trees', async (t) => {
  const root = await fixture(t, {
    'src/main.tsx': 'const domain = "@connect.hku.hk";',
    'dist/assets/index.js': `const account = "${syntheticAddress}";`,
    'android/app/src/main/assets/dashboard-app/assets/index.js': syntheticAddress,
  });
  assert.deepEqual(await scanPrivacy(root), []);
  assert.deepEqual(await scanPrivacy(root, { includeBuild: true }), [
    { file: 'dist/assets/index.js', line: 1 },
  ]);
  assert.deepEqual(await scanPrivacy(root, { includeBuild: true, includeAndroidBuild: true }), [
    { file: 'android/app/src/main/assets/dashboard-app/assets/index.js', line: 1 },
    { file: 'dist/assets/index.js', line: 1 },
  ]);
});

test('CLI fails without disclosing the email or source contents', async (t) => {
  const root = await fixture(t, { 'src/main.tsx': `private content: ${syntheticAddress}` });
  const script = fileURLToPath(new URL('./check-privacy.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /src\/main\.tsx:1/);
  assert.ok(!result.stderr.includes(syntheticAddress));
  assert.ok(!result.stderr.includes('private content'));
  assert.equal(result.stdout, '');
});
