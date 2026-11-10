// Phone ⇄ computer relay, agent side.
//
// The agent keeps one outbound WebSocket to the LiftLens relay (<site>/relay/<room>). A phone that
// scanned this computer's QR code (room + key) sends encrypted requests through it; we replay them
// against our own local HTTP API (127.0.0.1) and send the encrypted responses back. Nothing listens
// on the network, no ports are opened, and the relay can't read anything (see relay-proto.mjs).

import fs from 'node:fs'
import path from 'node:path'
import { AGENT_URL, HOME, IS_DEV_WEB, OFFICIAL_WEB_URL, WEB_URL, readToken } from './config.mjs'
import { createOpener, decodeCode, encodeCode, importKey, newRelayCreds, seal } from './relay-proto.mjs'

const FILE = path.join(HOME, 'relay.json')
/** local dev has no relay of its own: use the hosted site (LIFTLENS_SITE) or LIFTLENS_RELAY_URL */
export const RELAY_ORIGIN = (process.env.LIFTLENS_RELAY_URL ?? (IS_DEV_WEB ? OFFICIAL_WEB_URL : WEB_URL)).replace(/\/$/, '')
export const relayEnabled = () => process.env.LIFTLENS_RELAY !== '0' && /^https?:\/\//.test(RELAY_ORIGIN)

/** paths a phone may call (the same ones the web app uses locally) */
const ALLOWED = new Set(['GET /health', 'GET /coaches', 'GET /runtimes', 'POST /runtime', 'POST /analyze'])

export function relayCreds({ rotate = false } = {}) {
  if (!rotate) {
    try {
      const c = JSON.parse(fs.readFileSync(FILE, 'utf8'))
      if (decodeCode(encodeCode(c))) return c
    } catch {
      /* create */
    }
  }
  const c = newRelayCreds()
  fs.writeFileSync(FILE, JSON.stringify(c), { mode: 0o600 })
  return c
}
/** what the QR code opens on the phone: the code rides in the URL fragment, never sent to the server */
export const relayLink = (c = relayCreds()) => `${WEB_URL}/agent#relay=${encodeCode(c)}`

export const relayState = { connected: false, clients: 0, lastError: null }

async function WS() {
  if (globalThis.WebSocket) return globalThis.WebSocket
  return (await import('undici')).WebSocket // Node 20
}

/** keep the relay connection up for the lifetime of the process */
export async function startRelay({ log = () => {} } = {}) {
  if (!relayEnabled()) return
  const creds = relayCreds()
  const key = await importKey(creds.key)
  const Socket = await WS()
  const url = `${RELAY_ORIGIN.replace(/^http/, 'ws')}/relay/${creds.room}?role=agent`
  let backoff = 1000
  const inflight = new Map()

  const connect = () => {
    let ws
    try {
      ws = new Socket(url)
    } catch (e) {
      relayState.lastError = e.message
      return setTimeout(connect, backoff)
    }
    const open = createOpener(key)
    const send = async (value) => {
      for (const f of await seal(key, value)) if (ws.readyState === 1) ws.send(f)
    }
    let ping
    ws.onopen = () => {
      relayState.connected = true
      relayState.lastError = null
      backoff = 1000
      log(`[relay] 已连接 ${RELAY_ORIGIN}`)
      ping = setInterval(() => ws.readyState === 1 && ws.send('ping'), 25_000)
    }
    ws.onclose = (ev) => {
      clearInterval(ping)
      relayState.connected = false
      if (ev?.code === 4000) return // replaced by a newer agent process with the same room
      backoff = Math.min(backoff * 2, 60_000)
      setTimeout(connect, backoff)
    }
    ws.onerror = (e) => {
      relayState.lastError = e?.message ?? 'connection error'
    }
    ws.onmessage = async (ev) => {
      const data = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString()
      if (data === 'pong') return
      const r = await open(data)
      if (!r) return
      if (r.sys) {
        if (r.sys.sys === 'clients') relayState.clients = r.sys.count
        return
      }
      const m = r.msg
      if (m?.t === 'abort') return inflight.get(m.id)?.abort()
      if (m?.t === 'req') handle(m, send).catch((e) => send({ t: 'res', id: m.id, status: 500, body: JSON.stringify({ error: e.message }) }))
    }
  }

  async function handle(m, send) {
    if (!ALLOWED.has(`${m.method} ${m.path}`)) return send({ t: 'res', id: m.id, status: 404, body: '{"error":"not allowed"}' })
    const ac = new AbortController()
    inflight.set(m.id, ac)
    try {
      const res = await fetch(`${AGENT_URL}${m.path}`, {
        method: m.method,
        headers: { 'content-type': 'application/json', 'x-liftlens-token': readToken() },
        body: m.method === 'POST' ? JSON.stringify(m.body ?? {}) : undefined,
        signal: ac.signal,
      })
      if (m.path !== '/analyze' || !res.ok || !res.body) {
        return send({ t: 'res', id: m.id, status: res.status, body: await res.text() })
      }
      // stream the SSE events one by one so the phone sees progress live
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += value
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i)
          buf = buf.slice(i + 2)
          const event = /^event: (.+)$/m.exec(block)?.[1]
          const data = /^data: (.+)$/m.exec(block)?.[1]
          if (event && data) await send({ t: 'ev', id: m.id, event, data })
        }
      }
      await send({ t: 'end', id: m.id })
    } catch (e) {
      if (!ac.signal.aborted) await send({ t: 'ev', id: m.id, event: 'error', data: JSON.stringify({ message: `电脑上的 agent 出错：${e.message}` }) })
      await send({ t: 'end', id: m.id })
    } finally {
      inflight.delete(m.id)
    }
  }

  connect()
}
