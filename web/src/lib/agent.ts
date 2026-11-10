import { create } from 'zustand'
import { getSetting, setSetting } from './db'
import { parseCode, relay, relayAvailable } from './relay'

/** Client for the local LiftLens agent bridge (agent/src/server.mjs). */

export interface AgentHealth {
  ok: boolean
  version: string
  /** fingerprint of the agent source; compared with __AGENT_BUILD__ to detect stale agents */
  build?: string
  /** id of the default runtime (claude-code, codex, anthropic, ...) */
  runtime?: string
  skills?: { version: string | null; source: 'synced' | 'bundled'; lastError: string | null; checkedAt: string | null }
  runtimes: { claude: { path: string; version: string | null } | null }
}

interface AgentState {
  url: string
  token: string
  status: 'unknown' | 'offline' | 'unpaired' | 'ready'
  health: AgentHealth | null
  /** how we reach the agent: directly on this computer, or through the encrypted relay (phone) */
  via: 'local' | 'relay' | null
  /** connect code of the computer this browser linked to via QR (room.key) */
  relayCode: string
  /** relay socket is up but the computer's agent isn't connected to it (asleep / not running) */
  relayAgentOffline: boolean
  load: () => Promise<void>
  save: (url: string, token: string) => Promise<void>
  saveRelay: (code: string) => Promise<boolean>
  forgetRelay: () => Promise<void>
  check: () => Promise<void>
}

export const useAgent = create<AgentState>((set, get) => ({
  url: 'http://127.0.0.1:4517',
  token: '',
  status: 'unknown',
  health: null,
  via: null,
  relayCode: '',
  relayAgentOffline: false,
  load: async () => {
    const url = await getSetting('agentUrl', 'http://127.0.0.1:4517')
    const token = await getSetting('agentToken', '')
    const relayCode = await getSetting('relayCode', '')
    set({ url, token, relayCode })
    await get().check()
  },
  save: async (url, token) => {
    await setSetting('agentUrl', url)
    await setSetting('agentToken', token)
    set({ url, token })
    await get().check()
  },
  saveRelay: async (code) => {
    if (!parseCode(code)) return false
    await setSetting('relayCode', code)
    set({ relayCode: code })
    await get().check()
    return true
  },
  forgetRelay: async () => {
    await setSetting('relayCode', '')
    relay.close()
    set({ relayCode: '' })
    await get().check()
  },
  check: async () => {
    const { url, token, relayCode } = get()
    // 1) the agent on this very computer
    try {
      const h = (await (await fetch(`${url}/health`, { signal: AbortSignal.timeout(2500) })).json()) as AgentHealth
      const r = await fetch(`${url}/coaches`, { headers: { 'x-liftlens-token': token } })
      set({ health: h, status: r.ok ? 'ready' : 'unpaired', via: 'local', relayAgentOffline: false })
      return
    } catch {
      /* not on this machine — try the relay */
    }
    // 2) a computer linked by QR code, through the relay
    if (relayCode && relayAvailable) {
      try {
        relay.onChange = () => {
          const s = get()
          if (s.via === 'relay' && !relay.agentOnline && s.status === 'ready') set({ status: 'offline', relayAgentOffline: true })
          else if (relay.agentOnline && s.status !== 'ready') void get().check()
        }
        await relay.connect(relayCode)
        if (await relay.waitAgent(4000)) {
          const h = await relay.request('GET', '/health')
          set({ health: JSON.parse(h.body) as AgentHealth, status: 'ready', via: 'relay', relayAgentOffline: false })
          return
        }
        set({ status: 'offline', health: null, via: 'relay', relayAgentOffline: true })
        return
      } catch {
        /* fall through */
      }
    }
    set({ status: 'offline', health: null, via: null, relayAgentOffline: false })
  },
}))

/**
 * The one-line command shown wherever the agent is missing.
 * Hosted site: the agent tarball is served next to the app, so `npx <origin>/agent/liftlens-agent.tgz`
 * works without an npm account. Local dev: run it from the repo.
 */
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname)
/** versioned tarball name → npx never reuses a stale cached copy */
export const AGENT_CMD = IS_LOCAL ? 'node agent/src/cli.mjs' : `npx -y ${location.origin}/agent/liftlens-agent-${__AGENT_BUILD__}.tgz`
/** true when the running local agent was built from different source than this web app expects */
export const isAgentStale = (h: AgentHealth | null) => !IS_LOCAL && !!h && h.build !== __AGENT_BUILD__

/**
 * One-click pairing: `npx liftlens-agent` opens `<web>/agent#pair=<token>&agent=<url>`.
 * The token lives in the URL *fragment*, so it is never sent to whatever server hosts the web app.
 */
export async function consumePairFragment() {
  const h = new URLSearchParams(location.hash.slice(1))
  const code = h.get('relay')
  if (code) {
    // phone scanned the computer's QR code: <web>/agent#relay=<room>.<key>
    history.replaceState(null, '', location.pathname + location.search)
    await useAgent.getState().saveRelay(code)
    return useAgent.getState().status === 'ready'
  }
  const token = h.get('pair')
  if (!token) return false
  const agent = h.get('agent') || 'http://127.0.0.1:4517'
  history.replaceState(null, '', location.pathname + location.search)
  await useAgent.getState().save(agent, token)
  return useAgent.getState().status === 'ready'
}

export interface RuntimeInfo {
  id: string
  label: string
  group: 'local' | 'cloud'
  note: string
  available: boolean
  reason: string | null
  model: string | null
  installed: boolean
  current: boolean
  verified: boolean
}

async function agentFetch(pathname: string, init?: RequestInit) {
  const { url, token, via } = useAgent.getState()
  if (via === 'relay') {
    const r = await relay.request((init?.method as 'POST') ?? 'GET', pathname, init?.body ? JSON.parse(String(init.body)) : undefined)
    if (r.status >= 400) throw new Error(`电脑上的 agent 返回 ${r.status}`)
    return JSON.parse(r.body)
  }
  const r = await fetch(`${url}${pathname}`, { ...init, headers: { 'content-type': 'application/json', 'x-liftlens-token': token, ...(init?.headers ?? {}) } })
  if (!r.ok) throw new Error(`本地 agent 返回 ${r.status}`)
  return r.json()
}
export const fetchRuntimes = (): Promise<RuntimeInfo[]> => agentFetch('/runtimes')
export const setRuntime = (id: string) => agentFetch('/runtime', { method: 'POST', body: JSON.stringify({ id }) })

export type AgentEvent =
  | { type: 'status'; stage: string; text: string }
  | { type: 'tool'; name: string; file: string }
  | { type: 'text'; text: string }
  | { type: 'result'; kind: string; coachId: string; output: unknown; costUsd: number | null; durationMs: number | null }
  | { type: 'error'; message: string }

/** POST /analyze and parse the SSE stream (fetch-based, since EventSource can't POST). */
export async function runAgent(
  body: { kind: 'session' | 'progress'; coachId: string; payload: unknown; images: { name: string; dataUrl: string }[] },
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
) {
  const { url, token, via } = useAgent.getState()
  if (via === 'relay') {
    let result: Extract<AgentEvent, { type: 'result' }> | null = null
    let failure: string | null = null
    const end = await relay.stream(
      '/analyze',
      body,
      (event, data) => {
        const e = { type: event, ...JSON.parse(data) } as AgentEvent
        if (e.type === 'result') result = e
        else if (e.type === 'error') failure = e.message
        else onEvent(e)
      },
      signal,
    )
    if (end && end.status >= 400) throw new Error(`电脑上的 agent 返回 ${end.status} ${end.body.slice(0, 200)}`)
    if (failure) throw new Error(failure)
    if (!result) throw new Error('agent 没有返回结果')
    return result as Extract<AgentEvent, { type: 'result' }>
  }
  const res = await fetch(`${url}/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-liftlens-token': token },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    const msg = await res.text().catch(() => '')
    throw new Error(`本地 agent 返回 ${res.status} ${msg}`)
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ''
  let result: Extract<AgentEvent, { type: 'result' }> | null = null
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += value
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i)
      buf = buf.slice(i + 2)
      const ev = /^event: (.+)$/m.exec(block)?.[1]
      const data = /^data: (.+)$/m.exec(block)?.[1]
      if (!ev || !data) continue
      const e = { type: ev, ...JSON.parse(data) } as AgentEvent
      if (e.type === 'result') result = e
      if (e.type === 'error') throw new Error(e.message)
      onEvent(e)
    }
  }
  if (!result) throw new Error('agent 没有返回结果')
  return result
}

export interface RelayInfo {
  enabled: boolean
  relay: string
  code: string
  link: string
  connected: boolean
  phones: number
}
/** this computer's phone-connect code (only from a browser paired with the local agent) */
export const fetchRelayInfo = (): Promise<RelayInfo> => agentFetch('/relay-info')
