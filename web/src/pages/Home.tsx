import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { motion, useScroll, useTransform, useInView, animate, useMotionValue, useMotionValueEvent } from 'motion/react'
import { ArrowRight, ScanLine, Crosshair, Type, Bot, Lock } from 'lucide-react'
import { SilhouetteFigure, VolumeFigure } from '../components/figures'
import { LIFTS } from '../lib/lifts'
import { AGENT_CMD } from '../lib/agent'
import { COACHES, SOURCES } from '../lib/coaches'
import type { LiftId } from '../lib/types'

const ease = [0.16, 1, 0.3, 1] as const

function Counter({ to, suffix = '', decimals = 0 }: { to: number; suffix?: string; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const mv = useMotionValue(0)
  const [v, setV] = useState('0')
  useMotionValueEvent(mv, 'change', (x) => setV(x.toFixed(decimals)))
  useEffect(() => {
    if (inView) animate(mv, to, { duration: 1.4, ease })
  }, [inView, mv, to])
  return (
    <span ref={ref} className="tabular-nums">
      {v}
      {suffix}
    </span>
  )
}

function Hero() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  // layer 1: grid drifts slower than content (parallax)
  const gridY = useTransform(scrollYProgress, [0, 1], [0, 120])
  // layer 2: figure scales/fades as you scroll away
  const figScale = useTransform(scrollYProgress, [0, 1], [1, 0.86])
  const figOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0.2])
  const words = ['把每一组', '变成可以', '复盘的数据。']

  return (
    <section ref={ref} className="relative overflow-hidden">
      <motion.div style={{ y: gridY }} className="grid-bg absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      <div className="absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-acid/10 blur-[120px]" />
      <div className="relative mx-auto grid grid-cols-1 max-w-6xl items-center gap-10 px-4 pb-16 pt-14 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] md:pt-24">
        <div>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }} className="chip mb-6 border-acid/40 text-acid">
            <Lock size={12} /> 视频不出本机 · 用你自己的 agent 当教练
          </motion.div>
          <h1 className="font-display text-[44px] leading-[1.02] font-extrabold tracking-tight sm:text-6xl md:text-7xl">
            {words.map((w, i) => (
              <span key={w} className="block overflow-hidden">
                <motion.span
                  className={`block ${i === 2 ? 'text-acid' : ''}`}
                  initial={{ y: '110%' }}
                  animate={{ y: 0 }}
                  transition={{ duration: 0.9, delay: 0.1 + i * 0.09, ease }}
                >
                  {w}
                </motion.span>
              </span>
            ))}
          </h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.8 }} className="mt-6 max-w-lg text-base leading-relaxed text-mute">
            练的时候每组拍一段（或开实时模式边练边数），组间就知道哪里有问题、下一组怎么调。动作库 1300+ 个动作，800 多个能视频计次和检查动作；卧推、深蹲、硬拉还有杠铃追踪和 IPF 规则的深度分析。浏览器里的姿态识别 + 杠铃追踪给出可复现的测量，
            再由你本机的 agent 教练对照 IPF 规则和 NSCA 教材逐条点评，每天的记录都留在本地，随时复盘能力曲线。
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.65, duration: 0.6, ease }} className="mt-8 flex flex-wrap gap-3">
            <Link to="/train" className="btn-acid group">
              开始今天的训练
              <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
            </Link>
            <Link to="/new" className="btn-ghost">
              分析已有视频
            </Link>
            <Link to="/agent" className="btn-ghost">
              连接本地 Agent
            </Link>
          </motion.div>
        </div>

        <motion.div style={{ scale: figScale, opacity: figOpacity }} className="relative">
          <motion.div
            initial={{ opacity: 0, scale: 0.94, rotate: -1.5 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ duration: 1, delay: 0.2, ease }}
            className="card relative overflow-hidden p-4 shadow-[0_40px_120px_-40px_rgba(200,255,61,0.25)]"
          >
            {/* HUD corners */}
            {['left-3 top-3 border-l border-t', 'right-3 top-3 border-r border-t', 'left-3 bottom-3 border-l border-b', 'right-3 bottom-3 border-r border-b'].map((c) => (
              <span key={c} className={`absolute h-4 w-4 border-acid/70 ${c}`} />
            ))}
            <div className="kicker flex justify-between px-2">
              <span>REC ● side · 60fps</span>
              <span className="text-acid">BENCH</span>
            </div>
            <SilhouetteFigure lift="bench" className="h-64 w-full sm:h-80" tempo={2.6} />
            <div className="grid grid-cols-3 gap-2 font-mono text-xs">
              {[
                { k: '触胸点', v: <Counter to={0.34} decimals={2} />, c: 'text-good' },
                { k: '肘 vs 肩', v: <Counter to={0.12} decimals={2} />, c: 'text-good' },
                { k: '下放', v: <Counter to={1.4} decimals={1} suffix="s" />, c: 'text-fg' },
              ].map((m, i) => (
                <motion.div
                  key={m.k}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.9 + i * 0.12, ease }}
                  className="rounded-xl border border-line bg-ink-2 px-3 py-2"
                >
                  <div className="text-dim">{m.k}</div>
                  <div className={`text-lg ${m.c}`}>{m.v}</div>
                </motion.div>
              ))}
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 1.3, duration: 0.7, ease }}
            className="card absolute -bottom-20 -left-6 hidden max-w-[260px] p-3 text-xs shadow-2xl sm:block"
          >
            <div className="mb-1 flex items-center gap-1.5 text-acid">
              <Bot size={12} /> IPF 裁判席
            </div>
            <p className="text-mute">“第 3 次肘未低于肩，按 §4.2 判红灯；其余 4 次白灯。”</p>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}

const STEPS = [
  { icon: ScanLine, title: '姿态识别', lib: 'MediaPipe Pose Landmarker', text: '浏览器端 WASM/WebGL 逐帧提取 33 个关节点，视频不上传。' },
  { icon: Crosshair, title: '杠铃追踪', lib: '颜色块追踪 + Savitzky–Golay', text: '点一下杠铃片上的彩色标记，得到稳定的杠铃轨迹并自动分次。' },
  { icon: Type, title: '重量识别', lib: 'Tesseract.js OCR', text: '框选杠铃片上的数字，自动识别并换算总重量。' },
  { icon: Bot, title: '本地 Agent 教练', lib: 'Claude Code · Agent Skills', text: '你的 claude CLI 读取测量结果和关键帧，按所选流派的 skill 给出带出处的建议。' },
]

function Pipeline() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20">
      <div className="kicker mb-3">HOW IT WORKS</div>
      <h2 className="font-display max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">程序负责“量”，教练负责“判”。两者分开，结论才可复现。</h2>
      <div className="relative mt-12 grid gap-4 md:grid-cols-4">
        <svg className="absolute left-0 right-0 top-9 hidden h-2 w-full md:block" preserveAspectRatio="none" viewBox="0 0 100 2">
          <motion.path
            d="M4 1 H96"
            stroke="#c8ff3d"
            strokeWidth="0.4"
            strokeDasharray="1 1"
            fill="none"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 1.6, ease }}
          />
        </svg>
        {STEPS.map((s, i) => (
          <motion.div
            key={s.title}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ delay: i * 0.12, duration: 0.7, ease }}
            whileHover={{ y: -4 }}
            className="card relative p-5"
          >
            <div className="relative mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-line-2 bg-ink text-acid">
              <s.icon size={20} />
              <span className="absolute -right-2 -top-2 font-mono text-[10px] text-dim">0{i + 1}</span>
            </div>
            <div className="font-display text-lg font-bold">{s.title}</div>
            <div className="mt-1 font-mono text-[11px] text-cyan">{s.lib}</div>
            <p className="mt-3 text-sm leading-relaxed text-mute">{s.text}</p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

function LiftCards() {
  const [hover, setHover] = useState<LiftId | null>(null)
  return (
    <section className="mx-auto max-w-6xl px-4 py-12">
      <div className="grid gap-4 md:grid-cols-3">
        {(Object.keys(LIFTS) as LiftId[]).map((id, i) => (
          <motion.div
            key={id}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1, duration: 0.7, ease }}
            onHoverStart={() => setHover(id)}
            onHoverEnd={() => setHover(null)}
          >
            <Link to={`/new?lift=${id}`} className="card group block overflow-hidden p-5 transition-colors hover:border-acid/50">
              <div className="flex items-baseline justify-between">
                <div className="font-display text-2xl font-bold">{LIFTS[id].name}</div>
                <div className="font-mono text-xs text-dim">{LIFTS[id].en}</div>
              </div>
              <VolumeFigure lift={id} muscles playing={hover === id} className="-mx-4 my-1 h-56 w-[calc(100%+2rem)]" />
              <div className="text-sm text-mute">{LIFTS[id].tagline}</div>
              <div className="mt-3 flex items-center gap-1 text-sm text-acid opacity-0 transition-opacity group-hover:opacity-100">
                分析{LIFTS[id].name} <ArrowRight size={14} />
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

function CoachMarquee() {
  const items = [...COACHES, ...COACHES]
  return (
    <section className="border-y border-line bg-ink-2 py-10">
      <div className="mx-auto mb-6 flex max-w-6xl flex-wrap items-end justify-between gap-4 px-4">
        <div>
          <div className="kicker mb-2">COACH SKILLS</div>
          <h2 className="font-display text-3xl font-bold tracking-tight">不同国家、不同流派的教练视角</h2>
        </div>
        <div className="flex gap-6 font-mono text-sm">
          <div>
            <div className="text-3xl text-acid">
              <Counter to={COACHES.length} />
            </div>
            <div className="text-dim">教练 skill</div>
          </div>
          <div>
            <div className="text-3xl text-acid">
              <Counter to={SOURCES.filter((s) => s.verified).length} />
            </div>
            <div className="text-dim">已核实文献</div>
          </div>
        </div>
      </div>
      <div className="overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
        <div className="marquee flex w-max gap-4 hover:[animation-play-state:paused]">
          {items.map((c, i) => (
            <Link to="/coaches" key={c.id + i} className="card w-72 shrink-0 p-4 transition-colors hover:border-line-2">
              <div className="flex items-center gap-2">
                <span className="text-xl">{c.flag}</span>
                <span className="font-display text-lg font-bold" style={{ color: c.accent }}>
                  {c.displayName}
                </span>
              </div>
              <div className="mt-1 text-xs text-dim">{c.region}</div>
              <div className="mt-3 text-sm text-mute">{c.school}</div>
              <div className="mt-2 font-mono text-[11px] text-dim">{c.id}/SKILL.md</div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

function AgentTerminal() {
  const lines = [
    { t: `$ ${AGENT_CMD}`, c: 'text-fg' },
    { t: '  ✓ Claude Code 已就绪', c: 'text-mute' },
    { t: '  ✓ 已在浏览器打开 LiftLens，自动完成配对', c: 'text-mute' },
    { t: '→ 请教练点评 · IPF 裁判席', c: 'text-cyan' },
    { t: '  读取 测量数据', c: 'text-dim' },
    { t: '  读取 第 3 次到底关键帧', c: 'text-dim' },
    { t: '  ✓ 点评完成  72 分 · 需要打磨', c: 'text-acid' },
  ]
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 md:grid-cols-2">
      <div>
        <div className="kicker mb-3">BRING YOUR OWN AGENT</div>
        <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">网页只是界面，教练跑在你自己的电脑上。</h2>
        <p className="mt-4 text-mute">
          教练点评由你电脑上已经在用的 Claude Code 完成，用的是你自己的订阅，LiftLens 不需要任何模型 key。
          一行命令启动本地 agent，网页自动配对；它只在本机运行，视频和训练记录也一直留在你的浏览器里。
        </p>
        <Link to="/agent" className="btn-ghost mt-6">
          查看连接步骤 <ArrowRight size={14} />
        </Link>
      </div>
      <div className="card overflow-hidden">
        <div className="flex gap-1.5 border-b border-line px-4 py-3">
          {['bg-bad', 'bg-warn', 'bg-good'].map((c) => (
            <span key={c} className={`h-2.5 w-2.5 rounded-full ${c} opacity-70`} />
          ))}
        </div>
        <div className="space-y-1.5 p-5 font-mono text-[12.5px]">
          {lines.map((l, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -6 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.25 * i, duration: 0.3 }}
              className={`${l.c} break-all`}
            >
              {l.t}
            </motion.div>
          ))}
          <motion.span animate={{ opacity: [1, 0] }} transition={{ repeat: Infinity, duration: 0.9 }} className="inline-block h-4 w-2 bg-acid align-middle" />
        </div>
      </div>
    </section>
  )
}

export default function Home() {
  return (
    <>
      <Hero />
      <Pipeline />
      <LiftCards />
      <CoachMarquee />
      <AgentTerminal />
      <footer className="border-t border-line py-10 text-center text-xs text-dim">
        LiftLens 提供的是训练参考，不构成医疗建议。有疼痛请先咨询医生或物理治疗师。
      </footer>
    </>
  )
}
