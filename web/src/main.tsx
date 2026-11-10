import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { router } from './App'
import './index.css'
import { reloadForNewVersion } from './lib/reload'

// After a new deploy, an already-open old page gets 404s loading old chunks (server returns HTML) → auto-reload to the new version
// Entry booted fine: clear the "retry once on failure" flag set in index.html
setTimeout(() => {
  try {
    sessionStorage.removeItem('ll-entry-retry')
  } catch {
    /* ignore */
  }
}, 3000)

window.addEventListener('vite:preloadError', (e) => {
  if (reloadForNewVersion()) e.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)

// dev-only: expose the analysis pipeline for headless debugging from DevTools
if (import.meta.env.DEV) {
  Promise.all([import('./lib/pose'), import('./lib/analyze'), import('./lib/barTracker')]).then(([pose, analyze, bar]) => {
    ;(window as unknown as Record<string, unknown>).__ll = { ...pose, ...analyze, ...bar }
  })
}
