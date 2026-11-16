// Spec → per-frame skeleton. Each base movement says how the limbs move *relative to the body*;
// the posture says where the body is (standing, on a flat / incline / decline bench, seated, bent
// over, hanging…). Combining the two gives every variant without describing exercises one by one.
import { BODY, add, dot, lerp, mul, norm, perp, sub, type J, type Rig, type Sides } from '../poses'
import type { ExerciseSpec } from './spec'

/** floor line (svg px) */
export const G = 128
const AH = BODY.ankleH
const RAD = Math.PI / 180
/** unit vector for a screen angle: 0 = up, 90 = +x (the way a standing figure faces), 180 = down */
export const dir = (a: number): J => [Math.sin(a * RAD), -Math.cos(a * RAD)]
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const ARM = BODY.fore + BODY.hand

/**
 * One frame, as absolute segment angles. Arms are either angles or an IK target for the hand.
 * `anchor` pins one point (feet on the floor, hips on a seat, hands on a bar…).
 */
interface Frame {
  torso: number
  thigh: number
  shin: number
  upper?: number
  fore?: number
  /** foreshortening of the upper arm / forearm when they swing toward the viewer */
  uk?: number
  fk?: number
  /** hand target (final coords, after anchoring) — arms solved by 2-bone IK instead of angles */
  hand?: J | ((p: { hip: J; shoulder: J; front: J; up: J }) => J)
  /** world direction the elbow bends toward when solving IK */
  pole?: number
  /** hand flat on a surface: the target is the palm, not the centre of a closed grip */
  palm?: boolean
  /** keep the sole on the floor even when the ankle rises (calf raise) */
  planted?: boolean
  farThigh?: number
  farShin?: number
  anchor: ['hip' | 'ankle' | 'hand' | 'knee', J]
  chest: 1 | -1
  toe: 1 | -1
}

export type Prop =
  | { kind: 'pad'; a: J; b: J; legs: boolean }
  | { kind: 'bar'; at: J; post: boolean }
  | { kind: 'step'; x0: number; x1: number; top: number }

export interface Motion {
  rig: (t: number) => Rig
  props: Prop[]
  /** cable pulley position, when the equipment is a cable / band */
  pulley: J | null
  /** machine lever pivot (leg extension / curl); otherwise machines are drawn as a guide rail */
  lever: 'knee' | null
  /** leg press foot plate: angle of the sled's travel */
  sled: number | null
  /** seconds per rep */
  tempo: number
}

function ik(a: J, target: J, l1: number, l2: number, pole: J): J {
  const v = sub(target, a)
  const d = Math.min(Math.max(Math.hypot(...v), Math.abs(l1 - l2) + 0.01), l1 + l2 - 0.01)
  const u = norm(v)
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x))
  const n = perp(u)
  const side = dot(n, pole) >= 0 ? 1 : -1
  return add(add(a, mul(u, x)), mul(n, h * side))
}

function place(f: Frame): Rig {
  let hip: J = [0, 0]
  let shoulder = add(hip, mul(dir(f.torso), BODY.torso))
  let knee = add(hip, mul(dir(f.thigh), BODY.thigh))
  let ankle = add(knee, mul(dir(f.shin), BODY.shin))
  let elbow: J = shoulder
  let wrist: J = shoulder
  let hand: J = shoulder
  const angled = f.upper != null && f.fore != null
  if (angled) {
    elbow = add(shoulder, mul(dir(f.upper!), BODY.upper * (f.uk ?? 1)))
    wrist = add(elbow, mul(dir(f.fore!), BODY.fore * (f.fk ?? 1)))
    hand = add(wrist, mul(dir(f.fore!), BODY.hand * (f.fk ?? 1)))
  }
  let farKnee = f.farThigh != null ? add(hip, mul(dir(f.farThigh), BODY.thigh)) : null
  let farAnkle = farKnee && f.farShin != null ? add(farKnee, mul(dir(f.farShin), BODY.shin)) : null
  const pinned = { hip, ankle, knee, hand }[f.anchor[0]]
  const off = sub(f.anchor[1], pinned)
  ;[hip, shoulder, knee, ankle, elbow, wrist, hand] = [hip, shoulder, knee, ankle, elbow, wrist, hand].map((p) => add(p, off))
  if (farKnee) farKnee = add(farKnee, off)
  if (farAnkle) farAnkle = add(farAnkle, off)
  const up = dir(f.torso)
  const front = dir(f.torso + 90 * f.chest)
  if (!angled && f.hand) {
    hand = typeof f.hand === 'function' ? f.hand({ hip, shoulder, front, up }) : f.hand
    const reach = f.palm ? BODY.fore + 3.9 : ARM
    elbow = ik(shoulder, hand, BODY.upper, reach, dir(f.pole ?? 180))
    wrist = add(elbow, mul(norm(sub(hand, elbow)), BODY.fore))
    if (f.palm) hand = add(wrist, mul(norm(sub(hand, elbow)), BODY.hand))
  }
  return {
    head: add(shoulder, mul(norm(add(mul(up, Math.cos(12 * RAD)), mul(front, Math.sin(12 * RAD)))), BODY.neck)),
    shoulder,
    elbow,
    wrist,
    hip,
    knee,
    ankle,
    bar: hand,
    front,
    toe: f.toe,
    far: [2.5, -2.5],
    // a foot off the floor is drawn flat under its own ankle instead of stretched down to the floor
    ground: f.planted || ankle[1] >= G - AH - 0.5 ? G : ankle[1] + AH,
    plate: 10,
    elbowZ: 0,
    wristZ: 0,
    ...(farKnee && farAnkle ? { farLeg: { knee: farKnee, ankle: farAnkle } } : {}),
  }
}

// ---------------------------------------------------------------------------- postures
type Body = Pick<Frame, 'torso' | 'thigh' | 'shin' | 'anchor' | 'chest' | 'toe'>

const stand = (lean = 0): Body => ({ torso: lean, thigh: 180, shin: 180, anchor: ['ankle', [100, G - AH]], chest: 1, toe: 1 })
const bent = (): Body => ({ torso: 66, thigh: 160, shin: 188, anchor: ['ankle', [100, G - AH]], chest: 1, toe: 1 })
const seated = (lean = -4): Body => ({ torso: lean, thigh: 90, shin: 180, anchor: ['hip', [84, G - AH - BODY.shin]], chest: 1, toe: 1 })
/** lying face up, head toward +x; bench angle + = incline, − = decline */
const supine = (bench: number): Body => ({ torso: 90 - bench, thigh: 252, shin: 176, anchor: ['ankle', [58, G - AH]], chest: -1, toe: -1 })

/** arm angles given relative to the torso, in the frame of a figure standing upright facing +x */
const rel = (b: Body, a: number) => b.torso + b.chest * a

function arms(b: Body, upper: number, fore: number, uk = 1, fk = 1) {
  return { upper: rel(b, upper), fore: rel(b, fore), uk, fk }
}

const bodyOf = (s: ExerciseSpec): Body => {
  switch (s.posture) {
    case 'bent':
      return bent()
    case 'seated':
      return seated()
    case 'supine':
      return supine(s.bench)
    default:
      return stand()
  }
}

/** bar on the upper back (back squat, good morning) */
const backBar = ({ shoulder, up, front }: { shoulder: J; up: J; front: J }): J => add(add(shoulder, mul(up, 1.2)), mul(front, -3))
/** held at the upper chest (goblet / front squat), crossed arms */
const chestHold = ({ shoulder, up, front }: { shoulder: J; up: J; front: J }): J => add(add(shoulder, mul(front, 9)), mul(up, -6))

// ---------------------------------------------------------------------------- base movements
function frameFn(s: ExerciseSpec): ((t: number) => Frame) | null {
  const b = bodyOf(s)
  switch (s.base) {
    case 'press':
      return (t) => ({ ...b, ...arms(b, mix(90, 222, t), mix(90, 92, t), mix(0.96, 0.72, t)) })
    case 'fly':
      if (s.variant === 'crossover') {
        const st = stand(12)
        return (t) => ({ ...st, ...arms(st, mix(128, 112, t), mix(118, 104, t), mix(0.95, 0.35, t), mix(0.95, 0.35, t)) })
      }
      return (t) => ({ ...b, ...arms(b, mix(88, 240, t), mix(80, 330, t), mix(0.92, 0.35, t), mix(0.92, 0.3, t)) })
    case 'pullover':
      return (t) => ({ ...b, ...arms(b, mix(85, -12, t), mix(80, -18, t)) })
    case 'ohp':
      return (t) => ({ ...b, ...arms(b, mix(6, 165, t), mix(4, 14, t), mix(1, 0.8, t)) })
    case 'row': {
      if (s.variant === 'inverted') {
        // under a bar, heels on the floor; arms solved to the bar
        return (t) => {
          const a = mix(286, 306, t)
          return { torso: a, thigh: a - 180, shin: a - 180, anchor: ['ankle', [150, G - 3]], chest: 1, toe: 1, hand: [80, 61], pole: 120 }
        }
      }
      const bb = s.variant === 'chest' ? { ...bent(), torso: 50, thigh: 168, shin: 184 } : b
      return (t) => ({ ...bb, ...arms(bb, mix(92, 222, t), mix(92, 104, t), mix(1, 0.9, t)) })
    }
    case 'pull':
      if (s.posture === 'hang')
        return (t) => ({
          torso: mix(0, -12, t),
          thigh: 186,
          shin: 172,
          anchor: ['hand', [100, 22]],
          chest: 1,
          toe: 1,
          upper: mix(2, 196, t),
          fore: mix(0, 8, t),
          uk: mix(1, 0.85, t),
        })
      return (t) => ({ ...b, ...arms(b, mix(4, 196, t), mix(2, 10, t), mix(1, 0.85, t)) })
    case 'curl':
      if (s.variant === 'preacher') {
        const sb = seated(20)
        return (t) => ({ ...sb, ...arms(sb, 140, mix(140, 22, t)) })
      }
      if (s.variant === 'concentration') {
        const sb = seated(35)
        return (t) => ({ ...sb, ...arms(sb, 150, mix(150, 25, t)) })
      }
      if (s.variant === 'incline') return (t) => ({ ...b, upper: 182, fore: mix(182, 300, t) })
      return (t) => ({ ...b, ...arms(b, 176, mix(176, 28, t)) })
    case 'triceps':
      if (s.variant === 'pushdown') {
        const sb = stand(8)
        return (t) => ({ ...sb, ...arms(sb, 172, mix(80, 174, t)) })
      }
      if (s.variant === 'overhead') return (t) => ({ ...b, ...arms(b, 2, mix(4, 200, t)) })
      if (s.variant === 'kickback') return (t) => ({ ...b, ...arms(b, 200, mix(112, 200, t)) })
      return (t) => ({ ...b, ...arms(b, 72, mix(72, -38, t)) })
    case 'raise':
      if (s.variant === 'front') return (t) => ({ ...b, ...arms(b, mix(178, 88, t), mix(172, 84, t)) })
      if (s.variant === 'rear') return (t) => ({ ...b, ...arms(b, mix(92, 128, t), mix(92, 128, t), mix(1, 0.35, t), mix(1, 0.35, t)) })
      if (s.variant === 'shrug') return (t) => ({ ...b, ...arms(b, 180, 180, mix(1, 0.9, t)) })
      if (s.variant === 'upright') return (t) => ({ ...b, ...arms(b, mix(176, 280, t), mix(176, 140, t), mix(1, 0.55, t)) })
      return (t) => ({ ...b, ...arms(b, mix(178, 100, t), mix(178, 100, t), mix(1, 0.32, t), mix(1, 0.32, t)) })
    case 'squat':
      if (s.variant === 'legpress')
        return (t) => ({
          torso: 305,
          thigh: mix(58, 16, t),
          shin: mix(58, 128, t),
          anchor: ['hip', [64, 100]],
          chest: 1,
          toe: 1,
          upper: 165,
          fore: 120,
        })
      return (t) => {
        const st = { ...stand(), torso: mix(3, s.variant === 'front' ? 22 : s.variant === 'hang' ? 30 : 38, t), thigh: mix(178, 78, t), shin: mix(183, 212, t) }
        if (s.variant === 'back') return { ...st, hand: backBar, pole: 200 }
        if (s.variant === 'front') return { ...st, hand: chestHold, pole: 180 }
        return { ...st, upper: 182, fore: 182 }
      }
    case 'hinge':
      if (s.variant === 'hyper')
        return (t) => ({
          torso: mix(48, 130, t),
          thigh: 228,
          shin: 228,
          anchor: ['hip', [104, 84]],
          chest: 1,
          toe: 1,
          hand: chestHold,
          pole: 180,
        })
      return (t) => {
        const st = { ...stand(), torso: mix(4, 78, t), thigh: mix(180, 162, t), shin: mix(181, 190, t) }
        if (s.variant === 'goodmorning' || s.equip === 'smith') return { ...st, hand: backBar, pole: 200 }
        return { ...st, upper: mix(182, 184, t), fore: mix(182, 184, t) }
      }
    case 'lunge':
      return (t) => {
        const st = {
          ...stand(),
          torso: mix(2, 6, t),
          thigh: mix(170, 96, t),
          shin: mix(178, 192, t),
          farThigh: mix(196, 172, t),
          farShin: mix(212, 262, t),
          anchor: ['ankle', [112, G - AH]] as Frame['anchor'],
        }
        return s.equip === 'barbell' || s.equip === 'smith' ? { ...st, hand: backBar, pole: 200 } : { ...st, upper: 182, fore: 182 }
      }
    case 'thrust':
      if (s.variant === 'bridge')
        return (t) => ({
          torso: mix(252, 268, t),
          thigh: mix(78, 45, t),
          shin: mix(165, 160, t),
          anchor: ['ankle', [140, G - AH]],
          chest: 1,
          toe: 1,
          ...(s.equip === 'none' ? { hand: ({ hip }: { hip: J }) => [hip[0] - 8, G - 1] as J, pole: 0, palm: true } : { hand: ({ hip, front }: { hip: J; front: J }) => add(hip, mul(front, 8)), pole: 200 }),
        })
      return (t) => ({
        torso: mix(272, 300, t),
        thigh: mix(90, 52, t),
        shin: mix(182, 178, t),
        anchor: ['ankle', [146, G - AH]],
        chest: 1,
        toe: 1,
        hand: ({ hip, front }) => add(hip, mul(front, 8)),
        pole: 200,
      })
    case 'calf':
      return (t) => ({ ...b, anchor: ['ankle', [100, G - AH - 7 * t]], planted: true, ...arms(b, 180, 180) })
    case 'legcurl':
      if (s.variant === 'seated') return (t) => ({ ...b, shin: mix(92, 192, t), ...arms(b, 172, 120) })
      return (t) => ({ torso: 268, thigh: 88, shin: mix(90, 352, t), anchor: ['hip', [96, 92]], chest: -1, toe: 1, upper: 175, fore: 270 })
    case 'legext':
      return (t) => ({ ...b, shin: mix(182, 96, t), ...arms(b, 172, 120) })
    case 'crunch':
      if (s.posture === 'hang')
        return (t) => ({
          torso: 0,
          thigh: mix(182, 92, t),
          shin: s.variant === 'knee' ? mix(182, 178, t) : mix(182, 92, t),
          anchor: ['hand', [100, 22]],
          chest: 1,
          toe: 1,
          upper: 2,
          fore: 0,
        })
      if (s.variant === 'legraise')
        return (t) => ({ torso: 270, thigh: mix(94, 4, t), shin: mix(94, 4, t), anchor: ['hip', [100, G - 7.5]], chest: 1, toe: 1, upper: 94, fore: 92 })
      return (t) => ({
        torso: mix(268, 300, t),
        thigh: 38,
        shin: 148,
        anchor: ['hip', [100, G - 7.5]],
        chest: 1,
        toe: 1,
        hand: chestHold,
        pole: 0,
      })
    case 'plank':
      return (t) => ({ torso: mix(283, 284.5, t), thigh: mix(103, 104.5, t), shin: mix(103, 104.5, t), anchor: ['ankle', [146, G - 3]], chest: -1, toe: -1, upper: 180, fore: 270 })
    case 'pushup': {
      const hy = s.variant === 'incline' ? G - 30 : G - 1
      const fy = s.variant === 'decline' ? G - 30 : G - 3
      const [top, bottom] = s.variant === 'incline' ? [318, 302] : s.variant === 'decline' ? [282, 266] : [298, 280]
      // hands stay where the shoulders are at the top
      const hx = place({ torso: top, thigh: top - 180, shin: top - 180, anchor: ['ankle', [152, fy]], chest: -1, toe: -1, upper: 180, fore: 180 }).shoulder[0]
      return (t) => {
        const a = mix(top, bottom, t)
        return { torso: a, thigh: a - 180, shin: a - 180, anchor: ['ankle', [152, fy]], chest: -1, toe: -1, hand: [hx, hy], pole: 60, palm: true }
      }
    }
    case 'dip':
      if (s.variant === 'bench')
        return (t) => ({
          torso: 0,
          thigh: 92,
          shin: 150,
          anchor: ['hand', [80, 92]],
          chest: 1,
          toe: 1,
          upper: mix(190, 250, t),
          fore: mix(185, 178, t),
          uk: mix(1, 0.95, t),
        })
      return (t) => ({
        torso: mix(8, 20, t),
        thigh: 196,
        shin: 230,
        anchor: ['hand', [100, 70]],
        chest: 1,
        toe: 1,
        upper: mix(182, 255, t),
        fore: mix(182, 178, t),
        uk: mix(1, 0.95, t),
      })
  }
}

function propsOf(s: ExerciseSpec, r0: Rig, r1: Rig): Prop[] {
  const pad = (a: J, b: J, legs = true): Prop => ({ kind: 'pad', a, b, legs })
  const under = (r: Rig, from: number, to: number) => {
    const sp = norm(sub(r.shoulder, r.hip))
    const o = mul(r.front, -8.6)
    return pad(add(add(r.hip, mul(sp, from)), o), add(add(r.shoulder, mul(sp, to)), o))
  }
  const seat = (r: Rig): Prop => pad(add(r.hip, [-13, 7.6]), add(r.hip, [15, 7.6]))
  switch (s.base) {
    case 'pull':
      return s.posture === 'hang' ? [{ kind: 'bar', at: r0.bar, post: false }] : [seat(r0)]
    case 'crunch':
      return s.posture === 'hang' ? [{ kind: 'bar', at: r0.bar, post: false }] : []
    case 'dip':
      return s.variant === 'bench' ? [pad(add(r0.bar, [-22, 1.6]), add(r0.bar, [4, 1.6]))] : [{ kind: 'bar', at: r0.bar, post: true }]
    case 'row':
      if (s.variant === 'inverted') return [{ kind: 'bar', at: r0.bar, post: true }]
      if (s.variant === 'chest') return [under(r0, -6, -2)]
      return s.posture === 'seated' ? [seat(r0)] : []
    case 'pushup':
      if (s.variant === 'incline') return [pad([r0.bar[0] - 10, G - 30 + 0.6], [r0.bar[0] + 16, G - 30 + 0.6])]
      if (s.variant === 'decline') return [pad(add(r0.ankle, [-12, 4]), add(r0.ankle, [14, 4]))]
      return []
    case 'thrust':
      return s.variant === 'bridge' ? [] : [pad(add(r0.shoulder, [-22, 8.4]), add(r0.shoulder, [6, 8.4]))]
    case 'hinge':
      if (s.variant === 'hyper') {
        const d = norm(sub(r0.knee, r0.hip))
        const n = perp(d)
        const o = mul(n[1] > 0 ? n : mul(n, -1), 7)
        return [pad(add(add(r0.hip, mul(d, -4)), o), add(add(r0.hip, mul(d, 14)), o))]
      }
      return []
    case 'legcurl':
      return s.variant === 'seated' ? [seat(r0)] : [pad([r0.shoulder[0] - 8, r0.hip[1] + 8], [r0.knee[0] + 2, r0.hip[1] + 8])]
    case 'calf':
      return [{ kind: 'step', x0: r0.ankle[0] - 2, x1: r0.ankle[0] + 18, top: G - 0.5 }]
    default:
      break
  }
  if (s.posture === 'supine') {
    const out = [under(r0, -14, 8)]
    if (s.bench > 5) out.push(seat(r0))
    return out
  }
  if (s.posture === 'seated') return s.base === 'curl' && s.variant === 'preacher' ? [seat(r0), pad(lerp(r1.shoulder, r1.elbow, 0.3), add(r1.elbow, mul(norm(sub(r1.elbow, r1.shoulder)), 4)), false)] : [seat(r0)]
  return []
}

function pulleyOf(s: ExerciseSpec, r0: Rig): J | null {
  if (s.equip !== 'cable' && s.equip !== 'band') return null
  const h = r0.bar
  const low: J = [h[0] + 14, G - 4]
  switch (s.base) {
    case 'press':
      return add(r0.shoulder, [-30, 0])
    case 'fly':
      return s.variant === 'crossover' ? add(r0.shoulder, [-40, -22]) : [r0.shoulder[0], G - 4]
    case 'row':
      return [h[0] + 40, h[1]]
    case 'pull':
      return [h[0], h[1] - 18]
    case 'triceps':
      return s.variant === 'pushdown' ? add(r0.shoulder, [22, -38]) : s.variant === 'overhead' ? add(r0.shoulder, [-30, 12]) : low
    case 'crunch':
      return add(r0.head, [6, -30])
    case 'ohp':
      return [h[0] - 4, G - 4]
    default:
      return low
  }
}

/** Unilateral work: the far arm stays at its start position while the near arm moves. */
function withStillFarArm(rig: (t: number) => Rig, still: Rig): (t: number) => Rig {
  return (t) => ({ ...rig(t), farArm: { elbow: still.elbow, wrist: still.wrist } })
}

export function motionOf(s: ExerciseSpec): Motion | null {
  const fn = frameFn(s)
  if (!fn) return null
  let rig = (t: number) => place(fn(t))
  const r0 = rig(0)
  const r1 = rig(1)
  const armsMove = !['squat', 'hinge', 'lunge', 'thrust', 'calf', 'legcurl', 'legext', 'crunch', 'plank', 'pushup', 'dip', 'pull'].includes(s.base)
  if (s.unilateral && armsMove) rig = withStillFarArm(rig, r0)
  return {
    rig,
    props: propsOf(s, r0, r1),
    pulley: pulleyOf(s, r0),
    lever: s.equip === 'machine' && (s.base === 'legext' || s.base === 'legcurl') ? 'knee' : null,
    sled: s.base === 'squat' && s.variant === 'legpress' ? 58 : null,
    tempo: s.base === 'plank' ? 3.2 : 2.4,
  }
}

/** which side of each bone is anatomical front / back — from the two end poses, like boneSides() */
export function sidesOf(rig: (t: number) => Rig): Sides {
  const rigs = [rig(0), rig(1)]
  const pick = (f: (r: Rig) => number) => {
    const v = rigs.map(f)
    return Math.sign(Math.abs(v[0]) > Math.abs(v[1]) ? v[0] : v[1]) || 1
  }
  return {
    thighBack: pick((r) => dot(perp(sub(r.knee, r.hip)), sub(r.ankle, r.hip))) || 1,
    shinBack: pick((r) => dot(perp(sub(r.ankle, r.knee)), sub(r.hip, r.knee))) || 1,
    // biceps face the chest side when the arm is straight
    upperFront: pick((r) => dot(perp(sub(r.elbow, r.shoulder)), Math.abs(dot(norm(sub(r.wrist, r.elbow)), norm(sub(r.elbow, r.shoulder)))) > 0.98 ? r.front : sub(r.wrist, r.shoulder))),
  }
}
