import { useMemo, useRef } from 'react'
import { boneSides, rigPose, POSES, PLATE_R } from './poses'
import { capsule } from './geom'
import { bodyPaths, type BodyPaths } from './body'
import { makeTrail, useRepTimeline, useSvgId, type FigureProps } from './useRepTimeline'
import { BENCH, FAR_PLATE, PLATE_BACK } from './equipment'

const CORE = ['torso', 'neck', 'head', 'thigh', 'shin', 'foot'] as const
const ARM = ['upper', 'fore', 'hand'] as const
const FAR = ['farThigh', 'farShin', 'farFoot', 'farUpper', 'farFore', 'farHand'] as const
const RIM = 'translate(1.15 -1.15)'

/**
 * Style C (silhouette + rim light). The body is one dark silhouette (same-fill capsules + spline torso
 * union seamlessly). Each layer is defined once in <defs> and drawn 2–3× via <use>: blurred glow,
 * acid rim (copy offset toward the key light), then the dark fill on top — so the per-frame cost
 * is the same setAttribute('d') calls as style A; the clones update for free.
 */
export function SilhouetteFigure({ lift, className, tempo = 2.4, playing = true, showTrail = true, accent = '#c8ff3d', progress }: FigureProps) {
  const root = useRef<SVGSVGElement>(null)
  const id = useSvgId('si')
  const sides = useMemo(() => boneSides(lift), [lift])
  const { ground } = POSES[lift]
  const pr = PLATE_R[lift]

  useRepTimeline(root, { lift, tempo, playing, progress }, (svg) => {
    const q = (c: string) => svg.querySelector('.' + c) as SVGElement
    const keys = [...CORE, ...ARM, ...FAR]
    const els = keys.map(q)
    const plate = q('plate')
    const farPlate = q('far-plate')
    const trail = makeTrail(svg, showTrail)
    return ({ t }) => {
      const r = rigPose(lift, t)
      const p = bodyPaths(r, sides)
      keys.forEach((k, i) => els[i].setAttribute('d', p[k as keyof BodyPaths]))
      plate.setAttribute('transform', `translate(${r.bar[0].toFixed(1)} ${r.bar[1].toFixed(1)})`)
      farPlate.setAttribute('transform', `translate(${(r.bar[0] + FAR_PLATE[0]).toFixed(1)} ${(r.bar[1] + FAR_PLATE[1]).toFixed(1)})`)
      trail(r.bar[0], r.bar[1])
    }
  })

  const fill = `url(#${id}-fill)`
  const plateArc = `M${(Math.cos(-2.6) * pr).toFixed(1)} ${(Math.sin(-2.6) * pr).toFixed(1)}A${pr} ${pr} 0 0 1 ${(Math.cos(0.5) * pr).toFixed(1)} ${(Math.sin(0.5) * pr).toFixed(1)}`
  const plateG = (far = false) => (
    <g opacity={far ? 0.45 : 1}>
      <path d={capsule([0, 0], PLATE_BACK, pr, pr)} fill="#050606" />
      <circle r={pr} fill={fill} />
      <path d={plateArc} transform={RIM} fill="none" stroke={far ? '#5eead4' : accent} strokeWidth="1.1" strokeLinecap="round" />
      <g className="plate-spin" fill="none" stroke="#202825" strokeWidth="0.8">
        <circle r={pr * 0.78} />
        <path d={`M0 ${-pr * 0.78}V${-pr * 0.3}M0 ${pr * 0.3}V${pr * 0.78}`} />
      </g>
      <circle r={pr * 0.24} fill="#0b0e0c" stroke="#2c3531" strokeWidth="0.6" />
      <circle cx="-2.2" cy="1.5" r="2.5" fill="#0b0e0c" stroke={far ? '#34403a' : accent} strokeWidth="0.8" />
    </g>
  )

  return (
    <svg ref={root} viewBox="0 0 200 140" className={className} role="img" aria-label={`${lift} 动作示意（剪影）`}>
      <defs>
        <linearGradient id={`${id}-fill`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="140">
          <stop offset="0" stopColor="#212a25" />
          <stop offset="1" stopColor="#070908" />
        </linearGradient>
        {/* radius kept inside the 0..1 box on every side so the halo never gets a hard clipped edge */}
        <radialGradient id={`${id}-halo`} cx="0.55" cy="0.48" r="0.42">
          <stop offset="0" stopColor={accent} stopOpacity="0.1" />
          <stop offset="1" stopColor={accent} stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-blur`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
        <g id={`${id}-far`}>
          {FAR.map((k) => (
            <path key={k} className={k} />
          ))}
        </g>
        <g id={`${id}-core`}>
          {CORE.map((k) => (
            <path key={k} className={k} />
          ))}
        </g>
        <g id={`${id}-arm`}>
          {ARM.map((k) => (
            <path key={k} className={k} />
          ))}
        </g>
      </defs>

      <rect width="200" height="140" fill={`url(#${id}-halo)`} />
      <line x1="10" x2="190" y1={ground + 0.5} y2={ground + 0.5} stroke="#34403a" strokeWidth="0.8" />
      <line x1="40" x2="160" y1={ground + 0.5} y2={ground + 0.5} stroke={accent} strokeOpacity="0.35" strokeWidth="0.8" />
      {lift === 'bench' && (
        <g>
          {BENCH.legs.map((x) => (
            <path key={x} d={`M${x - 2} ${BENCH.top + BENCH.h}L${x + 2} ${BENCH.top + BENCH.h}L${x + 3} ${ground}L${x - 3} ${ground}Z`} fill="#0b0e0c" />
          ))}
          <rect x={BENCH.x0} y={BENCH.top - 2} width={BENCH.x1 - BENCH.x0} height={BENCH.h + 2} rx="3" fill="#0e1210" />
          <line x1={BENCH.x0 + 3} x2={BENCH.x1 - 2} y1={BENCH.top - 2.2} y2={BENCH.top - 2.2} stroke={accent} strokeOpacity="0.45" strokeWidth="0.7" />
        </g>
      )}
      <g className="far-plate">
        {plateG(true)}
      </g>
      <path className="trail" fill="none" stroke={accent} strokeOpacity="0.5" strokeWidth="1.1" strokeDasharray="2 3" />

      <use href={`#${id}-far`} transform={RIM} fill="#5eead4" opacity="0.35" />
      <use href={`#${id}-far`} fill="#0a0d0b" />

      <use href={`#${id}-core`} fill={accent} opacity="0.28" filter={`url(#${id}-blur)`} />
      <use href={`#${id}-core`} transform={RIM} fill={accent} />
      <use href={`#${id}-core`} fill={fill} />

      <use href={`#${id}-arm`} transform={RIM} fill={accent} />
      <use href={`#${id}-arm`} fill={fill} />

      <g className="plate">
        {plateG()}
      </g>
    </svg>
  )
}
