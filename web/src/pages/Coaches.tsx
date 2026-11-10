import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { BadgeCheck, CircleHelp, ExternalLink, FileCode2 } from 'lucide-react'
import { COACHES, SOURCES } from '../lib/coaches'
import { LIFTS } from '../lib/lifts'
import { SourceChip } from '../components/bits'
import type { LiftId } from '../lib/types'

const KIND: Record<string, string> = { rulebook: '官方规则', textbook: '教材', position: '立场声明', study: '研究', review: '综述' }

export default function Coaches() {
  const [open, setOpen] = useState<string | null>(null)
  const [lift, setLift] = useState<LiftId | 'all'>('all')
  const sources = SOURCES.filter((s) => lift === 'all' || s.lifts.includes(lift) || s.lifts.includes('all'))

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="kicker">COACH SKILLS</div>
      <h1 className="font-display mt-1 text-4xl font-bold tracking-tight">教练与文献</h1>
      <p className="mt-3 max-w-2xl text-mute">
        每位教练都是一个 Agent Skill（<code className="font-mono text-cyan">coaches/coach-*/SKILL.md</code>），代表一种流派/机构标准，而不是某个真实人物。
        本地 agent 调用 Claude Code 时加载对应 skill，所有建议都必须引用下方文献库中的 id。
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {COACHES.map((c, i) => (
          <motion.div
            key={c.id}
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="card relative overflow-hidden p-5"
          >
            <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full blur-3xl" style={{ background: `${c.accent}30` }} />
            <div className="relative">
              <div className="text-3xl">{c.flag}</div>
              <div className="font-display mt-2 text-xl font-bold" style={{ color: c.accent }}>
                {c.displayName}
              </div>
              <div className="text-xs text-dim">{c.region}</div>
              <p className="mt-3 text-sm text-mute">{c.description}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                <span className="chip">{c.school}</span>
                <span className="chip">语气：{c.tone}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {c.sourceIds.map((s) => (
                  <SourceChip key={s} id={s} />
                ))}
              </div>
              <button onClick={() => setOpen(open === c.id ? null : c.id)} className="mt-4 flex min-h-11 items-center gap-1.5 font-mono text-xs text-mute hover:text-fg">
                <FileCode2 size={13} /> {c.id}/SKILL.md {open === c.id ? '▲' : '▼'}
              </button>
              <AnimatePresence>
                {open === c.id && (
                  <motion.pre
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-ink-2 p-3 font-mono text-[11px] leading-relaxed text-mute"
                  >
                    {c.body.trim()}
                  </motion.pre>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="mt-14 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="kicker">SOURCES</div>
          <h2 className="font-display mt-1 text-3xl font-bold tracking-tight">评测标准的出处</h2>
          <p className="mt-2 text-sm text-mute">
            <BadgeCheck size={13} className="inline text-cyan" /> 已核实原文 / PubMed / 出版社页面　<CircleHelp size={13} className="inline text-warn" /> 机构存在但细节未逐条核实
          </p>
        </div>
        <div className="flex gap-1 rounded-full border border-line bg-ink-2 p-1">
          {(['all', 'bench', 'squat', 'deadlift'] as const).map((l) => (
            <button key={l} onClick={() => setLift(l)} className={`relative h-10 rounded-full px-4 text-sm sm:h-8 ${lift === l ? 'text-acid-ink' : 'text-mute'}`}>
              {lift === l && <motion.span layoutId="slift" className="absolute inset-0 rounded-full bg-acid" />}
              <span className="relative">{l === 'all' ? '全部' : LIFTS[l].name}</span>
            </button>
          ))}
        </div>
      </div>
      <motion.div layout className="mt-6 divide-y divide-line overflow-hidden rounded-2xl border border-line">
        <AnimatePresence initial={false}>
          {sources.map((s) => (
            <motion.a
              layout
              key={s.id}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="group grid grid-cols-1 gap-2 bg-panel p-4 transition-colors hover:bg-panel-2 md:grid-cols-[180px_minmax(0,1fr)_auto]"
            >
              <div className="font-mono text-xs">
                <div className="flex items-center gap-1.5 text-cyan">
                  {s.verified ? <BadgeCheck size={12} /> : <CircleHelp size={12} className="text-warn" />}
                  {s.id}
                </div>
                <div className="mt-1 text-dim">
                  {KIND[s.kind]} · {s.year}
                </div>
              </div>
              <div>
                <div className="text-sm font-semibold">{s.title}</div>
                <div className="text-xs text-dim">{s.authors}</div>
                <div className="mt-1 text-sm text-mute">{s.takeaway}</div>
              </div>
              <ExternalLink size={14} className="text-dim transition-colors group-hover:text-cyan" />
            </motion.a>
          ))}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
