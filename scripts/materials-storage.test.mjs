import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import {
  buildStableFileSignature,
  classifyBglisCategory,
  computeFileSha1,
  evaluateRemoteResourceUpdate,
  extractCourseFolderName,
  fileLinksFromHtml,
  probeMoodleResource,
  resolveCourseStorageDirectory,
  resolveMoodleDownloads,
  saveMoodleDownload,
  scanStorageDirectory,
} from '../desktop/downloads.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function loadTsModule(relPath) {
  const source = fs.readFileSync(path.join(root, relPath), 'utf8')
  const js = stripTypeScriptTypes(source)
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}

test('extractCourseFolderName and classifyBglisCategory align with BGLIS folder taxonomy', () => {
  assert.equal(extractCourseFolderName('GLIS1901-1A Foundations of Quantitative Analysis'), 'GLIS1901')
  assert.equal(extractCourseFolderName('CAES1001-1C3 Academic Communication'), 'CAES1001')
  assert.equal(extractCourseFolderName('CAES1001_1 Academic Communication in English [2026]'), 'CAES1001')
  assert.equal(extractCourseFolderName('GLIS1901_1A_2026 Foundations of Global Studies'), 'GLIS1901')
  assert.equal(extractCourseFolderName('CAES9920-1R Academic English'), 'CAES9920')
  assert.equal(extractCourseFolderName('GLIS1903 Foundations of Economics'), 'GLIS1903')

  assert.equal(classifyBglisCategory('GLIS1901 Syllabus.pdf'), 'Course Information')
  assert.equal(classifyBglisCategory('GLIS1901 Tentative Semester Calendar (Sept 6).pdf'), 'Course Information')
  assert.equal(classifyBglisCategory('Week-01 Lecture Notes.pdf'), 'Lecture Notes')
  assert.equal(classifyBglisCategory('GLIS1903 Lesson 1-1.pptx'), 'Lecture Slides')
  assert.equal(classifyBglisCategory('Week-03 Annotated Slides.pdf'), 'Annotated Slides')
  assert.equal(classifyBglisCategory('Week-02 Tutorial Handout.pdf'), 'Tutorials')
  assert.equal(classifyBglisCategory('Week-01 Python Lab.py'), 'Python Labs')
  assert.equal(classifyBglisCategory('GLIS1901 Assignment Guide.pdf'), 'Assignments')
  assert.equal(classifyBglisCategory('Oct21_Aristotle_Zhuangzi_Study_Guide.pdf'), 'Study_Guides')
  assert.equal(classifyBglisCategory('Midterm Mock Exam 2026.pdf'), 'Mock Exam')
  assert.equal(classifyBglisCategory('Chapter 4 Question Bank.pdf'), 'Quiz Review')
  assert.equal(classifyBglisCategory('Week 5 Seminar Reading.pdf'), 'Seminar')
  assert.equal(classifyBglisCategory('Final Project Guidelines.pdf'), 'Final Project')
})

test('resolveCourseStorageDirectory reuses existing singular/synonym subfolders and scanStorageDirectory matches files', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'myhku-bglis-scan-'))
  try {
    // GLIS1903 uses singular 'Tutorial' and 'Lecture Slides'
    fs.mkdirSync(path.join(tmpRoot, 'GLIS1903', 'Tutorial'), { recursive: true })
    fs.mkdirSync(path.join(tmpRoot, 'GLIS1903', 'Lecture Slides'), { recursive: true })
    fs.writeFileSync(path.join(tmpRoot, 'GLIS1903', 'Tutorial', 'GLIS1903 Tutorial 1 Handout.pdf'), 'tut1')
    fs.writeFileSync(path.join(tmpRoot, 'GLIS1903', 'Lecture Slides', 'GLIS1903 Lesson 1-1.pptx'), 'slides1')

    // GLIS1901 uses 'Lecture Notes' and 'Tutorials'
    fs.mkdirSync(path.join(tmpRoot, 'GLIS1901', 'Lecture Notes'), { recursive: true })
    fs.writeFileSync(path.join(tmpRoot, 'GLIS1901', 'Lecture Notes', 'Week-01 Lecture Notes.pdf'), 'notes1')

    const resolvedTut = resolveCourseStorageDirectory(tmpRoot, {
      course: 'GLIS1903-1A Foundations of Economics',
      title: 'Tutorial 2 Handout',
      filename: 'GLIS1903 Tutorial 2 Handout.pdf',
      organizeMode: 'bglis',
    })
    assert.equal(resolvedTut.categoryFolder, 'Tutorial', 'reuses existing singular Tutorial folder in GLIS1903')
    assert.equal(resolvedTut.targetDir, path.join(tmpRoot, 'GLIS1903', 'Tutorial'))

    const resolvedSlidesInNotesCourse = resolveCourseStorageDirectory(tmpRoot, {
      course: 'GLIS1901-1A',
      title: 'Week-02 Lecture Slides',
      filename: 'Week-02 Lecture Slides.pptx',
      organizeMode: 'bglis',
    })
    assert.equal(resolvedSlidesInNotesCourse.categoryFolder, 'Lecture Notes', 'reuses Lecture Notes when Lecture Slides does not exist')

    const scanned = await scanStorageDirectory(tmpRoot)
    assert.equal(scanned.exists, true)
    assert.deepEqual(scanned.courses, ['GLIS1901', 'GLIS1903'])
    assert.equal(scanned.files.length, 3)

    const { matchResourceToLocalFile } = await loadTsModule('src/services/materials.ts')
    const hit1 = matchResourceToLocalFile(
      { id: '101', title: 'Week 1 Lecture Notes (PDF)', course: 'GLIS1901 Foundations' },
      scanned.files,
    )
    assert.ok(hit1, 'matches Week 1 Lecture Notes (PDF) to Week-01 Lecture Notes.pdf')
    assert.equal(hit1.courseFolder, 'GLIS1901')

    const hit2 = matchResourceToLocalFile(
      { id: '102', title: 'Tutorial 1 Handout', course: 'GLIS1903 Economics' },
      scanned.files,
    )
    assert.ok(hit2, 'matches title without course prefix to local file with GLIS1903 prefix')
    assert.equal(hit2.categoryFolder, 'Tutorial')
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
})

test('probeMoodleResource detects revision metadata and saveMoodleDownload supports BGLIS archive + atomic replace', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'myhku-bglis-dl-'))
  try {
    let currentRevision = 1
    let currentPayload = 'Version 1 PDF bytes'
    const resourceUrl = 'https://moodle.hku.hk/mod/resource/view.php?id=555'
    const fetchPage = async target => {
      if (target.startsWith(resourceUrl)) {
        return {
          status: 303,
          ok: false,
          headers: new Headers({
            location: `https://moodle.hku.hk/pluginfile.php/99/mod_resource/content/${currentRevision}/Week-05%20Lecture%20Notes.pdf`,
          }),
          body: { cancel: async () => {} },
        }
      }
      const bytes = Buffer.from(currentPayload, 'utf8')
      return {
        status: 200,
        ok: true,
        url: target,
        headers: new Headers({
          'content-type': 'application/pdf',
          'content-length': String(bytes.length),
          etag: `"rev-${currentRevision}"`,
          'last-modified': currentRevision === 1 ? 'Mon, 02 Nov 2026 08:00:00 GMT' : 'Mon, 23 Nov 2026 08:00:00 GMT',
        }),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(bytes)
            controller.close()
          },
        }),
      }
    }

    const probeV1 = await probeMoodleResource(resourceUrl, fetchPage, async () => [])
    assert.equal(probeV1.files[0].revision, 1)
    assert.equal(probeV1.files[0].filename, 'Week-05 Lecture Notes.pdf')

    const savedV1 = await saveMoodleDownload(resourceUrl, tmpRoot, fetchPage, {
      course: 'GLIS1901-1A',
      title: 'Week-05 Lecture Notes',
      organizeMode: 'bglis',
      returnDetailed: true,
    })
    const expectedPath = path.join(tmpRoot, 'GLIS1901', 'Lecture Notes', 'Week-05 Lecture Notes.pdf')
    assert.equal(savedV1.path, expectedPath)
    assert.equal(fs.readFileSync(expectedPath, 'utf8'), 'Version 1 PDF bytes')

    // Remote file is updated on Moodle to revision 2
    currentRevision = 2
    currentPayload = 'Version 2 UPDATED PDF bytes with extra appendix'
    const probeV2 = await probeMoodleResource(resourceUrl, fetchPage, async () => [])
    assert.equal(probeV2.files[0].revision, 2)
    assert.notEqual(probeV2.signature, probeV1.signature)

    // Atomic replaceExisting overwrites the exact file in-place without (1) suffix
    const savedV2 = await saveMoodleDownload(resourceUrl, tmpRoot, fetchPage, {
      course: 'GLIS1901-1A',
      title: 'Week-05 Lecture Notes',
      organizeMode: 'bglis',
      replaceExisting: true,
      targetFilePath: expectedPath,
      returnDetailed: true,
    })
    assert.equal(savedV2.path, expectedPath)
    assert.equal(fs.readFileSync(expectedPath, 'utf8'), 'Version 2 UPDATED PDF bytes with extra appendix')
    assert.equal(fs.existsSync(path.join(tmpRoot, 'GLIS1901', 'Lecture Notes', 'Week-05 Lecture Notes (1).pdf')), false)
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
})

test('evaluateResourceSnapshotDiff, mergeRemoteUpdateProbes, and notifications detect new and updated materials', async () => {
  const storage = new Map()
  globalThis.localStorage = {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, val) => storage.set(key, String(val)),
    removeItem: key => storage.delete(key),
  }
  try {
    const { evaluateResourceSnapshotDiff, mergeRemoteUpdateProbes, markResourceSynced } = await loadTsModule('src/services/materials.ts')
    const { evaluateSnapshotNotifications } = await loadTsModule('src/services/notifications.ts')

    const baseResources = [
      { id: 'r1', title: 'Week-01 Lecture Notes', course: 'GLIS1901', url: 'https://moodle.hku.hk/mod/resource/view.php?id=1' },
      { id: 'r2', title: 'Tutorial 1 Handout', course: 'GLIS1903', url: 'https://moodle.hku.hk/mod/resource/view.php?id=2' },
    ]
    const first = evaluateResourceSnapshotDiff(baseResources)
    assert.equal(first.newIds.size, 0, 'baseline sync does not flood NEW badges')
    assert.equal(Object.keys(first.updatedMap).length, 0)

    // Next sync: r1 title revised + r3 newly uploaded
    const nextResources = [
      { id: 'r1', title: 'Week-01 Lecture Notes (Revised Nov 23)', course: 'GLIS1901', url: 'https://moodle.hku.hk/mod/resource/view.php?id=1' },
      { id: 'r2', title: 'Tutorial 1 Handout', course: 'GLIS1903', url: 'https://moodle.hku.hk/mod/resource/view.php?id=2' },
      { id: 'r3', title: 'Week-02 Lecture Notes', course: 'GLIS1901', url: 'https://moodle.hku.hk/mod/resource/view.php?id=3' },
    ]
    const second = evaluateResourceSnapshotDiff(nextResources)
    assert.equal(second.newIds.has('r3'), true, 'r3 detected as NEW')
    assert.ok(second.updatedMap.r1, 'r1 detected as UPDATED due to revised title')

    // Remote probe detects binary update on r2 even when title/URL stayed identical
    const afterProbe = mergeRemoteUpdateProbes({
      r2: { signature: 'sig-v2', hasRemoteUpdate: true, reason: 'Moodle 远端文件已升级至第 2 版', checkedAt: '2026-11-23T08:00:00Z' },
    })
    assert.ok(afterProbe.r2, 'r2 marked UPDATED from remote probe')

    // Downloading/syncing clears both NEW and UPDATED states
    const afterSyncR1 = markResourceSynced('r1', 'sig-r1-v2')
    assert.equal(afterSyncR1.updatedMap.r1, undefined)
    const afterSyncR3 = markResourceSynced('r3', 'sig-r3-v1')
    assert.equal(afterSyncR3.newIds.has('r3'), false)

    // Verify notification feed integration
    const snapBase = { fetchedAt: '2026-11-23T07:00:00Z', schedule: [], courses: [], assignments: [], resources: baseResources, grades: [], announcements: [] }
    evaluateSnapshotNotifications(snapBase)
    const snapNext = { ...snapBase, fetchedAt: '2026-11-23T08:00:00Z', resources: nextResources }
    const alerts = evaluateSnapshotNotifications(snapNext)
    assert.equal(alerts.some(a => a.title === '新增课程资料' && a.target === 'materials'), true)
    assert.equal(alerts.some(a => a.title === '课程资料有更新' && a.target === 'materials'), true)

    // Regression: when remote probe confirms up-to-date, stale remote update flags are cleared
    const clearedProbe = mergeRemoteUpdateProbes({
      r2: { signature: 'sig-v2', hasRemoteUpdate: false, checkedAt: '2026-11-25T02:00:00Z' },
    })
    assert.equal(clearedProbe.r2, undefined, 'up-to-date remote probe clears stale updated flag')

    // Regression: Moodle screen-reader suffix (.accesshide " File") must not trigger false title update
    const accesshideCheck = evaluateResourceSnapshotDiff([
      { id: 'r2', title: 'Tutorial 1 Handout File', course: 'GLIS1903', url: 'https://moodle.hku.hk/mod/resource/view.php?id=2&redirect=1' },
    ])
    assert.equal(accesshideCheck.updatedMap.r2, undefined, 'trailing Moodle File suffix and redirect param do not trigger false update')
  } finally {
    delete globalThis.localStorage
  }
})

test('regression: compressed Content-Length drift, legacy signatures, cross-course isolation, and redirect=1 fallback', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'myhku-regression-'))
  try {
    const pdfContent = Buffer.from('Just downloaded lecture PDF content v1', 'utf8')
    const pdfSha1 = crypto.createHash('sha1').update(pdfContent).digest('hex')
    const filePath = path.join(tmpRoot, 'GLIS1901', 'Lecture Notes', 'Syllabus.pdf')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, pdfContent)

    // 1. Strict course isolation: GLIS1908 Syllabus must NOT match GLIS1901/Lecture Notes/Syllabus.pdf
    const scanned = await scanStorageDirectory(tmpRoot)
    const { matchResourceToLocalFile } = await loadTsModule('src/services/materials.ts')
    const wrongCourseHit = matchResourceToLocalFile(
      { id: '908', title: 'Syllabus', course: 'GLIS1908 Global Seminar' },
      scanned.files,
    )
    assert.equal(wrongCourseHit, undefined, 'never matches local file from another course folder')

    const wrongExtHit = matchResourceToLocalFile(
      { id: '909', title: 'Syllabus.pptx', course: 'GLIS1901 Foundations' },
      scanned.files,
    )
    assert.equal(wrongExtHit, undefined, 'never matches .pptx resource against .pdf local file')

    // 2. Stable signature ignores omitted vs synthesized Content-Length when ETag/Last-Modified match
    const sigChunked = buildStableFileSignature({
      canonicalUrl: 'https://moodle.hku.hk/pluginfile.php/10/mod_resource/content/1/Syllabus.pdf',
      etag: `"${pdfSha1}"`,
      lastModified: 'Thu, 29 Oct 2026 06:43:37 GMT',
      uncompressedLength: undefined,
    })
    const sigCached = buildStableFileSignature({
      canonicalUrl: 'https://moodle.hku.hk/pluginfile.php/10/mod_resource/content/1/Syllabus.pdf',
      etag: `W/"${pdfSha1}"`,
      lastModified: 'Thu, 29 Oct 2026 06:43:37 GMT',
      uncompressedLength: pdfContent.length,
    })
    assert.equal(sigChunked, sigCached, 'signature stays identical across chunked network download and disk-cache hit')

    // 3. Legacy 4-part signature (trailing empty contentLength) does not false-positive on subsequent probe
    const legacySavedMeta = {
      signature: `https://moodle.hku.hk/pluginfile.php/10/mod_resource/content/1/Syllabus.pdf|"${pdfSha1}"|Thu, 29 Oct 2026 06:43:37 GMT|`,
    }
    const probeCached = {
      files: [{
        canonicalUrl: 'https://moodle.hku.hk/pluginfile.php/10/mod_resource/content/1/Syllabus.pdf',
        revision: 1,
        etag: `"${pdfSha1}"`,
        cleanEtag: pdfSha1,
        lastModified: 'Thu, 29 Oct 2026 06:43:37 GMT',
        contentLength: pdfContent.length,
        isIdentityEncoding: true,
      }],
    }
    assert.equal(evaluateRemoteResourceUpdate({ probe: probeCached, savedMeta: legacySavedMeta }).hasRemoteUpdate, false)

    // 4. Pre-existing / annotated local file newer than remote Last-Modified or matching SHA-1 ETag is NOT flagged
    const localStat = fs.statSync(filePath)
    const sha1Calculated = await computeFileSha1(filePath)
    assert.equal(sha1Calculated, pdfSha1)
    const preExistingCheck = evaluateRemoteResourceUpdate({
      probe: {
        files: [{
          canonicalUrl: 'https://moodle.hku.hk/pluginfile.php/10/mod_resource/content/1/Syllabus.pdf',
          etag: '"different-pathname-etag"',
          cleanEtag: 'different-pathname-etag',
          lastModified: 'Thu, 29 Oct 2026 06:43:37 GMT',
          contentLength: 123, // e.g. gzipped or user annotated PDF
          isIdentityEncoding: false,
        }],
      },
      savedMeta: undefined,
      localFile: { path: filePath, size: localStat.size, mtimeMs: Date.parse('2026-11-25T01:24:10Z') },
    })
    assert.equal(preExistingCheck.hasRemoteUpdate, false, 'recently downloaded or annotated local file is never falsely flagged outdated')

    // 5. Genuine newer upload on Moodle IS flagged accurately
    const genuineNewerCheck = evaluateRemoteResourceUpdate({
      probe: {
        files: [{
          canonicalUrl: 'https://moodle.hku.hk/pluginfile.php/10/mod_resource/content/1/Syllabus.pdf',
          etag: '"new-etag"',
          cleanEtag: 'new-etag',
          lastModified: 'Wed, 25 Nov 2026 08:00:00 GMT',
          contentLength: 999,
          isIdentityEncoding: true,
        }],
      },
      savedMeta: undefined,
      localFile: { path: filePath, size: localStat.size, mtimeMs: Date.parse('2026-11-10T01:00:00Z') },
    })
    assert.equal(genuineNewerCheck.hasRemoteUpdate, true)

    // 6. Popup/workaround mod/resource/view.php retries with ?redirect=1 and resolves target file
    const popupResource = 'https://moodle.hku.hk/mod/resource/view.php?id=888'
    const directPdf = 'https://moodle.hku.hk/pluginfile.php/88/mod_resource/content/1/%E7%AC%AC1%E5%91%A8%E8%AE%B2%E4%B9%89.pdf'
    const resolvedPopup = await resolveMoodleDownloads(
      popupResource,
      async target => {
        if (target === popupResource) {
          return {
            status: 200,
            ok: true,
            url: popupResource,
            headers: new Headers({ 'content-type': 'text/html' }),
            text: async () => '<div id="region-main"><p>Popup window workaround</p></div>',
          }
        }
        if (target === `${popupResource}&redirect=1`) {
          return { status: 303, ok: false, headers: new Headers({ location: directPdf }), body: { cancel: async () => {} } }
        }
        return {
          status: 200,
          ok: true,
          url: directPdf,
          headers: new Headers({ 'content-type': 'application/pdf' }),
          body: { cancel: async () => {} },
        }
      },
      async () => [],
    )
    assert.deepEqual(resolvedPopup, [directPdf], 'Popup workaround page automatically resolves via redirect=1')
    void fileLinksFromHtml
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
})
