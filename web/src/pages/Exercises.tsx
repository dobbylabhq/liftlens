import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { Camera, ChevronRight, Film, Plus, Search, Sparkles, X } from 'lucide-react'
import { BODY_PART_ZH, PATTERN_ZH, bodyPartZh, equipmentZh, loadExercises, muscleZh, searchExercises } from '../lib/exercises'
import { exerciseMuscleWeights } from '../lib/muscles'
import { PATTERNS } from '../lib/movement/patterns'
import { MuscleMap } from '../components/MuscleMap'
import { VolumeFigure } from '../components/figures'
import { ExerciseFigure } from '../components/figures/exercise/ExerciseFigure'
import { exerciseSpec } from '../components/figures/exercise/spec'
import type { ExerciseInfo } from '../lib/movement/types'

const PAGE = 60

export default function Exercises() {
  const [list, setList] = useState<ExerciseInfo[] | null>(null)
  const [q, setQ] = useState('')
  const dq = useDeferredValue(q)
  const [part, setPart] = useState<string | undefined>()
  const [onlyVideo, setOnlyVideo] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [params, setParams] = useSearchParams()
  const selId = params.get('id')
  useEffect(() => {
    loadExercises().then(setList)
  }, [])
  useEffect(() => setLimit(PAGE), [dq, part, onlyVideo])

  const results = useMemo(() => (list ? searchExercises(list, dq, { bodyPart: part, analyzableOnly: onlyVideo }) : []), [list, dq, part, onlyVideo])
  const sel = selId && list ? list.find((e) => e.id === selId) : undefined
  const analyzable = list?.filter((e) => e.pattern).length ?? 0

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <div className="kicker">EXERCISE LIBRARY</div>
      <h1 className="font-display mt-1 text-3xl font-bold tracking-tight sm:text-4xl">动作库</h1>
      <p className="mt-2 text-sm text-mute">
        {list ? `${list.length} 个动作，其中 ${analyzable} 个可以拍视频自动计次、检查动作。` : '加载中…'} 动作数据来自 ExerciseDB（MIT），肌肉图来自 MuscleMap（MIT）。
      </p>

      <div className="sticky top-14 z-20 -mx-4 mt-5 space-y-2 bg-ink px-4 py-3">
        <label className="flex items-center gap-2 rounded-2xl border border-line bg-ink-2 px-3 focus-within:border-acid/60">
          <Search size={16} className="text-dim" />
          <input className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none" placeholder="搜索：弯举、划船、pull-up、三头…" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && (
            <button aria-label="清空" className="flex h-9 w-9 items-center justify-center text-dim" onClick={() => setQ('')}>
              <X size={15} />
            </button>
          )}
        </label>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          <button onClick={() => setOnlyVideo((v) => !v)} className={`chip h-9 shrink-0 px-3 text-sm ${onlyVideo ? 'border-acid/60 bg-acid/10 text-acid' : ''}`}>
            <Sparkles size={13} /> 可视频分析
          </button>
          <span className="mx-1 w-px shrink-0 bg-line" />
          {Object.keys(BODY_PART_ZH).map((b) => (
            <button key={b} onClick={() => setPart((p) => (p === b ? undefined : b))} className={`chip h-9 shrink-0 px-3 text-sm ${part === b ? 'border-acid/60 bg-acid/10 text-acid' : ''}`}>
              {bodyPartZh(b)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 text-xs text-dim">{list ? `${results.length} 个结果` : ''}</div>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {results.slice(0, limit).map((e) => (
          <li key={e.id}>
            <button
              onClick={() => setParams({ id: e.id })}
              className={`card flex w-full items-center gap-3 p-3 text-left transition-colors hover:border-line-2 ${selId === e.id ? 'border-acid/60' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{e.zh}</div>
                <div className="truncate text-xs text-dim">
                  {equipmentZh(e.equipment)} · {muscleZh(e.target)}
                </div>
              </div>
              {e.pattern && <span className="chip h-6 shrink-0 border-acid/40 text-[11px] text-acid">可分析</span>}
              <ChevronRight size={15} className="shrink-0 text-dim" />
            </button>
          </li>
        ))}
      </ul>
      {results.length > limit && (
        <button className="btn-ghost mx-auto mt-4 flex" onClick={() => setLimit((l) => l + PAGE)}>
          再显示 {Math.min(PAGE, results.length - limit)} 个
        </button>
      )}

      <AnimatePresence>{sel && <Detail ex={sel} onClose={() => setParams({})} />}</AnimatePresence>
    </div>
  )
}

function Detail({ ex, onClose }: { ex: ExerciseInfo; onClose: () => void }) {
  const nav = useNavigate()
  const p = ex.pattern ? PATTERNS[ex.pattern] : null
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <motion.div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-ink/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        role="dialog"
        aria-label={ex.zh}
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 34 }}
        className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-line bg-panel p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:max-w-2xl sm:rounded-3xl"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="kicker">{bodyPartZh(ex.bodyPart)} · {equipmentZh(ex.equipment)}</div>
            <h2 className="font-display mt-1 text-2xl font-bold">{ex.zh}</h2>
            <div className="text-xs text-dim">{ex.name}</div>
          </div>
          <button aria-label="关闭" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line text-dim hover:text-fg" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {(ex.big3 || exerciseSpec(ex)) && (
          <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-ink-2">
            {ex.big3 ? <VolumeFigure lift={ex.big3} muscles className="aspect-[10/7] max-h-72 w-full" showTrail={false} /> : <ExerciseFigure exercise={ex} className="aspect-[10/7] max-h-72 w-full" />}
          </div>
        )}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <MuscleMap weights={exerciseMuscleWeights(ex.target, ex.secondaryMuscles)} view="both" />
            <div className="mt-2 text-xs text-mute">
              主要：<span className="text-fg">{muscleZh(ex.target)}</span>
              {ex.secondaryMuscles.length > 0 && <> · 辅助：{ex.secondaryMuscles.map(muscleZh).join('、')}</>}
            </div>
          </div>
          <div className="space-y-3">
            {p ? (
              <div className="rounded-2xl border border-acid/30 bg-acid/5 p-4">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-acid">
                  <Sparkles size={14} /> 可以视频分析 · {PATTERN_ZH[p.id]}
                </div>
                <ul className="mt-2 space-y-1 text-sm text-mute">
                  <li>· {ex.hold ? '自动计时' : '自动计次'}{ex.unilateral ? '（单侧动作，左右分开拍）' : ''}</li>
                  {p.peakTarget && <li>· 幅度：{p.peakTarget.label}</li>}
                  {p.restTarget && <li>· 回位：{p.restTarget.label}</li>}
                  {p.checks.includes('swing') && <li>· 是否借力 / 躯干晃动</li>}
                  {p.checks.includes('elbowDrift') && <li>· 大臂是否固定</li>}
                  {p.checks.includes('bodyLine') && <li>· 身体是否成一条线</li>}
                  {p.checks.includes('tempo') && <li>· 离心节奏</li>}
                </ul>
                <div className="mt-3 flex items-start gap-2 text-xs text-mute">
                  <Camera size={13} className="mt-0.5 shrink-0 text-cyan" /> {p.camera.tip}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-line p-4 text-sm text-mute">这个动作暂不支持视频分析，可以在训练计划里记录次数和重量。</div>
            )}
            <div className="grid gap-2">
              <button className="btn-acid h-12" onClick={() => nav(`/train?add=${ex.id}`)}>
                <Plus size={16} /> 加入今天的训练
              </button>
              {p && (
                <Link to={`/new?exercise=${ex.id}`} className="btn-ghost h-12">
                  <Film size={16} /> 分析一段已有视频
                </Link>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
