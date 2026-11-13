// LiftLens local agent bridge.
//
// The web app never talks to a model provider directly. Instead this tiny
// daemon runs on the user's machine, and drives the
// coding agent the user already has — Claude Code (`claude -p`) — on the
// user's own subscription. Coach personas are Agent Skills (coaches/<id>/SKILL.md).
//
// Security: binds to 127.0.0.1 only, restricts CORS to known web origins and
// requires a pairing token (printed on start, stored in ~/.liftlens/token).

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import matter from 'gray-matter'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sessionSchema, progressSchema } from './schemas.mjs'
import { BUILD, MODEL, ORIGINS, PORT, VERSION, WEB_URL, detectRuntimes, readToken } from './config.mjs'
import { coachesDir, syncCoaches, syncState } from './sync.mjs'
import { currentRuntimeId, listRuntimes, readConfig, runtimeById, writeConfig } from './runtimes.mjs'
import { runWithAiSdk } from './ai-run.mjs'
import { runWithCli } from './cli-run.mjs'

const TOKEN = readToken()
const runtimes = detectRuntimes()

// ---------- coaches (Agent Skills) ----------
function loadCoaches() {
  const COACHES_DIR = coachesDir()
  if (!fs.existsSync(COACHES_DIR)) return []
  return fs
    .readdirSync(COACHES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => {
      const file = path.join(COACHES_DIR, d.name, 'SKILL.md')
      if (!fs.existsSync(file)) return null
      const { data } = matter(fs.readFileSync(file, 'utf8'))
      return {
        id: d.name,
        name: data.name ?? d.name,
        description: data.description ?? '',
        ...(data.metadata ?? {}),
      }
    })
    .filter(Boolean)
}
function loadSources() {
  const f = path.join(coachesDir(), '_shared', 'sources.json')
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []
}

// ---------- app ----------
const app = new Hono()
app.use(
  '*',
  cors({
    origin: (origin) => (ORIGINS.includes(origin) ? origin : null),
    allowHeaders: ['content-type', 'x-liftlens-token'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
  }),
)
app.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS' || c.req.path === '/health') return next()
  if (c.req.header('x-liftlens-token') !== TOKEN) return c.json({ error: 'bad token' }, 401)
  return next()
})

app.get('/health', (c) =>
  c.json({ ok: true, name: 'liftlens-agent', version: VERSION, build: BUILD, web: WEB_URL, runtimes, runtime: currentRuntimeId(), coachesDir: coachesDir(), skills: { ...syncState } }),
)
app.get('/coaches', (c) => c.json(loadCoaches()))
/** POST /shutdown — a newer version asks the old process to free the port on startup (requires the pairing token, only available locally) */
app.post('/shutdown', (c) => {
  setTimeout(() => process.exit(0), 150)
  return c.json({ ok: true })
})

/** GET /runtimes — every supported agent/model runtime, availability, current default (no secrets) */
app.get('/runtimes', async (c) => c.json(await listRuntimes()))
/** POST /runtime {id} — choose the default runtime. Keys/models are configured on this machine only. */
app.post('/runtime', async (c) => {
  const { id } = await c.req.json()
  if (!runtimeById(id)) return c.json({ error: '未知的运行时' }, 400)
  writeConfig({ ...readConfig(), runtime: id })
  return c.json({ ok: true, runtime: id })
})

/**
 * POST /analyze  (SSE)
 * body: { kind: 'session'|'progress', coachId, payload: object, images: [{name, dataUrl}] }
 * events: status {stage, text} · tool {name, input} · text {text} · result {...} · error {message}
 */
app.post('/analyze', async (c) => {
  const body = await c.req.json()
  const runtimeId = body.runtime ?? currentRuntimeId()
  if (runtimeId !== 'claude-code') return analyzeWithAiSdk(c, body, runtimeId)
  if (!runtimes.claude) return c.json({ error: '未找到 claude CLI，请先安装 Claude Code' }, 500)
  await syncCoaches()
  const COACHES_DIR = coachesDir()
  const coaches = loadCoaches()
  const coach = coaches.find((x) => x.id === body.coachId) ?? coaches[0]
  if (!coach) return c.json({ error: '没有可用的教练 skill' }, 500)

  // Workspace for this run: metrics + keyframes the agent can Read.
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'liftlens-'))
  const imageNames = []
  for (const img of (body.images ?? []).slice(0, 8)) {
    const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(img.dataUrl ?? '')
    if (!m) continue
    const name = (img.name ?? `frame-${imageNames.length}`).replace(/[^\w.-]/g, '_') + '.' + m[1].replace('jpeg', 'jpg')
    fs.writeFileSync(path.join(runDir, name), Buffer.from(m[2], 'base64'))
    imageNames.push(name)
  }
  fs.writeFileSync(path.join(runDir, 'payload.json'), JSON.stringify(body.payload ?? {}, null, 2))

  const sources = loadSources()
  const kind = body.kind === 'progress' ? 'progress' : 'session'
  const schema = kind === 'progress' ? progressSchema : sessionSchema
  const skillDir = path.join(COACHES_DIR, coach.id)
  const sharedDir = path.join(COACHES_DIR, '_shared')

  const prompt = [
    kind === 'session'
      ? `请以你的教练身份分析这次训练视频的动作质量。`
      : `请以你的教练身份分析这位用户一段时间的训练记录，评估能力变化并给出计划。`,
    `工作目录：${runDir}`,
    `1. 先 Read ${path.join(runDir, 'payload.json')}（程序测量的指标、规则判定结果、用户信息）。`,
    imageNames.length
      ? `2. 再逐张 Read 关键帧（已叠加骨架和杠铃轨迹）：${imageNames.map((n) => path.join(runDir, n)).join('、')}。`
      : `2. 本次没有关键帧，只基于数据分析。`,
    `0. 先 Read ${path.join(sharedDir, 'protocol.md')}（通用协议）与 ${path.join(sharedDir, 'metrics.md')}（指标含义与依据）。`,
    `3. 需要时可 Read ${skillDir}/references/ 下你的流派标准文档。`,
    `程序指标来自单目 2D 姿态估计，可能因遮挡（杠铃片挡住手臂）而失真：请用关键帧交叉核对，不一致的写进 metricDisagreements。`,
    `引用依据时 sourceIds 只能使用以下 id：${sources.map((s) => s.id).join(', ')}。`,
    `全部用简体中文输出，按 JSON schema 返回。`,
  ].join('\n')

  const args = [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--tools',
    'Read',
    '--allowedTools',
    'Read',
    '--add-dir',
    runDir,
    '--add-dir',
    COACHES_DIR,
    '--append-system-prompt-file',
    path.join(skillDir, 'SKILL.md'),
    '--json-schema',
    JSON.stringify(schema),
  ]
  if (MODEL) args.push('--model', MODEL)

  return streamSSE(c, async (stream) => {
    const send = (event, data) => stream.writeSSE({ event, data: JSON.stringify(data) })
    await send('status', { stage: 'spawn', text: `唤起本地 Claude Code · 教练：${coach.name}` })

    let child
    try {
      child = spawn(runtimes.claude.path, args, { cwd: runDir, env: process.env })
    } catch (err) {
      fs.rmSync(runDir, { recursive: true, force: true })
      await send('error', { message: `无法启动 claude：${err.message}` })
      return
    }
    child.on('error', (err) => send('error', { message: `claude 进程错误：${err.message}` }))
    stream.onAbort(() => child.kill('SIGTERM'))

    let buf = ''
    let final = null
    let stderr = ''
    child.stderr.on('data', (d) => (stderr += d))

    const done = new Promise((resolve) => child.on('close', resolve))
    child.stdout.on('data', async (chunk) => {
      buf += chunk
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        let ev
        try {
          ev = JSON.parse(line)
        } catch {
          continue
        }
        if (ev.type === 'system' && ev.subtype === 'init') {
          send('status', { stage: 'init', text: `模型 ${ev.model ?? ''} 已就绪` })
        } else if (ev.type === 'assistant') {
          for (const part of ev.message?.content ?? []) {
            if (part.type === 'tool_use' && part.name === 'Read') {
              send('tool', { name: 'Read', file: path.basename(part.input?.file_path ?? '') })
            } else if (part.type === 'text' && part.text?.trim()) {
              send('text', { text: part.text.trim().slice(0, 400) })
            } else if (part.type === 'thinking') {
              send('status', { stage: 'thinking', text: '教练正在思考…' })
            }
          }
        } else if (ev.type === 'result') {
          final = ev
        }
      }
    })

    const code = await done
    fs.rmSync(runDir, { recursive: true, force: true })
    if (final && !final.is_error && final.structured_output) {
      await send('result', {
        kind,
        coachId: coach.id,
        output: final.structured_output,
        costUsd: final.total_cost_usd ?? null,
        durationMs: final.duration_ms ?? null,
      })
    } else {
      await send('error', {
        message: final?.result || stderr.slice(-600) || `claude 退出码 ${code}`,
      })
    }
  })
})

/** Any non-Claude-Code runtime: Vercel AI SDK + provider (installed on first use). */
async function analyzeWithAiSdk(c, body, runtimeId) {
  await syncCoaches()
  const COACHES_DIR = coachesDir()
  const coaches = loadCoaches()
  const coach = coaches.find((x) => x.id === body.coachId) ?? coaches[0]
  if (!coach) return c.json({ error: '没有可用的教练 skill' }, 500)
  const kind = body.kind === 'progress' ? 'progress' : 'session'
  const images = []
  for (const img of (body.images ?? []).slice(0, 8)) {
    const m = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/.exec(img.dataUrl ?? '')
    if (m) images.push({ name: img.name ?? `frame-${images.length}`, mediaType: m[1], data: Buffer.from(m[2], 'base64') })
  }
  return streamSSE(c, async (stream) => {
    const send = (event, data) => stream.writeSSE({ event, data: JSON.stringify(data) })
    const ac = new AbortController()
    stream.onAbort(() => ac.abort())
    await send('status', { stage: 'spawn', text: `运行时：${runtimeById(runtimeId)?.label ?? runtimeId} · 教练：${coach.displayName ?? coach.name}` })
    try {
      const run = runtimeById(runtimeId)?.engine === 'cli' ? runWithCli : runWithAiSdk
      const r = await run({
        runtimeId,
        coachesDir: COACHES_DIR,
        coachId: coach.id,
        kind,
        payload: body.payload ?? {},
        images,
        schema: kind === 'progress' ? progressSchema : sessionSchema,
        sourceIds: loadSources().map((s) => s.id),
        signal: ac.signal,
        onStatus: (text) => send('status', { stage: 'run', text }),
      })
      await send('result', { kind, coachId: coach.id, output: r.output, costUsd: null, durationMs: r.durationMs, runtime: runtimeId, model: r.modelId })
    } catch (e) {
      await send('error', { message: e.message })
    }
  })
}

export { loadCoaches, runtimes }

/** Start the HTTP bridge on 127.0.0.1 only. Resolves once listening. */
export function startServer() {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, () => {
      syncCoaches({ force: true }).then((r) => r.updated && console.log(`[skills] 已同步到 ${r.version}（之前 ${r.from}）`))
      resolve(server)
    })
    server.on('error', reject)
  })
}
