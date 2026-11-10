import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Crosshair, ScanText, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { grabFrame } from '../lib/pose'
import { sampleSeed, type BarSeed } from '../lib/barTracker'
import { readWeights, snapPlate, type OcrResult } from '../lib/ocr'

type Mode = 'bar' | 'ocr'

/**
 * Shows one still from the clip. Two tools:
 *  - bar: click the coloured marker on the plate → seed for the colour tracker
 *  - ocr: drag a box over the number on a plate → Tesseract reads it
 */
export function FramePicker({
  file,
  seed,
  onSeed,
  onPlate,
}: {
  file: File
  seed: BarSeed | null
  onSeed: (s: BarSeed | null) => void
  onPlate: (kg: number) => void
}) {
  const [t, setT] = useState(0.5)
  const [dur, setDur] = useState(1)
  const [mode, setMode] = useState<Mode>('bar')
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [ocr, setOcr] = useState<OcrResult | null>(null)
  const [busy, setBusy] = useState(false)
  const view = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const v = document.createElement('video')
    v.src = URL.createObjectURL(file)
    v.onloadedmetadata = () => {
      setDur(v.duration)
      URL.revokeObjectURL(v.src)
    }
  }, [file])

  useEffect(() => {
    let alive = true
    grabFrame(file, t, 1280).then((c) => alive && setCanvas(c))
    return () => {
      alive = false
    }
  }, [file, t])

  useEffect(() => {
    const v = view.current
    if (!v || !canvas) return
    v.width = canvas.width
    v.height = canvas.height
    v.getContext('2d')!.drawImage(canvas, 0, 0)
  }, [canvas])

  const norm = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }

  const onDown = (e: React.PointerEvent) => {
    if (!canvas) return
    const p = norm(e)
    if (mode === 'bar') {
      const s = sampleSeed(canvas, p.x, p.y, t)
      if (s.s < 0.3) toast.warning('这个点颜色不够鲜艳，追踪可能不稳定。最好选杠铃片中心的彩色标记。')
      onSeed(s)
    } else {
      ;(e.target as Element).setPointerCapture(e.pointerId)
      setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
      setOcr(null)
    }
  }
  const onMove = (e: React.PointerEvent) => {
    if (mode !== 'ocr' || !drag) return
    const p = norm(e)
    setDrag({ ...drag, x1: p.x, y1: p.y })
  }
  const onUp = async () => {
    if (mode !== 'ocr' || !drag || !canvas) return
    const rect = {
      x: Math.min(drag.x0, drag.x1) * canvas.width,
      y: Math.min(drag.y0, drag.y1) * canvas.height,
      w: Math.abs(drag.x1 - drag.x0) * canvas.width,
      h: Math.abs(drag.y1 - drag.y0) * canvas.height,
    }
    if (rect.w < 12 || rect.h < 8) return setDrag(null)
    setBusy(true)
    try {
      setOcr(await readWeights(canvas, rect))
    } catch (err) {
      toast.error(`OCR 失败：${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const hsl = seed ? `hsl(${seed.h} ${Math.round(seed.s * 100)}% ${Math.round(seed.v * 50)}%)` : undefined

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['bar', <Crosshair size={14} />, '点选杠铃标记'],
            ['ocr', <ScanText size={14} />, '框选重量数字 (OCR)'],
          ] as const
        ).map(([m, icon, label]) => (
          <button key={m} onClick={() => setMode(m)} className={`chip relative h-8 px-3 ${mode === m ? 'text-acid border-acid' : 'hover:text-fg'}`}>
            {icon}
            {label}
          </button>
        ))}
        {seed && (
          <button onClick={() => onSeed(null)} className="chip h-8 hover:text-fg">
            <span className="h-3 w-3 rounded-full ring-1 ring-white/30" style={{ background: hsl }} /> 已选标记 <X size={12} />
          </button>
        )}
      </div>

      <div
        ref={box}
        className={`relative overflow-hidden rounded-xl border border-line bg-ink-2 ${mode === 'bar' ? 'cursor-crosshair' : 'cursor-cell'} touch-none select-none`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        <canvas ref={view} className="block h-auto w-full" />
        {!canvas && <div className="aspect-video animate-pulse bg-panel-2" />}
        <AnimatePresence>
          {seed && (
            <motion.div
              key={`${seed.x}-${seed.y}`}
              initial={{ scale: 2.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 18 }}
              className="pointer-events-none absolute h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-acid shadow-[0_0_0_4px_rgba(200,255,61,0.25)]"
              style={{ left: `${seed.x * 100}%`, top: `${seed.y * 100}%` }}
            />
          )}
        </AnimatePresence>
        {drag && mode === 'ocr' && (
          <div
            className="pointer-events-none absolute border-2 border-cyan bg-cyan/10"
            style={{
              left: `${Math.min(drag.x0, drag.x1) * 100}%`,
              top: `${Math.min(drag.y0, drag.y1) * 100}%`,
              width: `${Math.abs(drag.x1 - drag.x0) * 100}%`,
              height: `${Math.abs(drag.y1 - drag.y0) * 100}%`,
            }}
          >
            {busy && <Loader2 className="absolute right-1 top-1 animate-spin text-cyan" size={14} />}
          </div>
        )}
      </div>

      <input
        type="range"
        min={0}
        max={Math.max(0.1, dur - 0.1)}
        step={0.1}
        value={t}
        onChange={(e) => setT(Number(e.target.value))}
        className="w-full accent-[#c8ff3d]"
        aria-label="选择画面时间"
      />
      <div className="flex justify-between font-mono text-[11px] text-dim">
        <span>{t.toFixed(1)}s</span>
        <span>{mode === 'bar' ? '拖动找到杠铃片最清楚的一帧，点击中心的彩色标记' : '拖动框住杠铃片上印的数字，例如 “20 KG”'}</span>
      </div>

      <AnimatePresence>
        {ocr && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="card overflow-hidden p-3 text-sm">
            <div className="kicker mb-2">OCR 结果 · 置信度 {Math.round(ocr.confidence)}%</div>
            <div className="mb-2 font-mono text-xs text-mute">“{ocr.text || '（没有识别到文字）'}”</div>
            <div className="flex flex-wrap gap-2">
              {ocr.numbers.map((n, i) => {
                const kg = ocr.unit === 'lb' ? Math.round(n * 0.4536 * 4) / 4 : n
                return (
                  <button key={i} onClick={() => onPlate(snapPlate(kg))} className="chip h-8 border-acid/50 text-acid hover:bg-acid hover:text-acid-ink">
                    + 每侧 {snapPlate(kg)} kg {ocr.unit === 'lb' && <span className="text-dim">({n} lb)</span>}
                  </button>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
