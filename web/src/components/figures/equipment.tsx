import type { LiftId } from '../../lib/types'
import { POSES, type J } from './poses'
import { capsule } from './geom'

/** where the far-side plate sits relative to the near one (slight 3/4 perspective) */
export const FAR_PLATE: J = [6, -5]
/** plate thickness direction (toward the back) */
export const PLATE_BACK: J = [2.6, -1.8]
/** bench pad geometry shared by all styles */
export const BENCH = { x0: 90, x1: 170, top: 91, h: 6, legs: [102, 158] }

export function Floor({ id, lift }: { id: string; lift: LiftId }) {
  const g = POSES[lift].ground
  const cx = lift === 'bench' ? 128 : 104
  return (
    <g>
      <defs>
        <radialGradient id={`${id}-shadow`}>
          <stop offset="0" stopColor="#000" stopOpacity="0.55" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-floor`} x1="0" x2="1">
          <stop offset="0" stopColor="#5eead4" stopOpacity="0" />
          <stop offset="0.5" stopColor="#5eead4" stopOpacity="0.35" />
          <stop offset="1" stopColor="#5eead4" stopOpacity="0" />
        </linearGradient>
      </defs>
      {lift !== 'bench' && <rect x="30" y={g} width="140" height="5" rx="1" fill="#141917" />}
      <line x1="10" x2="190" y1={g + 0.5} y2={g + 0.5} stroke={`url(#${id}-floor)`} strokeWidth="1" />
      <ellipse cx={cx} cy={g + 0.5} rx={lift === 'bench' ? 52 : 30} ry="3" fill={`url(#${id}-shadow)`} />
    </g>
  )
}

export function BenchVolume({ id }: { id: string }) {
  const { x0, x1, top, h, legs } = BENCH
  const g = POSES.bench.ground
  return (
    <g>
      <defs>
        <linearGradient id={`${id}-pad`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2f3833" />
          <stop offset="1" stopColor="#151a17" />
        </linearGradient>
        <linearGradient id={`${id}-steel`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#56625b" />
          <stop offset="0.45" stopColor="#8b978f" />
          <stop offset="1" stopColor="#2a322e" />
        </linearGradient>
      </defs>
      {/* frame: legs taper toward the floor, foot bars */}
      {legs.map((x) => (
        <g key={x}>
          <path d={`M${x - 2} ${top + h}L${x + 2} ${top + h}L${x + 3} ${g - 2}L${x - 3} ${g - 2}Z`} fill={`url(#${id}-steel)`} />
          <rect x={x - 8} y={g - 2.5} width="16" height="2.5" rx="1.2" fill="#3a4540" />
        </g>
      ))}
      <rect x={legs[0]} y={top + h} width={legs[1] - legs[0]} height="2.6" fill="#2a322e" />
      {/* pad: top face (perspective) + front face */}
      <path d={`M${x0} ${top}L${x1} ${top}L${x1 + 2.5} ${top - 2.6}L${x0 + 2.5} ${top - 2.6}Z`} fill="#3d4843" />
      <rect x={x0} y={top} width={x1 - x0} height={h} rx="2.4" fill={`url(#${id}-pad)`} />
      <line x1={x0 + 2} x2={x1 - 2} y1={top + 0.6} y2={top + 0.6} stroke="#56625b" strokeWidth="0.6" />
    </g>
  )
}

export function PlateVolume({ id, r, dim = false, accent = '#c8ff3d' }: { id: string; r: number; dim?: boolean; accent?: string }) {
  const slots = [0, 120, 240].map((a) => [Math.cos((a * Math.PI) / 180) * r * 0.62, Math.sin((a * Math.PI) / 180) * r * 0.62])
  return (
    <g opacity={dim ? 0.5 : 1}>
      <defs>
        <radialGradient id={`${id}-face`} cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#323b36" />
          <stop offset="1" stopColor="#101412" />
        </radialGradient>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f0f5f1" />
          <stop offset="1" stopColor="#6b7a72" />
        </linearGradient>
      </defs>
      {/* side band = plate thickness */}
      <path d={capsule([0, 0], PLATE_BACK, r, r)} fill="#0a0c0b" stroke="#2c3531" strokeWidth="0.6" />
      <circle r={r} fill={`url(#${id}-face)`} stroke={dim ? '#2c3531' : '#7d8a83'} strokeWidth="0.9" />
      <g className="plate-spin">
        <circle r={r * 0.8} fill="none" stroke="#3a4540" strokeWidth="0.8" />
        <circle r={r * 0.46} fill="none" stroke="#1d2421" strokeWidth="2.6" />
        {slots.map(([x, y], i) => (
          <ellipse key={i} cx={x} cy={y} rx="2.4" ry="1.4" transform={`rotate(${i * 120 + 90} ${x} ${y})`} fill="#060807" stroke="#2c3531" strokeWidth="0.4" />
        ))}
      </g>
      <circle r={r * 0.24} fill="#1b211e" stroke="#59665f" strokeWidth="0.7" />
      {/* sleeve end pokes out toward the viewer */}
      <path d={capsule([0, 0], [-2.2, 1.5], 2.5, 2.5)} fill={`url(#${id}-metal)`} />
      <circle cx="-2.2" cy="1.5" r="2.5" fill="#d6dfd9" />
      <circle cx="-2.2" cy="1.5" r="0.9" fill={dim ? '#5c6862' : accent} />
    </g>
  )
}
