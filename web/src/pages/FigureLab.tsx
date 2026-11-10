import { useState, type ComponentType } from 'react'
import { Pause, Play } from 'lucide-react'
import { LiftFigure } from '../components/LiftFigure'
import { LowPolyFigure, MUSCLES, SilhouetteFigure, VolumeFigure, type FigureProps } from '../components/figures'
import type { LiftId } from '../lib/types'

const LIFT_COLS: { id: LiftId; label: string }[] = [
  { id: 'bench', label: '卧推' },
  { id: 'squat', label: '深蹲' },
  { id: 'deadlift', label: '硬拉' },
]

const MuscleFigure = (p: FigureProps) => <VolumeFigure {...p} muscles />

interface StyleRow {
  key: string
  name: string
  tag: string
  method: string
  pros: string[]
  cons: string[]
  /** 1–5 */
  score: { read: number; perf: number; fit: number }
  cost: string
  Comp: ComponentType<FigureProps>
  recommended?: boolean
}

const ROWS: StyleRow[] = [
  {
    key: 'stick',
    name: '火柴人（现状）',
    tag: 'BASELINE',
    method: '5 根 <line> + 7 个关节圆，关节坐标线性插值',
    pros: ['最轻，一眼看懂杠铃轨迹', '小尺寸（48px 图标）依然清晰'],
    cons: ['抽象，看不出身体厚度和朝向', '线性插值会让骨长在动作中途伸缩'],
    score: { read: 3, perf: 5, fit: 4 },
    cost: '≈ 14 个元素 / 帧',
    Comp: LiftFigure,
  },
  {
    key: 'volume',
    name: 'A · 体积肢体',
    tag: 'VOLUME',
    method: '锥形胶囊肢体 + 样条躯干（胸廓/骨盆），逐段线性渐变，近侧实色、远侧降明度并错位，亮面高光条',
    pros: ['一眼有「人」的体积和朝向', '远近侧分层，深度感强', '固定骨长 + IK，比例全程不变'],
    cons: ['浅色人体在暗色 UI 里偏亮、略抢主视觉', '缩到很小时细节糊成一团'],
    score: { read: 4, perf: 4, fit: 3 },
    cost: '≈ 22 个 path / 帧',
    Comp: VolumeFigure,
  },
  {
    key: 'muscle',
    name: 'B · 解剖肌群',
    tag: 'ANATOMY',
    method: '在 A 之上叠加主动肌胶囊（带 glow 滤镜），透明度随向心阶段升起、离心阶段衰减',
    pros: ['直接传达「这个动作练哪里」，教学价值最高', 'acid 高亮与品牌色呼应'],
    cons: ['肌肉是示意性贴片，不是解剖级精度', 'glow 滤镜在低端机上有额外合成开销'],
    score: { read: 5, perf: 3, fit: 4 },
    cost: '≈ 26 个 path / 帧 + 1 个滤镜',
    Comp: MuscleFigure,
  },
  {
    key: 'silhouette',
    name: 'C · 剪影 + 轮廓光',
    tag: 'SILHOUETTE',
    method: '同色胶囊与样条躯干在 <defs> 里拼成无缝剪影，<use> 复用 3 次：模糊辉光、偏移的 acid 边缘光、深色填充',
    pros: ['最像运动品牌插画，和暗色 UI 最协调', '<use> 克隆自动跟随，每帧成本 ≈ A', '人物不抢文字，适合 Hero 大图'],
    cons: ['手臂压在躯干上时只能靠边缘光区分', '无内部明暗，动作细节（肘位）略弱'],
    score: { read: 4, perf: 4, fit: 5 },
    cost: '≈ 18 个 path / 帧（克隆免费）',
    Comp: SilhouetteFigure,
    recommended: true,
  },
  {
    key: 'lowpoly',
    name: 'D · 低多边形 / 线框',
    tag: 'LOW-POLY',
    method: '每段肢体两条带肌腹顶点的平面条带，躯干/头为三角扇；每帧按「面法线 · 主光」重算 Lambert 明度，青色线框',
    pros: ['3D 感最强，光照随肢体转动', '线框和「数据分析」调性契合'],
    cons: ['约 96 个多边形 × 2 属性 / 帧，最重', '远看面片噪点多，可读性一般'],
    score: { read: 3, perf: 2, fit: 4 },
    cost: '≈ 190 次 setAttribute / 帧',
    Comp: LowPolyFigure,
  },
]

function Dots({ n }: { n: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${n} / 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`h-1.5 w-3 rounded-full ${i <= n ? 'bg-acid' : 'bg-line-2'}`} />
      ))}
    </span>
  )
}

export default function FigureLab() {
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [trail, setTrail] = useState(true)
  const [frame, setFrame] = useState(0)
  const tempo = 2.4 / speed

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="kicker">LAB · FIGURES</div>
      <h1 className="font-display mt-1 text-4xl font-bold tracking-tight">动作示意风格对比</h1>
      <p className="mt-3 max-w-2xl text-mute">
        所有风格共用 <code className="font-mono text-cyan">figures/poses.ts</code> 的同一份关键姿态。写实风格在其上做了固定骨长的角度插值 +
        手臂 IK，避免肢体在动作中途「伸缩」。每帧只 setAttribute，不触发 React 渲染；系统开启「减少动态效果」时显示静帧。
      </p>

      <div className="sticky top-14 z-30 -mx-4 mt-6 flex flex-wrap items-center gap-4 border-b border-line/70 bg-ink px-4 py-3">
        <button className="btn-acid h-9 px-4" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
          {playing ? '暂停' : '播放'}
        </button>
        <label className="flex items-center gap-3 text-sm text-mute">
          速度
          <input type="range" min={0.5} max={2} step={0.25} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-36 accent-[#c8ff3d]" />
          <span className="w-24 font-mono text-xs tabular-nums text-fg">
            {speed.toFixed(2)}× · {tempo.toFixed(1)}s
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm text-mute">
          <input type="checkbox" checked={trail} onChange={(e) => setTrail(e.target.checked)} className="accent-[#c8ff3d]" />
          杠铃轨迹
        </label>
        {!playing && (
          <label className="flex items-center gap-3 text-sm text-mute">
            定格
            <input type="range" min={0} max={1} step={0.01} value={frame} onChange={(e) => setFrame(Number(e.target.value))} className="w-36 accent-[#5eead4]" />
            <span className="font-mono text-xs tabular-nums text-fg">t={frame.toFixed(2)}</span>
          </label>
        )}
        <span className="ml-auto hidden font-mono text-[11px] text-dim lg:inline">
          {playing ? '切换播放/速度会让全部图形从同一帧重新开始，保持同步' : '暂停时可拖动定格检查任意帧（火柴人基准不支持定格）'}
        </span>
      </div>

      <div className="mt-6 space-y-4">
        {ROWS.map((row) => (
          <section key={row.key} className={`card grid gap-4 p-4 lg:grid-cols-[260px_1fr] ${row.recommended ? 'border-acid/50' : ''}`}>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="kicker">{row.tag}</span>
                {row.recommended && <span className="rounded-full bg-acid px-2 py-0.5 text-[10px] font-bold text-acid-ink">推荐</span>}
              </div>
              <h2 className="font-display mt-1 text-xl font-bold">{row.name}</h2>
              <p className="mt-1.5 text-xs leading-relaxed text-mute">{row.method}</p>
              <dl className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-dim">可读性</dt>
                <dd>
                  <Dots n={row.score.read} />
                </dd>
                <dt className="text-dim">性能</dt>
                <dd>
                  <Dots n={row.score.perf} />
                </dd>
                <dt className="text-dim">暗色协调</dt>
                <dd>
                  <Dots n={row.score.fit} />
                </dd>
              </dl>
              <div className="mt-2 font-mono text-[11px] text-dim">{row.cost}</div>
              <ul className="mt-3 space-y-1 text-xs">
                {row.pros.map((p) => (
                  <li key={p} className="flex gap-1.5 text-fg/85">
                    <span className="text-good">+</span>
                    {p}
                  </li>
                ))}
                {row.cons.map((p) => (
                  <li key={p} className="flex gap-1.5 text-mute">
                    <span className="text-bad">−</span>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {LIFT_COLS.map((l) => (
                <figure key={l.id} className="rounded-xl border border-line bg-ink-2/60 p-2">
                  <row.Comp key={String(trail)} lift={l.id} tempo={tempo} playing={playing} showTrail={trail} progress={playing ? undefined : frame} className="block aspect-[200/140] w-full" />
                  <figcaption className="mt-1 flex items-center justify-between px-1 text-xs">
                    <span className="text-mute">{l.label}</span>
                    {row.key === 'muscle' && <span className="truncate pl-2 text-[10px] text-acid/80">{MUSCLES[l.id].join(' · ')}</span>}
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
