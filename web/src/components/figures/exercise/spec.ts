// Exercise → animation spec. Nothing here is written per exercise: the movement comes from the
// exercise's pattern (or a few name keywords for patterns without video analysis, e.g. flyes),
// the body position from modifier words in the name (incline / decline / seated / bent over …),
// the drawn equipment from its equipment field and the highlighted muscles from its muscle lists.
import type { ExerciseInfo } from '../../../lib/movement/types'

export type Base =
  | 'press' // horizontal push
  | 'fly'
  | 'pullover'
  | 'pushup'
  | 'ohp' // vertical push
  | 'dip'
  | 'row'
  | 'pull' // pull-up / pulldown
  | 'curl'
  | 'triceps'
  | 'raise'
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'thrust'
  | 'calf'
  | 'legcurl'
  | 'legext'
  | 'crunch'
  | 'plank'

export type Posture = 'stand' | 'bent' | 'seated' | 'supine' | 'prone' | 'hang' | 'kneel'

export type Equip = 'barbell' | 'dumbbell' | 'kettlebell' | 'cable' | 'band' | 'machine' | 'smith' | 'ball' | 'none'

export type Region =
  | 'chest'
  | 'delts'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'lats'
  | 'upperBack'
  | 'lowerBack'
  | 'abs'
  | 'glutes'
  | 'quads'
  | 'hamstrings'
  | 'calves'

export interface ExerciseSpec {
  base: Base
  posture: Posture
  /** bench angle in degrees for supine work: + incline, − decline, 0 flat */
  bench: number
  /** a variant of the base picked from the name (e.g. triceps: pushdown / overhead / lying / kickback) */
  variant: string
  equip: Equip
  unilateral: boolean
  /** muscle regions to light up: 1 = prime mover, 0.45 = synergist */
  muscles: Partial<Record<Region, number>>
}

const PATTERN_BASE: Record<string, Base> = {
  'horizontal-push': 'press',
  'push-up': 'pushup',
  'vertical-push': 'ohp',
  dip: 'dip',
  'horizontal-pull': 'row',
  'vertical-pull': 'pull',
  'elbow-flexion': 'curl',
  'elbow-extension': 'triceps',
  'shoulder-raise': 'raise',
  squat: 'squat',
  hinge: 'hinge',
  lunge: 'lunge',
  'hip-thrust': 'thrust',
  'calf-raise': 'calf',
  'knee-flexion': 'legcurl',
  'knee-extension': 'legext',
  'core-flexion': 'crunch',
  'isometric-hold': 'plank',
}

const EQUIP: Record<string, Equip> = {
  barbell: 'barbell',
  'ez barbell': 'barbell',
  'olympic barbell': 'barbell',
  'trap bar': 'barbell',
  dumbbell: 'dumbbell',
  kettlebell: 'kettlebell',
  cable: 'cable',
  rope: 'cable',
  band: 'band',
  'resistance band': 'band',
  'leverage machine': 'machine',
  'sled machine': 'machine',
  'smith machine': 'smith',
  'medicine ball': 'ball',
}

const MUSCLE: Record<string, Region> = {
  pectorals: 'chest',
  chest: 'chest',
  'upper chest': 'chest',
  delts: 'delts',
  shoulders: 'delts',
  deltoids: 'delts',
  'rear deltoids': 'delts',
  'rotator cuff': 'delts',
  biceps: 'biceps',
  brachialis: 'biceps',
  triceps: 'triceps',
  forearms: 'forearms',
  'wrist flexors': 'forearms',
  'wrist extensors': 'forearms',
  'grip muscles': 'forearms',
  wrists: 'forearms',
  hands: 'forearms',
  lats: 'lats',
  'latissimus dorsi': 'lats',
  back: 'lats',
  'upper back': 'upperBack',
  rhomboids: 'upperBack',
  traps: 'upperBack',
  trapezius: 'upperBack',
  'levator scapulae': 'upperBack',
  spine: 'lowerBack',
  'lower back': 'lowerBack',
  abs: 'abs',
  core: 'abs',
  obliques: 'abs',
  abdominals: 'abs',
  'lower abs': 'abs',
  'hip flexors': 'abs',
  'serratus anterior': 'abs',
  glutes: 'glutes',
  abductors: 'glutes',
  quads: 'quads',
  quadriceps: 'quads',
  adductors: 'quads',
  'inner thighs': 'quads',
  groin: 'quads',
  hamstrings: 'hamstrings',
  calves: 'calves',
  soleus: 'calves',
  ankles: 'calves',
}

const has = (name: string, re: RegExp) => re.test(name)

function baseOf(ex: ExerciseInfo): Base | null {
  const n = ex.name
  // names that change the movement even within one pattern
  if (has(n, /\brear (delt|fly|lateral)|reverse fly|rear delt/)) return 'raise'
  if (has(n, /shrug/)) return 'raise'
  if (has(n, /\bfly\b|\bflyes?\b|pec deck|cross[- ]?over/)) return 'fly'
  if (has(n, /pullover/)) return 'pullover'
  if (has(n, /\bplank\b/)) return 'plank'
  if (ex.big3 === 'bench') return 'press'
  if (ex.big3 === 'squat') return 'squat'
  if (ex.big3 === 'deadlift') return 'hinge'
  return ex.pattern ? (PATTERN_BASE[ex.pattern] ?? null) : null
}

/** Body position and base variant from the modifier words in the name. */
function postureOf(base: Base, n: string, equip: Equip): { posture: Posture; bench: number; variant: string } {
  const incline = has(n, /\bincline\b/)
  const decline = has(n, /\bdecline\b/)
  const seated = has(n, /\bseated\b|\bsitting\b|\bsit\b/)
  const bent = has(n, /bent[- ]?over|\bbent\b|\bbend\b/)
  const lying = has(n, /\blying\b|\bfloor\b|\bbench press\b/)
  const bench = incline ? 30 : decline ? -15 : 0
  switch (base) {
    case 'press':
      if (incline || decline || lying || equip === 'barbell' || equip === 'dumbbell' || equip === 'smith') return { posture: 'supine', bench, variant: '' }
      return { posture: seated || equip === 'machine' ? 'seated' : 'stand', bench: 0, variant: '' }
    case 'fly':
      if (has(n, /pec deck|lever|machine/) || seated) return { posture: 'seated', bench: 0, variant: 'deck' }
      if ((equip === 'cable' || equip === 'band') && !incline && !decline && !lying) return { posture: 'stand', bench: 0, variant: 'crossover' }
      return { posture: 'supine', bench, variant: '' }
    case 'pullover':
      return { posture: 'supine', bench: 0, variant: '' }
    case 'pushup':
      return { posture: 'prone', bench: 0, variant: incline ? 'incline' : decline ? 'decline' : has(n, /knee/) ? 'knee' : '' }
    case 'ohp':
      return { posture: seated ? 'seated' : 'stand', bench: 0, variant: '' }
    case 'dip':
      return { posture: 'hang', bench: 0, variant: has(n, /bench/) ? 'bench' : '' }
    case 'row':
      if (has(n, /inverted/)) return { posture: 'supine', bench: 0, variant: 'inverted' }
      if (incline) return { posture: 'prone', bench: 45, variant: 'chest' }
      if (seated || ((equip === 'cable' || equip === 'machine') && !bent)) return { posture: 'seated', bench: 0, variant: '' }
      return { posture: 'bent', bench: 0, variant: has(n, /upright/) ? 'upright' : '' }
    case 'pull':
      if (has(n, /pull[- ]?up|chin[- ]?up|\bmuscle up\b/) || equip === 'none') return { posture: 'hang', bench: 0, variant: '' }
      return { posture: 'seated', bench: 0, variant: '' }
    case 'curl':
      if (has(n, /preacher|scott/)) return { posture: 'seated', bench: 0, variant: 'preacher' }
      if (has(n, /concentration/)) return { posture: 'seated', bench: 0, variant: 'concentration' }
      if (incline) return { posture: 'supine', bench: 45, variant: 'incline' }
      if (lying) return { posture: 'supine', bench: 0, variant: 'lying' }
      return { posture: seated ? 'seated' : 'stand', bench: 0, variant: '' }
    case 'triceps':
      if (has(n, /kickback|kick back/)) return { posture: 'bent', bench: 0, variant: 'kickback' }
      if (has(n, /push ?down|press ?down/)) return { posture: 'stand', bench: 0, variant: 'pushdown' }
      if (has(n, /lying|skull|crusher|\bjm\b/) || decline || incline) return { posture: 'supine', bench, variant: 'lying' }
      if (has(n, /overhead|french|behind/) || seated || has(n, /standing/)) return { posture: seated ? 'seated' : 'stand', bench: 0, variant: 'overhead' }
      return equip === 'cable' || equip === 'band'
        ? { posture: 'stand', bench: 0, variant: 'pushdown' }
        : { posture: 'supine', bench: 0, variant: 'lying' }
    case 'raise':
      if (has(n, /\brear\b|reverse fly|bent/)) return { posture: 'bent', bench: 0, variant: 'rear' }
      if (has(n, /\bfront\b/)) return { posture: seated ? 'seated' : 'stand', bench: 0, variant: 'front' }
      if (has(n, /shrug/)) return { posture: 'stand', bench: 0, variant: 'shrug' }
      if (has(n, /upright row/)) return { posture: 'stand', bench: 0, variant: 'upright' }
      return { posture: seated ? 'seated' : 'stand', bench: 0, variant: 'lateral' }
    case 'squat':
      if (has(n, /leg press|sled/)) return { posture: 'seated', bench: 0, variant: 'legpress' }
      if (has(n, /goblet|front|zercher|\bcup\b/) || equip === 'kettlebell' || equip === 'ball') return { posture: 'stand', bench: 0, variant: 'front' }
      if (equip === 'dumbbell' || equip === 'none' || equip === 'band') return { posture: 'stand', bench: 0, variant: 'hang' }
      return { posture: 'stand', bench: 0, variant: 'back' }
    case 'hinge':
      if (has(n, /hyperextension|back extension|hip extension|reverse hyper/)) return { posture: 'prone', bench: 45, variant: 'hyper' }
      if (has(n, /good morning/)) return { posture: 'stand', bench: 0, variant: 'goodmorning' }
      return { posture: 'stand', bench: 0, variant: '' }
    case 'lunge':
      return { posture: 'stand', bench: 0, variant: has(n, /bulgarian|rear foot|elevated/) ? 'bulgarian' : has(n, /step[- ]?up/) ? 'stepup' : '' }
    case 'thrust':
      return { posture: 'supine', bench: 0, variant: has(n, /bridge/) ? 'bridge' : '' }
    case 'calf':
      return { posture: seated ? 'seated' : 'stand', bench: 0, variant: '' }
    case 'legcurl':
      return { posture: seated ? 'seated' : 'prone', bench: 0, variant: seated ? 'seated' : '' }
    case 'legext':
      return { posture: 'seated', bench: 0, variant: '' }
    case 'crunch':
      if (has(n, /hanging|captain|\bdip station\b/)) return { posture: 'hang', bench: 0, variant: has(n, /knee/) ? 'knee' : 'leg' }
      return { posture: 'supine', bench: 0, variant: has(n, /leg raise|leg lift|reverse/) ? 'legraise' : '' }
    case 'plank':
      return { posture: 'prone', bench: 0, variant: '' }
  }
}

/** null when the exercise has no movement we can animate (cardio, stretches, …) */
export function exerciseSpec(ex: ExerciseInfo): ExerciseSpec | null {
  const base = baseOf(ex)
  if (!base) return null
  const n = ex.name.toLowerCase()
  let equip: Equip = EQUIP[ex.equipment] ?? 'none'
  // "barbell" in a cable/machine name etc. is rare; but bodyweight moves holding a plate / ball
  if (equip === 'none' && has(n, /\bplate\b/)) equip = 'ball'
  const muscles: ExerciseSpec['muscles'] = {}
  for (const m of ex.secondaryMuscles) {
    const r = MUSCLE[m]
    if (r && !muscles[r]) muscles[r] = 0.45
  }
  const t = MUSCLE[ex.target]
  if (t) muscles[t] = 1
  return {
    base,
    ...postureOf(base, n, equip),
    equip,
    unilateral: !!ex.unilateral || has(n, /one arm|single arm|one leg|single leg|alternat/),
    muscles,
  }
}
