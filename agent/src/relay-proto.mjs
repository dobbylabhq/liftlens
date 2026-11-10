// End-to-end encrypted framing for the phone ⇄ computer relay. Shared by the agent (Node 20+) and
// the web app (imported from web/src/lib/relay.ts), so both sides speak exactly the same format.
//
// Message = any JSON value → AES-256-GCM (random 96-bit IV) → base64 → split into ≤256 KB chunks.
// Each chunk travels as {m: messageId, i: index, n: count, d: data}. The relay sees only these.
// Relay presence notices are plaintext {sys: ...} and carry no user data.

const subtle = globalThis.crypto.subtle
const CHUNK = 256 * 1024

const enc = new TextEncoder()
const dec = new TextDecoder()

export function toB64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
export function fromB64(b64) {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
const b64url = (bytes) => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = (s) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))

/** new room id (128-bit) + key (256-bit), both base64url */
export function newRelayCreds() {
  const r = globalThis.crypto.getRandomValues(new Uint8Array(16))
  const k = globalThis.crypto.getRandomValues(new Uint8Array(32))
  return { room: b64url(r), key: b64url(k) }
}

/** "<room>.<key>" — what the QR code / connect code carries */
export const encodeCode = ({ room, key }) => `${room}.${key}`
export function decodeCode(code) {
  const m = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(String(code ?? '').trim())
  return m ? { room: m[1], key: m[2] } : null
}

export const importKey = (key) => subtle.importKey('raw', fromB64url(key), 'AES-GCM', false, ['encrypt', 'decrypt'])

let seq = 0
/** encrypt one message → wire frames (strings) */
export async function seal(cryptoKey, value) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, enc.encode(JSON.stringify(value))))
  const all = new Uint8Array(12 + ct.length)
  all.set(iv)
  all.set(ct, 12)
  const b64 = toB64(all)
  const n = Math.max(1, Math.ceil(b64.length / CHUNK))
  const m = `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`
  return Array.from({ length: n }, (_, i) => JSON.stringify({ m, i, n, d: b64.slice(i * CHUNK, (i + 1) * CHUNK) }))
}

/** reassembles chunks and decrypts; frames that fail to decrypt (wrong key / tampered) are dropped */
export function createOpener(cryptoKey) {
  const parts = new Map()
  return async function open(frame) {
    let f
    try {
      f = JSON.parse(frame)
    } catch {
      return null
    }
    if (f.sys) return { sys: f }
    if (typeof f.m !== 'string' || typeof f.d !== 'string' || !(f.n >= 1) || !(f.i >= 0) || f.i >= f.n || f.n > 4096) return null
    let p = parts.get(f.m)
    if (!p) parts.set(f.m, (p = { n: f.n, got: 0, d: new Array(f.n), t: Date.now() }))
    if (p.d[f.i] === undefined) p.got++
    p.d[f.i] = f.d
    if (p.got < p.n) {
      // forget half-received messages after a minute
      for (const [k, v] of parts) if (Date.now() - v.t > 60_000) parts.delete(k)
      return null
    }
    parts.delete(f.m)
    try {
      const all = fromB64(p.d.join(''))
      const pt = await subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12) }, cryptoKey, all.subarray(12))
      return { msg: JSON.parse(dec.decode(pt)) }
    } catch {
      return null
    }
  }
}
