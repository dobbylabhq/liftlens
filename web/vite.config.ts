import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
// @ts-expect-error plain .mjs helper shared with the agent
import { agentBuildId } from '../agent/src/build-id.mjs'

/**
 * SEO: absolute URLs (canonical, og:url, og:image) need the deployed origin, which comes from the
 * environment (LIFTLENS_SITE in the root .env or the deploy environment) — never hard-coded.
 * Also emits robots.txt and sitemap.xml for that origin.
 */
function site(): Plugin {
  const root = path.resolve(import.meta.dirname, '..')
  const url = () => (process.env.LIFTLENS_SITE ?? loadEnv('production', root, 'LIFTLENS_').LIFTLENS_SITE ?? '').replace(/\/$/, '')
  return {
    name: 'liftlens-site',
    transformIndexHtml: (html) => html.replaceAll('%SITE%', url()),
    generateBundle() {
      const u = url()
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\nDisallow: /lab/\n${u ? `Sitemap: ${u}/sitemap.xml\n` : ''}` })
      if (!u) return
      const pages = ['/', '/exercises', '/train', '/new', '/coaches', '/agent', '/privacy']
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `  <url><loc>${u}${p}</loc></url>`).join('\n')}\n</urlset>\n`,
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), site()],
  define: { __AGENT_BUILD__: JSON.stringify(agentBuildId(path.resolve(import.meta.dirname, '../agent/src'))) },
  resolve: { alias: { '@coaches': path.resolve(import.meta.dirname, '../coaches') } },
  server: { port: 5180, strictPort: true, fs: { allow: ['..'] } },
})
