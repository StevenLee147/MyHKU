import { StrictMode, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Bell, BookOpen, CalendarDays, CheckCircle2, ChevronDown, Clock3, Download, ExternalLink, FileText, LayoutDashboard, Link2, LogIn, Menu, RefreshCw, Search, Settings, ShieldCheck, Sparkles, Trophy, X, CircleAlert } from 'lucide-react'
import './styles.css'
import { cacheSnapshot, checkAllConnections, checkConnection, fetchLiveSnapshot, getCachedSnapshot, getConnectionStates, getDataMode, HKU_SITES, notifySnapshotChanges, openOfficialLogin, safeHkuUrl, setDataMode, type ConnectionState, type DataMode, type HkuSite, type LiveSnapshot, type SiteConnection } from './services/hku'

type NavKey = 'overview' | 'calendar' | 'moodle' | 'materials' | 'settings'
const navItems: { key: NavKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'overview', label: '概览', icon: LayoutDashboard }, { key: 'calendar', label: '我的课表', icon: CalendarDays }, { key: 'moodle', label: 'Moodle', icon: BookOpen }, { key: 'materials', label: '课程资料', icon: FileText }, { key: 'settings', label: '设置', icon: Settings }
]
const classes = [
  { time: '09:30', end: '11:20', title: '数据科学导论', code: 'COMP7901', room: 'KB 419', teacher: '李教授', tone: 'blue' },
  { time: '14:30', end: '16:20', title: '计算机系统原理', code: 'COMP7801', room: 'CYM LT', teacher: '陈博士', tone: 'violet' }
]
const dueItems = [
  { title: 'Assignment 2 · 数据分析', course: 'COMP7901', due: '今天 23:59', urgent: true },
  { title: 'Reading response · Week 4', course: 'COMP7801', due: '明天 18:00', urgent: false },
  { title: '小组项目分工确认', course: 'COMP7103', due: '周五', urgent: false }
]

const connectionLabel: Record<ConnectionState, string> = {
  disconnected: '未连接', login_pending: '等待完成登录', connected: '已连接', error: '检查失败',
}

function ConnectionSettings({ mode, setMode, states, setStates, onNotice }: {
  mode: DataMode
  setMode: (mode: DataMode) => void
  states: Record<HkuSite, SiteConnection>
  setStates: (states: Record<HkuSite, SiteConnection>) => void
  onNotice: (message: string) => void
}) {
  const [checking, setChecking] = useState<HkuSite | 'all' | null>(null)
  const login = (site: HkuSite) => {
    setStates(openOfficialLogin(site))
    onNotice(`已打开 ${HKU_SITES[site].label} 官方登录页；完成 SSO/MFA 后回来检查连接`)
  }
  const check = async (site: HkuSite) => {
    setChecking(site)
    await checkConnection(site)
    setStates(getConnectionStates())
    setChecking(null)
  }
  const checkAll = async () => {
    setChecking('all')
    setStates(await checkAllConnections())
    setChecking(null)
  }
  return <section className="panel connections-panel">
    <div className="panel-head"><div><h2>HKU 服务连接</h2><p>通过学校官方页面登录，MyHKU 不读取或保存密码</p></div><button className="text-btn" onClick={checkAll} disabled={checking !== null}><RefreshCw size={13} className={checking === 'all' ? 'spin' : ''}/> 检查全部</button></div>
    <div className="mode-switch" role="group" aria-label="数据来源"><span>数据来源</span><button className={mode === 'demo' ? 'selected' : ''} onClick={() => { setMode('demo'); onNotice('已切换到演示数据') }}>演示数据</button><button className={mode === 'live' ? 'selected' : ''} onClick={() => { setMode('live'); onNotice('真实模式已启用，请先连接 HKU 服务') }}>真实模式</button></div>
    <div className="connection-list">{(Object.keys(HKU_SITES) as HkuSite[]).map(site => {
      const item = HKU_SITES[site]; const state = states[site]
      const isChecking = checking === site || checking === 'all'
      return <article className="connection-card" key={site}><div className="connection-icon"><ShieldCheck size={19}/></div><div className="connection-copy"><strong>{item.label}</strong><span>{item.description}</span><small className={`connection-state ${state.state}`}><i/>{connectionLabel[state.state]}{state.detail ? ` · ${state.detail}` : ''}</small></div><div className="connection-actions"><a className="login-link" href={item.url} target="_blank" rel="noreferrer" onClick={() => login(site)} aria-label={`在官方页面登录 ${item.label}`}><LogIn size={14}/> 官方登录</a><button className="check-link" onClick={() => check(site)} disabled={isChecking}>{isChecking ? <RefreshCw size={13} className="spin"/> : <Link2 size={13}/>} 检查连接</button><a href={item.url} target="_blank" rel="noreferrer" aria-label={`打开 ${item.label}`}><ExternalLink size={14}/></a></div></article>
    })}</div>
    <div className="connection-note"><CircleAlert size={15}/><span>真实模式需要本地桥接服务和 Chrome 扩展；请在 HKU 官方页面完成 SSO/MFA。扩展只发送可见只读字段，不会读取或暴露 Cookie。</span></div>
  </section>
}

function App() {
  const [active, setActive] = useState<NavKey>('overview')
  const [mobileNav, setMobileNav] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lastSync, setLastSync] = useState(() => localStorage.getItem('myhku-last-sync') ?? '尚未同步')
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const [dataMode, setDataModeState] = useState<DataMode>(() => getDataMode())
  const [connections, setConnections] = useState<Record<HkuSite, SiteConnection>>(() => getConnectionStates())
  const [liveSnapshot, setLiveSnapshot] = useState<LiveSnapshot | null>(() => getCachedSnapshot())
  const [liveError, setLiveError] = useState('')
  const started = useRef(false)
  const syncingRef = useRef(false)
  const lastAttemptAt = useRef(0)
  // The daily timer is installed once for the lifetime of the app. Keep the
  // current mode in a ref so switching between demo/live also affects that
  // timer instead of leaving it with the initial render's value.
  const dataModeRef = useRef(dataMode)
  dataModeRef.current = dataMode
  const sync = () => {
    if (syncingRef.current) return
    syncingRef.current = true
    lastAttemptAt.current = Date.now()
    const mode = dataModeRef.current
    setRefreshing(true); setNotice('正在同步 Portal、SIS 和 Moodle…')
    const finish = (message?: string, success = true) => { if (success) { const now = new Date(); const stamp = `今天 ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`; setLastSync(stamp); localStorage.setItem('myhku-last-sync', stamp); localStorage.setItem('myhku-last-sync-ms', String(Date.now())) } syncingRef.current = false; setRefreshing(false); setNotice(message || (mode === 'live' ? '真实数据同步完成' : '同步完成，内容已是最新')); window.setTimeout(() => setNotice(''), 3000) }
    if (mode === 'live') {
      const refreshOfficial = window.myhkuDesktop?.refreshHku ? window.myhkuDesktop.refreshHku().then(() => new Promise(resolve => window.setTimeout(resolve, 1200))) : window.myhkuAndroid?.refreshHku ? Promise.resolve(window.myhkuAndroid.refreshHku()).then(() => new Promise(resolve => window.setTimeout(resolve, 1200))) : Promise.resolve()
      refreshOfficial.then(() => Promise.all([checkAllConnections(), fetchLiveSnapshot()])).then(([states, snapshot]) => { setConnections(states); setLiveSnapshot(snapshot); cacheSnapshot(snapshot); notifySnapshotChanges(snapshot); setLiveError(''); finish('真实数据同步完成') }).catch(error => { const detail = error instanceof Error ? error.message : '真实数据同步失败'; setLiveError(liveSnapshot ? `${detail} 当前显示上次成功同步的数据。` : detail); finish('真实数据同步失败，请检查设置中的连接状态', false) })
    }
    else window.setTimeout(finish, 900)
  }
  useEffect(() => {
    if (!started.current) {
      started.current = true
      sync()
    }
    // Count attempts, not successful syncs: an unavailable bridge must not
    // trigger a network retry every minute. The interval only checks time.
    const timer = window.setInterval(() => {
      if (Date.now() - lastAttemptAt.current >= 24 * 60 * 60 * 1000) sync()
    }, 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])
  const title = navItems.find(n => n.key === active)?.label ?? '概览'
  const connectedCount = Object.values(connections).filter(item => item.state === 'connected').length
  const accountLabel = dataMode === 'demo' ? '演示数据' : connectedCount === 3 ? '已安全连接' : connectedCount ? `${connectedCount}/3 个服务已连接` : '需要连接 HKU'
  const now = new Date()
  const today = { weekday: new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(now), date: `${now.getMonth() + 1} 月 ${now.getDate()} 日` }
  const filteredDue = useMemo(() => dueItems.filter(i => `${i.title}${i.course}`.toLowerCase().includes(query.toLowerCase())), [query])
  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark">▣</div><span>My<span>HKU</span></span><button className="close-nav" onClick={() => setMobileNav(false)}><X size={18}/></button></div>
      <div className="workspace"><span className="workspace-label">当前空间</span><strong>学习空间</strong><ChevronDown size={15}/></div>
      <nav>{navItems.map(({ key, label, icon: Icon }) => <button key={key} className={active === key ? 'active' : ''} onClick={() => { setActive(key); setMobileNav(false) }}><Icon size={18}/><span>{label}</span>{key === 'moodle' && <i className="nav-dot"/>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="login-state"><span className={`state-dot ${dataMode === 'live' && connectedCount === 0 ? 'offline' : ''}`}/> <div><small>HKU 账号</small><strong>{accountLabel}</strong></div></div><button className="user-mini"><span className="avatar">学</span><span>同学</span><ChevronDown size={14}/></button></div>
    </aside>
    {mobileNav && <div className="backdrop" onClick={() => setMobileNav(false)}/>} 
    <main className="main">
      <header className="topbar"><button className="menu-toggle" onClick={() => setMobileNav(true)}><Menu size={21}/></button><div className="crumb"><span>学习空间</span><b>/</b><strong>{title}</strong></div><div className="top-actions"><label className="search"><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索课程、资料…"/><kbd>⌘ K</kbd></label><button className="icon-btn" aria-label="通知" onClick={() => { if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission() }}><Bell size={19}/><i/></button><div className="user"><span className="avatar">学</span><span><b>同学</b><small>HKU Student</small></span><ChevronDown size={15}/></div></div></header>
      {notice && <div className={`toast ${refreshing ? 'loading' : 'success'}`}>{refreshing ? <RefreshCw className="spin" size={15}/> : <CheckCircle2 size={15}/>} {notice}</div>}
      <div className="content">
        <div className="page-heading"><div><p className="eyebrow">{today.weekday} · {today.date}</p><h1>早上好，同学 <span>✦</span></h1><p className="subtitle">这是你今天的学习概览。</p></div><button className="refresh-btn" onClick={sync} disabled={refreshing}><RefreshCw size={16} className={refreshing ? 'spin' : ''}/>{refreshing ? '同步中…' : '立即刷新'}</button></div>
        <div className="sync-line"><span><CheckCircle2 size={14}/> {dataMode === 'live' && liveError && liveSnapshot ? '显示本地缓存' : '数据已同步'}</span><span>上次更新 {lastSync}</span><span className="sync-policy">打开应用时刷新 · 每日自动更新一次</span></div>
        {active === 'overview' ? dataMode === 'demo' ? <>
          <section className="stats"><div className="stat-card"><div className="stat-icon blue"><CalendarDays size={18}/></div><div><small>今日课程</small><strong>2 节</strong></div><span className="stat-trend">+1 比昨天</span></div><div className="stat-card"><div className="stat-icon amber"><Clock3 size={18}/></div><div><small>待完成</small><strong>3 项</strong></div><span className="stat-trend amber-text">1 项今天截止</span></div><div className="stat-card"><div className="stat-icon green"><Trophy size={18}/></div><div><small>当前平均成绩</small><strong>86.4 <em>/ 100</em></strong></div><span className="stat-trend green-text">↑ 2.1</span></div></section>
          <div className="dashboard-grid"><section className="panel schedule"><div className="panel-head"><div><h2>今日课表</h2><p>{today.date}，{today.weekday}</p></div><button className="text-btn" onClick={() => setActive('calendar')}>查看完整课表 <span>→</span></button></div><div className="class-list">{classes.map(c => <article className="class-item" key={c.code}><div className={`class-time ${c.tone}`}><strong>{c.time}</strong><span>{c.end}</span></div><div className="class-info"><h3>{c.title}</h3><p>{c.code} <span>·</span> {c.teacher}</p></div><div className="room">{c.room}</div></article>)}</div></section><section className="panel deadlines"><div className="panel-head"><div><h2>近期截止</h2><p>来自 Moodle 的待办</p></div><button className="dots">•••</button></div><div className="due-list">{filteredDue.map(i => <article className="due-item" key={i.title}><span className={`due-check ${i.urgent ? 'urgent' : ''}`}>{i.urgent ? '!' : ''}</span><div><h3>{i.title}</h3><p>{i.course}</p></div><time className={i.urgent ? 'urgent-text' : ''}>{i.due}</time></article>)}</div><button className="all-tasks" onClick={() => setActive('moodle')}>查看全部待办 <span>→</span></button></section></div>
          <section className="panel quick"><div className="quick-title"><Sparkles size={18}/><div><h2>学习快捷入口</h2><p>从上次离开的地方继续</p></div></div><div className="quick-actions"><button onClick={() => setActive('moodle')}><BookOpen size={17}/><span>Moodle 课程</span><small>3 门课程</small></button><button onClick={() => setActive('materials')}><Download size={17}/><span>最近资料</span><small>4 个未读</small></button><button onClick={() => setActive('calendar')}><CalendarDays size={17}/><span>本周课表</span><small>8 节课程</small></button></div></section>
        </> : <LiveDataPage active={active} snapshot={liveSnapshot} error={liveError} onOpenSettings={() => setActive('settings')} onRefresh={sync}/> : active === 'settings' ? <ConnectionSettings mode={dataMode} setMode={mode => { setDataMode(mode); setDataModeState(mode) }} states={connections} setStates={setConnections} onNotice={message => { setNotice(message); window.setTimeout(() => setNotice(''), 4000) }}/> : <LiveDataPage active={active} snapshot={liveSnapshot} error={liveError} onOpenSettings={() => setActive('settings')} onRefresh={sync}/>}
      </div>
    </main>
  </div>
}
function IconFor({ keyName }: { keyName: NavKey }) { const item = navItems.find(n => n.key === keyName); const I = item?.icon ?? LayoutDashboard; return <I size={25}/> }
function scheduleDayLabel(item: LiveSnapshot['schedule'][number]): string {
  const raw = (item.date || item.day || '').trim()
  if (!raw) return '待确认日期'
  const parsed = Date.parse(raw)
  if (!Number.isNaN(parsed)) {
    return new Intl.DateTimeFormat('zh-CN', { weekday: 'short', month: 'numeric', day: 'numeric' }).format(new Date(parsed))
  }
  return raw
}
function isTodaySchedule(item: LiveSnapshot['schedule'][number]): boolean {
  const raw = (item.date || item.day || '').trim()
  if (!raw) return false
  const parsed = Date.parse(raw)
  const now = new Date()
  if (!Number.isNaN(parsed)) {
    const value = new Date(parsed)
    return value.getFullYear() === now.getFullYear() && value.getMonth() === now.getMonth() && value.getDate() === now.getDate()
  }
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]
  return raw.includes(`星期${weekday}`) || raw.includes(`周${weekday}`) || raw.toLowerCase().includes(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()])
}
function LiveDataPage({ active, snapshot, error, onOpenSettings, onRefresh }: { active: NavKey; snapshot: LiveSnapshot | null; error: string; onOpenSettings: () => void; onRefresh: () => void }) {
  if (active === 'overview') return <LiveDataPlaceholder snapshot={snapshot} error={error} onOpenSettings={onOpenSettings} onRefresh={onRefresh}/>
  if (!snapshot) return <LiveDataPlaceholder snapshot={null} error={error} onOpenSettings={onOpenSettings} onRefresh={onRefresh}/>
  if (active === 'calendar') {
    const groups = new Map<string, LiveSnapshot['schedule']>()
    snapshot.schedule.forEach(item => {
      const key = scheduleDayLabel(item)
      groups.set(key, [...(groups.get(key) || []), item])
    })
    return <section className="panel live-page"><div className="panel-head"><div><h2>我的课表</h2><p>周视图 · 来自 SIS 的真实数据 · {snapshot.schedule.length} 节课程</p></div><button className="text-btn" onClick={onRefresh}><RefreshCw size={13}/>刷新</button></div>{groups.size ? <div className="week-grid">{Array.from(groups, ([day, items]) => <section className="week-day" key={day}><h3>{day}</h3><div className="class-list">{items.map((item, index) => <article className="class-item" key={item.id || `${item.title}-${index}`}><div className="class-time blue"><strong>{item.start}</strong><span>{item.end}</span></div><div className="class-info"><h3>{item.title}</h3><p>{item.code || '未提供课程代码'} <span>·</span> {item.teacher || '未提供教师'}</p></div><div className="room">{item.room || '未提供地点'}</div></article>)}</div></section>)}</div> : <p className="empty-state">本次同步没有课表记录</p>}</section>
  }
  if (active === 'moodle') return <section className="panel live-page"><div className="panel-head"><div><h2>Moodle</h2><p>{snapshot.courses.length} 门课程 · {snapshot.assignments.filter(item => !item.completed).length} 项待办 · {snapshot.grades.length} 项成绩</p></div><button className="text-btn" onClick={onRefresh}><RefreshCw size={13}/>刷新</button></div><div className="live-columns"><div><h3 className="subheading">课程</h3>{snapshot.courses.length ? snapshot.courses.map(item => <div className="live-row" key={item.id}><BookOpen size={15}/><span>{item.title}{item.code ? ` · ${item.code}` : ''}</span></div>) : <p className="empty-state">暂无课程</p>}</div><div><h3 className="subheading">待办</h3>{snapshot.assignments.length ? snapshot.assignments.map(item => <div className="live-row" key={item.id}><span className={`due-check ${item.completed ? 'done' : ''}`}>{item.completed ? '✓' : ''}</span><span>{item.title}<small>{item.course}{item.due ? ` · ${item.due}` : ''}</small></span></div>) : <p className="empty-state">暂无待办</p>}</div><div><h3 className="subheading">成绩</h3>{snapshot.grades.length ? snapshot.grades.map(item => <div className="live-row" key={item.id}><Trophy size={15}/><span>{item.title}<small>{item.course} · {item.released === false ? '未发布' : item.value || '未提供分数'}</small></span></div>) : <p className="empty-state">暂无可见成绩</p>}</div></div><div className="live-announcements"><h3 className="subheading">公告</h3>{snapshot.announcements.length ? snapshot.announcements.slice(0, 8).map(item => <div className="live-row" key={item.id}><Bell size={15}/><span>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : item.title}<small>{item.course}{item.published ? ` · ${item.published}` : ''}</small></span></div>) : <p className="empty-state">暂无公告</p>}</div></section>
  return <section className="panel live-page"><div className="panel-head"><div><h2>课程资料</h2><p>来自 Moodle 的真实资料 · 点击后在官方页面打开或下载</p></div><button className="text-btn" onClick={onRefresh}><RefreshCw size={13}/>刷新</button></div><div className="resource-list">{snapshot.resources.length ? snapshot.resources.map(item => { const url = safeHkuUrl(item.url); return <div className="resource-row" key={item.id}><FileText size={16}/><span><strong>{item.title}</strong><small>{item.course}</small></span>{url ? <a href={url} target="_blank" rel="noreferrer"><Download size={14}/>下载</a> : <em>无链接</em>}</div> }) : <p className="empty-state">暂无可下载资料</p>}</div></section>
}
function LiveDataPlaceholder({ snapshot, error, onOpenSettings, onRefresh }: { snapshot: LiveSnapshot | null; error: string; onOpenSettings: () => void; onRefresh: () => void }) {
  if (!snapshot) return <section className="panel placeholder live-placeholder"><div className="placeholder-icon"><ShieldCheck size={25}/></div><h2>真实数据尚未连接</h2><p>{error || '完成 HKU 官方 SSO/MFA 后，在设置中检查 Portal、SIS 和 Moodle 连接。连接成功后，刷新才会读取你的真实课表和 Moodle 数据。'}</p><div className="placeholder-actions"><button className="refresh-btn" onClick={onOpenSettings}><Link2 size={16}/>管理连接</button><button className="outline-btn" onClick={onRefresh}><RefreshCw size={15}/>重新检查</button></div></section>
  const classesLive = snapshot.schedule.filter(isTodaySchedule).slice(0, 3)
  const dueLive = snapshot.assignments.filter(item => !item.completed).slice(0, 4)
  return <><section className="stats"><div className="stat-card"><div className="stat-icon blue"><CalendarDays size={18}/></div><div><small>今日课程</small><strong>{classesLive.length} 节</strong></div></div><div className="stat-card"><div className="stat-icon amber"><Clock3 size={18}/></div><div><small>待完成</small><strong>{dueLive.length} 项</strong></div></div><div className="stat-card"><div className="stat-icon green"><Trophy size={18}/></div><div><small>已获取成绩</small><strong>{snapshot.grades.length} 项</strong></div></div></section><div className="dashboard-grid"><section className="panel schedule"><div className="panel-head"><div><h2>课表</h2><p>来自 SIS 的真实数据</p></div></div><div className="class-list">{classesLive.length ? classesLive.map(item => <article className="class-item" key={item.id}><div className="class-time blue"><strong>{item.start}</strong><span>{item.end}</span></div><div className="class-info"><h3>{item.title}</h3><p>{item.code || '未提供课程代码'} <span>·</span> {item.teacher || '未提供教师'}</p></div><div className="room">{item.room || '未提供地点'}</div></article>) : <p className="empty-state">本次同步没有课表记录</p>}</div></section><section className="panel deadlines"><div className="panel-head"><div><h2>待办</h2><p>来自 Moodle 的真实数据</p></div></div><div className="due-list">{dueLive.length ? dueLive.map(item => <article className="due-item" key={item.id}><span className="due-check"/><div><h3>{item.title}</h3><p>{item.course}</p></div><time>{item.due || '未设置截止时间'}</time></article>) : <p className="empty-state">暂无未完成待办</p>}</div></section></div></>
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
