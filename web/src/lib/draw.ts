import { SKELETON } from './pose'
import type { PackedPose, PoseFrame } from './types'

export const COLORS = {
  bone: 'rgba(94, 234, 212, 0.95)',
  joint: '#ecfeff',
  bar: '#c8ff3d',
  barGlow: 'rgba(200, 255, 61, 0.35)',
  bad: '#ff5c7a',
}

export function pack(frames: PoseFrame[], fps: number): PackedPose {
  const n = frames.length
  const lm = new Float32Array(n * 99).fill(NaN)
  const bar = new Float32Array(n * 2).fill(NaN)
  frames.forEach((f, i) => {
    if (f.lm) lm.set(f.lm, i * 99)
    if (f.bar) {
      bar[i * 2] = f.bar.x
      bar[i * 2 + 1] = f.bar.y
    }
  })
  return { fps, n, lm, bar }
}

export function frameLm(p: PackedPose, i: number) {
  const a = p.lm.subarray(i * 99, i * 99 + 99)
  return Number.isNaN(a[0]) ? null : a
}

export function drawSkeleton(ctx: CanvasRenderingContext2D, lm: ArrayLike<number>, w: number, h: number, opts: { alpha?: number; lw?: number } = {}) {
  const lw = opts.lw ?? Math.max(2, w / 260)
  ctx.save()
  ctx.globalAlpha = opts.alpha ?? 1
  ctx.lineCap = 'round'
  ctx.strokeStyle = COLORS.bone
  ctx.lineWidth = lw
  ctx.shadowColor = 'rgba(0,0,0,0.6)'
  ctx.shadowBlur = 4
  for (const [a, b] of SKELETON) {
    if (lm[a * 3 + 2] < 0.3 || lm[b * 3 + 2] < 0.3) continue
    ctx.beginPath()
    ctx.moveTo(lm[a * 3] * w, lm[a * 3 + 1] * h)
    ctx.lineTo(lm[b * 3] * w, lm[b * 3 + 1] * h)
    ctx.stroke()
  }
  ctx.fillStyle = COLORS.joint
  for (const k of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    if (lm[k * 3 + 2] < 0.3) continue
    ctx.beginPath()
    ctx.arc(lm[k * 3] * w, lm[k * 3 + 1] * h, lw * 1.3, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** Bar path trail: normalized points */
export function drawTrail(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], w: number, h: number) {
  if (pts.length < 2) return
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = COLORS.barGlow
  ctx.lineWidth = Math.max(6, w / 90)
  ctx.beginPath()
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)))
  ctx.stroke()
  ctx.strokeStyle = COLORS.bar
  ctx.lineWidth = Math.max(2, w / 300)
  ctx.stroke()
  const last = pts[pts.length - 1]
  ctx.fillStyle = COLORS.bar
  ctx.beginPath()
  ctx.arc(last.x * w, last.y * h, Math.max(4, w / 140), 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export function drawLabel(ctx: CanvasRenderingContext2D, text: string, w: number) {
  const fs = Math.max(14, w / 40)
  ctx.save()
  ctx.font = `600 ${fs}px "Geist Mono", ui-monospace, monospace`
  const tw = ctx.measureText(text).width
  ctx.fillStyle = 'rgba(11,13,12,0.78)'
  ctx.fillRect(10, 10, tw + fs, fs * 1.8)
  ctx.fillStyle = COLORS.bar
  ctx.fillText(text, 10 + fs / 2, 10 + fs * 1.25)
  ctx.restore()
}
