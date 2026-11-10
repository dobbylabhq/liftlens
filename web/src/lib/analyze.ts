import { LM } from './pose'
import type { AngleId, ClipAnalysis, Finding, LiftId, PoseFrame, Rep } from './types'

/**
 * Deterministic rule engine: pose frames → reps → findings.
 * Every threshold is normalised by a body segment length (torso, femur, shin, forearm,
 * shoulder width), so it works across body sizes and camera distances.
 * Rule ↔ source mapping lives in coaches/_shared/metrics.md.
 */

type Pt = { x: number; y: number; v: number }

interface Ctx {
  frames: PoseFrame[]
  fps: number
  W: number
  H: number
  side: 'left' | 'right'
}

const SIDE = {
  left: { s: LM.lShoulder, e: LM.lElbow, w: LM.lWrist, h: LM.lHip, k: LM.lKnee, a: LM.lAnkle, heel: LM.lHeel, toe: LM.lFoot },
  right: { s: LM.rShoulder, e: LM.rElbow, w: LM.rWrist, h: LM.rHip, k: LM.rKnee, a: LM.rAnkle, heel: LM.rHeel, toe: LM.rFoot },
}

function pt(c: Ctx, i: number, k: number): Pt | null {
  const lm = c.frames[i]?.lm
  // visibility ~0 = landmark not produced by this backend (e.g. RTMO/COCO-17 has no heels/toes)
  if (!lm || lm[k * 3 + 2] < 0.05) return null
  return { x: lm[k * 3] * c.W, y: lm[k * 3 + 1] * c.H, v: lm[k * 3 + 2] }
}

/** +1 / -1: which image direction the lifter faces. Toes→heel if available, else nose vs ear. */
function facingOf(c: Ctx, s: { toe: number; heel: number }) {
  const ear = c.side === 'left' ? 7 : 8
  const vals = c.frames.map((_, i) => {
    const t = pt(c, i, s.toe)
    const h = pt(c, i, s.heel)
    if (t && h) return t.x - h.x
    const n = pt(c, i, LM.nose)
    const e = pt(c, i, ear)
    return n && e ? n.x - e.x : 0
  })
  return Math.sign(median(vals.filter((v) => v !== 0))) || 1
}
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
function angle(a: Pt, b: Pt, c: Pt) {
  const v1 = { x: a.x - b.x, y: a.y - b.y }
  const v2 = { x: c.x - b.x, y: c.y - b.y }
  const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1)
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI
}
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
const r2 = (n: number) => Math.round(n * 100) / 100
const r0 = (n: number) => Math.round(n)

/** median length of a segment over frames where both ends are visible */
function segLen(c: Ctx, a: number, b: number) {
  const out: number[] = []
  for (let i = 0; i < c.frames.length; i++) {
    const p = pt(c, i, a)
    const q = pt(c, i, b)
    if (p && q && p.v > 0.5 && q.v > 0.5) out.push(dist(p, q))
  }
  return median(out)
}

function visibilityOf(c: Ctx, idx: number[], frames?: number[]) {
  const vs: number[] = []
  for (const i of frames ?? c.frames.map((_, j) => j)) {
    for (const k of idx) {
      const p = pt(c, i, k)
      if (p) vs.push(p.v)
    }
  }
  return vs.length ? mean(vs) : 0
}

/** Savitzky–Golay (window 7, quadratic) smoothing – preserves peaks better than a box filter */
export function savgol(y: number[]) {
  const k = [-2, 3, 6, 7, 6, 3, -2]
  return y.map((_, i) => {
    if (i < 3 || i >= y.length - 3) return y[i]
    let s = 0
    for (let j = -3; j <= 3; j++) s += k[j + 3] * y[i + j]
    return s / 21
  })
}

export function interpolate(vals: (number | null)[]) {
  const out = [...vals]
  let last = -1
  for (let i = 0; i < out.length; i++) {
    if (out[i] == null) continue
    if (last >= 0 && i - last > 1) {
      for (let j = last + 1; j < i; j++) out[j] = out[last]! + ((out[i]! - out[last]!) * (j - last)) / (i - last)
    } else if (last < 0) {
      for (let j = 0; j < i; j++) out[j] = out[i]
    }
    last = i
  }
  if (last >= 0) for (let j = last + 1; j < out.length; j++) out[j] = out[last]
  return out.map((v) => v ?? 0)
}

function buildSignal(c: Ctx) {
  const barCov = c.frames.filter((f) => f.bar).length / Math.max(1, c.frames.length)
  const useBar = barCov >= 0.6
  const s = SIDE[c.side]
  const raw = c.frames.map((f, i) => {
    if (useBar) return f.bar ? { x: f.bar.x * c.W, y: f.bar.y * c.H } : null
    const w1 = pt(c, i, s.w)
    const w2 = pt(c, i, c.side === 'left' ? LM.rWrist : LM.lWrist)
    const ws = [w1, w2].filter((p): p is Pt => !!p && p.v > 0.3)
    if (!ws.length) return null
    return { x: mean(ws.map((p) => p.x)), y: mean(ws.map((p) => p.y)) }
  })
  const xs = savgol(interpolate(raw.map((p) => p?.x ?? null)))
  const ys = savgol(interpolate(raw.map((p) => p?.y ?? null)))
  return { xs, ys, kind: (useBar ? 'bar' : 'wrist') as 'bar' | 'wrist', barCov }
}

/** Hysteresis state machine (borrowed from FormCheck-style rep counters, but on bar height). */
export function segmentReps(ys: number[], fps: number, th: { down: number; up: number } = { down: 0.65, up: 0.35 }): Rep[] {
  if (ys.length < fps) return []
  const lo = pct(ys, 0.05)
  const hi = pct(ys, 0.95)
  const range = hi - lo
  if (range < 12) return [] // < ~12px of travel at 640px: no movement
  const downT = lo + th.down * range
  const upT = lo + th.up * range
  const bottoms: number[] = []
  let inBottom = ys[0] > downT
  let zoneStart = 0
  for (let i = 0; i < ys.length; i++) {
    if (!inBottom && ys[i] > downT) {
      inBottom = true
      zoneStart = i
    } else if (inBottom && ys[i] < upT) {
      inBottom = false
      let b = zoneStart
      for (let j = zoneStart; j <= i; j++) if (ys[j] > ys[b]) b = j
      if (!bottoms.length || (b - bottoms[bottoms.length - 1]) / fps > 0.6) bottoms.push(b)
    }
  }
  return bottoms.map((b, idx) => {
    const from = idx ? bottoms[idx - 1] : 0
    const to = idx < bottoms.length - 1 ? bottoms[idx + 1] : ys.length - 1
    let start = from
    for (let j = from; j <= b; j++) if (ys[j] < ys[start]) start = j
    let end = b
    for (let j = b; j <= to; j++) if (ys[j] < ys[end]) end = j
    // tighten to the plateau edges: last frame near the top before descending,
    // first frame near the top after ascending (excludes rest time at lockout)
    const tol = 0.05 * range
    for (let j = start; j <= b; j++) if (ys[j] <= ys[start] + tol) start = j
    for (let j = b; j <= end; j++) if (ys[j] <= ys[end] + tol) { end = j; break }
    return { index: idx + 1, start, bottom: b, end, eccentricS: r2((b - start) / fps), concentricS: r2((end - b) / fps) }
  })
}

/** median range of motion of the set (bar travel, px) — a scale that needs no skeleton */
function romOf(reps: Rep[], ys: number[]) {
  return median(reps.map((r) => ys[r.bottom] - Math.min(ys[r.start], ys[r.end]))) || 1
}

// ---------------------------------------------------------------- common rules

function commonRules(reps: Rep[], ys: number[], lift: LiftId): Finding[] {
  const out: Finding[] = []
  if (!reps.length) return out
  const rom = romOf(reps, ys)
  const ipf = `ipf-2026-${lift}`

  // eccentric tempo (deadlift eccentric is the set-down, skip)
  if (lift !== 'deadlift') {
    const ecc = reps.map((r) => r.eccentricS)
    const fast = reps.filter((r) => r.eccentricS < 0.6).map((r) => r.index)
    out.push({
      id: `${lift}.eccentric_tempo`,
      title: '下放节奏',
      detail: fast.length
        ? `第 ${fast.join('、')} 次下放不到 0.6 秒，偏快，容易借助反弹、难以控制触胸/触底位置。`
        : `下放平均 ${r2(mean(ecc))} 秒，控制良好。`,
      severity: fast.length > reps.length / 2 ? 'warn' : 'good',
      value: r2(median(ecc)),
      unit: 's',
      target: '≥ 0.6s（常用 1–3s）',
      sourceIds: ['wilk-2019', 'nsca-technique-4e'],
      confidence: 0.9,
      reps: fast,
    })
  }

  // bar must not travel downward during the concentric phase (IPF)
  const dips: number[] = []
  for (const r of reps) {
    let minSoFar = ys[r.bottom]
    for (let i = r.bottom + 1; i <= r.end; i++) {
      minSoFar = Math.min(minSoFar, ys[i])
      if (ys[i] - minSoFar > 0.08 * rom) {
        dips.push(r.index)
        break
      }
    }
  }
  if (dips.length)
    out.push({
      id: `${lift}.downward_in_concentric`,
      title: '向心过程中杠铃下沉',
      detail: `第 ${dips.join('、')} 次推/起的过程中杠铃有明显回落，比赛中会被判红灯，也说明这一重量接近力竭或节奏断了。`,
      severity: 'warn',
      sourceIds: [ipf],
      confidence: 0.75,
      reps: dips,
    })

  // consistency of bottom position
  if (reps.length >= 3) {
    const bottomsY = reps.map((r) => ys[r.bottom])
    const sd = std(bottomsY) / rom
    out.push({
      id: `${lift}.rep_consistency`,
      title: '每次到底位置一致性',
      detail:
        sd < 0.05
          ? '每一次到底的位置几乎一样，技术稳定。'
          : `到底位置的波动约为本组行程的 ${r0(sd * 100)}%，说明每次的幅度不一样，组内技术还不够稳定。`,
      severity: sd < 0.05 ? 'good' : sd < 0.1 ? 'warn' : 'bad',
      value: r0(sd * 100),
      unit: '% 行程',
      target: '< 5%',
      sourceIds: ['zatsiorsky-2021'],
      confidence: 0.8,
    })
  }
  return out
}

// ---------------------------------------------------------------- bench (side)

function benchSide(c: Ctx, reps: Rep[], xs: number[], ys: number[]): Finding[] {
  const s = SIDE[c.side]
  const out: Finding[] = []
  const forearm = segLen(c, s.e, s.w) || 60
  const torso = segLen(c, s.s, s.h) || 150

  // 1. touch point along shoulder → hip line
  const touch: number[] = []
  for (const r of reps) {
    const S = pt(c, r.bottom, s.s)
    const Hp = pt(c, r.bottom, s.h)
    if (!S || !Hp) continue
    const vx = Hp.x - S.x
    const vy = Hp.y - S.y
    const t = ((xs[r.bottom] - S.x) * vx + (ys[r.bottom] - S.y) * vy) / (vx * vx + vy * vy || 1)
    touch.push(t)
  }
  if (touch.length) {
    const m = median(touch)
    const high = reps.filter((_, i) => touch[i] < 0.15).map((r) => r.index)
    out.push({
      id: 'bench.touch_point',
      title: '触胸位置',
      detail:
        m < 0.08
          ? '杠铃几乎落在锁骨/颈部正上方，肩前侧负荷很大。史密斯机请把凳子往头的方向挪 5–10cm，让杠铃落在乳头线附近。'
          : m < 0.2
            ? '杠铃落点偏高（上胸靠近锁骨），肩关节外展更多。建议让落点下移到乳头线附近（凳子往头方向挪一点）。'
            : m > 0.55
              ? '杠铃落点偏低（靠近腹部），注意不要让手腕后折、杠铃前滚。'
              : '落点在胸骨中下段 / 乳头线附近，合理。',
      severity: m < 0.08 ? 'bad' : m < 0.2 || m > 0.55 ? 'warn' : 'good',
      value: r2(m),
      target: '0.20 – 0.50（0=肩关节，1=髋关节）',
      sourceIds: ['nsca-technique-4e', 'fees-1998', 'noteboom-2024'],
      confidence: r2(visibilityOf(c, [s.s, s.h], reps.map((r) => r.bottom))),
      reps: high,
    })
  }

  // 2. IPF depth: elbow at/below shoulder at the bottom
  const elbowDepth: { idx: number; d: number; v: number }[] = []
  for (const r of reps) {
    const S = pt(c, r.bottom, s.s)
    const E = pt(c, r.bottom, s.e)
    if (S && E) elbowDepth.push({ idx: r.index, d: (E.y - S.y) / forearm, v: Math.min(S.v, E.v) })
  }
  if (elbowDepth.length) {
    const shallow = elbowDepth.filter((e) => e.d < -0.05).map((e) => e.idx)
    out.push({
      id: 'bench.depth_ipf',
      title: '下放深度（肘是否低于肩）',
      detail: shallow.length
        ? `第 ${shallow.join('、')} 次到底时肘关节仍高于肩关节，按 IPF 2026 规则属于深度不足。`
        : '每一次到底时肘关节都与肩齐平或更低，深度达标。',
      severity: shallow.length === 0 ? 'good' : shallow.length > reps.length / 2 ? 'bad' : 'warn',
      value: r2(median(elbowDepth.map((e) => e.d))),
      target: '≥ 0（肘 y ≥ 肩 y）',
      sourceIds: ['ipf-2026-bench', 'cs231n-2024'],
      confidence: r2(mean(elbowDepth.map((e) => e.v))),
      reps: shallow,
    })
  }

  // 3. partial reps relative to the deepest rep of the set
  if (reps.length >= 2) {
    // reference = typical depth of this set (robust to one extra-deep rep)
    const ref = pct(reps.map((r) => ys[r.bottom]), 0.75)
    const rom = romOf(reps, ys)
    const shortBy = (r: Rep) => (ref - ys[r.bottom]) / rom
    const partial = reps.filter((r) => shortBy(r) > 0.15).map((r) => r.index)
    out.push({
      id: 'bench.partial_reps',
      title: '半程次数',
      detail: partial.length
        ? `第 ${partial.join('、')} 次比本组常规深度少下放了最多 ${r0(Math.max(...reps.filter((r) => partial.includes(r.index)).map(shortBy)) * 100)}% 的行程，没有下放到位。`
        : '每一次都下放到了相近的深度。',
      severity: partial.length ? (partial.length > reps.length / 3 ? 'bad' : 'warn') : 'good',
      value: partial.length,
      unit: '次',
      target: '0',
      sourceIds: ['ipf-2026-bench'],
      confidence: 0.85,
      reps: partial,
    })
  }

  // 4. hip lift (glutes off the bench)
  const rawHip = c.frames.map((_, i) => pt(c, i, s.h)?.y ?? null)
  const hipY = rawHip.map((_, i) => {
    const win = rawHip.slice(Math.max(0, i - 3), i + 4).filter((v): v is number => v != null)
    return win.length >= 3 ? median(win) : null
  })
  const lifted: number[] = []
  for (const r of reps) {
    // baseline = hip height while lowering this rep; lift must persist ≥ 3 frames
    const base = median(hipY.slice(r.start, r.bottom + 1).filter((v): v is number => v != null))
    let run = 0
    let maxRun = 0
    for (let i = r.bottom; i <= r.end; i++) {
      const v = hipY[i]
      run = v != null && (base - v) / torso > 0.1 ? run + 1 : 0
      maxRun = Math.max(maxRun, run)
    }
    if (maxRun >= 3) lifted.push(r.index)
  }
  out.push({
    id: 'bench.hip_lift',
    title: '臀部是否离凳',
    detail: lifted.length
      ? `第 ${lifted.join('、')} 次推起时臀部明显抬高，IPF 判犯规，也会让腰椎承受额外压力。`
      : '推起过程中臀部稳定贴凳。',
    severity: lifted.length ? 'bad' : 'good',
    sourceIds: ['ipf-2026-bench', 'nsca-technique-4e'],
    confidence: r2(visibilityOf(c, [s.h])),
    reps: lifted,
  })

  // 5. foot placement via knee angle
  const knees: number[] = []
  for (let i = 0; i < c.frames.length; i += 3) {
    const Hp = pt(c, i, s.h)
    const K = pt(c, i, s.k)
    const A = pt(c, i, s.a)
    if (Hp && K && A && K.v > 0.5 && A.v > 0.5) knees.push(angle(Hp, K, A))
  }
  if (knees.length) {
    const k = median(knees)
    out.push({
      id: 'bench.knee_angle',
      title: '脚的位置',
      detail:
        k > 125
          ? `膝角约 ${r0(k)}°，脚放得太靠前、腿接近伸直，腿驱动和身体稳定性都会变差。把脚往回收到膝盖正下方或稍后。`
          : `膝角约 ${r0(k)}°，脚收在膝盖附近，能提供稳定的腿驱动。`,
      severity: k > 135 ? 'warn' : k > 125 ? 'warn' : 'good',
      value: r0(k),
      unit: '°',
      target: '70° – 125°',
      sourceIds: ['nsca-technique-4e'],
      confidence: r2(visibilityOf(c, [s.h, s.k, s.a])),
    })
  }

  // 6. lockout
  const lockAngles: number[] = []
  for (const r of reps) {
    const S = pt(c, r.end, s.s)
    const E = pt(c, r.end, s.e)
    const Wr = pt(c, r.end, s.w)
    if (S && E && Wr) lockAngles.push(angle(S, E, Wr))
  }
  if (lockAngles.length) {
    const m = median(lockAngles)
    out.push({
      id: 'bench.lockout',
      title: '推起锁定',
      detail: m >= 155 ? '每次都把手臂推直锁定。' : `顶端肘角约 ${r0(m)}°，没有完全推直。`,
      severity: m >= 155 ? 'good' : 'warn',
      value: r0(m),
      unit: '°',
      target: '≥ 155°',
      sourceIds: ['ipf-2026-bench'],
      confidence: r2(visibilityOf(c, [s.s, s.e, s.w], reps.map((r) => r.end))),
    })
  }

  out.push({
    id: 'bench.elbow_flare_note',
    title: '肘部外展（需斜前方机位）',
    detail: '侧面无法测量肘部外展角度；目前文献也没有可靠的量化阈值，教学上常用"上臂与躯干约 45–75°"。如需评估请补拍 45° 斜前方。',
    severity: 'info',
    sourceIds: ['nsca-technique-4e'],
    confidence: 1,
  })

  return [...out, ...commonRules(reps, ys, 'bench')]
}

// ---------------------------------------------------------------- squat (side)

function squatSide(c: Ctx, reps: Rep[], xs: number[], ys: number[]): Finding[] {
  const s = SIDE[c.side]
  const out: Finding[] = []
  const thigh = segLen(c, s.h, s.k) || 120
  const shin = segLen(c, s.k, s.a) || 110

  // facing direction: toes point forward
  const facing = facingOf(c, s)

  // depth: hip below knee
  const depth: { idx: number; d: number; v: number }[] = []
  const trunk: number[] = []
  const knee: number[] = []
  for (const r of reps) {
    const Hp = pt(c, r.bottom, s.h)
    const K = pt(c, r.bottom, s.k)
    const S = pt(c, r.bottom, s.s)
    const T = pt(c, r.bottom, s.toe)
    if (Hp && K) depth.push({ idx: r.index, d: (Hp.y - K.y) / thigh, v: Math.min(Hp.v, K.v) })
    if (Hp && S) trunk.push((Math.atan2(Math.abs(S.x - Hp.x), Hp.y - S.y) * 180) / Math.PI)
    if (K && T) knee.push(((K.x - T.x) * facing) / shin)
  }
  if (depth.length) {
    const shallow = depth.filter((d) => d.d < -0.02).map((d) => d.idx)
    out.push({
      id: 'squat.depth_ipf',
      title: '深度（髋是否低于膝）',
      detail: shallow.length
        ? `第 ${shallow.join('、')} 次髋没有低于膝，按 IPF 标准深度不足。非比赛训练中这不一定是错误，但要清楚自己练的是哪个幅度。`
        : '每一次髋都低于膝，达到比赛深度。',
      severity: shallow.length === 0 ? 'good' : 'warn',
      value: r2(median(depth.map((d) => d.d))),
      target: '≥ 0（髋 y ≥ 膝 y）',
      sourceIds: ['ipf-2026-squat', 'schoenfeld-2010', 'cs231n-2024'],
      confidence: r2(mean(depth.map((d) => d.v))),
      reps: shallow,
    })
  }
  if (trunk.length) {
    const t = median(trunk)
    out.push({
      id: 'squat.trunk_angle',
      title: '到底时躯干前倾',
      detail:
        t > 55
          ? `躯干前倾约 ${r0(t)}°，偏向"早安式"，下背负荷大。可尝试加宽站距、加强股四头肌或改用更直立的高杠位置。`
          : `躯干前倾约 ${r0(t)}°，在常见范围内（低杠会比高杠更前倾）。`,
      severity: t > 55 ? 'warn' : 'good',
      value: r0(t),
      unit: '°',
      target: '高杠 ~30–45°，低杠 ~40–55°',
      sourceIds: ['schoenfeld-2010'],
      confidence: 0.8,
    })
  }
  if (knee.length)
    out.push({
      id: 'squat.knee_travel',
      title: '膝前移（仅提示）',
      detail: `到底时膝盖超出脚尖约 ${r0(Math.max(0, median(knee)) * 100)}% 小腿长。这是正常现象，限制它反而会把负荷转移到髋和下背；只有伴随脚跟抬起或膝痛时才需要调整。`,
      severity: 'info',
      value: r2(median(knee)),
      sourceIds: ['fry-2003'],
      confidence: 0.75,
    })

  // heel lift
  const heelY = c.frames.map((_, i) => pt(c, i, s.heel)?.y ?? null).filter((v): v is number => v != null)
  if (heelY.length) {
    const base = pct(heelY, 0.8)
    const lift = (base - pct(heelY, 0.05)) / shin
    out.push({
      id: 'squat.heel_lift',
      title: '脚跟是否抬起',
      detail: lift > 0.08 ? '下蹲过程中脚跟有抬起，重心前移。可以尝试举重鞋或加强踝关节灵活性。' : '脚跟全程踩实。',
      severity: lift > 0.08 ? 'warn' : 'good',
      value: r2(lift),
      sourceIds: ['ipf-2026-squat', 'nsca-technique-4e'],
      confidence: r2(visibilityOf(c, [s.heel])),
    })
  }

  // bar path drift during concentric
  if (reps.length) {
    const drift = reps.map((r) => {
      const seg = xs.slice(r.bottom, r.end + 1)
      return (Math.max(...seg) - Math.min(...seg)) / thigh
    })
    const m = median(drift)
    out.push({
      id: 'squat.bar_path',
      title: '杠铃轨迹（水平漂移）',
      detail: m > 0.25 ? '起身时杠铃前后漂移较大，重心离开了脚中线。' : '杠铃基本沿脚中线上下。',
      severity: m > 0.25 ? 'warn' : 'good',
      value: r2(m),
      target: '< 0.25 股骨长',
      sourceIds: ['nsca-technique-4e'],
      confidence: 0.7,
    })
  }
  return [...out, ...commonRules(reps, ys, 'squat')]
}

// ---------------------------------------------------------------- deadlift (side)

function deadliftSide(c: Ctx, reps: Rep[], xs: number[], ys: number[]): Finding[] {
  const s = SIDE[c.side]
  const out: Finding[] = []
  const shin = segLen(c, s.k, s.a) || 110
  const facing = facingOf(c, s)

  // hips shoot up: hip rise vs shoulder rise in first 35% of the pull
  const ratios: { idx: number; r: number }[] = []
  for (const r of reps) {
    const mid = r.bottom + Math.max(1, Math.round((r.end - r.bottom) * 0.35))
    const H0 = pt(c, r.bottom, s.h)
    const H1 = pt(c, mid, s.h)
    const S0 = pt(c, r.bottom, s.s)
    const S1 = pt(c, mid, s.s)
    if (H0 && H1 && S0 && S1) {
      const dh = H0.y - H1.y
      const ds = Math.max(1, S0.y - S1.y)
      ratios.push({ idx: r.index, r: dh / ds })
    }
  }
  if (ratios.length) {
    const bad = ratios.filter((x) => x.r > 1.6).map((x) => x.idx)
    out.push({
      id: 'deadlift.hips_first',
      title: '起杠顺序（臀是否先起）',
      detail: bad.length
        ? `第 ${bad.join('、')} 次离地时臀部上升速度是肩的 ${r2(median(ratios.map((x) => x.r)))} 倍，变成了"早安式"拉起，下背力臂变长。口令：胸先起来，腿推地。`
        : '离地时髋和肩基本同速上升。',
      severity: bad.length ? (bad.length > reps.length / 2 ? 'bad' : 'warn') : 'good',
      value: r2(median(ratios.map((x) => x.r))),
      target: '≤ 1.6',
      sourceIds: ['nsca-technique-4e', 'zatsiorsky-2021'],
      confidence: r2(visibilityOf(c, [s.h, s.s])),
      reps: bad,
    })
  }

  // lockout
  const lock: { idx: number; hip: number; knee: number; back: number; behind: boolean }[] = []
  for (const r of reps) {
    const S = pt(c, r.end, s.s)
    const Hp = pt(c, r.end, s.h)
    const K = pt(c, r.end, s.k)
    const A = pt(c, r.end, s.a)
    if (!S || !Hp || !K || !A) continue
    const back = ((Math.atan2((Hp.x - S.x) * facing, Hp.y - S.y) * 180) / Math.PI) // >0 = leaning back
    lock.push({ idx: r.index, hip: angle(S, Hp, K), knee: angle(Hp, K, A), back, behind: (xs[r.end] - S.x) * facing >= -0.1 * shin })
  }
  if (lock.length) {
    const soft = lock.filter((l) => l.hip < 165 || l.knee < 165).map((l) => l.idx)
    out.push({
      id: 'deadlift.lockout',
      title: '锁定',
      detail: soft.length ? `第 ${soft.join('、')} 次顶端髋或膝没有完全伸直。` : '每次都完全锁定（髋、膝伸直，肩在杠后）。',
      severity: soft.length ? 'warn' : 'good',
      value: r0(median(lock.map((l) => Math.min(l.hip, l.knee)))),
      unit: '°',
      target: '≥ 165°',
      sourceIds: ['ipf-2026-deadlift'],
      confidence: 0.8,
      reps: soft,
    })
    const hyper = lock.filter((l) => l.back > 15).map((l) => l.idx)
    if (hyper.length)
      out.push({
        id: 'deadlift.hyperextension',
        title: '锁定时过度后仰',
        detail: `第 ${hyper.join('、')} 次锁定时上身后仰超过 15°，腰椎被挤压。站直即可，不需要后仰。`,
        severity: 'warn',
        sourceIds: ['nsca-technique-4e'],
        confidence: 0.7,
        reps: hyper,
      })
  }

  // bar drift from midfoot
  const drift: number[] = []
  for (const r of reps) {
    for (let i = r.bottom; i <= r.end; i += 2) {
      const A = pt(c, i, s.a)
      const T = pt(c, i, s.toe)
      // midfoot ≈ between ankle and toes; without toe landmarks, ~0.25 shin in front of the ankle
      if (A) drift.push(Math.abs(xs[i] - (T ? (A.x + T.x) / 2 : A.x + facing * 0.25 * shin)) / shin)
    }
  }
  if (drift.length) {
    const m = pct(drift, 0.9)
    out.push({
      id: 'deadlift.bar_drift',
      title: '杠铃是否贴身',
      detail: m > 0.35 ? '拉起过程中杠铃明显离开脚中线（离身体太远），下背力臂变长。口令：杠铃贴着腿走。' : '杠铃基本贴着脚中线上下。',
      severity: m > 0.35 ? 'warn' : 'good',
      value: r2(m),
      target: '< 0.35 小腿长',
      sourceIds: ['nsca-technique-4e', 'escamilla-2000'],
      confidence: 0.7,
    })
  }
  out.push({
    id: 'deadlift.back_note',
    title: '下背弧度（交给教练看关键帧）',
    detail: '单目 2D 骨架无法可靠测量脊柱弯曲。起始时腰椎前凸轻微减少是正常的（约 20° 内），需要关注的是拉起过程中继续弯曲。',
    severity: 'info',
    sourceIds: ['bengtsson-2022'],
    confidence: 1,
  })
  return [...out, ...commonRules(reps, ys, 'deadlift')]
}

// ---------------------------------------------------------------- front views

function frontRules(c: Ctx, lift: LiftId, reps: Rep[]): Finding[] {
  const out: Finding[] = []
  const shoulderW = segLen(c, LM.lShoulder, LM.rShoulder)
  if (!shoulderW) return out
  const tops = reps.length ? reps.map((r) => r.end) : [Math.floor(c.frames.length / 2)]

  if (lift === 'bench' || lift === 'deadlift') {
    const ratios: number[] = []
    const tilts: number[] = []
    for (const i of tops) {
      const L = pt(c, i, LM.lWrist)
      const R = pt(c, i, LM.rWrist)
      const LS = pt(c, i, LM.lShoulder)
      const RS = pt(c, i, LM.rShoulder)
      if (L && R && LS && RS) {
        ratios.push(Math.abs(L.x - R.x) / Math.abs(LS.x - RS.x || 1))
        tilts.push(Math.abs(L.y - R.y) / shoulderW)
      }
    }
    if (ratios.length && lift === 'bench') {
      const g = median(ratios)
      out.push({
        id: 'bench.grip_ratio',
        title: '握距 / 肩宽',
        detail:
          g > 1.5
            ? `握距约为肩宽的 ${r2(g)} 倍，超过 1.5 倍时肩部损伤风险上升。肩不舒服时优先收窄握距。`
            : g < 1.0
              ? `握距约为肩宽的 ${r2(g)} 倍（窄握），三头肌参与更多、胸部行程更长。`
              : `握距约为肩宽的 ${r2(g)} 倍，在推荐范围内。`,
        severity: g > 1.7 ? 'bad' : g > 1.5 ? 'warn' : 'good',
        value: r2(g),
        unit: '×',
        target: '1.0 – 1.5 ×（肩关节间距）',
        sourceIds: ['green-comfort-2007', 'noteboom-2024', 'larsen-2021', 'lehman-2005'],
        confidence: r2(visibilityOf(c, [LM.lWrist, LM.rWrist, LM.lShoulder, LM.rShoulder], tops)),
      })
    }
    if (tilts.length) {
      const t = median(tilts)
      out.push({
        id: `${lift}.bar_tilt`,
        title: '杠铃左右倾斜',
        detail: t > 0.08 ? '杠铃一高一低，左右侧发力不均衡。' : '杠铃左右基本水平。',
        severity: t > 0.08 ? 'warn' : 'good',
        value: r2(t),
        sourceIds: ['nsca-technique-4e'],
        confidence: 0.75,
      })
    }
  }

  if (lift === 'squat') {
    const ratios: number[] = []
    for (const r of reps) {
      const LK = pt(c, r.bottom, LM.lKnee)
      const RK = pt(c, r.bottom, LM.rKnee)
      const LA = pt(c, r.bottom, LM.lAnkle)
      const RA = pt(c, r.bottom, LM.rAnkle)
      if (LK && RK && LA && RA) ratios.push(Math.abs(LK.x - RK.x) / Math.abs(LA.x - RA.x || 1))
    }
    if (ratios.length) {
      const v = median(ratios)
      out.push({
        id: 'squat.valgus',
        title: '膝内扣',
        detail: v < 0.9 ? `到底时两膝间距只有两踝间距的 ${r0(v * 100)}%，存在膝内扣。口令：膝盖对准脚尖、把地板向两侧撑开。` : '膝盖与脚尖方向一致，没有明显内扣。',
        severity: v < 0.8 ? 'bad' : v < 0.9 ? 'warn' : 'good',
        value: r2(v),
        target: '≥ 0.9',
        sourceIds: ['escamilla-2001', 'schoenfeld-2010'],
        confidence: r2(visibilityOf(c, [LM.lKnee, LM.rKnee, LM.lAnkle, LM.rAnkle])),
      })
    }
  }
  return out
}

// ---------------------------------------------------------------- entry

export function analyzeClip(
  lift: LiftId,
  angleId: AngleId,
  data: { frames: PoseFrame[]; fps: number; width: number; height: number },
): ClipAnalysis {
  const { frames, fps, width: W, height: H } = data
  const visSide = (ks: number[]) => {
    const v: number[] = []
    for (const f of frames) if (f.lm) for (const k of ks) v.push(f.lm[k * 3 + 2])
    return mean(v)
  }
  const left = visSide([11, 13, 15, 23, 25, 27])
  const right = visSide([12, 14, 16, 24, 26, 28])
  const side: 'left' | 'right' = left >= right ? 'left' : 'right'
  const c: Ctx = { frames, fps, W, H, side }
  const { xs, ys, kind, barCov } = buildSignal(c)
  // keep only reps performed by the lifter in position (drops unracking, sitting up,
  // stripping plates…): pose present, full-ish amplitude, and part of the main set
  const raw = segmentReps(ys, fps)
  const amp = (r: Rep) => ys[r.bottom] - Math.min(ys[r.start], ys[r.end])
  const medAmp = median(raw.map(amp))
  const inPosition = raw.filter((r) => {
    const n = r.end - r.start + 1
    const withPose = frames.slice(r.start, r.end + 1).filter((f) => f.lm).length
    const dur = n / fps
    return withPose / n >= 0.3 && dur >= 0.5 && dur <= 10 && amp(r) >= 0.5 * medAmp
  })
  // second pass: drop reps isolated from the main set (e.g. one bump while stripping plates)
  const gaps = inPosition.slice(1).map((r, i) => r.bottom - inPosition[i].bottom)
  const maxGap = Math.max(6 * fps, 4 * (median(gaps) || fps * 2))
  const reps = inPosition
    .filter((r, i, arr) => {
      const prevGap = i ? r.bottom - arr[i - 1].bottom : Infinity
      const nextGap = i < arr.length - 1 ? arr[i + 1].bottom - r.bottom : Infinity
      return arr.length <= 2 || prevGap <= maxGap || nextGap <= maxGap
    })
    .map((r, i) => ({ ...r, index: i + 1 }))
  const poseCoverage = frames.filter((f) => f.lm).length / Math.max(1, frames.length)

  let findings: Finding[] = []
  if (angleId === 'side') {
    findings = lift === 'bench' ? benchSide(c, reps, xs, ys) : lift === 'squat' ? squatSide(c, reps, xs, ys) : deadliftSide(c, reps, xs, ys)
  } else if (angleId === 'front') {
    findings = frontRules(c, lift, reps)
  } else {
    findings = [
      {
        id: `${lift}.oblique_note`,
        title: '斜向机位：交给教练看关键帧',
        detail: '斜向机位的 2D 角度会被透视扭曲，程序只做次数和节奏统计；肘外展、背部弧度等由 agent 教练结合关键帧判断。',
        severity: 'info',
        sourceIds: ['nsca-technique-4e'],
        confidence: 1,
      },
      ...commonRules(reps, ys, lift),
    ]
  }
  if (!reps.length)
    findings.unshift({
      id: 'clip.no_reps',
      title: '没有识别到完整的次数',
      detail: '杠铃/手腕的上下运动幅度太小或识别失败。请确认全身入画、机位固定，或在上一步点选杠铃片上的彩色标记。',
      severity: 'warn',
      sourceIds: [],
      confidence: 1,
    })

  const trace = ys.map((y, i) => ({ t: r2(frames[i].t), y: r2(y / H), x: r2(xs[i] / W) }))
  return {
    angle: angleId,
    fps,
    width: W,
    height: H,
    side: angleId === 'front' ? 'both' : side,
    signal: kind,
    barCoverage: r2(barCov),
    poseCoverage: r2(poseCoverage),
    reps,
    findings,
    trace,
  }
}

const PENALTY = { bad: 16, warn: 7, good: 0, info: 0 }
export function scoreFindings(findings: Finding[]) {
  let s = 100
  for (const f of findings) s -= PENALTY[f.severity] * Math.max(0.4, f.confidence)
  return Math.max(0, Math.min(100, Math.round(s)))
}
