import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { PoseFrame } from './types'
import { BarTracker, type BarSeed } from './barTracker'
import { createRtmo, type NL } from './rtmo'

// MediaPipe Tasks (Google) — on-device pose estimation running in WASM/WebGL.
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm'

export type PoseModelId = 'lite' | 'full' | 'heavy' | 'rtmo-s' | 'rtmo-m'
export interface PoseModelDef {
  label: string
  engine: 'mediapipe' | 'rtmo'
  sizeMB: number
  note: string
  url: string
  /** RTMO input resolution */
  input?: number
  license: string
}
export const POSE_MODELS: Record<PoseModelId, PoseModelDef> = {
  lite: {
    engine: 'mediapipe',
    license: 'Apache-2.0',
    label: '轻量',
    sizeMB: 5.5,
    note: '最快，适合手机或长视频；遮挡时关节点抖动更明显',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  },
  full: {
    engine: 'mediapipe',
    license: 'Apache-2.0',
    label: '标准',
    sizeMB: 9,
    note: '速度与精度平衡（默认）',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
  },
  heavy: {
    engine: 'mediapipe',
    license: 'Apache-2.0',
    label: '高精度',
    sizeMB: 29,
    note: '杠铃片遮挡、多人入镜时更稳，速度约慢 2 倍',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task',
  },
  // OpenMMLab RTMO: one-stage multi-person model, much better on crowded frames / occlusion.
  'rtmo-s': {
    engine: 'rtmo',
    license: 'Apache-2.0',
    label: 'RTMO-s',
    sizeMB: 40,
    input: 640,
    note: 'OpenMMLab 多人模型：人多、遮挡时更稳；无脚跟/脚尖点（深蹲脚跟判定会跳过）',
    url: 'https://huggingface.co/Xenova/RTMO-s/resolve/main/onnx/model.onnx',
  },
  'rtmo-m': {
    engine: 'rtmo',
    license: 'Apache-2.0',
    label: 'RTMO-m',
    sizeMB: 89,
    input: 640,
    note: '精度更高、更慢，建议在支持 WebGPU 的 Chrome/Edge 上使用',
    url: 'https://huggingface.co/Xenova/RTMO-m/resolve/main/onnx/model.onnx',
  },
}

// Models are downloaded on demand and kept in Cache Storage (survives reloads,
// clearable from the UI) instead of being bundled with the app.
const CACHE = 'liftlens-models-v1'

export async function isModelCached(id: PoseModelId) {
  try {
    return !!(await (await caches.open(CACHE)).match(POSE_MODELS[id].url))
  } catch {
    return false
  }
}

export async function deleteModel(id: PoseModelId) {
  try {
    await (await caches.open(CACHE)).delete(POSE_MODELS[id].url)
  } catch {
    /* cache unavailable */
  }
  detectors.delete(id)
}

/** Download (with progress) or read from cache. */
export async function downloadModel(id: PoseModelId, onProgress?: (p: number) => void): Promise<Uint8Array> {
  const url = POSE_MODELS[id].url
  let cache: Cache | null = null
  try {
    cache = await caches.open(CACHE)
    const hit = await cache.match(url)
    if (hit) {
      onProgress?.(1)
      return new Uint8Array(await hit.arrayBuffer())
    }
  } catch {
    cache = null
  }
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`模型下载失败：HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || POSE_MODELS[id].sizeMB * 1024 * 1024
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    got += value.length
    onProgress?.(Math.min(0.99, got / total))
  }
  const buf = new Uint8Array(got)
  let off = 0
  for (const c of chunks) {
    buf.set(c, off)
    off += c.length
  }
  try {
    await cache?.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } }))
  } catch {
    /* quota / private mode: still usable for this session */
  }
  onProgress?.(1)
  return buf
}

/** Backend-agnostic detector: every engine returns MediaPipe-33-layout poses. */
export interface PoseDetector {
  id: PoseModelId
  backend: string
  detect: (canvas: HTMLCanvasElement) => Promise<NL[]>
}

/** one detector per model, kept: live mode (standard) and background analysis (lite) alternate without reloading */
const detectors = new Map<PoseModelId, Promise<PoseDetector>>()
// MediaPipe VIDEO mode needs strictly increasing timestamps for the lifetime of the
// landmarker, across clips — keep a global clock instead of per-video time.
let clockMs = 0

export function getDetector(id: PoseModelId = 'full', onProgress?: (p: number) => void): Promise<PoseDetector> {
  const cached = detectors.get(id)
  if (cached) return cached
  const def = POSE_MODELS[id]
  const promise = (async (): Promise<PoseDetector> => {
    if (def.engine === 'rtmo') {
      const model = await downloadModel(id, onProgress)
      const rt = await createRtmo(model, def.input ?? 640)
      return { id, backend: `onnxruntime-web · ${rt.provider}`, detect: rt.detect }
    }
    const [fileset, model] = await Promise.all([FilesetResolver.forVisionTasks(WASM), downloadModel(id, onProgress)])
    const make = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: model, delegate },
        runningMode: 'VIDEO',
        numPoses: 3,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })
    let lm: PoseLandmarker
    let delegate = 'GPU'
    try {
      lm = await make('GPU')
    } catch {
      delegate = 'CPU'
      lm = await make('CPU')
    }
    return {
      id,
      backend: `MediaPipe · ${delegate}`,
      detect: async (canvas) => {
        clockMs += 83
        return lm.detectForVideo(canvas, clockMs).landmarks
      },
    }
  })()
  detectors.set(id, promise)
  promise.catch(() => {
    if (detectors.get(id) === promise) detectors.delete(id)
  })
  return promise
}

export const LM = {
  nose: 0,
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
  lKnee: 25,
  rKnee: 26,
  lAnkle: 27,
  rAnkle: 28,
  lHeel: 29,
  rHeel: 30,
  lFoot: 31,
  rFoot: 32,
} as const

export const SKELETON: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
]

export interface ExtractProgress {
  done: number
  total: number
  frame?: PoseFrame
  canvas?: HTMLCanvasElement
}

function seek(video: HTMLVideoElement, t: number) {
  return new Promise<void>((resolve) => {
    // a seek to the current position never fires 'seeked'; a stalled one shouldn't hang the analysis
    if (Math.abs(video.currentTime - t) < 1e-3 && video.readyState >= 2) return resolve()
    const on = () => {
      clearTimeout(timer)
      video.removeEventListener('seeked', on)
      resolve()
    }
    const timer = setTimeout(on, 3000)
    video.addEventListener('seeked', on)
    video.currentTime = t
  })
}

export async function loadVideo(blob: Blob) {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  // iOS Safari won't load (or seek) a video that isn't in the document: keep it attached, invisible
  video.setAttribute('playsinline', '')
  video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1'
  document.body.appendChild(video)
  video.src = URL.createObjectURL(blob)
  video.load()
  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error('视频加载超时，请换成 mp4 / mov 重试')), 20000)
    video.onloadeddata = () => {
      clearTimeout(t)
      res()
    }
    video.onerror = () => {
      clearTimeout(t)
      rej(new Error('视频无法解码，请换成 mp4 / mov'))
    }
  })
  // webm recorded by MediaRecorder (Firefox etc.) has no duration in its header, so duration is Infinity:
  // seek far ahead so the browser scans the file to compute the real duration, then seek back to the start
  if (!Number.isFinite(video.duration)) {
    await new Promise<void>((res) => {
      const done = () => {
        video.removeEventListener('durationchange', check)
        res()
      }
      const check = () => Number.isFinite(video.duration) && done()
      video.addEventListener('durationchange', check)
      video.currentTime = 1e7
      setTimeout(done, 5000)
    })
    video.currentTime = 0
  }
  return video
}

/**
 * Sample the video at `fps`, run pose estimation + barbell color tracking on each frame.
 * Seek-based sampling is deterministic (same video → same result), unlike real-time playback.
 */
export async function extractFrames(
  blob: Blob,
  opts: {
    fps?: number
    model?: PoseModelId
    barSeed?: BarSeed | null
    posture?: 'lying' | 'upright'
    onProgress?: (p: ExtractProgress) => void
    signal?: AbortSignal
    gate?: () => Promise<void>
  },
) {
  const fps = opts.fps ?? 12
  const detector = await getDetector(opts.model ?? 'full')
  const video = await loadVideo(blob)
  const duration = video.duration
  const scale = Math.min(1, 640 / video.videoWidth)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const tracker = opts.barSeed ? new BarTracker(opts.barSeed, canvas.width, canvas.height) : null
  if (tracker && opts.barSeed) {
    // learn the marker + static look-alike blobs on the exact frame the user clicked
    await seek(video, Math.min(opts.barSeed.t, duration - 0.05))
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    tracker.init(ctx)
  }

  const frames: PoseFrame[] = []
  const total = Math.floor(duration * fps)
  let lastHip: { x: number; y: number } | null = null
  let lastWrist: { x: number; y: number } | null = null
  let rejected = 0
  for (let i = 0; i < total; i++) {
    if (opts.signal?.aborted) {
      video.remove()
      throw new DOMException('aborted', 'AbortError')
    }
    if (opts.gate) await opts.gate()
    const t = i / fps
    await seek(video, t)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const people = await detector.detect(canvas)
    // Gyms are crowded: detect up to 3 people and keep the *lifter* —
    // the pose whose wrists are nearest the barbell, with frame-to-frame continuity.
    const bar = tracker ? tracker.track(ctx, lastWrist) : null
    const pose = pickLifter(people, bar, lastHip, opts.posture)
    // after ~2s of rejected identities, drop the continuity prior and re-acquire
    if (!pose && people.length && ++rejected > fps * 2) {
      lastHip = null
      rejected = 0
    }
    if (pose) rejected = 0
    let lm: Float32Array | null = null
    if (pose) {
      lm = new Float32Array(33 * 3)
      pose.forEach((p, k) => {
        lm![k * 3] = p.x
        lm![k * 3 + 1] = p.y
        lm![k * 3 + 2] = p.visibility ?? 0
      })
      lastHip = { x: (pose[23].x + pose[24].x) / 2, y: (pose[23].y + pose[24].y) / 2 }
      lastWrist = { x: ((pose[15].x + pose[16].x) / 2) * canvas.width, y: ((pose[15].y + pose[16].y) / 2) * canvas.height }
    }
    const frame: PoseFrame = { t, lm, bar }
    frames.push(frame)
    opts.onProgress?.({ done: i + 1, total, frame, canvas })
  }
  URL.revokeObjectURL(video.src)
  video.remove()
  return { frames, fps, width: canvas.width, height: canvas.height, duration }
}


function torsoLying(p: NL) {
  const dx = (p[11].x + p[12].x) / 2 - (p[23].x + p[24].x) / 2
  const dy = (p[11].y + p[12].y) / 2 - (p[23].y + p[24].y) / 2
  return Math.abs(dy) < Math.abs(dx) * 16 / 9 // aspect-corrected: torso closer to horizontal
}

function pickLifter(poses: NL[], bar: { x: number; y: number } | null, lastHip: { x: number; y: number } | null, posture?: 'lying' | 'upright') {
  if (!poses.length) return null
  const hip = (p: NL) => ({ x: (p[23].x + p[24].x) / 2, y: (p[23].y + p[24].y) / 2 })
  const wristToBar = (p: NL) => (bar ? Math.min(Math.hypot(p[15].x - bar.x, p[15].y - bar.y), Math.hypot(p[16].x - bar.x, p[16].y - bar.y)) : Infinity)
  const hipJump = (p: NL) => (lastHip ? Math.hypot(hip(p).x - lastHip.x, hip(p).y - lastHip.y) : 0)
  const score = (p: NL) => {
    let s = 0
    if (bar) s += Math.min(wristToBar(p), 0.5) * 3
    if (lastHip) s += hipJump(p) * 2
    if (posture) s += torsoLying(p) === (posture === 'lying') ? 0 : 1.5
    if (!bar && !lastHip) {
      // first frame without a marker: prefer the biggest body
      const xs = p.map((q) => q.x)
      const ys = p.map((q) => q.y)
      s -= (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))
    }
    return s
  }
  const best = poses.reduce((a, p) => (score(p) < score(a) ? p : a))
  // identity guard: never silently switch to another person (e.g. a spotter walking by)
  if (lastHip && hipJump(best) > 0.18 && wristToBar(best) > 0.12) return null
  if (posture === 'lying' && !torsoLying(best)) return null
  return best
}

/** Grab a still frame (for bar marker picking / OCR / keyframes). */
export async function grabFrame(blob: Blob, t: number, maxW = 960) {
  const video = await loadVideo(blob)
  await seek(video, Math.min(t, video.duration - 0.05))
  const scale = Math.min(1, maxW / video.videoWidth)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
  URL.revokeObjectURL(video.src)
  video.remove()
  return canvas
}

export function lmPoint(lm: Float32Array, k: number, w: number, h: number) {
  return { x: lm[k * 3] * w, y: lm[k * 3 + 1] * h, v: lm[k * 3 + 2] }
}
