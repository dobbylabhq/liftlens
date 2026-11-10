/**
 * RTMO (OpenMMLab, one-stage multi-person pose) running in the browser via onnxruntime-web.
 * Weights: Xenova/RTMO-* on Hugging Face (Apache-2.0, CORS-enabled, downloaded on demand).
 *
 * Model I/O (see the Xenova model card):
 *   input    float32 [1, 3, S, S]  RGB 0–255, plain resize (no letterbox), no normalisation
 *   dets     [1, N, 5]  x1 y1 x2 y2 score   (input pixel space, NMS already applied)
 *   keypoints[1, N, 17, 3] x y score        (COCO-17, input pixel space)
 *
 * Output is converted to the MediaPipe 33-landmark layout so the rest of the pipeline
 * (lifter selection, rule engine, drawing) is backend-agnostic. COCO-17 has no heels / toes:
 * those landmarks get visibility 0 and the rule engine skips heel-dependent rules.
 */
import type * as Ort from 'onnxruntime-web'

export type NL = { x: number; y: number; visibility?: number }[]

const ORT_VERSION = '1.31.1'
// COCO-17 index → MediaPipe-33 index
const COCO_TO_MP = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]

export interface RtmoSession {
  provider: 'webgpu' | 'wasm'
  detect: (src: HTMLCanvasElement) => Promise<NL[]>
}

export async function createRtmo(model: Uint8Array, size: number): Promise<RtmoSession> {
  // webgpu bundle also contains the wasm EP as fallback
  const ort: typeof Ort = await import('onnxruntime-web/webgpu')
  ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`
  ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 2)

  let session: Ort.InferenceSession
  let provider: 'webgpu' | 'wasm' = 'webgpu'
  try {
    if (!('gpu' in navigator)) throw new Error('no webgpu')
    session = await ort.InferenceSession.create(model, { executionProviders: ['webgpu'] })
  } catch {
    provider = 'wasm'
    session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
  }

  const scratch = document.createElement('canvas')
  scratch.width = size
  scratch.height = size
  const sctx = scratch.getContext('2d', { willReadFrequently: true })!
  const plane = size * size
  const input = new Float32Array(3 * plane)

  const detect = async (src: HTMLCanvasElement): Promise<NL[]> => {
    sctx.drawImage(src, 0, 0, size, size)
    const px = sctx.getImageData(0, 0, size, size).data
    for (let i = 0, j = 0; i < plane; i++, j += 4) {
      input[i] = px[j]
      input[plane + i] = px[j + 1]
      input[2 * plane + i] = px[j + 2]
    }
    const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, size, size]) }
    const out = await session.run(feeds)
    const dets = (out.dets ?? out[session.outputNames[0]]) as Ort.Tensor
    const kps = (out.keypoints ?? out[session.outputNames[1]]) as Ort.Tensor
    const d = dets.data as Float32Array
    const k = kps.data as Float32Array
    const n = dets.dims[1]
    const people: NL[] = []
    for (let p = 0; p < n; p++) {
      if (d[p * 5 + 4] < 0.3) continue
      const lm: NL = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }))
      for (let c = 0; c < 17; c++) {
        const o = (p * 17 + c) * 3
        lm[COCO_TO_MP[c]] = { x: k[o] / size, y: k[o + 1] / size, visibility: Math.min(1, Math.max(0, k[o + 2])) }
      }
      people.push(lm)
    }
    return people
  }
  return { provider, detect }
}
