import type { LiftId } from '../../lib/types'

export type J = [number, number]
export interface Pose {
  head: J
  shoulder: J
  elbow: J
  wrist: J
  hip: J
  knee: J
  ankle: J
  bar: J
}
export type JointId = keyof Pose

/** floor line (svg px) per lift; the figure faces +x except bench, which lies supine with the head at +x */
const GROUND: Record<LiftId, number> = { bench: 112, squat: 130, deadlift: 130 }
export const JOINTS: JointId[] = ['head', 'shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'bar']

export const lerp = (p: J, q: J, t: number): J => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]

/** Linear joint interpolation — what the stick figure uses. */
export function rawPose(lift: LiftId, t: number): Pose {
  const { a, b } = POSES[lift]
  const P = {} as Pose
  for (const k of JOINTS) P[k] = lerp(a[k], b[k], t)
  return P
}

/** Is the rep moving in its concentric (lifting) direction when t changes by dt? */
export const isConcentric = (lift: LiftId, dt: number) => (lift === 'deadlift' ? dt > 1e-5 : dt < -1e-5)

// ---------------------------------------------------------------------------
// Vector helpers
export const add = (a: J, b: J): J => [a[0] + b[0], a[1] + b[1]]
export const sub = (a: J, b: J): J => [a[0] - b[0], a[1] - b[1]]
export const mul = (a: J, k: number): J => [a[0] * k, a[1] * k]
export const len = (a: J) => Math.hypot(a[0], a[1])
export const norm = (a: J): J => {
  const l = len(a) || 1
  return [a[0] / l, a[1] / l]
}
/** +90° in screen space (y down) */
export const perp = (a: J): J => [-a[1], a[0]]
export const dot = (a: J, b: J) => a[0] * b[0] + a[1] * b[1]
export const cross = (a: J, b: J) => a[0] * b[1] - a[1] * b[0]

/** Two-bone IK. Returns [middle joint, end]. `bend` = +1/-1 picks the side of the a→target line. */
function ik(a: J, target: J, l1: number, l2: number, bend: number): [J, J] {
  const v = sub(target, a)
  const d = Math.min(Math.max(len(v), Math.abs(l1 - l2) + 0.01), l1 + l2 - 0.01)
  const u = norm(v)
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x))
  const mid = add(add(a, mul(u, x)), mul(perp(u), h * bend))
  return [mid, add(a, mul(u, d))]
}

// ---------------------------------------------------------------------------
// Rig: constant bone lengths (same proportions as the 3D model), and every frame is *solved* from
// the coaching constraints of the lift instead of interpolated between two drawings:
//   squat    — bar stays over mid-foot; bottom = hip joint below the knee (IPF depth)
//   deadlift — bar path vertical over mid-foot, shins / thighs never cross it, arms straight
//   bench    — bar from over the shoulders to the lower sternum, forearms ~vertical at the bottom
// Arms are solved in 3D (grip width + 2-bone IK) and projected, so the side view shows the upper
// arm foreshortened instead of forcing the elbow toward the hips.

export interface Rig extends Pose {
  /** unit vector pointing out of the chest */
  front: J
  /** toe direction along x */
  toe: 1 | -1
  /** screen offset applied to the far-side arm/leg */
  far: J
  ground: number
  plate: number
  /** lateral distance (svg px) of elbow / wrist from the midline — for the 3D model */
  elbowZ: number
  wristZ: number
  /** far-side limbs in their own position (lunge stance, one-arm work); default = near limbs shifted by `far` */
  farLeg?: { knee: J; ankle: J }
  farArm?: { elbow: J; wrist: J }
}

/**
 * Body proportions in svg px (1px = 1/60 m), measured from the 3D model (Mixamo X Bot scaled so
 * thigh + shin = 0.967 m). 2D figures and the 3D model share them, so a pose that is right in one
 * is right in the other.
 */
export const BODY = {
  shin: 29,
  thigh: 28.9,
  torso: 30.4, // hip joint → shoulder joint
  neck: 13,
  upper: 18.2, // shoulder → elbow
  fore: 18.5, // elbow → wrist
  hand: 6, // wrist → bar (centre of the closed hand)
  ankleH: 5.7, // ankle joint above the floor
  shoulderZ: 9.9, // half shoulder width (joint centres)
}
/** mid-foot is ~6 cm in front of the ankle joint: the balance point the bar has to stay over */
const MIDFOOT = 3.6
/** half grip width (svg px): bench ≈ 80 cm between hands, squat ≈ 84 cm, deadlift just outside the legs */
const GRIP: Record<LiftId, number> = { bench: 24, squat: 25, deadlift: 14.4 }
/** bar radius + clothing, and how far the front of the shin / thigh sits in front of the bone line */
const BAR_R = 0.8
const SHIN_FRONT = 1.6
const THIGH_FRONT = 4.8

/**
 * Plate radius for the realistic figures. A 20 kg plate is ⌀45 cm = 13.5px; the deadlift must use
 * the real size because the bar starts exactly one plate radius above the floor (same as the 3D plates).
 */
export const PLATE_R: Record<LiftId, number> = { bench: 13.5, squat: 14.5, deadlift: 13.5 }
const FAR: Record<LiftId, J> = { bench: [2.5, -3], squat: [2.5, -2.5], deadlift: [2.5, -2.5] }

const rad = (d: number) => (d * Math.PI) / 180
const mix = (a: number, b: number, t: number) => a + (b - a) * t
/** unit vector at angle `a` from straight up, leaning toward +x */
const upDir = (a: number): J => [Math.sin(a), -Math.cos(a)]

/** Both solutions of a planar 2-bone chain a→mid→target. */
function ik2(a: J, target: J, l1: number, l2: number): [J, J] {
  return [ik(a, target, l1, l2, 1)[0], ik(a, target, l1, l2, -1)[0]]
}

type V3 = [number, number, number]
/**
 * Arm in 3D: shoulder (x, y, z) → hand on the bar at (x, y, grip). The elbow lies on the IK circle,
 * on the side `pole` points to. Returns the projected joints plus their lateral offsets.
 */
function arm3(sh: J, bar: J, grip: number, pole: V3) {
  const l1 = BODY.upper
  const l2 = BODY.fore + BODY.hand
  const a: V3 = [sh[0], sh[1], BODY.shoulderZ]
  const v: V3 = [bar[0] - a[0], bar[1] - a[1], grip - a[2]]
  const dist = Math.hypot(...v)
  const d = Math.min(Math.max(dist, Math.abs(l1 - l2) + 0.01), l1 + l2 - 0.01)
  const u = v.map((c) => c / (dist || 1)) as V3
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x))
  const pd = pole[0] * u[0] + pole[1] * u[1] + pole[2] * u[2]
  let p = pole.map((c, i) => c - pd * u[i]) as V3
  const pl = Math.hypot(...p) || 1
  p = p.map((c) => c / pl) as V3
  const el = a.map((c, i) => c + u[i] * x + p[i] * h) as V3
  const hand = a.map((c, i) => c + u[i] * d) as V3
  const k = BODY.fore / l2
  const wr = el.map((c, i) => c + (hand[i] - c) * k) as V3
  return { elbow: [el[0], el[1]] as J, wrist: [wr[0], wr[1]] as J, bar: [hand[0], hand[1]] as J, elbowZ: el[2], wristZ: wr[2] }
}

/** binary search for the x where f crosses 0 (f increasing) */
function solve(f: (x: number) => number, lo: number, hi: number) {
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2
    if (f(m) > 0) hi = m
    else lo = m
  }
  return (lo + hi) / 2
}

/** x of the line p→q at height y (y between them) */
const xAt = (p: J, q: J, y: number) => (Math.abs(q[1] - p[1]) < 1e-6 ? p[0] : p[0] + ((q[0] - p[0]) * (y - p[1])) / (q[1] - p[1]))

function head(shoulder: J, spine: J, front: J, tilt: number): J {
  return add(shoulder, mul(norm(add(mul(spine, Math.cos(tilt)), mul(front, Math.sin(tilt)))), BODY.neck))
}

/** t: 0 = lockout, 1 = bar on the chest */
function bench(t: number) {
  const g = GROUND.bench
  const shoulder: J = [142, 84]
  const hip: J = [shoulder[0] - BODY.torso, shoulder[1] + 1]
  // feet flat on the floor, knees ~80°, heels a bit behind the knees
  const foot: J = [hip[0] - 28, g - BODY.ankleH]
  const [k1, k2] = ik2(hip, foot, BODY.thigh, BODY.shin)
  const knee = k1[1] < k2[1] ? k1 : k2
  // bar: lockout over the shoulder joint (arms straight, hands wider than shoulders) → lower sternum
  const reach = (BODY.upper + BODY.fore + BODY.hand) * 0.9995
  const planar = Math.sqrt(reach ** 2 - (GRIP.bench - BODY.shoulderZ) ** 2)
  const top: J = [shoulder[0] + 1, shoulder[1] - Math.sqrt(planar ** 2 - 1)]
  const chest: J = [shoulder[0] - 7, shoulder[1] - 7.5]
  const barT = lerp(top, chest, t)
  // elbows down, out, and slightly toward the feet (≈ 60° from the torso at the bottom)
  const a = arm3(shoulder, barT, GRIP.bench, [-0.35, 1, 0.75])
  const spine = norm(sub(shoulder, hip))
  const front = mul(perp(spine), -1)
  return { shoulder, hip, knee, ankle: foot, head: head(shoulder, spine, front, rad(12)), ...a }
}

/** t: 0 = standing, 1 = bottom (hip joint below the knee) */
function squat(t: number) {
  const ankle: J = [100, GROUND.squat - BODY.ankleH]
  const M = ankle[0] + MIDFOOT
  const shin = rad(mix(3, 32, t)) // forward lean of the shin
  const thigh = rad(mix(-3, 97, t)) // from vertical, + = hips back; 90° = parallel; standing: hips over mid-foot
  const knee = add(ankle, mul(upDir(shin), BODY.shin))
  const hip = add(knee, mul(upDir(-thigh), BODY.thigh))
  // high bar on the traps: ~5 cm behind and 2 cm above the shoulder joint, in the torso's frame
  const barOf = (lean: number) => {
    const up = upDir(lean)
    const fwd: J = [Math.cos(lean), Math.sin(lean)]
    const shoulder = add(hip, mul(up, BODY.torso))
    return { shoulder, up, fwd, bar: add(add(shoulder, mul(up, 1.2)), mul(fwd, -3)) }
  }
  // torso lean is whatever keeps the bar over mid-foot
  const lean = solve((l) => barOf(l).bar[0] - M, rad(-20), rad(80))
  const { shoulder, up, fwd, bar } = barOf(lean)
  const a = arm3(shoulder, bar, GRIP.squat, [-0.7, 1, 0.35])
  return { shoulder, hip, knee, ankle, head: head(shoulder, up, fwd, rad(14)), ...a, bar }
}

/** t: 0 = bar on the floor, 1 = lockout */
function deadlift(t: number) {
  const ankle: J = [100, GROUND.deadlift - BODY.ankleH]
  const M = ankle[0] + MIDFOOT
  const reach = (BODY.upper + BODY.fore + BODY.hand) * 0.9995
  const L = Math.sqrt(reach ** 2 - (GRIP.deadlift - BODY.shoulderZ) ** 2) // straight arm, side view
  const floorY = GROUND.deadlift - PLATE_R.deadlift
  const pose = (barY: number, armLean: number) => {
    // off the floor the knees sit over the bar (shins ~18°); as the bar rises toward the knee the
    // shins go back to vertical so the bar can pass
    const kneeY = ankle[1] - BODY.shin
    const shin = rad(18 * Math.min(1, Math.max(0, (barY - kneeY) / (floorY - kneeY))) + 2)
    const knee = add(ankle, mul(upDir(shin), BODY.shin))
    let barX = M
    let hip: J = knee
    let shoulder: J = knee
    for (let i = 0; i < 4; i++) {
      // arms hang straight from the shoulders, a few degrees forward of vertical off the floor
      shoulder = [barX + L * Math.sin(armLean), barY - L * Math.cos(armLean)]
      const [h1, h2] = ik2(knee, shoulder, BODY.thigh, BODY.torso)
      hip = h1[0] < h2[0] ? h1 : h2 // hips behind
      // once the bar is above the knee it rides up the thigh: keep it in front of the thigh
      const legFront = barY < knee[1] ? xAt(knee, hip, barY) + THIGH_FRONT : xAt(ankle, knee, barY) + SHIN_FRONT
      barX = Math.max(M, legFront + BAR_R)
    }
    return { knee, hip, shoulder, bar: [barX, barY] as J }
  }
  // lockout height: the highest bar position where hips and knees are (almost) straight
  const topY = solve((y) => {
    const p = pose(y, rad(-7))
    return 0.996 - dot(norm(sub(p.shoulder, p.hip)), norm(sub(p.hip, p.knee)))
  }, floorY - 60, floorY)
  const barY = mix(floorY, topY, t)
  const p = pose(barY, rad(mix(9, -7, t))) // lockout: shoulders slightly behind the bar, torso upright
  const a = arm3(p.shoulder, p.bar, GRIP.deadlift, [-1, 0, 0])
  const spine = norm(sub(p.shoulder, p.hip))
  return { shoulder: p.shoulder, hip: p.hip, knee: p.knee, ankle, head: head(p.shoulder, spine, perp(spine), rad(10)), ...a, bar: p.bar }
}

export function rigPose(lift: LiftId, t: number): Rig {
  const r = lift === 'bench' ? bench(t) : lift === 'squat' ? squat(t) : deadlift(t)
  const spine = norm(sub(r.shoulder, r.hip))
  const front = mul(perp(spine), lift === 'bench' ? -1 : 1)
  return {
    head: r.head,
    shoulder: r.shoulder,
    elbow: r.elbow,
    wrist: r.wrist,
    hip: r.hip,
    knee: r.knee,
    ankle: r.ankle,
    bar: r.bar,
    front,
    toe: lift === 'bench' ? -1 : 1,
    far: FAR[lift],
    ground: GROUND[lift],
    plate: PLATE_R[lift],
    elbowZ: r.elbowZ,
    wristZ: r.wristZ,
  }
}

/** Key poses (t = 0 and 1) for the stick figure, which interpolates joints linearly. */
const keyPose = (lift: LiftId, t: number): Pose => {
  const r = rigPose(lift, t)
  return Object.fromEntries(JOINTS.map((j) => [j, r[j]])) as unknown as Pose
}
export const POSES: Record<LiftId, { a: Pose; b: Pose; plate: number; ground: number }> = Object.fromEntries(
  (['bench', 'squat', 'deadlift'] as const).map((l) => [l, { a: keyPose(l, 0), b: keyPose(l, 1), plate: { bench: 16, squat: 18, deadlift: 13.5 }[l], ground: GROUND[l] }]),
) as Record<LiftId, { a: Pose; b: Pose; plate: number; ground: number }>

/**
 * Which side of each bone (relative to perp(bone direction)) is posterior/anterior.
 * Taken from the most-flexed key pose so it never flips mid-rep on a straight limb.
 */
export interface Sides {
  /** +1 if the hamstring side of hip→knee is +perp */
  thighBack: number
  /** +1 if the calf side of knee→ankle is +perp */
  shinBack: number
  /** +1 if the biceps side of shoulder→elbow is +perp */
  upperFront: number
}
export function boneSides(lift: LiftId): Sides {
  const rigs = [rigPose(lift, 0), rigPose(lift, 1)]
  const pick = (f: (r: Rig) => number) => {
    const v = rigs.map(f)
    return Math.sign(Math.abs(v[0]) > Math.abs(v[1]) ? v[0] : v[1]) || 1
  }
  return {
    thighBack: pick((r) => dot(perp(sub(r.knee, r.hip)), sub(r.ankle, r.hip))),
    shinBack: pick((r) => dot(perp(sub(r.ankle, r.knee)), sub(r.hip, r.knee))),
    upperFront: pick((r) => dot(perp(sub(r.elbow, r.shoulder)), sub(r.wrist, r.shoulder))),
  }
}
