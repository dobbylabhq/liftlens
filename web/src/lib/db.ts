import Dexie, { type EntityTable } from 'dexie'
import type { Clip, Finding, Session, AgentProgressResult } from './types'
import type { Workout } from './workout'

export interface Setting {
  key: string
  value: unknown
}

export interface ProgressReport {
  id?: number
  createdAt: number
  coachId: string
  rangeDays: number
  result: AgentProgressResult
}

/** Local-first storage: every session, clip and video stays in the browser (IndexedDB). */
export const db = new Dexie('liftlens') as Dexie & {
  sessions: EntityTable<Session, 'id'>
  clips: EntityTable<Clip, 'id'>
  settings: EntityTable<Setting, 'key'>
  reports: EntityTable<ProgressReport, 'id'>
  workouts: EntityTable<Workout, 'id'>
}

db.version(1).stores({
  sessions: '++id, date, lift, createdAt, [lift+date]',
  clips: '++id, sessionId, angle',
  settings: 'key',
  reports: '++id, createdAt',
})
// v2: workout mode (today's plan + the analysis record for each set)
db.version(2).stores({
  workouts: '++id, date, status, createdAt',
})
// v3: store each set's issue summary on the session (the ability page no longer has to load every clip with its per-frame data)
db.version(3)
  .stores({})
  .upgrade(async (tx) => {
    const byS = new Map<number, Session['issues']>()
    await tx
      .table('clips')
      .toCollection()
      .each((c: Clip) => byS.set(c.sessionId, [...(byS.get(c.sessionId) ?? []), ...issuesOf(c.analysis.findings)]))
    await tx
      .table('sessions')
      .toCollection()
      .modify((s: Session) => {
        if (!s.issues) s.issues = byS.get(s.id!) ?? []
      })
  })

export function issuesOf(findings: Finding[]): NonNullable<Session['issues']> {
  return findings.filter((f) => f.severity === 'warn' || f.severity === 'bad').map((f) => ({ id: f.id, title: f.title, severity: f.severity as 'warn' | 'bad' }))
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key)
  return (row?.value as T) ?? fallback
}
export function setSetting(key: string, value: unknown) {
  return db.settings.put({ key, value })
}

export function todayISO(d = new Date()) {
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

export async function deleteSession(id: number) {
  await db.transaction('rw', db.sessions, db.clips, async () => {
    await db.clips.where('sessionId').equals(id).delete()
    await db.sessions.delete(id)
  })
}
