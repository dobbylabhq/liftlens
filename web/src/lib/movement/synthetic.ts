// Dev testing only: generate synthetic pose sequences for each movement pattern via forward kinematics (known ground truth: reps, range, cheating…).
// Not referenced by app code and never ships in the production bundle.
import type { PoseFrame } from '../types'

type P = [number, number]
const rad = (d: number) => (d * Math.PI) / 180
const at = (o: P, len: number, deg: number): P => [o[0] + len * Math.sin(rad(deg)), o[1] - len * Math.cos(rad(deg))] // deg: 0 = up, 90 = right

export interface SynthOpts {
  reps: number
  /** Duration of each rep (seconds) */
  period?: number
  fps?: number
  /** Start/peak joint angles */
  from: number
  to: number
  /** Peak actually reached per rep (overrides to; used to create "insufficient range" reps) */
  peaks?: number[]
  noise?: number
  /** Spike probability (single-frame misdetection) */
  spikes?: number
  /** Torso swing amplitude (degrees) */
  swing?: number
  /** Hip sag (degrees) */
  sag?: number
  idleS?: number
  seed?: number
}

function rng(seed: number) {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

/** 33-point MediaPipe layout; unused points have visibility 0 */
function frameFrom(pts: Record<number, P>, rand: () => number, noise: number, spike: boolean): Float32Array {
  const lm = new Float32Array(99)
  for (const [k, p] of Object.entries(pts)) {
    const i = Number(k)
    const jitter = spike && (i === 13 || i === 25 || i === 23) ? 0.08 : 0
    lm[i * 3] = p[0] + (rand() - 0.5) * noise + (rand() - 0.5) * jitter
    lm[i * 3 + 1] = p[1] + (rand() - 0.5) * noise + (rand() - 0.5) * jitter
    lm[i * 3 + 2] = 0.9
  }
  return lm
}

function timeline(o: SynthOpts) {
  const fps = o.fps ?? 12
  const period = o.period ?? 2
  const idle = o.idleS ?? 2
  const n = Math.round((idle * 2 + o.reps * period) * fps)
  return Array.from({ length: n }, (_, i) => {
    const t = i / fps
    const inSet = t >= idle && t < idle + o.reps * period
    const rep = Math.floor((t - idle) / period)
    const ph = inSet ? (1 - Math.cos((2 * Math.PI * (t - idle)) / period)) / 2 : 0 // 0→1→0
    const peak = o.peaks?.[rep] ?? o.to
    return { t, ph, ang: o.from + (peak - o.from) * ph, rep }
  })
}

/** Both sides symmetric: left and right points coincide (side view); left indices 11/13/15/23/25/27, right 12/14/16/24/26/28 */
function both(pts: Record<string, P>): Record<number, P> {
  const map: Record<string, [number, number]> = { s: [11, 12], e: [13, 14], w: [15, 16], h: [23, 24], k: [25, 26], a: [27, 28] }
  const out: Record<number, P> = { 0: pts.nose ?? pts.s }
  for (const [k, [l, r]] of Object.entries(map)) if (pts[k]) out[l] = out[r] = pts[k]
  return out
}

function build(o: SynthOpts, pose: (ang: number, ph: number, t: number) => Record<string, P>) {
  const fps = o.fps ?? 12
  const rand = rng(o.seed ?? 7)
  const frames: PoseFrame[] = timeline(o).map(({ t, ang, ph }) => ({
    t,
    lm: frameFrom(both(pose(ang, ph, t)), rand, o.noise ?? 0.004, rand() < (o.spikes ?? 0)),
    bar: null,
  }))
  return { frames, fps, width: 1000, height: 1000 }
}

const L = { shin: 0.22, thigh: 0.22, torso: 0.3, ua: 0.15, fa: 0.14 }

export const synth = {
  /** Squat: knee angle from→to */
  squat: (o: SynthOpts) =>
    build(o, (knee) => {
      const a: P = [0.5, 0.9]
      const bend = (180 - knee) / 2
      const k = at(a, L.shin, bend)
      const h = at(k, L.thigh, -bend)
      const s = at(h, L.torso, bend * 0.6)
      return { a, k, h, s, e: at(s, L.ua, 150), w: at(at(s, L.ua, 150), L.fa, 60) }
    }),
  /** Curl: elbow angle from (extended)→to (flexed); swing = torso rocking back and forth */
  curl: (o: SynthOpts) =>
    build(o, (elbow, ph) => {
      const a: P = [0.5, 0.92]
      const k = at(a, L.shin, 0)
      const h = at(k, L.thigh, 0)
      const lean = (o.swing ?? 0) * ph
      const s = at(h, L.torso, -lean)
      const e = at(s, L.ua, 180 - lean * 0.3)
      const w = at(e, L.fa, 180 - lean * 0.3 - (180 - elbow))
      return { a, k, h, s, e, w }
    }),
  /** Push-up: elbow angle from→to (forward kinematics: wrist fixed, forearm near vertical, upper arm rotates by elbow angle); sag = hip sag angle */
  pushup: (o: SynthOpts) =>
    build(o, (elbow) => {
      const w: P = [0.3, 0.85]
      const e = at(w, L.fa, 10)
      const s = at(e, L.ua, 190 + elbow)
      const a: P = [s[0] + 0.58, 0.85]
      const mid: P = [(s[0] + a[0]) / 2, (s[1] + a[1]) / 2 + (o.sag ?? 0) * 0.004]
      const k: P = [(mid[0] + a[0]) / 2, (mid[1] + a[1]) / 2]
      return { s, e, w, h: mid, k, a, nose: [s[0] - 0.05, s[1] - 0.02] }
    }),
  /** Pull-up: elbow angle from (extended)→to (pulled up) (wrist fixed on the bar, forearm pointing down, upper arm rotates by elbow angle) */
  pullup: (o: SynthOpts) =>
    build(o, (elbow, _ph, t) => {
      const w: P = [0.5, 0.15]
      const e = at(w, L.fa, 170)
      const s0 = at(e, L.ua, elbow - 10)
      const s: P = [s0[0] + (o.swing ?? 0) * 0.002 * Math.sin(t * 3), s0[1]]
      const h = at(s, L.torso, 180)
      const k = at(h, L.thigh, 180)
      const a = at(k, L.shin, 180)
      return { s, e, w, h, k, a }
    }),
  /** Lateral raise (from the side it looks like a front raise): shoulder angle from→to */
  raise: (o: SynthOpts) =>
    build(o, (sh, ph) => {
      const a: P = [0.5, 0.92]
      const k = at(a, L.shin, 0)
      const h = at(k, L.thigh, 0)
      const s = at(h, L.torso, -(o.swing ?? 0) * ph)
      const e = at(s, L.ua, 180 - sh)
      const w = at(e, L.fa, 180 - sh)
      return { a, k, h, s, e, w }
    }),
  /** Plank: hold for o.reps*period seconds; sag = hip sag */
  plank: (o: SynthOpts) =>
    build(o, () => {
      const s: P = [0.3, 0.6]
      const a: P = [0.85, 0.66]
      const h: P = [(s[0] + a[0]) / 2, (s[1] + a[1]) / 2 + (o.sag ?? 0) * 0.004]
      return { s, e: [0.3, 0.75], w: [0.36, 0.78], h, k: [(h[0] + a[0]) / 2, (h[1] + a[1]) / 2], a }
    }),
}
