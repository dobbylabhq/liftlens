import type { Worker } from 'tesseract.js'

// Tesseract.js (WASM OCR). Used to read the weight printed on plates / a gym display
// from a user-selected region, so logging the load is one drag instead of typing.
let worker: Promise<Worker> | null = null
function getWorker() {
  worker ??= (async () => {
    const { createWorker, PSM } = await import('tesseract.js')
    const w = await createWorker('eng')
    await w.setParameters({
      tessedit_char_whitelist: '0123456789.kKgGlLbBsS ',
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    })
    return w
  })()
  return worker
}

export interface OcrResult {
  text: string
  numbers: number[]
  unit: 'kg' | 'lb' | null
  confidence: number
}

/** Preprocess (grayscale + contrast + upscale) then OCR a crop of the canvas. */
export async function readWeights(src: HTMLCanvasElement, rect: { x: number; y: number; w: number; h: number }): Promise<OcrResult> {
  const scale = Math.max(1, 240 / Math.max(1, rect.h))
  const c = document.createElement('canvas')
  c.width = Math.round(rect.w * scale)
  c.height = Math.round(rect.h * scale)
  const ctx = c.getContext('2d')!
  ctx.filter = 'grayscale(1) contrast(1.8)'
  ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height)
  const w = await getWorker()
  const { data } = await w.recognize(c)
  const text = data.text.replace(/\s+/g, ' ').trim()
  const numbers = [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])).filter((n) => n > 0 && n < 500)
  const unit = /lb/i.test(text) ? 'lb' : /kg/i.test(text) ? 'kg' : null
  return { text, numbers, unit, confidence: data.confidence }
}

/** Common plate denominations — OCR results are snapped to these. */
export const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25]
export function snapPlate(n: number) {
  return PLATES_KG.reduce((best, p) => (Math.abs(p - n) < Math.abs(best - n) ? p : best), PLATES_KG[0])
}
