import { db, issuesOf, todayISO, type ProgressReport, type Setting } from './db'
import type { Clip, Session } from './types'
import type { PlannedSet, Workout } from './workout'

/**
 * Backup = workout records + analysis results + coach feedback + ability reports + profile/preferences.
 * Excluded: videos, keyframe images, per-frame skeletons (only useful for video replay), agent pairing code (tied to one computer).
 * Format is plain JSON so users can keep or inspect it themselves.
 */
export const BACKUP_FORMAT = 'liftlens-backup'
export const BACKUP_VERSION = 1

type BackupClip = Omit<Clip, 'id' | 'video' | 'keyframes' | 'pose'> & { id: number }
interface Backup {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  sessions: (Session & { id: number })[]
  clips: BackupClip[]
  reports: ProgressReport[]
  settings: Setting[]
  workouts?: Workout[]
}

const PRIVATE_SETTINGS = new Set(['agentUrl', 'agentToken'])
const dedupeKey = (s: Pick<Session, 'createdAt' | 'lift'>) => `${s.createdAt}|${s.lift}`

export async function buildBackup(): Promise<Backup> {
  const [sessions, clips, reports, settings, workouts] = await Promise.all([
    db.sessions.toArray(),
    db.clips.toArray(),
    db.reports.toArray(),
    db.settings.toArray(),
    db.workouts.toArray(),
  ])
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    sessions: sessions as Backup['sessions'],
    clips: clips.map(({ video: _v, keyframes: _k, pose: _p, ...rest }) => rest as BackupClip),
    reports,
    settings: settings.filter((s) => !PRIVATE_SETTINGS.has(s.key)),
    workouts,
  }
}

export async function downloadBackup() {
  const data = await buildBackup()
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `liftlens-backup-${todayISO()}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  return { sessions: data.sessions.length, bytes: blob.size }
}

export interface ImportResult {
  added: number
  skipped: number
  reports: number
}

/** Merge import: skip records that already exist (same creation time + exercise); never overwrite local data */
export async function importBackup(file: File): Promise<ImportResult> {
  let data: Backup
  try {
    data = JSON.parse(await file.text())
  } catch {
    throw new Error('文件不是有效的 JSON')
  }
  if (data?.format !== BACKUP_FORMAT || !Array.isArray(data.sessions)) throw new Error('这不是 LiftLens 的备份文件')
  if (data.version > BACKUP_VERSION) throw new Error('备份来自更新版本的 LiftLens，请先刷新页面')

  return db.transaction('rw', [db.sessions, db.clips, db.reports, db.settings, db.workouts], async () => {
    const existingIds = new Map((await db.sessions.toArray()).map((s) => [dedupeKey(s), s.id!]))
    const existing = new Set(existingIds.keys())
    /** Backup session id → local id (newly imported or already existing) */
    const idMap = new Map<number, number>()
    const clipsBySession = new Map<number, BackupClip[]>()
    for (const c of data.clips ?? []) clipsBySession.set(c.sessionId, [...(clipsBySession.get(c.sessionId) ?? []), c])

    let added = 0
    let skipped = 0
    for (const { id: oldId, ...s } of data.sessions) {
      if (existing.has(dedupeKey(s))) {
        const have = existingIds.get(dedupeKey(s))
        if (have != null) idMap.set(oldId, have)
        skipped++
        continue
      }
      const { workout: _w, ...plain } = s as Session
      const newId = (await db.sessions.add(plain as Session)) as number
      idMap.set(oldId, newId)
      existing.add(dedupeKey(s))
      const sClips = clipsBySession.get(oldId) ?? []
      for (const { id: _cid, ...c } of sClips) {
        await db.clips.add({ ...c, sessionId: newId, keyframes: [] } as Clip)
      }
      // Older backups have no issue summary: fill it in from the clip's findings
      if (!(s as Session).issues) await db.sessions.update(newId, { issues: issuesOf(sClips.flatMap((c) => c.analysis.findings)) })
      added++
    }

    const haveReports = new Set((await db.reports.toArray()).map((r) => `${r.createdAt}|${r.coachId}`))
    let reports = 0
    for (const { id: _rid, ...r } of data.reports ?? []) {
      if (haveReports.has(`${r.createdAt}|${r.coachId}`)) continue
      await db.reports.add(r)
      reports++
    }

    // Workout plans: dedupe by creation time, remap set sessionIds to local ids; imported plans are always treated as finished
    const haveWorkouts = new Set((await db.workouts.toArray()).map((w) => w.createdAt))
    for (const { id: wid, ...w } of data.workouts ?? []) {
      if (haveWorkouts.has(w.createdAt)) continue
      const items = w.items.map((it) => ({
        ...it,
        sets: it.sets.map(({ sessionId, ...st }): PlannedSet => (sessionId != null && idMap.has(sessionId) ? { ...st, sessionId: idMap.get(sessionId) } : st)),
      }))
      const newWid = (await db.workouts.add({ ...w, items, status: 'done' })) as number
      for (const [i, it] of items.entries())
        for (const [j, st] of it.sets.entries()) if (st.sessionId != null) await db.sessions.update(st.sessionId, { workout: { id: newWid, item: i, set: j } })
      void wid
    }

    // Preferences/profile: only fill in what's missing locally, never overwrite
    for (const s of data.settings ?? []) {
      if (PRIVATE_SETTINGS.has(s.key)) continue
      if ((await db.settings.get(s.key)) === undefined) await db.settings.put(s)
    }
    return { added, skipped, reports }
  })
}

/** Ask the browser not to auto-evict this site's data when storage is tight (Chrome usually grants it for frequently used sites) */
export async function requestPersist(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function storageInfo() {
  try {
    const [est, persisted] = await Promise.all([navigator.storage?.estimate?.(), navigator.storage?.persisted?.()])
    return { usage: est?.usage ?? null, quota: est?.quota ?? null, persisted: !!persisted }
  } catch {
    return { usage: null, quota: null, persisted: false }
  }
}
