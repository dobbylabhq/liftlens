import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
// @ts-expect-error plain .mjs helper shared with the agent
import { agentBuildId } from '../agent/src/build-id.mjs'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __AGENT_BUILD__: JSON.stringify(agentBuildId(path.resolve(import.meta.dirname, '../agent/src'))) },
  resolve: { alias: { '@coaches': path.resolve(import.meta.dirname, '../coaches') } },
  server: { port: 5180, strictPort: true, fs: { allow: ['..'] } },
})
