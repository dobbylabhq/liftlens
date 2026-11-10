import { useId, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import raw from '../data/musclemap.json'
import { MUSCLE_HOST, MUSCLE_KEY_ZH, MUSCLE_PARENT, MUSCLE_ROLLUP, type MuscleKey } from '../lib/muscles'

// Outline art: MuscleMap by Melih Colpan (MIT) — see NOTICE.md and scripts/build-musclemap.mjs.
interface ViewData {
  viewBox: number[]
  body: string
  parts: Partial<Record<MuscleKey, string>>
}
const DATA = raw as unknown as { front: ViewData; back: ViewData }

type Weights = Partial<Record<MuscleKey, number>>
type Side = 'front' | 'back'

const SIDE_LABEL: Record<Side, [string, string]> = { front: ['FRONT', '正面'], back: ['BACK', '背面'] }

// ---- colours (opaque, so stacked sub-regions look identical to their parent) ----
const SILHOUETTE = '#121715'
const MUSCLE_IDLE = '#1d2421'
const MUSCLE_IDLE_HOVER = '#2b3530'
const OUTLINE = '#2e3833'
const ACID = '#c8ff3d'

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const IDLE_RGB = hex(MUSCLE_IDLE)
const ACID_RGB = hex(ACID)
function mix(t: number) {
  const c = IDLE_RGB.map((a, i) => Math.round(a + (ACID_RGB[i] - a) * t))
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}
/** weight 0..1 → fill. Anything trained starts clearly above idle. */
function muscleFill(w: number) {
  return w > 0.001 ? mix(0.2 + 0.8 * Math.min(1, w)) : MUSCLE_IDLE
}

const TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

function clamp01(v: number | undefined) {
  return v && v > 0 ? Math.min(1, v) : 0
}

function summarize(weights: Weights) {
  const list = (Object.entries(weights) as [MuscleKey, number][]).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1])
  const names = (ks: [MuscleKey, number][]) => [...new Set(ks.map(([k]) => MUSCLE_KEY_ZH[k]))].join('、')
  const main = list.filter(([, w]) => w >= 0.75)
  const sub = list.filter(([, w]) => w < 0.75)
  if (!list.length) return '肌肉图：没有标记训练的肌群'
  return `肌肉图：${main.length ? `主要 ${names(main)}` : ''}${main.length && sub.length ? '；' : ''}${sub.length ? `辅助 ${names(sub)}` : ''}`
}

function defaultDetail(w: number) {
  if (w >= 0.75) return '主要发力'
  if (w > 0) return '辅助参与'
  return '未参与'
}

/** One figure (front or back). */
function Figure({
  side,
  weights,
  active,
  setActive,
  glowId,
}: {
  side: Side
  weights: Weights
  active: MuscleKey | null
  setActive: (k: MuscleKey | null, e?: RPointerEvent) => void
  glowId: string
}) {
  const v = DATA[side]
  const reduce = useReducedMotion()
  const tr = { duration: reduce ? 0 : 0.55, ease: [0.16, 1, 0.3, 1] as const }

  const own = (k: MuscleKey) => clamp01(weights[k])
  const keys = Object.keys(v.parts) as MuscleKey[]
  const base = keys.filter((k) => !MUSCLE_PARENT[k])
  const effBase = (k: MuscleKey) => Math.max(own(k), MUSCLE_HOST[k] ? own(MUSCLE_HOST[k]) : 0)
  // overlays: sub-regions that stand out from their parent (or are being pointed at)
  const overlays = keys.filter((k) => {
    const p = MUSCLE_PARENT[k]
    return p && (own(k) > own(p) + 0.001 || active === k)
  })
  const effOverlay = (k: MuscleKey) => Math.max(own(k), own(MUSCLE_PARENT[k]!))

  const handlers = (k: MuscleKey) => ({
    onPointerEnter: (e: RPointerEvent) => e.pointerType === 'mouse' && setActive(k, e),
    onPointerMove: (e: RPointerEvent) => e.pointerType === 'mouse' && setActive(k, e),
    onPointerLeave: (e: RPointerEvent) => e.pointerType === 'mouse' && setActive(null),
    // touch / pen: tap toggles the label under the figure
    onPointerDown: (e: RPointerEvent) => e.pointerType !== 'mouse' && setActive(active === k ? null : k),
  })

  const shape = (k: MuscleKey, w: number) => {
    const isActive = active === k || (!!active && MUSCLE_ROLLUP[active] === k && !v.parts[active])
    return (
      <motion.path
        key={k}
        d={v.parts[k]}
        initial={false}
        animate={{
          fill: w > 0 ? muscleFill(isActive ? Math.min(1, w + 0.25) : w) : isActive ? MUSCLE_IDLE_HOVER : MUSCLE_IDLE,
          stroke: isActive ? ACID : w > 0 ? muscleFill(Math.min(1, w + 0.2)) : OUTLINE,
          strokeWidth: isActive ? 4 : 1.5,
        }}
        transition={tr}
        style={{ cursor: 'pointer' }}
        {...handlers(k)}
      />
    )
  }

  const lit = [...base.map((k) => [k, effBase(k)] as const), ...overlays.map((k) => [k, effOverlay(k)] as const)]

  return (
    <svg viewBox={v.viewBox.join(' ')} className="block h-auto w-full touch-manipulation select-none" aria-hidden>
      <path d={v.body} fill={SILHOUETTE} stroke={OUTLINE} strokeWidth={1.5} />
      {/* soft glow under trained muscles */}
      <g filter={`url(#${glowId})`} style={{ pointerEvents: 'none' }}>
        {lit.map(([k, w]) => (
          <motion.path key={k} d={v.parts[k]} fill={ACID} initial={false} animate={{ opacity: w * 0.55 }} transition={tr} />
        ))}
      </g>
      {base.map((k) => shape(k, effBase(k)))}
      {overlays.map((k) => shape(k, effOverlay(k)))}
    </svg>
  )
}

export function MuscleMap({
  weights,
  view = 'both',
  highlight,
  onHover,
  className = '',
  detail,
}: {
  weights: Partial<Record<MuscleKey, number>>
  view?: 'front' | 'back' | 'both'
  highlight?: MuscleKey | null
  onHover?: (k: MuscleKey | null) => void
  className?: string
  /** tooltip / label second line for a muscle; defaults to the "primary" / "assisting" labels */
  detail?: (k: MuscleKey) => string
}) {
  const uid = useId().replace(/:/g, '')
  const glowId = `mm-glow-${uid}`
  const box = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<MuscleKey | null>(null)
  // pointer position (mouse only) → tooltip; null for taps
  const [pos, setPos] = useState<{ x: number; y: number; w: number } | null>(null)

  const active = hover ?? highlight ?? null
  const sides: Side[] = view === 'both' ? ['front', 'back'] : [view]

  const setActive = (k: MuscleKey | null, e?: RPointerEvent) => {
    if (k !== hover) onHover?.(k)
    setHover(k)
    if (k && e && box.current) {
      const r = box.current.getBoundingClientRect()
      setPos({ x: e.clientX - r.left, y: e.clientY - r.top, w: r.width })
    } else setPos(null)
  }

  const label = useMemo(() => summarize(weights), [weights])
  const describe = (k: MuscleKey) => (detail ? detail(k) : defaultDetail(clamp01(weights[k])))
  const showTooltip = !TOUCH && hover && pos

  return (
    <div className={`relative ${className}`}>
      <div
        ref={box}
        role="img"
        aria-label={label}
        className="relative"
        onPointerLeave={() => !TOUCH && hover && setActive(null)}
      >
        {/* glow filter shared by both figures */}
        <svg width="0" height="0" className="absolute" aria-hidden>
          <defs>
            <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="14" />
            </filter>
          </defs>
        </svg>
        <div className={`grid gap-1 ${sides.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {sides.map((s) => (
            <figure key={s} className="relative m-0 min-w-0">
              <Figure side={s} weights={weights} active={active} setActive={setActive} glowId={glowId} />
              <figcaption className="mt-1 text-center font-mono text-[10px] tracking-[0.2em] text-dim">
                {SIDE_LABEL[s][0]} · {SIDE_LABEL[s][1]}
              </figcaption>
            </figure>
          ))}
        </div>

        <AnimatePresence>
          {showTooltip && (
            <motion.div
              key="tip"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="pointer-events-none absolute z-20 whitespace-nowrap rounded-lg border border-line-2 bg-ink/90 px-2.5 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur"
              style={{
                left: Math.min(Math.max(pos.x, 64), Math.max(64, pos.w - 64)),
                top: pos.y - 14,
                translate: '-50% -100%',
              }}
            >
              <div className="text-xs font-semibold text-fg">{MUSCLE_KEY_ZH[hover]}</div>
              <div className={`text-[11px] ${clamp01(weights[hover]) > 0 ? 'text-acid' : 'text-dim'}`}>{describe(hover)}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* touch: selected muscle label under the figure (keeps its height so nothing jumps) */}
      {TOUCH && (
        <div className="mt-2 flex h-7 items-center justify-center" aria-live="polite">
          <AnimatePresence mode="wait">
            {active ? (
              <motion.div
                key={active}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="chip border-line-2 bg-ink-2"
              >
                <span className="font-semibold text-fg">{MUSCLE_KEY_ZH[active]}</span>
                <span className={clamp01(weights[active]) > 0 ? 'text-acid' : 'text-dim'}>{describe(active)}</span>
              </motion.div>
            ) : (
              <motion.span key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[11px] text-dim">
                点按肌肉查看名称
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

const fmtSets = (n: number) => `${Math.round(n * 2) / 2}`.replace(/\.0$/, '')

/**
 * Weekly volume heat-map: sums weight × sets per muscle, colours by share of the busiest
 * muscle, and ranks the top five (sub-regions folded into their parent for the list).
 */
export function MuscleVolumeMap({
  entries,
  title = '本周训练量分布',
}: {
  entries: { weights: Partial<Record<MuscleKey, number>>; sets: number }[]
  title?: string
}) {
  const [hover, setHover] = useState<MuscleKey | null>(null)

  const { totals, norm, max, ranked } = useMemo(() => {
    const totals: Weights = {}
    const rolled: Weights = {}
    for (const { weights, sets } of entries) {
      if (!(sets > 0)) continue
      const per: Weights = {}
      for (const [k, w] of Object.entries(weights) as [MuscleKey, number][]) {
        if (!(w > 0)) continue
        totals[k] = (totals[k] ?? 0) + w * sets
        const r = MUSCLE_ROLLUP[k] ?? k
        per[r] = Math.max(per[r] ?? 0, w)
      }
      for (const [k, w] of Object.entries(per) as [MuscleKey, number][]) rolled[k] = (rolled[k] ?? 0) + w * sets
    }
    const max = Math.max(0, ...Object.values(totals))
    const norm: Weights = {}
    if (max > 0) for (const [k, v] of Object.entries(totals) as [MuscleKey, number][]) norm[k] = Math.pow(v / max, 1.4) // a touch of contrast between busy and light muscles
    const ranked = (Object.entries(rolled) as [MuscleKey, number][]).sort((a, b) => b[1] - a[1]).slice(0, 5)
    return { totals, norm, max, ranked }
  }, [entries])

  const top = ranked[0]?.[1] ?? 0
  const rolledOf = (k: MuscleKey) => ranked.find(([r]) => r === (MUSCLE_ROLLUP[k] ?? k))?.[1]

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-display text-base font-semibold text-fg">{title}</h3>
        <span className="kicker whitespace-nowrap">{entries.reduce((s, e) => s + (e.sets > 0 ? e.sets : 0), 0)} 组 · {entries.length} 个动作</span>
      </div>

      <div className="mt-4 grid grid-cols-1 items-start gap-5 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="mx-auto w-full max-w-[360px]">
          <MuscleMap
            weights={norm}
            highlight={hover}
            onHover={setHover}
            detail={(k) => {
              const t = totals[k] ?? rolledOf(k) ?? 0
              return t > 0 ? `${fmtSets(t)} 组有效训练` : '本周未训练'
            }}
          />
          {/* legend */}
          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-mute">
              <span>每周有效组数</span>
              <span className="flex items-center gap-1.5 text-dim">
                <span className="inline-block size-2.5 rounded-sm border border-line-2" style={{ background: MUSCLE_IDLE }} />
                未训练
              </span>
            </div>
            <div className="h-2 rounded-full" style={{ background: `linear-gradient(90deg, ${muscleFill(0.01)}, ${muscleFill(0.5)}, ${ACID})`, boxShadow: '0 0 12px rgba(200,255,61,0.18)' }} />
            <div className="mt-1 flex justify-between font-mono text-[10px] text-dim">
              <span>低</span>
              <span>{max > 0 ? `${fmtSets(max)} 组` : '高'}</span>
            </div>
          </div>
        </div>

        <div>
          <div className="kicker mb-2">训练最多的肌群</div>
          {ranked.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-dim">本周还没有训练记录</p>
          ) : (
            <ol className="space-y-1">
              {ranked.map(([k, v], i) => {
                const on = hover === k || (hover && MUSCLE_ROLLUP[hover] === k)
                return (
                  <li
                    key={k}
                    onPointerEnter={() => setHover(k)}
                    onPointerLeave={() => setHover(null)}
                    className={`relative flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors ${on ? 'bg-panel-2' : ''}`}
                  >
                    <span className={`w-4 font-mono text-xs ${i === 0 ? 'text-acid' : 'text-dim'}`}>{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm text-fg">{MUSCLE_KEY_ZH[k]}</span>
                        <span className="shrink-0 font-mono text-xs text-mute">
                          <span className="text-fg">{fmtSets(v)}</span> 组
                        </span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-line">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: muscleFill(v / top) }}
                          initial={{ width: 0 }}
                          animate={{ width: `${(v / top) * 100}%` }}
                          transition={{ duration: 0.7, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                        />
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-dim">主练肌群每组计 1 组，辅助肌群计 0.5 组。</p>
        </div>
      </div>
    </section>
  )
}
