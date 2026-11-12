import type { LiveSnapshot } from './hku'
import { formatIsoLocalDate, hongKongDate } from './schedule'

/**
 * Self-contained demonstration snapshot anchored to the current Hong Kong week.
 * Strictly isolated from any live cached user data.
 */
export function buildDemoSnapshot(now = new Date()): LiveSnapshot {
  const todayIso = hongKongDate(now)
  const todayDate = new Date(`${todayIso}T00:00:00`)
  const sunday = new Date(todayDate)
  sunday.setDate(sunday.getDate() - sunday.getDay())

  const dayIso = (weekOffset: number, weekday: number) => {
    const d = new Date(sunday)
    d.setDate(d.getDate() + weekOffset * 7 + weekday)
    return formatIsoLocalDate(d)
  }

  const weekRange = (weekOffset: number) => ({
    start: dayIso(weekOffset, 0),
    end: dayIso(weekOffset, 6),
  })

  const currentWeekday = todayDate.getDay()
  const activeDay = currentWeekday === 0 || currentWeekday === 6 ? 1 : currentWeekday

  const scheduleWeeks = [weekRange(0), weekRange(1), weekRange(2)]

  return {
    fetchedAt: now.toISOString(),
    scheduleWeek: scheduleWeeks[0],
    scheduleWeeks,
    courses: [
      { id: 'demo-comp7901', code: 'COMP7901', title: 'COMP7901 数据科学导论' },
      { id: 'demo-comp7801', code: 'COMP7801', title: 'COMP7801 计算机系统原理' },
      { id: 'demo-comp7103', code: 'COMP7103', title: 'COMP7103 数据挖掘与知识发现' },
      { id: 'demo-caes9920', code: 'CAES9920', title: 'CAES9920 学术研究写作' },
    ],
    schedule: [
      // Ensure today always shows realistic classes in Demo Overview
      { id: 'demo-today-1', title: '数据科学导论', code: 'COMP7901', date: todayIso, start: '09:30', end: '11:20', room: 'KB 419', teacher: '李教授' },
      { id: 'demo-today-2', title: '计算机系统原理', code: 'COMP7801', date: todayIso, start: '14:30', end: '16:20', room: 'CYM LT', teacher: '陈博士' },
      // Other days of current week (including a side-by-side tutorial overlap example)
      { id: 'demo-w0-1', title: '数据挖掘与知识发现', code: 'COMP7103', date: dayIso(0, activeDay === 2 ? 4 : 2), start: '10:30', end: '12:20', room: 'MW T1', teacher: '张教授' },
      { id: 'demo-w0-2', title: '学术研究写作 Seminar', code: 'CAES9920', date: dayIso(0, activeDay === 3 ? 5 : 3), start: '13:30', end: '15:20', room: 'CPD-2.16', teacher: 'Dr. Evans' },
      { id: 'demo-w0-3', title: 'COMP7901 Lab Group A', code: 'COMP7901', date: dayIso(0, activeDay === 3 ? 5 : 3), start: '14:30', end: '16:00', room: 'HW 312', teacher: '助教团队' },
      // Next week prefetched entries
      { id: 'demo-w1-1', title: '数据科学导论', code: 'COMP7901', date: dayIso(1, 1), start: '09:30', end: '11:20', room: 'KB 419', teacher: '李教授' },
      { id: 'demo-w1-2', title: '数据挖掘专题讨论', code: 'COMP7103', date: dayIso(1, 3), start: '10:30', end: '12:20', room: 'MW T1', teacher: '张教授' },
      { id: 'demo-w1-3', title: '计算机系统原理实验', code: 'COMP7801', date: dayIso(1, 4), start: '14:30', end: '16:20', room: 'HW 310', teacher: '陈博士' },
      // Week +2 prefetched entries
      { id: 'demo-w2-1', title: '数据科学期中展示', code: 'COMP7901', date: dayIso(2, 1), start: '09:30', end: '11:20', room: 'KB 419', teacher: '李教授' },
      { id: 'demo-w2-2', title: '学术研究写作 Workshop', code: 'CAES9920', date: dayIso(2, 3), start: '13:30', end: '15:20', room: 'CPD-2.16', teacher: 'Dr. Evans' },
    ],
    assignments: [
      { id: 'demo-a1', title: 'Assignment 2 · 数据探索与回归分析', course: 'COMP7901 数据科学导论', due: `${todayIso} 23:59`, completed: false, submissionStatus: '尚未提交' },
      { id: 'demo-a2', title: 'Reading Response · Week 6 内存虚拟化', course: 'COMP7801 计算机系统原理', due: `${dayIso(0, Math.min(6, activeDay + 1))} 18:00`, completed: false, submissionStatus: '尚未提交' },
      { id: 'demo-a3', title: '小组挖掘项目选题与分工确认', course: 'COMP7103 数据挖掘与知识发现', due: `${dayIso(1, 5)} 23:59`, completed: false, submissionStatus: '草稿已保存' },
      { id: 'demo-a4', title: 'Assignment 1 · Python 环境与数据清洗', course: 'COMP7901 数据科学导论', due: `${dayIso(-1, 5)} 23:59`, completed: true, submissionStatus: '已提交评分' },
    ],
    resources: [
      { id: 'demo-r1', title: 'Lecture 06 · 线性模型与正则化讲义 (PDF)', course: 'COMP7901 数据科学导论', url: 'https://moodle.hku.hk/mod/resource/view.php?id=9001' },
      { id: 'demo-r2', title: 'Lab 04 · Pandas 与可视化练习数据集', course: 'COMP7901 数据科学导论', url: 'https://moodle.hku.hk/mod/folder/view.php?id=9002' },
      { id: 'demo-r3', title: 'Lecture 05 · 进程调度与页表机制 Slides', course: 'COMP7801 计算机系统原理', url: 'https://moodle.hku.hk/mod/resource/view.php?id=9003' },
      { id: 'demo-r4', title: '聚类评估指标补充阅读链接', course: 'COMP7103 数据挖掘与知识发现', url: 'https://moodle.hku.hk/mod/url/view.php?id=9004' },
    ],
    grades: [
      { id: 'demo-g1', title: 'Assignment 1 · Python 数据清洗', course: 'COMP7901 数据科学导论', value: '91.0 / 100', released: true },
      { id: 'demo-g2', title: 'Quiz 1 · 系统调用与中断', course: 'COMP7801 计算机系统原理', value: '84%', released: true },
      { id: 'demo-g3', title: 'Annotated Bibliography Draft', course: 'CAES9920 学术研究写作', value: 'A-', released: true },
      { id: 'demo-g4', title: 'Assignment 2 · 数据探索与回归分析', course: 'COMP7901 数据科学导论', released: false },
    ],
    announcements: [
      { id: 'demo-n1', title: '第 6 周上机实验教室临时调整至 HW 312', course: 'COMP7901 数据科学导论', published: todayIso, url: 'https://moodle.hku.hk/mod/forum/discuss.php?d=101' },
      { id: 'demo-n2', title: '期中阅读报告格式说明与评分细则已发布', course: 'COMP7801 计算机系统原理', published: dayIso(0, Math.max(0, activeDay - 1)), url: 'https://moodle.hku.hk/mod/forum/discuss.php?d=102' },
      { id: 'demo-n3', title: '小组项目数据集候选清单更新', course: 'COMP7103 数据挖掘与知识发现', published: dayIso(-1, 4), url: 'https://moodle.hku.hk/mod/forum/discuss.php?d=103' },
    ],
  }
}
