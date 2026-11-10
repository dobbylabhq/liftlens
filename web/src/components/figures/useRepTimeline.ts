import { useId, type RefObject } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import type { LiftId } from '../../lib/types'
import { isConcentric } from './poses'

gsap.registerPlugin(useGSAP)

export interface FigureProps {
  lift: LiftId
  className?: string
  /** seconds per rep */
  tempo?: number
  playing?: boolean
  showTrail?: boolean
  accent?: string
  /** freeze at this rep progress (0 = pose a, 1 = pose b) instead of playing — lab scrubbing */
  progress?: number
}

export interface FrameInfo {
  /** 0 = pose a, 1 = pose b */
  t: number
  concentric: boolean
}

/**
 * Same rep timeline as LiftFigure (slow eccentric → pause → faster concentric → lockout hold),
 * reduced-motion aware. `setup` runs once per (lift, tempo, playing) and returns the per-frame
 * renderer, which must only touch the DOM via setAttribute — never React state.
 */
export function useRepTimeline(
  root: RefObject<SVGSVGElement | null>,
  { lift, tempo = 2.4, playing = true, progress }: Pick<FigureProps, 'lift' | 'tempo' | 'playing' | 'progress'>,
  setup: (svg: SVGSVGElement) => (f: FrameInfo) => void,
) {
  useGSAP(
    () => {
      const svg = root.current
      if (!svg) return
      const render = setup(svg)
      if (progress != null) {
        render({ t: progress, concentric: false })
        return
      }
      const state = { t: 0 }
      let prev = 0
      const frame = () => {
        const t = state.t
        render({ t, concentric: isConcentric(lift, t - prev) })
        prev = t
      }
      frame()

      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const tl = gsap.timeline({ repeat: -1, paused: !playing, onUpdate: frame })
        tl.to(state, { t: 1, duration: tempo * 0.5, ease: 'sine.inOut' })
          .to(state, { t: 1, duration: tempo * 0.08 })
          .to(state, { t: 0, duration: tempo * 0.32, ease: 'power2.out' })
          .to(state, { t: 0, duration: tempo * 0.1 })
        const spin = svg.querySelectorAll('.plate-spin')
        const sp = spin.length ? gsap.to(spin, { rotate: 360, duration: tempo * 4, repeat: -1, ease: 'none', svgOrigin: '0 0', paused: !playing }) : null
        return () => {
          tl.kill()
          sp?.kill()
        }
      })
      return () => mm.revert()
    },
    { scope: root, dependencies: [lift, playing, tempo, progress], revertOnUpdate: true },
  )
}

/** useId() output is not always a valid url(#…) fragment */
export function useSvgId(prefix: string) {
  return prefix + useId().replace(/[^a-zA-Z0-9_-]/g, '')
}

/** Bar-path trail shared by every style. */
export function makeTrail(svg: SVGSVGElement, enabled: boolean) {
  const el = svg.querySelector('.trail') as SVGPathElement | null
  const pts: string[] = []
  return (x: number, y: number) => {
    if (!enabled || !el) return
    pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`)
    if (pts.length > 90) pts.shift()
    el.setAttribute('d', 'M' + pts.join('L'))
  }
}
