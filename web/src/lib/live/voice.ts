// Live mode audio: Chinese speech announcements (speechSynthesis) + short beeps (WebAudio).
// While training the user wears earphones or leaves the phone aside and may not be looking, so every count and cue must be audible.
//
// Announcement queue principle: say less rather than pile up — still saying "three" after rep 5 is done is the worst case.
//   - Counts: a new number interrupts/replaces any old number not yet spoken
//   - Cues: at most 1 at a time; follow-up cues within 1.5 s are dropped
//   - Others (two reps left / done): queued, but dropped if not reached within 3 s

export type SayKind = 'count' | 'cue' | 'info'

const MUTE_KEY = 'liftlens.live.muted'

let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
})()

export const isMuted = () => muted

export function setMuted(m: boolean) {
  muted = m
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0')
  } catch {
    /* private mode */
  }
  if (m) cancelSpeech()
}

// ------------------------------------------------------------------ Speech

const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null
let voice: SpeechSynthesisVoice | null = null

function pickVoice() {
  if (!synth) return
  const vs = synth.getVoices()
  if (!vs.length) return
  const score = (v: SpeechSynthesisVoice) => {
    const l = v.lang.toLowerCase().replace('_', '-')
    let s = l === 'zh-cn' ? 0 : l.startsWith('zh-cn') || l === 'cmn-hans-cn' ? 1 : l.startsWith('zh') || l.startsWith('cmn') ? 3 : 100
    if (/tingting|婷婷|xiaoxiao|晓晓|yaoyao|google 普通话|mandarin/i.test(v.name)) s -= 0.5
    if (v.localService) s -= 0.2 // Local voices have no network latency
    return s
  }
  const best = [...vs].sort((a, b) => score(a) - score(b))[0]
  voice = score(best) < 100 ? best : null
}
if (synth) {
  pickVoice()
  synth.addEventListener?.('voiceschanged', pickVoice)
}

export const hasSpeech = () => !!synth

interface Item {
  text: string
  kind: SayKind
  at: number
}
const queue: Item[] = []
let current: { item: Item; u: SpeechSynthesisUtterance; timer: number } | null = null
let lastCueAt = 0

function finish(u: SpeechSynthesisUtterance) {
  if (current?.u !== u) return
  clearTimeout(current.timer)
  current = null
  pump()
}

function pump() {
  if (!synth || current || muted) return
  const now = performance.now()
  // Drop stale items: only speak the latest count, skip anything else older than 3 s
  while (queue.length) {
    const it = queue[0]
    const newerCount = it.kind === 'count' && queue.some((q, i) => i > 0 && q.kind === 'count')
    if (newerCount || now - it.at > 3000) queue.shift()
    else break
  }
  const item = queue.shift()
  if (!item) return
  const u = new SpeechSynthesisUtterance(item.text)
  u.lang = voice?.lang ?? 'zh-CN'
  if (voice) u.voice = voice
  u.rate = item.kind === 'count' ? 1.2 : 1.1
  u.pitch = 1
  u.volume = 1
  u.onend = () => finish(u)
  u.onerror = () => finish(u)
  // Some browsers (Chrome Android / old Safari) occasionally don't fire onend: estimate a fallback timeout from text length so the queue never stalls
  const timer = window.setTimeout(() => finish(u), 1200 + item.text.length * 350)
  current = { item, u, timer }
  try {
    synth.speak(u)
  } catch {
    finish(u)
  }
}

/** Speak a phrase. A count interrupts an old count being spoken; cues are throttled to 1.5 s. */
export function say(text: string, kind: SayKind = 'info') {
  if (!synth || muted || !text) return
  const now = performance.now()
  if (kind === 'cue') {
    if (now - lastCueAt < 1500) return
    if (queue.some((q) => q.kind === 'cue') || current?.item.kind === 'cue') return
    lastCueAt = now
  }
  if (kind === 'count') {
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].kind === 'count') queue.splice(i, 1)
    // Previous number is being spoken: interrupt it (a newer rep is already done, the old number is meaningless)
    if (current?.item.kind === 'count') {
      const u = current.u
      clearTimeout(current.timer)
      current = null
      try {
        synth.cancel()
      } catch {
        /* ignore */
      }
      u.onend = u.onerror = null
    }
    // Counts jump to the front of the queue; they matter more than cues
    queue.unshift({ text, kind, at: now })
  } else queue.push({ text, kind, at: now })
  pump()
}

export function cancelSpeech() {
  queue.length = 0
  if (current) {
    clearTimeout(current.timer)
    current.u.onend = current.u.onerror = null
    current = null
  }
  try {
    synth?.cancel()
  } catch {
    /* ignore */
  }
}

const DIGITS = '零一二三四五六七八九'
/** 1 → 一, 12 → 十二, 25 → 二十五 (spoken Chinese numerals sound more natural and are shorter than Arabic digits) */
export function zhNum(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n >= 100 || n !== Math.floor(n)) return String(n)
  if (n < 10) return DIGITS[n]
  const t = Math.floor(n / 10)
  const o = n % 10
  return `${t === 1 ? '' : DIGITS[t]}十${o ? DIGITS[o] : ''}`
}

// ------------------------------------------------------------------ Beeps

let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (ctx) return ctx
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  try {
    ctx = new AC()
  } catch {
    ctx = null
  }
  return ctx
}

/**
 * Must be called synchronously inside a user click (start button) handler:
 * iOS Safari only plays audio automatically after an AudioContext was resumed and speechSynthesis spoke within a user gesture.
 */
export function unlockAudio() {
  const c = audio()
  if (c) {
    if (c.state !== 'running') void c.resume().catch(() => {})
    try {
      // Play a silent 1-frame buffer (needed on old iOS)
      const src = c.createBufferSource()
      src.buffer = c.createBuffer(1, 1, 22050)
      src.connect(c.destination)
      src.start(0)
    } catch {
      /* ignore */
    }
  }
  if (synth && !muted) {
    try {
      const u = new SpeechSynthesisUtterance(' ')
      u.volume = 0
      u.lang = 'zh-CN'
      synth.speak(u)
    } catch {
      /* ignore */
    }
  }
}

export type Beep = 'tick' | 'go' | 'rep' | 'warn' | 'done'

const TONES: Record<Beep, { f: number[]; d: number; type: OscillatorType; gain: number }> = {
  tick: { f: [880], d: 0.09, type: 'sine', gain: 0.25 },
  go: { f: [1320], d: 0.28, type: 'sine', gain: 0.3 },
  rep: { f: [1046, 1568], d: 0.07, type: 'triangle', gain: 0.22 },
  warn: { f: [440, 370], d: 0.1, type: 'square', gain: 0.08 },
  done: { f: [784, 1046, 1568], d: 0.12, type: 'triangle', gain: 0.25 },
}

/** Short beep: a few dozen ms, won't compete with speech. */
export function beep(kind: Beep) {
  if (muted) return
  const c = audio()
  if (!c || c.state !== 'running') return
  const tone = TONES[kind]
  let t = c.currentTime + 0.005
  for (const f of tone.f) {
    const osc = c.createOscillator()
    const g = c.createGain()
    osc.type = tone.type
    osc.frequency.value = f
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(tone.gain, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + tone.d)
    osc.connect(g).connect(c.destination)
    osc.start(t)
    osc.stop(t + tone.d + 0.02)
    t += tone.d * 0.85
  }
}

/** Call when leaving live mode: stop all speech (AudioContext is kept for reuse; re-unlocking on iOS is a hassle). */
export function stopVoice() {
  cancelSpeech()
}
