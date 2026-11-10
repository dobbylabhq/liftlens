// Generic movement analysis: pose frames → joint-angle signal → rep segmentation → generic checks.
// Every exercise mapped to a movement pattern goes through here; the big three still use the dedicated rules in analyze.ts (bar tracking + IPF).
import { LM } from '../pose'
import { interpolate, savgol, segmentReps } from '../analyze'
import type { AngleId, ClipAnalysis, Finding, PoseFrame, Rep } from '../types'
import { MIN_ECCENTRIC_S, PATTERNS, type Check, type Joint, type PatternDef, type Target } from './patterns'
import type { PatternId } from './types'

type Pt = { x: number; y: number; v: number }
type Side = 'left' | 'right'
interface Data {
  frames: PoseFrame[]
  fps: number
  width: number
  height: number
}

const IDX = {
  left: { s: LM.lShoulder, e: LM.lElbow, w: LM.lWrist, h: LM.lHip, k: LM.lKnee, a: LM.lAnkle },
  right: { s: LM.rShoulder, e: LM.rElbow, w: LM.rWrist, h: LM.rHip, k: LM.rKnee, a: LM.rAnkle },
}

// ---------------------------------------------------------------- Helpers

const median = (a: number[]) => {
  if (!a.length) return NaN
  const s = [...a].sort((p, q) => p - q)
  return s[s.length >> 1]
}
const mean = (a: number[]) => (a.length ? a.reduce((p, q) => p + q, 0) / a.length : NaN)
const std = (a: number[]) => {
  const m = mean(a)
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)))
}
const pct = (a: number[], p: number) => {
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]
}
const r0 = (n: number) => Math.round(n)
const r2 = (n: number) => Math.round(n * 100) / 100
const list = (xs: number[]) => xs.join('、')

export function angleAt(a: Pt, b: Pt, c: Pt) {
  const v1x = a.x - b.x
  const v1y = a.y - b.y
  const v2x = c.x - b.x
  const v2y = c.y - b.y
  const cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1)
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI
}

function pointOf(lm: Float32Array | null, k: number, W: number, H: number, minV = 0.1): Pt | null {
  if (!lm || lm[k * 3 + 2] < minV) return null
  return { x: lm[k * 3] * W, y: lm[k * 3 + 1] * H, v: lm[k * 3 + 2] }
}

/** Angle (degrees) of a joint on one side; null if not clearly visible */
export function jointAngle(lm: Float32Array | null, joint: Exclude<Joint, 'ankleRise'>, side: Side, W = 1, H = 1): number | null {
  const i = IDX[side]
  const P = (k: number) => pointOf(lm, k, W, H)
  const tri: [number, number, number] =
    joint === 'knee' ? [i.h, i.k, i.a] : joint === 'hip' ? [i.s, i.h, i.k] : joint === 'elbow' ? [i.s, i.e, i.w] : [i.h, i.s, i.e]
  const [a, b, c] = tri.map(P)
  return a && b && c ? angleAt(a, b, c) : null
}

/** Signed angle (degrees) between torso and vertical: swinging/cheating shows up in its range of change */
function torsoLean(lm: Float32Array | null, side: Side, W: number, H: number): number | null {
  const s = pointOf(lm, IDX[side].s, W, H)
  const h = pointOf(lm, IDX[side].h, W, H)
  if (!s || !h) return null
  return (Math.atan2(s.x - h.x, h.y - s.y) * 180) / Math.PI
}

/** Shoulder–hip–ankle "body line" deviation: positive = sagging (hip below the line), negative = hips piked; plus whether the body is near horizontal */
function bodyLineOf(lm: Float32Array | null, side: Side, W: number, H: number) {
  const s = pointOf(lm, IDX[side].s, W, H)
  const h = pointOf(lm, IDX[side].h, W, H)
  const a = pointOf(lm, IDX[side].a, W, H)
  if (!s || !h || !a) return null
  const dev = 180 - angleAt(s, h, a)
  // Hip above/below the shoulder–ankle line (image y points down)
  const t = (h.x - s.x) / (a.x - s.x || 1e-6)
  const lineY = s.y + t * (a.y - s.y)
  const horizontal = Math.abs((Math.atan2(a.y - s.y, a.x - s.x) * 180) / Math.PI)
  const tilt = Math.min(horizontal, 180 - horizontal) // 0 = horizontal
  return { dev: h.y > lineY ? dev : -dev, tilt }
}

function visibility(frames: PoseFrame[], ks: number[]) {
  const v: number[] = []
  for (const f of frames) if (f.lm) for (const k of ks) v.push(f.lm[k * 3 + 2])
  return v.length ? mean(v) : 0
}

// ---------------------------------------------------------------- Signals

/** Sliding median (removes spikes from single-frame misdetections, e.g. elbow angle suddenly jumping to 6° or 138°) */
export function medianFilter(y: number[], k = 5) {
  const h = k >> 1
  return y.map((_, i) => median(y.slice(Math.max(0, i - h), Math.min(y.length, i + h + 1))))
}

interface Signal {
  /** Raw joint value (degrees; for calf raises, % of shin length) */
  value: number[]
  /** Larger = closer to peak (used for rep segmentation) */
  excursion: number[]
  side: Side
  coverage: number
  conf: number
}

function jointSeries(d: Data, joint: Joint, side: Side): (number | null)[] {
  const { frames, width: W, height: H } = d
  if (joint !== 'ankleRise') return frames.map((f) => jointAngle(f.lm, joint, side, W, H))
  // Calf raise: ankle lift relative to "standing", normalized by shin length
  const i = IDX[side]
  const shin = median(
    frames
      .map((f) => {
        const k = pointOf(f.lm, i.k, W, H)
        const a = pointOf(f.lm, i.a, W, H)
        return k && a ? Math.hypot(k.x - a.x, k.y - a.y) : NaN
      })
      .filter((x) => !Number.isNaN(x)),
  )
  const ys = frames.map((f) => pointOf(f.lm, i.a, W, H)?.y ?? null)
  const base = pct(ys.filter((y): y is number => y != null), 0.9)
  return ys.map((y) => (y == null || !shin ? null : ((base - y) / shin) * 100))
}

/**
 * Auxiliary rep-counting signals: positional quantities that move with the joint angle but are less sensitive to occlusion (all normalized by limb length).
 * Elbow: wrist–shoulder distance / upper-arm length; knee: hip height above ankle / leg length; hip: shoulder–knee distance / (torso + thigh); shoulder: wrist height above shoulder / arm length.
 */
function auxSeries(d: Data, joint: Joint, side: Side): (number | null)[] {
  if (joint === 'ankleRise') return []
  const { frames, width: W, height: H } = d
  const i = IDX[side]
  const P = (f: PoseFrame, k: number) => pointOf(f.lm, k, W, H)
  const len = (a: number, b: number) =>
    median(
      frames
        .map((f) => {
          const p = P(f, a)
          const q = P(f, b)
          return p && q ? Math.hypot(p.x - q.x, p.y - q.y) : NaN
        })
        .filter((x) => !Number.isNaN(x)),
    ) || 1
  if (joint === 'elbow') {
    const ua = len(i.s, i.e)
    return frames.map((f) => {
      const s = P(f, i.s)
      const w = P(f, i.w)
      return s && w ? Math.hypot(s.x - w.x, s.y - w.y) / ua : null
    })
  }
  if (joint === 'knee') {
    const leg = len(i.h, i.k) + len(i.k, i.a)
    return frames.map((f) => {
      const h = P(f, i.h)
      const a = P(f, i.a)
      return h && a ? (a.y - h.y) / leg : null
    })
  }
  if (joint === 'hip') {
    const L = len(i.s, i.h) + len(i.h, i.k)
    return frames.map((f) => {
      const s = P(f, i.s)
      const k = P(f, i.k)
      return s && k ? Math.hypot(s.x - k.x, s.y - k.y) / L : null
    })
  }
  const arm = len(i.s, i.e) + len(i.e, i.w)
  return frames.map((f) => {
    const s = P(f, i.s)
    const w = P(f, i.w)
    return s && w ? (s.y - w.y) / arm : null
  })
}

/** Multi-signal fusion: each signal is de-spiked, normalized to 0..1 by its 5%–95% percentiles, then averaged weighted by coverage */
function fuse(series: (number | null)[][], n: number): number[] | null {
  const parts: { y: number[]; w: number }[] = []
  for (const raw of series) {
    const cov = raw.filter((x) => x != null).length / Math.max(1, n)
    if (cov < 0.3) continue
    const y = medianFilter(interpolate(raw), 5)
    const lo = pct(y, 0.05)
    const hi = pct(y, 0.95)
    if (hi - lo < 1e-6) continue
    parts.push({ y: y.map((v) => (v - lo) / (hi - lo)), w: cov })
  }
  if (!parts.length) return null
  const W = parts.reduce((a, p) => a + p.w, 0)
  return Array.from({ length: n }, (_, i) => parts.reduce((a, p) => a + p.y[i] * p.w, 0) / W)
}

function buildSignal(d: Data, p: PatternDef, unilateral: boolean): Signal | null {
  const sides: Side[] = ['left', 'right']
  const per = sides.map((side) => {
    const raw = jointSeries(d, p.joint, side)
    const present = raw.filter((x): x is number => x != null)
    const coverage = present.length / Math.max(1, raw.length)
    const range = present.length ? pct(present, 0.95) - pct(present, 0.05) : 0
    const i = IDX[side]
    const ks = p.joint === 'knee' ? [i.h, i.k, i.a] : p.joint === 'hip' ? [i.s, i.h, i.k] : p.joint === 'elbow' ? [i.s, i.e, i.w] : p.joint === 'shoulder' ? [i.h, i.s, i.e] : [i.k, i.a]
    return { side, raw, coverage, range, vis: visibility(d.frames, ks) }
  })
  let raw: (number | null)[]
  let pick = per[0]
  if (p.id === 'lunge') {
    // Alternating lunge: per frame take the knee with the smaller angle (= front leg)
    raw = per[0].raw.map((l, i) => {
      const r = per[1].raw[i]
      return l == null ? r : r == null ? l : Math.min(l, r)
    })
    pick = per[0].vis >= per[1].vis ? per[0] : per[1]
  } else {
    const ok = per.filter((s) => s.coverage >= 0.3)
    if (!ok.length) return null
    // Unilateral: pick the side that moves more; bilateral: pick the more visible side
    pick = unilateral ? ok.reduce((a, b) => (b.range > a.range ? b : a)) : ok.reduce((a, b) => (b.vis * b.coverage > a.vis * a.coverage ? b : a))
    raw = pick.raw
  }
  const coverage = raw.filter((x) => x != null).length / Math.max(1, raw.length)
  if (coverage < 0.3) return null
  const value = savgol(savgol(medianFilter(interpolate(raw), 5)))
  // Count reps on the fused signal (main joint angle + both sides + auxiliary positions), more occlusion-robust than one joint angle; range checks still use the real angle value
  const useSides: Side[] = p.id === 'lunge' ? [] : unilateral ? [pick.side] : ['left', 'right']
  const fused =
    p.id === 'lunge'
      ? null
      : fuse(
          [raw, ...useSides.filter((sd) => sd !== pick.side || unilateral).map((sd) => (sd === pick.side ? null : per.find((x) => x.side === sd)!.raw)).filter((x): x is (number | null)[] => !!x), ...useSides.map((sd) => auxSeries(d, p.joint, sd))],
          raw.length,
        )
  const countSig = fused ? savgol(savgol(fused)).map((v) => v * 100) : value
  const excursion = countSig.map((v) => (p.rest === 'high' ? -v : v))
  return { value, excursion, side: pick.side, coverage, conf: r2(Math.min(1, pick.vis) * Math.min(1, coverage / 0.8)) }
}

/** Segmentation thresholds (fraction of the signal's 5%–95% range). Offline tuning: 15/15 synthetic sets correct, 9/9 real bench; exported for future tuning */
export const SEG = { down: 0.36, up: 0.2 }

/** Segment reps + filter (stray movement before setup/after leaving, tiny jitters) */
function repsOf(sig: Signal, d: Data, p: PatternDef): Rep[] {
  // segmentReps assumes "larger value = closer to the bottom"; our excursion is exactly that.
  // Local adaptive normalization: each frame is normalized to 0..100 by the min/max in a ±5 s window around it.
  // Whole-clip percentiles get skewed by extremes before/after the set (unracking, adjusting, off-frame interpolation), so the whole set fails to cross the threshold.
  // Thresholds are lower than for the big three: half reps must still be counted (the range check flags them); jitter is handled by the later merge step
  const ex = sig.excursion
  const w = Math.round(d.fps * 5)
  const local = ex.map((_, i) => {
    let lo = Infinity
    let hi = -Infinity
    for (let j = Math.max(0, i - w); j <= Math.min(ex.length - 1, i + w); j++) {
      if (ex[j] < lo) lo = ex[j]
      if (ex[j] > hi) hi = ex[j]
    }
    return hi - lo < 12 ? 0 : ((ex[i] - lo) / (hi - lo)) * 100
  })
  const raw = segmentReps(local, d.fps, SEG)
  const amp = (r: Rep) => sig.excursion[r.bottom] - Math.min(sig.excursion[r.start], sig.excursion[r.end])
  const medAmp = median(raw.map(amp))
  let kept = raw.filter((r) => {
    const n = r.end - r.start + 1
    const dur = n / d.fps
    const withPose = d.frames.slice(r.start, r.end + 1).filter((f) => f.lm).length
    return withPose / n >= 0.3 && dur >= 0.4 && dur <= 12 && amp(r) >= 0.35 * medAmp
  })
  // Merge: two "bottoms" too close together without returning near the start position → jitter within the same rep
  const merged: Rep[] = []
  for (const r of kept) {
    const prev = merged[merged.length - 1]
    if (prev) {
      const gapMin = Math.min(...sig.excursion.slice(prev.bottom, r.bottom + 1))
      const back = sig.excursion[prev.bottom] - gapMin
      if (back < 0.55 * Math.min(amp(prev), amp(r))) {
        const deeper = sig.excursion[r.bottom] > sig.excursion[prev.bottom] ? r.bottom : prev.bottom
        merged[merged.length - 1] = { ...prev, bottom: deeper, end: r.end }
        continue
      }
    }
    merged.push(r)
  }
  kept = merged
  // Drop stray movement far from the main block (setting up, adjusting equipment, putting weights down afterwards…)
  const gaps = kept.slice(1).map((r, i) => r.bottom - kept[i].bottom)
  const maxGap = Math.max(5 * d.fps, 3 * (median(gaps) || d.fps * 2))
  kept = kept.filter((r, i, arr) => {
    const prevGap = i ? r.bottom - arr[i - 1].bottom : Infinity
    const nextGap = i < arr.length - 1 ? arr[i + 1].bottom - r.bottom : Infinity
    return arr.length <= 2 || prevGap <= maxGap || nextGap <= maxGap
  })
  // With multiple segments keep only the longest (one set per video)
  const runs: Rep[][] = []
  for (const r of kept) {
    const last = runs[runs.length - 1]
    if (last && r.bottom - last[last.length - 1].bottom <= maxGap) last.push(r)
    else runs.push([r])
  }
  kept = runs.reduce((a, b) => (b.length > a.length ? b : a), [] as Rep[])
  return kept.map((r, i) => {
    const ecc = (r.bottom - r.start) / d.fps
    const con = (r.end - r.bottom) / d.fps
    // For movements whose eccentric is on the "leaving peak" side (curls, rows…), swap the two phase durations so eccentricS is always the eccentric
    const swap = p.eccentric === 'fromPeak'
    return { ...r, index: i + 1, eccentricS: r2(swap ? con : ecc), concentricS: r2(swap ? ecc : con) }
  })
}

/** Extreme of the real joint angle near the peak (±0.3 s): single-frame angles are noisy, so take the most "complete" one in the window */
function peakValue(c: { sig: Signal; p: PatternDef; d: Data }, r: Rep) {
  const w = Math.max(2, Math.round(c.d.fps * 0.3))
  const seg = c.sig.value.slice(Math.max(0, r.bottom - w), r.bottom + w + 1)
  return c.p.rest === 'high' ? Math.min(...seg) : Math.max(...seg)
}
function restValue(c: { sig: Signal; p: PatternDef; d: Data }, r: Rep) {
  const w = Math.max(2, Math.round(c.d.fps * 0.3))
  const around = (i: number) => c.sig.value.slice(Math.max(0, i - w), i + w + 1)
  const seg = [...around(r.start), ...around(r.end)]
  return c.p.rest === 'high' ? Math.max(...seg) : Math.min(...seg)
}

const meets = (v: number, t: Target) => (t.op === '<=' ? v <= t.deg : v >= t.deg)

// ---------------------------------------------------------------- Checks

interface Ctx {
  d: Data
  p: PatternDef
  sig: Signal
  reps: Rep[]
  view: AngleId
  label: string
}

function inReps(c: Ctx) {
  const out: number[] = []
  for (const r of c.reps) for (let i = r.start; i <= r.end; i++) out.push(i)
  return out
}

function romFindings(c: Ctx): Finding[] {
  const { p, sig, reps } = c
  const out: Finding[] = []
  if (!reps.length) return out
  // From a front view joint angles are foreshortened, so only judge range for exercises that are recommended to be filmed from the front
  const romReliable = c.view === 'side' || p.camera.angle === c.view
  if (!romReliable) return out
  const unit = p.joint === 'ankleRise' ? '% 小腿长' : '°'
  if (p.peakTarget) {
    const vals = reps.map((r) => peakValue(c, r))
    const miss = reps.filter((r) => !meets(peakValue(c, r), p.peakTarget!)).map((r) => r.index)
    out.push({
      id: `${p.id}.rom`,
      title: '动作幅度',
      detail: miss.length
        ? `第 ${list(miss)} 次没有做到位（${p.peakTarget.label}）。全幅度对增肌和力量更有效，做不满时先减重量。`
        : `每次都做到位了（${p.peakTarget.label}）。`,
      severity: !miss.length ? 'good' : miss.length > reps.length / 2 ? 'bad' : 'warn',
      value: r0(median(vals)),
      unit,
      target: p.peakTarget.label,
      sourceIds: ['schoenfeld-grgic-2020', 'nsca-technique-4e'],
      confidence: sig.conf,
      reps: miss,
    })
  }
  if (p.restTarget) {
    const back = (r: Rep) => restValue(c, r)
    const miss = reps.filter((r) => !meets(back(r), p.restTarget!)).map((r) => r.index)
    out.push({
      id: `${p.id}.lockout`,
      title: p.rest === 'high' && p.eccentric === 'fromPeak' ? '每次回到伸直' : '起始位 / 锁定',
      detail: miss.length ? `第 ${list(miss)} 次没有回到起始位置（${p.restTarget.label}），相当于半程次数。` : `每次都回到了起始位置（${p.restTarget.label}）。`,
      severity: !miss.length ? 'good' : miss.length > reps.length / 2 ? 'bad' : 'warn',
      value: r0(median(reps.map(back))),
      unit,
      target: p.restTarget.label,
      sourceIds: ['nsca-technique-4e'],
      confidence: sig.conf,
      reps: miss,
    })
  }
  return out
}

const CHECKS: Record<Check, (c: Ctx) => Finding | null> = {
  tempo: (c) => {
    if (c.p.ballistic || !c.reps.length) return null
    const fast = c.reps.filter((r) => r.eccentricS < MIN_ECCENTRIC_S).map((r) => r.index)
    const word = c.p.eccentric === 'toPeak' ? '下放' : '还原'
    return {
      id: `${c.p.id}.tempo`,
      title: `${word}节奏`,
      detail: fast.length
        ? `第 ${list(fast)} 次${word}不到 ${MIN_ECCENTRIC_S} 秒，偏快，靠惯性完成会减少肌肉在离心阶段的受力。`
        : `${word}平均 ${r2(mean(c.reps.map((r) => r.eccentricS)))} 秒，控制得不错。`,
      severity: fast.length > c.reps.length / 2 ? 'warn' : 'good',
      value: r2(median(c.reps.map((r) => r.eccentricS))),
      unit: 's',
      target: `≥ ${MIN_ECCENTRIC_S}s`,
      sourceIds: ['wilk-2019', 'nsca-technique-4e'],
      confidence: 0.85,
      reps: fast,
    }
  },
  consistency: (c) => {
    if (c.reps.length < 3) return null
    const sd = std(c.reps.map((r) => peakValue(c, r)))
    const ankle = c.p.joint === 'ankleRise'
    const [w, b] = ankle ? [4, 7] : [10, 16]
    return {
      id: `${c.p.id}.consistency`,
      title: '每次幅度一致性',
      detail: sd < w ? '每次的幅度几乎一样，动作稳定。' : `每次到达的位置相差约 ${r0(sd)}${ankle ? '%' : '°'}，组内动作还不够稳定。`,
      severity: sd < w ? 'good' : sd < b ? 'warn' : 'bad',
      value: r0(sd),
      unit: ankle ? '%' : '°',
      target: `< ${w}${ankle ? '%' : '°'}`,
      sourceIds: ['zatsiorsky-2021'],
      confidence: c.sig.conf,
    }
  },
  fatigue: (c) => {
    if (c.reps.length < 4) return null
    const con = c.reps.map((r) => r.concentricS)
    const ratio = con[con.length - 1] / ((con[0] + con[1]) / 2 || 1)
    if (ratio < 1.5) return null
    return {
      id: `${c.p.id}.velocity_loss`,
      title: '最后几次明显变慢',
      detail: `最后一次发力用时是前两次的 ${r2(ratio)} 倍，说明已经接近力竭。想多练几组的话，这一组可以少做一两次。`,
      severity: 'info',
      value: r2(ratio),
      unit: '×',
      sourceIds: ['sanchez-medina-2011'],
      confidence: 0.8,
    }
  },
  swing: (c) => {
    if (c.view !== 'side' || !c.reps.length) return null
    const { frames, width: W, height: H } = c.d
    const lean = inReps(c)
      .map((i) => torsoLean(frames[i].lm, c.sig.side, W, H))
      .filter((x): x is number => x != null)
    if (lean.length < 5) return null
    const range = pct(lean, 0.95) - pct(lean, 0.05)
    return {
      id: `${c.p.id}.swing`,
      title: '借力 / 躯干晃动',
      detail: range < 12 ? '躯干基本稳定，没有明显借力。' : `做的过程中躯干前后晃动了约 ${r0(range)}°，在用身体的惯性帮忙，目标肌肉练得少了。可以减一点重量。`,
      severity: range < 12 ? 'good' : range < 20 ? 'warn' : 'bad',
      value: r0(range),
      unit: '°',
      target: '< 12°',
      sourceIds: ['nsca-technique-4e'],
      confidence: c.sig.conf,
    }
  },
  elbowDrift: (c) => {
    if (c.view !== 'side' || !c.reps.length) return null
    const { frames, width: W, height: H } = c.d
    const arm = inReps(c)
      .map((i) => jointAngle(frames[i].lm, 'shoulder', c.sig.side, W, H))
      .filter((x): x is number => x != null)
    if (arm.length < 5) return null
    const range = pct(arm, 0.95) - pct(arm, 0.05)
    return {
      id: `${c.p.id}.elbow_drift`,
      title: '大臂是否固定',
      detail: range < 25 ? '大臂基本固定，主要靠肘关节发力。' : `大臂前后摆动了约 ${r0(range)}°，肩部在帮忙，手臂肌肉的负荷被分走了。把肘部固定在身体侧面。`,
      severity: range < 25 ? 'good' : range < 40 ? 'warn' : 'bad',
      value: r0(range),
      unit: '°',
      target: '< 25°',
      sourceIds: ['nsca-technique-4e'],
      confidence: c.sig.conf,
    }
  },
  bodyLine: (c) => {
    if (c.view !== 'side') return null
    const { frames, width: W, height: H } = c.d
    const idx = c.reps.length ? inReps(c) : frames.map((_, i) => i)
    const lines = idx.map((i) => bodyLineOf(frames[i].lm, c.sig.side, W, H)).filter((x): x is { dev: number; tilt: number } => !!x && x.tilt < 40)
    if (lines.length < 5) return null
    const dev = median(lines.map((l) => l.dev))
    const a = Math.abs(dev)
    return {
      id: `${c.p.id}.body_line`,
      title: '身体是否成一条线',
      detail: a < 12 ? '肩、髋、踝基本在一条直线上，核心收得住。' : dev > 0 ? `髋部比肩—踝连线低了约 ${r0(a)}°（塌腰），腰椎压力变大。收紧腹部和臀部。` : `臀部撅起约 ${r0(a)}°，核心没有参与，动作变容易了。把臀部放下来。`,
      severity: a < 12 ? 'good' : a < 20 ? 'warn' : 'bad',
      value: r0(dev),
      unit: '°',
      target: '|偏差| < 12°',
      sourceIds: ['nsca-technique-4e'],
      confidence: c.sig.conf,
    }
  },
  valgus: (c) => {
    if (c.view !== 'front' || !c.reps.length) return null
    const { frames, width: W, height: H } = c.d
    const ratios: number[] = []
    for (const r of c.reps) {
      const lm = frames[r.bottom].lm
      const LK = pointOf(lm, LM.lKnee, W, H)
      const RK = pointOf(lm, LM.rKnee, W, H)
      const LA = pointOf(lm, LM.lAnkle, W, H)
      const RA = pointOf(lm, LM.rAnkle, W, H)
      if (LK && RK && LA && RA) ratios.push(Math.abs(LK.x - RK.x) / Math.abs(LA.x - RA.x || 1))
    }
    if (!ratios.length) return null
    const v = median(ratios)
    return {
      id: `${c.p.id}.valgus`,
      title: '膝内扣',
      detail: v < 0.9 ? `到底时两膝间距只有两踝间距的 ${r0(v * 100)}%，膝盖往里扣了。膝盖对准脚尖。` : '膝盖与脚尖方向一致，没有明显内扣。',
      severity: v < 0.8 ? 'bad' : v < 0.9 ? 'warn' : 'good',
      value: r2(v),
      target: '≥ 0.9',
      sourceIds: ['escamilla-2001', 'schoenfeld-2010'],
      confidence: c.sig.conf,
    }
  },
  asymmetry: (c) => {
    if (c.view !== 'front' || !c.reps.length || c.p.joint === 'ankleRise') return null
    const { frames, width: W, height: H } = c.d
    const j = c.p.joint as Exclude<Joint, 'ankleRise'>
    const diffs: number[] = []
    for (const r of c.reps) {
      const L = jointAngle(frames[r.bottom].lm, j, 'left', W, H)
      const R = jointAngle(frames[r.bottom].lm, j, 'right', W, H)
      if (L != null && R != null) diffs.push(Math.abs(L - R))
    }
    if (diffs.length < 2) return null
    const d = median(diffs)
    return {
      id: `${c.p.id}.asymmetry`,
      title: '左右对称',
      detail: d < 15 ? '左右两侧动作基本对称。' : `到位时左右两侧相差约 ${r0(d)}°，一侧做得少或在代偿。可以先做单侧练习补弱侧。`,
      severity: d < 15 ? 'good' : d < 25 ? 'warn' : 'bad',
      value: r0(d),
      unit: '°',
      target: '< 15°',
      sourceIds: ['nsca-technique-4e'],
      confidence: c.sig.conf,
    }
  },
}

// ---------------------------------------------------------------- Static holds

function holdOf(d: Data) {
  // Longest continuous stretch with a person in frame (tolerates 0.5 s of dropped frames)
  let best = 0
  let start = -1
  let lastSeen = -1
  for (let i = 0; i < d.frames.length; i++) {
    if (!d.frames[i].lm) continue
    if (start < 0 || (i - lastSeen) / d.fps > 0.5) start = i
    lastSeen = i
    best = Math.max(best, (lastSeen - start) / d.fps)
  }
  return r2(best)
}

// ---------------------------------------------------------------- Entry point

export interface MovementOptions {
  unilateral?: boolean
  hold?: boolean
  /** Exercise name (used in cue text) */
  label?: string
}

export function analyzeMovement(patternId: PatternId, view: AngleId, d: Data, o: MovementOptions = {}): ClipAnalysis {
  const p = PATTERNS[patternId]
  const poseCoverage = r2(d.frames.filter((f) => f.lm).length / Math.max(1, d.frames.length))
  const base = { angle: view, fps: d.fps, width: d.width, height: d.height, barCoverage: 0, poseCoverage, pattern: patternId, joint: p.joint } as const
  const isHold = o.hold || patternId === 'isometric-hold'
  const sig = buildSignal(d, p, !!o.unilateral)

  if (!sig) {
    return {
      ...base,
      side: 'both',
      signal: 'joint',
      reps: [],
      trace: [],
      findings: [
        {
          id: 'clip.no_pose',
          title: '没看清动作',
          detail: `画面里${p.joint === 'elbow' ? '手臂' : p.joint === 'ankleRise' ? '小腿和脚踝' : '躯干和腿'}的关键点大部分时间看不清。推荐机位：${p.camera.tip}。`,
          severity: 'warn',
          sourceIds: [],
          confidence: 1,
        },
      ],
    }
  }

  const trace = sig.value.map((v, i) => ({ t: r2(d.frames[i].t), y: r2(v), x: 0 }))

  if (isHold) {
    const holdS = holdOf(d)
    const c: Ctx = { d, p, sig, reps: [], view, label: o.label ?? p.zh }
    const line = CHECKS.bodyLine(c)
    return {
      ...base,
      side: view === 'front' ? 'both' : sig.side,
      signal: 'joint',
      reps: [],
      holdS,
      trace,
      findings: [
        {
          id: 'hold.duration',
          title: '保持时长',
          detail: `连续保持了 ${r0(holdS)} 秒。`,
          severity: 'info',
          value: r0(holdS),
          unit: 's',
          sourceIds: [],
          confidence: 0.9,
        },
        ...(line ? [line] : []),
      ],
    }
  }

  const reps = repsOf(sig, d, p)
  const c: Ctx = { d, p, sig, reps, view, label: o.label ?? p.zh }
  const findings: Finding[] = [...romFindings(c)]
  for (const k of p.checks) {
    if (o.unilateral && k === 'asymmetry') continue
    const f = CHECKS[k](c)
    if (f) findings.push(f)
  }
  if (!reps.length)
    findings.unshift({
      id: 'clip.no_reps',
      title: '没有识别到完整的次数',
      detail: `关节角的变化幅度太小，或动作没有完整入画。推荐机位：${p.camera.tip}。`,
      severity: 'warn',
      sourceIds: [],
      confidence: 1,
    })
  return { ...base, side: view === 'front' ? 'both' : sig.side, signal: 'joint', reps, trace, findings }
}

/** For development debugging only */
export const __debug = { buildSignal, repsOf, fuse, auxSeries }
