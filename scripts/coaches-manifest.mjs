// Build a content-addressed manifest of coaches/ so local agents can sync skills from the site.
// usage: node scripts/coaches-manifest.mjs <coachesDir> <outDir>
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const [src, out] = process.argv.slice(2)
const files = []
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (!e.name.startsWith('.')) files.push(path.relative(src, p).split(path.sep).join('/'))
  }
}
walk(src)
files.sort()
const entries = files.map((f) => {
  const buf = fs.readFileSync(path.join(src, f))
  fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true })
  fs.writeFileSync(path.join(out, f), buf)
  return { path: f, sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length }
})
const version = crypto.createHash('sha256').update(entries.map((e) => e.path + e.sha256).join('\n')).digest('hex').slice(0, 12)
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ version, builtAt: new Date().toISOString(), files: entries }, null, 2))
console.log(`coaches manifest ${version} · ${entries.length} files`)
