import { create } from 'zustand'
import { getSetting, setSetting } from './db'

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
  load: () => Promise<void>
  save: (url: string, token: string) => Promise<void>
  /**
   * Probe the agent on this computer. Without `force`, only browsers that were paired before are
   * probed: a public page calling 127.0.0.1 makes browsers ask for local-network permission, and
   * phones can never reach a local agent anyway.
   */
  check: (force?: boolean) => Promise<void>
}

const TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

export const useAgent = create<AgentState>((set, get) => ({
  url: 'http://127.0.0.1:4517',
  token: '',
  status: 'unknown',
  health: null,
  load: async () => {
    const url = await getSetting('agentUrl', 'http://127.0.0.1:4517')
    const token = await getSetting('agentToken', '')
    set({ url, token })
    await get().check()
  },
  save: async (url, token) => {
    await setSetting('agentUrl', url)
    await setSetting('agentToken', token)
    set({ url, token })
    await get().check()
  },
  check: async (force = false) => {
    const { url, token } = get()
    if (!force && (TOUCH || !token)) {
      set({ status: 'offline', health: null })
      return
    }
    try {
      const h = (await (await fetch(`${url}/health`, { signal: AbortSignal.timeout(2500) })).json()) as AgentHealth
      const r = await fetch(`${url}/coaches`, { headers: { 'x-liftlens-token': token } })
      set({ health: h, status: r.ok ? 'ready' : 'unpaired' })
    } catch {
      set({ status: 'offline', health: null })
    }
  },
}))

/**
 * The one-line command shown wherever the agent is missing.
 * Hosted site: the agent is an npm package pinned to the version this web build expects.
 * Local dev: run it from the repo.
 */
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname)
/** versioned tarball name → npx never reuses a stale cached copy */
export const AGENT_CMD = IS_LOCAL ? 'node agent/src/cli.mjs' : `npx -y ${__AGENT_PKG__}`
/** true when the running local agent was built from different source than this web app expects */
export const isAgentStale = (h: AgentHealth | null) => !IS_LOCAL && !!h && h.build !== __AGENT_BUILD__

/**
 * One-click pairing: `npx @dobbylab/liftlens-agent` opens `<web>/agent#pair=<token>&agent=<url>`.
 * The token lives in the URL *fragment*, so it is never sent to whatever server hosts the web app.
 */
export async function consumePairFragment() {
  const h = new URLSearchParams(location.hash.slice(1))
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
  const { url, token } = useAgent.getState()
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
  const { url, token } = useAgent.getState()
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
