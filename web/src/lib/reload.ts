/** When an old page can't load a chunk deleted by a new deploy, reload once (not again within 10 s, to avoid a loop) */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem('ll-reloaded-at') || 0)
    if (Date.now() - last < 10_000) return false
    sessionStorage.setItem('ll-reloaded-at', String(Date.now()))
  } catch {
    /* Also reload once when sessionStorage is unavailable */
  }
  location.reload()
  return true
}

/** Whether this is a "chunk load failed" type error (wording differs across browsers) */
export const isChunkLoadError = (e: unknown) =>
  /MIME type|dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch/i.test(String((e as Error)?.message ?? e))
