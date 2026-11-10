// Coach-skill sync: the site publishes coaches/ + manifest.json on every deploy;
// the local agent pulls changes so skill updates reach users without reinstalling.
//
// Layout:  ~/.liftlens/coaches/<version>/...   (one dir per manifest version)
//          ~/.liftlens/coaches/current          (text file with the active version)
// A version only becomes "current" after every file downloaded and matched its sha256.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { BUNDLED_COACHES_DIR, HOME, IS_DEV_WEB, WEB_URL } from './config.mjs'

const ROOT = path.join(HOME, 'coaches')
const CURRENT = path.join(ROOT, 'current')
const MIN_INTERVAL_MS = 10 * 60 * 1000

let lastCheck = 0
let inflight = null
export const syncState = { version: null, source: 'bundled', lastError: null, checkedAt: null }

function currentDir() {
  try {
    const v = fs.readFileSync(CURRENT, 'utf8').trim()
    const dir = path.join(ROOT, v)
    if (v && fs.existsSync(path.join(dir, 'manifest.json'))) return { v, dir }
  } catch {
    /* none yet */
  }
  return null
}

/** Directory the agent should load skills from right now. */
export function coachesDir() {
  const cur = IS_DEV_WEB ? null : currentDir()
  if (cur) {
    syncState.version = cur.v
    syncState.source = 'synced'
    return cur.dir
  }
  syncState.source = 'bundled'
  return BUNDLED_COACHES_DIR
}

async function doSync() {
  const base = `${WEB_URL}/coaches`
  const res = await fetch(`${base}/manifest.json`, { signal: AbortSignal.timeout(5000), cache: 'no-store' })
  if (!res.ok) throw new Error(`manifest HTTP ${res.status}`)
  const manifest = await res.json()
  if (!manifest?.version || !Array.isArray(manifest.files)) throw new Error('manifest 格式不对')
  const cur = currentDir()
  if (cur?.v === manifest.version) return { updated: false, version: manifest.version }

  const target = path.join(ROOT, manifest.version)
  const tmp = `${target}.partial-${process.pid}`
  fs.rmSync(tmp, { recursive: true, force: true })
  for (const f of manifest.files) {
    if (f.path.includes('..') || path.isAbsolute(f.path)) throw new Error(`非法路径 ${f.path}`)
    // reuse unchanged files from the current version instead of downloading again
    let buf = null
    if (cur) {
      const old = path.join(cur.dir, f.path)
      if (fs.existsSync(old)) {
        const b = fs.readFileSync(old)
        if (crypto.createHash('sha256').update(b).digest('hex') === f.sha256) buf = b
      }
    }
    if (!buf) {
      const r = await fetch(`${base}/${f.path.split('/').map(encodeURIComponent).join('/')}`, { signal: AbortSignal.timeout(10000) })
      if (!r.ok) throw new Error(`${f.path} HTTP ${r.status}`)
      buf = Buffer.from(await r.arrayBuffer())
      if (crypto.createHash('sha256').update(buf).digest('hex') !== f.sha256) throw new Error(`${f.path} 校验失败`)
    }
    fs.mkdirSync(path.dirname(path.join(tmp, f.path)), { recursive: true })
    fs.writeFileSync(path.join(tmp, f.path), buf)
  }
  fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 2))
  fs.rmSync(target, { recursive: true, force: true })
  fs.renameSync(tmp, target)
  fs.writeFileSync(CURRENT, manifest.version)
  // keep only the two newest versions
  const keep = new Set([manifest.version, cur?.v])
  for (const d of fs.readdirSync(ROOT)) {
    const p = path.join(ROOT, d)
    if (d !== 'current' && !keep.has(d) && fs.statSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true })
  }
  return { updated: true, version: manifest.version, from: cur?.v ?? 'bundled' }
}

/** Check the site for newer skills (throttled). Never throws — falls back to what we have. */
export function syncCoaches({ force = false } = {}) {
  if (IS_DEV_WEB) return Promise.resolve({ updated: false, skipped: true, reason: 'dev' })
  if (inflight) return inflight
  if (!force && Date.now() - lastCheck < MIN_INTERVAL_MS) return Promise.resolve({ updated: false, skipped: true })
  lastCheck = Date.now()
  fs.mkdirSync(ROOT, { recursive: true })
  inflight = doSync()
    .then((r) => {
      syncState.lastError = null
      syncState.checkedAt = new Date().toISOString()
      syncState.version = r.version
      return r
    })
    .catch((e) => {
      syncState.lastError = e.message
      syncState.checkedAt = new Date().toISOString()
      return { updated: false, error: e.message }
    })
    .finally(() => (inflight = null))
  return inflight
}
