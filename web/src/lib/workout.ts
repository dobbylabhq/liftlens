// Workout mode: today's plan (exercise × sets × reps × weight), film each set → programmatic analysis → next-set suggestion.
import type { Finding, LiftId, Rep, Session } from './types'
import type { ExerciseRef } from './exerciseRef'

export type PlanLift = LiftId | 'other'

export interface PlannedSet {
  reps: number
  weightKg: number | null
  /** Set that was filmed and analyzed */
  sessionId?: number
  /** Set logged as done without video */
  done?: boolean
  repsDone?: number
  /** Completion time (for rest between sets) */
  at?: number
}

export interface PlanItem {
  lift: PlanLift
  name: string
  /** Library exercise (non-big-three); without one it can only be logged manually */
  exercise?: ExerciseRef
  /** reps means seconds held (plank etc.) */
  sets: PlannedSet[]
}

export const isHoldItem = (it: Pick<PlanItem, 'exercise'>) => !!it.exercise?.hold

export interface Workout {
  id?: number
  date: string
  createdAt: number
  status: 'active' | 'done'
  finishedAt?: number
  items: PlanItem[]
}

export const PLAN_LIFTS: Record<PlanLift, string> = { bench: '卧推', squat: '深蹲', deadlift: '硬拉', other: '其他' }

export const isSetDone = (s: PlannedSet) => s.sessionId != null || !!s.done

/** Next set: the first unfinished set */
export function nextSet(w: Workout): { item: number; set: number } | null {
  for (let i = 0; i < w.items.length; i++) {
    const j = w.items[i].sets.findIndex((s) => !isSetDone(s))
    if (j >= 0) return { item: i, set: j }
  }
  return null
}

export function lastFinishedAt(w: Workout) {
  return Math.max(0, ...w.items.flatMap((it) => it.sets.map((s) => s.at ?? 0)))
}

// ------------------------------------------------------------------ Plan text parsing

/** Only counts as a big-three lift when the name is exactly that lift ("dumbbell bench press" and "front squat" are different exercises) */
const LIFT_WORDS: [RegExp, LiftId][] = [
  [/^(杠铃)?(平板)?卧推$|^(barbell )?bench( press)?$/i, 'bench'],
  [/^(杠铃)?(后)?深蹲$|^(barbell )?(back )?squat$/i, 'squat'],
  [/^(杠铃)?(传统)?硬拉$|^(barbell )?deadlift$|^dl$/i, 'deadlift'],
]

/**
 * One exercise per line; common notations are all recognized:
 *   卧推 5x5 60kg / 深蹲 3×8 @80 / 硬拉 1*5 100 / 卧推 60kg 4组8次 / 引体向上 3x10
 */
export function parsePlan(text: string): PlanItem[] {
  const items: PlanItem[] = []
  for (const raw of text.split(/\n|；|;/)) {
    const line = raw.trim().replace(/[，,]/g, ' ')
    if (!line) continue
    let sets = 0
    let reps = 0
    let rest = line
    const sx = line.match(/(\d+)\s*[x×*✕X]\s*(\d+)/)
    const zu = line.match(/(\d+)\s*组\D*?(\d+)\s*(?:次|下|个)/)
    if (sx) {
      sets = +sx[1]
      reps = +sx[2]
      rest = line.replace(sx[0], ' ')
    } else if (zu) {
      sets = +zu[1]
      reps = +zu[2]
      rest = line.replace(zu[0], ' ')
    }
    const kg = rest.match(/@?\s*(\d+(?:\.\d+)?)\s*(?:kg|公斤|千克)/i) ?? rest.match(/@\s*(\d+(?:\.\d+)?)/) ?? (sets ? rest.match(/(?:^|\s)(\d+(?:\.\d+)?)(?:\s|$)/) : null)
    const weightKg = kg ? +kg[1] : null
    const rawName = rest.replace(kg?.[0] ?? '', ' ').replace(/[@]/g, '').replace(/\s+/g, ' ').trim()
    const lift = LIFT_WORDS.find(([re]) => re.test(rawName))?.[1] ?? 'other'
    const name = lift !== 'other' ? PLAN_LIFTS[lift] : rawName || '其他动作'
    if (!sets || !reps) continue
    items.push({ lift, name, sets: Array.from({ length: Math.min(sets, 20) }, () => ({ reps, weightKg })) })
  }
  return items
}

export function planToText(items: PlanItem[]) {
  return items.map((it) => `${it.name} ${it.sets.length}x${it.sets[0]?.reps ?? 0}${it.sets[0]?.weightKg ? ` ${it.sets[0].weightKg}kg` : ''}`).join('\n')
}

// ------------------------------------------------------------------ Next-set suggestion (pure programmatic rules)

export interface SetAdvice {
  tone: 'good' | 'warn' | 'bad'
  headline: string
  detail: string
  issues: Finding[]
}

const round25 = (x: number) => Math.round(x / 2.5) * 2.5

/**
 * Based on: reps completed vs target, rule-detected issues (only those with enough confidence), and concentric velocity loss over the last few reps
 * (the greater the within-set velocity loss, the closer to failure; see Sánchez-Medina & González-Badillo 2011).
 */
export function adviseNextSet(o: {
  planned: PlannedSet
  session: Pick<Session, 'reps' | 'weightKg'>
  findings: Finding[]
  reps: Rep[]
  isLastSet: boolean
  /** Static hold: actual seconds held (planned.reps is the target seconds) */
  holdS?: number
}): SetAdvice {
  const { planned, session, findings, reps, isLastSet } = o
  if (o.holdS != null) {
    const line = findings.find((f) => f.id.endsWith('body_line') && f.severity !== 'good')
    const short = Math.max(0, planned.reps - o.holdS)
    return {
      tone: line?.severity === 'bad' || short > planned.reps * 0.2 ? 'bad' : line || short > 0 ? 'warn' : 'good',
      headline: short > 0 ? `保持了 ${Math.round(o.holdS)} 秒（目标 ${planned.reps} 秒）` : `保持了 ${Math.round(o.holdS)} 秒，达标`,
      detail: line ? `${line.title}：${line.detail}` : short > 0 ? '下一组可以先缩短目标，保证姿势不变形。' : isLastSet ? '下次可以加 5–10 秒。' : '下一组按计划进行。',
      issues: line ? [line] : [],
    }
  }
  const issues = findings
    .filter((f) => (f.severity === 'bad' || f.severity === 'warn') && f.confidence >= 0.45)
    .sort((a, b) => (a.severity === b.severity ? b.confidence - a.confidence : a.severity === 'bad' ? -1 : 1))
  const bad = issues.filter((f) => f.severity === 'bad')
  const missing = Math.max(0, planned.reps - session.reps)
  const w = session.weightKg ?? planned.weightKg

  // Concentric velocity loss: last rep / average of the first two
  const con = reps.map((r) => r.concentricS).filter((x) => x > 0)
  const slowdown = con.length >= 3 ? con[con.length - 1] / ((con[0] + con[1]) / 2) : 1
  const grinding = slowdown >= 1.6

  if (missing > 0) {
    const lighter = w ? round25(w * 0.92) : null
    return {
      tone: 'bad',
      headline: `少了 ${missing} 次（${session.reps}/${planned.reps}）`,
      detail: isLastSet
        ? '这个重量今天偏重了，下次训练先保持这个重量，把次数做满再加。'
        : `下一组建议减到约 ${lighter ?? '原重量的 90%'}${lighter ? 'kg' : ''}，或保持重量、把目标降到 ${session.reps} 次。`,
      issues,
    }
  }
  if (bad.length) {
    return {
      tone: 'bad',
      headline: `次数完成，但「${bad[0].title}」有问题`,
      detail: isLastSet ? '下次训练先保持这个重量，专门把这一点练稳再加重。' : '下一组不要加重，放慢下放，把这一点做对。',
      issues,
    }
  }
  if (grinding) {
    return {
      tone: 'warn',
      headline: '完成，但最后几次明显变慢',
      detail: `最后一次推起用时是前两次的 ${slowdown.toFixed(1)} 倍，已经接近力竭。${isLastSet ? '这个重量今天到位了。' : '下一组保持重量，不要加。'}`,
      issues,
    }
  }
  if (issues.length) {
    return {
      tone: 'warn',
      headline: '完成，有小问题',
      detail: `留意「${issues[0].title}」。${isLastSet ? '' : '下一组按计划进行。'}`,
      issues,
    }
  }
  return {
    tone: 'good',
    headline: '完成，动作稳定',
    detail: isLastSet ? `这个动作今天全部完成${w ? `，下次可以试试 ${round25(w + 2.5)}kg` : ''}。` : '下一组按计划进行。',
    issues,
  }
}
