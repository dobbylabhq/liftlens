// Keep /assets files from the last few builds on deploy: already-open old pages still load old chunks when switching tabs,
// so deleting them on every deploy breaks loading (blank screen). Filenames are content-hashed, so keeping them never conflicts.
//   node scripts/keep-old-assets.mjs web/dist/assets .deploy-cache [keepBuilds=8]
import fs from 'node:fs'
import path from 'node:path'

const [dist, cacheDir, keepArg] = process.argv.slice(2)
const keep = Number(keepArg ?? 8)
const store = path.join(cacheDir, 'assets')
const listFile = path.join(cacheDir, 'builds.json')
fs.mkdirSync(store, { recursive: true })
const builds = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, 'utf8')) : []

const current = fs.readdirSync(dist).filter((f) => fs.statSync(path.join(dist, f)).isFile())
for (const f of current) fs.copyFileSync(path.join(dist, f), path.join(store, f))
builds.push({ at: new Date().toISOString(), files: current })
const kept = builds.slice(-keep)

const want = new Set(kept.flatMap((b) => b.files))
let restored = 0
for (const f of want) {
  const dst = path.join(dist, f)
  const src = path.join(store, f)
  if (!fs.existsSync(dst) && fs.existsSync(src)) {
    fs.copyFileSync(src, dst)
    restored++
  }
}
// Remove old files that are no longer needed
for (const f of fs.readdirSync(store)) if (!want.has(f)) fs.rmSync(path.join(store, f))
fs.writeFileSync(listFile, JSON.stringify(kept, null, 1))
console.log(`assets: ${current.length} current + ${restored} kept from ${kept.length - 1} previous builds`)
