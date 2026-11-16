import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { ExerciseInfo } from '../lib/movement/types'
import { loadExercises } from '../lib/exercises'
import { ExerciseFigure } from '../components/figures/exercise/ExerciseFigure'
import { exerciseSpec } from '../components/figures/exercise/spec'

/** Dev lab: generated exercise animations side by side. ?q=incline&n=40&frozen=0.5 */
export default function ExerciseLab() {
  const [list, setList] = useState<ExerciseInfo[] | null>(null)
  const [params] = useSearchParams()
  useEffect(() => {
    loadExercises().then(setList)
  }, [])
  const q = params.get('q') ?? ''
  const ids = params.get('ids')?.split(',')
  const n = Number(params.get('n') ?? 60)
  const shown = useMemo(() => {
    if (!list) return []
    const pick = ids ? list.filter((e) => ids.includes(e.id) || ids.includes(e.name)) : list.filter((e) => e.name.includes(q) && exerciseSpec(e))
    return pick.slice(0, n)
  }, [list, q, n, ids])
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-3 text-sm text-mute">{shown.length} 个</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {shown.map((e) => {
          const s = exerciseSpec(e)
          return (
            <div key={e.id} className="card p-2" data-ex={e.name}>
              <ExerciseFigure exercise={e} className="aspect-[10/7] w-full" playing={params.get('frozen') == null} progress={params.get('t') != null ? Number(params.get('t')) : undefined} />
              <div className="mt-1 truncate text-xs font-semibold">{e.zh}</div>
              <div className="truncate font-mono text-[10px] text-dim">{e.name}</div>
              <div className="truncate font-mono text-[10px] text-dim">{s ? `${s.base}/${s.posture}${s.bench ? s.bench : ''}/${s.variant || '-'}/${s.equip}` : 'no spec'}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
