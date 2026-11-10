import { add, lerp, mul, norm, perp, sub, type J, type Rig } from './poses'

export const n1 = (v: number) => (Math.round(v * 10) / 10).toString()
export const pt = (p: J) => `${n1(p[0])} ${n1(p[1])}`

/**
 * Tapered capsule from a (radius ra) to b (radius rb). `bp`/`bn` bulge the +perp / -perp side
 * (muscle belly) at fraction `at` along the bone.
 */
export function capsule(a: J, b: J, ra: number, rb: number, bp = 0, bn = 0, at = 0.42): string {
  const u = norm(sub(b, a))
  const n = perp(u)
  const a1 = add(a, mul(n, ra))
  const b1 = add(b, mul(n, rb))
  const b2 = add(b, mul(n, -rb))
  const a2 = add(a, mul(n, -ra))
  const m = lerp(a, b, at)
  const rm = ra + (rb - ra) * at
  const c1 = add(m, mul(n, rm + 2 * bp))
  const c2 = add(m, mul(n, -(rm + 2 * bn)))
  return `M${pt(a1)}Q${pt(c1)} ${pt(b1)}A${n1(rb)} ${n1(rb)} 0 0 0 ${pt(b2)}Q${pt(c2)} ${pt(a2)}A${n1(ra)} ${n1(ra)} 0 0 0 ${pt(a1)}Z`
}

/** Closed Catmull-Rom spline through pts, as cubic Béziers. */
export function smoothClosed(pts: J[], k = 1): string {
  const n = pts.length
  let d = `M${pt(pts[0])}`
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % n]
    const p3 = pts[(i + 2) % n]
    const c1: J = [p1[0] + ((p2[0] - p0[0]) / 6) * k, p1[1] + ((p2[1] - p0[1]) / 6) * k]
    const c2: J = [p2[0] - ((p3[0] - p1[0]) / 6) * k, p2[1] - ((p3[1] - p1[1]) / 6) * k]
    d += `C${pt(c1)} ${pt(c2)} ${pt(p2)}`
  }
  return d + 'Z'
}

export const circle = (c: J, r: number) =>
  `M${n1(c[0] - r)} ${n1(c[1])}a${n1(r)} ${n1(r)} 0 1 0 ${n1(2 * r)} 0a${n1(r)} ${n1(r)} 0 1 0 ${n1(-2 * r)} 0Z`

/** Torso-local coordinates: s along hip→shoulder (0..1), w along the chest normal (px). */
export const torsoAt = (r: Rig, s: number, w: number): J => add(lerp(r.hip, r.shoulder, s), mul(r.front, w))

/** Ring of (s, w) control points describing a side-view torso: pelvis, lumbar curve, rib cage, chest. */
export const TORSO_RING: J[] = [
  [-0.14, 0.5],
  [-0.05, -7.0],
  [0.12, -6.6],
  [0.32, -5.3],
  [0.6, -7.0],
  [0.86, -7.4],
  [1.03, -4.8],
  [1.1, 0.5],
  [1.0, 6.4],
  [0.8, 9.2],
  [0.6, 8.4],
  [0.4, 6.3],
  [0.2, 6.8],
  [0.02, 6.0],
]
export const torsoPoints = (r: Rig, ring = TORSO_RING) => ring.map(([s, w]) => torsoAt(r, s, w))

/** Foot outline (heel, sole, toe, instep, ankle). */
export function footPoints(ankle: J, ground: number, toe: number): J[] {
  const g = Math.max(ground, ankle[1] + 2.2)
  return [
    [ankle[0] - 3.2 * toe, ankle[1] - 1],
    [ankle[0] - 3.8 * toe, g - 1.2],
    [ankle[0] - 2.5 * toe, g],
    [ankle[0] + 9.5 * toe, g],
    [ankle[0] + 10.5 * toe, g - 1.6],
    [ankle[0] + 5 * toe, g - 3.4],
    [ankle[0] + 2.4 * toe, ankle[1] - 1.5],
  ]
}

/** shift every joint of a rig by an offset (for the far-side limbs) */
export const shift = (p: J, o: J): J => [p[0] + o[0], p[1] + o[1]]

/** chin / jaw direction: forward along the chest normal and toward the feet */
export const chinDir = (r: Rig): J => norm(add(r.front, mul(norm(sub(r.hip, r.shoulder)), 0.25)))
