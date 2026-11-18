import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import {
  BookOpen,
  CalendarDays,
  CalendarPlus,
  Clock3,
  CornerDownLeft,
  FileText,
  Globe,
  LayoutDashboard,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sun,
  X,
} from 'lucide-react'
import { mergeWithCustomTasks, type CustomTask } from '../services/customTasks'
import { safeHkuUrl, type LiveSnapshot, type ThemeMode } from '../services/hku'
import { tr, type Locale } from '../services/i18n'
import type { NavTarget } from '../services/notifications'

type PaletteActionItem = {
  id: string
  group: string
  title: string
  subtitle: string
  keywords: string
  icon: typeof Search
  run: () => void
}

export function CommandPaletteModal({
  open,
  locale = 'zh',
  themeMode,
  snapshot,
  customTasks,
  onClose,
  onNavigate,
  onSelectCourse,
  onSync,
  onOpenAddTask,
  onExportIcs,
  onToggleTheme,
  onToggleLocale,
}: {
  open: boolean
  locale?: Locale
  themeMode: ThemeMode
  snapshot: LiveSnapshot | null
  customTasks: CustomTask[]
  onClose: () => void
  onNavigate: (target: NavTarget, course?: string) => void
  onSelectCourse: (courseIdOrTitle: string) => void
  onSync: () => void
  onOpenAddTask: () => void
  onExportIcs: () => void
  onToggleTheme: (next: ThemeMode) => void
  onToggleLocale: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const headingId = useId()
  const [keyword, setKeyword] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      setKeyword('')
      setActiveIndex(0)
      dialog.showModal()
      window.setTimeout(() => inputRef.current?.focus(), 0)
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  const allItems = useMemo<PaletteActionItem[]>(() => {
    const actionsGroup = tr(locale, '快捷操作', 'Quick Actions')
    const navGroup = tr(locale, '页面跳转', 'Navigation')
    const courseGroup = tr(locale, 'Moodle 课程', 'Courses')
    const taskGroup = tr(locale, '待办与倒计时', 'Tasks & Deadlines')
    const materialGroup = tr(locale, '课程资料', 'Materials')

    const nextTheme: ThemeMode = themeMode === 'dark' ? 'light' : 'dark'
    const base: PaletteActionItem[] = [
      {
        id: 'act-sync',
        group: actionsGroup,
        title: tr(locale, '立即同步 HKU 数据', 'Sync HKU Data Now'),
        subtitle: tr(locale, '刷新 Portal、SIS 课表与 Moodle', 'Refresh Portal, SIS timetable & Moodle'),
        keywords: 'sync refresh 刷新 同步',
        icon: RefreshCw,
        run: onSync,
      },
      {
        id: 'act-add-task',
        group: actionsGroup,
        title: tr(locale, '新建自建待办 / 考试倒计时', 'New Custom Task / Exam Countdown'),
        subtitle: tr(locale, '添加个人作业、Quiz、Exam 或 Project 提醒', 'Create personal exam or project reminder'),
        keywords: 'new add task exam ddl 新建 倒计时 考试 待办',
        icon: Plus,
        run: onOpenAddTask,
      },
      {
        id: 'act-ics',
        group: actionsGroup,
        title: tr(locale, '导出 .ics 日历文件', 'Export .ics Calendar'),
        subtitle: tr(locale, '将课表与截止事项导出至系统日历', 'Export classes and deadlines to system calendar'),
        keywords: 'ics export calendar 日历 导出',
        icon: CalendarPlus,
        run: onExportIcs,
      },
      {
        id: 'act-theme',
        group: actionsGroup,
        title:
          nextTheme === 'dark'
            ? tr(locale, '切换为深色模式', 'Switch to Dark Mode')
            : tr(locale, '切换为浅色模式', 'Switch to Light Mode'),
        subtitle: tr(locale, '即时切换界面明暗外观', 'Toggle light / dark appearance'),
        keywords: 'theme dark light 深色 浅色 主题 外观',
        icon: nextTheme === 'dark' ? Moon : Sun,
        run: () => onToggleTheme(nextTheme),
      },
      {
        id: 'act-lang',
        group: actionsGroup,
        title: locale === 'zh' ? 'Switch Language to English' : '切换界面语言为简体中文',
        subtitle: tr(locale, '中英双语实时切换', 'Toggle Simplified Chinese / English UI'),
        keywords: 'language english chinese 语言 英文 中文 i18n',
        icon: Globe,
        run: onToggleLocale,
      },
      {
        id: 'nav-overview',
        group: navGroup,
        title: tr(locale, '前往：概览首页', 'Go to: Overview'),
        subtitle: tr(locale, '查看今日课程与近期截止', 'View classes today and upcoming deadlines'),
        keywords: 'overview home 概览 首页',
        icon: LayoutDashboard,
        run: () => onNavigate('overview'),
      },
      {
        id: 'nav-calendar',
        group: navGroup,
        title: tr(locale, '前往：我的周课表', 'Go to: Weekly Timetable'),
        subtitle: tr(locale, '浏览多周课表与当周到期事项', 'Browse multi-week schedule'),
        keywords: 'calendar timetable schedule 课表 周视图',
        icon: CalendarDays,
        run: () => onNavigate('calendar'),
      },
      {
        id: 'nav-moodle',
        group: navGroup,
        title: tr(locale, '前往：Moodle 课程与 GPA 模拟', 'Go to: Moodle & GPA Simulator'),
        subtitle: tr(locale, '查看课程详情、成绩与 4.3 GPA 试算', 'Courses, grades & 4.3 GPA calculator'),
        keywords: 'moodle gpa grades 课程 成绩 绩点',
        icon: BookOpen,
        run: () => onNavigate('moodle'),
      },
      {
        id: 'nav-materials',
        group: navGroup,
        title: tr(locale, '前往：课程资料中心', 'Go to: Course Materials'),
        subtitle: tr(locale, '按课程批量下载或打开本地资料', 'Batch download and manage course files'),
        keywords: 'materials files download 资料 课件 下载',
        icon: FileText,
        run: () => onNavigate('materials'),
      },
      {
        id: 'nav-settings',
        group: navGroup,
        title: tr(locale, '前往：设置与服务连接', 'Go to: Settings & Connections'),
        subtitle: tr(locale, '管理 HKU 登录状态、系统托盘与通知', 'Manage HKU sessions, tray & notifications'),
        keywords: 'settings tray account 设置 连接 托盘',
        icon: Settings,
        run: () => onNavigate('settings'),
      },
    ]

    if (snapshot) {
      for (const course of snapshot.courses.slice(0, 30)) {
        base.push({
          id: `course-${course.id}`,
          group: courseGroup,
          title: course.code && !course.title.includes(course.code) ? `${course.code} · ${course.title}` : course.title,
          subtitle: tr(locale, '打开课程详情与平时分试算', 'Open course details & What-if calculator'),
          keywords: `${course.title} ${course.code || ''} course`,
          icon: BookOpen,
          run: () => onSelectCourse(course.id),
        })
      }
      const tasks = mergeWithCustomTasks(snapshot.assignments, customTasks)
        .filter(item => !item.completed)
        .slice(0, 25)
      for (const task of tasks) {
        base.push({
          id: `task-${task.id}`,
          group: taskGroup,
          title: task.title,
          subtitle: `${task.course}${task.due ? ` · ${task.due}` : ''}`,
          keywords: `${task.title} ${task.course} ${task.note || ''} ddl assignment`,
          icon: Clock3,
          run: () => onSelectCourse(task.course),
        })
      }
      for (const res of snapshot.resources.slice(0, 30)) {
        const safe = safeHkuUrl(res.url)
        base.push({
          id: `res-${res.id}`,
          group: materialGroup,
          title: res.title,
          subtitle: res.course,
          keywords: `${res.title} ${res.course} material file pdf slides`,
          icon: FileText,
          run: () => {
            onNavigate('materials')
            if (safe && !window.myhkuDesktop && !window.myhkuAndroid) {
              window.open(safe, '_blank', 'noopener,noreferrer')
            }
          },
        })
      }
    }

    return base
  }, [locale, themeMode, snapshot, customTasks, onSync, onOpenAddTask, onExportIcs, onToggleTheme, onToggleLocale, onNavigate, onSelectCourse])

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return allItems.slice(0, 14)
    return allItems
      .filter(item => `${item.title} ${item.subtitle} ${item.keywords}`.toLowerCase().includes(q))
      .slice(0, 18)
  }, [allItems, keyword])

  useEffect(() => {
    setActiveIndex(0)
  }, [keyword])

  const triggerItem = (item: PaletteActionItem | undefined) => {
    if (!item) return
    dialogRef.current?.close()
    item.run()
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex(prev => (filtered.length ? (prev + 1) % filtered.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex(prev => (filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      triggerItem(filtered[activeIndex])
    }
  }

  const handleBackdropFallbackClick = (event: MouseEvent<HTMLDialogElement>) => {
    const dialog = dialogRef.current
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return
    if (event.target !== dialog) return
    const rect = dialog.getBoundingClientRect()
    const inside =
      rect.top <= event.clientY &&
      event.clientY <= rect.top + rect.height &&
      rect.left <= event.clientX &&
      event.clientX <= rect.left + rect.width
    if (!inside) dialog.close()
  }

  return (
    <dialog
      ref={dialogRef}
      className="myhku-modal command-palette-dialog"
      aria-labelledby={headingId}
      onClick={handleBackdropFallbackClick}
      onClose={() => {
        if (dialogRef.current) dialogRef.current.returnValue = ''
        onClose()
      }}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="palette-search-head">
        <Search size={17} className="palette-search-icon" />
        <h2 id={headingId} className="sr-only">
          {tr(locale, '快捷命令面板', 'Command Palette')}
        </h2>
        <input
          ref={inputRef}
          type="text"
          className="palette-input"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={tr(locale, '输入命令，或搜索课程、待办、资料回车直达…', 'Type a command or search courses, tasks, files…')}
        />
        <button
          type="button"
          className="icon-close-btn"
          aria-label={tr(locale, '关闭命令面板', 'Close command palette')}
          onClick={() => dialogRef.current?.close()}
        >
          <X size={16} />
        </button>
      </div>

      <div className="palette-results" role="listbox" aria-label={tr(locale, '搜索与命令结果', 'Command results')}>
        {filtered.length > 0 ? (
          filtered.map((item, idx) => {
            const Icon = item.icon
            const selected = idx === activeIndex
            return (
              <button
                type="button"
                key={item.id}
                role="option"
                aria-selected={selected}
                className={`palette-item ${selected ? 'selected' : ''}`}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => triggerItem(item)}
              >
                <span className="palette-item-icon">
                  <Icon size={15} />
                </span>
                <span className="palette-item-body">
                  <strong>{item.title}</strong>
                  <small>
                    {item.group} · {item.subtitle}
                  </small>
                </span>
                <CornerDownLeft size={13} className="palette-enter-hint" />
              </button>
            )
          })
        ) : (
          <p className="empty-state">{tr(locale, '未找到匹配的命令或学习内容', 'No matching commands or items')}</p>
        )}
      </div>

      <div className="palette-foot">
        <span>↑↓ {tr(locale, '选择', 'Navigate')}</span>
        <span>↵ {tr(locale, '执行', 'Run')}</span>
        <span>Esc {tr(locale, '关闭', 'Close')}</span>
      </div>
    </dialog>
  )
}
