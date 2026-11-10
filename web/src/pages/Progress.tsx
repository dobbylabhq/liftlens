import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'motion/react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts'
import { TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { db, getSetting, setSetting } from '../lib/db'
import { LIFTS, e1rm } from '../lib/lifts'
import { coachById } from '../lib/coaches'
import { CoachPanel } from '../components/CoachPanel'
import { Empty, SourceChip } from '../components/bits'
import type { AgentProgressResult, LiftId, Session } from '../lib/types'
import { LIFT_COLOR, isBig3, sessionMuscles, sessionName } from '../lib/exerciseRef'
import { exerciseMuscleWeights } from '../lib/muscles'
import { MuscleVolumeMap } from '../components/MuscleMap'
import { todayISO } from '../lib/db'
import { isSetDone, isHoldItem, type PlanItem, type Workout } from '../lib/workout'

/** Tabs: the big three + other exercises trained (by library id) */
type Key = LiftId | `ex:${string}`
const keyOf = (s: Session): Key => (isBig3(s.lift) ? s.lift : (`ex:${s.exercise?.id ?? 'unknown'}` as Key))
/** Exercise in a workout plan: big three by lift, library exercises by id, custom-named ones by name */
const itemKey = (it: PlanItem): Key => (isBig3(it.lift) ? it.lift : (`ex:${it.exercise?.id ?? `name:${it.name}`}` as Key))

/** Sets logged as done in workout mode without video (filmed sets are already sessions, so not double-counted) */
interface ManualSet {
  key: Key
  name: string
  date: string
  weightKg: number | null
  reps: number
  hold: boolean
  muscles: { target: string; secondary: string[] } | null
}
function manualSets(workouts: Workout[]): ManualSet[] {
  const out: ManualSet[] = []
  for (const w of workouts)
    for (const it of w.items) {
      const hold = isHoldItem(it)
      const muscles = it.exercise ? sessionMuscles({ lift: it.lift, exercise: it.exercise }) : isBig3(it.lift) ? sessionMuscles({ lift: it.lift }) : null
      for (const s of it.sets) {
        if (s.sessionId != null || !isSetDone(s)) continue
        const date = s.at ? todayISO(new Date(s.at)) : w.date
        out.push({ key: itemKey(it), name: it.name, date, weightKg: s.weightKg, reps: s.repsDone ?? s.reps, hold, muscles })
      }
    }
  return out
}

const colorOf = (k: Key) => (k.startsWith('ex:') ? LIFT_COLOR.other : LIFT_COLOR[k as LiftId])
/** Draw the title and tabs first, mount charts on the next frame (first chart render is heavy; don't block the page on tab switch) */
function useAfterPaint() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let id2 = 0
    const id = requestAnimationFrame(() => (id2 = requestAnimationFrame(() => setReady(true))))
    return () => {
      cancelAnimationFrame(id)
      cancelAnimationFrame(id2)
    }
  }, [])
  return ready
}
const tooltip = { contentStyle: { background: '#141917', border: '1px solid #252d29', borderRadius: 12, fontSize: 12 } }

export default function Progress() {
  const sessions = useLiveQuery(() => db.sessions.orderBy('createdAt').toArray(), [])
  const workouts = useLiveQuery(() => db.workouts.toArray(), [])
  const manual = useMemo(() => manualSets(workouts ?? []), [workouts])
  const reports = useLiveQuery(() => db.reports.orderBy('createdAt').reverse().limit(1).toArray(), [])
  const [lift, setLift] = useState<Key>('bench')
  const ready = useAfterPaint()
  const tabs = useMemo(() => {
    const seen = new Map<Key, string>((Object.keys(LIFTS) as LiftId[]).map((l) => [l, LIFTS[l].name]))
    for (const s of sessions ?? []) if (!isBig3(s.lift) && s.exercise) seen.set(keyOf(s), sessionName(s))
    for (const m of manual) if (!seen.has(m.key)) seen.set(m.key, m.name)
    return [...seen.entries()]
  }, [sessions, manual])
  const label = tabs.find(([k]) => k === lift)?.[1] ?? ''
  // Effective sets per muscle over the last 7 days (primary = 1 set, secondary = 0.5)
  const week = useMemo(() => {
    const from = todayISO(new Date(Date.now() - 6 * 86400000))
    const muscles = [
      ...(sessions ?? []).filter((s) => s.date >= from).map((s) => sessionMuscles(s)),
      ...manual.filter((m) => m.date >= from).map((m) => m.muscles),
    ]
    return muscles.filter((m) => m != null).map((m) => ({ weights: exerciseMuscleWeights(m.target, m.secondary), sets: 1 }))
  }, [sessions, manual])
  const [coach, setCoach] = useState('coach-eastern-periodization')

  // Aggregate per day: e1RM = best set of the day, form score = average of filmed sets (unfilmed sets have none), volume = sum
  const series = useMemo(() => {
    const days = new Map<string, { e1rm: number | null; scores: number[]; volume: number }>()
    const add = (date: string, e: number | null, score: number | null, volume: number) => {
      const d = days.get(date) ?? { e1rm: null, scores: [], volume: 0 }
      if (e != null) d.e1rm = Math.max(d.e1rm ?? 0, e)
      if (score != null) d.scores.push(score)
      d.volume += volume
      days.set(date, d)
    }
    for (const s of sessions ?? []) if (keyOf(s) === lift) add(s.date, s.holdS != null ? null : e1rm(s.weightKg, s.reps), s.agent?.score ?? s.score, (s.weightKg ?? 0) * s.reps)
    for (const m of manual) if (m.key === lift) add(m.date, m.hold ? null : e1rm(m.weightKg, m.reps), null, m.hold ? 0 : (m.weightKg ?? 0) * m.reps)
    return [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date: date.slice(5),
        e1rm: d.e1rm,
        score: d.scores.length ? Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length) : null,
        volume: d.volume,
      }))
  }, [sessions, manual, lift])

  const issues = useMemo(() => {
    const count = new Map<string, { title: string; n: number; bad: number }>()
    for (const s of sessions ?? []) {
      if (keyOf(s) !== lift) continue
      for (const f of s.issues ?? []) {
        const cur = count.get(f.id) ?? { title: f.title, n: 0, bad: 0 }
        cur.n++
        if (f.severity === 'bad') cur.bad++
        count.set(f.id, cur)
      }
    }
    return [...count.values()].sort((a, b) => b.n - a.n).slice(0, 6)
  }, [sessions, lift])

  if (!sessions) return null
  const report = reports?.[0]

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="kicker">ABILITY</div>
      <h1 className="font-display mt-1 text-4xl font-bold tracking-tight">能力曲线</h1>

      {ready && week.length > 0 && (
        <div className="card mt-6 p-4">
          <MuscleVolumeMap entries={week} title="最近 7 天练到的肌肉" />
        </div>
      )}

      <div className="-mx-4 mt-6 overflow-x-auto px-4 [scrollbar-width:none]">
        <div className="flex w-max gap-1 rounded-full border border-line bg-ink-2 p-1">
          {tabs.map(([k, name]) => (
            <button key={k} onClick={() => setLift(k)} className={`relative h-9 shrink-0 whitespace-nowrap rounded-full px-5 text-sm ${lift === k ? 'text-acid-ink' : 'text-mute'}`}>
              {lift === k && <motion.span layoutId="plift" className="absolute inset-0 rounded-full" style={{ background: colorOf(k) }} />}
              <span className="relative">{name}</span>
            </button>
          ))}
        </div>
      </div>

      {!ready ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="card h-[19rem] animate-pulse" />
          <div className="card h-[19rem] animate-pulse" />
        </div>
      ) : series.length === 0 ? (
        <div className="mt-8">
          <Empty title={`还没有${label}记录`}>记录 2 次以上就能看到趋势。</Empty>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <ChartCard title="预估 1RM（Epley）与动作分">
            <LineChart data={series} margin={{ left: -20, right: 8, top: 8 }}>
              <CartesianGrid stroke="#1a201d" />
              <XAxis dataKey="date" tick={{ fill: '#5c6862', fontSize: 11 }} stroke="#252d29" />
              <YAxis yAxisId="kg" tick={{ fill: '#5c6862', fontSize: 11 }} stroke="#252d29" />
              <YAxis yAxisId="sc" orientation="right" domain={[0, 100]} tick={{ fill: '#5c6862', fontSize: 11 }} stroke="#252d29" />
              <Tooltip {...tooltip} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="kg" type="monotone" dataKey="e1rm" name="e1RM kg" stroke={colorOf(lift)} strokeWidth={2.2} dot={{ r: 3 }} connectNulls animationDuration={900} />
              <Line yAxisId="sc" type="monotone" dataKey="score" name="动作分" stroke="#7aa2ff" strokeWidth={1.6} strokeDasharray="4 3" dot={false} connectNulls animationDuration={900} />
            </LineChart>
          </ChartCard>
          {issues.length === 0 ? (
            <div className="card flex flex-col p-4">
              <div className="kicker mb-3">反复出现的问题</div>
              <div className="flex flex-1 items-center justify-center py-10 text-center text-sm text-mute">拍了视频的组才会检查动作问题；只记录完成的组不统计。</div>
            </div>
          ) : (
          <ChartCard title="反复出现的问题">
            <BarChart data={issues} layout="vertical" margin={{ left: 40, right: 12 }}>
              <XAxis type="number" allowDecimals={false} tick={{ fill: '#5c6862', fontSize: 11 }} stroke="#252d29" />
              <YAxis type="category" dataKey="title" width={110} tick={{ fill: '#8a968f', fontSize: 11 }} stroke="#252d29" />
              <Tooltip {...tooltip} />
              <Bar dataKey="n" name="出现次数" fill="#ffb84d" radius={[0, 6, 6, 0]} animationDuration={900} />
            </BarChart>
          </ChartCard>
          )}
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-6">
          <ProfileCard />
          <CoachPanel
            kind="progress"
            coachId={coach}
            onCoach={setCoach}
            cta="生成能力报告"
            build={async () => {
              const profile = Object.fromEntries((await db.settings.toArray()).filter((s) => s.key.startsWith('profile.')).map((s) => [s.key.slice(8), s.value]))
              return {
                payload: {
                  user: profile,
                  sessions: sessions.slice(-60).map((s) => ({
                    date: s.date,
                    lift: s.lift,
                    exercise: sessionName(s),
                    weightKg: s.weightKg,
                    reps: s.reps,
                    rpe: s.rpe,
                    e1rm: e1rm(s.weightKg, s.reps),
                    score: s.agent?.score ?? s.score,
                    issues: (s.issues ?? []).map((f) => f.id),
                    coachSummary: s.agent?.summary ?? null,
                  })),
                },
                images: [],
              }
            }}
            onResult={async (out, meta) => {
              await db.reports.add({ createdAt: Date.now(), coachId: meta.coachId, rangeDays: 60, result: out as AgentProgressResult })
            }}
          />
        </div>
        {report ? <ReportView r={report.result} coachId={report.coachId} at={report.createdAt} /> : <Empty title="还没有能力报告">积累几次训练后，让本地教练基于全部记录分析强项、短板和接下来 2–4 周的计划。</Empty>}
      </div>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card p-4">
      <div className="kicker mb-3">{title}</div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </motion.div>
  )
}

const FIELDS = [
  ['heightCm', '身高 (cm)', 'number'],
  ['bodyweightKg', '体重 (kg)', 'number'],
  ['trainingYears', '训练年限', 'number'],
  ['goal', '目标（增肌 / 力量 / 比赛 / 健康）', 'text'],
  ['injuries', '伤病史（例如 右肩前侧不适）', 'text'],
] as const

function ProfileCard() {
  const [vals, setVals] = useState<Record<string, string>>({})
  useEffect(() => {
    Promise.all(FIELDS.map(([k]) => getSetting(`profile.${k}`, ''))).then((vs) => setVals(Object.fromEntries(FIELDS.map(([k], i) => [k, String(vs[i] ?? '')]))))
  }, [])
  return (
    <div className="card p-5">
      <div className="kicker mb-3">个人档案（用于个体化判断）</div>
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map(([k, label, type]) => (
          <label key={k} className={type === 'text' ? 'sm:col-span-2' : ''}>
            <span className="mb-1 block text-xs text-mute">{label}</span>
            <input
              className="input"
              type={type}
              value={vals[k] ?? ''}
              onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))}
              onBlur={(e) => setSetting(`profile.${k}`, type === 'number' && e.target.value ? Number(e.target.value) : e.target.value)}
            />
          </label>
        ))}
      </div>
    </div>
  )
}

function ReportView({ r, coachId, at }: { r: AgentProgressResult; coachId: string; at: number }) {
  const coach = coachById(coachId)
  const Icon = { up: TrendingUp, down: TrendingDown, flat: Minus }
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card overflow-hidden">
      <div className="border-b border-line p-5" style={{ background: coach ? `linear-gradient(120deg, ${coach.accent}18, transparent 60%)` : undefined }}>
        <div className="text-sm" style={{ color: coach?.accent }}>
          {coach?.flag} {coach?.displayName} · {new Date(at).toLocaleDateString()}
        </div>
        <div className="font-display mt-2 text-2xl font-bold">{r.headline}</div>
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <List title="强项" items={r.strengths} dot="bg-good" />
        <List title="短板" items={r.weaknesses} dot="bg-warn" />
      </div>
      <div className="space-y-2 px-5">
        {r.trends.map((t, i) => {
          const I = Icon[t.direction]
          return (
            <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }} className="flex items-start gap-3 rounded-xl bg-ink-2 p-3 text-sm">
              <I size={16} className={t.direction === 'up' ? 'text-good' : t.direction === 'down' ? 'text-bad' : 'text-mute'} />
              <span className="font-semibold">{t.lift}</span>
              <span className="text-mute">{t.observation}</span>
            </motion.div>
          )
        })}
      </div>
      <div className="p-5">
        <div className="kicker mb-2 text-acid">接下来 2–4 周</div>
        <ol className="space-y-1.5 text-sm">
          {r.plan.map((p, i) => (
            <li key={i} className="flex gap-2">
              <span className="font-mono text-acid">{String(i + 1).padStart(2, '0')}</span>
              {p}
            </li>
          ))}
        </ol>
        <div className="mt-4 flex flex-wrap gap-1">
          {r.sourceIds.map((s) => (
            <SourceChip key={s} id={s} />
          ))}
        </div>
      </div>
    </motion.div>
  )
}

function List({ title, items, dot }: { title: string; items: string[]; dot: string }) {
  return (
    <div>
      <div className="kicker mb-2">{title}</div>
      <ul className="space-y-1.5 text-sm">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
            {s}
          </li>
        ))}
      </ul>
    </div>
  )
}
