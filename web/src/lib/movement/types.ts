// Movement patterns: group hundreds of exercises into a dozen-odd kinds of "how it moves".
// Each kind defines one rep-counting signal + a set of generic checks, so any library exercise mapped to a pattern
// automatically gets video rep counting and form checks. The big three (bench/squat/deadlift) have dedicated in-depth analysis (bar tracking + IPF rules).

export type PatternId =
  | 'squat' // Squat family: knee/hip flexion-extension (bodyweight squat, goblet, front squat, leg press…)
  | 'hinge' // Hip hinge: deadlift, Romanian deadlift, good morning, kettlebell swing
  | 'lunge' // Single-leg: lunge, split squat, Bulgarian split squat, step-up
  | 'hip-thrust' // Hip thrust, glute bridge
  | 'horizontal-push' // Bench family: barbell/dumbbell/machine chest press (lying or seated)
  | 'push-up' // Push-up family (body in a straight line)
  | 'vertical-push' // Overhead press: standing/seated shoulder press, push press
  | 'dip' // Parallel-bar dip, bench dip
  | 'horizontal-pull' // Row family
  | 'vertical-pull' // Pull-up, lat pulldown
  | 'elbow-flexion' // Curl family
  | 'elbow-extension' // Triceps extension/pushdown/skull crusher
  | 'shoulder-raise' // Lateral raise, front raise, Y-raise
  | 'calf-raise' // Calf raise
  | 'knee-flexion' // Leg curl (lying/seated/standing)
  | 'knee-extension' // Leg extension
  | 'core-flexion' // Crunch, sit-up, leg raise
  | 'isometric-hold' // Static holds: plank, side plank, wall sit, dead hang

/** One exercise in the library (data from ExerciseDB v1, MIT) */
export interface ExerciseInfo {
  /** ExerciseDB id, permanent */
  id: string
  /** English name (lowercase, equipment first, e.g. "dumbbell incline curl") */
  name: string
  /** Chinese name */
  zh: string
  bodyPart: string
  equipment: string
  /** Primary target muscles (ExerciseDB vocabulary) */
  target: string
  secondaryMuscles: string[]
  /** Mapped movement pattern; null = no video analysis yet, logging only */
  pattern: PatternId | null
  /** Unilateral exercise (sides done separately): left/right symmetry checks are meaningless, reps counted per side */
  unilateral?: boolean
  /** Held, not repeated (plank etc.); logged by duration */
  hold?: boolean
  /** One of the big three: routed to dedicated in-depth analysis */
  big3?: 'bench' | 'squat' | 'deadlift'
}
