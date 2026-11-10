// Worker routes (see wrangler.jsonc run_worker_first):
//   /assets/*  — a missing chunk must 404 instead of falling back to index.html (see below)
//   /relay/*   — WebSocket relay between a phone and the user's own computer (Relay Durable Object)
//
// Assets: the SPA fallback would answer a missing script with index.html, and /assets/* is cached
// for a year as immutable → the browser remembers that HTML as the script → blank page that a
// reload can't fix. So that case becomes an uncached 404.

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/relay/')) return relay(request, env, url)
    const res = await env.ASSETS.fetch(request)
    const type = res.headers.get('content-type') || ''
    if (res.status === 200 && type.includes('text/html')) {
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
    }
    return res
  },
}

// ---------------------------------------------------------------- relay
//
// GET /relay/<room>?role=agent|client  (WebSocket upgrade)
//
// One room per computer: a random 128-bit id the agent generates and shows as a QR code together
// with a 256-bit key. Everything after the handshake is AES-GCM encrypted end to end with that key
// (the key never reaches this server), so the relay only forwards opaque frames between the
// computer and the user's browsers. The only plaintext frames are the relay's own presence notices.

const ROOM = /^[A-Za-z0-9_-]{22,64}$/
const MAX_FRAME = 1024 * 1024 // agent / web chunk well below this

async function relay(request, env, url) {
  const room = url.pathname.slice('/relay/'.length)
  const role = url.searchParams.get('role')
  if (!ROOM.test(room) || (role !== 'agent' && role !== 'client')) return new Response('bad request', { status: 400 })
  if (request.headers.get('upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })
  const stub = env.RELAY.get(env.RELAY.idFromName(room))
  return stub.fetch(request)
}

export class Relay {
  constructor(ctx) {
    this.ctx = ctx
  }

  async fetch(request) {
    const role = new URL(request.url).searchParams.get('role')
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    // one computer per room: a new agent connection replaces the old one (e.g. after a restart)
    if (role === 'agent') for (const ws of this.ctx.getWebSockets('agent')) ws.close(4000, 'replaced')
    this.ctx.acceptWebSocket(server, [role])
    const agentOnline = this.ctx.getWebSockets('agent').length > 0
    if (role === 'agent') this.broadcast('client', { sys: 'agent', online: true })
    else server.send(JSON.stringify({ sys: 'agent', online: agentOnline }))
    if (role === 'agent') server.send(JSON.stringify({ sys: 'clients', count: this.ctx.getWebSockets('client').length }))
    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > MAX_FRAME) return
    if (message === 'ping') return ws.send('pong')
    const [role] = this.ctx.getTags(ws)
    // agent → every client (each client ignores replies to requests it didn't send); client → agent
    for (const peer of this.ctx.getWebSockets(role === 'agent' ? 'client' : 'agent')) {
      try {
        peer.send(message)
      } catch {
        /* peer gone */
      }
    }
  }

  webSocketClose(ws) {
    this.gone(ws)
  }
  webSocketError(ws) {
    this.gone(ws)
  }
  gone(ws) {
    const [role] = this.ctx.getTags(ws)
    if (role === 'agent' && this.ctx.getWebSockets('agent').filter((s) => s !== ws).length === 0) this.broadcast('client', { sys: 'agent', online: false })
  }

  broadcast(role, msg) {
    const s = JSON.stringify(msg)
    for (const ws of this.ctx.getWebSockets(role)) {
      try {
        ws.send(s)
      } catch {
        /* gone */
      }
    }
  }
}
