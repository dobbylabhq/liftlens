import { grabFrame } from './pose'
import { drawLabel, drawSkeleton, drawTrail } from './draw'
import type { ClipAnalysis, PoseFrame } from './types'
import { ANGLE_LABEL } from './lifts'

/**
 * Render annotated key frames (rep bottoms + lockouts) that the agent coach will
 * look at. Picks the reps flagged by findings first, then first / last rep.
 */
export async function renderKeyframes(blob: Blob, frames: PoseFrame[], a: ClipAnalysis, max = 4) {
  const flagged = new Set(a.findings.flatMap((f) => (f.severity === 'bad' || f.severity === 'warn' ? (f.reps ?? []) : [])))
  const order = [...a.reps].sort((p, q) => Number(flagged.has(q.index)) - Number(flagged.has(p.index)))
  const pick = order.slice(0, Math.max(1, max - 1))
  if (a.reps.length && !pick.includes(a.reps[a.reps.length - 1])) pick.push(a.reps[a.reps.length - 1])
  pick.sort((p, q) => p.index - q.index)

  const out: { name: string; blob: Blob }[] = []
  for (const r of pick.slice(0, max)) {
    for (const [phase, fi] of [['bottom', r.bottom], ['top', r.end]] as const) {
      if (phase === 'top' && out.length >= max * 2 - 2) continue
      const canvas = await grabFrame(blob, frames[fi].t, 960)
      const ctx = canvas.getContext('2d')!
      const lm = frames[fi].lm
      if (lm) drawSkeleton(ctx, lm, canvas.width, canvas.height)
      const trail = a.trace.slice(r.start, fi + 1).map((p) => ({ x: p.x, y: p.y }))
      drawTrail(ctx, trail, canvas.width, canvas.height)
      drawLabel(ctx, `${ANGLE_LABEL[a.angle]} · 第${r.index}次 · ${phase === 'bottom' ? '到底' : '锁定'}${flagged.has(r.index) ? ' · ⚠' : ''}`, canvas.width)
      const jpg = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.82))
      out.push({ name: `${a.angle}-rep${r.index}-${phase}`, blob: jpg })
    }
  }
  return out
}

export function blobToDataUrl(b: Blob) {
  return new Promise<string>((res) => {
    const fr = new FileReader()
    fr.onload = () => res(fr.result as string)
    fr.readAsDataURL(b)
  })
}
