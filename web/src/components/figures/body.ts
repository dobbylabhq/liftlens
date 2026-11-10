import type { LiftId } from '../../lib/types'
import { add, dot, lerp, mul, norm, perp, sub, type J, type Rig, type Sides } from './poses'
import { capsule, circle, chinDir, footPoints, shift, smoothClosed, torsoAt, torsoPoints } from './geom'

/** top-right key light used by every shaded style */
export const LIGHT: J = norm([0.55, -0.83])

export interface LimbSpec {
  ra: number
  rb: number
  /** bulge on the anatomical back / front side */
  back?: number
  front?: number
  at?: number
}

/** Volumetric proportions (px in the 200×140 viewBox). */
export const SPEC = {
  upper: { ra: 4.2, rb: 3.1, back: 0.9, front: 0.7, at: 0.45 },
  fore: { ra: 3.3, rb: 2.2, back: 0.3, front: 0.6, at: 0.28 },
  thigh: { ra: 6.4, rb: 4.0, back: 0.8, front: 1.0, at: 0.4 },
  shin: { ra: 4.0, rb: 2.5, back: 1.6, front: 0.2, at: 0.3 },
} satisfies Record<string, LimbSpec>

/** side = +1 if the anatomical *back* of the bone is +perp */
export function limb(a: J, b: J, s: LimbSpec, side: number) {
  const bp = side > 0 ? (s.back ?? 0) : (s.front ?? 0)
  const bn = side > 0 ? (s.front ?? 0) : (s.back ?? 0)
  return capsule(a, b, s.ra, s.rb, bp, bn, s.at)
}

export interface BodyPaths {
  torso: string
  neck: string
  head: string
  thigh: string
  shin: string
  foot: string
  upper: string
  fore: string
  hand: string
  farThigh: string
  farShin: string
  farFoot: string
  farUpper: string
  farFore: string
  farHand: string
}

export function bodyPaths(r: Rig, sd: Sides): BodyPaths {
  const f = r.far
  const legs = (o: J) => {
    const hip = shift(r.hip, o)
    const knee = shift(r.knee, o)
    const ankle = shift(r.ankle, o)
    return {
      thigh: limb(hip, knee, SPEC.thigh, sd.thighBack),
      shin: limb(knee, ankle, SPEC.shin, sd.shinBack),
      foot: smoothClosed(footPoints(ankle, r.ground + (o[1] < 0 ? o[1] * 0.5 : 0), r.toe), 0.9),
    }
  }
  const arms = (o: J) => {
    const sh = shift(r.shoulder, o)
    const el = shift(r.elbow, o)
    const wr = shift(r.wrist, o)
    return {
      upper: limb(sh, el, SPEC.upper, -sd.upperFront),
      fore: capsule(el, wr, SPEC.fore.ra, SPEC.fore.rb),
      hand: circle(add(wr, mul(norm(sub(wr, el)), 1.2)), 2.7),
    }
  }
  const near = { ...legs([0, 0]), ...arms([0, 0]) }
  const far = { ...legs(f), ...arms(f) }
  const neckA = torsoAt(r, 0.98, 0.6)
  const chin = chinDir(r)
  const headC = r.head
  return {
    torso: smoothClosed(torsoPoints(r)),
    neck: capsule(neckA, headC, 3.6, 3.0),
    head: circle(headC, 6.4) + capsule(add(headC, mul(chin, 1)), add(headC, mul(chin, 4.4)), 5, 3.1),
    ...near,
    farThigh: far.thigh,
    farShin: far.shin,
    farFoot: far.foot,
    farUpper: far.upper,
    farFore: far.fore,
    farHand: far.hand,
  }
}

/** thin specular strip along the lit side of a limb */
export function highlight(a: J, b: J, ra: number, rb: number) {
  const n = perp(norm(sub(b, a)))
  const s = dot(n, LIGHT) >= 0 ? 1 : -1
  const p = lerp(a, b, 0.14)
  const q = lerp(a, b, 0.78)
  return capsule(add(p, mul(n, s * ra * 0.52)), add(q, mul(n, s * rb * 0.52)), 0.9, 0.55)
}

// ---------------------------------------------------------------------------
// Prime movers per lift

export const MUSCLES: Record<LiftId, string[]> = {
  bench: ['胸大肌', '前三角', '肱三头肌'],
  squat: ['股四头肌', '臀大肌'],
  deadlift: ['臀大肌', '腘绳肌', '竖脊肌'],
}

const onBone = (a: J, b: J, side: number, from: number, to: number, off: number, r1: number, r2: number) => {
  const n = mul(perp(norm(sub(b, a))), side * off)
  return capsule(add(lerp(a, b, from), n), add(lerp(a, b, to), n), r1, r2)
}

export function musclePaths(lift: LiftId, r: Rig, sd: Sides): string[] {
  const glute = () => capsule(torsoAt(r, 0.06, -4.2), add(lerp(r.hip, r.knee, 0.18), mul(perp(norm(sub(r.knee, r.hip))), sd.thighBack * 2.8)), 5.4, 4.0)
  switch (lift) {
    case 'bench':
      return [
        capsule(torsoAt(r, 0.94, 4.6), torsoAt(r, 0.68, 6.0), 3.8, 3.2),
        onBone(r.shoulder, r.elbow, sd.upperFront, 0.0, 0.3, 1.3, 3.0, 2.4),
        onBone(r.shoulder, r.elbow, -sd.upperFront, 0.25, 0.86, 1.4, 2.4, 1.7),
      ]
    case 'squat':
      return [onBone(r.hip, r.knee, -sd.thighBack, 0.12, 0.84, 2.0, 4.1, 2.7), glute()]
    case 'deadlift':
      return [
        glute(),
        onBone(r.hip, r.knee, sd.thighBack, 0.22, 0.86, 2.3, 3.1, 2.3),
        capsule(torsoAt(r, 0.14, -4.6), torsoAt(r, 0.8, -5.6), 2.2, 1.6),
      ]
  }
}
