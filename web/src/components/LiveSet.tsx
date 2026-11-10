import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Bone, CameraOff, Check, Loader2, RefreshCcw, Square, SwitchCamera, Volume2, VolumeX, X } from 'lucide-react'
import { createLiveCounter, type LiveRep, type LiveState } from '../lib/movement/live'
import { PATTERNS } from '../lib/movement/patterns'
import type { PatternId } from '../lib/movement/types'
import { getDetector, type PoseDetector } from '../lib/pose'
import type { NL } from '../lib/rtmo'
import { drawSkeleton } from '../lib/draw'
import { CameraError, countCameras, createRecorder, createWakeLock, openCamera, sourceToFile, stopStream, type Facing, type Recorder } from '../lib/live/camera'
import { beep, cancelSpeech, isMuted, say, setMuted, unlockAudio, zhNum } from '../lib/live/voice'

export interface LiveResult {
  file: File | null
  reps: number
  holdS: number | null
  durationS: number
  repsDetail: LiveRep[]
}

export interface LiveSetProps {
  patternId: PatternId
  unilateral?: boolean
  hold?: boolean
  /** Exercise name, e.g. barbell curl */
  label: string
  /** Target reps: auto-ends ~2.5s after reaching it (keeps counting if you continue) */
  targetReps?: number
  /** Target seconds for a static hold */
  targetSec?: number
  /** Dev/testing: use this video instead of the camera (same pipeline; the "recorded video" is the video itself) */
  source?: File | string
  onCancel: () => void
  onFinish: (r: LiveResult) => void
}

type Stage = 'setup' | 'countdown' | 'live' | 'saving'

const DETECT_FPS = 15
const DETECT_MAX_W = 640
const AUTO_FINISH_MS = 2500
const SKELETON_KEY = 'liftlens.live.skeleton'

const readSkeletonPref = () => {
  try {
    return localStorage.getItem(SKELETON_KEY) !== '0'
  } catch {
    return true
  }
}

// ------------------------------------------------------------------ Person selection (slimmed-down version of the offline pickLifter approach)

const hipOf = (p: NL) => ({ x: (p[23].x + p[24].x) / 2, y: (p[23].y + p[24].y) / 2 })
const torsoLying = (p: NL) => {
  const dx = (p[11].x + p[12].x) / 2 - (p[23].x + p[24].x) / 2
  const dy = (p[11].y + p[12].y) / 2 - (p[23].y + p[24].y) / 2
  return Math.abs(dy) < (Math.abs(dx) * 16) / 9
}
const bodyArea = (p: NL) => {
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0
  for (const q of p) {
    if ((q.visibility ?? 1) < 0.3) continue
    x0 = Math.min(x0, q.x)
    x1 = Math.max(x1, q.x)
    y0 = Math.min(y0, q.y)
    y1 = Math.max(y1, q.y)
  }
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
}

/** Pick the largest person in frame first; then track the same person by hip-position continuity so passers-by aren't taken for the lifter. */
function pickLifter(poses: NL[], lastHip: { x: number; y: number } | null, posture: 'upright' | 'lying') {
  if (!poses.length) return null
  const jump = (p: NL) => (lastHip ? Math.hypot(hipOf(p).x - lastHip.x, hipOf(p).y - lastHip.y) : 0)
  const score = (p: NL) => (lastHip ? jump(p) * 2 : -bodyArea(p)) + (torsoLying(p) === (posture === 'lying') ? 0 : 0.6)
  const best = poses.reduce((a, p) => (score(p) < score(a) ? p : a))
  if (lastHip && jump(best) > 0.2) return null
  return best
}

const toFlat = (pose: NL) => {
  const lm = new Float32Array(33 * 3)
  pose.forEach((p, k) => {
    lm[k * 3] = p.x
    lm[k * 3 + 1] = p.y
    lm[k * 3 + 2] = p.visibility ?? 0
  })
  return lm
}

/**
 * One-Euro-style landmark smoothing for the live view: still joints get heavy smoothing (no jitter),
 * fast-moving ones almost none (no lag at the turnaround of a rep). Low-confidence points lean on
 * their previous position instead of jumping to a guess.
 */
function smoothLm(prev: Float32Array | null, cur: Float32Array, dtMs: number) {
  if (!prev) return cur
  const out = new Float32Array(cur.length)
  const dt = Math.max(1, dtMs) / 1000
  for (let k = 0; k < 33; k++) {
    const i = k * 3
    const vis = cur[i + 2]
    const speed = Math.hypot(cur[i] - prev[i], cur[i + 1] - prev[i + 1]) / dt // frame-widths / s
    const cutoff = 1.2 + 6 * speed // Hz
    let a = 1 / (1 + 1 / (2 * Math.PI * cutoff * dt))
    if (vis < 0.5) a *= Math.max(0.2, vis * 2)
    out[i] = prev[i] + a * (cur[i] - prev[i])
    out[i + 1] = prev[i + 1] + a * (cur[i + 1] - prev[i + 1])
    out[i + 2] = vis
  }
  return out
}

/** live model: "standard" is noticeably steadier; "lite" for older phones that can't keep up */
export type LiveModel = 'lite' | 'full'

const fmtClock = (s: number) => {
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${String(r).padStart(2, '0')}`
}

// ------------------------------------------------------------------ Component

export function LiveSet(props: LiveSetProps) {
  if (typeof document === 'undefined') return null
  return createPortal(<LiveSetInner {...props} />, document.body)
}

interface Hud {
  /** Person visible but not lying down yet (lying exercises) */
  gated: boolean
  tracking: boolean
  inFrame: boolean
  reps: number
  progress: number
  phase: LiveState['phase']
  holdS: number
  last?: LiveRep
  /** Static hold: body-line cue */
  holdCue?: string
}
const HUD0: Hud = { gated: false, tracking: false, inFrame: false, reps: 0, progress: 0, phase: 'idle', holdS: 0 }

function LiveSetInner({ patternId, unilateral, hold, label, targetReps, targetSec, source, onCancel, onFinish }: LiveSetProps) {
  const pattern = PATTERNS[patternId]
  const isHold = !!hold || patternId === 'isometric-hold'
  // Crunches/sit-ups raise the torso itself, so "lying down" can't be used as a gate
  const postureGate = pattern.posture === 'lying' && patternId !== 'core-flexion'
  const reduce = useReducedMotion()

  const [stage, setStage] = useState<Stage>('setup')
  const [facing, setFacing] = useState<Facing>('environment')
  const [mediaKey, setMediaKey] = useState(0) // increment = reopen the camera
  const [camError, setCamError] = useState<string | null>(null)
  const [mediaReady, setMediaReady] = useState(false)
  const [cams, setCams] = useState(0)
  const [model, setModel] = useState<{ ready: boolean; progress: number; error?: string }>({ ready: false, progress: 0 })
  const [liveModel, setLiveModel] = useState<LiveModel>(() => {
    try {
      return (localStorage.getItem('ll-live-model') as LiveModel) || 'full'
    } catch {
      return 'full'
    }
  })
  const switchModel = () =>
    setLiveModel((m) => {
      const next: LiveModel = m === 'full' ? 'lite' : 'full'
      try {
        localStorage.setItem('ll-live-model', next)
      } catch {
        /* private mode */
      }
      R.current.smooth = null
      return next
    })
  const [hud, setHud] = useState<Hud>(HUD0)
  const [flash, setFlash] = useState<{ id: number; ok: boolean } | null>(null)
  const [lastCue, setLastCue] = useState<string | null>(null)
  const [muted, setMutedState] = useState(isMuted)
  const [showSkeleton, setShowSkeleton] = useState(readSkeletonPref)
  const [count, setCount] = useState(3)
  const [elapsed, setElapsed] = useState(0)
  const [paused, setPaused] = useState(false)
  const [autoAt, setAutoAt] = useState<number | null>(null)
  const [keepGoing, setKeepGoing] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [targetHit, setTargetHit] = useState(false)
  const [slowCam, setSlowCam] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const detCanvas = useMemo(() => document.createElement('canvas'), [])
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<Recorder | null>(null)
  const detectorRef = useRef<PoseDetector | null>(null)
  const counter = useMemo(() => createLiveCounter(patternId, { unilateral, hold: isHold }), [patternId, unilateral, isHold])
  const wake = useMemo(() => createWakeLock(), [])

  // Mutable state read in the frame loop (doesn't trigger re-renders)
  const R = useRef({
    stage: 'setup' as Stage,
    hidden: false,
    showSkeleton: true,
    lastHip: null as { x: number; y: number } | null,
    smooth: null as Float32Array | null,
    smoothAt: 0,
    rejected: 0,
    lastTracked: -1e9,
    mediaLast: 0,
    mediaOffset: 0,
    startedAt: 0,
    pausedMs: 0,
    pauseStart: 0,
    repsDetail: [] as LiveRep[],
    last: null as LiveState | null,
    autoAt: null as number | null,
    keepGoing: false,
    targetHit: false,
    holdAnnounced: 0,
    lastHoldCueAt: 0,
    lastSpokenCue: null as string | null,
    gated: false,
    finished: false,
    timers: [] as number[],
  })
  const cbs = useRef({ onCancel, onFinish })

  // ---------------------------------------------------------------- Lifecycle: wake lock / no scroll / cleanup on unmount
  useEffect(() => {
    wake.acquire()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const r = R.current
    return () => {
      wake.release()
      document.body.style.overflow = prevOverflow
      r.timers.forEach(clearTimeout)
      cancelSpeech()
      void recorderRef.current?.stop()
      recorderRef.current = null
      stopStream(streamRef.current)
      streamRef.current = null
    }
  }, [wake])

  // ---------------------------------------------------------------- Pose model (~5MB download the first time)
  useEffect(() => {
    let alive = true
    setModel({ ready: false, progress: 0 })
    getDetector(liveModel, (p) => alive && setModel((m) => (m.ready ? m : { ...m, progress: p })))
      .then((d) => {
        if (!alive) return
        detectorRef.current = d
        setModel({ ready: true, progress: 1 })
      })
      .catch((e) => alive && setModel({ ready: false, progress: 0, error: (e as Error)?.message ?? String(e) }))
    return () => {
      alive = false
    }
  }, [liveModel])

  // ---------------------------------------------------------------- Video source: camera or dev video
  useEffect(() => {
    const v = videoRef.current!
    let alive = true
    let url: string | null = null
    setMediaReady(false)
    setCamError(null)
    const ready = () => alive && setMediaReady(true)
    v.addEventListener('loadeddata', ready)
    if (source) {
      url = typeof source === 'string' ? null : URL.createObjectURL(source)
      v.srcObject = null
      v.src = url ?? (source as string)
      v.loop = true // Loop preview while getting ready; play once from the start after starting
      v.muted = true
      v.play().catch(() => {})
    } else {
      openCamera(facing)
        .then((s) => {
          if (!alive) return stopStream(s)
          streamRef.current = s
          v.srcObject = s
          v.play().catch(() => {})
          void countCameras().then((n) => alive && setCams(n))
          s.getVideoTracks()[0]?.addEventListener('ended', () => {
            // Camera reclaimed by the system (iOS backgrounding, incoming call…): if in progress, finish and save; if getting ready, reopen it
            if (!alive) return
            if (R.current.stage === 'live') finishRef.current()
            else if (R.current.stage === 'setup' && !document.hidden) setMediaKey((k) => k + 1)
          })
        })
        .catch((e) => alive && setCamError(e instanceof CameraError ? e.message : `摄像头打开失败：${(e as Error)?.message ?? e}`))
    }
    return () => {
      alive = false
      v.removeEventListener('loadeddata', ready)
      if (!source) {
        stopStream(streamRef.current)
        streamRef.current = null
        v.srcObject = null
      } else {
        v.pause()
        v.removeAttribute('src')
        v.load()
      }
      if (url) URL.revokeObjectURL(url)
    }
  }, [source, facing, mediaKey])

  // No camera frame after 2.5s: most likely waiting on the permission prompt
  useEffect(() => {
    setSlowCam(false)
    if (mediaReady || camError || source) return
    const id = window.setTimeout(() => setSlowCam(true), 2500)
    return () => clearTimeout(id)
  }, [mediaReady, camError, source, mediaKey])

  // ---------------------------------------------------------------- Finish / discard
  const finish = useCallback(async () => {
    const r = R.current
    if (r.finished || r.stage !== 'live') return
    r.finished = true
    r.timers.forEach(clearTimeout)
    setStage('saving')
    r.stage = 'saving'
    const now = performance.now()
    if (r.hidden) r.pausedMs += now - r.pauseStart
    const durationS = Math.max(0, Math.round((now - r.startedAt - r.pausedMs) / 100) / 10)
    videoRef.current?.pause()
    let file: File | null = null
    if (source) file = await sourceToFile(source)
    else {
      file = (await recorderRef.current?.stop()) ?? null
      recorderRef.current = null
    }
    stopStream(streamRef.current)
    streamRef.current = null
    wake.release()
    const st = r.last
    cbs.current.onFinish({
      file,
      reps: isHold ? 0 : (st?.reps ?? r.repsDetail.length),
      holdS: isHold ? Math.round((st?.holdS ?? 0) * 10) / 10 : null,
      durationS,
      repsDetail: r.repsDetail,
    })
  }, [source, isHold, wake])
  const finishRef = useRef(finish)
  // Latest values for the frame loop / event callbacks (synced after render)
  useLayoutEffect(() => {
    R.current.stage = stage
    R.current.showSkeleton = showSkeleton
    R.current.keepGoing = keepGoing
    cbs.current = { onCancel, onFinish }
    finishRef.current = finish
  })

  const cancel = () => {
    R.current.finished = true
    cancelSpeech()
    cbs.current.onCancel()
  }

  // ---------------------------------------------------------------- Per frame: rep counting + feedback
  const onPose = useCallback(
    (lm: Float32Array | null, t: number) => {
      const r = R.current
      const now = performance.now()
      const st = counter.push(lm, t)
      r.last = st
      if (st.tracking) r.lastTracked = now
      const inFrame = now - r.lastTracked < 600
      let holdCue: string | undefined

      if (r.stage === 'live') {
        if (st.justDone) {
          const rep = st.justDone
          r.repsDetail.push(rep)
          const ok = rep.cues.length === 0
          setFlash({ id: rep.index, ok })
          setLastCue(ok ? null : rep.cues.join(' · '))
          beep(ok ? 'rep' : 'warn')
          say(zhNum(st.reps), 'count')
          // Don't speak the same cue twice in a row (still shown on screen) to avoid repeating the same line every rep
          if (!ok && rep.cues[0] !== r.lastSpokenCue) {
            say(rep.cues[0], 'cue')
            r.lastSpokenCue = rep.cues[0]
          } else r.lastSpokenCue = ok ? null : ''
          if (targetReps) {
            const left = targetReps - st.reps
            if (left === 2 && targetReps > 3) say('还剩两次', 'info')
            if (left === 0 && !r.targetHit) {
              r.targetHit = true
              setTargetHit(true)
              say('完成', 'info')
              beep('done')
            }
            if (left <= 0 && !r.keepGoing) {
              r.autoAt = now + AUTO_FINISH_MS
              setAutoAt(r.autoAt)
            }
          }
        }
        if (isHold) {
          const s = st.holdS ?? 0
          holdCue = st.last?.cues[0]
          if (holdCue && now - r.lastHoldCueAt > 4000) {
            r.lastHoldCueAt = now
            say(holdCue, 'cue')
          }
          const whole = Math.floor(s)
          if (targetSec) {
            if (targetSec > 15 && whole === targetSec - 10 && r.holdAnnounced < whole) say('还剩十秒', 'info')
            if (whole >= targetSec - 3 && whole < targetSec && r.holdAnnounced < whole) beep('tick')
            if (whole >= targetSec && !r.targetHit) {
              r.targetHit = true
              setTargetHit(true)
              say('时间到', 'info')
              beep('done')
              if (!r.keepGoing) {
                r.autoAt = now + AUTO_FINISH_MS
                setAutoAt(r.autoAt)
              }
            }
          } else if (whole > 0 && whole % 10 === 0 && r.holdAnnounced < whole) say(`${zhNum(whole)}秒`, 'info')
          r.holdAnnounced = Math.max(r.holdAnnounced, whole)
        }
        // Still moving after hitting the target (doing another rep): postpone auto-finish
        if (r.autoAt && !isHold && st.phase === 'moving' && r.autoAt - now < 1500) {
          r.autoAt = now + 1500
          setAutoAt(r.autoAt)
        }
      }
      setHud({ gated: r.gated, tracking: st.tracking, inFrame, reps: st.reps, progress: st.progress, phase: st.phase, holdS: st.holdS ?? 0, last: st.last, holdCue })
    },
    [counter, isHold, targetReps, targetSec],
  )

  // Skeleton overlay
  const drawOverlay = useCallback((lm: Float32Array | null, w: number, h: number) => {
    const c = overlayRef.current
    if (!c) return
    if (c.width !== w || c.height !== h) {
      c.width = w
      c.height = h
    }
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, w, h)
    if (lm && R.current.showSkeleton) drawSkeleton(ctx, lm, w, h, { lw: Math.max(2.5, w / 200) })
  }, [])

  useEffect(() => {
    if (!showSkeleton) overlayRef.current?.getContext('2d')?.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height)
  }, [showSkeleton])

  // ---------------------------------------------------------------- Detection loop (~15fps)
  useEffect(() => {
    if (!model.ready || !mediaReady) return
    const v = videoRef.current!
    const det = detectorRef.current!
    const ctx = detCanvas.getContext('2d', { willReadFrequently: true })!
    let alive = true
    let busy = false
    let lastAt = 0
    let handle = 0
    const useVfc = typeof v.requestVideoFrameCallback === 'function'
    const schedule = () => {
      if (!alive) return
      handle = useVfc ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(tick)
    }
    const tick = (now: number) => {
      if (!alive) return
      const r = R.current
      schedule()
      if (busy || r.hidden || r.stage === 'saving' || !v.videoWidth || v.readyState < 2) return
      if (now - lastAt < 1000 / DETECT_FPS - 5) return
      lastAt = now
      busy = true
      const scale = Math.min(1, DETECT_MAX_W / v.videoWidth)
      const w = Math.round(v.videoWidth * scale)
      const h = Math.round(v.videoHeight * scale)
      if (detCanvas.width !== w || detCanvas.height !== h) {
        detCanvas.width = w
        detCanvas.height = h
      }
      ctx.drawImage(v, 0, 0, w, h)
      // Timeline: wall clock for the camera; media time for video (offset on loop/replay to stay monotonic)
      let t = performance.now()
      if (source) {
        const m = v.currentTime * 1000
        if (m < r.mediaLast - 1) r.mediaOffset += r.mediaLast - m + 100
        r.mediaLast = m
        t = m + r.mediaOffset
      }
      det
        .detect(detCanvas)
        .then((people) => {
          if (!alive) return
          const pose = pickLifter(people, r.lastHip, pattern.posture)
          if (pose) {
            r.lastHip = hipOf(pose)
            r.rejected = 0
          } else if (people.length && ++r.rejected > DETECT_FPS * 1.5) {
            // Original person not matched for 1.5s: drop continuity and re-pick the largest person
            r.lastHip = null
            r.rejected = 0
          } else if (!people.length && ++r.rejected > DETECT_FPS * 3) {
            r.lastHip = null
            r.rejected = 0
          }
          const raw = pose ? toFlat(pose) : null
          const lm = raw ? smoothLm(r.smooth, raw, t - r.smoothAt) : null
          r.smooth = lm
          r.smoothAt = t
          drawOverlay(lm, w, h)
          // Lying exercises (bench press/hip thrust/push-up…): don't count while sitting/standing (getting on/off the bench, adjusting); start once lying down
          const gated = !!lm && postureGate && !torsoLying(pose!)
          r.gated = gated
          onPose(gated ? null : lm, t)
        })
        .catch(() => {})
        .finally(() => {
          busy = false
        })
    }
    schedule()
    return () => {
      alive = false
      if (useVfc) v.cancelVideoFrameCallback?.(handle)
      else cancelAnimationFrame(handle)
    }
  }, [model.ready, mediaReady, detCanvas, source, pattern.posture, postureGate, onPose, drawOverlay])

  // ---------------------------------------------------------------- Backgrounded: pause
  useEffect(() => {
    const onVis = () => {
      const r = R.current
      const v = videoRef.current
      if (document.hidden) {
        if (r.hidden) return
        r.hidden = true
        r.pauseStart = performance.now()
        setPaused(true)
        cancelSpeech()
        if (r.stage === 'live') {
          recorderRef.current?.pause()
          if (source) v?.pause()
        }
      } else {
        if (!r.hidden) return
        r.hidden = false
        if (r.stage === 'live') r.pausedMs += performance.now() - r.pauseStart
        setPaused(false)
        if (r.stage === 'live') recorderRef.current?.resume()
        if (source || r.stage !== 'saving') v?.play().catch(() => {})
        // On iOS the camera may have been reclaimed when returning to foreground
        const track = streamRef.current?.getVideoTracks()[0]
        if (!source && track && track.readyState === 'ended') {
          if (r.stage === 'live') finishRef.current()
          else setMediaKey((k) => k + 1)
        }
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [source])

  // ---------------------------------------------------------------- Timer / auto-finish
  useEffect(() => {
    if (stage !== 'live') return
    const id = window.setInterval(() => {
      const r = R.current
      if (r.hidden) return
      const now = performance.now()
      setElapsed((now - r.startedAt - r.pausedMs) / 1000)
      if (r.autoAt && !r.keepGoing && now >= r.autoAt && (isHold || r.last?.phase !== 'moving')) finishRef.current()
    }, 200)
    return () => clearInterval(id)
  }, [stage, isHold])

  // Video source ended = set finished
  useEffect(() => {
    const v = videoRef.current!
    if (!source || stage !== 'live') return
    const onEnd = () => finishRef.current()
    v.addEventListener('ended', onEnd)
    return () => v.removeEventListener('ended', onEnd)
  }, [source, stage])

  // ---------------------------------------------------------------- Start: 3-2-1 countdown
  const start = () => {
    unlockAudio() // Must be called synchronously in the click handler (iOS)
    const r = R.current
    setStage('countdown')
    r.stage = 'countdown'
    setCount(3)
    beep('tick')
    say('三', 'count')
    const at = (ms: number, fn: () => void) => r.timers.push(window.setTimeout(fn, ms))
    at(1000, () => {
      setCount(2)
      beep('tick')
      say('二', 'count')
    })
    at(2000, () => {
      setCount(1)
      beep('tick')
      say('一', 'count')
    })
    at(3000, () => {
      if (r.finished) return
      beep('go')
      say('开始', 'count')
      counter.reset()
      r.repsDetail = []
      r.last = null
      r.autoAt = null
      r.targetHit = false
      r.holdAnnounced = 0
      r.lastSpokenCue = null
      r.startedAt = performance.now()
      r.pausedMs = 0
      if (r.hidden) r.pauseStart = r.startedAt
      const v = videoRef.current!
      if (source) {
        v.loop = false
        v.currentTime = 0
        v.play().catch(() => {})
      } else if (streamRef.current) {
        recorderRef.current = createRecorder(streamRef.current, `liftlens-${patternId}`)
        recorderRef.current?.start()
      }
      setHud((h) => ({ ...h, reps: 0, progress: 0, holdS: 0, last: undefined }))
      setElapsed(0)
      setStage('live')
      r.stage = 'live'
    })
  }

  const toggleMute = () => {
    const m = !muted
    setMuted(m)
    setMutedState(m)
    if (!m) unlockAudio()
  }
  const toggleSkeleton = () => {
    const s = !showSkeleton
    setShowSkeleton(s)
    try {
      localStorage.setItem(SKELETON_KEY, s ? '1' : '0')
    } catch {
      /* ignore */
    }
  }
  const continueSet = () => {
    R.current.keepGoing = true
    R.current.autoAt = null
    setKeepGoing(true)
    setAutoAt(null)
  }

  // ---------------------------------------------------------------- Render
  const mirror = !source && facing === 'user'
  const lying = pattern.posture === 'lying'
  const live = stage === 'live'
  const ringValue = isHold ? (targetSec ? Math.min(1, hud.holdS / targetSec) : (hud.holdS % 60) / 60) : hud.progress
  const outOfFrame = live && !hud.inFrame
  const autoArmed = autoAt != null && !keepGoing

  return (
    <div
      className="fixed inset-0 z-[90] flex flex-col overflow-hidden bg-black text-fg select-none"
      role="dialog"
      aria-modal="true"
      aria-label={`实时计次 · ${label}`}
    >
      {/* Video */}
      <div className="absolute inset-0">
        <video ref={videoRef} playsInline muted autoPlay className={`absolute inset-0 h-full w-full object-contain ${mirror ? '-scale-x-100' : ''}`} />
        <canvas ref={overlayRef} className={`pointer-events-none absolute inset-0 h-full w-full object-contain ${mirror ? '-scale-x-100' : ''}`} />
        {/* Top/bottom gradients keep white text legible over any footage */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/75 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/85 to-transparent" />
      </div>

      {/* Each completed rep flashes the frame edge (green = clean, amber = has a cue) */}
      <AnimatePresence>
        {flash && live && (
          <motion.div
            key={flash.id}
            className="pointer-events-none absolute inset-0 z-10"
            style={{
              boxShadow: `inset 0 0 0 ${reduce ? 4 : 8}px ${flash.ok ? 'rgba(74,222,128,0.9)' : 'rgba(255,184,77,0.95)'}, inset 0 0 120px ${flash.ok ? 'rgba(74,222,128,0.35)' : 'rgba(255,184,77,0.4)'}`,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: reduce ? 0.6 : 0.9, times: [0, 0.15, 1] }}
            onAnimationComplete={() => setFlash((f) => (f?.id === flash.id ? null : f))}
          />
        )}
      </AnimatePresence>

      {/* Top bar */}
      <div className="relative z-20 flex items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
        <IconBtn
          label={confirmCancel ? '再点一次放弃这组' : live ? '放弃这组' : '关闭'}
          onClick={() => {
            if (!live || confirmCancel) return cancel()
            setConfirmCancel(true)
            R.current.timers.push(window.setTimeout(() => setConfirmCancel(false), 2500))
          }}
          className={confirmCancel ? 'w-auto gap-1.5 border-bad/60 bg-bad/20 px-3 text-bad' : ''}
        >
          <X size={20} />
          {confirmCancel && <span className="text-xs font-semibold">放弃？</span>}
        </IconBtn>
        <div className="min-w-0 flex-1 px-1">
          <div className="truncate text-[15px] font-semibold leading-tight">{label}</div>
          <div className="truncate font-mono text-[11px] text-mute">
            {pattern.zh}
            {unilateral ? ' · 单侧' : ''}
            {live && <> · <span className="text-fg">{fmtClock(elapsed)}</span></>}
          </div>
        </div>
        <button
          onClick={switchModel}
          disabled={live}
          aria-label={`识别模型：${liveModel === 'full' ? '标准' : '轻量'}，点击切换`}
          className="flex h-11 shrink-0 items-center gap-1 rounded-full border border-white/10 bg-black/45 px-3 text-xs text-fg backdrop-blur-md disabled:opacity-50"
        >
          {!model.ready && !model.error && <Loader2 size={12} className="animate-spin" />}
          {liveModel === 'full' ? '标准' : '轻量'}
        </button>
        <IconBtn label={showSkeleton ? '隐藏骨架' : '显示骨架'} onClick={toggleSkeleton} active={showSkeleton}>
          <Bone size={18} />
        </IconBtn>
        <IconBtn label={muted ? '打开声音' : '静音'} onClick={toggleMute} active={!muted}>
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </IconBtn>
        {!source && !camError && stage === 'setup' && cams !== 1 && (
          <IconBtn label="切换前后摄像头" onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}>
            <SwitchCamera size={18} />
          </IconBtn>
        )}
      </div>

      {camError ? (
        <CameraErrorView message={camError} onRetry={() => setMediaKey((k) => k + 1)} onCancel={cancel} />
      ) : (
        <>
          {/* Getting ready: framing box + body outline hint */}
          {stage === 'setup' && <FrameGuide lying={lying} ok={hud.inFrame} />}

          {/* Countdown */}
          <AnimatePresence>
            {stage === 'countdown' && (
              <motion.div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <motion.div
                  key={count}
                  className="font-display text-[34vmin] font-extrabold leading-none text-acid drop-shadow-[0_6px_30px_rgba(0,0,0,0.6)]"
                  initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.6 }}
                  animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                >
                  {count}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* In progress: main number + progress ring (top-center in portrait, left in landscape) */}
          {live && (
            <div className="pointer-events-none relative z-20 flex flex-1 flex-col items-center pt-2 landscape:absolute landscape:inset-y-0 landscape:left-[max(1rem,env(safe-area-inset-left))] landscape:justify-center landscape:pt-10">
              <Counter
                value={isHold ? hud.holdS : hud.reps}
                isHold={isHold}
                target={isHold ? targetSec : targetReps}
                ring={ringValue}
                dim={!hud.tracking}
                tone={flash ? (flash.ok ? 'good' : 'warn') : 'acid'}
                reduce={!!reduce}
              />
              <div className="mt-3 flex max-w-[86vw] flex-wrap items-center justify-center gap-2 landscape:max-w-[34vw]">
                {!isHold && hud.last && (
                  <span className="rounded-full bg-black/55 px-3 py-1 font-mono text-xs text-fg backdrop-blur">
                    离心 <span className={hud.last.eccentricS < 0.8 ? 'text-warn' : 'text-acid'}>{hud.last.eccentricS.toFixed(1)}s</span>
                    <span className="text-dim"> · </span>第 {hud.last.index} 次
                  </span>
                )}
                {isHold && hud.phase === 'rest' && hud.tracking && <span className="rounded-full bg-black/55 px-3 py-1 text-xs text-mute backdrop-blur">保持住，马上开始计时</span>}
              </div>
              <AnimatePresence mode="popLayout">
                {(isHold ? hud.holdCue : lastCue) && (
                  <motion.div
                    key={(isHold ? hud.holdCue : lastCue) ?? ''}
                    className="mt-2 max-w-[86vw] rounded-2xl border border-warn/50 bg-warn/15 px-4 py-2 text-center text-lg font-semibold text-warn backdrop-blur-md landscape:max-w-[34vw]"
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                  >
                    {isHold ? hud.holdCue : lastCue}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Out-of-frame warning */}
          <AnimatePresence>
            {(outOfFrame || paused) && (stage === 'live' || stage === 'countdown') && (
              <motion.div
                className="pointer-events-none absolute inset-x-0 top-1/2 z-30 flex -translate-y-1/2 justify-center px-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="rounded-2xl border border-warn/40 bg-black/70 px-5 py-3 text-center backdrop-blur-md">
                  <div className="text-base font-semibold text-warn">{paused ? '已暂停' : hud.gated ? '躺好后接着计数' : '看不到你了'}</div>
                  <div className="mt-0.5 text-xs text-mute">{paused ? '回到这个页面后继续计数' : hud.gated ? '坐起来/上下凳时不计次' : '回到画面里，计数会接着来'}</div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex-1" />

          {/* Bottom controls */}
          <div className="relative z-20 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] landscape:absolute landscape:inset-y-0 landscape:right-0 landscape:flex landscape:w-[min(22rem,40vw)] landscape:flex-col landscape:justify-end">
            {stage === 'setup' && (
              <SetupPanel
                tip={pattern.camera.tip}
                angle={pattern.camera.angle}
                inFrame={hud.inFrame}
                gated={hud.gated}
                model={model}
                mediaReady={mediaReady}
                slowCam={slowCam}
                onStart={start}
                isHold={isHold}
                target={isHold ? targetSec : targetReps}
              />
            )}
            {stage === 'countdown' && (
              <div className="mx-auto max-w-md text-center text-sm text-mute">
                {hud.inFrame ? '准备好，倒计时结束开始计数' : <span className="text-warn">请站进画面里</span>}
              </div>
            )}
            {live && (
              <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3">
                <AnimatePresence>
                  {autoArmed && (
                    <motion.div
                      className="flex w-full items-center gap-3 rounded-2xl border border-good/40 bg-black/70 px-4 py-2.5 backdrop-blur-md"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                    >
                      <Check size={18} className="shrink-0 text-good" />
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="font-semibold text-good">{isHold ? '时间到' : '目标完成'}</div>
                        <div className="text-xs text-mute">马上自动结束 · {isHold ? '想多撑一会' : '想多做几次'}点右边</div>
                      </div>
                      <button className="pointer-events-auto h-10 shrink-0 rounded-full border border-line-2 px-4 text-sm font-semibold" onClick={continueSet}>
                        继续
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
                <button
                  onClick={() => void finish()}
                  className="group flex h-[4.5rem] w-full max-w-xs items-center justify-center gap-3 rounded-full bg-fg text-lg font-bold text-ink shadow-[0_10px_40px_rgba(0,0,0,0.5)] transition-transform active:scale-[0.97]"
                >
                  <Square size={20} className="fill-current" />
                  {targetHit ? '完成这组' : '结束这组'}
                </button>
              </div>
            )}
            {stage === 'saving' && (
              <div className="mx-auto flex max-w-md items-center justify-center gap-2 py-6 text-sm text-mute">
                <Loader2 size={18} className="animate-spin" /> 正在保存视频…
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ Subcomponents

function IconBtn({ children, label, onClick, active, className = '' }: { children: React.ReactNode; label: string; onClick: () => void; active?: boolean; className?: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/45 text-fg backdrop-blur-md transition-colors active:scale-95 ${active === false ? 'text-mute' : ''} ${className}`}
    >
      {children}
    </button>
  )
}

function Counter({ value, isHold, target, ring, dim, tone, reduce }: { value: number; isHold: boolean; target?: number; ring: number; dim: boolean; tone: 'acid' | 'good' | 'warn'; reduce: boolean }) {
  const R = 46
  const C = 2 * Math.PI * R
  const color = tone === 'good' ? '#4ade80' : tone === 'warn' ? '#ffb84d' : '#c8ff3d'
  const shown = isHold ? Math.floor(value) : value
  return (
    <div className={`relative h-[min(46vw,15rem)] w-[min(46vw,15rem)] transition-opacity landscape:h-[min(44vh,15rem)] landscape:w-[min(44vh,15rem)] ${dim ? 'opacity-50' : ''}`}>
      <div className="absolute inset-[6%] rounded-full bg-black/45 backdrop-blur-md" />
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="5" />
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - Math.max(0, Math.min(1, ring)))}
          style={{ transition: reduce ? 'none' : 'stroke-dashoffset 90ms linear, stroke 200ms' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.div
          key={isHold ? 'hold' : value}
          className="font-display text-[min(24vw,7.5rem)] font-extrabold leading-none tabular-nums landscape:text-[min(22vh,7.5rem)]"
          style={{ color: tone === 'acid' ? '#e8efe9' : color }}
          initial={reduce || isHold ? false : { scale: 1.35 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 520, damping: 22 }}
        >
          {shown}
        </motion.div>
        <div className="mt-1 font-mono text-sm text-mute">
          {target ? (
            <>
              / {target}
              {isHold ? ' 秒' : ' 次'}
            </>
          ) : isHold ? (
            '秒'
          ) : (
            '次'
          )}
        </div>
      </div>
    </div>
  )
}

/** Framing box + translucent body outline: tells the user "your whole body must be inside this box" */
function FrameGuide({ lying, ok }: { lying: boolean; ok: boolean }) {
  const corners = [
    'left-0 top-0 border-r-0 border-b-0 rounded-tl-2xl',
    'right-0 top-0 border-l-0 border-b-0 rounded-tr-2xl',
    'right-0 bottom-0 border-l-0 border-t-0 rounded-br-2xl',
    'left-0 bottom-0 border-r-0 border-t-0 rounded-bl-2xl',
  ]
  return (
    <div className="pointer-events-none absolute inset-x-[6%] top-[11%] bottom-[36%] z-10 landscape:top-[16%] landscape:right-[calc(min(22rem,40vw)+2%)] landscape:bottom-[6%] landscape:left-[4%]">
      {corners.map((c) => (
        <span key={c} className={`absolute h-9 w-9 border-[3px] transition-colors duration-300 ${c} ${ok ? 'border-good' : 'border-acid/70'}`} />
      ))}
      <div className="absolute inset-[8%] flex items-center justify-center">
        <svg viewBox={lying ? '0 0 200 80' : '0 0 80 200'} className={`max-h-full max-w-full transition-opacity duration-500 ${ok ? 'opacity-15' : 'opacity-40'} ${lying ? 'w-full' : 'h-full'}`} aria-hidden>
          <g fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 5">
            {lying ? (
              // Lying (bench press / hip thrust / plank)
              <>
                <circle cx="24" cy="40" r="10" />
                <path d="M36 42 H120" />
                <path d="M120 42 L150 22 L180 52" />
                <path d="M60 40 L62 14 M66 40 L70 14" />
                <path d="M44 14 H90" strokeWidth="4" />
                <path d="M20 58 H170" strokeDasharray="2 6" />
              </>
            ) : (
              <>
                <circle cx="40" cy="20" r="11" />
                <path d="M40 32 V108" />
                <path d="M40 46 L20 84 M40 46 L60 84" />
                <path d="M40 108 L28 190 M40 108 L52 190" />
              </>
            )}
          </g>
        </svg>
      </div>
      <span className="sr-only">{ok ? '人已入画' : '请站进画面'}</span>
    </div>
  )
}

function SetupPanel({
  tip,
  angle,
  inFrame,
  gated,
  model,
  mediaReady,
  slowCam,
  onStart,
  isHold,
  target,
}: {
  tip: string
  angle: 'side' | 'front'
  inFrame: boolean
  gated?: boolean
  model: { ready: boolean; progress: number; error?: string }
  mediaReady: boolean
  slowCam?: boolean
  onStart: () => void
  isHold: boolean
  target?: number
}) {
  const loading = !model.ready && !model.error
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold backdrop-blur-md transition-colors ${
            inFrame ? 'border-good/50 bg-good/15 text-good' : 'border-warn/40 bg-black/50 text-warn'
          }`}
          aria-live="polite"
        >
          <span className={`h-2 w-2 rounded-full ${inFrame ? 'bg-good' : 'animate-pulse bg-warn'}`} />
          {!model.ready ? '等待模型…' : inFrame ? '人已入画 ✓' : gated ? '看到你了 · 躺好后开始计数' : '请站进画面'}
        </span>
        <span className="rounded-full border border-white/10 bg-black/50 px-3 py-1.5 text-xs text-mute backdrop-blur-md">{angle === 'side' ? '侧面机位' : '正面机位'}</span>
      </div>
      <div className="rounded-2xl border border-white/10 bg-black/55 p-3 text-sm leading-relaxed backdrop-blur-md">
        <div className="kicker mb-1 text-acid">摆好手机</div>
        <div className="text-fg">{tip}</div>
        <div className="mt-1 text-xs text-mute">手机竖放或横放都行，靠稳别晃。开始后会倒数 3 秒，每完成一次都会报数。</div>
      </div>
      {model.error ? (
        <div className="rounded-2xl border border-bad/40 bg-bad/10 p-3 text-sm text-bad">姿态模型加载失败：{model.error}。检查网络后重新打开。</div>
      ) : null}
      <button
        onClick={onStart}
        disabled={!model.ready || !mediaReady}
        className="relative flex h-16 w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-acid text-lg font-bold text-acid-ink shadow-[0_10px_40px_rgba(200,255,61,0.25)] transition-transform active:scale-[0.98] disabled:bg-panel-2 disabled:text-mute disabled:shadow-none"
      >
        {loading && <span className="absolute inset-y-0 left-0 bg-acid/25" style={{ width: `${Math.round(model.progress * 100)}%` }} />}
        <span className="relative flex items-center gap-2">
          {loading ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              {model.progress > 0 && model.progress < 1 ? `首次加载姿态模型 ${Math.round(model.progress * 100)}%` : '加载姿态模型…'}
            </>
          ) : !mediaReady ? (
            <>
              <Loader2 size={18} className="animate-spin" /> 打开摄像头…{slowCam ? '请在弹窗里允许使用' : ''}
            </>
          ) : (
            <>开始{target ? (isHold ? ` · 目标 ${target} 秒` : ` · 目标 ${target} 次`) : ''}</>
          )}
        </span>
      </button>
    </div>
  )
}

function CameraErrorView({ message, onRetry, onCancel }: { message: string; onRetry: () => void; onCancel: () => void }) {
  return (
    <div className="relative z-20 flex flex-1 items-center justify-center px-6">
      <div className="card w-full max-w-sm p-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-bad/15 text-bad">
          <CameraOff size={26} />
        </div>
        <div className="mt-4 text-lg font-semibold">打不开摄像头</div>
        <p className="mt-2 text-sm leading-relaxed text-mute">{message}</p>
        <p className="mt-3 text-xs text-dim">也可以先正常录一段视频，练完再到「上传分析」里分析，结果一样。</p>
        <div className="mt-5 flex justify-center gap-3">
          <button className="btn-ghost" onClick={onCancel}>
            返回
          </button>
          <button className="btn-acid" onClick={onRetry}>
            <RefreshCcw size={16} /> 重试
          </button>
        </div>
      </div>
    </div>
  )
}
