import { lazy, Suspense, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Camera, Eye, Move3d, MoveVertical, Ruler, ScanEye } from 'lucide-react'
import { LIFTS, REGION_LABEL, type RegionId } from '../lib/lifts'
import type { AngleId, LiftId } from '../lib/types'

const TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

// three.js is ~600KB — only load it on this step
const Lifter3D = lazy(() => import('./three/Lifter3D'))

const PRIORITY_LABEL = { primary: '必拍', secondary: '推荐', optional: '可选' }

/**
 * Shooting plan: an orbiting 3D lifter with the recommended cameras placed at their real
 * height / distance; the panel on the right lists what each camera must see and lights the
 * corresponding muscles / joints up on the model.
 */
export function CameraGuide({
  lift,
  selected,
  onSelect,
  uploaded = [],
}: {
  lift: LiftId
  selected: AngleId
  onSelect: (a: AngleId) => void
  uploaded?: AngleId[]
}) {
  const def = LIFTS[lift]
  const current = def.angles.find((a) => a.id === selected) ?? def.angles[0]
  const [mode, setMode] = useState<'orbit' | 'camera'>('orbit')
  const [hover, setHover] = useState<number | null>(null)
  const [pinned, setPinned] = useState<number | null>(null)

  const active = useMemo(() => [...new Set(current.reveals.flatMap((r) => r.regions))], [current])
  const focusIdx = hover ?? pinned
  const focus = focusIdx != null ? (current.reveals[focusIdx]?.regions ?? []) : []

  const select = (id: AngleId) => {
    onSelect(id)
    setMode('camera') // turn the model to what this camera sees
    setPinned(null)
    setHover(null)
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      {/* left: 3D */}
      <div className="card relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between p-4">
          <span className="kicker">机位 3D 预览 · {def.name}</span>
          <span className="kicker text-acid">{mode === 'camera' ? `${current.label}机位看到的画面` : (TOUCH ? '单指旋转 · 双指缩放' : '拖动旋转 · 滚轮缩放')}</span>
        </div>
        <div className="aspect-[4/3.3] w-full lg:aspect-auto lg:h-full lg:min-h-[460px]">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-dim">
                <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.4 }}>
                  加载 3D 场景…
                </motion.span>
              </div>
            }
          >
            <Lifter3D lift={lift} angles={def.angles} selected={current.id} onSelect={select} active={active} focus={focus} mode={mode} />
          </Suspense>
        </div>
        <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center p-3">
          <div className="flex gap-1 rounded-full border border-line bg-ink/80 p-1 backdrop-blur">
            {(
              [
                ['orbit', <Move3d size={13} />, '环绕查看'],
                ['camera', <ScanEye size={13} />, '从该机位看'],
              ] as const
            ).map(([m, icon, label]) => (
              <button key={m} onClick={() => setMode(m)} className={`relative flex h-8 items-center gap-1.5 rounded-full px-3 text-xs ${mode === m ? 'text-acid-ink' : 'text-mute hover:text-fg'}`}>
                {mode === m && <motion.span layoutId="view-mode" className="absolute inset-0 rounded-full bg-acid" />}
                <span className="relative flex items-center gap-1.5">
                  {icon}
                  {label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* right: per-camera focus */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {def.angles.map((a) => (
            <button key={a.id} onClick={() => select(a.id)} className={`chip h-8 px-3 transition-colors ${a.id === current.id ? 'border-acid text-acid' : 'hover:text-fg'}`}>
              <Camera size={12} /> {a.label}
              <span className={a.priority === 'primary' ? 'text-acid' : a.priority === 'secondary' ? 'text-cyan' : 'text-dim'}>· {PRIORITY_LABEL[a.priority]}</span>
              {uploaded.includes(a.id) && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-good" />}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={lift + current.id}
            initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col gap-4"
          >
            <div className="card p-4">
              <div className="kicker mb-3 flex items-center gap-1.5">
                <Eye size={12} /> 这个机位要看的部位
                <span className="ml-auto normal-case tracking-normal text-dim">{TOUCH ? '点一下' : '悬停或点击'}，在 3D 模型上高亮</span>
              </div>
              <ul className="space-y-1.5" onMouseLeave={() => setHover(null)}>
                {current.reveals.map((r, i) => {
                  const on = focusIdx === i
                  return (
                    <motion.li
                      key={r.text}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.05 * i + 0.05 }}
                      onMouseEnter={() => setHover(i)}
                      onClick={() => setPinned(pinned === i ? null : i)}
                      className={`cursor-pointer rounded-xl border p-3 transition-colors ${on ? 'border-acid/60 bg-acid/10' : 'border-line hover:border-line-2'}`}
                    >
                      <div className="flex items-start gap-2 text-sm">
                        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${on ? 'bg-acid shadow-[0_0_8px_#c8ff3d]' : 'bg-line-2'}`} />
                        <span className={on ? 'text-fg' : ''}>{r.text}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1 pl-3.5">
                        {r.regions.map((g: RegionId) => (
                          <span key={g} className={`rounded-full px-2 py-0.5 text-[10.5px] ${on ? 'bg-acid text-acid-ink' : 'bg-panel-2 text-mute'}`}>
                            {REGION_LABEL[g]}
                          </span>
                        ))}
                      </div>
                    </motion.li>
                  )
                })}
              </ul>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Fact icon={<MoveVertical size={14} />} label="镜头高度" value={current.height} />
              <Fact icon={<Ruler size={14} />} label="距离" value={current.distance} />
            </div>
            <p className="text-xs text-dim">
              {current.id === 'side'
                ? '侧面视角最适合测量深度、触胸点和杠铃轨迹，程序判定以这个机位为主。'
                : '这个机位的 2D 画面有透视，程序以次数 / 左右对称为主，细节交给 agent 看关键帧。'}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="card p-3">
      <div className="kicker mb-1 flex items-center gap-1.5">
        {icon}
        {label}
      </div>
      <div className="text-sm">{value}</div>
    </div>
  )
}
