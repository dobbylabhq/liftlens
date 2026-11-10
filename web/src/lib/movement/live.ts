// Live rep counting: update state on every incoming keypoint frame (used by camera live mode).
// Uses the same movement pattern definitions as the offline engine, but only data up to the current frame:
//   median + exponential smoothing → normalize by "start–peak" → hysteresis state machine → instant cues (range/cheating etc.) after each rep.
// Start and peak values begin at the pattern's typical values, then adapt to the user's own actual range rep by rep.
import { jointAngle, angleAt } from './engine'
import { PATTERNS, type PatternDef } from './patterns'
import type { PatternId } from './types'

export interface LiveRep {
  index: number
  /** Extreme reached in this rep (degrees) */
  peak: number
  okPeak: boolean
  eccentricS: number
  concentricS: number
  /** Instant cues for this rep (short Chinese phrases, suitable for speech) */
  cues: string[]
}

export interface LiveState {
  reps: number
  phase: 'idle' | 'rest' | 'moving'
  /** Current joint angle (smoothed), null when not visible */
  value: number | null
  /** Current progress toward the peak, 0..1 (for the progress ring/animation) */
  progress: number
  /** Whether the person is clearly visible */
  tracking: boolean
  /** Static hold: seconds held so far */
  holdS?: number
  /** The rep just completed on this frame (only present on that frame) */
  justDone?: LiveRep
  last?: LiveRep
}

export interface LiveCounter {
  push(lm: Float32Array | null, tMs: number): LiveState
  reset(): void
  readonly pattern: PatternDef
}

const LM = { ls: 11, rs: 12, lh: 23, rh: 24, la: 27, ra: 28, lk: 25, rk: 26 }

export function createLiveCounter(patternId: PatternId, opts: { unilateral?: boolean; hold?: boolean } = {}): LiveCounter {
  const p = PATTERNS[patternId]
  const isHold = opts.hold || patternId === 'isometric-hold'
  let rest = p.typical.rest
  let peak = p.typical.peak
  let reps = 0
  let phase: LiveState['phase'] = 'idle'
  let ema: number | null = null
  const recent: number[] = []
  let lastSeen = 0
  let seenSince = 0
  // Current rep
  let tStart = 0
  let tPeak = 0
  let extreme = 0
  let maxProg = 0
  let leanMin = Infinity
  let leanMax = -Infinity
  let sagSum = 0
  let sagN = 0
  let last: LiveRep | undefined
  // Static hold
  let holdStart = 0
  let holdS = 0
  let sideVis = { left: 0, right: 0 }
  const hist: [number, number][] = []

  const pick = (lm: Float32Array): number | null => {
    if (p.joint === 'ankleRise') {
      // Live calf raise: approximated by the ankle's height change relative to the knee (knee–ankle distance barely changes; as the ankle rises the vertical component changes little, so use the ankle's relative y directly)
      const a = lm[LM.la * 3 + 2] > lm[LM.ra * 3 + 2] ? LM.la : LM.ra
      const k = a === LM.la ? LM.lk : LM.rk
      const shin = Math.hypot(lm[a * 3] - lm[k * 3], lm[a * 3 + 1] - lm[k * 3 + 1]) || 1
      return (-lm[a * 3 + 1] / shin) * 100
    }
    const j = p.joint
    const L = jointAngle(lm, j, 'left')
    const R = jointAngle(lm, j, 'right')
    if (patternId === 'lunge') return L == null ? R : R == null ? L : Math.min(L, R)
    // Update per-side visibility slowly and pick the more visible side, avoiding frame-to-frame flip-flopping
    const vis = (ks: number[]) => ks.reduce((a, k) => a + lm[k * 3 + 2], 0) / ks.length
    const ks = { elbow: [11, 13, 15], knee: [23, 25, 27], hip: [11, 23, 25], shoulder: [23, 11, 13] }[j]
    sideVis = { left: sideVis.left * 0.9 + vis(ks) * 0.1, right: sideVis.right * 0.9 + vis(ks.map((k) => k + 1)) * 0.1 }
    if (opts.unilateral && L != null && R != null) {
      // Unilateral: the side further from the start value is the one moving
      return Math.abs(L - rest) > Math.abs(R - rest) ? L : R
    }
    return sideVis.left >= sideVis.right ? (L ?? R) : (R ?? L)
  }

  const torsoLean = (lm: Float32Array) => {
    const s = lm[LM.ls * 3 + 2] > lm[LM.rs * 3 + 2] ? LM.ls : LM.rs
    const h = s === LM.ls ? LM.lh : LM.rh
    if (lm[s * 3 + 2] < 0.3 || lm[h * 3 + 2] < 0.3) return null
    return (Math.atan2(lm[s * 3] - lm[h * 3], lm[h * 3 + 1] - lm[s * 3 + 1]) * 180) / Math.PI
  }
  const bodySag = (lm: Float32Array) => {
    const s = lm[LM.ls * 3 + 2] > lm[LM.rs * 3 + 2] ? LM.ls : LM.rs
    const h = s === LM.ls ? LM.lh : LM.rh
    const a = s === LM.ls ? LM.la : LM.ra
    if ([s, h, a].some((k) => lm[k * 3 + 2] < 0.3)) return null
    const P = (k: number) => ({ x: lm[k * 3], y: lm[k * 3 + 1], v: 1 })
    const dev = 180 - angleAt(P(s), P(h), P(a))
    const t = (lm[h * 3] - lm[s * 3]) / (lm[a * 3] - lm[s * 3] || 1e-6)
    const lineY = lm[s * 3 + 1] + t * (lm[a * 3 + 1] - lm[s * 3 + 1])
    return lm[h * 3 + 1] > lineY ? dev : -dev
  }

  const reset = () => {
    rest = p.typical.rest
    peak = p.typical.peak
    reps = 0
    phase = 'idle'
    ema = null
    recent.length = 0
    hist.length = 0
    lastSeen = 0
    seenSince = 0
    last = undefined
    holdStart = 0
    holdS = 0
  }

  const push = (lm: Float32Array | null, t: number): LiveState => {
    const raw = lm ? pick(lm) : null
    const tracking = raw != null
    if (!tracking) {
      // No person for 0.8 s: return to idle (pauses the static hold timer)
      if (t - lastSeen > 800) {
        phase = 'idle'
        holdStart = 0
      }
      return { reps, phase, value: ema, progress: 0, tracking, holdS: isHold ? holdS : undefined, last }
    }
    if (lastSeen === 0 || t - lastSeen > 800) seenSince = t
    lastSeen = t
    // Median (5 frames) to remove spikes + exponential smoothing
    recent.push(raw!)
    if (recent.length > 5) recent.shift()
    const med = [...recent].sort((a, b) => a - b)[recent.length >> 1]
    if (ema == null && p.joint === 'ankleRise') {
      // Calf raise values are relative: treat the first frame as the standing baseline
      rest = med
      peak = med + p.typical.peak
    }
    ema = ema == null ? med : ema * 0.55 + med * 0.45
    const v = ema

    if (isHold) {
      // Start timing after 0.5 s of stable presence in frame
      if (!holdStart && t - seenSince > 500) holdStart = t
      if (holdStart) holdS = Math.max(holdS, (t - holdStart) / 1000)
      const sag = lm ? bodySag(lm) : null
      return { reps: 0, phase: holdStart ? 'moving' : 'rest', value: v, progress: 0, tracking, holdS: Math.round(holdS * 10) / 10, last: sag != null && Math.abs(sag) > 15 && p.cue.bodyLine ? { index: 0, peak: sag, okPeak: false, eccentricS: 0, concentricS: 0, cues: [p.cue.bodyLine] } : undefined }
    }

    // Calibrate start/peak from the range actually observed over the last 8 s: the user's range may be much narrower than typical (arms not fully extending, inherently small-range movements…)
    hist.push([t, v])
    while (hist.length && t - hist[0][0] > 8000) hist.shift()
    if (hist.length > 10) {
      const vs = hist.map((h) => h[1])
      const hi = Math.max(...vs)
      const lo = Math.min(...vs)
      const typSpan = Math.abs(p.typical.rest - p.typical.peak)
      if (hi - lo > typSpan * 0.18) {
        const [oRest, oPeak] = p.rest === 'high' ? [hi, lo] : [lo, hi]
        const k = reps < 3 ? 0.3 : 0.1 // Fast calibration for the first few reps, stable afterwards
        rest = rest * (1 - k) + oRest * k
        peak = peak * (1 - k) + oPeak * k
      }
    }
    const span = rest - peak || 1
    const prog = Math.max(0, Math.min(1.2, (rest - v) / span)) // 0 = start position, 1 = peak
    let justDone: LiveRep | undefined

    if (phase === 'idle') phase = prog < 0.3 ? 'rest' : 'idle'
    else if (phase === 'rest' && prog > 0.36) {
      phase = 'moving'
      tStart = t
      tPeak = t
      extreme = v
      maxProg = prog
      leanMin = Infinity
      leanMax = -Infinity
      sagSum = 0
      sagN = 0
    } else if (phase === 'moving') {
      // Record extremes directly by angle direction (progress is clamped during calibration and can't be used to find the peak)
      if (p.rest === 'high' ? v < extreme : v > extreme) {
        extreme = v
        tPeak = t
      }
      maxProg = Math.max(maxProg, prog)
      const lean = lm ? torsoLean(lm) : null
      if (lean != null) {
        leanMin = Math.min(leanMin, lean)
        leanMax = Math.max(leanMax, lean)
      }
      const sag = lm && p.checks.includes('bodyLine') ? bodySag(lm) : null
      if (sag != null) {
        sagSum += sag
        sagN++
      }
      if (prog < 0.2 && t - tStart > 350) {
        // One rep completed
        reps++
        phase = 'rest'
        const toPeak = (tPeak - tStart) / 1000
        const fromPeak = (t - tPeak) / 1000
        // Smoothing hasn't caught up during the first two reps; allow 8° slack to avoid false alarms
        const tol = reps <= 2 ? 8 : 0
        const okPeak = p.peakTarget ? (p.peakTarget.op === '<=' ? extreme <= p.peakTarget.deg + tol : extreme >= p.peakTarget.deg - tol) : true
        const cues: string[] = []
        if (!okPeak && p.cue.peak) cues.push(p.cue.peak)
        if (p.checks.includes('swing') && leanMax - leanMin > 15 && p.cue.swing) cues.push(p.cue.swing)
        if (sagN && Math.abs(sagSum / sagN) > 15 && p.cue.bodyLine) cues.push(p.cue.bodyLine)
        justDone = {
          index: reps,
          peak: Math.round(extreme),
          okPeak,
          eccentricS: Math.round((p.eccentric === 'toPeak' ? toPeak : fromPeak) * 100) / 100,
          concentricS: Math.round((p.eccentric === 'toPeak' ? fromPeak : toPeak) * 100) / 100,
          cues,
        }
        last = justDone
        // Adaptive: slowly replace typical values with the user's own peak/start (only accept a plausible range)
        if (Math.abs(extreme - rest) > Math.abs(p.typical.rest - p.typical.peak) * 0.3) peak = peak * 0.6 + extreme * 0.4
      }
    }
    if (phase === 'rest' && prog < 0.25) rest = rest * 0.97 + v * 0.03
    return { reps, phase, value: Math.round(v), progress: Math.min(1, prog), tracking, justDone, last }
  }

  return { push, reset, pattern: p }
}
