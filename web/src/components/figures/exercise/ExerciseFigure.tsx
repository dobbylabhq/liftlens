import { useMemo, useRef } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import type { ExerciseInfo } from '../../../lib/movement/types'
import { add, lerp, mul, norm, perp, sub, type J, type Rig, type Sides } from '../poses'
import { SPEC, bodyPaths, highlight, type BodyPaths } from '../body'
import { capsule, torsoAt } from '../geom'
import { PlateVolume } from '../equipment'
import { useSvgId } from '../useRepTimeline'
import { exerciseSpec, type ExerciseSpec, type Region } from './spec'
import { G, motionOf, sidesOf, type Motion } from './rig'

gsap.registerPlugin(useGSAP)

const NEAR_KEYS = ['thigh', 'shin', 'foot', 'upper', 'fore', 'hand'] as const
const FAR_KEYS = ['farThigh', 'farShin', 'farFoot', 'farUpper', 'farFore', 'farHand'] as const
const REGIONS: Region[] = ['chest', 'delts', 'biceps', 'triceps', 'forearms', 'lats', 'upperBack', 'lowerBack', 'abs', 'glutes', 'quads', 'hamstrings', 'calves']

const onBone = (a: J, b: J, side: number, from: number, to: number, off: number, r1: number, r2: number) => {
  const n = mul(perp(norm(sub(b, a))), side * off)
  return capsule(add(lerp(a, b, from), n), add(lerp(a, b, to), n), r1, r2)
}

/** muscle region outlines on the near-side body, in the frame's pose */
function regionPath(k: Region, r: Rig, sd: Sides): string {
  switch (k) {
    case 'chest':
      return capsule(torsoAt(r, 0.94, 4.6), torsoAt(r, 0.68, 6.0), 3.8, 3.2)
    case 'delts':
      return capsule(add(r.shoulder, mul(r.front, 0.8)), lerp(r.shoulder, r.elbow, 0.32), 4.0, 2.8)
    case 'biceps':
      return onBone(r.shoulder, r.elbow, sd.upperFront, 0.22, 0.86, 1.4, 2.6, 2.0)
    case 'triceps':
      return onBone(r.shoulder, r.elbow, -sd.upperFront, 0.2, 0.86, 1.4, 2.4, 1.7)
    case 'forearms':
      return capsule(lerp(r.elbow, r.wrist, 0.1), lerp(r.elbow, r.wrist, 0.72), 2.6, 1.8)
    case 'lats':
      return capsule(torsoAt(r, 0.42, -5.6), torsoAt(r, 0.84, -6.6), 2.6, 3.6)
    case 'upperBack':
      return capsule(torsoAt(r, 0.8, -6.8), torsoAt(r, 1.02, -3.6), 2.8, 2.4)
    case 'lowerBack':
      return capsule(torsoAt(r, 0.14, -4.6), torsoAt(r, 0.5, -5.4), 2.2, 1.8)
    case 'abs':
      return capsule(torsoAt(r, 0.12, 5.4), torsoAt(r, 0.56, 6.6), 2.6, 3.0)
    case 'glutes':
      return capsule(torsoAt(r, 0.06, -4.2), add(lerp(r.hip, r.knee, 0.18), mul(perp(norm(sub(r.knee, r.hip))), sd.thighBack * 2.8)), 5.4, 4.0)
    case 'quads':
      return onBone(r.hip, r.knee, -sd.thighBack, 0.12, 0.84, 2.0, 4.1, 2.7)
    case 'hamstrings':
      return onBone(r.hip, r.knee, sd.thighBack, 0.22, 0.86, 2.3, 3.1, 2.3)
    case 'calves':
      return onBone(r.knee, r.ankle, sd.shinBack, 0.1, 0.55, 1.6, 2.8, 1.6)
  }
}

/** viewBox around every pose of the rep (plus props and equipment), at a fixed 10:7 aspect */
function frameBox(m: Motion): string {
  const pts: J[] = []
  for (let i = 0; i <= 8; i++) {
    const r = m.rig(i / 8)
    pts.push(r.head, r.shoulder, r.elbow, r.wrist, r.bar, r.hip, r.knee, r.ankle)
    if (r.farLeg) pts.push(r.farLeg.ankle)
  }
  for (const p of m.props) {
    if (p.kind === 'pad') pts.push(p.a, p.b)
    else if (p.kind === 'bar') pts.push(p.at)
  }
  if (m.pulley) pts.push(m.pulley)
  pts.push([pts[0][0], G + 4])
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }
  const pad = 14
  x0 -= pad
  y0 -= pad
  x1 += pad
  y1 = Math.max(y1 + 4, G + 6)
  let w = x1 - x0
  let h = y1 - y0
  const want = 10 / 7
  if (w / h < want) {
    const nw = h * want
    x0 -= (nw - w) / 2
    w = nw
  } else {
    const nh = w / want
    y0 -= nh - h // keep the floor at the bottom
    h = nh
  }
  return `${x0.toFixed(1)} ${y0.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`
}

function Dumbbell({ dim }: { dim?: boolean }) {
  return (
    <g opacity={dim ? 0.5 : 1}>
      <rect x="-5.2" y="-4.6" width="10.4" height="9.2" rx="2.4" fill="#151a17" stroke="#7d8a83" strokeWidth="0.8" />
      <rect x="-3.6" y="-3.1" width="7.2" height="6.2" rx="1.6" fill="#2a322e" />
      <circle r="1.1" fill="#59665f" />
    </g>
  )
}

function Kettlebell() {
  return (
    <g>
      <path d="M-3.4 -1.6 Q0 -7 3.4 -1.6" fill="none" stroke="#7d8a83" strokeWidth="1.6" />
      <circle cx="0" cy="4.2" r="5.4" fill="#151a17" stroke="#7d8a83" strokeWidth="0.8" />
    </g>
  )
}

/**
 * Animated, muscled figure for any exercise whose movement we can derive (see spec.ts / rig.ts).
 * Returns null otherwise, so callers can fall back to a muscle map.
 */
export function ExerciseFigure({ exercise, className, playing = true, accent = '#c8ff3d', progress }: { exercise: ExerciseInfo; className?: string; playing?: boolean; accent?: string; /** freeze at this point of the rep (0…1) */ progress?: number }) {
  const spec = useMemo(() => exerciseSpec(exercise), [exercise])
  const motion = useMemo(() => (spec ? motionOf(spec) : null), [spec])
  if (!spec || !motion) return null
  return <Figure key={exercise.id} spec={spec} motion={motion} className={className} playing={playing} accent={accent} label={exercise.zh || exercise.name} progress={progress} />
}

function Figure({ spec, motion, className, playing, accent, label, progress }: { spec: ExerciseSpec; motion: Motion; className?: string; playing: boolean; accent: string; label: string; progress?: number }) {
  const root = useRef<SVGSVGElement>(null)
  const id = useSvgId('ex')
  const sides = useMemo(() => sidesOf(motion.rig), [motion])
  const box = useMemo(() => frameBox(motion), [motion])
  const lit = REGIONS.filter((k) => spec.muscles[k])
  const both = !spec.unilateral

  useGSAP(
    () => {
      const svg = root.current
      if (!svg) return
      const q = (c: string) => svg.querySelector('.' + c) as SVGElement | null
      const parts = Object.fromEntries(['torso', 'neck', 'head', ...NEAR_KEYS, ...FAR_KEYS].map((k) => [k, q(k)])) as Record<keyof BodyPaths, SVGElement>
      const hl = ['hl-thigh', 'hl-shin', 'hl-upper', 'hl-fore'].map(q)
      const equip = q('equip')
      const farEquip = q('far-equip')
      const cable = q('cable')
      const lever = q('lever')
      const roller = q('roller')
      const sled = q('sled')
      const mus = lit.map((k) => q('m-' + k))
      const musG = q('muscles')
      let prev = 0
      let level = 0.5
      const render = (t: number) => {
        const r = motion.rig(t)
        const p = bodyPaths(r, sides)
        for (const k in parts) parts[k as keyof BodyPaths]?.setAttribute('d', p[k as keyof BodyPaths])
        hl[0]?.setAttribute('d', highlight(r.hip, r.knee, SPEC.thigh.ra, SPEC.thigh.rb))
        hl[1]?.setAttribute('d', highlight(r.knee, r.ankle, SPEC.shin.ra, SPEC.shin.rb))
        hl[2]?.setAttribute('d', highlight(r.shoulder, r.elbow, SPEC.upper.ra, SPEC.upper.rb))
        hl[3]?.setAttribute('d', highlight(r.elbow, r.wrist, SPEC.fore.ra, SPEC.fore.rb))
        equip?.setAttribute('transform', `translate(${r.bar[0].toFixed(1)} ${r.bar[1].toFixed(1)})`)
        const fw = r.farArm ? add(r.farArm.wrist, mul(norm(sub(r.farArm.wrist, r.farArm.elbow)), 3)) : r.bar
        farEquip?.setAttribute('transform', `translate(${(fw[0] + r.far[0]).toFixed(1)} ${(fw[1] + r.far[1]).toFixed(1)})`)
        if (cable && motion.pulley) cable.setAttribute('d', `M${motion.pulley[0].toFixed(1)} ${motion.pulley[1].toFixed(1)}L${r.bar[0].toFixed(1)} ${r.bar[1].toFixed(1)}`)
        if (lever) lever.setAttribute('d', `M${r.knee[0].toFixed(1)} ${r.knee[1].toFixed(1)}L${r.ankle[0].toFixed(1)} ${r.ankle[1].toFixed(1)}`)
        roller?.setAttribute('transform', `translate(${r.ankle[0].toFixed(1)} ${(r.ankle[1] - 3).toFixed(1)})`)
        sled?.setAttribute('transform', `translate(${r.ankle[0].toFixed(1)} ${r.ankle[1].toFixed(1)}) rotate(${(motion.sled ?? 90) - 90})`)
        lit.forEach((k, i) => mus[i]?.setAttribute('d', regionPath(k, r, sides)))
        // muscles glow harder while the rep moves, settle at the ends
        const moving = Math.min(1, Math.abs(t - prev) * 40)
        level += (0.45 + 0.55 * moving - level) * 0.12
        prev = t
        musG?.setAttribute('opacity', level.toFixed(3))
      }
      if (progress != null) {
        render(progress)
        return
      }
      const state = { t: 0 }
      render(0)
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const T = motion.tempo
        const tl = gsap.timeline({ repeat: -1, paused: !playing, onUpdate: () => render(state.t) })
        tl.to(state, { t: 1, duration: T * 0.5, ease: 'sine.inOut' })
          .to(state, { t: 1, duration: T * 0.08 })
          .to(state, { t: 0, duration: T * 0.32, ease: 'power2.out' })
          .to(state, { t: 0, duration: T * 0.1 })
        return () => tl.kill()
      })
      return () => mm.revert()
    },
    { scope: root, dependencies: [motion, playing, progress], revertOnUpdate: true },
  )

  const skin = `url(#${id}-skin)`
  const dim = `url(#${id}-dim)`
  const isBar = spec.equip === 'barbell' || spec.equip === 'smith'
  const r0 = motion.rig(0)
  return (
    <svg ref={root} viewBox={box} className={className} role="img" aria-label={`${label} 动作示意`}>
      <defs>
        <linearGradient id={`${id}-skin`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#c4cec8" />
          <stop offset="1" stopColor="#5f6b65" />
        </linearGradient>
        <linearGradient id={`${id}-dim`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#56625b" />
          <stop offset="1" stopColor="#2a322e" />
        </linearGradient>
        <linearGradient id={`${id}-shoe`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3d4943" />
          <stop offset="1" stopColor="#171c19" />
        </linearGradient>
        <linearGradient id={`${id}-pad`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2f3833" />
          <stop offset="1" stopColor="#151a17" />
        </linearGradient>
        <filter id={`${id}-glow`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* floor */}
      <line x1="-400" x2="600" y1={G + 0.5} y2={G + 0.5} stroke="#5eead4" strokeOpacity="0.25" strokeWidth="1" />
      <rect x="-400" y={G + 1} width="1000" height="40" fill="#0e1210" />

      {/* props behind the body: benches, seats, bars, cable column */}
      {motion.pulley && (
        <g>
          <line x1={motion.pulley[0]} x2={motion.pulley[0]} y1={Math.min(motion.pulley[1], r0.head[1]) - 8} y2={G} stroke="#2a322e" strokeWidth="4" />
          <circle cx={motion.pulley[0]} cy={motion.pulley[1]} r="3" fill="#151a17" stroke="#7d8a83" strokeWidth="0.8" />
        </g>
      )}
      {motion.props.map((p, i) => {
        if (p.kind === 'pad') {
          const d = norm(sub(p.b, p.a))
          const n = perp(d)
          const nn = n[1] < 0 ? mul(n, -1) : n // toward the floor
          const q = (pt: J, k: number) => add(pt, mul(nn, k))
          const corners = [p.a, p.b, q(p.b, 5.5), q(p.a, 5.5)]
          return (
            <g key={i}>
              {p.legs &&
                [lerp(p.a, p.b, 0.15), lerp(p.a, p.b, 0.85)].map((c, j) => (
                  <line key={j} x1={c[0]} x2={c[0]} y1={c[1] + 4} y2={G} stroke="#3a4540" strokeWidth="2.6" />
                ))}
              <path d={`M${corners.map((c) => c.map((v) => v.toFixed(1)).join(' ')).join('L')}Z`} fill={`url(#${id}-pad)`} stroke="#3d4843" strokeWidth="0.8" strokeLinejoin="round" />
            </g>
          )
        }
        if (p.kind === 'bar')
          return (
            <g key={i}>
              {p.post && <line x1={p.at[0] + 4} x2={p.at[0] + 4} y1={p.at[1]} y2={G} stroke="#3a4540" strokeWidth="2.4" />}
              {!p.post && <line x1={p.at[0] - 40} x2={p.at[0] + 40} y1={p.at[1] - 3} y2={p.at[1] - 3} stroke="#3a4540" strokeWidth="1.2" />}
              <circle cx={p.at[0]} cy={p.at[1]} r="2.2" fill="#8b978f" />
            </g>
          )
        return <rect key={i} x={p.x0} y={p.top - 6} width={p.x1 - p.x0} height="6" rx="1" fill="#2a322e" />
      })}
      {motion.lever && <path className="lever" stroke="#3a4540" strokeWidth="2.6" strokeLinecap="round" fill="none" />}
      {motion.lever && <circle className="roller" r="3.6" fill="#2f3833" stroke="#56625b" strokeWidth="0.8" />}
      {spec.equip === 'smith' && (
        <g stroke="#2a322e" strokeWidth="2">
          <line x1={r0.bar[0] - 3} x2={r0.bar[0] - 3} y1={r0.bar[1] - 60} y2={G} />
          <line x1={r0.bar[0] + 5} x2={r0.bar[0] + 5} y1={r0.bar[1] - 64} y2={G} />
        </g>
      )}
      {motion.pulley && <path className="cable" stroke="#8b978f" strokeWidth="0.7" strokeDasharray={spec.equip === 'band' ? '2 1.5' : undefined} fill="none" />}

      {/* far limbs + far-hand equipment */}
      <g fill={dim}>
        <path className="farThigh" />
        <path className="farShin" />
        <path className="farFoot" fill="#1c221f" />
        <path className="farUpper" />
        <path className="farFore" />
        <path className="farHand" />
      </g>
      {(spec.equip === 'dumbbell' || spec.equip === 'kettlebell') && (both || spec.unilateral) && (
        <g className="far-equip" opacity={both ? 1 : 0}>
          {spec.equip === 'dumbbell' ? <Dumbbell dim /> : <g opacity="0.5"><Kettlebell /></g>}
        </g>
      )}
      {isBar && (
        <g className="far-equip">
          <PlateVolume id={`${id}-f`} r={10} dim />
        </g>
      )}

      <g fill={skin}>
        <path className="torso" />
        <path className="neck" />
        <path className="head" />
        <path className="thigh" />
        <path className="shin" />
        <path className="foot" fill={`url(#${id}-shoe)`} />
        <path className="upper" />
        <path className="fore" />
        <path className="hand" />
      </g>
      <g className="muscles" fill={accent} filter={`url(#${id}-glow)`} opacity="0.5">
        {lit.map((k) => (
          <path key={k} className={`m-${k}`} fillOpacity={spec.muscles[k]} />
        ))}
      </g>
      <g fill="#fff" fillOpacity="0.22">
        <path className="hl-thigh" />
        <path className="hl-shin" />
        <path className="hl-upper" />
        <path className="hl-fore" />
      </g>

      {motion.sled != null && <rect className="sled" x="3" y="-12" width="4" height="24" rx="1.2" fill="#2f3833" stroke="#56625b" strokeWidth="0.8" />}

      {/* near-hand equipment */}
      <g className="equip">
        {isBar && <PlateVolume id={id} r={10} accent={accent} />}
        {spec.equip === 'dumbbell' && <Dumbbell />}
        {spec.equip === 'kettlebell' && <Kettlebell />}
        {spec.equip === 'ball' && <circle r="6.5" fill="#26302b" stroke="#7d8a83" strokeWidth="0.8" />}
        {(spec.equip === 'cable' || spec.equip === 'band' || spec.equip === 'machine') && <rect x="-1.4" y="-4.5" width="2.8" height="9" rx="1.2" fill="#8b978f" />}
      </g>
    </svg>
  )
}
