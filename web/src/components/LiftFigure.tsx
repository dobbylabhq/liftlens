import { useRef } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import type { LiftId } from '../lib/types'
import { POSES, lerp, type J, type Pose } from './figures/poses'

gsap.registerPlugin(useGSAP)

interface Props {
  lift: LiftId
  className?: string
  /** seconds per rep */
  tempo?: number
  playing?: boolean
  showTrail?: boolean
  accent?: string
}

export function LiftFigure({ lift, className, tempo = 2.4, playing = true, showTrail = true, accent = '#c8ff3d' }: Props) {
  const root = useRef<SVGSVGElement>(null)
  const cfg = POSES[lift]

  useGSAP(
    () => {
      const svg = root.current!
      const q = (s: string) => svg.querySelector(s) as SVGElement
      const bones: [keyof Pose, keyof Pose][] = [
        ['shoulder', 'elbow'],
        ['elbow', 'wrist'],
        ['shoulder', 'hip'],
        ['hip', 'knee'],
        ['knee', 'ankle'],
      ]
      const state = { t: 0 }
      const trail = q('.trail') as SVGPathElement
      const trailPts: J[] = []

      const render = () => {
        // ease the progress like a real rep: slow eccentric, sticking point, lockout
        const t = state.t
        const P = {} as Pose
        ;(Object.keys(cfg.a) as (keyof Pose)[]).forEach((k) => (P[k] = lerp(cfg.a[k], cfg.b[k], t)))
        bones.forEach(([a, b], i) => {
          const l = q(`.bone-${i}`)
          l.setAttribute('x1', String(P[a][0]))
          l.setAttribute('y1', String(P[a][1]))
          l.setAttribute('x2', String(P[b][0]))
          l.setAttribute('y2', String(P[b][1]))
        })
        const head = q('.head')
        head.setAttribute('cx', String(P.head[0]))
        head.setAttribute('cy', String(P.head[1]))
        ;(['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle'] as const).forEach((k) => {
          const c = q(`.j-${k}`)
          c.setAttribute('cx', String(P[k][0]))
          c.setAttribute('cy', String(P[k][1]))
        })
        q('.plate').setAttribute('transform', `translate(${P.bar[0]} ${P.bar[1]})`)
        if (showTrail) {
          trailPts.push(P.bar)
          if (trailPts.length > 90) trailPts.shift()
          trail.setAttribute('d', trailPts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(''))
        }
      }
      render()

      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const tl = gsap.timeline({ repeat: -1, paused: !playing, onUpdate: render })
        // eccentric (slower) → brief pause → concentric (faster) → lockout hold
        tl.to(state, { t: 1, duration: tempo * 0.5, ease: 'sine.inOut' })
          .to(state, { t: 1, duration: tempo * 0.08 })
          .to(state, { t: 0, duration: tempo * 0.32, ease: 'power2.out' })
          .to(state, { t: 0, duration: tempo * 0.1 })
        // layer 2: the plate spins slightly with the movement
        gsap.to(q('.plate-spin'), { rotate: 360, duration: tempo * 4, repeat: -1, ease: 'none', svgOrigin: '0 0' })
        return () => tl.kill()
      })
      return () => mm.revert()
    },
    { scope: root, dependencies: [lift, playing, tempo], revertOnUpdate: true },
  )

  return (
    <svg ref={root} viewBox="0 0 200 140" className={className} aria-label={`${lift} 动作示意`} role="img">
      <defs>
        <linearGradient id={`fade-${lift}`} x1="0" x2="1">
          <stop offset="0" stopColor="#5eead4" stopOpacity="0" />
          <stop offset="0.5" stopColor="#5eead4" stopOpacity="0.35" />
          <stop offset="1" stopColor="#5eead4" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="10" x2="190" y1={cfg.ground + 1} y2={cfg.ground + 1} stroke={`url(#fade-${lift})`} strokeWidth="1" />
      {lift === 'bench' && (
        <g stroke="#34403a" strokeWidth="3" strokeLinecap="round">
          <line x1="60" y1="93" x2="160" y2="93" />
          <line x1="72" y1="93" x2="66" y2={cfg.ground} />
          <line x1="148" y1="93" x2="154" y2={cfg.ground} />
        </g>
      )}
      <path className="trail" fill="none" stroke={accent} strokeOpacity="0.55" strokeWidth="1.2" strokeDasharray="2 3" />
      <g stroke="#e8efe9" strokeWidth="4.5" strokeLinecap="round">
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={i} className={`bone-${i}`} />
        ))}
      </g>
      <circle className="head" r="7.5" fill="#e8efe9" />
      {(['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle'] as const).map((k) => (
        <circle key={k} className={`j-${k}`} r="2.4" fill="#5eead4" />
      ))}
      <g className="plate">
        <g className="plate-spin">
          <circle r={cfg.plate} fill="#0b0d0c" stroke="#e8efe9" strokeWidth="2.5" />
          <circle r={cfg.plate * 0.62} fill="none" stroke="#34403a" strokeWidth="1.5" strokeDasharray="4 3" />
          <circle r="3.2" fill={accent} />
        </g>
      </g>
    </svg>
  )
}
