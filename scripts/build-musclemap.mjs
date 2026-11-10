// Convert MuscleMap's (github.com/melihcolpan/MuscleMap, MIT, © 2026 Melih Colpan) Swift path
// data into a compact JSON body map for the web app.
//
// usage: node scripts/build-musclemap.mjs <MuscleMap repo dir> [out=web/src/data/musclemap.json]
//
// The Swift sources are treated as untrusted DATA: we only regex out string literals that look
// like SVG path data (validated against a strict character whitelist) — nothing is executed.
// Only the male front/back bodies are kept. Each body part becomes ONE path string
// (common + left + right sub-paths concatenated; every sub-path starts with an absolute M).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const [repo, outArg] = process.argv.slice(2)
if (!repo) {
  console.error('usage: node scripts/build-musclemap.mjs <MuscleMap repo dir> [out.json]')
  process.exit(1)
}
const out = outArg ?? path.join(here, '../web/src/data/musclemap.json')
const dataDir = path.join(repo, 'Sources/MuscleMap/Data')

/** MuscleMap slug → our MuscleKey (null = silhouette only, undefined = dropped). */
const SLUG = {
  chest: 'chest', upperChest: 'upperChest', lowerChest: 'lowerChest',
  deltoids: 'delts', frontDeltoid: 'frontDelts', rearDeltoid: 'rearDelts',
  biceps: 'biceps', triceps: 'triceps', forearm: 'forearms',
  abs: 'abs', upperAbs: 'upperAbs', lowerAbs: 'lowerAbs', obliques: 'obliques', serratus: 'serratus',
  quadriceps: 'quads', hipFlexors: 'hipFlexors', adductors: 'adductors',
  hamstring: 'hamstrings', gluteal: 'glutes', calves: 'calves', tibialis: 'tibialis',
  trapezius: 'traps', upperTrapezius: 'upperTraps', lowerTrapezius: 'lowerTraps', rhomboids: 'rhomboids',
  upperBack: 'lats', rotatorCuff: 'rotatorCuff', lowerBack: 'lowerBack', neck: 'neck',
  // silhouette (non-interactive)
  head: null, hair: null, hands: null, feet: null, knees: null, ankles: null,
  // inner/outer quad overlays: no ExerciseDB term needs them
  innerQuad: undefined, outerQuad: undefined,
}

const PATH_RE = /^M[0-9MmLlHhVvCcSsQqTtAaZz.,\s+\-eE]+$/

function parseSwift(file) {
  const src = fs.readFileSync(path.join(dataDir, file), 'utf8')
  const parts = []
  for (const chunk of src.split('BodyPartPathData(').slice(1)) {
    const slug = /^\s*slug:\s*\.(\w+)/.exec(chunk)?.[1]
    if (!slug) continue
    const body = chunk.slice(0, chunk.search(/\n\s*\)\s*,?\s*(\n|$)/) + 1 || undefined)
    const d = []
    for (const m of body.matchAll(/(common|left|right):\s*\[([\s\S]*?)\]/g)) {
      for (const s of m[2].matchAll(/"([^"\\]*)"/g)) {
        const p = s[1].trim()
        if (!PATH_RE.test(p)) throw new Error(`${file}/${slug}: unexpected path data`)
        d.push(p)
      }
    }
    parts.push({ slug, d })
  }
  return parts
}

// ---- conservative bbox of an SVG path (endpoints + control points) ----
function pathBBox(d, box) {
  let i = 0
  const n = d.length
  const skip = () => { while (i < n && /[\s,]/.test(d[i])) i++ }
  const num = () => {
    skip()
    const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(d.slice(i))
    if (!m) throw new Error('bad number at ' + i + ' in ' + d.slice(i, i + 20))
    i += m[0].length
    return +m[0]
  }
  const flag = () => { skip(); const c = d[i++]; if (c !== '0' && c !== '1') throw new Error('bad flag'); return +c }
  let x = 0, y = 0, sx = 0, sy = 0, cmd = ''
  const add = (px, py) => {
    box[0] = Math.min(box[0], px); box[1] = Math.min(box[1], py)
    box[2] = Math.max(box[2], px); box[3] = Math.max(box[3], py)
  }
  while (true) {
    skip()
    if (i >= n) break
    if (/[A-Za-z]/.test(d[i])) cmd = d[i++]
    const rel = cmd === cmd.toLowerCase()
    const ox = rel ? x : 0, oy = rel ? y : 0
    switch (cmd.toUpperCase()) {
      case 'M': case 'L': case 'T': {
        x = ox + num(); y = oy + num(); add(x, y)
        if (cmd === 'M') { sx = x; sy = y; cmd = 'L' } else if (cmd === 'm') { sx = x; sy = y; cmd = 'l' }
        break
      }
      case 'H': x = (rel ? x : 0) + num(); add(x, y); break
      case 'V': y = (rel ? y : 0) + num(); add(x, y); break
      case 'C': { add(ox + num(), oy + num()); add(ox + num(), oy + num()); x = ox + num(); y = oy + num(); add(x, y); break }
      case 'S': case 'Q': { add(ox + num(), oy + num()); x = ox + num(); y = oy + num(); add(x, y); break }
      case 'A': { num(); num(); num(); flag(); flag(); x = ox + num(); y = oy + num(); add(x, y); break }
      case 'Z': x = sx; y = sy; break
      default: throw new Error('bad command ' + cmd)
    }
  }
}

const r1 = (v) => Math.round(v * 10) / 10

function build(file) {
  const parts = {}
  const body = []
  const box = [Infinity, Infinity, -Infinity, -Infinity]
  for (const { slug, d } of parseSwift(file)) {
    if (!(slug in SLUG)) throw new Error(`${file}: unknown slug ${slug} — extend SLUG`)
    const key = SLUG[slug]
    if (key === undefined) continue
    for (const p of d) pathBBox(p, box)
    if (key === null) body.push(...d)
    else parts[key] = (parts[key] ? parts[key] + ' ' : '') + d.join(' ')
  }
  const pad = 6
  const viewBox = [r1(box[0] - pad), r1(box[1] - pad), r1(box[2] - box[0] + 2 * pad), r1(box[3] - box[1] + 2 * pad)]
  return { viewBox, body: body.join(' '), parts }
}

const json = {
  source: 'https://github.com/melihcolpan/MuscleMap',
  license: 'MIT',
  copyright: 'Copyright (c) 2026 Melih Colpan',
  front: build('MaleFrontPaths.swift'),
  back: build('MaleBackPaths.swift'),
}
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(json))
const kb = (fs.statSync(out).size / 1024).toFixed(1)
console.log(`musclemap → ${path.relative(process.cwd(), out)} · ${kb} KB`)
for (const v of ['front', 'back']) console.log(`  ${v}: viewBox ${json[v].viewBox.join(' ')} · ${Object.keys(json[v].parts).join(', ')}`)
