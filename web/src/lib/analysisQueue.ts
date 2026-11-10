// Background analysis for the training mode: each recorded set is queued and analysed one after
// another while the user carries on with the next set. Analysis is CPU/GPU heavy, so it pauses
// (between frames) while a live set is being filmed, then resumes — the live rep counter stays smooth.

import { create } from 'zustand'
import { runAnalysis, type Phase, type RunOptions } from './pipeline'
import { drawSkeleton } from './draw'
import { deleteSession } from './db'

export interface Job {
  key: string
  label: string
  status: 'queued' | 'running' | 'error'
  phase: Phase
  p: number
  error?: string
}

interface QueueState {
  jobs: Record<string, Job>
  livePaused: boolean
}
export const useAnalysisQueue = create<QueueState>(() => ({ jobs: {}, livePaused: false }))

const set = (key: string, patch: Partial<Job>) =>
  useAnalysisQueue.setState((s) => (s.jobs[key] ? { jobs: { ...s.jobs, [key]: { ...s.jobs[key], ...patch } } } : s))
const remove = (key: string) =>
  useAnalysisQueue.setState((s) => {
    const jobs = { ...s.jobs }
    delete jobs[key]
    return { jobs }
  })

let resume: (() => void) | null = null
/** live mode on/off: analysis holds still while the camera + live model need the device */
export function setLiveActive(active: boolean) {
  useAnalysisQueue.setState({ livePaused: active })
  if (!active) {
    resume?.()
    resume = null
  }
}
const gate = () => (useAnalysisQueue.getState().livePaused ? new Promise<void>((r) => (resume = r)) : Promise.resolve())

/** canvases that want the per-frame preview of a job (the set panel currently on screen) */
export const previews = new Map<string, HTMLCanvasElement>()

type Task = { key: string; opts: Omit<RunOptions, 'onPhase' | 'onProgress' | 'onFrame' | 'gate'>; done: (id: number) => Promise<unknown>; fail: (e: Error) => void }
const queue: Task[] = []
let running = false
/** key prefixes whose jobs were discarded (workout abandoned) */
const cancelled = new Set<string>()
const isCancelled = (key: string) => [...cancelled].some((p) => key.startsWith(p))

/** drop every queued / running job whose key starts with `prefix`; a run already underway is thrown away when it ends */
export function cancelJobs(prefix: string) {
  cancelled.add(prefix)
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].key.startsWith(prefix)) queue.splice(i, 1)
  useAnalysisQueue.setState((s) => ({ jobs: Object.fromEntries(Object.entries(s.jobs).filter(([k]) => !k.startsWith(prefix))) }))
}

export function enqueueAnalysis(key: string, label: string, opts: Task['opts'], done: Task['done'], fail: Task['fail']) {
  useAnalysisQueue.setState((s) => ({ jobs: { ...s.jobs, [key]: { key, label, status: 'queued', phase: 'model', p: 0 } } }))
  queue.push({ key, opts, done, fail })
  void pump()
}

async function pump() {
  if (running) return
  running = true
  try {
    for (let t = queue.shift(); t; t = queue.shift()) {
      await gate()
      if (isCancelled(t.key)) continue
      set(t.key, { status: 'running' })
      try {
        const { id } = await runAnalysis({
          ...t.opts,
          gate,
          onPhase: (phase) => set(t.key, { phase }),
          onProgress: (p) => set(t.key, { p }),
          onFrame: (canvas, frame) => {
            const pc = previews.get(t.key)
            if (!pc) return
            pc.width = canvas.width
            pc.height = canvas.height
            const ctx = pc.getContext('2d')!
            ctx.drawImage(canvas, 0, 0)
            if (frame?.lm) drawSkeleton(ctx, frame.lm, pc.width, pc.height)
          },
        })
        if (isCancelled(t.key)) {
          await deleteSession(id)
          continue
        }
        await t.done(id)
        remove(t.key)
      } catch (e) {
        if (isCancelled(t.key)) continue
        set(t.key, { status: 'error', error: (e as Error).message })
        t.fail(e as Error)
      }
    }
  } finally {
    running = false
  }
}

export const dismissJob = remove
