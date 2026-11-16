import { useEffect, useState } from 'react'
import { Camera, Loader2 } from 'lucide-react'
import type { ExerciseInfo } from '../lib/movement/types'
import { PATTERN_ZH, equipmentZh, getExercise, muscleZh } from '../lib/exercises'
import { PATTERNS } from '../lib/movement/patterns'
import { exerciseMuscleWeights } from '../lib/muscles'
import { ExerciseFigure } from './figures/exercise/ExerciseFigure'
import { exerciseSpec } from './figures/exercise/spec'
import { VolumeFigure } from './figures'
import { MuscleMap } from './MuscleMap'

/**
 * What an exercise looks like: an animated, muscled figure generated from the exercise's movement
 * pattern, posture words, equipment and muscles (see figures/exercise/), plus the muscles worked.
 * Exercises we can't animate (stretches, cardio…) show the muscle map instead.
 */
export function ExercisePreview({ exercise, compact = false }: { exercise: ExerciseInfo; compact?: boolean }) {
  const big = exercise.big3
  const animated = !!big || !!exerciseSpec(exercise)
  const p = exercise.pattern ? PATTERNS[exercise.pattern] : null
  return (
    <div className={compact ? 'grid gap-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]' : 'grid gap-4 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]'}>
      <div className="overflow-hidden rounded-xl border border-line bg-ink-2">
        {big ? (
          <VolumeFigure lift={big} muscles className="aspect-[10/7] w-full" showTrail={false} />
        ) : animated ? (
          <ExerciseFigure exercise={exercise} className="aspect-[10/7] w-full" />
        ) : (
          <div className="p-3">
            <MuscleMap weights={exerciseMuscleWeights(exercise.target, exercise.secondaryMuscles)} view="both" />
          </div>
        )}
      </div>
      <div className="min-w-0 space-y-2 text-xs text-mute">
        {!animated && <p className="text-dim">这个动作暂时没有动画，先看它练到的肌肉。</p>}
        <div>
          <span className="text-dim">主要肌肉 </span>
          <span className="font-medium text-acid">{muscleZh(exercise.target)}</span>
          {exercise.secondaryMuscles.length > 0 && (
            <>
              <span className="text-dim"> · 辅助 </span>
              {exercise.secondaryMuscles.map(muscleZh).join('、')}
            </>
          )}
        </div>
        <div>
          <span className="text-dim">器械 </span>
          {equipmentZh(exercise.equipment)}
          {exercise.pattern && (
            <>
              <span className="text-dim"> · 动作模式 </span>
              {PATTERN_ZH[exercise.pattern]}
            </>
          )}
          {exercise.unilateral && <span className="text-dim"> · 单侧</span>}
        </div>
        {p && (
          <div className="flex items-start gap-1.5">
            <Camera size={12} className="mt-0.5 shrink-0 text-cyan" />
            <span>拍摄：{p.camera.tip}</span>
          </div>
        )}
        {animated && !big && <p className="text-[11px] text-dim">示意动画按动作模式、姿势和器械自动生成，握法等细节以实际动作为准。</p>}
      </div>
    </div>
  )
}

/** Same, for a plan row that only keeps the exercise id */
export function ExercisePreviewById({ id }: { id: string }) {
  const [ex, setEx] = useState<ExerciseInfo | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    getExercise(id).then((e) => alive && setEx(e ?? null))
    return () => {
      alive = false
    }
  }, [id])
  if (ex === undefined)
    return (
      <div className="flex items-center gap-2 py-6 text-xs text-mute">
        <Loader2 size={14} className="animate-spin" /> 加载动作…
      </div>
    )
  if (!ex) return null
  return <ExercisePreview exercise={ex} compact />
}
