// Content fingerprint of the agent source (src/*.mjs). The web app is built with the same
// fingerprint, so it can tell when a user's local agent is out of date — no manual version bumps.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export function agentBuildId(srcDir) {
  const h = crypto.createHash('sha256')
  for (const f of fs.readdirSync(srcDir).filter((n) => n.endsWith('.mjs')).sort()) {
    h.update(f + '\0')
    h.update(fs.readFileSync(path.join(srcDir, f)))
  }
  return h.digest('hex').slice(0, 10)
}
