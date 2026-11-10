import { Suspense, lazy, useEffect, useState, type ComponentType } from 'react'
import { createBrowserRouter, NavLink, Outlet, ScrollRestoration, useLocation, useNavigate, useRouteError } from 'react-router'
import { isChunkLoadError, reloadForNewVersion } from './lib/reload'
import { motion, MotionConfig } from 'motion/react'
import { Toaster } from 'sonner'
import { AGENT_CMD, consumePairFragment, isAgentStale, useAgent } from './lib/agent'
import { toast } from 'sonner'
import { BookOpen, CalendarDays, ChevronRight, Library, Timer, TrendingUp, Upload } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './lib/db'
import { isConfigured, providerById, useCloudConfigs, useCoachEngine } from './lib/cloud'
import { isSetDone } from './lib/workout'
import Home from './pages/Home'

// route-level code splitting: MediaPipe / Recharts / Tesseract only load where used
// Each page is its own chunk; all are prefetched when idle after the home page loads, so switching tabs needs no download/parse.
// Note: React.lazy always suspends on first render, and showing content then waits for Suspense's 300ms throttle —
// so once prefetched, render the loaded component directly instead of going through lazy.
type PageModule = { default: ComponentType }
function page(loader: () => Promise<PageModule>) {
  let loaded: ComponentType | null = null
  const load = () =>
    loader().then((m) => {
      loaded = m.default
      return m
    })
  const Lazy = lazy(load)
  function Page() {
    const C = loaded
    return C ? <C /> : <Lazy />
  }
  return { Page, load }
}
const P = {
  train: page(() => import('./pages/Train')),
  exercises: page(() => import('./pages/Exercises')),
  new: page(() => import('./pages/NewSession')),
  session: page(() => import('./pages/SessionDetail')),
  journal: page(() => import('./pages/Journal')),
  progress: page(() => import('./pages/Progress')),
  coaches: page(() => import('./pages/Coaches')),
  agent: page(() => import('./pages/AgentPage')),
}
const PREFETCH: Record<string, () => Promise<unknown>> = {
  '/train': P.train.load,
  '/exercises': P.exercises.load,
  '/new': P.new.load,
  '/journal': P.journal.load,
  '/progress': P.progress.load,
  '/coaches': P.coaches.load,
  '/agent': P.agent.load,
}
function prefetchAll() {
  const run = () => {
    Object.values(P).forEach((p) => p.load().catch(() => {}))
    // Also prefetch and parse the exercise library data (~33KB gzip) so opening the library / picking an exercise doesn't wait
    import('./lib/exercises').then((m) => m.loadExercises()).catch(() => {})
  }
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback
  if (ric) ric(run, { timeout: 4000 })
  else setTimeout(run, 1500)
}
const NewSession = P.new.Page
const Train = P.train.Page
const Exercises = P.exercises.Page
const SessionDetail = P.session.Page
const Journal = P.journal.Page
const Progress = P.progress.Page
const Coaches = P.coaches.Page
const AgentPage = P.agent.Page
const FigureLab = lazy(() => import('./pages/FigureLab'))
const MuscleLab = lazy(() => import('./pages/MuscleLab'))
const LiveLab = lazy(() => import('./pages/LiveLab'))

const NAV = [
  { to: '/train', label: '训练中', short: '训练', Icon: Timer },
  { to: '/exercises', label: '动作库', short: '动作库', Icon: Library },
  // Mobile bottom bar holds only 5 items: upload/analyze is reached from Train, exercise details, or Home
  { to: '/new', label: '上传分析', short: '分析', Icon: Upload, desktopOnly: true },
  { to: '/journal', label: '训练日志', short: '日志', Icon: CalendarDays },
  { to: '/progress', label: '能力', short: '能力', Icon: TrendingUp },
  { to: '/coaches', label: '教练与文献', short: '教练', Icon: BookOpen },
]

/** Mobile: bottom tab bar (thumb-reachable, 44px+ touch targets) */
function BottomTabs() {
  // Highlight as soon as the finger goes down (don't wait for the new page to render) and start prefetching it
  // On iOS Safari during momentum scroll / bounce, the first tap only stops the scroll and fires no click;
  // taps at the bottom can also be swallowed when the toolbar is collapsed. So navigate on touch end, not on click.
  // Clear the highlight if the gesture is cancelled (becomes a scroll), or it looks stuck: "tab lit but page unchanged".
  const loc = useLocation()
  const navigate = useNavigate()
  const [pressed, setPressed] = useState<string | null>(null)
  useEffect(() => setPressed(null), [loc.pathname])
  return (
    // after: iOS 26 Safari lays the page out under its floating address bar but keeps `bottom: 0` above
    // it, so content would show through the gap below the tab bar — extend the bar's background down
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-ink pb-[env(safe-area-inset-bottom)] after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-40 after:bg-ink sm:hidden">
      <div className="grid grid-cols-5">
        {NAV.filter((n) => !('desktopOnly' in n)).map(({ to, short, Icon }) => (
          <NavLink
            key={to}
            to={to}
            onPointerDown={() => {
              setPressed(to)
              PREFETCH[to]?.()
            }}
            onPointerUp={(e) => {
              if (e.pointerType === 'mouse') return
              if (pressed === to && loc.pathname !== to) navigate(to)
            }}
            onPointerCancel={() => setPressed(null)}
            onPointerLeave={() => setPressed(null)}
            className={({ isActive }) =>
              `flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors duration-75 ${(pressed ? pressed === to : isActive) ? 'text-acid' : 'text-mute'}`
            }
          >
            <Icon className="h-5 w-5" strokeWidth={2} />
            {short}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

function AgentDot() {
  const status = useAgent((s) => s.status)
  const engine = useCoachEngine()
  const configs = useCloudConfigs()
  const cloud = engine?.mode === 'cloud' ? providerById(engine.provider) : undefined
  const on = cloud ? isConfigured(cloud, configs[cloud.id]) : status === 'ready'
  const color = on ? 'bg-good' : !cloud && status === 'unpaired' ? 'bg-warn' : 'bg-dim'
  const label = cloud
    ? `${cloud.label} 点评${on ? '' : '（未设置）'}`
    : status === 'ready'
      ? '本地 Agent 已连接'
      : status === 'unpaired'
        ? '待配对'
        : status === 'offline'
          ? '教练点评未设置'
          : '检测中'
  return (
    <NavLink to="/agent" aria-label={`教练点评：${label}`} className="chip min-h-9 min-w-9 justify-center hover:text-fg sm:min-h-0 sm:min-w-0">
      <span className="relative flex h-2 w-2">
        {on && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-60" />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
      </span>
      <span className="hidden sm:inline">{label}</span>
    </NavLink>
  )
}

/** When a workout is in progress, show a way back to it on other pages */
function ActiveWorkoutPill() {
  const loc = useLocation()
  const w = useLiveQuery(() => db.workouts.where('status').equals('active').last(), [])
  if (!w || loc.pathname === '/train' || loc.pathname === '/new') return null
  const total = w.items.reduce((n, it) => n + it.sets.length, 0)
  const done = w.items.reduce((n, it) => n + it.sets.filter(isSetDone).length, 0)
  return (
    <NavLink
      to="/train"
      className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-acid/50 bg-ink/90 px-4 py-2.5 text-sm shadow-lg backdrop-blur-xl sm:bottom-6"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-acid opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-acid" />
      </span>
      训练进行中 · {done}/{total} 组
      <ChevronRight size={14} className="text-acid" />
    </NavLink>
  )
}

function StaleAgentBanner() {
  const health = useAgent((s) => s.health)
  const status = useAgent((s) => s.status)
  if (status !== 'ready' || !isAgentStale(health)) return null
  return (
    <div className="border-b border-warn/30 bg-warn/10">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2 text-sm">
        <span className="text-warn">本地 agent 有新版本。</span>
        <span className="text-mute">在终端按 Ctrl+C 停掉旧的，再运行：</span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(AGENT_CMD)
            toast.success('已复制，粘贴到终端运行')
          }}
          className="min-w-0 max-w-full break-all rounded-lg border border-line bg-ink-2 px-2 py-1 text-left font-mono text-xs text-acid hover:border-acid/50"
        >
          {AGENT_CMD}
        </button>
        <span className="text-xs text-dim">设置过开机自启的，再运行一次「… install」即可。教练 skill 会自动同步，不需要更新。</span>
      </div>
    </div>
  )
}

function Shell() {
  const loc = useLocation()
  const load = useAgent((s) => s.load)
  useEffect(() => {
    // pair first (if opened from `npx liftlens-agent`), then load settings — avoids a stale-token race
    consumePairFragment()
      .then((paired) => {
        if (paired) toast.success('已连接本地 agent，可以请教练点评了')
      })
      .finally(load)
    prefetchAll()
    const t = setInterval(() => useAgent.getState().check(), 15000)
    return () => clearInterval(t)
  }, [load])

  return (
    <MotionConfig reducedMotion="user">
      <div className="noise min-h-dvh">
        <header className="sticky top-0 z-40 border-b border-line/70 bg-ink">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
            <NavLink to="/" className="mr-2 flex items-center gap-2 font-display text-lg font-extrabold tracking-tight">
              <svg viewBox="0 0 32 32" className="h-6 w-6">
                <circle cx="9" cy="16" r="5" fill="none" stroke="#c8ff3d" strokeWidth="2.5" />
                <circle cx="23" cy="16" r="5" fill="none" stroke="#c8ff3d" strokeWidth="2.5" />
                <path d="M4 16h24" stroke="#c8ff3d" strokeWidth="2.5" />
              </svg>
              LiftLens
            </NavLink>
            <nav className="hidden min-w-0 flex-1 gap-1 overflow-x-auto text-sm [scrollbar-width:none] sm:flex">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} className="relative shrink-0 rounded-full px-3 py-1.5 text-mute transition-colors hover:text-fg aria-[current=page]:text-fg">
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-full bg-panel-2" transition={{ type: 'spring', stiffness: 380, damping: 32 }} />
                      )}
                      <span className="relative">{n.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
            <div className="flex-1 sm:hidden" />
            <AgentDot />
          </div>
        </header>
        <StaleAgentBanner />
        {/* New page slides up and fades in; don't wait for the old one to exit (AnimatePresence mode=wait adds 0.3s per switch and can flash blank with lazy pages) */}
        <motion.main
          className="pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0"
          key={loc.pathname}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        >
          <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-20 text-mute">加载中…</div>}>
            <Outlet />
          </Suspense>
        </motion.main>
        <ActiveWorkoutPill />
        <BottomTabs />
        <Toaster theme="dark" position="top-center" richColors />
        {/* Scroll to top on page change (restore position on back); otherwise coming from the bottom of a long page leaves the new page at the bottom */}
        <ScrollRestoration />
      </div>
    </MotionConfig>
  )
}

function RouteError() {
  const err = useRouteError()
  const stale = isChunkLoadError(err)
  useEffect(() => {
    if (stale) reloadForNewVersion()
  }, [stale])
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="font-display text-2xl font-bold">{stale ? 'LiftLens 刚更新了' : '页面出错了'}</div>
      <p className="text-sm text-mute">
        {stale ? '这个页面还是旧版本，刷新一下就能用新版。你的训练记录都在，不受影响。' : String((err as Error)?.message ?? err)}
      </p>
      <button className="btn-acid" onClick={() => location.reload()}>
        刷新页面
      </button>
    </div>
  )
}

export const router = createBrowserRouter([
  {
    element: <Shell />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/train', element: <Train /> },
      { path: '/exercises', element: <Exercises /> },
      { path: '/new', element: <NewSession /> },
      { path: '/session/:id', element: <SessionDetail /> },
      { path: '/journal', element: <Journal /> },
      { path: '/progress', element: <Progress /> },
      { path: '/coaches', element: <Coaches /> },
      { path: '/agent', element: <AgentPage /> },
      { path: '/lab/figures', element: <FigureLab /> },
      { path: '/lab/muscles', element: <MuscleLab /> },
      { path: '/lab/live', element: <LiveLab /> },
    ],
  },
])
