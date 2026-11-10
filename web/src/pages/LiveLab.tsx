import { useEffect, useMemo, useState } from 'react'
import { Camera, Film } from 'lucide-react'
import { LiveSet, type LiveResult } from '../components/LiveSet'
import { PATTERNS } from '../lib/movement/patterns'
import type { PatternId } from '../lib/movement/types'

/** Dev/demo: live rep counting. Uses the camera, or a test video through the same pipeline. */
export default function LiveLab() {
  const [pattern, setPattern] = useState<PatternId>('horizontal-push')
  const [unilateral, setUnilateral] = useState(false)
  const [hold, setHold] = useState(false)
  const [targetReps, setTargetReps] = useState(8)
  const [targetSec, setTargetSec] = useState(30)
  const [label, setLabel] = useState('杠铃卧推')
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [run, setRun] = useState<{ source?: File | string } | null>(null)
  const [result, setResult] = useState<LiveResult | null>(null)

  const videoUrl = useMemo(() => (result?.file ? URL.createObjectURL(result.file) : null), [result])
  useEffect(() => () => void (videoUrl && URL.revokeObjectURL(videoUrl)), [videoUrl])

  const ids = Object.keys(PATTERNS) as PatternId[]
  const testSource = file ?? (url.trim() || null)

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
      <div className="kicker">Lab · 实时计次</div>
      <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight">Live set</h1>
      <p className="mt-2 text-sm text-mute">手机支好、点开始，边做边报数。没有摄像头时可以选一段测试视频，走完全一样的检测/计次流程。</p>

      <div className="card mt-6 grid gap-4 p-5 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="kicker">动作模式</span>
          <select className="input mt-1.5" value={pattern} onChange={(e) => setPattern(e.target.value as PatternId)}>
            {ids.map((id) => (
              <option key={id} value={id}>
                {PATTERNS[id].zh} · {id}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="kicker">动作名</span>
          <input className="input mt-1.5" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="kicker">目标次数（0 = 不设）</span>
          <input className="input mt-1.5 font-mono" type="number" min={0} max={50} value={targetReps} onChange={(e) => setTargetReps(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <label className="block text-sm">
          <span className="kicker">静态支撑目标秒数（0 = 不设）</span>
          <input className="input mt-1.5 font-mono" type="number" min={0} max={600} value={targetSec} onChange={(e) => setTargetSec(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <div className="flex flex-wrap items-center gap-4 text-sm sm:col-span-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={unilateral} onChange={(e) => setUnilateral(e.target.checked)} className="h-4 w-4 accent-[#c8ff3d]" /> 单侧
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} className="h-4 w-4 accent-[#c8ff3d]" /> 静态支撑（计时）
          </label>
          <span className="text-xs text-dim">机位：{PATTERNS[pattern].camera.tip}</span>
        </div>
        <div className="sm:col-span-2">
          <span className="kicker">测试视频（可选）</span>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
            <input
              type="file"
              accept="video/*"
              className="block w-full text-sm text-mute file:mr-3 file:rounded-full file:border-0 file:bg-panel-2 file:px-4 file:py-2 file:text-fg"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <input className="input" placeholder="或视频 URL，如 /@fs/…/bench2.mp4" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-3 sm:col-span-2">
          <button className="btn-acid" onClick={() => (setResult(null), setRun({}))}>
            <Camera size={16} /> 用摄像头
          </button>
          <button className="btn-ghost" disabled={!testSource} onClick={() => (setResult(null), setRun({ source: testSource! }))}>
            <Film size={16} /> 用测试视频
          </button>
        </div>
      </div>

      {result && (
        <div className="card mt-6 p-5">
          <div className="kicker">LiveResult</div>
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            <span className="chip">次数 {result.reps}</span>
            {result.holdS != null && <span className="chip">保持 {result.holdS}s</span>}
            <span className="chip">时长 {result.durationS}s</span>
            <span className="chip">{result.file ? `${result.file.name} · ${(result.file.size / 1e6).toFixed(1)}MB · ${result.file.type}` : '没有视频'}</span>
          </div>
          {videoUrl && <video src={videoUrl} controls playsInline className="mt-4 max-h-[60vh] w-full rounded-xl bg-black" />}
          <pre data-testid="live-result" className="mt-4 max-h-80 overflow-auto rounded-xl bg-ink-2 p-3 font-mono text-xs text-mute">
            {JSON.stringify({ ...result, file: result.file ? { name: result.file.name, size: result.file.size, type: result.file.type } : null }, null, 2)}
          </pre>
        </div>
      )}

      {run && (
        <LiveSet
          patternId={pattern}
          unilateral={unilateral}
          hold={hold}
          label={label || PATTERNS[pattern].zh}
          targetReps={targetReps || undefined}
          targetSec={targetSec || undefined}
          source={run.source}
          onCancel={() => setRun(null)}
          onFinish={(r) => {
            setRun(null)
            setResult(r)
          }}
        />
      )}
    </div>
  )
}
