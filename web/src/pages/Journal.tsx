import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'motion/react'
import { Plus, ChevronRight } from 'lucide-react'
import { db, todayISO } from '../lib/db'
import { LIFTS, e1rm } from '../lib/lifts'
import { Empty } from '../components/bits'
import { BackupPanel } from '../components/BackupPanel'
import type { LiftId, Session } from '../lib/types'
import { LIFT_COLOR, sessionName } from '../lib/exerciseRef'

const WEEKS = 20

export default function Journal() {
  const sessions = useLiveQuery(() => db.sessions.orderBy('createdAt').reverse().toArray(), [])
  const [filter, setFilter] = useState<LiftId | 'other' | 'all'>('all')
  const [selected, setSelected] = useState<string | null>(null)
  // Render only the last 14 days at first so long-time users don't see lag opening the journal
  const [shownDays, setShownDays] = useState(14)

  const byDate = useMemo(() => {
    const m = new Map<string, Session[]>()
    for (const s of sessions ?? []) {
      if (filter !== 'all' && s.lift !== filter) continue
      m.set(s.date, [...(m.get(s.date) ?? []), s])
    }
    return m
  }, [sessions, filter])

  // calendar cells: WEEKS columns × 7 rows ending this week
  const cells = useMemo(() => {
    const today = new Date()
    const end = new Date(today)
    end.setDate(today.getDate() + (6 - ((today.getDay() + 6) % 7)))
    const out: { date: string; future: boolean }[] = []
    for (let i = WEEKS * 7 - 1; i >= 0; i--) {
      const d = new Date(end)
      d.setDate(end.getDate() - i)
      out.push({ date: todayISO(d), future: d > today })
    }
    return out
  }, [])

  if (sessions === undefined) return null
  const days = [...byDate.keys()].filter((d) => !selected || d === selected)
  const streak = (() => {
    let n = 0
    const d = new Date()
    for (;;) {
      const iso = todayISO(d)
      if (byDate.has(iso)) n++
      else if (iso !== todayISO()) break
      d.setDate(d.getDate() - 1)
      if (n > 365) break
    }
    return n
  })()

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="kicker">TRAINING LOG</div>
          <h1 className="font-display mt-1 text-4xl font-bold tracking-tight">训练日志</h1>
        </div>
        <Link to="/train" className="btn-acid">
          <Plus size={16} /> 记录今天
        </Link>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="card min-w-0 p-5">
          <div className="kicker mb-3 flex flex-wrap justify-between gap-x-3">
            <span>最近 {WEEKS} 周</span>
            <span>
              {byDate.size} 个训练日 · 连续 <span className="text-acid">{streak}</span> 天
            </span>
          </div>
          <div ref={(el) => { if (el && !el.dataset.scrolled) { el.dataset.scrolled = '1'; el.scrollLeft = el.scrollWidth } }} className="-mx-1 overflow-x-auto p-1 [scrollbar-width:none]">
          <div className="grid w-max grid-flow-col grid-rows-7 gap-1.5 sm:gap-1">
            {cells.map((c, i) => {
              const list = byDate.get(c.date) ?? []
              const best = list.reduce((m, s) => Math.max(m, s.agent?.score ?? s.score), 0)
              const lift = list[0]?.lift
              return (
                <button
                  key={c.date}
                  disabled={!list.length}
                  onClick={() => setSelected(selected === c.date ? null : c.date)}
                  title={`${c.date}${list.length ? ` · ${list.length} 组 · 最高 ${best} 分` : ''}`}
                  className={`anim-pop h-5 w-5 rounded-[4px] transition-transform hover:scale-125 sm:h-3.5 sm:w-3.5 sm:rounded-[3px] ${c.future ? 'opacity-15' : ''} ${selected === c.date ? 'ring-2 ring-fg' : ''}`}
                  style={{ ['--d' as string]: `${i * 2}ms`, background: list.length ? LIFT_COLOR[lift!] : '#1a201d', opacity: list.length ? 0.35 + (best / 100) * 0.65 : undefined }}
                />
              )
            })}
          </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-dim">
            {(Object.keys(LIFT_COLOR) as (LiftId | 'other')[]).map((l) => (
              <span key={l} className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: LIFT_COLOR[l] }} /> {l === 'other' ? '其他动作' : LIFTS[l].name}
              </span>
            ))}
            <span>· 颜色越亮分数越高</span>
          </div>
        </div>
        <div className="card flex flex-row gap-1 p-2 md:flex-col">
          {(['all', 'bench', 'squat', 'deadlift', 'other'] as const).map((l) => (
            <button key={l} onClick={() => setFilter(l)} className={`relative rounded-xl px-4 py-2 text-sm ${filter === l ? 'text-fg' : 'text-mute'}`}>
              {filter === l && <motion.span layoutId="jfilter" className="absolute inset-0 rounded-xl bg-panel-2" />}
              <span className="relative">{l === 'all' ? '全部' : l === 'other' ? '其他' : LIFTS[l].name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8 space-y-8">
        {sessions.length === 0 && (
          <Empty title="还没有训练记录">
            上传第一段训练视频，分析结果会按天保存在浏览器本地（IndexedDB），之后可以在「能力」里看趋势。
          </Empty>
        )}
        <>
          {days.slice(0, shownDays).map((d, di) => (
            <section key={d} className="anim-rise" style={{ ['--d' as string]: `${Math.min(di, 8) * 50}ms` }}>
              <div className="mb-3 flex items-baseline gap-3">
                <h2 className="font-display text-xl font-bold">{d}</h2>
                <span className="text-xs text-dim">{new Date(d).toLocaleDateString('zh-CN', { weekday: 'long' })}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {byDate.get(d)!.map((s, i) => (
                  <div key={s.id} className="anim-rise" style={{ ['--d' as string]: `${Math.min(di, 8) * 50 + i * 50}ms` }}>
                    <Link to={`/session/${s.id}`} className="card group flex items-center gap-4 p-4 transition-colors hover:border-line-2">
                      <span className="h-10 w-1 rounded-full" style={{ background: LIFT_COLOR[s.lift] }} />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">
                          {sessionName(s)}
                          <span className="ml-2 font-mono text-sm text-mute">
                            {s.holdS != null ? `${Math.round(s.holdS)} 秒` : `${s.weightKg ?? '—'}kg × ${s.reps}`}
                          </span>
                        </div>
                        <div className="truncate text-xs text-dim">{s.agent?.summary ?? (s.notes || '仅程序测量')}</div>
                      </div>
                      <div className="text-right font-mono">
                        <div className={`text-xl ${(s.agent?.score ?? s.score) >= 80 ? 'text-good' : (s.agent?.score ?? s.score) >= 60 ? 'text-warn' : 'text-bad'}`}>{s.agent?.score ?? s.score}</div>
                        {e1rm(s.weightKg, s.reps) && <div className="text-[10px] text-dim">e1RM {e1rm(s.weightKg, s.reps)}</div>}
                      </div>
                      <ChevronRight size={16} className="text-dim transition-transform group-hover:translate-x-1" />
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {days.length > shownDays && (
            <button className="btn-ghost mx-auto flex" onClick={() => setShownDays((n) => n + 14)}>
              更早的记录（还有 {days.length - shownDays} 天）
            </button>
          )}
        </>
      </div>
      <BackupPanel />
    </div>
  )
}
