import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'motion/react'
import { Camera, Check, ChevronRight, ClipboardPaste, Flag, HardDrive, ImagePlus, Loader2, Minus, PencilLine, Plus, Radio, Search, Timer, Trash2 } from 'lucide-react'
import { ExercisePicker } from '../components/ExercisePicker'
import { LiveSet, type LiveResult } from '../components/LiveSet'
import { ALIAS_IDS, BIG3_IDS, getExercise, loadExercises, searchExercises } from '../lib/exercises'
import { BIG3_PATTERN, refOf, type ExerciseRef } from '../lib/exerciseRef'
import { PATTERNS } from '../lib/movement/patterns'
import type { ExerciseInfo } from '../lib/movement/types'
import { toast } from 'sonner'
import { db, getSetting, setSetting, todayISO } from '../lib/db'
import { type Phase } from '../lib/pipeline'
import { cancelJobs, dismissJob, enqueueAnalysis, previews, setLiveActive, useAnalysisQueue } from '../lib/analysisQueue'
import type { PoseModelId } from '../lib/pose'
import type { LiftId, Session } from '../lib/types'
import {
  PLAN_LIFTS,
  adviseNextSet,
  isSetDone,
  lastFinishedAt,
  nextSet,
  parsePlan,
  isHoldItem,
  type PlanItem,
  type PlanLift,
  type PlannedSet,
  type Workout,
} from '../lib/workout'

const TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
const scoreColor = (s: number) => (s >= 80 ? 'text-good' : s >= 60 ? 'text-warn' : 'text-bad')

export default function Train() {
  // undefined = loading, null = no workout in progress
  const active = useLiveQuery(() => db.workouts.where('status').equals('active').last().then((w) => w ?? null), [])
  const [finishedId, setFinishedId] = useState<number | null>(null)
  if (active === undefined) return null
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
      {active ? (
        <ActiveWorkout w={active} onFinish={(id) => setFinishedId(id)} />
      ) : finishedId ? (
        <Summary id={finishedId} onNew={() => setFinishedId(null)} />
      ) : (
        <PlanEditor />
      )}
    </div>
  )
}

// ------------------------------------------------------------------ Plan editing

interface Row {
  lift: PlanLift
  name: string
  exercise?: ExerciseRef
  sets: number
  reps: number
  kg: string
}
const toRows = (items: PlanItem[]): Row[] =>
  items.map((it) => ({
    lift: it.lift,
    name: it.name,
    exercise: it.exercise,
    sets: it.sets.length,
    reps: it.sets[0]?.reps ?? 5,
    kg: it.sets[0]?.weightKg != null ? String(it.sets[0].weightKg) : '',
  }))

/** Library selection → plan row (big three map back to LiftId for dedicated analysis) */
function rowFromExercise(ex: ExerciseInfo, prev?: Row): Row {
  const big = ex.big3 ?? (Object.entries(BIG3_IDS).find(([, id]) => id === ex.id)?.[0] as LiftId | undefined)
  const hold = !!ex.hold
  return {
    lift: big ?? 'other',
    name: big ? PLAN_LIFTS[big] : ex.zh,
    exercise: big ? undefined : refOf(ex),
    sets: prev?.sets ?? (hold ? 3 : 4),
    reps: hold ? (prev?.exercise?.hold ? prev.reps : 30) : prev && !prev.exercise?.hold ? prev.reps : 8,
    kg: hold ? '' : (prev?.kg ?? ''),
  }
}

/** Match "other" exercises from pasted text to the library where possible */
async function matchLibrary(items: PlanItem[]): Promise<PlanItem[]> {
  if (!items.some((it) => it.lift === 'other')) return items
  const list = await loadExercises()
  return items.map((it) => {
    if (it.lift !== 'other') return it
    const alias = ALIAS_IDS[it.name]
    const aliased = alias ? list.find((e) => e.id === alias) : undefined
    if (aliased) return { ...it, exercise: { ...refOf(aliased), name: it.name } }
    // Priority: exact Chinese name → shortest name containing the input (most basic variant) → longest name contained in the input
    const top = searchExercises(list, it.name).slice(0, 40)
    const hit =
      top.find((e) => e.zh === it.name) ??
      top.filter((e) => e.zh.includes(it.name)).sort((a, b) => a.zh.length - b.zh.length)[0] ??
      top.filter((e) => it.name.includes(e.zh)).sort((a, b) => b.zh.length - a.zh.length)[0]
    if (!hit) return it
    return { ...it, name: hit.zh, exercise: refOf(hit) }
  })
}

function PlanEditor() {
  const [rows, setRows] = useState<Row[]>([])
  // Coming from the library's "add to today's workout": /train?add=<id>
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const id = params.get('add')
    if (!id) return
    getExercise(id).then((ex) => {
      if (ex) setRows((rs) => [...rs, rowFromExercise(ex, rs.at(-1))])
      setParams({}, { replace: true })
    })
  }, [params, setParams])
  const [text, setText] = useState('')
  const [picker, setPicker] = useState<number | 'new' | null>(null)
  const last = useLiveQuery(() => db.workouts.orderBy('createdAt').last(), [])
  const upd = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const start = async () => {
    const items: PlanItem[] = rows
      .filter((r) => r.sets > 0 && r.reps > 0)
      .map((r) => ({
        lift: r.lift,
        name: r.lift === 'other' ? r.exercise?.name ?? (r.name.trim() || '其他动作') : PLAN_LIFTS[r.lift],
        ...(r.exercise ? { exercise: r.exercise } : {}),
        sets: Array.from({ length: r.sets }, () => ({ reps: r.reps, weightKg: r.kg ? Number(r.kg) : null })),
      }))
    if (!items.length) return toast.error('先添加至少一个动作')
    await db.workouts.add({ date: todayISO(), createdAt: Date.now(), status: 'active', items })
  }

  return (
    <div>
      <div className="kicker">TRAINING</div>
      <h1 className="font-display mt-1 text-3xl font-bold tracking-tight sm:text-4xl">开始今天的训练</h1>
      <p className="mt-2 text-sm text-mute">
        先填好计划，练的时候每组用手机拍一段（或开实时模式边练边数），组间就能看到这一组的问题和下一组建议。不想拍也行：训练中切到「只记录」，每组记下重量和次数，当训练日志用。动作库有 1300+ 个动作，800 多个支持视频分析。
      </p>
      <DataNote className="mt-3" />

      <div className="card mt-6 p-4">
        <div className="kicker mb-2 flex items-center gap-1.5">
          <ClipboardPaste size={12} /> 粘贴计划（每行一个动作）
        </div>
        <textarea
          className="input h-24 py-2 font-mono text-sm"
          placeholder={'卧推 5x5 60kg\n哑铃弯举 3x12 10kg\n引体向上 3x8\n平板支撑 3x45'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            className="btn-ghost h-10"
            onClick={async () => {
              const parsed = parsePlan(text)
              if (!parsed.length) return toast.error('没认出来，试试「卧推 5x5 60kg」这种写法')
              const items = await matchLibrary(parsed)
              setRows((rs) => [...rs, ...toRows(items)])
              setText('')
              const unknown = items.filter((it) => it.lift === 'other' && !it.exercise).length
              toast.success(`识别出 ${items.length} 个动作${unknown ? `，${unknown} 个没在动作库里找到（可以点名字重新选）` : ''}`)
            }}
          >
            识别
          </button>
          {last && !rows.length && (
            <button className="btn-ghost h-10" onClick={() => setRows(toRows(last.items))}>
              用上次的计划（{last.date}）
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <AnimatePresence initial={false}>
          {rows.map((r, i) => {
            const hold = !!r.exercise?.hold
            const analyzable = r.lift !== 'other' || !!r.exercise?.pattern
            return (
              <motion.div key={i} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="card p-4">
                <div className="flex items-start gap-2">
                  <button onClick={() => setPicker(i)} className="group min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-lg font-semibold group-hover:text-acid">{r.lift === 'other' ? (r.exercise?.name ?? (r.name || '选择动作')) : PLAN_LIFTS[r.lift]}</span>
                      <ChevronRight size={15} className="shrink-0 text-dim" />
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px]">
                      {analyzable ? (
                        <span className="chip h-6 border-acid/40 text-acid">可视频分析{r.lift !== 'other' ? ' · 深度' : ''}</span>
                      ) : (
                        <span className="chip h-6">只记录次数</span>
                      )}
                      {r.exercise?.pattern && <span className="chip h-6">{PATTERNS[r.exercise.pattern].zh}</span>}
                      {r.exercise?.unilateral && <span className="chip h-6">单侧</span>}
                    </div>
                  </button>
                  <button aria-label="删除这个动作" className="flex h-10 w-10 shrink-0 items-center justify-center text-dim hover:text-bad" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <NumField label="组数" value={r.sets} onChange={(v) => upd(i, { sets: Math.max(1, Math.min(20, v)) })} />
                  <NumField label={hold ? '每组秒数' : r.exercise?.unilateral ? '每侧次数' : '每组次数'} value={r.reps} step={hold ? 5 : 1} onChange={(v) => upd(i, { reps: Math.max(1, Math.min(hold ? 600 : 50, v)) })} />
                  <label className="block">
                    <span className="mb-1 block text-xs text-mute">重量 kg</span>
                    <input className="input text-center font-mono" inputMode="decimal" placeholder="可不填" value={r.kg} onChange={(e) => upd(i, { kg: e.target.value.replace(/[^\d.]/g, '') })} />
                  </label>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
        <div className="grid grid-cols-4 gap-2">
          {(['bench', 'squat', 'deadlift'] as LiftId[]).map((l) => (
            <button
              key={l}
              className="flex min-h-12 items-center justify-center gap-1 rounded-2xl border border-dashed border-line-2 text-sm text-mute hover:text-fg"
              onClick={() => setRows((rs) => [...rs, { lift: l, name: PLAN_LIFTS[l], sets: 5, reps: 5, kg: '' }])}
            >
              <Plus size={14} /> {PLAN_LIFTS[l]}
            </button>
          ))}
          <button
            className="flex min-h-12 items-center justify-center gap-1 rounded-2xl border border-dashed border-acid/50 text-sm text-acid hover:bg-acid/5"
            onClick={() => setPicker('new')}
          >
            <Search size={14} /> 动作库
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button className="btn-acid h-12 px-6 text-base" disabled={!rows.length} onClick={start}>
          <Flag size={16} /> 开始训练
        </button>
        <Link to="/new" className="text-sm text-dim hover:text-fg">
          只想分析一段已有的视频？→ 上传分析
        </Link>
      </div>

      <ExercisePicker
        open={picker !== null}
        onClose={() => setPicker(null)}
        onSelect={(ex) => {
          if (picker === 'new') setRows((rs) => [...rs, rowFromExercise(ex, rs.at(-1))])
          else if (typeof picker === 'number') setRows((rs) => rs.map((r, j) => (j === picker ? rowFromExercise(ex, r) : r)))
          setPicker(null)
        }}
      />
    </div>
  )
}

function NumField({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div>
      <span className="mb-1 block text-xs text-mute">{label}</span>
      <div className="flex items-center rounded-xl border border-line bg-ink-2">
        <button aria-label={`减少${label}`} className="flex h-10 w-9 items-center justify-center text-dim hover:text-fg" onClick={() => onChange(value - step)}>
          <Minus size={14} />
        </button>
        <span className="flex-1 text-center font-mono">{value}</span>
        <button aria-label={`增加${label}`} className="flex h-10 w-9 items-center justify-center text-dim hover:text-fg" onClick={() => onChange(value + step)}>
          <Plus size={14} />
        </button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ In progress

type Sel = { item: number; set: number }

function ActiveWorkout({ w, onFinish }: { w: Workout; onFinish: (id: number) => void }) {
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const id = params.get('add')
    if (!id) return
    getExercise(id).then(async (ex) => {
      if (ex) {
        const r = rowFromExercise(ex)
        const item: PlanItem = { lift: r.lift, name: r.name, ...(r.exercise ? { exercise: r.exercise } : {}), sets: Array.from({ length: r.sets }, () => ({ reps: r.reps, weightKg: null })) }
        await db.workouts.update(w.id!, { items: [...w.items, item] })
        toast.success(`已把「${r.name}」加到今天的训练`)
      }
      setParams({}, { replace: true })
    })
  }, [params, setParams, w])
  const logOnly = useLiveQuery(() => getSetting(LOG_ONLY_KEY, false), [], false)
  const next = nextSet(w)
  const [sel, setSel] = useState<Sel | null>(next)
  // Don't auto-advance when the selected set completes (show the result first); with no selection, follow the next set
  const cur = sel ?? next
  const total = w.items.reduce((n, it) => n + it.sets.length, 0)
  const done = w.items.reduce((n, it) => n + it.sets.filter(isSetDone).length, 0)
  const ids = w.items.flatMap((it) => it.sets.map((s) => s.sessionId).filter((x): x is number => x != null))
  const sessions = useLiveQuery(() => db.sessions.bulkGet(ids), [ids.join(',')])
  const byId = useMemo(() => new Map((sessions ?? []).filter(Boolean).map((s) => [s!.id!, s!])), [sessions])

  const jobs = useAnalysisQueue((q) => q.jobs)
  // read-modify-write on the *stored* workout: a set analysed in the background finishes later,
  // and must not overwrite sets recorded in the meantime with this render's stale copy
  const saveSet = (at: Sel, patch: Partial<PlannedSet>) =>
    db.transaction('rw', db.workouts, async () => {
      const cur = await db.workouts.get(w.id!)
      if (!cur) return
      await db.workouts.update(w.id!, {
        items: cur.items.map((it, i) => (i !== at.item ? it : { ...it, sets: it.sets.map((s, j) => (j === at.set ? { ...s, ...patch } : s)) })),
      })
    })

  const finish = async () => {
    if (done < total && !confirm(`还有 ${total - done} 组没完成，确定结束训练？`)) return
    await db.workouts.update(w.id!, { status: 'done', finishedAt: Date.now() })
    onFinish(w.id!)
  }

  /** throw the whole workout away: plan, recorded sets, their analyses — nothing goes into the log */
  const discard = async () => {
    if (!confirm('放弃这次训练？计划和已经记录、拍摄的组都会删除，不会出现在训练日志里。')) return
    cancelJobs(`${w.id}-`)
    await db.transaction('rw', db.workouts, db.sessions, db.clips, async () => {
      const ids = (await db.sessions.toArray()).filter((s) => s.workout?.id === w.id).map((s) => s.id!)
      await db.clips.where('sessionId').anyOf(ids).delete()
      await db.sessions.bulkDelete(ids)
      await db.workouts.delete(w.id!)
    })
    toast('已放弃这次训练，没有留下记录')
  }

  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="kicker flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-acid opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-acid" />
            </span>
            训练中 · {w.date}
          </div>
          <h1 className="font-display mt-1 text-3xl font-bold tracking-tight">
            {done}/{total} <span className="text-lg text-mute">组</span>
          </h1>
        </div>
        <RestTimer since={lastFinishedAt(w)} />
        <button className="btn-ghost h-10" onClick={finish}>
          结束
        </button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel-2">
        <motion.div className="h-full bg-acid" animate={{ width: `${(done / Math.max(1, total)) * 100}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-ink-2 p-1 text-xs" role="tablist" aria-label="每组的记录方式">
          {([false, true] as const).map((v) => (
            <button
              key={String(v)}
              role="tab"
              aria-selected={logOnly === v}
              onClick={() => setSetting(LOG_ONLY_KEY, v)}
              className={`rounded-lg px-3 py-1.5 transition-colors ${logOnly === v ? 'bg-panel-2 text-fg' : 'text-mute hover:text-fg'}`}
            >
              {v ? '只记录' : '拍视频分析'}
            </button>
          ))}
        </div>
        <button className="flex items-center gap-1 text-xs text-dim hover:text-bad" onClick={discard}>
          <Trash2 size={12} /> 放弃这次训练（不记录）
        </button>
      </div>

      <div className="mt-6 space-y-4">
        {w.items.map((it, i) => (
          <div key={i}>
            <div className="mb-2 flex items-baseline gap-2">
              <span className="font-semibold">{it.name}</span>
              <span className="font-mono text-xs text-dim">
                {it.sets.length}×{it.sets[0]?.reps}
                {it.sets[0]?.weightKg ? ` · ${it.sets[0].weightKg}kg` : ''}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {it.sets.map((s, j) => {
                const ses = s.sessionId != null ? byId.get(s.sessionId) : undefined
                const on = cur?.item === i && cur?.set === j
                return (
                  <button
                    key={j}
                    onClick={() => setSel({ item: i, set: j })}
                    className={`flex h-12 min-w-12 flex-col items-center justify-center rounded-xl border px-2 font-mono text-xs transition-colors ${
                      on ? 'border-acid bg-acid/10' : isSetDone(s) ? 'border-line-2 bg-panel' : 'border-dashed border-line-2 text-dim'
                    }`}
                  >
                    {!ses && jobs[`${w.id}-${i}-${j}`]?.status !== 'error' && jobs[`${w.id}-${i}-${j}`] ? (
                      <>
                        <Loader2 size={14} className="animate-spin text-acid" />
                        <span className="text-[10px] text-dim">{jobs[`${w.id}-${i}-${j}`].status === 'queued' ? '排队' : '分析中'}</span>
                      </>
                    ) : ses ? (
                      <>
                        <span className={`text-sm ${scoreColor(ses.score)}`}>{ses.score}</span>
                        <span className="text-[10px] text-dim">{ses.reps} 次</span>
                      </>
                    ) : s.done ? (
                      <>
                        <Check size={14} className="text-good" />
                        <span className="text-[10px] text-dim">{s.repsDone ?? s.reps} 次</span>
                      </>
                    ) : (
                      <span className={on ? 'text-acid' : ''}>{j + 1}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {cur && (
        <SetPanel
          key={`${cur.item}-${cur.set}`}
          w={w}
          at={cur}
          session={(() => {
            const id = w.items[cur.item]?.sets[cur.set]?.sessionId
            return id != null ? byId.get(id) : undefined
          })()}
          logOnly={logOnly}
          onSave={(patch) => saveSet(cur, patch)}
          onNext={() => setSel(nextSet(w))}
        />
      )}
      {!next && (
        <div className="card mt-6 p-5 text-center">
          <div className="font-semibold">计划里的组都完成了</div>
          <button className="btn-acid mt-3" onClick={finish}>
            结束训练，看总结
          </button>
        </div>
      )}
      <DataNote className="mt-8" />
    </div>
  )
}

/** per-browser preference: log sets by hand by default instead of filming them */
const LOG_ONLY_KEY = 'train.logOnly'

/** Where training data lives — said plainly wherever the user creates it. */
function DataNote({ className = '' }: { className?: string }) {
  return (
    <p className={`flex items-start gap-1.5 text-xs leading-relaxed text-dim ${className}`}>
      <HardDrive size={12} className="mt-0.5 shrink-0" />
      <span>
        训练计划、每组记录和拍的视频只保存在<b className="font-medium text-mute">这个浏览器</b>里（本地数据库），不会上传到任何服务器。换手机、换浏览器或清除网站数据会丢失，记得在
        <Link to="/journal" className="text-acid hover:underline">
          训练日志
        </Link>
        里导出备份。
      </span>
    </p>
  )
}

function RestTimer({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!since) return null
  const s = Math.max(0, Math.floor((now - since) / 1000))
  if (s > 30 * 60) return null
  return (
    <div className="text-right">
      <div className="kicker flex items-center justify-end gap-1">
        <Timer size={11} /> 组间休息
      </div>
      <div className={`font-mono text-2xl ${s >= 180 ? 'text-warn' : 'text-fg'}`}>
        {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
      </div>
    </div>
  )
}

const PHASE_LABEL: Record<Phase, string> = {
  model: '加载姿态模型',
  pose: '逐帧识别骨架',
  rules: '分次 & 规则判定',
  keyframes: '生成关键帧',
  save: '保存',
  done: '完成',
}

function SetPanel({
  w,
  at,
  session,
  logOnly,
  onSave,
  onNext,
}: {
  w: Workout
  at: Sel
  session: Session | undefined
  logOnly: boolean
  onSave: (patch: Partial<PlannedSet>) => Promise<unknown>
  onNext: () => void
}) {
  const item = w.items[at.item]
  const planned = item.sets[at.set]
  const [kg, setKg] = useState<number | null>(planned.weightKg)
  // "只记录" mode starts every set on manual entry; a single set can still be filmed
  const [manual, setManual] = useState(logOnly)
  const [manualReps, setManualReps] = useState(planned.reps)
  const preview = useRef<HTMLCanvasElement>(null)
  const isLast = at.set === item.sets.length - 1
  const canAnalyze = item.lift !== 'other' || !!item.exercise?.pattern
  const hold = isHoldItem(item)
  const unit = hold ? '秒' : '次'

  const jobKey = `${w.id}-${at.item}-${at.set}`
  const job = useAnalysisQueue((q) => q.jobs[jobKey])
  useEffect(() => {
    const c = preview.current
    if (c) previews.set(jobKey, c)
    return () => {
      if (previews.get(jobKey) === c) previews.delete(jobKey)
    }
  })

  /** queue the video; the set counts as done right away so the next set can start while this one is analysed */
  const analyze = async (file: File, liveReps?: number) => {
    if (!canAnalyze) return
    await onSave({ done: true, repsDone: liveReps, weightKg: kg, at: Date.now() })
    const model = await getSetting<PoseModelId>('poseModel', TOUCH ? 'lite' : 'full')
    enqueueAnalysis(
      jobKey,
      `${item.name} 第 ${at.set + 1} 组`,
      {
        lift: item.lift,
        exercise: item.exercise,
        model,
        clips: [{ angle: 'side', file, seed: null }],
        equipment: 'barbell',
        weightKg: kg,
        rpe: null,
        notes: `训练中 · ${item.name} 第 ${at.set + 1} 组（目标 ${planned.reps} ${unit}${kg ? ` @ ${kg}kg` : ''}）`,
        workout: { id: w.id!, item: at.item, set: at.set },
      },
      (id) => onSave({ sessionId: id }),
      (e) => {
        console.error(e)
        toast.error(`${item.name} 第 ${at.set + 1} 组分析失败：${e.message}`)
      },
    )
  }

  // Live mode: the big three also have matching movement patterns
  const livePattern = item.exercise?.pattern ?? (item.lift !== 'other' ? BIG3_PATTERN[item.lift] : null)
  const [live, setLive] = useState(false)
  const onLive = async (r: LiveResult) => {
    setLive(false)
    if (r.file) {
      // The recorded video gets full offline analysis in the background (more accurate); live count is logged now so the next set can start right away
      await analyze(r.file, hold ? Math.round(r.holdS ?? 0) : r.reps)
    } else {
      await onSave({ done: true, repsDone: hold ? Math.round(r.holdS ?? 0) : r.reps, weightKg: kg, at: Date.now() })
      toast('这台设备不支持录像，已按实时计数记录')
    }
  }

  const pick = (capture: boolean) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'video/*'
    if (capture) input.setAttribute('capture', 'environment')
    input.onchange = () => input.files?.[0] && analyze(input.files[0])
    input.click()
  }

  return (
    <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card mt-6 p-5">
      <div className="kicker">
        {item.name} · 第 {at.set + 1}/{item.sets.length} 组
      </div>

      {session ? (
        <SetResult session={session} planned={planned} isLast={isLast} onNext={onNext} hold={hold} />
      ) : job ? (
        <div className="mt-3">
          {job.status === 'error' ? (
            <div className="space-y-2">
              <div className="text-sm text-bad">分析失败：{job.error}</div>
              <div className="text-sm text-mute">已按{planned.repsDone != null ? '实时计数' : '计划'}记录 {planned.repsDone ?? planned.reps} {unit}。</div>
              <button className="btn-ghost h-9 text-sm" onClick={() => dismissJob(jobKey)}>
                知道了
              </button>
            </div>
          ) : (
            <>
              <div className="relative overflow-hidden rounded-xl bg-ink-2">
                <canvas ref={preview} className="block max-h-72 w-full object-contain" />
                <motion.div className="absolute inset-x-0 top-0 h-0.5 origin-left bg-acid" style={{ scaleX: job.status === 'running' && job.phase === 'pose' ? job.p : 0 }} />
              </div>
              <div className="mt-3 flex items-center gap-2 text-sm">
                <Loader2 size={14} className="animate-spin text-acid" />
                {job.status === 'queued' ? '排队中，前面的组分析完就开始' : PHASE_LABEL[job.phase]}
                {job.status === 'running' && (job.phase === 'pose' || job.phase === 'model') && <span className="ml-auto font-mono text-xs text-acid">{Math.round(job.p * 100)}%</span>}
              </div>
              {planned.repsDone != null && <div className="mt-1 text-xs text-mute">实时计数 {planned.repsDone} {unit}（分析完以视频结果为准）</div>}
              <p className="mt-2 text-xs text-dim">在后台分析，可以直接开始下一组；录下一组时会暂停，录完继续。别关掉这个页面。</p>
              {!isLast && (
                <button className="btn-acid mt-3" onClick={onNext}>
                  下一组 <ChevronRight size={16} />
                </button>
              )}
            </>
          )}
        </div>
      ) : planned.done ? (
        <div className="mt-3">
          <div className="text-lg font-semibold">已记录：{planned.repsDone ?? planned.reps} {unit}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-acid" onClick={onNext}>
              下一组 <ChevronRight size={16} />
            </button>
            <button className="btn-ghost" onClick={() => onSave({ done: false, repsDone: undefined, at: undefined })}>
              撤销
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-xs text-mute">目标</div>
              <div className="font-display text-2xl font-bold">
                {hold ? `保持 ${planned.reps} 秒` : `${planned.reps} 次`}
                {item.exercise?.unilateral && !hold ? <span className="text-base text-mute"> / 每侧</span> : null} {kg ? <span className="text-acid">@ {kg}kg</span> : null}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button aria-label="减 2.5kg" className="btn-ghost h-10 w-10 p-0" onClick={() => setKg((k) => Math.max(0, (k ?? 20) - 2.5))}>
                <Minus size={14} />
              </button>
              <button aria-label="加 2.5kg" className="btn-ghost h-10 w-10 p-0" onClick={() => setKg((k) => (k ?? 17.5) + 2.5)}>
                <Plus size={14} />
              </button>
            </div>
          </div>

          {canAnalyze && !manual ? (
            <>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {livePattern && (
                  <button className="btn-acid h-12 text-base sm:col-span-2" onClick={() => setLive(true)}>
                    <Radio size={18} /> 实时模式 · 边练边数
                  </button>
                )}
                <button className={`${livePattern ? 'btn-ghost' : 'btn-acid text-base'} h-12`} onClick={() => pick(true)}>
                  <Camera size={18} /> {TOUCH ? '拍这一组' : '选择这一组的视频'}
                </button>
                {TOUCH && (
                  <button className="btn-ghost h-12" onClick={() => pick(false)}>
                    <ImagePlus size={16} /> 从相册选
                  </button>
                )}
              </div>
              {live && livePattern && (
                <LiveActive />
              )}
              {live && livePattern && (
                <LiveSet
                  patternId={livePattern}
                  unilateral={item.exercise?.unilateral}
                  hold={hold}
                  label={item.name}
                  targetReps={hold ? undefined : planned.reps}
                  targetSec={hold ? planned.reps : undefined}
                  onCancel={() => setLive(false)}
                  onFinish={onLive}
                />
              )}
              <p className="mt-2 text-xs text-dim">
                机位：{item.exercise?.pattern ? PATTERNS[item.exercise.pattern].camera.tip : '侧面、能拍到全身和杠铃'}。开始前按录制，做完再停。
              </p>
            </>
          ) : canAnalyze ? null : (
            <p className="mt-3 text-sm text-mute">这个动作暂不支持视频分析（{item.exercise ? '动作库里没有它的动作模式' : '不在动作库里'}），做完直接记录。</p>
          )}

          {manual || !canAnalyze ? (
            <>
              <div className="mt-4 flex items-center gap-2">
                <span className="text-sm text-mute">完成</span>
                <div className="w-36">
                  <NumField label="" value={manualReps} step={hold ? 5 : 1} onChange={(v) => setManualReps(Math.max(0, v))} />
                </div>
                <span className="text-sm text-mute">{unit}</span>
                <button className="btn-acid ml-auto" onClick={() => onSave({ done: true, repsDone: manualReps, weightKg: kg, at: Date.now() }).then(onNext)}>
                  <Check size={16} /> 记录
                </button>
              </div>
              {canAnalyze && (
                <button className="mt-3 flex items-center gap-1 text-sm text-dim hover:text-fg" onClick={() => setManual(false)}>
                  <Camera size={13} /> 这组想拍一下（视频分析）
                </button>
              )}
            </>
          ) : (
            <button className="mt-3 flex items-center gap-1 text-sm text-dim hover:text-fg" onClick={() => setManual(true)}>
              <PencilLine size={13} /> 这组不拍，直接记录{hold ? '秒数' : '次数'}
            </button>
          )}
        </div>
      )}
    </motion.section>
  )
}

/** while mounted (= live mode open), background analysis waits so the live counter gets the device */
function LiveActive() {
  useEffect(() => {
    setLiveActive(true)
    return () => setLiveActive(false)
  }, [])
  return null
}

function SetResult({ session, planned, isLast, onNext, hold }: { session: Session; planned: PlannedSet; isLast: boolean; onNext: () => void; hold?: boolean }) {
  const clips = useLiveQuery(() => db.clips.where('sessionId').equals(session.id!).toArray(), [session.id])
  if (!clips) return null
  const main = clips.find((c) => c.angle === 'side') ?? clips[0]
  const advice = adviseNextSet({
    planned,
    session,
    findings: clips.flatMap((c) => c.analysis.findings),
    reps: main?.analysis.reps ?? [],
    isLastSet: isLast,
    holdS: hold ? (session.holdS ?? 0) : undefined,
  })
  const tone = { good: 'border-good/40 bg-good/10 text-good', warn: 'border-warn/40 bg-warn/10 text-warn', bad: 'border-bad/40 bg-bad/10 text-bad' }[advice.tone]
  return (
    <div className="mt-3">
      <div className="flex items-end gap-4">
        <div>
          <div className="text-xs text-mute">完成</div>
          <div className="font-display text-3xl font-bold">
            {hold ? Math.round(session.holdS ?? 0) : session.reps}
            <span className="text-lg text-mute">
              /{planned.reps} {hold ? '秒' : '次'}
            </span>
          </div>
        </div>
        <div>
          <div className="text-xs text-mute">动作分</div>
          <div className={`font-mono text-3xl ${scoreColor(session.score)}`}>{session.score}</div>
        </div>
        {session.weightKg ? <div className="ml-auto font-mono text-sm text-mute">{session.weightKg}kg</div> : null}
      </div>

      <div className={`mt-4 rounded-xl border p-3 ${tone}`}>
        <div className="font-semibold">{advice.headline}</div>
        <div className="mt-1 text-sm text-fg/85">{advice.detail}</div>
      </div>

      {advice.issues.length > 0 && (
        <ul className="mt-3 space-y-2">
          {advice.issues.slice(0, 3).map((f) => (
            <li key={f.id} className="rounded-xl bg-ink-2 p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${f.severity === 'bad' ? 'bg-bad' : 'bg-warn'}`} />
                <span className="font-medium">{f.title}</span>
                {f.reps?.length ? <span className="ml-auto shrink-0 font-mono text-xs text-dim">第 {f.reps.join('、')} 次</span> : null}
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-mute">{f.detail}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn-acid" onClick={onNext}>
          {isLast ? '完成' : '下一组'} <ChevronRight size={16} />
        </button>
        <Link to={`/session/${session.id}`} className="btn-ghost">
          看完整分析
        </Link>
      </div>
      <p className="mt-3 text-xs text-dim">组间建议来自程序测量。回到电脑上，可以在这组的详情页请教练点评。</p>
    </div>
  )
}

// ------------------------------------------------------------------ Summary

function Summary({ id, onNew }: { id: number; onNew: () => void }) {
  const w = useLiveQuery(() => db.workouts.get(id), [id])
  const ids = w?.items.flatMap((it) => it.sets.map((s) => s.sessionId).filter((x): x is number => x != null)) ?? []
  const sessions = useLiveQuery(() => db.sessions.bulkGet(ids), [ids.join(',')])
  if (!w || !sessions) return null
  const byId = new Map(sessions.filter(Boolean).map((s) => [s!.id!, s!]))
  const sets = w.items.flatMap((it) => it.sets.map((s) => ({ it, s, ses: s.sessionId != null ? byId.get(s.sessionId) : undefined })))
  const doneSets = sets.filter((x) => isSetDone(x.s))
  const volume = doneSets.reduce((v, x) => v + (x.ses?.reps ?? x.s.repsDone ?? 0) * (x.ses?.weightKg ?? x.s.weightKg ?? 0), 0)
  const scored = doneSets.filter((x) => x.ses)
  const avg = scored.length ? Math.round(scored.reduce((a, x) => a + x.ses!.score, 0) / scored.length) : null
  const mins = w.finishedAt ? Math.round((w.finishedAt - w.createdAt) / 60000) : null

  return (
    <div>
      <div className="kicker">WORKOUT DONE</div>
      <h1 className="font-display mt-1 text-3xl font-bold tracking-tight">练完了 💪</h1>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['完成组数', `${doneSets.length}/${sets.length}`],
          ['总容量', volume ? `${Math.round(volume)} kg` : '—'],
          ['平均动作分', avg ?? '—'],
          ['用时', mins ? `${mins} 分钟` : '—'],
        ].map(([k, v]) => (
          <div key={k} className="card p-4">
            <div className="text-xs text-mute">{k}</div>
            <div className="mt-1 font-mono text-xl">{v}</div>
          </div>
        ))}
      </div>
      <div className="mt-6 space-y-2">
        {sets.map((x, i) =>
          x.ses ? (
            <Link key={i} to={`/session/${x.ses.id}`} className="card flex items-center gap-3 p-3 hover:border-line-2">
              <span className="font-medium">{x.it.name}</span>
              <span className="font-mono text-xs text-dim">
                {x.ses.reps}/{x.s.reps} 次{x.ses.weightKg ? ` · ${x.ses.weightKg}kg` : ''}
              </span>
              <span className={`ml-auto font-mono ${scoreColor(x.ses.score)}`}>{x.ses.score}</span>
              <ChevronRight size={14} className="text-dim" />
            </Link>
          ) : (
            <div key={i} className="card flex items-center gap-3 p-3 text-sm">
              <span className="font-medium">{x.it.name}</span>
              <span className="font-mono text-xs text-dim">{x.s.done ? `${x.s.repsDone ?? x.s.reps} 次（未拍）` : '未完成'}</span>
            </div>
          ),
        )}
      </div>
      <p className="mt-4 text-sm text-mute">每组都已存进训练日志。回到电脑上打开任意一组，可以请教练点评。</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link to="/journal" className="btn-acid">
          去训练日志
        </Link>
        <button className="btn-ghost" onClick={onNew}>
          <Flag size={15} /> 再开一场
        </button>
      </div>
    </div>
  )
}
