// Live mode camera / recording / keep screen awake.
// All native browser APIs (getUserMedia / MediaRecorder / Wake Lock); video never leaves the device.

export type Facing = 'environment' | 'user'

export type CameraErrorCode = 'insecure' | 'unsupported' | 'denied' | 'notfound' | 'busy' | 'unknown'

export class CameraError extends Error {
  code: CameraErrorCode
  constructor(code: CameraErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'CameraError'
  }
}

const MESSAGES: Record<CameraErrorCode, string> = {
  insecure: '摄像头只能在 HTTPS（或 localhost）页面里使用。请用 https 地址打开 LiftLens。',
  unsupported: '这个浏览器不支持网页调用摄像头。iPhone 请用 Safari（iOS 14.3+），安卓请用 Chrome。',
  denied: '没有摄像头权限。请在浏览器地址栏左侧（iPhone：设置 › Safari › 摄像头）允许 LiftLens 使用摄像头，然后重试。',
  notfound: '没有找到可用的摄像头。',
  busy: '摄像头被其他应用占用（视频通话、相机 App…），关掉它们后重试。',
  unknown: '摄像头打开失败',
}

function toCameraError(e: unknown): CameraError {
  if (e instanceof CameraError) return e
  const name = (e as { name?: string })?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return new CameraError('denied', MESSAGES.denied)
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return new CameraError('notfound', MESSAGES.notfound)
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return new CameraError('busy', MESSAGES.busy)
  const msg = (e as Error)?.message
  return new CameraError('unknown', msg ? `${MESSAGES.unknown}：${msg}` : MESSAGES.unknown)
}

/** Open the camera: rear-facing by default, ~720p / 30fps. Falls back to any camera if ideal constraints can't be met. */
export async function openCamera(facing: Facing = 'environment'): Promise<MediaStream> {
  if (typeof window !== 'undefined' && !window.isSecureContext) throw new CameraError('insecure', MESSAGES.insecure)
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unsupported', MESSAGES.unsupported)
  const ideal: MediaStreamConstraints = {
    audio: false,
    video: {
      facingMode: { ideal: facing },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
    },
  }
  try {
    return await navigator.mediaDevices.getUserMedia(ideal)
  } catch (e) {
    const name = (e as { name?: string })?.name
    // Constraints not satisfiable (old device / desktop webcam): relax to any camera and retry once
    if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError' || name === 'TypeError') {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: false, video: true })
      } catch (e2) {
        throw toCameraError(e2)
      }
    }
    throw toCameraError(e)
  }
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => {
    try {
      t.stop()
    } catch {
      /* already stopped */
    }
  })
}

/** How many cameras there are (decides whether to show the "flip" button). Labels are empty before permission, but the count is accurate. */
export async function countCameras(): Promise<number> {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput').length
  } catch {
    return 0
  }
}

// ------------------------------------------------------------------ Recording

// Prefer mp4: Safari only supports mp4; newer Chrome can record mp4 too, and webm recorded by MediaRecorder has no duration in its header,
// which breaks duration-based frame sampling in offline analysis. Use webm only if neither works (Firefox / old Chrome).
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]

export function pickRecorderMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const m of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m
    } catch {
      /* ignore */
    }
  }
  return ''
}

const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export interface Recorder {
  readonly mime: string
  start(): void
  pause(): void
  resume(): void
  /** Stop and return the recorded file; null if nothing was recorded (unsupported / no data) */
  stop(): Promise<File | null>
}

/**
 * Recorder. Returns null when the browser lacks MediaRecorder (live rep counting still works, just no video for offline analysis).
 * start() tries supported formats in turn: some browsers report isTypeSupported but start() throws (notably Chrome's mp4),
 * so on failure try the next; if all fail, silently give up recording and stop() returns null — recording issues must never interrupt rep counting.
 */
export function createRecorder(stream: MediaStream, baseName = 'liftlens-live'): Recorder | null {
  if (typeof MediaRecorder === 'undefined') return null
  const supported = MIME_CANDIDATES.filter((m) => {
    try {
      return MediaRecorder.isTypeSupported(m)
    } catch {
      return false
    }
  })
  const tries = [...supported, ''] // '' = let the browser choose
  let rec: MediaRecorder | null = null
  let chunks: Blob[] = []
  let mime = ''
  const type = () => (rec?.mimeType || mime || chunks[0]?.type || 'video/webm').split(';')[0]
  const started = new Date()
  return {
    get mime() {
      return type()
    },
    start() {
      if (rec) return
      for (const m of tries) {
        let r: MediaRecorder | null = null
        try {
          r = new MediaRecorder(stream, { ...(m ? { mimeType: m } : {}), videoBitsPerSecond: 4_000_000 })
          const buf: Blob[] = []
          r.ondataavailable = (e) => {
            if (e.data && e.data.size) buf.push(e.data)
          }
          // Emit a chunk every second: a mid-way crash/kill won't lose everything; on iOS, not chunking sometimes yields no data
          r.start(1000)
          rec = r
          chunks = buf
          mime = m
          return
        } catch {
          try {
            if (r && r.state !== 'inactive') r.stop()
          } catch {
            /* ignore */
          }
        }
      }
    },
    pause() {
      try {
        if (rec?.state === 'recording') rec.pause()
      } catch {
        /* ignore */
      }
    },
    resume() {
      try {
        if (rec?.state === 'paused') rec.resume()
      } catch {
        /* ignore */
      }
    },
    stop() {
      return new Promise<File | null>((resolve) => {
        const r = rec
        const done = () => {
          const t = type()
          if (!chunks.length) return resolve(null)
          const ext = t.includes('mp4') ? 'mp4' : t.includes('quicktime') ? 'mov' : 'webm'
          resolve(new File(chunks, `${baseName}-${stamp(started)}.${ext}`, { type: t, lastModified: Date.now() }))
        }
        if (!r || r.state === 'inactive') return done()
        // Fallback: some browsers never fire the stop event
        const timer = setTimeout(done, 3000)
        r.addEventListener(
          'stop',
          () => {
            clearTimeout(timer)
            // The last dataavailable fires before stop, so everything is here by now
            done()
          },
          { once: true },
        )
        try {
          r.stop()
        } catch {
          clearTimeout(timer)
          done()
        }
      })
    },
  }
}

// ------------------------------------------------------------------ Keep screen awake

/**
 * Keep the screen awake: the phone sits to the side during training and must not auto-lock.
 * The system releases it when the page goes to background; we re-request on return. Supported on iOS 16.4+ / Chrome 84+; silently skipped otherwise.
 */
export function createWakeLock() {
  type Sentinel = { release(): Promise<void>; released?: boolean }
  let sentinel: Sentinel | null = null
  let wanted = false
  const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } }
  const request = async () => {
    if (!wanted || !nav.wakeLock || document.visibilityState !== 'visible') return
    if (sentinel && !sentinel.released) return
    try {
      sentinel = await nav.wakeLock.request('screen')
      if (!wanted) {
        await sentinel.release().catch(() => {})
        sentinel = null
      }
    } catch {
      sentinel = null // Power-saving mode / no user gesture: doesn't matter
    }
  }
  const onVis = () => {
    if (document.visibilityState === 'visible') void request()
  }
  return {
    get supported() {
      return !!nav.wakeLock
    },
    acquire() {
      if (wanted) return
      wanted = true
      document.addEventListener('visibilitychange', onVis)
      void request()
    },
    release() {
      wanted = false
      document.removeEventListener('visibilitychange', onVis)
      const s = sentinel
      sentinel = null
      s?.release().catch(() => {})
    },
  }
}

/** Turn a dev video source (File or URL) into a File, handed to offline analysis as the "recorded video". */
export async function sourceToFile(source: File | string): Promise<File | null> {
  if (typeof source !== 'string') return source
  try {
    const res = await fetch(source)
    if (!res.ok) return null
    const blob = await res.blob()
    const name = decodeURIComponent(source.split(/[?#]/)[0].split('/').pop() || 'source.mp4')
    return new File([blob], name, { type: blob.type || 'video/mp4' })
  } catch {
    return null
  }
}
