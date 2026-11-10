import { useEffect, useRef, useState } from 'react'
import { drawSkeleton, drawTrail, frameLm } from '../lib/draw'
import type { Clip, PackedPose } from '../lib/types'

export type PlayableClip = Clip & { video: Blob; pose: PackedPose }
export const isPlayable = (c: Clip): c is PlayableClip => !!c.video && !!c.pose

/** Plays the original clip with the skeleton + bar path drawn on top, synced per video frame. */
export function VideoOverlay({ clip, seekTo }: { clip: PlayableClip; seekTo?: { t: number; key: number } }) {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [showSkel, setShowSkel] = useState(true)
  const [rep, setRep] = useState<number | null>(null)
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    // create + revoke in the same effect so StrictMode's double-invoke can't leave a dead URL
    const u = URL.createObjectURL(clip.video)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [clip.video])

  useEffect(() => {
    if (seekTo && video.current) {
      video.current.currentTime = seekTo.t
      video.current.pause()
    }
  }, [seekTo])

  useEffect(() => {
    const v = video.current!
    const c = canvas.current!
    const { pose, analysis } = clip
    let handle = 0
    const draw = (time: number) => {
      const w = (c.width = v.videoWidth || analysis.width)
      const h = (c.height = v.videoHeight || analysis.height)
      const ctx = c.getContext('2d')!
      ctx.clearRect(0, 0, w, h)
      const i = Math.min(pose.n - 1, Math.max(0, Math.round(time * pose.fps)))
      const r = analysis.reps.find((x) => i >= x.start && i <= x.end) ?? null
      setRep(r?.index ?? null)
      if (showSkel) {
        const lm = frameLm(pose, i)
        if (lm) drawSkeleton(ctx, lm, w, h)
      }
      const from = r ? r.start : Math.max(0, i - pose.fps * 2)
      drawTrail(ctx, analysis.trace.slice(from, i + 1), w, h)
    }
    const loop = (_: number, meta: VideoFrameCallbackMetadata) => {
      draw(meta.mediaTime)
      handle = v.requestVideoFrameCallback(loop)
    }
    if ('requestVideoFrameCallback' in v) handle = v.requestVideoFrameCallback(loop)
    const onSeek = () => draw(v.currentTime)
    v.addEventListener('seeked', onSeek)
    v.addEventListener('loadeddata', onSeek)
    return () => {
      if ('cancelVideoFrameCallback' in v) v.cancelVideoFrameCallback(handle)
      v.removeEventListener('seeked', onSeek)
      v.removeEventListener('loadeddata', onSeek)
    }
  }, [clip, showSkel])

  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-black">
      <video ref={video} src={url} className="block aspect-video w-full object-contain" controls playsInline muted />
      <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-[calc(100%-0px)] w-full object-contain" style={{ aspectRatio: 'auto' }} />
      <div className="absolute left-3 top-3 flex gap-2">
        <button onClick={() => setShowSkel((s) => !s)} className={`chip bg-ink/70 backdrop-blur ${showSkel ? 'border-cyan/50 text-cyan' : ''}`}>
          骨架 {showSkel ? 'ON' : 'OFF'}
        </button>
        {rep && <span className="chip border-acid/50 bg-ink/70 text-acid backdrop-blur">第 {rep} 次</span>}
      </div>
    </div>
  )
}
