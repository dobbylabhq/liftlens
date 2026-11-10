import { useEffect, useState } from 'react'
import { animate, motion, useMotionValue, useMotionValueEvent } from 'motion/react'
import { ExternalLink, BadgeCheck, CircleHelp } from 'lucide-react'
import { SOURCE_BY_ID } from '../lib/coaches'
import type { Finding, Severity } from '../lib/types'

export const SEV: Record<Severity, { label: string; text: string; bg: string; dot: string }> = {
  bad: { label: '需要修正', text: 'text-bad', bg: 'bg-bad/10 border-bad/30', dot: 'bg-bad' },
  warn: { label: '注意', text: 'text-warn', bg: 'bg-warn/10 border-warn/30', dot: 'bg-warn' },
  good: { label: '达标', text: 'text-good', bg: 'bg-good/5 border-good/20', dot: 'bg-good' },
  info: { label: '说明', text: 'text-info', bg: 'bg-info/5 border-info/20', dot: 'bg-info' },
}

export function ScoreRing({ score, size = 120, label = '动作分' }: { score: number; size?: number; label?: string }) {
  const mv = useMotionValue(0)
  const [v, setV] = useState(0)
  useMotionValueEvent(mv, 'change', (x) => setV(Math.round(x)))
  useEffect(() => {
    const c = animate(mv, score, { duration: 1.2, ease: [0.16, 1, 0.3, 1] })
    return () => c.stop()
  }, [mv, score])
  const r = 52
  const C = 2 * Math.PI * r
  const color = score >= 80 ? '#4ade80' : score >= 60 ? '#ffb84d' : '#ff5c7a'
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#252d29" strokeWidth="8" />
        <motion.circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={C}
          initial={{ strokeDashoffset: C }}
          animate={{ strokeDashoffset: C * (1 - score / 100) }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-3xl font-semibold tabular-nums" style={{ color }}>
          {v}
        </span>
        <span className="text-[10px] text-dim">{label}</span>
      </div>
    </div>
  )
}

export function SourceChip({ id }: { id: string }) {
  const s = SOURCE_BY_ID[id]
  if (!s) return <span className="chip text-dim">{id}</span>
  return (
    <a
      href={s.url}
      target="_blank"
      rel="noreferrer"
      title={`${s.title}\n${s.authors} (${s.year})\n${s.takeaway}`}
      className="group chip h-8 gap-1 font-mono sm:h-6 text-[10.5px] transition-colors hover:border-cyan/50 hover:text-cyan"
    >
      {s.verified ? <BadgeCheck size={11} className="text-cyan" /> : <CircleHelp size={11} className="text-warn" />}
      {id}
      <ExternalLink size={10} className="opacity-0 transition-opacity group-hover:opacity-100" />
    </a>
  )
}

export function FindingCard({ f, index = 0, onRep }: { f: Finding; index?: number; onRep?: (rep: number) => void }) {
  const s = SEV[f.severity]
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}
      className={`rounded-2xl border p-4 ${s.bg}`}
    >
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <div className="font-semibold">{f.title}</div>
            <div className="flex items-baseline gap-2 font-mono text-xs">
              {f.value != null && (
                <span className={s.text}>
                  {f.value}
                  {f.unit ? ` ${f.unit}` : ''}
                </span>
              )}
              {f.target && <span className="text-dim">目标 {f.target}</span>}
            </div>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-mute">{f.detail}</p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {f.reps?.map((r) => (
              <button key={r} onClick={() => onRep?.(r)} className="chip h-6 border-acid/40 text-acid hover:bg-acid/10">
                第 {r} 次 ▶
              </button>
            ))}
            {f.sourceIds.map((id) => (
              <SourceChip key={id} id={id} />
            ))}
            <span className="ml-auto flex items-center gap-1.5 text-[10px] text-dim" title="关键点可见度：被杠铃片遮挡时会降低">
              置信度
              <span className="relative h-1 w-12 overflow-hidden rounded-full bg-line">
                <motion.span
                  className={`absolute inset-y-0 left-0 ${f.confidence < 0.6 ? 'bg-warn' : 'bg-cyan'}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.round(f.confidence * 100)}%` }}
                  transition={{ delay: 0.2 + index * 0.05, duration: 0.6 }}
                />
              </span>
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 p-10 text-center">
      <div className="font-display text-xl font-bold">{title}</div>
      <div className="max-w-md text-sm text-mute">{children}</div>
    </div>
  )
}
