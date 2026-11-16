import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useDragControls, type PanInfo } from 'motion/react'
import { ChevronUp, Loader2, Play, Plus, Search, SearchX, Video, X } from 'lucide-react'
import { ExercisePreview } from './ExercisePreview'
import type { ExerciseInfo } from '../lib/movement/types'
import { BIG3_IDS, BODY_PART_ZH, COMMON_IDS, EQUIPMENT_ZH, equipmentZh, loadExercises, muscleZh, searchExercises } from '../lib/exercises'

const PAGE = 60 // Items rendered per batch; more are added on reaching the bottom
const BODY_PART_ORDER = ['chest', 'back', 'shoulders', 'upper legs', 'upper arms', 'waist', 'lower legs', 'lower arms', 'cardio', 'neck']
const isDesktop = () => typeof matchMedia !== 'undefined' && matchMedia('(min-width: 641px)').matches

/**
 * Exercise picker: a full-screen bottom sheet on mobile (swipe down to close), a centered dialog on desktop.
 * The search / filter / list part is ExerciseBrowser, which pages can also embed inline.
 * The library is lazy-loaded on demand; search matches Chinese / English / partial words; ↑↓ Enter for keyboard selection.
 */
export function ExercisePicker({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (ex: ExerciseInfo) => void }) {
  if (typeof document === 'undefined') return null
  return createPortal(<AnimatePresence>{open && <Sheet key="exercise-picker" onClose={onClose} onSelect={onSelect} />}</AnimatePresence>, document.body)
}

function Sheet({ onClose, onSelect }: { onClose: () => void; onSelect: (ex: ExerciseInfo) => void }) {
  const desktop = useMemo(isDesktop, [])
  const dragControls = useDragControls()

  // Lock page scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Esc closes regardless of focus
  useEffect(() => {
    const h = (ev: globalThis.KeyboardEvent) => ev.key === 'Escape' && onClose()
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <motion.div
        className="absolute inset-0 bg-black/65 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        aria-hidden
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="选择动作"
        className="relative flex h-[calc(100dvh-env(safe-area-inset-top)-12px)] w-full min-w-0 flex-col overflow-hidden rounded-t-2xl border border-line bg-panel shadow-2xl sm:h-[min(760px,86dvh)] sm:max-w-xl sm:rounded-2xl"
        initial={desktop ? { opacity: 0, y: 16, scale: 0.98 } : { y: '100%' }}
        animate={desktop ? { opacity: 1, y: 0, scale: 1 } : { y: 0 }}
        exit={desktop ? { opacity: 0, y: 10, scale: 0.98 } : { y: '100%' }}
        transition={{ type: 'tween', ease: [0.16, 1, 0.3, 1], duration: desktop ? 0.22 : 0.36 }}
        drag={desktop ? false : 'y'}
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.8 }}
        onDragEnd={onDragEnd}
      >
        {/* Header: on mobile the whole block can be swiped down to close */}
        <div className="shrink-0 touch-none px-4 pt-2 sm:pt-4" onPointerDown={(e) => !desktop && dragControls.start(e)}>
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line-2 sm:hidden" aria-hidden />
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="kicker">EXERCISE LIBRARY</div>
              <h2 className="font-display text-lg font-bold tracking-tight">选择动作</h2>
            </div>
            <button aria-label="关闭" onClick={onClose} className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-mute hover:bg-panel-2 hover:text-fg">
              <X size={20} />
            </button>
          </div>
        </div>
        <ExerciseBrowser
          autoFocusDelay={desktop ? 0 : 280}
          onPick={(e) => {
            onSelect(e)
            onClose()
          }}
          listClassName="min-h-0 flex-1 pb-[env(safe-area-inset-bottom)]"
        />
      </motion.div>
    </div>
  )
}

/**
 * Search box + body-part / equipment filters + exercise list. Used inside the picker sheet and inline
 * on the training plan page (where picking adds an exercise and the browser stays open for the next one).
 */
export function ExerciseBrowser({
  onPick,
  autoFocusDelay,
  listClassName,
  className = 'flex min-h-0 flex-1 flex-col',
  collapsible = false,
}: {
  onPick: (ex: ExerciseInfo) => void
  /** inline use: only the search box until it's focused / typed in; folds back up after a pick */
  collapsible?: boolean
  /** focus the search box after this many ms; omit to leave focus alone */
  autoFocusDelay?: number
  /** sizing of the scrolling list, e.g. `max-h-96` inline or `flex-1` in a sheet */
  listClassName: string
  className?: string
}) {
  const [list, setList] = useState<ExerciseInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [bodyPart, setBodyPart] = useState<string | undefined>()
  const [equipment, setEquipment] = useState<string | undefined>()
  const [analyzableOnly, setAnalyzableOnly] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [active, setActive] = useState(0)
  /** row whose movement preview is expanded */
  const [open, setOpen] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(!collapsible)
  const pick = (e: ExerciseInfo) => {
    if (collapsible) {
      setQuery('')
      setOpen(null)
      setExpanded(false)
      inputRef.current?.blur()
    }
    onPick(e)
  }
  const toggle = (id: string) => setOpen((o) => (o === id ? null : id))
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const load = useCallback(() => {
    setError(null)
    loadExercises()
      .then(setList)
      .catch(() => setError('动作库加载失败，检查网络后重试'))
  }, [])
  useEffect(load, [load])

  useEffect(() => {
    if (autoFocusDelay == null) return
    const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), autoFocusDelay)
    return () => clearTimeout(t)
  }, [autoFocusDelay])

  const deferredQuery = useDeferredValue(query)
  const filtering = !!(deferredQuery.trim() || bodyPart || equipment || analyzableOnly)

  const results = useMemo(
    () => (list ? searchExercises(list, deferredQuery, { bodyPart, equipment, analyzableOnly }) : []),
    [list, deferredQuery, bodyPart, equipment, analyzableOnly],
  )

  const common = useMemo(() => {
    if (!list) return []
    const map = new Map(list.map((e) => [e.id, e]))
    return [BIG3_IDS.bench, BIG3_IDS.squat, BIG3_IDS.deadlift, ...COMMON_IDS].map((id) => map.get(id)).filter((e): e is ExerciseInfo => !!e)
  }, [list])

  // Sort equipment by count, most common first
  const equipmentOptions = useMemo(() => {
    if (!list) return []
    const n = new Map<string, number>()
    for (const e of list) n.set(e.equipment, (n.get(e.equipment) ?? 0) + 1)
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  }, [list])

  // Flat list for keyboard navigation: with no search = common + all
  const shown = useMemo(() => {
    const rest = results.slice(0, limit)
    return filtering ? rest : [...common, ...rest]
  }, [results, limit, filtering, common])

  useEffect(() => {
    setActive(0)
    setLimit(PAGE)
    listRef.current?.scrollTo({ top: 0 })
  }, [deferredQuery, bodyPart, equipment, analyzableOnly])

  // Render another page on reaching the bottom (no full virtual list needed; paging 1300 items is smooth enough)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !listRef.current) return
    const io = new IntersectionObserver((es) => es[0]?.isIntersecting && setLimit((l) => l + PAGE), { root: listRef.current, rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [list, results.length, limit, expanded])

  const scrollToActive = (i: number) => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${i}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }

  const onKeyDown = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      if (!shown.length) return
      ev.preventDefault()
      const next = Math.max(0, Math.min(shown.length - 1, active + (ev.key === 'ArrowDown' ? 1 : -1)))
      if (next >= limit - 5 && results.length > limit) setLimit((l) => l + PAGE)
      setActive(next)
      requestAnimationFrame(() => scrollToActive(next))
    } else if (ev.key === 'Enter' && !ev.nativeEvent.isComposing) {
      const e = shown[active]
      if (e) {
        ev.preventDefault()
        pick(e)
      }
    }
  }

  const clearFilters = () => {
    setBodyPart(undefined)
    setEquipment(undefined)
    setAnalyzableOnly(false)
  }

  const optionId = (i: number) => `${listId}-opt-${i}`
  const commonCount = filtering ? 0 : common.length

  return (
    <div className={className}>
      <div className="relative shrink-0 border-b border-line px-4 pb-3 pt-2">
        <Search size={16} className="pointer-events-none absolute left-7 top-[calc(50%-2px)] -translate-y-1/2 text-dim" />
        <input
          ref={inputRef}
          className="input pl-9 pr-10 text-base sm:text-sm"
          placeholder="搜索：卧推、哑铃弯举、row、rdl…"
          value={query}
          onChange={(e) => (setQuery(e.target.value), setExpanded(true))}
          onFocus={() => setExpanded(true)}
          onKeyDown={onKeyDown}
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={shown.length ? optionId(active) : undefined}
        />
        {query && (
          <button aria-label="清空搜索" onClick={() => (setQuery(''), inputRef.current?.focus())} className="absolute right-4 top-2 flex h-11 w-11 items-center justify-center text-dim hover:text-fg">
            <X size={15} />
          </button>
        )}
        {collapsible && expanded && (
          <button type="button" onClick={() => (setExpanded(false), setOpen(null), setQuery(''))} className="mt-2 flex items-center gap-1 text-xs text-dim hover:text-fg">
            <ChevronUp size={13} /> 收起动作库
          </button>
        )}
      </div>
      {expanded && (
      <>

      {/* Filters: two rows of horizontally scrolling chips */}
      <div className="shrink-0 space-y-1.5 border-b border-line py-2">
        <ChipRow>
          <Chip on={analyzableOnly} onClick={() => setAnalyzableOnly((v) => !v)} accent>
            <Video size={12} /> 可视频分析
          </Chip>
          <Chip on={!bodyPart} onClick={() => setBodyPart(undefined)}>
            全部部位
          </Chip>
          {BODY_PART_ORDER.filter((b) => b in BODY_PART_ZH).map((b) => (
            <Chip key={b} on={bodyPart === b} onClick={() => setBodyPart(bodyPart === b ? undefined : b)}>
              {BODY_PART_ZH[b]}
            </Chip>
          ))}
        </ChipRow>
        <ChipRow>
          <Chip on={!equipment} onClick={() => setEquipment(undefined)}>
            全部器械
          </Chip>
          {equipmentOptions.map((q) => (
            <Chip key={q} on={equipment === q} onClick={() => setEquipment(equipment === q ? undefined : q)}>
              {EQUIPMENT_ZH[q] ?? q}
            </Chip>
          ))}
        </ChipRow>
      </div>

      {/* List */}
      <div ref={listRef} id={listId} role="listbox" aria-label="动作" className={`overflow-y-auto overscroll-contain ${listClassName}`}>
        {error ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center text-sm text-mute">
            {error}
            <button className="btn-ghost h-10" onClick={load}>
              重试
            </button>
          </div>
        ) : !list ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-mute">
            <Loader2 size={16} className="animate-spin" /> 加载动作库…
          </div>
        ) : (
          <>
            {!filtering && (
              <>
                <SectionTitle>常用</SectionTitle>
                {common.map((e, i) => (
                  <Row key={`c-${e.id}`} e={e} idx={i} id={optionId(i)} active={active === i} onHover={setActive} onPick={pick} open={open === `c-${e.id}`} onToggle={() => toggle(`c-${e.id}`)} />
                ))}
                <SectionTitle>全部动作 · {results.length}</SectionTitle>
              </>
            )}
            {filtering && results.length > 0 && <SectionTitle>{results.length} 个结果</SectionTitle>}
            {results.slice(0, limit).map((e, j) => {
              const i = commonCount + j
              return <Row key={e.id} e={e} idx={i} id={optionId(i)} active={active === i} onHover={setActive} onPick={pick} open={open === e.id} onToggle={() => toggle(e.id)} />
            })}
            {filtering && results.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
                <SearchX size={28} className="text-dim" />
                <div className="font-semibold">没找到{query.trim() ? `「${query.trim()}」` : '符合条件的动作'}</div>
                <p className="max-w-xs text-sm text-mute">试试更短的词，比如「卧推」「弯举」「row」，或者换个器械 / 部位。</p>
                {(bodyPart || equipment || analyzableOnly) && (
                  <button className="btn-ghost mt-2 h-10" onClick={clearFilters}>
                    清除筛选
                  </button>
                )}
              </div>
            )}
            <div ref={sentinelRef} className="h-px" aria-hidden />
          </>
        )}
      </div>
      </>
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="kicker sticky top-0 z-10 border-b border-line/60 bg-panel/95 px-4 py-2 backdrop-blur">{children}</div>
}

function ChipRow({ children }: { children: ReactNode }) {
  return <div className="flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{children}</div>
}

function Chip({ on, onClick, accent, children }: { on: boolean; onClick: () => void; accent?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`chip h-9 shrink-0 whitespace-nowrap px-3 text-sm transition-colors ${
        on ? 'border-acid/60 bg-acid/10 text-acid' : accent ? 'border-acid/25 text-fg hover:border-acid/50' : 'hover:text-fg'
      }`}
    >
      {children}
    </button>
  )
}

function Row({
  e,
  idx,
  id,
  active,
  onHover,
  onPick,
  open,
  onToggle,
}: {
  e: ExerciseInfo
  idx: number
  id: string
  active: boolean
  onHover: (i: number) => void
  onPick: (e: ExerciseInfo) => void
  open: boolean
  onToggle: () => void
}) {
  return (
    <div className={`border-b border-line/50 ${open ? 'bg-panel-2/60' : ''}`}>
      <div
        id={id}
        data-idx={idx}
        role="option"
        aria-selected={active}
        onClick={() => onPick(e)}
        onMouseMove={() => !active && onHover(idx)}
        className={`flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors ${active ? 'bg-panel-2' : 'hover:bg-panel-2/60'}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-semibold">{e.zh || e.name}</span>
            {e.big3 && <span className="shrink-0 rounded bg-cyan/10 px-1.5 py-px text-[10px] font-semibold text-cyan">三大项</span>}
          </div>
          <div className="truncate font-mono text-[11px] text-dim">{e.name}</div>
          <div className="truncate text-xs text-mute">
            {equipmentZh(e.equipment)} · {muscleZh(e.target)}
          </div>
        </div>
        {e.pattern !== null && (
          <span className="hidden shrink-0 items-center gap-1 rounded-full border border-acid/40 bg-acid/10 px-2 py-0.5 text-[11px] font-semibold text-acid sm:flex">
            <Video size={11} /> 可视频分析
          </span>
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? '收起动作预览' : `看「${e.zh || e.name}」的动作`}
          onClick={(ev) => {
            ev.stopPropagation()
            onToggle()
          }}
          className={`flex h-9 shrink-0 items-center gap-1 rounded-full border px-3 text-xs transition-colors ${open ? 'border-acid/60 text-acid' : 'border-line-2 text-mute hover:text-fg'}`}
        >
          {open ? <ChevronUp size={13} /> : <Play size={12} />} {open ? '收起' : '动作'}
        </button>
      </div>
      {open && (
        <div className="px-4 pb-4 pt-1">
          {e.pattern !== null && (
            <div className="mb-2 flex items-center gap-1 text-[11px] font-semibold text-acid sm:hidden">
              <Video size={11} /> 可视频分析
            </div>
          )}
          <ExercisePreview exercise={e} compact />
          <button type="button" className="btn-acid mt-3 h-10 w-full sm:w-auto" onClick={() => onPick(e)}>
            <Plus size={15} /> 选这个动作
          </button>
        </div>
      )}
    </div>
  )
}
