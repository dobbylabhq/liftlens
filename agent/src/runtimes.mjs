// Runtimes: which agent / model actually writes the coach review.
//
// - "claude-code" (default) shells out to the user's own Claude Code (`claude -p`) — see server.mjs.
// - Other coding-agent CLIs (Gemini CLI, Qwen Code, OpenCode) run headless — see cli-run.mjs.
// - Everything else goes through the Vercel AI SDK (`ai`) with a community / official provider;
//   the popular OpenAI-compatible services are presets, so users only pass a key.
//   Provider packages are NOT shipped with the agent: they are installed on first use into
//   ~/.liftlens/runtimes (optional deps skipped, so e.g. Codex's bundled 300MB binary is never
//   downloaded — we point the provider at the user's installed CLI instead).
//
// Secrets (API keys) live only in ~/.liftlens/config.json (0600) or environment variables.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { HOME, which } from './config.mjs'

export const RUNTIME_DIR = path.join(HOME, 'runtimes')
const CONFIG_FILE = path.join(HOME, 'config.json')

// ---------------------------------------------------------------- config

export function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  } catch {
    return {}
  }
}
export function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 })
}
const rcfg = (id) => readConfig().runtimes?.[id] ?? {}

// ---------------------------------------------------------------- on-demand provider install

function ensureRuntimeDir() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true })
  const pj = path.join(RUNTIME_DIR, 'package.json')
  if (!fs.existsSync(pj)) fs.writeFileSync(pj, JSON.stringify({ name: 'liftlens-runtimes', private: true, type: 'module' }, null, 2))
}
export function isInstalled(pkg) {
  return fs.existsSync(path.join(RUNTIME_DIR, 'node_modules', pkg, 'package.json'))
}
/** npm-install a provider package next to the agent (skips optional deps such as bundled CLI binaries). */
export function installPkg(spec) {
  ensureRuntimeDir()
  const npm = path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'npm.cmd' : 'npm')
  execFileSync(fs.existsSync(npm) ? npm : 'npm', ['install', spec, '--omit=optional', '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: RUNTIME_DIR,
    stdio: 'pipe',
    timeout: 5 * 60 * 1000,
  })
}
async function importPkg(pkg, sub = '') {
  const req = createRequire(path.join(RUNTIME_DIR, 'package.json'))
  return import(pathToFileURL(req.resolve(sub ? `${pkg}/${sub}` : pkg)).href)
}

// ---------------------------------------------------------------- detection helpers

const env = (...names) => names.find((n) => process.env[n])
async function ollamaModels(baseURL) {
  try {
    const r = await fetch(`${baseURL.replace(/\/api\/?$/, '')}/api/tags`, { signal: AbortSignal.timeout(1500) })
    if (!r.ok) return null
    return ((await r.json()).models ?? []).map((m) => m.name)
  } catch {
    return null
  }
}
function codexConfiguredModel() {
  try {
    const t = fs.readFileSync(path.join(os.homedir(), '.codex', 'config.toml'), 'utf8')
    return /^\s*model\s*=\s*"([^"]+)"/m.exec(t)?.[1] ?? null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- factories

/** A popular OpenAI-compatible service as a one-flag preset: `use <id> --key ... --model ...`. */
function compat({ id, label, group = 'cloud', baseURL, envKey, keyless = false, defaultModel, noImages = false, note }) {
  return {
    id,
    label,
    group,
    engine: 'ai-sdk',
    pkg: '@ai-sdk/openai-compatible@^3',
    note,
    noImages,
    detect: async () => {
      const c = rcfg(id)
      if (!keyless && !c.apiKey && !(envKey && process.env[envKey])) return { ok: false, reason: `未配置 API key（${envKey}）` }
      const model = c.model ?? defaultModel
      return model ? { ok: true, model } : { ok: false, reason: '需要指定模型（--model）' }
    },
    create: (m, model) => {
      const c = rcfg(id)
      return m.createOpenAICompatible({ name: id, baseURL: c.baseURL ?? baseURL, apiKey: c.apiKey ?? (envKey ? process.env[envKey] : undefined) ?? (keyless ? 'local' : undefined) })(model)
    },
  }
}

/** A coding-agent CLI the user is already logged into, run headless. */
function cliAgent({ id, label, bin, note, args }) {
  return {
    id,
    label,
    group: 'local',
    engine: 'cli',
    note,
    args,
    detect: async () => {
      const p = rcfg(id).path ?? which(bin)
      return p ? { ok: true, model: rcfg(id).model ?? `${label} 默认模型`, path: p } : { ok: false, reason: `没有找到 ${bin} 命令` }
    },
  }
}

// ---------------------------------------------------------------- registry

/**
 * Each runtime: { id, label, group: 'local'|'cloud', engine: 'claude-cli'|'cli'|'ai-sdk', pkg?, sub?,
 *   note, detect(): Promise<{ ok, reason?, model? }>, create(mod, model) => LanguageModel }
 */
export const RUNTIMES = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    group: 'local',
    engine: 'claude-cli',
    note: '你电脑上已登录的 Claude Code（你自己的订阅）',
    detect: async () => {
      const p = process.env.LIFTLENS_CLAUDE ?? which('claude')
      return p ? { ok: true, model: process.env.LIFTLENS_MODEL ?? 'Claude Code 默认模型' } : { ok: false, reason: '没有找到 claude 命令' }
    },
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    group: 'local',
    engine: 'ai-sdk',
    pkg: 'ai-sdk-provider-codex-cli@^2',
    note: '你电脑上已登录的 OpenAI Codex CLI（你自己的订阅）',
    detect: async () => {
      const p = rcfg('codex').path ?? which('codex')
      if (!p) return { ok: false, reason: '没有找到 codex 命令' }
      return { ok: true, model: rcfg('codex').model ?? codexConfiguredModel() ?? 'gpt-6-sol' }
    },
    create: (m, model) =>
      m.createCodexExec({
        defaultSettings: {
          codexPath: rcfg('codex').path ?? which('codex'),
          allowNpx: false,
          skipGitRepoCheck: true,
          sandboxMode: 'read-only',
          approvalMode: 'never',
        },
      })(model),
  },
  // Headless coding-agent CLIs: prompt + attached files in, text out (JSON extracted locally).
  cliAgent({
    id: 'gemini-cli',
    label: 'Gemini CLI',
    bin: 'gemini',
    note: '你电脑上已登录的 Gemini CLI（Google 账号免费额度或你的 API key）',
    // `@path` pulls a file (images included) into the prompt; -y: never stop for a tool approval
    args: ({ prompt, files, model }) => ['-p', `${prompt}\n\n${files.map((f) => `@${f}`).join(' ')}`, '-y', ...(model ? ['-m', model] : [])],
  }),
  cliAgent({
    id: 'qwen-code',
    label: 'Qwen Code',
    bin: 'qwen',
    note: '你电脑上已登录的 Qwen Code（通义账号免费额度或你的 API key）',
    args: ({ prompt, files, model }) => ['-p', `${prompt}\n\n${files.map((f) => `@${f}`).join(' ')}`, '-y', ...(model ? ['-m', model] : [])],
  }),
  cliAgent({
    id: 'opencode',
    label: 'OpenCode',
    bin: 'opencode',
    note: '你电脑上的 OpenCode，用它里面配置好的模型（--model provider/model 可指定）',
    args: ({ prompt, files, model }) => ['run', ...files.flatMap((f) => ['-f', f]), ...(model ? ['-m', model] : []), prompt],
  }),
  {
    id: 'ollama',
    label: 'Ollama 本地模型',
    group: 'local',
    engine: 'ai-sdk',
    pkg: 'ollama-ai-provider-v2@^4',
    note: '完全离线：本机 Ollama 上的视觉模型（需能看图，如 llava、qwen-vl 系列）',
    detect: async () => {
      const base = rcfg('ollama').baseURL ?? process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434/api'
      const models = await ollamaModels(base)
      if (!models) return { ok: false, reason: 'Ollama 没有运行（127.0.0.1:11434）' }
      const model = rcfg('ollama').model ?? models.find((n) => /vl|vision|llava|gemma3|qwen2\.5vl/i.test(n)) ?? models[0]
      return model ? { ok: true, model } : { ok: false, reason: 'Ollama 里还没有模型，先 ollama pull 一个视觉模型' }
    },
    create: (m, model) => m.createOllama({ baseURL: rcfg('ollama').baseURL ?? process.env.OLLAMA_BASE_URL })(model),
  },
  compat({
    id: 'lmstudio',
    label: 'LM Studio 本地模型',
    group: 'local',
    baseURL: 'http://127.0.0.1:1234/v1',
    keyless: true,
    note: '完全离线：LM Studio 本地服务器（开发者 › 启动服务器），选一个能看图的模型',
  }),
  {
    id: 'anthropic',
    label: 'Claude API',
    group: 'cloud',
    engine: 'ai-sdk',
    pkg: '@ai-sdk/anthropic@^4',
    note: 'Anthropic API key（console.anthropic.com），按量计费',
    detect: async () =>
      rcfg('anthropic').apiKey || env('ANTHROPIC_API_KEY')
        ? { ok: true, model: rcfg('anthropic').model ?? 'claude-opus-5-5' }
        : { ok: false, reason: '未配置 API key（ANTHROPIC_API_KEY）' },
    create: (m, model) => m.createAnthropic({ apiKey: rcfg('anthropic').apiKey })(model),
  },
  {
    id: 'bedrock',
    label: 'Claude on Amazon Bedrock',
    group: 'cloud',
    engine: 'ai-sdk',
    pkg: '@ai-sdk/amazon-bedrock@^5',
    note: '用 AWS 凭证（AWS_PROFILE / AWS_ACCESS_KEY_ID）+ 区域',
    detect: async () => {
      const k = env('AWS_REGION', 'AWS_DEFAULT_REGION')
      const region = rcfg('bedrock').region ?? (k ? process.env[k] : null)
      return region
        ? { ok: true, model: rcfg('bedrock').model ?? 'anthropic.claude-opus-5-5' }
        : { ok: false, reason: '未配置 AWS 区域（AWS_REGION）' }
    },
    create: (m, model) => m.createAmazonBedrock({ region: rcfg('bedrock').region })(model),
  },
  {
    id: 'vertex',
    label: 'Claude on Google Vertex AI',
    group: 'cloud',
    engine: 'ai-sdk',
    pkg: '@ai-sdk/google-vertex@^5',
    sub: 'anthropic',
    note: '用 GCP 应用默认凭证（gcloud auth application-default login）+ 项目 + 区域',
    detect: async () =>
      rcfg('vertex').project || env('GOOGLE_VERTEX_PROJECT')
        ? { ok: true, model: rcfg('vertex').model ?? 'claude-opus-5-5' }
        : { ok: false, reason: '未配置 GCP 项目（GOOGLE_VERTEX_PROJECT）' },
    create: (m, model) =>
      m.createGoogleVertexAnthropic({ project: rcfg('vertex').project, location: rcfg('vertex').location ?? process.env.GOOGLE_VERTEX_LOCATION ?? 'global' })(model),
  },
  {
    id: 'google',
    label: 'Gemini API',
    group: 'cloud',
    engine: 'ai-sdk',
    pkg: '@ai-sdk/google@^4',
    note: 'Google AI Studio API key',
    detect: async () => {
      if (!rcfg('google').apiKey && !env('GOOGLE_GENERATIVE_AI_API_KEY')) return { ok: false, reason: '未配置 API key（GOOGLE_GENERATIVE_AI_API_KEY）' }
      return rcfg('google').model ? { ok: true, model: rcfg('google').model } : { ok: false, reason: '需要指定模型（--model）' }
    },
    create: (m, model) => m.createGoogle({ apiKey: rcfg('google').apiKey })(model),
  },
  {
    id: 'openai',
    label: 'OpenAI API',
    group: 'cloud',
    engine: 'ai-sdk',
    pkg: '@ai-sdk/openai@^4',
    note: 'OpenAI API key',
    detect: async () => {
      if (!rcfg('openai').apiKey && !env('OPENAI_API_KEY')) return { ok: false, reason: '未配置 API key（OPENAI_API_KEY）' }
      return rcfg('openai').model ? { ok: true, model: rcfg('openai').model } : { ok: false, reason: '需要指定模型（--model）' }
    },
    create: (m, model) => m.createOpenAI({ apiKey: rcfg('openai').apiKey })(model),
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI 兼容接口',
    group: 'cloud',
    engine: 'ai-sdk',
    pkg: '@ai-sdk/openai-compatible@^3',
    note: 'DeepSeek、通义千问、Kimi、智谱等兼容 OpenAI 接口的服务（需要支持看图的模型）',
    detect: async () => {
      const c = rcfg('openai-compatible')
      if (!c.baseURL) return { ok: false, reason: '需要配置 --base-url' }
      return c.model ? { ok: true, model: c.model } : { ok: false, reason: '需要指定模型（--model）' }
    },
    create: (m, model) => {
      const c = rcfg('openai-compatible')
      return m.createOpenAICompatible({ name: c.name ?? 'compatible', baseURL: c.baseURL, apiKey: c.apiKey })(model)
    },
  },
  compat({ id: 'openrouter', label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', envKey: 'OPENROUTER_API_KEY', note: '一个 key 用几百个模型（Claude / GPT / Gemini / Qwen…），选能看图的' }),
  compat({ id: 'qwen', label: '通义千问（阿里云百炼）', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', envKey: 'DASHSCOPE_API_KEY', note: '百炼 API key，视觉模型如 qwen-vl-max' }),
  compat({ id: 'doubao', label: '豆包（火山方舟）', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', envKey: 'ARK_API_KEY', note: '火山方舟 API key，模型填能看图的豆包模型或推理接入点 ID' }),
  compat({ id: 'kimi', label: 'Kimi（月之暗面）', baseURL: 'https://api.moonshot.cn/v1', envKey: 'MOONSHOT_API_KEY', note: 'Moonshot API key，选带 vision 的模型' }),
  compat({ id: 'glm', label: '智谱 GLM', baseURL: 'https://open.bigmodel.cn/api/paas/v4', envKey: 'ZHIPUAI_API_KEY', note: '智谱开放平台 API key，视觉模型如 GLM-4V 系列' }),
  compat({ id: 'siliconflow', label: '硅基流动', baseURL: 'https://api.siliconflow.cn/v1', envKey: 'SILICONFLOW_API_KEY', note: '硅基流动 API key，选能看图的开源模型（Qwen-VL、GLM-V 等）' }),
  compat({ id: 'deepseek', label: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', envKey: 'DEEPSEEK_API_KEY', defaultModel: 'deepseek-chat', noImages: true, note: 'DeepSeek API key；不能看图，只根据测量数据点评' }),
]

export const runtimeById = (id) => RUNTIMES.find((r) => r.id === id)
export const currentRuntimeId = () => readConfig().runtime ?? 'claude-code'

/** Public listing for the web UI — never includes secrets. */
export async function listRuntimes() {
  const current = currentRuntimeId()
  return Promise.all(
    RUNTIMES.map(async (r) => {
      const d = await r.detect()
      return {
        id: r.id,
        label: r.label,
        group: r.group,
        note: r.note,
        available: !!d.ok,
        reason: d.reason ?? null,
        model: d.model ?? null,
        installed: r.engine !== 'ai-sdk' || !r.pkg ? true : isInstalled(r.pkg.replace(/@[^@/]*$/, '')),
        current: r.id === current,
        verified: r.id === 'claude-code',
        engine: r.engine,
      }
    }),
  )
}

/** Resolve a ready-to-use AI SDK LanguageModel for a runtime (installs its provider if needed). */
export async function createModel(id, onStatus = () => {}) {
  const r = runtimeById(id)
  if (!r) throw new Error(`未知的运行时：${id}`)
  if (r.engine !== 'ai-sdk' || !r.pkg || !r.create) throw new Error(`${r.label} 不走 AI SDK`)
  const d = await r.detect()
  if (!d.ok) throw new Error(`${r.label} 不可用：${d.reason}`)
  const name = r.pkg.replace(/@[^@/]*$/, '')
  if (!isInstalled(name)) {
    onStatus(`首次使用 ${r.label}，正在安装适配包 ${name}…`)
    installPkg(r.pkg)
  }
  const mod = await importPkg(name, r.sub)
  return { model: r.create(mod, d.model), modelId: d.model, label: r.label, noImages: !!r.noImages }
}
