export type LiftId = 'bench' | 'squat' | 'deadlift'
export type AngleId = 'side' | 'front45' | 'front' | 'rear45'

/** One sampled video frame. Landmarks are normalized [0,1] image coords. */
export interface PoseFrame {
  t: number // seconds
  /** 33 landmarks flattened as [x, y, visibility] * 33, or null if no pose */
  lm: Float32Array | null
  bar: { x: number; y: number } | null
}

export interface Rep {
  index: number
  start: number // frame index (top / start position)
  bottom: number // frame index of lowest bar position
  end: number // frame index (top again / lockout)
  eccentricS: number
  concentricS: number
}

export type Severity = 'good' | 'warn' | 'bad' | 'info'

export interface Finding {
  id: string
  title: string
  detail: string
  severity: Severity
  value?: number
  unit?: string
  target?: string
  sourceIds: string[]
  /** 0..1, lowered when landmarks are occluded */
  confidence: number
  /** rep indices this applies to (empty = whole set) */
  reps?: number[]
}

export interface ClipAnalysis {
  angle: AngleId
  fps: number
  width: number
  height: number
  side: 'left' | 'right' | 'both'
  /** bar/wrist: big three (y is normalized image height); joint: generic movement pattern (y is joint angle, degrees) */
  signal: 'bar' | 'wrist' | 'joint'
  barCoverage: number
  poseCoverage: number
  reps: Rep[]
  findings: Finding[]
  /** per-frame primary signal, for charts */
  trace: { t: number; y: number; x: number }[]
  /** Generic movement pattern (when signal = joint) */
  pattern?: import('./movement/types').PatternId
  joint?: import('./movement/patterns').Joint
  /** Hold duration for static holds (seconds) */
  holdS?: number
}

export interface AgentCue {
  title: string
  detail: string
  priority: 'high' | 'medium' | 'low'
  evidence?: string
  sourceIds: string[]
}

export interface AgentSessionResult {
  verdict: 'solid' | 'needs_work' | 'unsafe'
  score: number
  summary: string
  cues: AgentCue[]
  metricDisagreements: string[]
  cameraAdvice: string
  nextSession: string
}

export interface AgentProgressResult {
  headline: string
  strengths: string[]
  weaknesses: string[]
  trends: { lift: string; observation: string; direction: 'up' | 'flat' | 'down' }[]
  plan: string[]
  sourceIds: string[]
}

export interface Session {
  id?: number
  date: string // YYYY-MM-DD local
  createdAt: number
  /** Big three; other library exercises are 'other', with details in exercise */
  lift: LiftId | 'other'
  exercise?: import('./exerciseRef').ExerciseRef
  /** Hold duration for static-hold exercises (seconds) */
  holdS?: number
  /** Issue summary (warn/bad findings), used by the ability page so it doesn't need to read the whole clip */
  issues?: { id: string; title: string; severity: 'warn' | 'bad' }[]
  equipment: 'barbell' | 'smith'
  weightKg: number | null
  reps: number
  rpe: number | null
  notes: string
  score: number
  coachId: string | null
  agent?: AgentSessionResult | null
  agentMeta?: { costUsd: number | null; durationMs: number | null; at: number } | null
  /** Sets filmed in workout mode: which workout, which exercise, which set (all 0-based) */
  workout?: { id: number; item: number; set: number }
}

export interface Clip {
  id?: number
  sessionId: number
  angle: AngleId
  /** Records imported from a backup have no video */
  video?: Blob
  fileName: string
  analysis: ClipAnalysis
  keyframes: { name: string; blob: Blob }[]
  /** packed per-frame data for overlay replay: lm = n*99 (NaN = no pose), bar = n*2; absent on records imported from backup */
  pose?: PackedPose
}

export interface PackedPose {
  fps: number
  n: number
  lm: Float32Array
  bar: Float32Array
}

export interface Source {
  id: string
  title: string
  authors: string
  year: number | string
  url: string
  kind: 'rulebook' | 'textbook' | 'position' | 'study' | 'review'
  lifts: (LiftId | 'all')[]
  takeaway: string
  verified: boolean
}
