// Shared configuration for the LiftLens local agent.
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { agentBuildId } from './build-id.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'))
// running from the repo checkout: pick up the git-ignored root .env (see .env.example)
try {
  const envFile = path.join(__dirname, '../../.env')
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile)
} catch {
  /* Node < 20.12: rely on the real environment */
}
export const VERSION = PKG.version
export const BUILD = agentBuildId(__dirname)
export const PORT = Number(process.env.LIFTLENS_PORT ?? 4517)
export const AGENT_URL = `http://127.0.0.1:${PORT}`
/** Where the LiftLens web app lives. Used for the one-click pairing link + CORS allow-list. */
// env > baked-in default (set by scripts/deploy.sh for the hosted tarball) > local dev server
export const WEB_URL = (process.env.LIFTLENS_WEB_URL ?? PKG.liftlens?.webUrl ?? 'http://localhost:5180').replace(/\/$/, '')
/** local dev: use the repo's coaches/ as-is, never a synced copy */
export const IS_DEV_WEB = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(WEB_URL)
export const MODEL = process.env.LIFTLENS_MODEL // optional, e.g. "sonnet"

export const HOME = path.join(os.homedir(), '.liftlens')
fs.mkdirSync(HOME, { recursive: true })

/** Coach skills shipped with the package (agent/coaches) or the repo checkout (../coaches). Synced copies win — see sync.mjs. */
export const BUNDLED_COACHES_DIR = [process.env.LIFTLENS_COACHES, path.join(__dirname, '../coaches'), path.join(__dirname, '../../coaches')]
  .filter(Boolean)
  .map((p) => path.resolve(p))
  .find((p) => fs.existsSync(path.join(p, '_shared'))) ?? path.join(__dirname, '../coaches')

/**
 * Production site: written into the package by scripts/deploy.sh at release time (package.json liftlens.webUrl); local dev uses
 * LIFTLENS_SITE (see .env.example in the repo root). No deployment URL is hardcoded.
 */
export const OFFICIAL_WEB_URL = (process.env.LIFTLENS_SITE ?? PKG.liftlens?.webUrl ?? '').replace(/\/$/, '')
export const ORIGINS = [
  ...new Set([
    ...(OFFICIAL_WEB_URL ? [OFFICIAL_WEB_URL] : []),
    ...(process.env.LIFTLENS_ORIGINS ?? 'http://localhost:5180,http://127.0.0.1:5180,http://localhost:4173').split(','),
    new URL(WEB_URL).origin,
  ]),
]
  .map((s) => s.trim())
  .filter(Boolean)

// ---------- pairing token ----------
const tokenFile = path.join(HOME, 'token')
export function readToken() {
  if (!fs.existsSync(tokenFile)) rotateToken()
  return fs.readFileSync(tokenFile, 'utf8').trim()
}
export function rotateToken() {
  fs.writeFileSync(tokenFile, randomBytes(12).toString('base64url'), { mode: 0o600 })
  return fs.readFileSync(tokenFile, 'utf8').trim()
}
/** One-click pairing: the web app reads the token from the URL fragment (never sent to a server). */
export function pairUrl(token = readToken()) {
  return `${WEB_URL}/agent#pair=${encodeURIComponent(token)}&agent=${encodeURIComponent(AGENT_URL)}`
}

// ---------- runtime discovery ----------
export function which(bin) {
  try {
    return execFileSync(process.platform === 'win32' ? 'where' : '/usr/bin/which', [bin], { encoding: 'utf8' }).trim().split('\n')[0] || null
  } catch {
    return null
  }
}
export function versionOf(bin) {
  try {
    return execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000 }).trim().split('\n')[0]
  } catch {
    return null
  }
}
export function detectRuntimes() {
  const claude = process.env.LIFTLENS_CLAUDE ?? which('claude')
  return { claude: claude ? { path: claude, version: versionOf(claude) } : null }
}
