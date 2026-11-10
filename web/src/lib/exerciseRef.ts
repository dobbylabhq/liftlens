// Exercise referenced by a workout record: the big three keep using LiftId; other library exercises store a compact snapshot (displays offline, doesn't depend on the library being loaded).
import { LIFTS } from './lifts'
import type { LiftId, Session } from './types'
import type { ExerciseInfo, PatternId } from './movement/types'

export interface ExerciseRef {
  /** ExerciseDB id */
  id: string
  /** Chinese name */
  name: string
  pattern: PatternId | null
  unilateral?: boolean
  hold?: boolean
  target?: string
  secondary?: string[]
}

export const refOf = (ex: ExerciseInfo): ExerciseRef => ({
  id: ex.id,
  name: ex.zh,
  pattern: ex.pattern,
  ...(ex.unilateral ? { unilateral: true } : {}),
  ...(ex.hold ? { hold: true } : {}),
  target: ex.target,
  secondary: ex.secondaryMuscles,
})

/** The big three also map to movement patterns (for live rep counting and the muscle map) */
export const BIG3_PATTERN: Record<LiftId, PatternId> = { bench: 'horizontal-push', squat: 'squat', deadlift: 'hinge' }
export const BIG3_MUSCLES: Record<LiftId, { target: string; secondary: string[] }> = {
  bench: { target: 'pectorals', secondary: ['triceps', 'delts'] },
  squat: { target: 'quads', secondary: ['glutes', 'adductors', 'hamstrings', 'lower back'] },
  deadlift: { target: 'glutes', secondary: ['hamstrings', 'lower back', 'quads', 'traps', 'forearms'] },
}

export const isBig3 = (lift: Session['lift']): lift is LiftId => lift === 'bench' || lift === 'squat' || lift === 'deadlift'

export function sessionName(s: Pick<Session, 'lift' | 'exercise'>) {
  if (s.exercise) return s.exercise.name
  return isBig3(s.lift) ? LIFTS[s.lift].name : '其他动作'
}

export const LIFT_COLOR: Record<LiftId | 'other', string> = { bench: '#c8ff3d', squat: '#5eead4', deadlift: '#ff9d5c', other: '#a78bfa' }
export const sessionColor = (s: Pick<Session, 'lift'>) => LIFT_COLOR[s.lift] ?? LIFT_COLOR.other

/** History for the same exercise: big three by lift, others by library id */
export const sameExercise = (a: Pick<Session, 'lift' | 'exercise'>, b: Pick<Session, 'lift' | 'exercise'>) =>
  isBig3(a.lift) ? a.lift === b.lift && !b.exercise : !!a.exercise && a.exercise.id === b.exercise?.id

export function sessionMuscles(s: Pick<Session, 'lift' | 'exercise'>) {
  if (s.exercise?.target) return { target: s.exercise.target, secondary: s.exercise.secondary ?? [] }
  return isBig3(s.lift) ? BIG3_MUSCLES[s.lift] : null
}
