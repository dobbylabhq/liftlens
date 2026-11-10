// Phone ⇄ computer relay, browser side. Lets a phone (any network) use the LiftLens agent running on
// the user's computer: requests are end-to-end encrypted with the key from the computer's QR code and
// forwarded by the site's relay (worker/index.js), which can't read them.

// @ts-expect-error plain .mjs shared with the local agent
import { createOpener, decodeCode, importKey, seal } from '../../../agent/src/relay-proto.mjs'

/** the relay lives on the hosted site; local dev points at it with VITE_RELAY_ORIGIN (web/.env.local) */
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname)
export const RELAY_ORIGIN: string = (import.meta.env.VITE_RELAY_ORIGIN as string | undefined) || (IS_LOCAL ? '' : location.origin)
export const relayAvailable = !!RELAY_ORIGIN

export type RelayCreds = { room: string; key: string }
export const parseCode = (code: string): RelayCreds | null => decodeCode(code)

type Msg = { t: 'res'; id: string; status: number; body: string } | { t: 'ev'; id: string; event: string; data: string } | { t: 'end'; id: string }
type Pending = { onMsg: (m: Msg) => void; onDrop: (e: Error) => void }

class RelayClient {
  private ws: WebSocket | null = null
  private key: CryptoKey | null = null
  private open: ((f: string) => Promise<{ sys?: { sys: string; online?: boolean }; msg?: Msg } | null>) | null = null
  private pending = new Map<string, Pending>()
  private ping: ReturnType<typeof setInterval> | undefined
  private retry: ReturnType<typeof setTimeout> | undefined
  private code = ''
  private waiters: (() => void)[] = []
  agentOnline = false
  connected = false
  onChange: () => void = () => {}

  async connect(code: string) {
    if (this.code === code && this.ws && this.ws.readyState <= 1) return
    this.close()
    const c = parseCode(code)
    if (!c || !relayAvailable) return
    this.code = code
    this.key = await importKey(c.key)
    this.open = createOpener(this.key)
    const ws = new WebSocket(`${RELAY_ORIGIN.replace(/^http/, 'ws')}/relay/${c.room}?role=client`)
    this.ws = ws
    ws.onopen = () => {
      this.connected = true
      this.ping = setInterval(() => ws.readyState === 1 && ws.send('ping'), 25_000)
      this.onChange()
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      clearInterval(this.ping)
      this.connected = false
      this.agentOnline = false
      for (const p of this.pending.values()) p.onDrop(new Error('和电脑的连接断开了'))
      this.pending.clear()
      this.onChange()
      this.retry = setTimeout(() => this.ws === ws && this.code && this.connect(this.code).catch(() => {}), 3000)
      this.ws = null
    }
    ws.onmessage = async (ev) => {
      if (ev.data === 'pong' || !this.open) return
      const r = await this.open(String(ev.data))
      if (!r) return
      if (r.sys?.sys === 'agent') {
        this.agentOnline = !!r.sys.online
        if (this.agentOnline) this.waiters.splice(0).forEach((w) => w())
        if (!this.agentOnline) for (const p of this.pending.values()) p.onDrop(new Error('电脑上的 agent 离线了'))
        this.onChange()
        return
      }
      if (r.msg) this.pending.get(r.msg.id)?.onMsg(r.msg)
    }
  }

  close() {
    clearInterval(this.ping)
    clearTimeout(this.retry)
    const ws = this.ws
    this.ws = null
    this.code = ''
    this.connected = false
    this.agentOnline = false
    ws?.close()
  }

  /** resolves once the agent is online, or after `ms` */
  waitAgent(ms: number) {
    if (this.agentOnline) return Promise.resolve(true)
    return new Promise<boolean>((res) => {
      const t = setTimeout(() => res(this.agentOnline), ms)
      this.waiters.push(() => {
        clearTimeout(t)
        res(true)
      })
    })
  }

  private async send(value: unknown) {
    if (!this.ws || this.ws.readyState !== 1 || !this.key) throw new Error('没有连上中继')
    for (const f of (await seal(this.key, value)) as string[]) this.ws.send(f)
  }

  private newId() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36)
  }

  /** one request → one response */
  request(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 15_000): Promise<{ status: number; body: string }> {
    const id = this.newId()
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('电脑没有响应'))
      }, timeoutMs)
      this.pending.set(id, {
        onMsg: (m) => {
          if (m.t !== 'res') return
          clearTimeout(t)
          this.pending.delete(id)
          resolve({ status: m.status, body: m.body })
        },
        onDrop: (e) => {
          clearTimeout(t)
          reject(e)
        },
      })
      this.send({ t: 'req', id, method, path, body }).catch((e) => {
        clearTimeout(t)
        this.pending.delete(id)
        reject(e)
      })
    })
  }

  /** streaming request (/analyze): SSE events in order, resolves at the end */
  stream(path: string, body: unknown, onEvent: (event: string, data: string) => void, signal?: AbortSignal): Promise<{ status: number; body: string } | null> {
    const id = this.newId()
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.send({ t: 'abort', id }).catch(() => {})
        this.pending.delete(id)
        reject(new DOMException('aborted', 'AbortError'))
      }
      signal?.addEventListener('abort', abort, { once: true })
      this.pending.set(id, {
        onMsg: (m) => {
          if (m.t === 'ev') onEvent(m.event, m.data)
          else {
            signal?.removeEventListener('abort', abort)
            this.pending.delete(id)
            resolve(m.t === 'res' ? { status: m.status, body: m.body } : null)
          }
        },
        onDrop: (e) => {
          signal?.removeEventListener('abort', abort)
          reject(e)
        },
      })
      this.send({ t: 'req', id, method: 'POST', path, body }).catch(reject)
    })
  }
}

export const relay = new RelayClient()
