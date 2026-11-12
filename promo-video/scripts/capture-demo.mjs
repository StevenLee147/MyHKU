import { openBrowser } from "@remotion/renderer";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const url = process.env.MYHKU_CAPTURE_URL || "http://127.0.0.1:5178";

const browser = await openBrowser("chrome");
const page = await browser.newPage({
  context: null,
  logLevel: "error",
  indent: false,
  pageIndex: 0,
  onBrowserLog: null,
  onLog: () => {},
});
await page.setViewport({ width: 1440, height: 940, deviceScaleFactor: 1 });
{
  const client = page._client();
  const captures = resolve(root, "public", "captures");
  await mkdir(captures, { recursive: true });
  await client.send("Network.enable");
  await client.send("Network.setBlockedURLs", {
    urls: ["*://*.hku.hk/*", "*://127.0.0.1:17321/*"],
  });
  const agreements = JSON.parse(
    await readFile(
      new URL("../../public/legal/agreements.json", import.meta.url),
      "utf8",
    ),
  );
  const fixture = {
    fetchedAt: "2026-10-26T01:00:00.000Z",
    scheduleWeek: { start: "2026-10-26", end: "2026-11-01" },
    schedule: [
      {
        id: "s1",
        title: "数据科学导论",
        code: "COMP7901",
        date: "2026-10-26",
        start: "09:30",
        end: "11:20",
        room: "KB 419",
        teacher: "示例教师",
      },
      {
        id: "s2",
        title: "计算机系统原理",
        code: "COMP7801",
        date: "2026-10-26",
        start: "14:30",
        end: "16:20",
        room: "CYM LT",
        teacher: "示例教师",
      },
      {
        id: "s3",
        title: "信息与社会",
        code: "COMP7103",
        date: "2026-10-27",
        start: "10:30",
        end: "12:20",
        room: "MB 113",
        teacher: "示例教师",
      },
      {
        id: "s4",
        title: "数据科学导论",
        code: "COMP7901",
        date: "2026-10-28",
        start: "09:30",
        end: "11:20",
        room: "KB 419",
        teacher: "示例教师",
      },
      {
        id: "s5",
        title: "信息与社会",
        code: "COMP7103",
        date: "2026-10-29",
        start: "13:30",
        end: "15:20",
        room: "MB 113",
        teacher: "示例教师",
      },
      {
        id: "s6",
        title: "计算机系统原理",
        code: "COMP7801",
        date: "2026-10-30",
        start: "11:30",
        end: "13:20",
        room: "CYM LT",
        teacher: "示例教师",
      },
    ],
    courses: [
      { id: "c1", title: "数据科学导论", code: "COMP7901" },
      { id: "c2", title: "计算机系统原理", code: "COMP7801" },
      { id: "c3", title: "信息与社会", code: "COMP7103" },
    ],
    assignments: [
      {
        id: "a1",
        title: "Assignment 2 · 数据分析",
        course: "COMP7901",
        due: "今天 23:59",
        completed: false,
        submissionStatus: "未提交",
      },
      {
        id: "a2",
        title: "Reading response · Week 4",
        course: "COMP7801",
        due: "明天 18:00",
        completed: false,
        submissionStatus: "未提交",
      },
      {
        id: "a3",
        title: "小组项目分工确认",
        course: "COMP7103",
        due: "周五 17:00",
        completed: true,
        submissionStatus: "已提交",
      },
    ],
    resources: [
      {
        id: "r1",
        title: "Week 04 · Lecture slides.pdf",
        course: "COMP7901 · 数据科学导论",
        url: "https://moodle.hku.hk/mod/resource/view.php?id=900001",
      },
      {
        id: "r2",
        title: "Assignment 2 · Brief.pdf",
        course: "COMP7901 · 数据科学导论",
        url: "https://moodle.hku.hk/mod/resource/view.php?id=900002",
      },
      {
        id: "r3",
        title: "Week 04 · Reading list.pdf",
        course: "COMP7801 · 计算机系统原理",
        url: "https://moodle.hku.hk/mod/resource/view.php?id=900003",
      },
      {
        id: "r4",
        title: "Project · Guidelines.pdf",
        course: "COMP7103 · 信息与社会",
        url: "https://moodle.hku.hk/mod/resource/view.php?id=900004",
      },
    ],
    grades: [
      {
        id: "g1",
        title: "Assignment 1",
        course: "COMP7901",
        value: "86 / 100",
        released: true,
      },
    ],
    announcements: [
      {
        id: "n1",
        title: "Week 04 · Course materials are ready",
        course: "COMP7901",
        published: "10月26日",
      },
      {
        id: "n2",
        title: "Tutorial · Updated room information",
        course: "COMP7801",
        published: "10月25日",
      },
    ],
  };
  const run = (code) => page.evaluate(code);
  const settle = async () => {
    await run(`document.fonts.ready`);
    await new Promise((resolve) => setTimeout(resolve, 180));
  };
  const capture = async (name) => {
    await settle();
    const image = await client.send("Page.captureScreenshot", {
      format: "png",
    });
    await writeFile(
      join(captures, name + ".png"),
      Buffer.from(image.value.data, "base64"),
    );
    console.log(`Captured ${name}`);
  };
  const navigate = async (text) => {
    await run(
      `Array.from(document.querySelectorAll('nav button')).find(el => el.textContent.includes(${JSON.stringify(text)})).click()`,
    );
    await settle();
  };
  try {
    console.log("Loading isolated demo from " + url);
    await page.evaluateOnNewDocument(
      `const OriginalDate = Date; window.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : ['2026-10-26T01:00:00Z'])); } static now() { return new OriginalDate('2026-10-26T01:00:00Z').getTime(); } };`,
    );
    await page.goto({ url, timeout: 20000 });
    console.log("App loaded; installing demo fixtures");
    // This isolated rendering profile contains only fixtures; it never authenticates to HKU.
    await run(
      `localStorage.setItem('myhku-legal-consent', JSON.stringify({version:${JSON.stringify(agreements.version)}, acceptedAt:'2026-10-26T01:00:00Z'})); localStorage.setItem('myhku-data-mode','demo'); localStorage.setItem('myhku-live-snapshot',${JSON.stringify(JSON.stringify(fixture))}); localStorage.setItem('myhku-last-sync','10/26 09:00');`,
    );
    await page.goto({ url, timeout: 20000 });
    console.log("Demo profile ready");
    await new Promise((resolve) => setTimeout(resolve, 4200));
    await run(
      `document.querySelector('.page-heading .eyebrow').textContent = '星期一 · 10月26日'; document.querySelector('.sync-line span:nth-child(2)').textContent = '上次更新 10/26 09:00'; document.querySelector('.schedule .panel-head p').textContent = '10月26日，星期一';`,
    );
    await capture("overview");
    await navigate("Moodle");
    await capture("moodle");
    await navigate("课程资料");
    await capture("materials");
    await navigate("我的课表");
    await capture("calendar");
    await navigate("概览");
    await page.setViewport({ width: 440, height: 940, deviceScaleFactor: 1 });
    await settle();
    await capture("mobile");
    await writeFile(
      join(captures, "provenance.json"),
      JSON.stringify(
        {
          description:
            "Actual MyHKU UI, rendered in an isolated Chromium profile using built-in and synthetic demo data. No HKU account, credentials, or network data used.",
          source: "src/main.tsx",
          viewport: { desktop: [1440, 940], mobile: [440, 940] },
          fixture,
        },
        null,
        2,
      ) + "\n",
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close({ silent: true });
  }
}
