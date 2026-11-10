// Coach review straight from the browser to a cloud model API — no local agent, works on phones.
// The API key lives only in this browser (IndexedDB settings, next to the training log); requests
// go from the browser directly to the provider, never through LiftLens' servers.
//
// Same inputs as the local agent's AI-SDK path (agent/src/ai-run.mjs): coach SKILL.md + shared
// protocol + metric glossary + the coach's reference docs as system prompt, payload + key frames as
// the user message, JSON Schema structured output (prompt-level schema + local check as fallback).

import { useLiveQuery } from 'dexie-react-hooks'
import { db, getSetting, setSetting } from './db'
import { SOURCES } from './coaches'
import type { AgentEvent } from './agent'
// @ts-expect-error plain .mjs shared with the local agent (JSON Schema objects)
import { progressSchema, sessionSchema } from '../../../agent/src/schemas.mjs'

export type ProviderKind = 'anthropic' | 'openai' | 'google' | 'compat'
export interface Provider {
  id: string
  label: string
  kind: ProviderKind
  /** OpenAI-compatible endpoint (compat only; 'custom' asks the user) */
  baseURL?: string
  keyUrl: string
  keyPlaceholder: string
  /** pre-filled model; the list can be loaded with the key */
  defaultModel?: string
  /** text-only model family: send measurements only */
  noImages?: boolean
  note?: string
}

/** Providers whose APIs accept browser requests (CORS checked). Zhipu GLM doesn't — it goes through the local agent. */
export const PROVIDERS: Provider[] = [
  { id: 'anthropic', label: 'Claude', kind: 'anthropic', keyUrl: 'https://console.anthropic.com/settings/keys', keyPlaceholder: 'sk-ant-...', defaultModel: 'claude-opus-5-5' },
  { id: 'openai', label: 'OpenAI', kind: 'openai', keyUrl: 'https://platform.openai.com/api-keys', keyPlaceholder: 'sk-...' },
  { id: 'google', label: 'Gemini', kind: 'google', keyUrl: 'https://aistudio.google.com/apikey', keyPlaceholder: 'AIza...' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'compat', baseURL: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys', keyPlaceholder: 'sk-or-...', note: '一个 key 可以用几百个模型，选能看图的' },
  { id: 'qwen', label: '通义千问', kind: 'compat', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1', keyPlaceholder: 'sk-...', defaultModel: 'qwen-vl-max', note: '阿里云百炼' },
  { id: 'doubao', label: '豆包', kind: 'compat', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey', keyPlaceholder: 'API Key', note: '火山方舟：模型填能看图的豆包模型或推理接入点 ID' },
  { id: 'kimi', label: 'Kimi', kind: 'compat', baseURL: 'https://api.moonshot.cn/v1', keyUrl: 'https://platform.moonshot.cn/console/api-keys', keyPlaceholder: 'sk-...', note: '选带 vision 的模型' },
  { id: 'siliconflow', label: '硅基流动', kind: 'compat', baseURL: 'https://api.siliconflow.cn/v1', keyUrl: 'https://cloud.siliconflow.cn/account/ak', keyPlaceholder: 'sk-...', note: '选能看图的开源模型（Qwen-VL、GLM-V 等）' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'compat', baseURL: 'https://api.deepseek.com/v1', keyUrl: 'https://platform.deepseek.com/api_keys', keyPlaceholder: 'sk-...', defaultModel: 'deepseek-chat', noImages: true, note: '不能看图，只根据测量数据点评' },
  { id: 'custom', label: '其他兼容接口', kind: 'compat', keyUrl: '', keyPlaceholder: 'API Key', note: '任意 OpenAI 兼容接口；需要该服务允许浏览器直接访问（CORS）' },
]
export const providerById = (id: string | undefined) => PROVIDERS.find((p) => p.id === id)

export interface CloudConfig {
  apiKey: string
  model: string
  baseURL?: string
}
/** who writes the review: a cloud API from this browser, or the local agent (with its own runtime) */
export type CoachEngine = { mode: 'cloud'; provider: string } | { mode: 'agent' }

const ENGINE_KEY = 'coach.engine'
const cfgKey = (id: string) => `cloud.${id}`

export const getEngine = () => getSetting<CoachEngine>(ENGINE_KEY, { mode: 'agent' })
export const setEngine = (e: CoachEngine) => setSetting(ENGINE_KEY, e)
export const getCloudConfig = (id: string) => getSetting<CloudConfig | null>(cfgKey(id), null)
export const saveCloudConfig = (id: string, c: CloudConfig) => setSetting(cfgKey(id), c)

export function useCoachEngine() {
  return useLiveQuery(() => getEngine(), [], undefined)
}
/** providers that have a key + model saved in this browser */
export function useCloudConfigs() {
  return useLiveQuery(
    async () => {
      const rows = await db.settings.where('key').startsWith('cloud.').toArray()
      return Object.fromEntries(rows.map((r) => [r.key.slice(6), r.value as CloudConfig])) as Record<string, CloudConfig>
    },
    [],
    {} as Record<string, CloudConfig>,
  )
}
export const isConfigured = (p: Provider, c: CloudConfig | null | undefined) => !!c?.apiKey && !!c.model && (p.id !== 'custom' || !!c.baseURL)

// ---------------------------------------------------------------- model list (also validates the key)

const ANTHROPIC_BROWSER = { 'anthropic-dangerous-direct-browser-access': 'true' }
const NOT_CHAT = /embed|whisper|tts|audio|dall-e|image-|moderation|transcribe|realtime|search|davinci|babbage|rerank|speech/i

export async function listModels(p: Provider, c: CloudConfig): Promise<string[]> {
  let url: string
  let headers: Record<string, string> = {}
  if (p.kind === 'anthropic') {
    url = 'https://api.anthropic.com/v1/models?limit=100'
    headers = { 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01', ...ANTHROPIC_BROWSER }
  } else if (p.kind === 'google') {
    url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200'
    headers = { 'x-goog-api-key': c.apiKey }
  } else {
    url = `${(p.kind === 'openai' ? 'https://api.openai.com/v1' : (c.baseURL ?? p.baseURL ?? '')).replace(/\/$/, '')}/models`
    headers = { authorization: `Bearer ${c.apiKey}` }
  }
  const r = await fetch(url, { headers })
  if (r.status === 401 || r.status === 403) throw new Error('API key 无效或没有权限')
  if (!r.ok) throw new Error(`读取模型列表失败（HTTP ${r.status}）`)
  const j = await r.json()
  if (p.kind === 'google') {
    return (j.models ?? [])
      .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m: { name: string }) => m.name.replace(/^models\//, ''))
      .filter((n: string) => !NOT_CHAT.test(n))
  }
  type M = { id: string; architecture?: { input_modalities?: string[] } }
  let list = (j.data ?? []) as M[]
  // OpenRouter tells us which models can see images
  if (p.id === 'openrouter') list = list.filter((m) => m.architecture?.input_modalities?.includes('image'))
  return list.map((m) => m.id).filter((n) => !NOT_CHAT.test(n))
}

// ---------------------------------------------------------------- run

const coachFiles = import.meta.glob('../../../coaches/**/*.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>

async function buildSystem(coachId: string) {
  const read = async (rel: string) => (coachFiles[`../../../coaches/${rel}`] ? await coachFiles[`../../../coaches/${rel}`]() : '')
  const refs = Object.keys(coachFiles).filter((k) => k.startsWith(`../../../coaches/${coachId}/references/`))
  const refText = await Promise.all(refs.map(async (k) => `\n\n<reference file="${k.split('/').pop()}">\n${await coachFiles[k]()}\n</reference>`))
  return [
    await read(`${coachId}/SKILL.md`),
    `\n\n<shared file="protocol.md">\n${await read('_shared/protocol.md')}\n</shared>`,
    `\n\n<shared file="metrics.md">\n${await read('_shared/metrics.md')}\n</shared>`,
    ...refText,
  ].join('')
}

type Schema = { required?: string[]; properties?: Record<string, { enum?: string[] }> }
function looksValid(obj: unknown, schema: Schema) {
  if (!obj || typeof obj !== 'object') return false
  const o = obj as Record<string, unknown>
  for (const k of schema.required ?? []) if (!(k in o)) return false
  for (const [k, s] of Object.entries(schema.properties ?? {})) if (s.enum && k in o && !s.enum.includes(o[k] as string)) return false
  return true
}
function extractJson(text: string) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const s = t.indexOf('{')
  const e = t.lastIndexOf('}')
  return JSON.parse(s >= 0 && e > s ? t.slice(s, e + 1) : t)
}

/**
 * The AI SDK adds a `user-agent` header. Browsers put it in the CORS preflight, and some
 * OpenAI-compatible servers don't allow it there — the request then dies before it is sent.
 */
const browserFetch: typeof fetch = (input, init) => {
  const h = new Headers(init?.headers)
  h.delete('user-agent')
  return fetch(input, { ...init, headers: h })
}

async function makeModel(p: Provider, c: CloudConfig) {
  switch (p.kind) {
    case 'anthropic':
      return (await import('@ai-sdk/anthropic')).createAnthropic({ apiKey: c.apiKey, headers: ANTHROPIC_BROWSER, fetch: browserFetch })(c.model)
    case 'openai':
      return (await import('@ai-sdk/openai')).createOpenAI({ apiKey: c.apiKey, fetch: browserFetch })(c.model)
    case 'google':
      return (await import('@ai-sdk/google')).createGoogleGenerativeAI({ apiKey: c.apiKey, fetch: browserFetch })(c.model)
    default:
      return (await import('@ai-sdk/openai-compatible')).createOpenAICompatible({ name: p.id, baseURL: (c.baseURL ?? p.baseURL ?? '').replace(/\/$/, ''), apiKey: c.apiKey, fetch: browserFetch })(c.model)
  }
}

export async function runCloud(
  providerId: string,
  body: { kind: 'session' | 'progress'; coachId: string; payload: unknown; images: { name: string; dataUrl: string }[] },
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<Extract<AgentEvent, { type: 'result' }>> {
  const p = providerById(providerId)
  if (!p) throw new Error(`未知的云端服务：${providerId}`)
  const c = await getCloudConfig(p.id)
  if (!isConfigured(p, c)) throw new Error(`还没有设置 ${p.label} 的 API key 和模型`)
  const cfg = c!
  const status = (text: string) => onEvent({ type: 'status', stage: 'run', text })
  status(`${p.label} · ${cfg.model}（浏览器直连）`)

  const { generateText, jsonSchema, Output, APICallError } = await import('ai')
  const model = await makeModel(p, cfg)
  const schema = (body.kind === 'progress' ? progressSchema : sessionSchema) as Schema
  const system = await buildSystem(body.coachId)
  const images = p.noImages ? [] : body.images
  const instructions = [
    body.kind === 'session' ? '请以你的教练身份分析这次训练视频的动作质量。' : '请以你的教练身份分析这位用户一段时间的训练记录，评估能力变化并给出计划。',
    p.noImages
      ? '下面的 payload 是程序测量的指标、规则判定结果和用户信息。这个模型看不了图，本次没有关键帧，只基于数据分析，并在结论里说明没有看画面。'
      : '下面的 payload 是程序测量的指标、规则判定结果和用户信息；之后的图片是关键帧（已叠加骨架和杠铃轨迹），文件名依次为：' + (images.map((i) => i.name).join('、') || '（无）') + '。',
    '程序指标来自单目 2D 姿态估计，可能因遮挡失真：请用关键帧交叉核对，不一致的写进 metricDisagreements。',
    `引用依据时 sourceIds 只能使用以下 id：${SOURCES.map((s) => s.id).join(', ')}。`,
    '全部用简体中文输出。',
    `\n<payload>\n${JSON.stringify(body.payload, null, 2)}\n</payload>`,
  ].join('\n')
  const content = [
    { type: 'text' as const, text: instructions },
    ...images.flatMap((img) => {
      const m = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(img.dataUrl)
      return m ? [{ type: 'file' as const, mediaType: m[1], data: m[2] }] : []
    }),
  ]
  const started = Date.now()
  status(`发送 ${images.length} 张关键帧和测量数据，教练分析中…`)
  const done = (output: unknown) => ({ type: 'result' as const, kind: body.kind, coachId: body.coachId, output, costUsd: null, durationMs: Date.now() - started })

  try {
    const res = await generateText({ model, system, messages: [{ role: 'user', content }], output: Output.object({ schema: jsonSchema(schema as never) }), abortSignal: signal })
    return done(res.output)
  } catch (err) {
    if (signal?.aborted) throw err
    if (APICallError.isInstance(err) && err.statusCode && err.statusCode !== 400) {
      const hint = err.statusCode === 401 || err.statusCode === 403 ? 'API key 无效或没有权限' : err.statusCode === 429 ? '额度不足或请求太频繁' : `HTTP ${err.statusCode}`
      throw new Error(`${p.label} 调用失败：${hint}`)
    }
    const msg = (err as Error)?.message ?? String(err)
    if (/failed to fetch|load failed|networkerror|cannot connect/i.test(msg) || (APICallError.isInstance(err) && !err.statusCode))
      throw new Error(`连不上 ${p.label}（网络问题，或该服务不允许浏览器直接访问）`)
    if (!APICallError.isInstance(err) && !/schema|json|parse|validation|no object/i.test(msg)) {
      console.error('[cloud]', err)
      throw new Error(`${p.label} 调用出错：${msg.slice(0, 200)}`)
    }
    // no native structured output for this model: schema in the prompt, check locally, repair once
    status('该模型不支持强制结构化输出，改用提示词约束 + 本地校验…')
    let last = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await generateText({
        model,
        system: `${system}\n\n只输出一个 JSON 对象，不要任何解释或代码块标记。它必须符合这个 JSON Schema：\n${JSON.stringify(schema)}`,
        messages: [
          { role: 'user', content },
          ...(attempt ? [{ role: 'assistant' as const, content: last }, { role: 'user' as const, content: '上面的输出不符合 JSON Schema（缺字段或枚举值不对）。请只输出修正后的完整 JSON。' }] : []),
        ],
        abortSignal: signal,
      })
      last = res.text
      try {
        const obj = extractJson(res.text)
        if (looksValid(obj, schema)) return done(obj)
      } catch {
        /* retry */
      }
    }
    throw new Error(`${p.label} 没有返回有效的结构化结果`)
  }
}
