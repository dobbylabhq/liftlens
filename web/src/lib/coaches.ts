import { parse } from 'yaml'
import sourcesJson from '@coaches/_shared/sources.json'
import type { Source } from './types'

export interface Coach {
  id: string
  name: string
  description: string
  displayName: string
  region: string
  flag: string
  school: string
  tone: string
  accent: string
  sourceIds: string[]
  body: string
}

// Coach skills are plain files in /coaches — the same files the local agent loads.
const raw = import.meta.glob('../../../coaches/*/SKILL.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export const COACHES: Coach[] = Object.entries(raw)
  .map(([path, text]) => {
    const id = path.split('/').slice(-2)[0]
    const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
    const fm = (m ? parse(m[1]) : {}) as Record<string, any>
    const meta = fm.metadata ?? {}
    return {
      id,
      name: fm.name ?? id,
      description: fm.description ?? '',
      displayName: meta.displayName ?? id,
      region: meta.region ?? '',
      flag: meta.flag ?? '',
      school: meta.school ?? '',
      tone: meta.tone ?? '',
      accent: meta.accent ?? '#c8ff3d',
      sourceIds: meta.sourceIds ?? [],
      body: m ? m[2] : text,
    }
  })
  .sort((a, b) => a.id.localeCompare(b.id))

export const SOURCES = sourcesJson as Source[]
export const SOURCE_BY_ID = Object.fromEntries(SOURCES.map((s) => [s.id, s])) as Record<string, Source>
export const coachById = (id: string | null | undefined) => COACHES.find((c) => c.id === id) ?? null
