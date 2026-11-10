import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'motion/react'
import { Area, AreaChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Trash2, Camera, AlertTriangle, Dumbbell } from 'lucide-react'
import { toast } from 'sonner'
import { db, deleteSession } from '../lib/db'
import { ANGLE_LABEL, e1rm } from '../lib/lifts'
import { isBig3, sameExercise, sessionMuscles, sessionName } from '../lib/exerciseRef'
import { PATTERNS } from '../lib/movement/patterns'
import { exerciseMuscleWeights } from '../lib/muscles'
import { MuscleMap } from '../components/MuscleMap'
import { coachById } from '../lib/coaches'
import { blobToDataUrl } from '../lib/keyframes'
import { isPlayable, VideoOverlay } from '../components/VideoOverlay'
import { CoachPanel } from '../components/CoachPanel'
import { Empty, FindingCard, ScoreRing, SourceChip } from '../components/bits'
import type { AgentSessionResult, Clip, Severity } from '../lib/types'

const ORDER: Severity[] = ['bad', 'warn', 'good', 'info']
const JOINT_ZH = { knee: '膝角', hip: '髋角', elbow: '肘角', shoulder: '肩角', ankleRise: '脚跟抬起' } as const
const VERDICT = {
  solid: { label: '扎实', c: 'text-good' },
  needs_work: { label: '需要打磨', c: 'text-warn' },
  unsafe: { label: '有安全风险', c: 'text-bad' },
}

export default function SessionDetail() {
  const { id } = useParams()
  const sid = Number(id)
  const nav = useNavigate()
  const session = useLiveQuery(() => db.sessions.get(sid), [sid])
  const clips = useLiveQuery(() => db.clips.where('sessionId').equals(sid).toArray(), [sid])
  const [tab, setTab] = useState(0)
  const [seek, setSeek] = useState<{ t: number; key: number } | undefined>()
  const [coachId, setCoachId] = useState<string | null>(null)

  if (session === undefined || clips === undefined) return <div className="mx-auto max-w-6xl px-4 py-20 text-mute">加载中…</div>
  if (!session) return <div className="mx-auto max-w-6xl px-4 py-20"><Empty title="找不到这次训练" /></div>

  const clip = clips[tab] ?? clips[0]
  const coach = coachId ?? session.coachId ?? 'coach-nsca-cscs'
  const est = e1rm(session.weightKg, session.reps)

  const buildRequest = async () => {
    const history = (await db.sessions.where('lift').equals(session.lift).reverse().sortBy('createdAt')).filter((h) => sameExercise(session, h))
    const images: { name: string; dataUrl: string }[] = []
    for (const c of clips) for (const k of c.keyframes) images.push({ name: k.name, dataUrl: await blobToDataUrl(k.blob) })
    const profile = Object.fromEntries((await db.settings.toArray()).filter((s) => s.key.startsWith('profile.')).map((s) => [s.key.slice(8), s.value]))
    return {
      payload: {
        user: profile,
        session: {
          lift: session.lift,
          liftName: sessionName(session),
          ...(session.exercise ? { exercise: { name: session.exercise.name, pattern: session.exercise.pattern && PATTERNS[session.exercise.pattern].zh, unilateral: !!session.exercise.unilateral } } : {}),
          ...(session.holdS != null ? { holdS: session.holdS } : {}),
          equipment: session.equipment, weightKg: session.weightKg, reps: session.reps, rpe: session.rpe, notes: session.notes, programScore: session.score, e1rm: est },
        clips: clips.map((c) => ({
          angle: c.angle,
          poseCoverage: c.analysis.poseCoverage,
          barCoverage: c.analysis.barCoverage,
          signal: c.analysis.signal,
          reps: c.analysis.reps.map((r) => ({ index: r.index, eccentricS: r.eccentricS, concentricS: r.concentricS })),
          findings: c.analysis.findings.map(({ id, title, severity, value, unit, target, sourceIds, confidence, reps, detail }) => ({ id, title, severity, value, unit, target, sourceIds, confidence, reps, detail })),
          keyframes: c.keyframes.map((k) => k.name),
        })),
        history: history
          .filter((h) => h.id !== session.id)
          .slice(0, 6)
          .map((h) => ({ date: h.date, weightKg: h.weightKg, reps: h.reps, score: h.score, agentSummary: h.agent?.summary ?? null })),
      },
      images: images.slice(0, 8),
    }
  }

  const repTime = (c: Clip, rep: number) => {
    const r = c.analysis.reps.find((x) => x.index === rep)
    return r ? r.bottom / c.analysis.fps : 0
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      {/* header */}
      <div className="relative flex items-center gap-4 sm:gap-6">
        <div className="shrink-0 origin-left scale-[0.8] -mr-6 sm:mr-0 sm:scale-100">
          <ScoreRing score={session.agent?.score ?? session.score} label={session.agent ? '教练评分' : '程序评分'} />
        </div>
        <div className="min-w-0 flex-1 pr-10 sm:pr-0">
          <div className="kicker">
            {session.date} · {isBig3(session.lift) ? (session.equipment === 'smith' ? '史密斯机' : '自由杠铃') : session.exercise?.pattern ? PATTERNS[session.exercise.pattern].zh : '动作库'}
          </div>
          <h1 className="font-display mt-1 text-3xl font-bold tracking-tight sm:text-4xl">{sessionName(session)}</h1>
          <div className="mt-2 flex flex-wrap gap-2 font-mono text-sm">
            <span className="chip h-7 whitespace-nowrap">
              <Dumbbell size={12} /> {session.holdS != null ? `保持 ${Math.round(session.holdS)} 秒` : `${session.weightKg ?? '—'} kg × ${session.reps}`}
            </span>
            {est && <span className="chip h-7 text-acid">e1RM ≈ {est} kg</span>}
            {session.rpe && <span className="chip h-7">RPE {session.rpe}</span>}
            <span className="chip h-7 whitespace-nowrap"><Camera size={12} /> {clips.map((c) => ANGLE_LABEL[c.angle]).join(' / ')}</span>
          </div>
        </div>
        <button
          aria-label="删除这次训练"
          className="btn-ghost absolute right-0 top-0 h-10 w-10 p-0 text-dim hover:text-bad sm:static sm:h-9 sm:w-auto sm:px-4"
          onClick={async () => {
            if (!confirm('删除这次训练记录（包括视频）？')) return
            await deleteSession(sid)
            toast('已删除')
            nav('/journal')
          }}
        >
          <Trash2 size={14} /> <span className="hidden sm:inline">删除</span>
        </button>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        {/* left: video + chart + findings */}
        <div className="min-w-0 space-y-6">
          {clips.length > 1 && (
            <div className="flex gap-1 rounded-full border border-line bg-ink-2 p-1">
              {clips.map((c, i) => (
                <button key={c.id} onClick={() => setTab(i)} className={`relative h-9 flex-1 rounded-full text-sm ${tab === i ? 'text-acid-ink' : 'text-mute'}`}>
                  {tab === i && <motion.span layoutId="clip-tab" className="absolute inset-0 rounded-full bg-acid" />}
                  <span className="relative">{ANGLE_LABEL[c.angle]}</span>
                </button>
              ))}
            </div>
          )}
          {clip &&
            (isPlayable(clip) ? (
              <VideoOverlay clip={clip} seekTo={seek} />
            ) : (
              <div className="card flex aspect-video flex-col items-center justify-center gap-1 p-6 text-center">
                <div className="font-semibold text-mute">视频未包含在备份中</div>
                <div className="text-xs text-dim">这条记录是从备份导入的，测量结果、曲线和教练点评都保留着</div>
              </div>
            ))}
          {clip && <TraceChart clip={clip} onRep={(r) => setSeek({ t: repTime(clip, r), key: Date.now() })} />}
          {(() => {
            const m = sessionMuscles(session)
            if (!m) return null
            return (
              <div className="card p-4">
                <div className="kicker mb-2">这组练到的肌肉</div>
                <MuscleMap weights={exerciseMuscleWeights(m.target, m.secondary)} view="both" className="mx-auto max-w-sm" />
              </div>
            )
          })()}

          <AnimatePresence mode="wait">
            <motion.div key={clip?.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="kicker">程序测量 · {clip ? ANGLE_LABEL[clip.angle] : ''}</div>
                {clip && (
                  <div className="font-mono text-[11px] text-dim">
                    骨架 {Math.round(clip.analysis.poseCoverage * 100)}% ·{' '}
                    {clip.analysis.signal === 'joint' ? `按${JOINT_ZH[clip.analysis.joint ?? 'elbow']}计次` : `杠铃 ${clip.analysis.signal === 'bar' ? `颜色追踪 ${Math.round(clip.analysis.barCoverage * 100)}%` : '用手腕代替'}`}
                  </div>
                )}
              </div>
              {clip &&
                [...clip.analysis.findings]
                  .sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity))
                  .map((f, i) => <FindingCard key={f.id} f={f} index={i} onRep={(r) => setSeek({ t: repTime(clip, r), key: Date.now() })} />)}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* right: coach */}
        <div className="space-y-6 lg:sticky lg:top-20 lg:self-start">
          <CoachPanel
            kind="session"
            coachId={coach}
            onCoach={setCoachId}
            build={buildRequest}
            onResult={async (out, meta) => {
              await db.sessions.update(sid, {
                agent: out as AgentSessionResult,
                coachId: meta.coachId,
                agentMeta: { costUsd: meta.costUsd, durationMs: meta.durationMs, at: Date.now() },
              })
            }}
          />
          {session.agent && <AgentResult r={session.agent} coachId={session.coachId} meta={session.agentMeta} />}
          {clips.some((c) => c.keyframes.length) && <Keyframes clips={clips} />}
        </div>
      </div>
    </div>
  )
}

function TraceChart({ clip, onRep }: { clip: Clip; onRep: (rep: number) => void }) {
  const a = clip.analysis
  const joint = a.signal === 'joint'
  // Big three: relative bar height; generic exercises: joint angle (degrees)
  const data = useMemo(() => a.trace.filter((_, i) => i % 2 === 0).map((p) => ({ t: p.t, h: joint ? p.y : Math.round((1 - p.y) * 1000) / 10 })), [a.trace, joint])
  if (!a.reps.length) return null
  return (
    <div className="card p-4">
      <div className="kicker mb-2 flex justify-between">
        <span>{joint ? `${JOINT_ZH[a.joint ?? 'elbow']}变化 · 自动分次` : '杠铃高度 · 自动分次'}</span>
        <span className="text-acid">{a.reps.length} 次</span>
      </div>
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
            <defs>
              <linearGradient id="hfill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#c8ff3d" stopOpacity={0.35} />
                <stop offset="1" stopColor="#c8ff3d" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tick={{ fill: '#5c6862', fontSize: 10 }} tickFormatter={(v) => `${Math.round(v)}s`} stroke="#252d29" />
            <YAxis tick={{ fill: '#5c6862', fontSize: 10 }} stroke="#252d29" domain={['auto', 'auto']} />
            {a.reps.map((r) => (
              <ReferenceArea
                key={r.index}
                x1={r.start / a.fps}
                x2={r.end / a.fps}
                fill="#5eead4"
                fillOpacity={0.07}
                stroke="#5eead4"
                strokeOpacity={0.2}
                label={{ value: r.index, fill: '#5eead4', fontSize: 10, position: 'insideTop' }}
                onClick={() => onRep(r.index)}
                style={{ cursor: 'pointer' }}
              />
            ))}
            <Tooltip
              contentStyle={{ background: '#141917', border: '1px solid #252d29', borderRadius: 12, fontSize: 12 }}
              labelFormatter={(v) => `${Number(v).toFixed(1)}s`}
              formatter={(v) => [joint ? `${v}${a.joint === 'ankleRise' ? '%' : '°'}` : `${v}`, joint ? JOINT_ZH[a.joint ?? 'elbow'] : '相对高度']}
            />
            <Area type="monotone" dataKey="h" stroke="#c8ff3d" strokeWidth={1.6} fill="url(#hfill)" isAnimationActive animationDuration={1200} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {a.reps.map((r) => (
          <button key={r.index} onClick={() => onRep(r.index)} className="chip h-7 font-mono hover:text-fg">
            #{r.index} ↓{r.eccentricS}s ↑{r.concentricS}s
          </button>
        ))}
      </div>
    </div>
  )
}

function AgentResult({ r, coachId, meta }: { r: AgentSessionResult; coachId: string | null; meta?: { costUsd: number | null; durationMs: number | null; at: number } | null }) {
  const coach = coachById(coachId)
  const v = VERDICT[r.verdict]
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card overflow-hidden">
      <div className="border-b border-line p-4" style={{ background: coach ? `linear-gradient(120deg, ${coach.accent}14, transparent 60%)` : undefined }}>
        <div className="flex items-center justify-between">
          <div className="font-semibold" style={{ color: coach?.accent }}>
            {coach?.flag} {coach?.displayName ?? coachId}
          </div>
          <span className={`font-mono text-sm ${v.c}`}>{v.label}</span>
        </div>
        <p className="mt-2 text-sm leading-relaxed">{r.summary}</p>
      </div>
      <div className="space-y-3 p-4">
        {r.cues.map((c, i) => (
          <motion.div key={i} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 * i }} className="rounded-xl border border-line bg-ink-2 p-3">
            <div className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${c.priority === 'high' ? 'bg-bad' : c.priority === 'medium' ? 'bg-warn' : 'bg-info'}`} />
              <span className="font-semibold">{c.title}</span>
            </div>
            <p className="mt-1 text-sm text-mute">{c.detail}</p>
            {c.evidence && <p className="mt-1 font-mono text-[11px] text-dim">依据：{c.evidence}</p>}
            <div className="mt-2 flex flex-wrap gap-1">
              {c.sourceIds.map((s) => (
                <SourceChip key={s} id={s} />
              ))}
            </div>
          </motion.div>
        ))}
        {r.metricDisagreements.length > 0 && (
          <div className="rounded-xl border border-warn/30 bg-warn/5 p-3 text-sm">
            <div className="mb-1 flex items-center gap-1.5 text-warn">
              <AlertTriangle size={14} /> 教练与程序测量不一致
            </div>
            <ul className="space-y-1 text-mute">
              {r.metricDisagreements.map((d, i) => (
                <li key={i}>· {d}</li>
              ))}
            </ul>
          </div>
        )}
        {r.cameraAdvice && (
          <div className="text-sm">
            <span className="kicker">机位建议 </span>
            <span className="text-mute">{r.cameraAdvice}</span>
          </div>
        )}
        <div className="rounded-xl bg-acid/10 p-3 text-sm">
          <div className="kicker mb-1 text-acid">下次训练</div>
          {r.nextSession}
        </div>
        {meta && (
          <div className="font-mono text-[10px] text-dim">
            {new Date(meta.at).toLocaleString()} · {meta.durationMs ? `${Math.round(meta.durationMs / 1000)}s` : ''} {meta.costUsd != null ? `· $${meta.costUsd.toFixed(3)}` : ''}
          </div>
        )}
      </div>
    </motion.div>
  )
}

function Keyframes({ clips }: { clips: Clip[] }) {
  const [items, setItems] = useState<{ name: string; url: string }[]>([])
  useEffect(() => {
    const list = clips.flatMap((c) => c.keyframes.map((k) => ({ name: k.name, url: URL.createObjectURL(k.blob) })))
    setItems(list)
    return () => list.forEach((k) => URL.revokeObjectURL(k.url))
  }, [clips])
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="card p-4">
      <div className="kicker mb-3">发送给教练的关键帧</div>
      <div className="grid grid-cols-2 gap-2">
        {items.map((k) => (
          <motion.button key={k.name} layoutId={k.name} onClick={() => setOpen(k.name)} className="overflow-hidden rounded-lg border border-line">
            <img src={k.url} alt={k.name} className="aspect-video w-full object-cover" />
          </motion.button>
        ))}
      </div>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur">
            <motion.img layoutId={open} src={items.find((k) => k.name === open)?.url} className="max-h-[85vh] max-w-full rounded-xl" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
