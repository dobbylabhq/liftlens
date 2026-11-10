import { useMemo, useRef } from 'react'
import { add, boneSides, dot, lerp, mul, norm, perp, POSES, PLATE_R, rigPose, sub, type J, type Rig, type Sides } from './poses'
import { footPoints, shift, torsoAt, chinDir } from './geom'
import { LIGHT, SPEC, type LimbSpec } from './body'
import { makeTrail, useRepTimeline, useSvgId, type FigureProps } from './useRepTimeline'
import { BENCH, FAR_PLATE, PLATE_BACK } from './equipment'

interface Facet {
  pts: J[]
  /** brightness 0..1 */
  v: number
  far: boolean
}

const lit = (n: J, base = 0.26, k = 0.56) => base + k * Math.max(0, dot(n, LIGHT))

/** a limb as two faceted strips (bone ridge in the middle, muscle belly vertex at `at`) */
function limbFacets(out: Facet[], a: J, b: J, s: LimbSpec, side: number, far: boolean) {
  const at = s.at ?? 0.45
  const m = lerp(a, b, at)
  const n = perp(norm(sub(b, a)))
  const rm = s.ra + (s.rb - s.ra) * at
  for (const sg of [1, -1]) {
    const bulge = (sg === side ? s.back : s.front) ?? 0
    const ea = add(a, mul(n, sg * s.ra))
    const em = add(m, mul(n, sg * (rm + bulge)))
    const eb = add(b, mul(n, sg * s.rb))
    const v = lit(mul(n, sg))
    out.push({ pts: [ea, em, m, a], v: v + 0.06, far }, { pts: [em, eb, b, m], v: v - 0.04, far })
  }
}

function fan(out: Facet[], ring: J[], c: J, far: boolean, base = 0.3) {
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    const mid = lerp(p, q, 0.5)
    out.push({ pts: [c, p, q], v: lit(norm(sub(mid, c)), base) + (i % 2 ? 0.03 : -0.03), far })
  }
}

const ngon = (c: J, r: number, k: number, rot = 0): J[] =>
  Array.from({ length: k }, (_, i) => [c[0] + Math.cos(rot + (i / k) * Math.PI * 2) * r, c[1] + Math.sin(rot + (i / k) * Math.PI * 2) * r] as J)

const TORSO_LP: J[] = [
  [-0.12, 0.5],
  [-0.04, -7.0],
  [0.32, -5.3],
  [0.62, -7.0],
  [1.0, -5.6],
  [1.1, 0.5],
  [0.96, 7.0],
  [0.76, 9.2],
  [0.44, 6.6],
  [0.12, 6.8],
]

function buildFacets(r: Rig, sd: Sides): Facet[] {
  const out: Facet[] = []
  const side = (o: J, far: boolean) => {
    const hip = shift(r.hip, o)
    const knee = shift(r.knee, o)
    const ankle = shift(r.ankle, o)
    const sh = shift(r.shoulder, o)
    const el = shift(r.elbow, o)
    const wr = shift(r.wrist, o)
    const legs = () => {
      limbFacets(out, hip, knee, SPEC.thigh, sd.thighBack, far)
      limbFacets(out, knee, ankle, SPEC.shin, sd.shinBack, far)
      fan(out, ngon(knee, SPEC.thigh.rb * 0.95, 6, 0.3), knee, far, 0.24)
      const foot = footPoints(ankle, r.ground, r.toe)
      fan(out, [foot[0], foot[2], foot[3], foot[5]], lerp(foot[0], foot[4], 0.45), far, 0.14)
    }
    const arms = () => {
      limbFacets(out, sh, el, SPEC.upper, -sd.upperFront, far)
      fan(out, ngon(el, SPEC.upper.rb, 6, 0.5), el, far, 0.26)
      limbFacets(out, el, wr, SPEC.fore, 1, far)
      fan(out, ngon(add(wr, mul(norm(sub(wr, el)), 1.2)), 2.8, 5, 0.2), wr, far, 0.3)
    }
    return { legs, arms }
  }
  const farSide = side(r.far, true)
  farSide.legs()
  farSide.arms()
  // torso + neck + head
  fan(out, TORSO_LP.map(([s, w]) => torsoAt(r, s, w)), torsoAt(r, 0.62, 1.8), false)
  const chin = chinDir(r)
  const neckA = torsoAt(r, 0.98, 0.6)
  limbFacets(out, neckA, r.head, { ra: 3.6, rb: 3.0 }, 1, false)
  const head = ngon(r.head, 6.6, 7, Math.atan2(chin[1], chin[0]) - 0.45)
  head.splice(1, 0, add(r.head, mul(chin, 7.8)))
  fan(out, head, add(r.head, mul(LIGHT, 1.6)), false, 0.32)
  const nearSide = side([0, 0], false)
  nearSide.legs()
  nearSide.arms()
  return out
}

const DARK = [15, 21, 19]
const LITE = [178, 206, 196]
const shade = (v: number, far: boolean) => {
  const t = Math.min(1, Math.max(0, far ? v * 0.5 : v))
  return `rgb(${DARK.map((d, i) => Math.round(d + (LITE[i] - d) * t)).join(',')})`
}
const pts = (p: J[]) => p.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ')

/**
 * Style D (low-poly / wireframe). Every limb is two flat-shaded strips with a muscle-belly vertex,
 * torso/head are triangle fans; each facet's brightness = Lambert(facet normal · key light),
 * recomputed per frame so the shading turns with the limb. Cyan hairline wireframe on top.
 */
export function LowPolyFigure({ lift, className, tempo = 2.4, playing = true, showTrail = true, accent = '#c8ff3d', progress }: FigureProps) {
  const root = useRef<SVGSVGElement>(null)
  const id = useSvgId('lp')
  const sides = useMemo(() => boneSides(lift), [lift])
  const count = useMemo(() => buildFacets(rigPose(lift, 0), sides).length, [lift, sides])
  const { ground } = POSES[lift]
  const pr = PLATE_R[lift]

  useRepTimeline(root, { lift, tempo, playing, progress }, (svg) => {
    const polys = Array.from(svg.querySelectorAll('.facet')) as SVGPolygonElement[]
    const plateEl = svg.querySelector('.plate') as SVGGElement
    const farPlate = svg.querySelector('.far-plate') as SVGGElement
    const trail = makeTrail(svg, showTrail)
    return ({ t }) => {
      const r = rigPose(lift, t)
      const f = buildFacets(r, sides)
      for (let i = 0; i < polys.length; i++) {
        polys[i].setAttribute('points', pts(f[i].pts))
        polys[i].setAttribute('fill', shade(f[i].v, f[i].far))
      }
      plateEl.setAttribute('transform', `translate(${r.bar[0].toFixed(1)} ${r.bar[1].toFixed(1)})`)
      farPlate.setAttribute('transform', `translate(${(r.bar[0] + FAR_PLATE[0]).toFixed(1)} ${(r.bar[1] + FAR_PLATE[1]).toFixed(1)})`)
      trail(r.bar[0], r.bar[1])
    }
  })

  const plateG = (far: boolean) => {
    const face = ngon([0, 0], pr, 10, 0)
    const back = face.map((p) => add(p, PLATE_BACK))
    const hub = ngon([0, 0], pr * 0.3, 6, 0)
    return (
      <g opacity={far ? 0.45 : 1} stroke="#5eead4" strokeOpacity="0.35" strokeWidth="0.35" strokeLinejoin="round">
        {face.map((p, i) => {
          const q = face[(i + 1) % face.length]
          const bq = back[(i + 1) % face.length]
          // only the side quads facing the light are visible past the front face
          return <polygon key={`s${i}`} points={pts([p, q, bq, back[i]])} fill={shade(lit(norm(lerp(p, q, 0.5)), 0.12, 0.4), far)} />
        })}
        <g className="plate-spin">
          {face.map((p, i) => (
            <polygon key={i} points={pts([[0, 0], p, face[(i + 1) % face.length]])} fill={shade(i % 2 ? 0.2 : 0.27, far)} />
          ))}
        </g>
        <polygon points={pts(hub)} fill={shade(0.5, far)} />
        <polygon points={pts(ngon([-2.2, 1.5], 2.5, 6))} fill={far ? '#34403a' : accent} stroke="none" />
      </g>
    )
  }
  const box = (x: number, y: number, w: number, h: number, v: number) => <polygon points={pts([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])} fill={shade(v, false)} />

  return (
    <svg ref={root} viewBox="0 0 200 140" className={className} role="img" aria-label={`${lift} 动作示意（低多边形）`}>
      <defs>
        <pattern id={`${id}-grid`} width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M10 0H0V10" fill="none" stroke="#5eead4" strokeOpacity="0.08" strokeWidth="0.4" />
        </pattern>
      </defs>
      <path d={`M0 ${ground}H200V140H0Z`} fill={`url(#${id}-grid)`} />
      <line x1="0" x2="200" y1={ground} y2={ground} stroke="#5eead4" strokeOpacity="0.3" strokeWidth="0.5" />
      {lift === 'bench' && (
        <g stroke="#5eead4" strokeOpacity="0.35" strokeWidth="0.35">
          {BENCH.legs.map((x) => (
            <polygon key={x} points={pts([[x - 2, BENCH.top + BENCH.h], [x + 2, BENCH.top + BENCH.h], [x + 3, ground], [x - 3, ground]])} fill={shade(0.22, false)} />
          ))}
          <polygon points={pts([[BENCH.x0, BENCH.top], [BENCH.x1, BENCH.top], [BENCH.x1 + 2.5, BENCH.top - 2.6], [BENCH.x0 + 2.5, BENCH.top - 2.6]])} fill={shade(0.42, false)} />
          {box(BENCH.x0, BENCH.top, BENCH.x1 - BENCH.x0, BENCH.h, 0.18)}
        </g>
      )}
      <g className="far-plate">{plateG(true)}</g>
      <path className="trail" fill="none" stroke={accent} strokeOpacity="0.55" strokeWidth="1.1" strokeDasharray="2 3" />
      <g stroke="#5eead4" strokeOpacity="0.4" strokeWidth="0.3" strokeLinejoin="round">
        {Array.from({ length: count }, (_, i) => (
          <polygon key={`${lift}-${i}`} className="facet" />
        ))}
      </g>
      <g className="plate">{plateG(false)}</g>
    </svg>
  )
}
