/**
 * Colour-blob tracker for a marker on the barbell plate (e.g. the red centre cap of
 * many bumper plates, or a sticker the user adds).
 *
 * 1. The user clicks the marker once → we sample its colour (median HSV of a patch).
 * 2. On that same frame we record every *other* blob of that colour as a static
 *    distractor (gyms are full of red pads / logos) and ignore them afterwards.
 * 3. Each frame: connected-component labelling inside a window around the last
 *    position; pick the blob that best matches size + continuity.
 *
 * (OpenCV.js CamShift would also work but costs ~8MB of WASM; this is ~150 lines.)
 */
export interface BarSeed {
  /** normalized position of the click */
  x: number
  y: number
  /** time (s) of the frame the user clicked on */
  t: number
  /** sampled colour in HSV (h: 0..360, s/v: 0..1) */
  h: number
  s: number
  v: number
}

interface Blob {
  x: number
  y: number
  n: number
}

export function rgbToHsv(r: number, g: number, b: number) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max ? d / max : 0, v: max }
}

/** Sample the median colour of a small patch around a normalized point. */
export function sampleSeed(canvas: HTMLCanvasElement, nx: number, ny: number, t = 0): BarSeed {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const r = Math.max(2, Math.round(canvas.width / 320))
  const cx = Math.round(nx * canvas.width)
  const cy = Math.round(ny * canvas.height)
  const data = ctx.getImageData(cx - r, cy - r, r * 2 + 1, r * 2 + 1).data
  const hs: number[] = []
  const ss: number[] = []
  const vs: number[] = []
  for (let i = 0; i < data.length; i += 4) {
    const c = rgbToHsv(data[i], data[i + 1], data[i + 2])
    hs.push(c.h)
    ss.push(c.s)
    vs.push(c.v)
  }
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1]
  return { x: nx, y: ny, t, h: med(hs), s: med(ss), v: med(vs) }
}

const STEP = 2

export class BarTracker {
  private last: { x: number; y: number } | null
  private lastSize = 0
  private lost = 0
  private distractors: Blob[] = []
  private readonly seed: BarSeed
  private readonly w: number
  private readonly h: number

  constructor(seed: BarSeed, w: number, h: number) {
    this.seed = seed
    this.w = w
    this.h = h
    this.last = { x: seed.x * w, y: seed.y * h }
  }

  private match(r: number, g: number, b: number) {
    const c = rgbToHsv(r, g, b)
    let dh = Math.abs(c.h - this.seed.h)
    if (dh > 180) dh = 360 - dh
    return dh < 16 && c.s > Math.max(0.3, this.seed.s * 0.6) && c.v > Math.max(0.2, this.seed.v * 0.5) && c.v < Math.min(1, this.seed.v * 1.6 + 0.1)
  }

  /** Connected components of matching pixels inside a rectangle (on a STEP grid). */
  private blobs(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): Blob[] {
    x0 = Math.max(0, Math.round(x0))
    y0 = Math.max(0, Math.round(y0))
    x1 = Math.min(this.w, Math.round(x1))
    y1 = Math.min(this.h, Math.round(y1))
    if (x1 - x0 < STEP * 2 || y1 - y0 < STEP * 2) return []
    const { data, width, height } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0)
    const gw = Math.ceil(width / STEP)
    const gh = Math.ceil(height / STEP)
    const mask = new Uint8Array(gw * gh)
    for (let gy = 0; gy < gh; gy++)
      for (let gx = 0; gx < gw; gx++) {
        const i = (gy * STEP * width + gx * STEP) * 4
        if (this.match(data[i], data[i + 1], data[i + 2])) mask[gy * gw + gx] = 1
      }
    const out: Blob[] = []
    const stack: number[] = []
    for (let k = 0; k < mask.length; k++) {
      if (mask[k] !== 1) continue
      let sx = 0
      let sy = 0
      let n = 0
      mask[k] = 2
      stack.push(k)
      while (stack.length) {
        const q = stack.pop()!
        const qx = q % gw
        const qy = (q / gw) | 0
        sx += qx
        sy += qy
        n++
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = qx + dx
          const ny = qy + dy
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue
          const nk = ny * gw + nx
          if (mask[nk] === 1) {
            mask[nk] = 2
            stack.push(nk)
          }
        }
      }
      if (n >= 2) out.push({ x: x0 + (sx / n) * STEP, y: y0 + (sy / n) * STEP, n })
    }
    return out
  }

  /** Call once with the frame the user clicked on: remembers static look-alike blobs. */
  init(ctx: CanvasRenderingContext2D) {
    const all = this.blobs(ctx, 0, 0, this.w, this.h)
    const sx = this.seed.x * this.w
    const sy = this.seed.y * this.h
    const mine = all.reduce<Blob | null>((b, c) => (!b || Math.hypot(c.x - sx, c.y - sy) < Math.hypot(b.x - sx, b.y - sy) ? c : b), null)
    if (mine && Math.hypot(mine.x - sx, mine.y - sy) < 0.05 * this.w) {
      this.last = { x: mine.x, y: mine.y }
      this.lastSize = mine.n
    }
    this.distractors = all.filter((b) => b !== mine && Math.hypot(b.x - sx, b.y - sy) > 0.04 * this.w)
  }

  private isDistractor(b: Blob) {
    return this.distractors.some((d) => Math.hypot(d.x - b.x, d.y - b.y) < Math.max(10, 0.025 * this.w))
  }

  /**
   * @param hint lifter's wrist midpoint in pixels (previous frame). Only used to
   *             re-acquire the marker after it has been lost for a while.
   */
  track(ctx: CanvasRenderingContext2D, hint?: { x: number; y: number } | null): { x: number; y: number } | null {
    const center = this.last ?? hint ?? { x: this.w / 2, y: this.h / 2 }
    // window grows slowly while lost (plate can be occluded by a spotter for a second)
    const win = Math.min(0.5 * this.w, 0.09 * this.w * (1 + this.lost * 0.5))
    let cands = this.blobs(ctx, center.x - win, center.y - win, center.x + win, center.y + win).filter((b) => !this.isDistractor(b))
    if (!cands.length && hint && this.lost > 6) {
      const hw = 0.15 * this.w
      cands = this.blobs(ctx, hint.x - hw, hint.y - hw, hint.x + hw, hint.y + hw).filter((b) => !this.isDistractor(b))
    }
    if (!cands.length) {
      this.lost++
      return null
    }
    const ref = this.lastSize || Math.max(...cands.map((c) => c.n))
    const score = (b: Blob) => Math.hypot(b.x - center.x, b.y - center.y) / win + Math.abs(Math.log((b.n + 1) / (ref + 1))) * 0.6
    const best = cands.reduce((a, b) => (score(b) < score(a) ? b : a))
    if (best.n < Math.max(2, ref * 0.15)) {
      this.lost++
      return null
    }
    this.lost = 0
    this.last = { x: best.x, y: best.y }
    this.lastSize = this.lastSize ? this.lastSize * 0.8 + best.n * 0.2 : best.n
    return { x: best.x / this.w, y: best.y / this.h }
  }
}
