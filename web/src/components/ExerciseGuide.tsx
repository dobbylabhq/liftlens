import { useDropzone } from 'react-dropzone'
import { Camera, Film, Repeat, Timer, Trash2, Upload } from 'lucide-react'
import { MuscleMap } from './MuscleMap'
import { exerciseMuscleWeights } from '../lib/muscles'
import { PATTERNS } from '../lib/movement/patterns'
import type { ExerciseRef } from '../lib/exerciseRef'

const TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

/** Library exercise (not one of the big three): muscles worked + how to film + an upload slot */
export function ExerciseGuide({ exercise, file, onFile, onRemove }: { exercise: ExerciseRef; file: File | null; onFile: (f: File) => void; onRemove: () => void }) {
  const p = exercise.pattern ? PATTERNS[exercise.pattern] : null
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'video/*': [] },
    multiple: false,
    onDrop: (fs) => fs[0] && onFile(fs[0]),
  })
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="card p-5">
        <div className="kicker">练到的肌肉</div>
        <h2 className="font-display mt-1 text-2xl font-bold">{exercise.name}</h2>
        {exercise.target && <MuscleMap weights={exerciseMuscleWeights(exercise.target, exercise.secondary ?? [])} view="both" className="mx-auto mt-3 max-w-sm" />}
      </div>
      <div className="space-y-4">
        {p ? (
          <div className="card space-y-3 p-5">
            <div className="kicker">程序会看什么</div>
            <div className="flex flex-wrap gap-1.5">
              <span className="chip h-7 border-acid/40 text-acid">{p.zh}</span>
              {exercise.unilateral && <span className="chip h-7">单侧动作</span>}
              {exercise.hold ? (
                <span className="chip h-7">
                  <Timer size={12} /> 计时
                </span>
              ) : (
                <span className="chip h-7">
                  <Repeat size={12} /> 自动计次
                </span>
              )}
            </div>
            <ul className="space-y-1.5 text-sm text-mute">
              {p.peakTarget && <li>· 幅度：{p.peakTarget.label}</li>}
              {p.restTarget && <li>· 回位：{p.restTarget.label}</li>}
              {p.checks.includes('tempo') && <li>· 离心节奏：下放/还原是否太快</li>}
              {p.checks.includes('swing') && <li>· 是否借力、躯干晃动</li>}
              {p.checks.includes('elbowDrift') && <li>· 大臂是否固定</li>}
              {p.checks.includes('bodyLine') && <li>· 身体是否成一条线（塌腰 / 撅臀）</li>}
              {p.checks.includes('fatigue') && <li>· 最后几次是否明显变慢（接近力竭）</li>}
              {exercise.hold && <li>· 保持时长</li>}
            </ul>
            <div className="flex items-start gap-2 rounded-xl bg-ink-2 p-3 text-sm">
              <Camera size={15} className="mt-0.5 shrink-0 text-cyan" />
              <span>
                机位：{p.camera.tip}
                {p.camera.angle === 'front' ? '（这个动作正面拍效果更好）' : ''}
              </span>
            </div>
          </div>
        ) : (
          <div className="card p-5 text-sm text-mute">这个动作暂不支持视频分析，可以在「训练」里直接记录次数和重量。</div>
        )}
        {p &&
          (file ? (
            <div className="card flex items-center gap-3 p-4">
              <Film size={18} className="text-acid" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{file.name}</div>
                <div className="text-xs text-dim">{(file.size / 1e6).toFixed(1)} MB</div>
              </div>
              <button aria-label="移除视频" className="flex h-10 w-10 items-center justify-center text-dim hover:text-bad" onClick={onRemove}>
                <Trash2 size={15} />
              </button>
            </div>
          ) : (
            <div
              {...getRootProps()}
              data-slot
              className={`flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${isDragActive ? 'border-acid bg-acid/5' : 'border-line-2 hover:border-acid/50'}`}
            >
              <input {...getInputProps()} />
              <Upload size={22} className="text-acid" />
              <div className="font-medium">{TOUCH ? '点击选择或拍摄视频' : '拖入或点击选择视频'}</div>
              <div className="text-xs text-dim">一组一个视频，全程在浏览器里分析</div>
            </div>
          ))}
      </div>
    </div>
  )
}
