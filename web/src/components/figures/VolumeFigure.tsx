import { useMemo, useRef } from 'react'
import { boneSides, rigPose, PLATE_R } from './poses'
import { SPEC, bodyPaths, highlight, musclePaths, type BodyPaths } from './body'
import { makeTrail, useRepTimeline, useSvgId, type FigureProps } from './useRepTimeline'
import { Floor, BenchVolume, PlateVolume, FAR_PLATE } from './equipment'

const NEAR_KEYS = ['thigh', 'shin', 'foot', 'upper', 'fore', 'hand'] as const
const FAR_KEYS = ['farThigh', 'farShin', 'farFoot', 'farUpper', 'farFore', 'farHand'] as const

/**
 * Style A (volumetric limbs) / Style B (anatomical muscle groups, muscles=true).
 * Tapered capsules with per-segment gradients, far limbs dimmed, specular strips on the lit side.
 */
export function VolumeFigure({ lift, className, tempo = 2.4, playing = true, showTrail = true, accent = '#c8ff3d', progress, muscles = false }: FigureProps & { muscles?: boolean }) {
  const root = useRef<SVGSVGElement>(null)
  const id = useSvgId(muscles ? 'mu' : 'vo')
  const sides = useMemo(() => boneSides(lift), [lift])
  const nMuscles = useMemo(() => musclePaths(lift, rigPose(lift, 0), sides).length, [lift, sides])


  useRepTimeline(root, { lift, tempo, playing, progress }, (svg) => {
    const q = (c: string) => svg.querySelector('.' + c) as SVGElement
    const parts = Object.fromEntries(
      ['torso', 'neck', 'head', ...NEAR_KEYS, ...FAR_KEYS].map((k) => [k, q(k)]),
    ) as Record<keyof BodyPaths, SVGElement>
    const hl = ['hl-thigh', 'hl-shin', 'hl-upper', 'hl-fore'].map(q)
    const plate = q('plate')
    const farPlate = q('far-plate')
    const mus = Array.from(svg.querySelectorAll('.muscle')) as SVGElement[]
    const musG = q('muscles')
    const trail = makeTrail(svg, showTrail)
    let level = 0.55
    return ({ t, concentric }) => {
      const r = rigPose(lift, t)
      const p = bodyPaths(r, sides)
      for (const k in parts) parts[k as keyof BodyPaths].setAttribute('d', p[k as keyof BodyPaths])
      hl[0].setAttribute('d', highlight(r.hip, r.knee, SPEC.thigh.ra, SPEC.thigh.rb))
      hl[1].setAttribute('d', highlight(r.knee, r.ankle, SPEC.shin.ra, SPEC.shin.rb))
      hl[2].setAttribute('d', highlight(r.shoulder, r.elbow, SPEC.upper.ra, SPEC.upper.rb))
      hl[3].setAttribute('d', highlight(r.elbow, r.wrist, SPEC.fore.ra, SPEC.fore.rb))
      plate.setAttribute('transform', `translate(${r.bar[0].toFixed(1)} ${r.bar[1].toFixed(1)})`)
      farPlate.setAttribute('transform', `translate(${(r.bar[0] + FAR_PLATE[0]).toFixed(1)} ${(r.bar[1] + FAR_PLATE[1]).toFixed(1)})`)
      if (muscles && musG) {
        const m = musclePaths(lift, r, sides)
        mus.forEach((el, i) => el.setAttribute('d', m[i]))
        // load rises during the concentric, decays during the eccentric / holds
        level += ((concentric ? 1 : 0.16) - level) * (concentric ? 0.16 : 0.06)
        musG.setAttribute('opacity', level.toFixed(3))
      }
      trail(r.bar[0], r.bar[1])
    }
  })

  const skin = `url(#${id}-skin)`
  const dim = `url(#${id}-dim)`
  return (
    <svg ref={root} viewBox="0 0 200 140" className={className} role="img" aria-label={`${lift} 动作示意（${muscles ? '解剖肌群' : '体积肢体'}）`}>
      <defs>
        <linearGradient id={`${id}-skin`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor={muscles ? '#c4cec8' : '#e6eee8'} />
          <stop offset="1" stopColor={muscles ? '#5f6b65' : '#87948c'} />
        </linearGradient>
        <linearGradient id={`${id}-dim`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#56625b" />
          <stop offset="1" stopColor="#2a322e" />
        </linearGradient>
        <linearGradient id={`${id}-shoe`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3d4943" />
          <stop offset="1" stopColor="#171c19" />
        </linearGradient>
        {muscles && (
          <filter id={`${id}-glow`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>
      <Floor id={id} lift={lift} />
      {lift === 'bench' && <BenchVolume id={id} />}
      <g className="far-plate">
        <PlateVolume id={`${id}-f`} r={PLATE_R[lift]} dim />
      </g>
      <path className="trail" fill="none" stroke={accent} strokeOpacity="0.55" strokeWidth="1.2" strokeDasharray="2 3" />
      <g fill={dim}>
        <path className="farThigh" />
        <path className="farShin" />
        <path className="farFoot" fill="#1c221f" />
        <path className="farUpper" />
        <path className="farFore" />
        <path className="farHand" />
      </g>
      <g fill={skin}>
        <path className="torso" />
        <path className="neck" />
        <path className="head" />
        <path className="thigh" />
        <path className="shin" />
        <path className="foot" fill={`url(#${id}-shoe)`} />
      </g>
      <g fill={skin}>
        <path className="upper" />
        <path className="fore" />
        <path className="hand" />
      </g>
      {muscles && (
        <g className="muscles" fill={accent} filter={`url(#${id}-glow)`} opacity="0.55">
          {Array.from({ length: nMuscles }, (_, i) => (
            <path key={`${lift}-${i}`} className="muscle" />
          ))}
        </g>
      )}
      <g fill="#fff" fillOpacity="0.22">
        <path className="hl-thigh" />
        <path className="hl-shin" />
        <path className="hl-upper" />
        <path className="hl-fore" />
      </g>
      <g className="plate">
        <PlateVolume id={id} r={PLATE_R[lift]} accent={accent} />
      </g>
    </svg>
  )
}
