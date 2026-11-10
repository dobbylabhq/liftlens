import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { MuscleMap, MuscleVolumeMap } from '../components/MuscleMap'
import { exerciseMuscleWeights, MUSCLE_KEY_ZH, regionMuscleWeights, type MuscleKey } from '../lib/muscles'

// ExerciseDB-style samples (target + secondaryMuscles in its vocabulary)
const SAMPLES = [
  { id: 'bench', zh: '杠铃卧推', target: 'pectorals', secondary: ['triceps', 'shoulders'] },
  { id: 'pullup', zh: '引体向上', target: 'lats', secondary: ['biceps', 'forearms', 'rhomboids'] },
  { id: 'squat', zh: '杠铃深蹲', target: 'glutes', secondary: ['quadriceps', 'hamstrings', 'calves', 'core'] },
  { id: 'curl', zh: '杠铃弯举', target: 'biceps', secondary: ['forearms', 'brachialis'] },
  { id: 'plank', zh: '平板支撑', target: 'abs', secondary: ['obliques', 'shoulders', 'lower back'] },
  { id: 'raise', zh: '哑铃侧平举', target: 'delts', secondary: ['traps'] },
  { id: 'row', zh: '杠铃划船', target: 'upper back', secondary: ['biceps', 'lats', 'rear deltoids'] },
  { id: 'incline', zh: '上斜哑铃卧推', target: 'pectorals', secondary: ['upper chest', 'triceps', 'shoulders'] },
] as const

const WEEK: { id: (typeof SAMPLES)[number]['id']; sets: number }[] = [
  { id: 'bench', sets: 10 },
  { id: 'incline', sets: 6 },
  { id: 'squat', sets: 12 },
  { id: 'pullup', sets: 8 },
  { id: 'row', sets: 6 },
  { id: 'curl', sets: 6 },
  { id: 'raise', sets: 9 },
  { id: 'plank', sets: 3 },
]

type View = 'both' | 'front' | 'back'

export default function MuscleLab() {
  const [pick, setPick] = useState<string>('bench')
  const [view, setView] = useState<View>('both')
  const [hover, setHover] = useState<MuscleKey | null>(null)

  const weights = useMemo(() => {
    if (pick === 'region') return regionMuscleWeights(['chest', 'frontDelt', 'triceps', 'scapula'])
    const s = SAMPLES.find((x) => x.id === pick)!
    return exerciseMuscleWeights(s.target, [...s.secondary])
  }, [pick])

  const list = (Object.entries(weights) as [MuscleKey, number][]).sort((a, b) => b[1] - a[1])
  const entries = useMemo(
    () =>
      WEEK.map(({ id, sets }) => {
        const s = SAMPLES.find((x) => x.id === id)!
        return { weights: exerciseMuscleWeights(s.target, [...s.secondary]), sets }
      }),
    [],
  )

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="kicker">LAB · MUSCLES</div>
      <h1 className="font-display mt-1 text-3xl font-bold tracking-tight sm:text-4xl">肌肉图</h1>
      <p className="mt-3 max-w-2xl text-sm text-mute">
        动作库的 <code className="font-mono text-cyan">target</code> / <code className="font-mono text-cyan">secondaryMuscles</code>（ExerciseDB 词表）映射到 2D
        肌群：主练 = 1，辅助 = 0.5。轮廓来自 MuscleMap（MIT）。
      </p>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className="card p-4 sm:p-5">
          <div className="flex flex-wrap gap-1.5">
            {[...SAMPLES.map((s) => [s.id, s.zh] as const), ['region', '3D 区域 · 卧推']].map(([id, zh]) => (
              <button
                key={id}
                onClick={() => setPick(id)}
                className={`chip h-8 px-3 text-[13px] transition-colors ${pick === id ? 'border-acid bg-acid text-acid-ink' : 'hover:border-line-2 hover:text-fg'}`}
              >
                {zh}
              </button>
            ))}
          </div>

          <div className="mt-4 flex justify-center">
            <div className="flex gap-1 rounded-full border border-line bg-ink/80 p-1">
              {(
                [
                  ['both', '正反'],
                  ['front', '正面'],
                  ['back', '背面'],
                ] as const
              ).map(([v, label]) => (
                <button key={v} onClick={() => setView(v)} className={`relative h-7 rounded-full px-3 text-xs ${view === v ? 'text-acid-ink' : 'text-mute hover:text-fg'}`}>
                  {view === v && <motion.span layoutId="mm-view" className="absolute inset-0 rounded-full bg-acid" />}
                  <span className="relative">{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={`mx-auto mt-4 w-full ${view === 'both' ? 'max-w-[380px]' : 'max-w-[200px]'}`}>
            <MuscleMap weights={weights} view={view} highlight={hover} onHover={setHover} />
          </div>

          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            {list.map(([k, w]) => (
              <span
                key={k}
                onPointerEnter={() => setHover(k)}
                onPointerLeave={() => setHover(null)}
                className={`chip ${w >= 0.75 ? 'border-acid/50 text-acid' : ''} ${hover === k ? 'bg-panel-2 text-fg' : ''}`}
              >
                {MUSCLE_KEY_ZH[k]}
                <span className="font-mono text-[10px] opacity-70">{w >= 0.75 ? '主' : '辅'}</span>
              </span>
            ))}
          </div>
        </section>

        <MuscleVolumeMap entries={entries} title="本周训练量分布（示例数据）" />
      </div>
    </div>
  )
}
