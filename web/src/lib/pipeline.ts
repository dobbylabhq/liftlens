// Full flow for one set from video to saved: pose → rep segmentation/rules → keyframes → local storage.
// Shared by the "upload & analyze" page and per-set analysis in workout mode.
import { analyzeClip, scoreFindings } from './analyze'
import { analyzeMovement } from './movement/engine'
import { PATTERNS } from './movement/patterns'
import { isBig3, type ExerciseRef } from './exerciseRef'
import { renderKeyframes } from './keyframes'
import { pack } from './draw'
import { extractFrames, getDetector, type PoseModelId } from './pose'
import { requestPersist } from './backup'
import { db, getSetting, issuesOf, todayISO } from './db'
import type { BarSeed } from './barTracker'
import type { AngleId, Clip, LiftId, PoseFrame, Session } from './types'

export type Phase = 'model' | 'pose' | 'rules' | 'keyframes' | 'save' | 'done'

export interface ClipInput {
  angle: AngleId
  file: File
  seed: BarSeed | null
}

export interface RunOptions {
  lift: LiftId | 'other'
  /** Non-big-three: a library exercise (must have a pattern to be analyzable) */
  exercise?: ExerciseRef
  model: PoseModelId
  clips: ClipInput[]
  equipment: 'barbell' | 'smith'
  weightKg: number | null
  rpe: number | null
  notes: string
  workout?: Session['workout']
  signal?: AbortSignal
  /** awaited between frames: lets a background run hold still while live mode needs the device */
  gate?: () => Promise<void>
  onPhase?: (p: Phase, clipIndex: number) => void
  onProgress?: (p: number) => void
  /** Per-frame preview (callback every few frames) */
  onFrame?: (canvas: HTMLCanvasElement, frame: PoseFrame | null) => void
}

export async function runAnalysis(o: RunOptions): Promise<{ id: number; session: Session }> {
  if (!isBig3(o.lift) && !o.exercise?.pattern) throw new Error('这个动作暂不支持视频分析')
  o.onPhase?.('model', 0)
  await getDetector(o.model, (p) => o.onProgress?.(p))
  const clips: Omit<Clip, 'id' | 'sessionId'>[] = []
  // Prefer the true side view: it's the primary angle for programmatic judging
  const ordered = [...o.clips].sort((a, b) => (a.angle === 'side' ? -1 : b.angle === 'side' ? 1 : 0))
  for (let ci = 0; ci < ordered.length; ci++) {
    const d = ordered[ci]
    o.onPhase?.('pose', ci)
    o.onProgress?.(0)
    let tick = 0
    const data = await extractFrames(d.file, {
      fps: 12,
      model: o.model,
      barSeed: d.seed,
      posture: isBig3(o.lift) ? (o.lift === 'bench' ? 'lying' : 'upright') : PATTERNS[o.exercise!.pattern!].posture,
      signal: o.signal,
      gate: o.gate,
      onProgress: ({ done, total, frame, canvas }) => {
        o.onProgress?.(done / total)
        if (++tick % 2 || !canvas) return
        o.onFrame?.(canvas, frame ?? null)
      },
    })
    o.onPhase?.('rules', ci)
    const analysis = isBig3(o.lift)
      ? analyzeClip(o.lift, d.angle, data)
      : analyzeMovement(o.exercise!.pattern!, d.angle, data, { unilateral: o.exercise!.unilateral, hold: o.exercise!.hold, label: o.exercise!.name })
    o.onPhase?.('keyframes', ci)
    const keyframes = await renderKeyframes(d.file, data.frames, analysis, d.angle === 'side' ? 4 : 2)
    clips.push({ angle: d.angle, video: d.file, fileName: d.file.name, analysis, keyframes, pose: pack(data.frames, data.fps) })
  }
  o.onPhase?.('save', ordered.length - 1)
  const main = clips.find((c) => c.angle === 'side') ?? clips[0]
  const session: Session = {
    date: todayISO(),
    createdAt: Date.now(),
    lift: o.lift,
    ...(o.exercise ? { exercise: o.exercise } : {}),
    ...(main.analysis.holdS != null ? { holdS: main.analysis.holdS } : {}),
    equipment: o.equipment,
    weightKg: o.weightKg,
    reps: main.analysis.reps.length,
    rpe: o.rpe,
    notes: o.notes,
    score: scoreFindings(clips.flatMap((c) => c.analysis.findings)),
    issues: issuesOf(clips.flatMap((c) => c.analysis.findings)),
    coachId: await getSetting<string | null>('defaultCoach', 'coach-nsca-cscs'),
    agent: null,
    ...(o.workout ? { workout: o.workout } : {}),
  }
  const id = await db.transaction('rw', db.sessions, db.clips, async () => {
    const sid = (await db.sessions.add(session)) as number
    await db.clips.bulkAdd(clips.map((c) => ({ ...c, sessionId: sid })))
    return sid
  })
  requestPersist() // On first data, request persistent storage so the browser won't evict it when space is tight
  o.onPhase?.('done', ordered.length - 1)
  return { id, session: { ...session, id } }
}
