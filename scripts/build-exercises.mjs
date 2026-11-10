#!/usr/bin/env node
// Generates web/src/data/exercises.json (the exercise library)
//
//   node scripts/build-exercises.mjs <exercises-dataset dir or data/exercises.json> [--stats] [--sample N]
//
// Source: github.com/hasaneyldrm/exercises-dataset (ExerciseDB v1 text data, MIT, © 2026 Hasan Emir Yıldırım).
// Text fields only, no images/GIFs (media belongs to Gym visual and is not MIT-licensed).
// Merges: scripts/exercises-zh.json (Chinese names) + scripts/exercises-overrides.json (manual fixes).
// Deterministic output: sorted by id, fixed field order, identical across runs.
//
// Only reads data; never executes anything from the dataset.

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const OUT = join(root, 'web/src/data/exercises.json')

const args = process.argv.slice(2)
const src = args.find((a) => !a.startsWith('--'))
if (!src) {
  console.error('usage: node scripts/build-exercises.mjs <path to exercises-dataset (repo dir or data/exercises.json)> [--stats] [--sample N]')
  process.exit(1)
}
const srcFile = statSync(src).isDirectory() ? join(src, 'data/exercises.json') : src
const showStats = args.includes('--stats')
const sampleN = args.includes('--sample') ? Number(args[args.indexOf('--sample') + 1] || 40) : 0

const raw = JSON.parse(readFileSync(srcFile, 'utf8'))
const zh = JSON.parse(readFileSync(join(here, 'exercises-zh.json'), 'utf8'))
const overrides = JSON.parse(readFileSync(join(here, 'exercises-overrides.json'), 'utf8'))
delete overrides.$comment

// ------------------------------------------------------------------ Cleaning

const clean = (s) =>
  String(s ?? '')
    .replace(/в°/g, '°') // mojibake in the dataset: "sled 45в° leg press"
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

// ------------------------------------------------------------------ Pattern mapping rules
//
// Principle: only assign a pattern when a side-view video + 2D pose can reliably see the main joint motion;
// when unsure, prefer null (log only, no analysis) — a wrong analysis hurts more than none.
// Rules match in order; the first hit wins. One-off exceptions go in exercises-overrides.json.

const CARDIO_EQUIP = new Set(['stationary bike', 'elliptical machine', 'stepmill machine', 'skierg machine', 'upper body ergometer'])

/** Never analyzed: stretching/mobility, cardio, Olympic lifts and multi-phase complexes, throws, rotation/side bends, small joints, frontal-plane moves */
const NULL_RULES = [
  /stretch|\bpose\b|yoga|\bcircles?\b|roller (back|hip|side|seated)|spine twist|sphinx|upward facing dog|inchworm|world greatest/,
  /\bclean\b(?![- ]grip)|\b(snatch|jerk|thruster|get up|windmill|figure 8|burpee|muscle[ -]up|kipping|swing 360|pirate|bent press)\b/,
  /\b(throw|slam|pass|chest push|sledge|tire flip|battling|jump rope|boxing|hook)\b/,
  /\b(run|walk|crawl|skater|hops|march|jumps|quick feet|bike|ergometer|elliptical|stepmill|cross trainer|balance board)\b|sprint(?! lunge)|backward jump|forward jump|jack jump|star jump|squat jump|box jump|depth jump|back and forth step|ski step|high knee against/,
  /\btwist|twisting|rotation|rotate|rotary|rotational|russian|wipers|seated side crunch|side bend|side bent|heel touch|oblique|bicycle|cross body crunch|judo|spell caster|around (world|pullover)|180\b/,
  /\bwrist|finger|grip(per)? hands|hand squeeze|pronation|supination|forearm|shrug|toe raise|reverse calf/,
  /abduction|adduction|abductor|monster walk|pallof|kick\b|kicks|flutter|dead bug|scissor|elbow-to-knee|elbow to knee|knee touch|toe touch|bear crawl/,
  // Leg curls/extensions are mapped separately (see PATTERN_RULES); glute-ham raises (knee + hip move together), stability-ball hamstring curls and the ambiguous assisted prone hamstring are not analyzed
  /glute-ham|hamstring curl|lower back curl|assisted prone hamstring/,
  /\b(fly|flyes|crossovers?|cross-over|breeding|iron cross|squeeze|svend|hug)\b/,
  /pullover|straight arm pulldown|pushdown \(straight arm\)|front raise and pullover|rear delt raise|rear lateral|reverse fly|rear fly|deltoid rear|incline shoulder raises?|cuban/,
  /squat row|curl squat|curl to|curl and press|with bicep curl|bicep curl lunge|lunge triceps|overhead reach|lunge with (twist|swing)|step with swing|squat jump step|lateral lunge|cossack|squat \(on knees\)|kneeling jump squat|lunge pass through/,
  /scapula|push-up plus|elbow lift|hindu|pike-to-cobra|spider crawl|to side plank|planche push-up|lever reps|stalder|impossible dips|korean dips|elevator|london bridge|rear decline bridge|pelvic tilt|butt-ups|bottoms-up|body-up|kick out|pull-in|rollerout|wheel|body saw|fallout|leg raise.*throw|knee raise with throw|anti gravity|elbow press|alternate side press|twisting pull|rear drive|kayak|thibaudeau|renegade|high pull\b|snatch pull|rope climb|cocoons|frog crunch|groin crunch|gorilla chin|plank tap|with twist|with rear fly|carry|farmers|isometric|seated one arm rotate|skier\b|alternate leg raise/,
]

/** Static holds (logged by duration); those with a pattern map to isometric-hold */
const HOLD_RULES = /\bplank\b|wall sit|\bhold\b|l-sit|v-sit|front lever$|back lever|planche$|\bflag\b|handstand$|maltese|side bridge v\. 2|power point plank/

const NOT_HOLD = /push-up|tap|twist|fly|adduction|abduction|leg lift|reps/

/** Rules that assign a pattern */
const PATTERN_RULES = [
  // Handle combos that keywords would otherwise misclassify first
  [/leg curl|lying femoral/, 'knee-flexion'], // lying/seated/standing/kneeling leg curls, dumbbell lying leg curl, reverse leg curl (Nordic curl)
  [/leg extension/, 'knee-extension'],
  [/pull through/, 'hinge'],
  [/calf|\bcalves\b(?!.*stretch)/, 'calf-raise'],
  [/hip thrust|glute bridge|single leg bridge|\bhip lift\b|smith hip raise|barbell lying lifting/, 'hip-thrust'],

  // Push
  [/handstand push-up|pike push up|pike push-up/, 'vertical-push'],
  [/push-?up|push up/, 'push-up'],
  [/\bdips?\b(?! cage)/, 'dip'],
  [/jm bench press|skull ?crusher|skull press|face press|tate press|french press|triceps? extension|tricep extension|kickbacks?|pushdown|triceps press|\bextension \(|concentration extension|bench extension|lying extension|single extension|two arm extension|one arm extension|alternate extension/, 'elbow-extension'],
  [/bench press|chest press|floor press|press on floor|pin press|guillotine|\bpress on exercise ball|incline ((alternate|one arm|palm-in|hammer|reverse-grip|reverse grip) )*(chest )?press|decline (one arm )?(hammer |wide-grip |reverse-grip |)press|close[- ]grip press|lying (one arm|hammer|close-grip) press|reverse grip press|reverse-grip press|smith .*bench press|inner chest press|hammer press|band bench press|cable (decline|incline|seated|one arm) .*press|cable press/, 'horizontal-push'],
  [/shoulder press|military press|overhead press|push press|arnold press|behind (neck|head) (military )?press|bradford|scott press|seesaw press|kettlebell (two arm |alternating |seated |double )?press|alternate press|alternating press|palms? in press|palm in press|seated press|twisting overhead press|\bw-press|military press to the side|bench seated press|seated alternate shoulder$/, 'vertical-push'],

  // Pull
  [/curl(?!-up)/, 'elbow-flexion'],
  [/inverted row|bench pull-ups|suspended row|squatting row|standing (one arm |close-grip |close-grip one arm )?row|towel row/, 'horizontal-pull'],
  [/pull-?up|pull up|chin-?ups?|\bchin\b|pulldown|pull-down|sternum chin|side-to-side chin/, 'vertical-pull'],
  [/upright row/, 'shoulder-raise'],
  [/\brow\b/, 'horizontal-pull'],

  // Shoulders
  [/lateral raise|front raise|\by-raise|\bt-raise|forward raise|front shoulder raise|full can|lateral to front|dumbbell raise|alternate raise|incline raise|one hand raise|lever lateral raise/, 'shoulder-raise'],

  // Lower body
  [/split squat|lunge|step-?up|curtsey/, 'lunge'],
  [/squat|leg press|leg wide press|knee bends|chair squat/, 'squat'],
  [/deadlift|good morning|rack pull|kettlebell swing|hyperextension|back extension|reverse hyper|lever hip extension|hip extension v\. 2/, 'hinge'],

  // Core
  [/crunch|sit-?up|sit up|v-up|jackknife|jack knife|leg raise|knee raise|hip raise|leg-hip raise|leg hip raise|hanging pike|leg pull in|otis up|curl-up|hug keens|negative crunch|tuck/, 'core-flexion'],
]

const UNILATERAL = /one arm|single arm|one-arm|single-arm|one leg|single leg|one-leg|single-leg|one hand|unilateral|alternat|pistol|split squat|lunge|step-?up|curtsey|archer/

function classify(e) {
  const n = e.name
  if (CARDIO_EQUIP.has(e.equipment) || e.bodyPart === 'cardio') return { pattern: null, hold: false }
  const isHold = HOLD_RULES.test(n) && !NOT_HOLD.test(n)
  const hold = isHold || /stretch|\bpose\b/.test(n)
  if (isHold) return { pattern: 'isometric-hold', hold: true }
  for (const re of NULL_RULES) if (re.test(n)) return { pattern: null, hold }
  for (const [re, p] of PATTERN_RULES) if (re.test(n)) return { pattern: p, hold }
  return { pattern: null, hold }
}

// Big three: one canonical id per lift (picked by name)
const BIG3 = {
  bench: 'barbell bench press',
  squat: 'barbell full squat',
  deadlift: 'barbell deadlift',
}

// ------------------------------------------------------------------ Assembly

const uniq = (xs) => [...new Set(xs)]
const out = []
const missingZh = []
for (const r of raw) {
  const id = String(r.id)
  const e = {
    id,
    name: clean(r.name),
    zh: zh[id] ?? '',
    bodyPart: clean(r.body_part),
    equipment: clean(r.equipment),
    target: clean(r.target),
    secondaryMuscles: uniq((r.secondary_muscles ?? []).map(clean)).filter((m) => m && m !== clean(r.target)),
    pattern: null,
  }
  if (!e.zh) missingZh.push(id)
  const c = classify(e)
  e.pattern = c.pattern
  if (UNILATERAL.test(e.name)) e.unilateral = true
  if (c.hold) e.hold = true
  for (const [k, name] of Object.entries(BIG3)) if (e.name === name) e.big3 = k

  const o = overrides[id]
  if (o) {
    for (const [k, v] of Object.entries(o)) {
      if (k === 'note') continue
      if (v === false && k !== 'pattern') delete e[k]
      else e[k] = v
    }
  }
  // Fixed field order
  const fixed = { id: e.id, name: e.name, zh: e.zh, bodyPart: e.bodyPart, equipment: e.equipment, target: e.target, secondaryMuscles: e.secondaryMuscles, pattern: e.pattern }
  if (e.unilateral) fixed.unilateral = true
  if (e.hold) fixed.hold = true
  if (e.big3) fixed.big3 = e.big3
  out.push(fixed)
}
out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

for (const k of Object.keys(BIG3)) {
  const n = out.filter((e) => e.big3 === k).length
  if (n !== 1) throw new Error(`big3 ${k}: expected exactly 1 canonical exercise, got ${n}`)
}
for (const id of Object.keys(overrides)) if (!out.some((e) => e.id === id)) console.warn(`override for unknown id ${id}`)
if (missingZh.length) console.warn(`missing zh for ${missingZh.length}: ${missingZh.slice(0, 20).join(', ')}`)

mkdirSync(dirname(OUT), { recursive: true })
// One exercise per line: compact and diff-friendly
const json = '[\n' + out.map((e) => JSON.stringify(e)).join(',\n') + '\n]\n'
writeFileSync(OUT, json)
console.log(`wrote ${out.length} exercises → ${OUT} (${(Buffer.byteLength(json) / 1024).toFixed(1)} KB)`)

if (showStats || sampleN) {
  const by = {}
  for (const e of out) by[e.pattern ?? 'null'] = (by[e.pattern ?? 'null'] || 0) + 1
  console.log('per pattern:', by)
  console.log('unilateral:', out.filter((e) => e.unilateral).length, 'hold:', out.filter((e) => e.hold).length, 'big3:', out.filter((e) => e.big3).map((e) => `${e.big3}=${e.id}`).join(' '))
}
if (sampleN) {
  // Deterministic pseudo-random sample (fixed seed) for manual spot checks
  let s = 20261110
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const pool = [...out]
  for (let i = 0; i < sampleN && pool.length; i++) {
    const e = pool.splice(Math.floor(rnd() * pool.length), 1)[0]
    console.log(`${e.id}\t${String(e.pattern)}\t${e.unilateral ? 'U' : ''}${e.hold ? 'H' : ''}\t${e.name}\t${e.zh}`)
  }
}
