import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useDropzone } from 'react-dropzone'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronLeft, ChevronRight, Film, Loader2, Trash2, Upload, Minus, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { LIFTS, ANGLE_LABEL, e1rm } from '../lib/lifts'
import { CameraGuide } from '../components/CameraGuide'
import { VolumeFigure } from '../components/figures'
import { FramePicker } from '../components/FramePicker'
import { POSE_MODELS, type PoseModelId } from '../lib/pose'
import { runAnalysis, type Phase } from '../lib/pipeline'
import { ModelPicker } from '../components/ModelPicker'
import { drawSkeleton } from '../lib/draw'
import { getSetting } from '../lib/db'
import type { AngleId, LiftId } from '../lib/types'
import { isBig3, refOf, type ExerciseRef } from '../lib/exerciseRef'
import { BIG3_IDS, getExercise } from '../lib/exercises'
import { PATTERNS } from '../lib/movement/patterns'
import type { ExerciseInfo } from '../lib/movement/types'
import { ExerciseGuide } from '../components/ExerciseGuide'
import { ExercisePicker } from '../components/ExercisePicker'
import type { BarSeed } from '../lib/barTracker'

interface Draft {
  angle: AngleId
  file: File
  seed: BarSeed | null
}

const STEPS = ['选动作', '机位与上传', '标记与重量', '分析']
const ease = [0.16, 1, 0.3, 1] as const
const TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

export default function NewSession() {
  const [params] = useSearchParams()
  const [step, setStep] = useState(params.get('lift') ? 1 : 0)
  const [dir, setDir] = useState(1)
  const [lift, setLift] = useState<LiftId | 'other'>((params.get('lift') as LiftId) || 'bench')
  const [exercise, setExercise] = useState<ExerciseRef | null>(null)
  const [picker, setPicker] = useState(false)
  const big = isBig3(lift) ? lift : null
  // /new?exercise=0294 — arriving directly from the exercise library
  useEffect(() => {
    const id = params.get('exercise')
    if (!id) return
    getExercise(id).then((ex) => ex && pickExercise(ex))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const pickExercise = (ex: ExerciseInfo) => {
    const b = ex.big3 ?? (Object.entries(BIG3_IDS).find(([, id]) => id === ex.id)?.[0] as LiftId | undefined)
    setLift(b ?? 'other')
    setExercise(b ? null : refOf(ex))
    setAngle(!b && ex.pattern ? PATTERNS[ex.pattern].camera.angle : 'side')
    setDrafts([])
    setDir(1)
    setStep(1)
  }
  const [angle, setAngle] = useState<AngleId>('side')
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [equipment, setEquipment] = useState<'barbell' | 'smith'>('barbell')
  const [barKg, setBarKg] = useState(20)
  const [plates, setPlates] = useState<number[]>([])
  const [manualKg, setManualKg] = useState<string>('')
  const [rpe, setRpe] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [model, setModel] = useState<PoseModelId>('full')
  useEffect(() => {
    getSetting<PoseModelId>('poseModel', 'full').then(setModel)
  }, [])

  const go = (n: number) => {
    setDir(n > step ? 1 : -1)
    setStep(n)
  }
  const totalKg = manualKg ? Number(manualKg) : plates.length ? barKg + 2 * plates.reduce((a, b) => a + b, 0) : null

  const canNext = step === 0 || (step === 1 && drafts.length > 0) || step === 2

  /** Put files into slots: the angle being looked at first, then empty slots by priority. */
  const addFiles = (files: File[]) => {
    const vids = files.filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(f.name))
    if (!vids.length) {
      if (files.length) toast.error('只支持视频文件（mp4 / mov / webm）')
      return
    }
    if (!big) {
      // Library exercise: only one camera angle
      setDrafts([{ angle, file: vids[0], seed: null }])
      toast.success(`已添加 ${vids[0].name}`)
      if (step === 0) go(1)
      return
    }
    const order = [angle, ...LIFTS[big].angles.map((a) => a.id).filter((id) => id !== angle)]
    let next = [...drafts]
    const taken = new Set(next.map((d) => d.angle))
    const placed: string[] = []
    vids.forEach((file, i) => {
      // first file may replace the focused slot; later ones only fill empty slots
      const target = i === 0 && !taken.has(angle) ? angle : order.find((id) => !taken.has(id)) ?? (i === 0 ? angle : null)
      if (!target) return
      next = [...next.filter((d) => d.angle !== target), { angle: target, file, seed: null }]
      taken.add(target)
      placed.push(`${LIFTS[big].angles.find((a) => a.id === target)?.label ?? ANGLE_LABEL[target]} ← ${file.name}`)
    })
    setDrafts(next)
    if (placed.length) toast.success(placed.join('\n'))
    if (vids.length > placed.length) toast.warning(`${vids.length - placed.length} 个视频没有空余机位`)
    if (step === 0) go(1)
  }

  // paste (⌘V / Ctrl+V a copied video file) + drop anywhere on the page
  const [dragging, setDragging] = useState(false)
  const addRef = useRef(addFiles)
  addRef.current = addFiles
  useEffect(() => {
    if (step > 1) return
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')
    let depth = 0
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])]
      if (!files.length) return
      e.preventDefault()
      addRef.current(files)
    }
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      setDragging(true)
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      if (--depth <= 0) setDragging(false)
    }
    const onOver = (e: DragEvent) => hasFiles(e) && e.preventDefault()
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      // drops on a slot are handled by that slot's dropzone
      if ((e.target as HTMLElement | null)?.closest('[data-slot]')) return
      addRef.current([...(e.dataTransfer?.files ?? [])])
    }
    window.addEventListener('paste', onPaste)
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [step])

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.92, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-acid/70 px-16 py-12 text-center"
            >
              <Film size={36} className="text-acid" />
              <div className="font-display text-2xl font-bold">松开即可上传</div>
              <div className="text-sm text-mute">
                {big ? `优先放进「${LIFTS[big].angles.find((a) => a.id === angle)?.label ?? ANGLE_LABEL[angle]}」，多个视频会依次填入空机位` : '作为这一组的视频'}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <Stepper step={step} onGo={(n) => n < step && go(n)} />
      <ExercisePicker
        open={picker}
        onClose={() => setPicker(false)}
        onSelect={(ex) => {
          setPicker(false)
          pickExercise(ex)
        }}
      />
      <div className="relative mt-8">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={step}
            custom={dir}
            initial={{ opacity: 0, x: dir * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -40 }}
            transition={{ duration: 0.4, ease }}
          >
            {step === 0 && (
              <LiftPicker
                value={big}
                onChange={(l) => {
                  setLift(l)
                  setExercise(null)
                  setAngle('side')
                  setDrafts([])
                  go(1)
                }}
                onLibrary={() => setPicker(true)}
              />
            )}
            {step === 1 && (
              big ? (
              <div className="space-y-8">
                <CameraGuide lift={big} selected={angle} onSelect={setAngle} uploaded={drafts.map((d) => d.angle)} />
                <UploadSlots
                  lift={big}
                  drafts={drafts}
                  onAdd={(a, f) => setDrafts((d) => [...d.filter((x) => x.angle !== a), { angle: a, file: f, seed: null }])}
                  onRemove={(a) => setDrafts((d) => d.filter((x) => x.angle !== a))}
                  focus={angle}
                  onFocus={setAngle}
                />
              </div>
              ) : exercise ? (
                <ExerciseGuide
                  exercise={exercise}
                  file={drafts[0]?.file ?? null}
                  onFile={(f) => setDrafts([{ angle, file: f, seed: null }])}
                  onRemove={() => setDrafts([])}
                />
              ) : null
            )}
            {step === 2 && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                <div className="space-y-6">
                  {drafts.map((d) => (
                    <div key={d.angle} className="card p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="font-display text-lg font-bold">{ANGLE_LABEL[d.angle]}</div>
                        <div className="font-mono text-xs text-dim">{d.file.name}</div>
                      </div>
                      {!big ? (
                        <VideoPreview file={d.file} />
                      ) : (
                      <FramePicker
                        file={d.file}
                        seed={d.seed}
                        onSeed={(s) => setDrafts((all) => all.map((x) => (x.angle === d.angle ? { ...x, seed: s } : x)))}
                        onPlate={(kg) => {
                          setPlates((p) => [...p, kg])
                          setManualKg('')
                          toast.success(`每侧加 ${kg}kg`)
                        }}
                      />
                      )}
                    </div>
                  ))}
                </div>
                <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
                  <ModelPicker value={model} onChange={setModel} />
                  <div className="card space-y-4 p-5">
                    <div className="kicker">本组信息</div>
                    {big && (
                    <>
                    <Segmented
                      value={equipment}
                      onChange={(v) => {
                        setEquipment(v)
                        setBarKg(v === 'smith' ? 10 : 20)
                      }}
                      options={[
                        ['barbell', '自由杠铃'],
                        ['smith', '史密斯机'],
                      ]}
                    />
                    <div>
                      <div className="mb-1 text-xs text-mute">杠 / 滑轨自重 (kg)</div>
                      <input className="input" type="number" value={barKg} onChange={(e) => setBarKg(Number(e.target.value))} />
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs text-mute">
                        <span>每侧杠铃片（OCR 识别或手动添加）</span>
                        {plates.length > 0 && (
                          <button className="hover:text-fg" onClick={() => setPlates([])}>
                            清空
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <AnimatePresence>
                          {plates.map((p, i) => (
                            <motion.button
                              layout
                              key={i + '-' + p}
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              exit={{ scale: 0 }}
                              onClick={() => setPlates((ps) => ps.filter((_, j) => j !== i))}
                              className="chip h-8 border-acid/40 text-acid"
                            >
                              {p}kg ×
                            </motion.button>
                          ))}
                        </AnimatePresence>
                        {[20, 15, 10, 5, 2.5, 1.25].map((p) => (
                          <button key={p} onClick={() => setPlates((ps) => [...ps, p])} className="chip h-8 hover:text-fg">
                            +{p}
                          </button>
                        ))}
                      </div>
                    </div>
                    </>
                    )}
                    <div>
                      <div className="mb-1 text-xs text-mute">{big ? '或直接输入总重量 (kg)' : '重量 (kg，徒手可不填)'}</div>
                      <input className="input" type="number" placeholder={totalKg ? String(totalKg) : '例如 60'} value={manualKg} onChange={(e) => setManualKg(e.target.value)} />
                    </div>
                    <div className="flex items-end justify-between rounded-xl bg-ink-2 px-4 py-3">
                      <span className="text-sm text-mute">总重量</span>
                      <motion.span key={totalKg ?? 0} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="font-mono text-3xl text-acid">
                        {totalKg ?? '—'}
                        <span className="ml-1 text-sm text-mute">kg</span>
                      </motion.span>
                    </div>
                    <div>
                      <div className="mb-1 text-xs text-mute">RPE（主观用力，1–10，可选）</div>
                      <div className="flex items-center gap-2">
                        <button className="btn-ghost h-9 w-9 p-0" onClick={() => setRpe((r) => Math.max(5, (r ?? 8) - 0.5))}>
                          <Minus size={14} />
                        </button>
                        <div className="flex-1 text-center font-mono text-xl">{rpe ?? '—'}</div>
                        <button className="btn-ghost h-9 w-9 p-0" onClick={() => setRpe((r) => Math.min(10, (r ?? 7.5) + 0.5))}>
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                    <textarea className="input h-20 py-2" placeholder="备注：例如 右肩有点紧、最后一次很吃力" value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </div>
                  {big && <p className="text-xs text-dim">没有点选标记的机位会用双手手腕位置代替杠铃（参考 CS231n 2024 的做法），精度略低。</p>}
                </div>
              </div>
            )}
            {step === 3 && (
              <AnalyzeRun lift={lift} exercise={exercise ?? undefined} model={model} drafts={drafts} equipment={equipment} weightKg={totalKg} rpe={rpe} notes={notes} onBack={() => go(2)} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {step > 0 && step < 3 && (
        <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 mt-10 sm:bottom-4 flex justify-between gap-3 rounded-full border border-line bg-ink/80 p-2 backdrop-blur-xl">
          <button className="btn-ghost" onClick={() => go(step - 1)}>
            <ChevronLeft size={16} /> 上一步
          </button>
          <button className="btn-acid" disabled={!canNext} onClick={() => go(step + 1)}>
            {step === 2 ? '开始分析' : '下一步'} <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}

function VideoPreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  return <video src={url} controls playsInline muted className="block max-h-[60vh] w-full rounded-xl bg-ink-2 object-contain" />
}

function Stepper({ step, onGo }: { step: number; onGo: (n: number) => void }) {
  return (
    <ol className="flex items-center gap-1.5 text-sm sm:gap-2">
      {STEPS.map((s, i) => (
        <li key={s} className="flex shrink-0 items-center gap-2">
          <button onClick={() => onGo(i)} className={`flex items-center gap-2 ${i < step ? 'cursor-pointer' : 'cursor-default'}`}>
            <motion.span
              animate={{ backgroundColor: i <= step ? '#c8ff3d' : '#1a201d', color: i <= step ? '#1a2400' : '#8a968f', scale: i === step ? 1.1 : 1 }}
              className="flex h-7 w-7 items-center justify-center rounded-full font-mono text-xs font-semibold"
            >
              {i < step ? <Check size={14} /> : i + 1}
            </motion.span>
            <span className={i === step ? 'text-fg' : 'hidden text-mute sm:inline'}>{s}</span>
          </button>
          {i < STEPS.length - 1 && (
            <span className="relative h-px w-5 bg-line sm:w-16">
              <motion.span className="absolute inset-y-0 left-0 bg-acid" animate={{ width: i < step ? '100%' : '0%' }} transition={{ duration: 0.5, ease }} />
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}

function LiftPicker({ value, onChange, onLibrary }: { value: LiftId | null; onChange: (l: LiftId) => void; onLibrary: () => void }) {
  const [hover, setHover] = useState<LiftId | null>(null)
  return (
    <div>
      <h1 className="font-display text-4xl font-bold tracking-tight">今天练什么？</h1>
      <p className="mt-2 text-mute">选择动作后会给出推荐机位，支持一个动作上传多个机位一起分析。</p>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {(Object.keys(LIFTS) as LiftId[]).map((id, i) => (
          <motion.button
            key={id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, ease }}
            whileHover={{ y: -6 }}
            whileTap={{ scale: 0.98 }}
            onHoverStart={() => setHover(id)}
            onHoverEnd={() => setHover(null)}
            onClick={() => onChange(id)}
            className={`card p-5 text-left transition-colors ${value === id ? 'border-acid/60' : 'hover:border-line-2'}`}
          >
            <div className="font-display text-2xl font-bold">{LIFTS[id].name}</div>
            <div className="font-mono text-xs text-dim">{LIFTS[id].en}</div>
            <VolumeFigure lift={id} muscles playing={hover === id} className="-mx-4 my-1 h-56 w-[calc(100%+2rem)]" />
            <div className="text-sm text-mute">{LIFTS[id].tagline}</div>
          </motion.button>
        ))}
      </div>
      <motion.button
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, ease }}
        onClick={onLibrary}
        className="card mt-4 flex w-full items-center gap-4 p-5 text-left transition-colors hover:border-acid/50"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-acid/10 text-acid">
          <Search size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-xl font-bold">动作库里的其他动作</span>
          <span className="block text-sm text-mute">1300+ 个动作，800 多个支持视频计次和动作检查：弯举、划船、引体、俯卧撑、臀推、平板支撑…</span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-dim" />
      </motion.button>
    </div>
  )
}

function UploadSlots({
  lift,
  drafts,
  onAdd,
  onRemove,
  focus,
  onFocus,
}: {
  lift: LiftId
  drafts: Draft[]
  onAdd: (a: AngleId, f: File) => void
  onRemove: (a: AngleId) => void
  focus: AngleId
  onFocus: (a: AngleId) => void
}) {
  const def = LIFTS[lift]
  return (
    <div>
      <div className="mb-3 flex items-end justify-between">
        <div>
          <div className="kicker mb-1">上传视频</div>
          <div className="text-sm text-mute">
            至少上传「正侧面」；多机位会合并成一份报告。
            {TOUCH ? (
              '点机位卡片即可从相册选择，或直接拍摄。'
            ) : (
              <>
                也可以把视频<b className="font-medium text-fg">拖到页面任意位置</b>，或复制后按{' '}
                <kbd className="rounded border border-line-2 bg-panel-2 px-1.5 font-mono text-[11px]">{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} V</kbd> 粘贴。
              </>
            )}
          </div>
        </div>
        <details className="text-xs text-mute">
          <summary className="cursor-pointer hover:text-fg">拍摄小贴士</summary>
          <ul className="card absolute right-4 z-20 mt-2 max-w-sm space-y-1.5 p-4 text-left">
            {def.shootingTips.map((t) => (
              <li key={t}>· {t}</li>
            ))}
          </ul>
        </details>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {def.angles.map((a) => (
          <Slot
            key={a.id}
            label={a.label}
            priority={a.priority}
            draft={drafts.find((d) => d.angle === a.id)}
            active={focus === a.id}
            onFocus={() => onFocus(a.id)}
            onFile={(f) => onAdd(a.id, f)}
            onRemove={() => onRemove(a.id)}
          />
        ))}
      </div>
    </div>
  )
}

function Slot({
  label,
  priority,
  draft,
  active,
  onFocus,
  onFile,
  onRemove,
}: {
  label: string
  priority: string
  draft?: Draft
  active: boolean
  onFocus: () => void
  onFile: (f: File) => void
  onRemove: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!draft) return setUrl(null)
    const u = URL.createObjectURL(draft.file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [draft])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'video/*': [] },
    multiple: false,
    onDrop: (fs) => fs[0] && onFile(fs[0]),
    onDropRejected: () => toast.error('只支持视频文件（mp4 / mov / webm）'),
  })
  return (
    <motion.div layout data-slot onClickCapture={onFocus} className={`card relative overflow-hidden transition-colors ${active ? 'border-acid/50' : ''}`}>
      {draft && url ? (
        <div>
          <video src={url} className="aspect-video w-full bg-black object-contain" muted playsInline controls />
          <div className="flex items-center justify-between p-3 text-sm">
            <span className="flex items-center gap-2">
              <Check size={14} className="text-good" />
              {label}
            </span>
            <button onClick={onRemove} className="text-dim hover:text-bad" aria-label="移除">
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ) : (
        <div
          {...getRootProps()}
          className={`flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-3 p-6 text-center transition-colors ${isDragActive ? 'bg-acid/10' : 'hover:bg-panel-2'}`}
        >
          <input {...getInputProps()} />
          <motion.div animate={isDragActive ? { y: -6, scale: 1.1 } : { y: 0, scale: 1 }} className="flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed border-line-2 text-mute">
            {isDragActive ? <Film size={20} className="text-acid" /> : <Upload size={20} />}
          </motion.div>
          <div className="font-display text-lg font-bold">{label}</div>
          <div className={`chip ${priority === 'primary' ? 'border-acid/40 text-acid' : ''}`}>
            {priority === 'primary' ? '必拍' : priority === 'secondary' ? '推荐' : '可选'}
          </div>
          <div className="text-xs text-dim">{TOUCH ? '点击选择或拍摄视频' : '拖入或点击选择视频'}</div>
        </div>
      )}
    </motion.div>
  )
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="relative flex rounded-full border border-line bg-ink-2 p-1">
      {options.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)} className={`relative z-10 h-9 flex-1 rounded-full text-sm transition-colors ${value === v ? 'text-acid-ink' : 'text-mute'}`}>
          {value === v && <motion.span layoutId="seg" className="absolute inset-0 -z-10 rounded-full bg-acid" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />}
          {l}
        </button>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ analysis run

const PHASES: { id: Phase; label: string }[] = [
  { id: 'model', label: '下载 / 加载姿态模型' },
  { id: 'pose', label: '逐帧识别骨架 + 追踪杠铃' },
  { id: 'rules', label: '分次 & 规则判定' },
  { id: 'keyframes', label: '生成标注关键帧' },
  { id: 'save', label: '保存到本地训练日志' },
]

function AnalyzeRun({
  lift,
  exercise,
  model,
  drafts,
  equipment,
  weightKg,
  rpe,
  notes,
  onBack,
}: {
  lift: LiftId | 'other'
  exercise?: ExerciseRef
  model: PoseModelId
  drafts: Draft[]
  equipment: 'barbell' | 'smith'
  weightKg: number | null
  rpe: number | null
  notes: string
  onBack: () => void
}) {
  const nav = useNavigate()
  const [phase, setPhase] = useState<Phase>('model')
  const [clipIdx, setClipIdx] = useState(0)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const preview = useRef<HTMLCanvasElement>(null)
  const started = useRef(false)

  const run = async () => {
    try {
      const { id, session } = await runAnalysis({
        lift,
        exercise,
        model,
        clips: drafts,
        equipment,
        weightKg,
        rpe,
        notes,
        onPhase: (p, ci) => {
          setPhase(p)
          setClipIdx(ci)
        },
        onProgress: setProgress,
        onFrame: (canvas, frame) => {
          const pc = preview.current
          if (!pc) return
          pc.width = canvas.width
          pc.height = canvas.height
          const ctx = pc.getContext('2d')!
          ctx.drawImage(canvas, 0, 0)
          if (frame?.lm) drawSkeleton(ctx, frame.lm, pc.width, pc.height)
          if (frame?.bar) {
            ctx.fillStyle = '#c8ff3d'
            ctx.beginPath()
            ctx.arc(frame.bar.x * pc.width, frame.bar.y * pc.height, 7, 0, Math.PI * 2)
            ctx.fill()
          }
        },
      })
      const est = e1rm(weightKg, session.reps)
      toast.success(`分析完成：${session.reps} 次，动作分 ${session.score}${est ? ` · e1RM ≈ ${est}kg` : ''}`)
      setTimeout(() => nav(`/session/${id}?fresh=1`), 500)
    } catch (e) {
      console.error(e)
      setError((e as Error).message)
    }
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const phaseIdx = PHASES.findIndex((p) => p.id === phase)
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="card relative overflow-hidden">
        <canvas ref={preview} className="block aspect-video w-full bg-ink-2 object-contain" />
        <motion.div className="absolute inset-x-0 top-0 h-0.5 origin-left bg-acid" style={{ scaleX: progress }} />
        <div className="absolute left-3 top-3 chip border-acid/40 bg-ink/70 text-acid backdrop-blur">
          {ANGLE_LABEL[[...drafts].sort((a, b) => (a.angle === 'side' ? -1 : b.angle === 'side' ? 1 : 0))[clipIdx]?.angle ?? 'side']} · {clipIdx + 1}/{drafts.length}
        </div>
        <motion.div
          className="pointer-events-none absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-acid/10 to-transparent"
          animate={{ top: ['-10%', '100%'] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}
        />
      </div>
      <div className="card p-5">
        <div className="kicker mb-4">分析进度</div>
        <ol className="space-y-3">
          {PHASES.map((p, i) => {
            const state = phase === 'done' || i < phaseIdx ? 'done' : i === phaseIdx ? 'active' : 'todo'
            return (
              <motion.li key={p.id} layout className="flex items-center gap-3 text-sm">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full border ${state === 'done' ? 'border-good bg-good/15 text-good' : state === 'active' ? 'border-acid text-acid' : 'border-line text-dim'}`}>
                  {state === 'done' ? <Check size={12} /> : state === 'active' ? <Loader2 size={12} className="animate-spin" /> : i + 1}
                </span>
                <span className={state === 'todo' ? 'text-dim' : ''}>{p.label}</span>
                {(p.id === 'pose' || p.id === 'model') && state === 'active' && <span className="ml-auto font-mono text-xs text-acid">{Math.round(progress * 100)}%</span>}
              </motion.li>
            )
          })}
        </ol>
        {error && (
          <div className="mt-6 rounded-xl border border-bad/40 bg-bad/10 p-3 text-sm text-bad">
            {error}
            <button className="btn-ghost mt-3 h-9" onClick={onBack}>
              返回修改
            </button>
          </div>
        )}
        <p className="mt-6 text-xs text-dim">模型：{POSE_MODELS[model].label}（{POSE_MODELS[model].engine === 'rtmo' ? 'OpenMMLab RTMO' : 'MediaPipe'}）。全部在浏览器本地计算，60 秒视频大约需要 30–60 秒。</p>
      </div>
    </div>
  )
}
